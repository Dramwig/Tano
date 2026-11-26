// SPDX-License-Identifier: MIT
//! Bounded, read-only full-text search over remote SSH workspace code/text files
//! using `rg` (ripgrep) with a POSIX `grep -rnIF` fallback.

use super::{transport::RemoteTransport, uri::shell_single_quote};
use crate::storage::{self, search::SearchHit};
use std::{
    collections::{HashMap, HashSet},
    path::Path,
    time::Duration,
};

const MAX_OUTPUT_BYTES: usize = 256 * 1024;
const MAX_HITS: usize = 80;
const SEARCH_TIMEOUT: Duration = Duration::from_secs(10);

pub fn validate_query(query: &str) -> Result<&str, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok("");
    }
    if trimmed.chars().count() > 200 || trimmed.chars().any(|c| c.is_control() || c == '\0') {
        return Err("搜索词不能超过 200 字或包含控制字符".into());
    }
    Ok(trimmed)
}

pub fn build_remote_search_command(remote_root: &str, query: &str) -> Result<String, String> {
    if !remote_root.starts_with('/') || remote_root.contains('\0') {
        return Err("远端工作区路径无效".into());
    }
    let trimmed = validate_query(query)?;
    if trimmed.is_empty() {
        return Err("搜索词为空".into());
    }
    let root_q = shell_single_quote(remote_root).map_err(|e| e.to_string())?;
    let query_q = shell_single_quote(trimmed).map_err(|e| e.to_string())?;

    // Prefer `rg` when installed; fall back to `grep -rnIF`. Always disable symlink
    // traversal, skip dotfiles / .tano / build directories, and treat query as fixed text.
    Ok(format!(
        "cd {root_q} && if command -v rg >/dev/null 2>&1; then \
         rg --fixed-strings --ignore-case --no-heading --with-filename --line-number \
         --max-count 2 --max-filesize 2M --no-follow --no-ignore-vcs \
         --glob '!.git' --glob '!.tano' --glob '!node_modules' --glob '!target' --glob '!dist' --glob '!.*' --glob '!.*/**' \
         -- {query_q} . ; \
         else \
         grep -rnIF --binary-files=without-match \
         --exclude-dir=.git --exclude-dir=.tano --exclude-dir=node_modules --exclude-dir=target --exclude-dir=dist --exclude-dir='.*' --exclude='.*' \
         -- {query_q} . ; \
         fi"
    ))
}

/// Parse `path:line:text` lines from `rg`/`grep`, enforcing Tano's relative-path
/// and dotfile boundary and resolving each file's stable short ID from `id_by_path`.
pub fn parse_remote_search_output(
    stdout: &[u8],
    id_by_path: &HashMap<String, String>,
) -> Vec<SearchHit> {
    let text = String::from_utf8_lossy(stdout);
    let mut seen = HashSet::new();
    let mut hits = Vec::new();
    for line in text.lines() {
        if hits.len() >= MAX_HITS {
            break;
        }
        let Some((raw_path, rest)) = line.split_once(':') else {
            continue;
        };
        let Some((line_no, snippet)) = rest.split_once(':') else {
            continue;
        };
        if !line_no.bytes().all(|b| b.is_ascii_digit()) || line_no.is_empty() {
            continue;
        }
        let normalized = raw_path
            .strip_prefix("./")
            .unwrap_or(raw_path)
            .replace('\\', "/");
        if storage::validate_relative_path(&normalized, false).is_err() {
            continue;
        }
        if !seen.insert(normalized.clone()) {
            continue;
        }
        let Some(id) = id_by_path.get(&normalized) else {
            continue;
        };
        let excerpt: String = snippet.trim().chars().take(150).collect();
        hits.push(SearchHit {
            id: id.clone(),
            path: normalized,
            excerpt: format!("L{line_no}: {excerpt}"),
        });
    }
    hits
}

pub async fn remote_search(
    transport: &dyn RemoteTransport,
    remote_root: &str,
    workspace_id: &str,
    cache: &Path,
    query: &str,
) -> Result<Vec<SearchHit>, String> {
    let trimmed = validate_query(query)?;
    if trimmed.is_empty() || !transport.capabilities().shell {
        return Ok(Vec::new());
    }
    let cmd = build_remote_search_command(remote_root, trimmed)?;
    let out = transport
        .exec_bounded(&cmd, None, MAX_OUTPUT_BYTES, 16 * 1024, SEARCH_TIMEOUT)
        .await
        .map_err(|e| format!("远端全文搜索失败：{e}"))?;
    // Both `rg` and `grep` return exit code 1 when zero matches are found.
    if out.exit_code != 0 && out.exit_code != 1 {
        return Ok(Vec::new());
    }
    let db = storage::database(cache)?;
    let mut stmt = db
        .prepare("SELECT path, id FROM files WHERE workspace_id = ?1 AND deleted = 0")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([workspace_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let mut id_by_path = HashMap::new();
    for row in rows {
        if let Ok((path, id)) = row {
            id_by_path.insert(path, id);
        }
    }
    Ok(parse_remote_search_output(&out.stdout, &id_by_path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_safe_fixed_string_search_command() {
        let cmd =
            build_remote_search_command("/srv/my repo", "const x = 'a'; $(rm -rf /)").unwrap();
        assert!(cmd.contains("cd '/srv/my repo'"));
        assert!(cmd.contains("--fixed-strings"));
        assert!(cmd.contains("-- 'const x = '\\''a'\\''; $(rm -rf /)'"));
        assert!(validate_query("bad\0query").is_err());
        assert!(validate_query("line1\nline2").is_err());
    }

    #[test]
    fn parses_rg_output_and_blocks_dotfiles_and_unknown_paths() {
        let mut ids = HashMap::new();
        ids.insert("src/main.ts".into(), "a1b2c3".into());
        ids.insert("README.md".into(), "d4e5f6".into());

        let stdout = b"./src/main.ts:12:export const needle = 42;\n\
                       ./src/main.ts:24:console.log(needle);\n\
                       ./.env:1:SECRET=needle\n\
                       ../escape.ts:1:needle\n\
                       ./README.md:3:Find needle here\n";
        let hits = parse_remote_search_output(stdout, &ids);
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].id, "a1b2c3");
        assert_eq!(hits[0].path, "src/main.ts");
        assert!(hits[0].excerpt.starts_with("L12:"));
        assert_eq!(hits[1].id, "d4e5f6");
        assert_eq!(hits[1].path, "README.md");
    }
}
