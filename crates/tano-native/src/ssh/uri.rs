// SPDX-License-Identifier: MIT
//! Canonical SSH remote workspace URI handling and POSIX shell escaping.

use crate::error::{NativeError, NativeResult};

pub const REMOTE_WORKSPACE_SCHEME: &str = "ssh://";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParsedRemoteUri {
    pub host_id: String,
    pub remote_path: String,
}

pub fn is_remote_workspace_uri(path: &str) -> bool {
    path.starts_with(REMOTE_WORKSPACE_SCHEME)
}

pub fn is_valid_host_id(host_id: &str) -> bool {
    !host_id.is_empty()
        && host_id.len() <= 64
        && host_id != "."
        && host_id != ".."
        && host_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

pub fn normalize_remote_posix_path(path: &str) -> NativeResult<String> {
    if !path.starts_with('/') {
        return Err(NativeError::InvalidPath("远端路径必须是绝对 POSIX 路径"));
    }
    if path.len() > 2048 || path.contains('\\') {
        return Err(NativeError::InvalidPath(
            "远端路径包含不支持的字符或超过长度限制",
        ));
    }
    if path.bytes().any(|b| b < 0x20 || b == 0x7f) {
        return Err(NativeError::InvalidPath("远端路径包含非法控制字符"));
    }
    let mut segments = Vec::new();
    for segment in path.split('/').filter(|part| !part.is_empty()) {
        if segment == "." || segment == ".." {
            return Err(NativeError::SymlinkEscape("远端路径不能包含 . 或 .."));
        }
        segments.push(segment);
    }
    if segments.is_empty() {
        Ok("/".into())
    } else {
        Ok(format!("/{}", segments.join("/")))
    }
}

pub fn format_remote_workspace_uri(host_id: &str, remote_path: &str) -> NativeResult<String> {
    if !is_valid_host_id(host_id) {
        return Err(NativeError::InvalidPath("远端主机标识无效"));
    }
    let normalized = normalize_remote_posix_path(remote_path)?;
    Ok(format!("{REMOTE_WORKSPACE_SCHEME}{host_id}{normalized}"))
}

pub fn parse_remote_workspace_uri(uri: &str) -> NativeResult<ParsedRemoteUri> {
    let rest = uri
        .strip_prefix(REMOTE_WORKSPACE_SCHEME)
        .ok_or(NativeError::InvalidPath("无效的 SSH 工作区地址"))?;
    let slash = rest
        .find('/')
        .ok_or(NativeError::InvalidPath("SSH 工作区地址缺少远端路径"))?;
    if slash == 0 {
        return Err(NativeError::InvalidPath("SSH 工作区地址缺少主机标识"));
    }
    let host_id = &rest[..slash];
    let raw_path = &rest[slash..];
    if !is_valid_host_id(host_id) {
        return Err(NativeError::InvalidPath("远端主机标识无效"));
    }
    let remote_path = normalize_remote_posix_path(raw_path)?;
    Ok(ParsedRemoteUri {
        host_id: host_id.to_owned(),
        remote_path,
    })
}

pub fn join_remote_posix(root: &str, relative: &str) -> NativeResult<String> {
    let base = normalize_remote_posix_path(root)?;
    if relative.is_empty() {
        return Ok(base);
    }
    if relative.starts_with('/')
        || relative.contains('\\')
        || relative.bytes().any(|b| b < 0x20 || b == 0x7f)
    {
        return Err(NativeError::InvalidPath("无效的工作空间相对路径"));
    }
    for segment in relative.split('/') {
        if segment.is_empty() || segment == "." || segment == ".." {
            return Err(NativeError::SymlinkEscape("路径不能离开工作空间"));
        }
    }
    if base == "/" {
        Ok(format!("/{relative}"))
    } else {
        Ok(format!("{base}/{relative}"))
    }
}

pub fn remote_display_name(remote_path: &str) -> String {
    let trimmed = remote_path.trim_end_matches('/');
    if trimmed.is_empty() {
        return "/".into();
    }
    trimmed
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or("/")
        .to_owned()
}

/// Strictly quote an arbitrary string as a single POSIX shell word (`'...'`).
/// Rejects NUL bytes which cannot exist in POSIX arguments or paths.
pub fn shell_single_quote(value: &str) -> NativeResult<String> {
    if value.contains('\0') {
        return Err(NativeError::InvalidPath("参数不能包含空字符"));
    }
    let mut quoted = String::with_capacity(value.len() + 2);
    quoted.push('\'');
    for ch in value.chars() {
        if ch == '\'' {
            quoted.push_str("'\\''");
        } else {
            quoted.push(ch);
        }
    }
    quoted.push('\'');
    Ok(quoted)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_parses_and_joins_remote_uris() {
        let uri = format_remote_workspace_uri("dev-box_1", "/home/ubuntu/repo/").unwrap();
        assert_eq!(uri, "ssh://dev-box_1/home/ubuntu/repo");
        let parsed = parse_remote_workspace_uri(&uri).unwrap();
        assert_eq!(parsed.host_id, "dev-box_1");
        assert_eq!(parsed.remote_path, "/home/ubuntu/repo");
        assert_eq!(
            join_remote_posix("/home/ubuntu/repo", "docs/note.md").unwrap(),
            "/home/ubuntu/repo/docs/note.md"
        );
        assert_eq!(remote_display_name("/home/ubuntu/repo/"), "repo");
        assert_eq!(remote_display_name("/"), "/");
    }

    #[test]
    fn rejects_traversal_and_escapes_posix_arguments() {
        for bad in ["relative", "/a/../b", "/a/./b", "/a\\b", "/a\0b", "/a\nb"] {
            assert!(normalize_remote_posix_path(bad).is_err(), "{bad}");
        }
        assert!(parse_remote_workspace_uri("ssh://../etc").is_err());
        assert!(join_remote_posix("/srv", "../etc/passwd").is_err());
        assert_eq!(
            shell_single_quote("/srv/my 'proj'/$(rm -rf /)").unwrap(),
            "'/srv/my '\\''proj'\\''/$(rm -rf /)'"
        );
        assert!(shell_single_quote("bad\0arg").is_err());
    }
}
