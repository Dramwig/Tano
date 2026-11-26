// SPDX-License-Identifier: MIT
//! Launch an interactive native OS terminal connected via `ssh -t` directly into
//! a remote SSH workspace directory.

use super::{config::ResolvedSshTarget, uri::shell_single_quote};
use std::path::Path;

fn validate_ssh_token(value: &str, label: &str) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.starts_with('-')
        || trimmed.chars().any(|c| c.is_control() || c.is_whitespace())
    {
        return Err(format!("SSH {label} 包含不允许的字符，已阻止打开终端"));
    }
    Ok(())
}

/// Build the argv passed to the local `ssh` executable for an interactive login
/// shell inside `remote_root`.
pub fn build_ssh_terminal_args(
    target: &ResolvedSshTarget,
    remote_root: &str,
) -> Result<Vec<String>, String> {
    if !remote_root.starts_with('/') || remote_root.contains('\0') || remote_root.contains('\n') {
        return Err("远端目录路径无效".into());
    }
    let mut args = vec!["-t".to_owned()];

    if let Some(alias) = target.config_alias.as_deref().filter(|s| !s.is_empty()) {
        validate_ssh_token(alias, "配置别名")?;
        if target.forward_agent {
            args.push("-A".into());
        }
        args.push(alias.to_owned());
    } else {
        validate_ssh_token(&target.host, "主机地址")?;
        validate_ssh_token(&target.username, "用户名")?;
        args.push("-p".into());
        args.push(target.port.to_string());
        if target.identities_only {
            args.push("-o".into());
            args.push("IdentitiesOnly=yes".into());
        }
        if target.forward_agent {
            args.push("-A".into());
        }
        if !target.proxy_jump.is_empty() {
            let mut hops = Vec::new();
            for hop in &target.proxy_jump {
                validate_ssh_token(hop, "跳板机")?;
                hops.push(hop.clone());
            }
            args.push("-J".into());
            args.push(hops.join(","));
        }
        for key in &target.identity_files {
            let text = key.to_string_lossy();
            if !text.is_empty() && !text.contains('\0') {
                args.push("-i".into());
                args.push(text.into_owned());
            }
        }
        args.push(format!("{}@{}", target.username, target.host));
    }

    let remote_cmd = format!(
        "cd {} && exec \"${{SHELL:-/bin/sh}}\" -l",
        shell_single_quote(remote_root).map_err(|e| e.to_string())?
    );
    args.push(remote_cmd);
    Ok(args)
}

/// Build non-interactive `ssh -T` stdio-bridge args for running a remote command
/// (e.g., MCP stdio bridge).
pub fn build_ssh_stdio_args(
    target: &ResolvedSshTarget,
    remote_cmd: &str,
) -> Result<Vec<String>, String> {
    let mut args = vec![
        "-T".to_owned(),
        "-o".to_owned(),
        "BatchMode=yes".to_owned(),
        "-o".to_owned(),
        "ServerAliveInterval=30".to_owned(),
    ];
    if let Some(alias) = target.config_alias.as_deref().filter(|s| !s.is_empty()) {
        validate_ssh_token(alias, "配置别名")?;
        args.push(alias.to_owned());
    } else {
        validate_ssh_token(&target.host, "主机地址")?;
        validate_ssh_token(&target.username, "用户名")?;
        args.push("-p".into());
        args.push(target.port.to_string());
        if target.identities_only {
            args.push("-o".into());
            args.push("IdentitiesOnly=yes".into());
        }
        if !target.proxy_jump.is_empty() {
            let mut hops = Vec::new();
            for hop in &target.proxy_jump {
                validate_ssh_token(hop, "跳板机")?;
                hops.push(hop.clone());
            }
            args.push("-J".into());
            args.push(hops.join(","));
        }
        for key in &target.identity_files {
            let text = key.to_string_lossy();
            if !text.is_empty() && !text.contains('\0') {
                args.push("-i".into());
                args.push(text.into_owned());
            }
        }
        args.push(format!("{}@{}", target.username, target.host));
    }
    args.push(remote_cmd.to_owned());
    Ok(args)
}

pub fn open_remote_terminal(target: &ResolvedSshTarget, remote_root: &str) -> Result<(), String> {
    let ssh_args = build_ssh_terminal_args(target, remote_root)?;

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Prefer Windows Terminal if available; otherwise spawn OpenSSH directly in its own console.
        let mut wt = std::process::Command::new("wt.exe");
        wt.args(["-w", "0", "new-tab", "--title", &target.label, "--", "ssh"]);
        wt.args(&ssh_args);
        if wt.spawn().is_ok() {
            return Ok(());
        }
        let system_root = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
        let openssh = Path::new(&system_root).join("System32\\OpenSSH\\ssh.exe");
        let ssh_bin = if openssh.is_file() {
            openssh
        } else {
            Path::new("ssh.exe").to_path_buf()
        };
        std::process::Command::new(ssh_bin)
            .args(&ssh_args)
            .creation_flags(0x00000010) // CREATE_NEW_CONSOLE
            .spawn()
            .map_err(|e| format!("无法打开 SSH 终端（请确认已安装 OpenSSH 客户端）：{e}"))?;
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        let mut command_line = String::from("ssh");
        for arg in &ssh_args {
            command_line.push(' ');
            command_line.push_str(&shell_single_quote(arg));
        }
        let escaped = command_line.replace('\\', "\\\\").replace('"', "\\\"");
        let script = format!("tell application \"Terminal\" to do script \"{escaped}\"");
        std::process::Command::new("osascript")
            .args([
                "-e",
                &script,
                "-e",
                "tell application \"Terminal\" to activate",
            ])
            .spawn()
            .map_err(|e| format!("无法打开 macOS 终端：{e}"))?;
        Ok(())
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        for (program, flag) in [
            ("x-terminal-emulator", "-e"),
            ("gnome-terminal", "--"),
            ("konsole", "-e"),
            ("xterm", "-e"),
        ] {
            if std::process::Command::new(program)
                .arg(flag)
                .arg("ssh")
                .args(&ssh_args)
                .spawn()
                .is_ok()
            {
                return Ok(());
            }
        }
        Err("未找到系统终端程序，请在终端中手动执行 ssh 连接".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ssh::types::SshAuthMethod;
    use std::path::PathBuf;

    fn sample_target() -> ResolvedSshTarget {
        ResolvedSshTarget {
            host_id: "prod".into(),
            label: "Prod".into(),
            host: "10.0.0.5".into(),
            port: 2222,
            username: "deploy".into(),
            config_alias: None,
            auth_method: SshAuthMethod::Key,
            identity_files: vec![PathBuf::from("/home/u/.ssh/id_ed25519")],
            identities_only: true,
            proxy_jump: vec!["bastion.internal".into()],
            proxy_command: None,
            forward_agent: true,
            connect_timeout_secs: 15,
            keepalive_secs: 30,
        }
    }

    #[test]
    fn builds_safe_terminal_and_stdio_args_with_posix_quoting() {
        let args = build_ssh_terminal_args(&sample_target(), "/srv/my 'app' $(rm -rf /)").unwrap();
        assert_eq!(args[0], "-t");
        assert!(args.windows(2).any(|w| w == ["-p", "2222"]));
        assert!(args.windows(2).any(|w| w == ["-J", "bastion.internal"]));
        assert!(args.contains(&"deploy@10.0.0.5".to_owned()));
        let cmd = args.last().unwrap();
        assert!(cmd.contains("cd '/srv/my '\\''app'\\'' $(rm -rf /)'"));

        let stdio =
            build_ssh_stdio_args(&sample_target(), "node ~/.tano/mcp/tano-mcp.cjs").unwrap();
        assert_eq!(stdio[0], "-T");
        assert!(stdio.contains(&"BatchMode=yes".to_owned()));
    }

    #[test]
    fn rejects_option_injection_in_host_or_alias() {
        let mut bad = sample_target();
        bad.host = "-oProxyCommand=evil".into();
        assert!(build_ssh_terminal_args(&bad, "/srv/app").is_err());

        let mut bad_alias = sample_target();
        bad_alias.config_alias = Some("-oEvil=1".into());
        assert!(build_ssh_terminal_args(&bad_alias, "/srv/app").is_err());
    }
}
