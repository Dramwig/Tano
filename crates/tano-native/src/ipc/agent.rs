use crate::{agent, app_data, error::NativeError, with_workspace_session, AppState};
use std::path::PathBuf;
use tauri::{Manager, State};

#[tauri::command(async)]
pub(crate) fn open_workspace_terminal(
    workspace_id: String,
    state: State<AppState>,
) -> Result<(), String> {
    if cfg!(mobile) {
        return Err(NativeError::PlatformUnavailable("请在电脑端打开工作区终端").into());
    }
    with_workspace_session(&workspace_id, state, |s| agent::terminal(&s.root))
}

#[tauri::command(async)]
pub(crate) fn agent_setup(
    workspace_id: String,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<serde_json::Value, String> {
    if cfg!(mobile) {
        return Err(
            NativeError::PlatformUnavailable("本机 MCP 仅在桌面提供，请在电脑端使用").into(),
        );
    }
    with_workspace_session(&workspace_id, state, |s| {
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
}

#[tauri::command(async)]
pub(crate) fn agent_changes(
    workspace_id: String,
    selected: Option<String>,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<Vec<agent::Change>, String> {
    with_workspace_session(&workspace_id, state, |s| {
        agent::changes(&app_data(&app)?, &s.id, &s.root, selected.as_deref())
    })
}
