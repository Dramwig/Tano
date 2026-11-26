// SPDX-License-Identifier: MIT
//! Remote `tano-mcp.cjs` deployment, dual MCP configuration generation (direct
//! remote server config + local SSH stdio bridge), and remote Agent activity log reading.

use super::{
    config::ResolvedSshTarget,
    remote_terminal::build_ssh_stdio_args,
    transport::RemoteTransport,
    types::SshMcpSyncResult,
    uri::{join_remote_posix, shell_single_quote},
};
use crate::{agent, storage::hash};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::Manager;

const MAX_REMOTE_AGENT_DB_BYTES: u64 = 16 * 1024 * 1024;

pub fn locate_local_mcp_script(app: &tauri::AppHandle) -> Result<(PathBuf, bool), String> {
    let bundled = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("mcp/tano-mcp.cjs");
    let development =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../apps/mcp/dist/tano-mcp.cjs");
    let script = if bundled.is_file() {
        bundled
    } else {
        development
    };
    let exists = script.is_file();
    let script = if exists {
        std::fs::canonicalize(script).map_err(|e| e.to_string())?
    } else {
        script
    };
    Ok((script, exists))
}

/// Parse a `node -v` output string like `v22.14.0` and ensure it satisfies Node >= 22.13
/// (required for built-in `node:sqlite`).
pub fn parse_and_validate_node_version(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    let version = trimmed.strip_prefix('v').unwrap_or(trimmed);
    let mut parts = version.split('.');
    let major: u32 = parts
        .next()
        .and_then(|p| p.parse().ok())
        .ok_or_else(|| format!("无法解析远端 Node.js 版本：{trimmed}"))?;
    let minor: u32 = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
    if major < 22 || (major == 22 && minor < 13) {
        return Err(format!(
            "远端 Node.js 版本为 {trimmed}，tano-mcp 需要 Node.js >= 22.13（内置 node:sqlite）"
        ));
    }
    Ok(trimmed.to_owned())
}

async fn ensure_remote_dir(transport: &dyn RemoteTransport, path: &str) -> Result<(), String> {
    match transport.lstat(path).await.map_err(|e| e.to_string())? {
        Some(stat) if stat.is_dir && !stat.is_symlink => Ok(()),
        Some(_) => Err(format!("远端路径 {path} 不是普通目录")),
        None => transport.mkdir(path).await.map_err(|e| e.to_string()),
    }
}

/// Upload bundled `tano-mcp.cjs` to `~/.tano/mcp/tano-mcp.cjs` on the remote host
/// if missing or SHA-256 differs, and ensure `~/.tano/data/agents` exists.
pub async fn sync_remote_mcp(
    transport: &dyn RemoteTransport,
    local_script: &Path,
) -> Result<SshMcpSyncResult, String> {
    if !local_script.is_file() {
        return Err("本机未找到打包的 tano-mcp.cjs，请先运行 npm run mcp:build".into());
    }
    let local_bytes =
        std::fs::read(local_script).map_err(|e| format!("无法读取 tano-mcp.cjs：{e}"))?;
    let local_sha = hash(&local_bytes);

    let node_out = transport
        .exec_bounded(
            "command -v node && node -v",
            None,
            4096,
            4096,
            Duration::from_secs(10),
        )
        .await
        .map_err(|e| format!("检查远端 Node.js 版本失败：{e}"))?;
    if node_out.exit_code != 0 {
        return Err("远端服务器未找到 node 命令，请先安装 Node.js >= 22.13".into());
    }
    let stdout_text = String::from_utf8_lossy(&node_out.stdout);
    let mut lines = stdout_text.lines().map(str::trim).filter(|l| !l.is_empty());
    let node_path = lines.next().unwrap_or("node").to_owned();
    let raw_version = lines.next().unwrap_or("");
    let node_version = parse_and_validate_node_version(raw_version)?;

    let home = transport.home_dir().await.map_err(|e| e.to_string())?;
    let tano_dir = join_remote_posix(&home, ".tano").map_err(|e| e.to_string())?;
    let mcp_dir = join_remote_posix(&home, ".tano/mcp").map_err(|e| e.to_string())?;
    let data_dir = join_remote_posix(&home, ".tano/data").map_err(|e| e.to_string())?;
    let agents_dir = join_remote_posix(&home, ".tano/data/agents").map_err(|e| e.to_string())?;
    ensure_remote_dir(transport, &tano_dir).await?;
    ensure_remote_dir(transport, &mcp_dir).await?;
    ensure_remote_dir(transport, &data_dir).await?;
    ensure_remote_dir(transport, &agents_dir).await?;

    let remote_script =
        join_remote_posix(&home, ".tano/mcp/tano-mcp.cjs").map_err(|e| e.to_string())?;
    let needs_upload = match transport
        .lstat(&remote_script)
        .await
        .map_err(|e| e.to_string())?
    {
        Some(stat) if stat.is_file && !stat.is_symlink && stat.size == local_bytes.len() as u64 => {
            let (existing, _) = transport
                .read_bytes(&remote_script, 32 * 1024 * 1024)
                .await
                .map_err(|e| e.to_string())?;
            hash(&existing) != local_sha
        }
        _ => true,
    };

    if needs_upload {
        transport
            .write_atomic_replace(&remote_script, &local_bytes)
            .await
            .map_err(|e| format!("上传远端 tano-mcp.cjs 失败：{e}"))?;
    }

    Ok(SshMcpSyncResult {
        remote_script_path: remote_script,
        remote_data_dir: data_dir,
        node_path,
        node_version,
        sha256: local_sha,
        uploaded: needs_upload,
    })
}

/// Build the dual MCP setup JSON returned by `agent_setup` for remote SSH workspaces:
/// - `config` / `directConfig`: run directly by remote Agents (Codex/Claude/Antigravity on server)
/// - `bridgeConfig`: run by local Agents over `ssh -T` stdio bridge
pub fn build_remote_agent_setup(
    target: &ResolvedSshTarget,
    remote_home: &str,
    remote_root: &str,
    bundled: bool,
    remote_deployed: bool,
    node_version: Option<&str>,
) -> Result<Value, String> {
    let remote_script =
        join_remote_posix(remote_home, ".tano/mcp/tano-mcp.cjs").map_err(|e| e.to_string())?;
    let remote_data = join_remote_posix(remote_home, ".tano/data").map_err(|e| e.to_string())?;

    let direct_config = json!({
        "mcpServers": {
            "tano": {
                "command": "node",
                "args": [
                    remote_script,
                    "--workspace",
                    remote_root,
                    "--data-dir",
                    remote_data,
                ]
            }
        }
    });

    let remote_stdio_cmd = format!(
        "node {} --workspace {} --data-dir {}",
        shell_single_quote(&remote_script).map_err(|e| e.to_string())?,
        shell_single_quote(remote_root).map_err(|e| e.to_string())?,
        shell_single_quote(&remote_data).map_err(|e| e.to_string())?
    );
    let bridge_args = build_ssh_stdio_args(target, &remote_stdio_cmd)?;
    let bridge_config = json!({
        "mcpServers": {
            "tano": {
                "command": "ssh",
                "args": bridge_args,
            }
        }
    });

    Ok(json!({
        "bundled": bundled,
        "remote": true,
        "remoteDeployed": remote_deployed,
        "hostId": target.host_id,
        "hostLabel": target.label,
        "remotePath": remote_root,
        "nodeVersion": node_version,
        "config": direct_config,
        "directConfig": direct_config,
        "bridgeConfig": bridge_config,
    }))
}

/// Read remote `~/.tano/data/agents/<workspace_id>.sqlite` via SFTP into a local
/// temporary file and verify every row's `before_hash`/`after_hash`.
pub async fn read_remote_agent_changes(
    transport: &dyn RemoteTransport,
    workspace_id: &str,
    remote_root: &str,
    selected: Option<&str>,
) -> Result<Vec<agent::Change>, String> {
    uuid::Uuid::parse_str(workspace_id).map_err(|_| "工作区标识无效")?;
    let home = transport.home_dir().await.map_err(|e| e.to_string())?;
    let db_remote = join_remote_posix(&home, &format!(".tano/data/agents/{workspace_id}.sqlite"))
        .map_err(|e| e.to_string())?;
    let Some(stat) = transport
        .lstat(&db_remote)
        .await
        .map_err(|e| e.to_string())?
    else {
        return Ok(Vec::new());
    };
    if stat.is_symlink || !stat.is_file {
        return Err("远端 Agent 日志文件必须是普通文件".into());
    }
    if stat.size > MAX_REMOTE_AGENT_DB_BYTES {
        return Err("远端 Agent 日志超过 16 MiB 限制".into());
    }
    let (bytes, _) = transport
        .read_bytes(&db_remote, MAX_REMOTE_AGENT_DB_BYTES)
        .await
        .map_err(|e| format!("读取远端 Agent 活动日志失败：{e}"))?;

    let temp_dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    let agents_dir = temp_dir.path().join("agents");
    std::fs::create_dir_all(&agents_dir).map_err(|e| e.to_string())?;
    let local_db = agents_dir.join(format!("{workspace_id}.sqlite"));
    std::fs::write(&local_db, bytes).map_err(|e| e.to_string())?;
    agent::changes_for_root_str(temp_dir.path(), workspace_id, remote_root, selected)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ssh::types::SshAuthMethod;

    #[test]
    fn validates_node_version_for_builtin_sqlite() {
        assert_eq!(
            parse_and_validate_node_version("v22.13.0\n").unwrap(),
            "v22.13.0"
        );
        assert_eq!(
            parse_and_validate_node_version("v24.1.0").unwrap(),
            "v24.1.0"
        );
        assert!(parse_and_validate_node_version("v22.12.0").is_err());
        assert!(parse_and_validate_node_version("v20.18.1").is_err());
    }

    #[test]
    fn builds_direct_and_bridge_mcp_configs() {
        let target = ResolvedSshTarget {
            host_id: "gpu".into(),
            label: "GPU Box".into(),
            host: "10.1.2.3".into(),
            port: 22,
            username: "dev".into(),
            config_alias: Some("gpu-box".into()),
            auth_method: SshAuthMethod::Agent,
            identity_files: Vec::new(),
            identities_only: false,
            proxy_jump: Vec::new(),
            proxy_command: None,
            forward_agent: false,
            connect_timeout_secs: 15,
            keepalive_secs: 30,
        };
        let setup = build_remote_agent_setup(
            &target,
            "/home/dev",
            "/srv/docs",
            true,
            true,
            Some("v22.14.0"),
        )
        .unwrap();
        assert_eq!(setup["remote"], json!(true));
        assert_eq!(
            setup["directConfig"]["mcpServers"]["tano"]["command"],
            json!("node")
        );
        assert_eq!(
            setup["bridgeConfig"]["mcpServers"]["tano"]["command"],
            json!("ssh")
        );
        let bridge_args = setup["bridgeConfig"]["mcpServers"]["tano"]["args"]
            .as_array()
            .unwrap();
        assert!(bridge_args.iter().any(|v| v == "gpu-box"));
        assert!(bridge_args
            .last()
            .unwrap()
            .as_str()
            .unwrap()
            .contains("/home/dev/.tano/mcp/tano-mcp.cjs"));
    }
}
