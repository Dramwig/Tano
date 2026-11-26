// SPDX-License-Identifier: MIT
//! Read-only Git status/diff/log execution over an active SSH remote workspace.
//! Disables hooks, fsmonitor, external diff/textconv, credential helpers, and SSH
//! transport so inspecting an untrusted remote repository cannot execute repo code.

use super::{
    storage::ensure_no_symlink_chain,
    transport::RemoteTransport,
    uri::{join_remote_posix, shell_single_quote},
};
use crate::workspace_git::{self, QueryArgs};
use serde_json::{json, Value};
use std::time::Duration;

const OUTPUT_LIMIT: usize = 256 * 1024;
const GIT_TIMEOUT: Duration = Duration::from_secs(15);

pub fn build_safe_remote_git_command(
    remote_root: &str,
    command_name: &str,
    args: &QueryArgs,
) -> Result<String, String> {
    if !remote_root.starts_with('/') || remote_root.contains('\0') {
        return Err("远端工作区路径无效".into());
    }
    let mut parts: Vec<String> = vec![
        "env".into(),
        "GIT_CONFIG_NOSYSTEM=1".into(),
        "GIT_CONFIG_GLOBAL=/dev/null".into(),
        "GIT_ATTR_NOSYSTEM=1".into(),
        "GIT_OPTIONAL_LOCKS=0".into(),
        "GIT_NO_LAZY_FETCH=1".into(),
        "GIT_TERMINAL_PROMPT=0".into(),
        "GIT_LITERAL_PATHSPECS=1".into(),
        "git".into(),
        "-C".into(),
        shell_single_quote(remote_root).map_err(|e| e.to_string())?,
        "--no-pager".into(),
        "-c".into(),
        "core.fsmonitor=false".into(),
        "-c".into(),
        "core.untrackedCache=false".into(),
        "-c".into(),
        "core.hooksPath=/dev/null".into(),
        "-c".into(),
        "core.sshCommand=/bin/false".into(),
        "-c".into(),
        "credential.helper=".into(),
        "-c".into(),
        "color.ui=false".into(),
    ];

    match command_name {
        "git.status" => {
            parts.extend([
                "status".into(),
                "--porcelain=v1".into(),
                "-z".into(),
                "--untracked-files=normal".into(),
                "--ignore-submodules=all".into(),
                "--no-renames".into(),
            ]);
        }
        "git.log" => {
            parts.extend([
                "log".into(),
                "--no-decorate".into(),
                "--no-renames".into(),
                "--date=iso-strict".into(),
                shell_single_quote("--format=%x1e%H%x1f%an%x1f%aI%x1f%s")
                    .map_err(|e| e.to_string())?,
                "--max-count".into(),
                args.limit.to_string(),
            ]);
            if let Some(path) = args.path.as_deref() {
                crate::storage::validate_relative_path(path, false)?;
                parts.push("--".into());
                parts.push(shell_single_quote(path).map_err(|e| e.to_string())?);
            }
        }
        "git.diff" => {
            let path = args.path.as_deref().ok_or("请选择一个文件")?;
            crate::storage::validate_relative_path(path, false)?;
            parts.extend([
                "diff".into(),
                "--no-ext-diff".into(),
                "--no-textconv".into(),
                "--no-renames".into(),
                "--ignore-submodules=all".into(),
                "--no-color".into(),
                "--unified=3".into(),
            ]);
            if args.staged {
                parts.push("--cached".into());
            }
            parts.push("--".into());
            parts.push(shell_single_quote(path).map_err(|e| e.to_string())?);
        }
        _ => return Err("不支持的 Git 查询命令".into()),
    }

    Ok(parts.join(" "))
}

pub async fn query_remote_git(
    transport: &dyn RemoteTransport,
    remote_root: &str,
    command_name: &str,
    args: QueryArgs,
) -> Result<Value, String> {
    if !transport.capabilities().git {
        return Err("远端服务器未检测到 git 命令，无法执行 Git 查询".into());
    }

    // Verify `.git` is an ordinary non-symlink directory and not a linked worktree / alternates repo.
    let git_dir = join_remote_posix(remote_root, ".git").map_err(|e| e.to_string())?;
    let Some(git_stat) = transport.lstat(&git_dir).await.map_err(|e| e.to_string())? else {
        return Err("请将远端 Git 仓库根目录作为工作区打开".into());
    };
    if git_stat.is_symlink || !git_stat.is_dir {
        return Err(
            "Git 插件需要工作区根目录包含普通 .git 目录；暂不支持符号链接或链接工作树".into(),
        );
    }
    for unsupported in [
        ".git/commondir",
        ".git/objects/info/alternates",
        ".git/objects/info/http-alternates",
        ".git/info/sparse-checkout",
    ] {
        let p = join_remote_posix(remote_root, unsupported).map_err(|e| e.to_string())?;
        if transport
            .lstat(&p)
            .await
            .map_err(|e| e.to_string())?
            .is_some()
        {
            return Err("Git 插件暂不支持共享对象库、链接工作树或稀疏检出".into());
        }
    }

    let head_path = join_remote_posix(remote_root, ".git/HEAD").map_err(|e| e.to_string())?;
    let (head_bytes, _) = transport
        .read_bytes(&head_path, 1024)
        .await
        .map_err(|_| "无法读取远端 Git HEAD")?;
    let head = std::str::from_utf8(&head_bytes)
        .map_err(|_| "Git HEAD 无效")?
        .trim();
    let branch = head.strip_prefix("ref: refs/heads/").map(str::to_owned);
    if head.starts_with("ref:") && branch.is_none() {
        return Err("Git HEAD 不是本地分支".into());
    }
    if head.contains('\n') || head.contains('\r') {
        return Err("Git HEAD 无效".into());
    }

    if let Some(path) = args.path.as_deref() {
        ensure_no_symlink_chain(transport, remote_root, path).await?;
    }

    let cmd = build_safe_remote_git_command(remote_root, command_name, &args)?;
    let out = transport
        .exec_bounded(&cmd, None, OUTPUT_LIMIT, 16 * 1024, GIT_TIMEOUT)
        .await
        .map_err(|e| format!("远端 Git 查询失败：{e}"))?;
    if out.exit_code != 0 {
        return Err("远端 Git 查询失败；仓库可能正在更新，或使用了尚不支持的存储格式".into());
    }

    let result = match command_name {
        "git.status" => workspace_git::parse_status_output(&out.stdout, &branch)?,
        "git.log" => workspace_git::parse_log_output(&out.stdout, args.path.as_deref())?,
        "git.diff" => {
            let path = args.path.as_deref().ok_or("请选择一个文件")?;
            let patch = String::from_utf8(out.stdout).map_err(|_| "Git 差异不是 UTF-8 文本")?;
            json!({ "path": path, "staged": args.staged, "patch": patch })
        }
        _ => return Err("不支持的 Git 查询命令".into()),
    };

    if serde_json::to_vec(&result)
        .map_err(|_| "Git 输出无效")?
        .len()
        > 300 * 1024
    {
        return Err("Git 查询结果过大".into());
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_isolated_read_only_git_commands_and_quotes_paths() {
        let status_args = workspace_git::parse_args("git.status", json!({})).unwrap();
        let cmd =
            build_safe_remote_git_command("/srv/my repo", "git.status", &status_args).unwrap();
        assert!(cmd.contains("core.hooksPath=/dev/null"));
        assert!(cmd.contains("core.fsmonitor=false"));
        assert!(cmd.contains("GIT_OPTIONAL_LOCKS=0"));
        assert!(cmd.contains("-C '/srv/my repo'"));

        let diff_args =
            workspace_git::parse_args("git.diff", json!({ "path": "src/a'b.ts", "staged": true }))
                .unwrap();
        let diff_cmd = build_safe_remote_git_command("/srv/repo", "git.diff", &diff_args).unwrap();
        assert!(diff_cmd.contains("--cached"));
        assert!(diff_cmd.contains("-- 'src/a'\\''b.ts'"));
    }
}
