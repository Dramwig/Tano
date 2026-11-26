use crate::{agent, app_data, error::NativeError, with_workspace_session, AppState};
use std::path::PathBuf;
use tauri::Manager;

#[tauri::command]
pub(crate) async fn open_workspace_terminal(
    workspace_id: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    if cfg!(mobile) {
        return Err(NativeError::PlatformUnavailable("请在电脑端打开工作区终端").into());
    }
    #[cfg(desktop)]
    if let Some(remote) = crate::remote_workspace_session(&workspace_id, &app.state::<AppState>())?
    {
        return crate::ssh::remote_terminal::open_remote_terminal(
            &remote.target,
            &remote.remote_root,
        );
    }
    tauri::async_runtime::spawn_blocking(move || {
        with_workspace_session(&workspace_id, app.state::<AppState>(), |s| {
            agent::terminal(&s.root)
        })
    })
    .await
    .map_err(|e| format!("打开终端任务失败：{e}"))?
}

#[tauri::command]
pub(crate) async fn agent_setup(
    workspace_id: String,
    app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    if cfg!(mobile) {
        return Err(
            NativeError::PlatformUnavailable("本机 MCP 仅在桌面提供，请在电脑端使用").into(),
        );
    }
    #[cfg(desktop)]
    if let Some(remote) = crate::remote_workspace_session(&workspace_id, &app.state::<AppState>())?
    {
        let (_, exists) = crate::ssh::remote_mcp::locate_local_mcp_script(&app)?;
        let remote_home = remote
            .transport
            .home_dir()
            .await
            .map_err(|e| e.to_string())?;
        let remote_script =
            crate::ssh::uri::join_remote_posix(&remote_home, ".tano/mcp/tano-mcp.cjs")
                .map_err(|e| e.to_string())?;
        let remote_deployed = remote
            .transport
            .lstat(&remote_script)
            .await
            .ok()
            .flatten()
            .is_some_and(|s| s.is_file && !s.is_symlink);
        let node_ver = remote.transport.capabilities().node_version.clone();
        return crate::ssh::remote_mcp::build_remote_agent_setup(
            &remote.target,
            &remote_home,
            &remote.remote_root,
            exists,
            remote_deployed,
            node_ver.as_deref(),
        );
    }
    tauri::async_runtime::spawn_blocking(move || {
        with_workspace_session(&workspace_id, app.state::<AppState>(), |s| {
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
            #[cfg(target_os = "linux")]
            let script = if exists {
                agent::persistent_mcp_script(&script, &app_data(&app)?)?
            } else {
                script
            };
            let plain = |p: &std::path::Path| {
                p.display()
                    .to_string()
                    .trim_start_matches("\\\\?\\")
                    .to_string()
            };
            Ok(
                serde_json::json!({"bundled": exists, "config": {"mcpServers": {"tano": {
                    "command": "node", "args": [plain(&script), "--workspace", plain(&s.root), "--data-dir", plain(&app_data(&app)?)]
                }}}}),
            )
        })
    })
    .await
    .map_err(|e| format!("读取 Agent 配置任务失败：{e}"))?
}

#[tauri::command]
pub(crate) async fn agent_changes(
    workspace_id: String,
    selected: Option<String>,
    app: tauri::AppHandle,
) -> Result<Vec<agent::Change>, String> {
    #[cfg(desktop)]
    if let Some(remote) = crate::remote_workspace_session(&workspace_id, &app.state::<AppState>())?
    {
        return crate::ssh::remote_mcp::read_remote_agent_changes(
            remote.transport.as_ref(),
            &remote.id,
            &remote.remote_root,
            selected.as_deref(),
        )
        .await;
    }
    tauri::async_runtime::spawn_blocking(move || {
        with_workspace_session(&workspace_id, app.state::<AppState>(), |s| {
            agent::changes(&app_data(&app)?, &s.id, &s.root, selected.as_deref())
        })
    })
    .await
    .map_err(|e| format!("读取 Agent 变更记录任务失败：{e}"))?
}
