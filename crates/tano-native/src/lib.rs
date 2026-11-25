#[path = "assistant/agent.rs"]
mod agent;
#[cfg(desktop)]
mod assistant;
#[path = "assistant/files.rs"]
mod assistant_files;
pub mod error;
#[cfg(desktop)]
mod import;
mod ipc;
#[cfg(desktop)]
pub mod mail;
mod plans;
#[cfg(desktop)]
mod plugins;
pub mod storage;
#[cfg(test)]
mod tests;
mod updates;
mod window;
mod workspace;

// Preserve public module paths and concise internal module aliases.
#[cfg(desktop)]
pub use window::auxiliary as auxiliary_windows;
pub use workspace::identity_manifest;

#[cfg(desktop)]
pub(crate) use assistant::cli as assistant_cli;
#[cfg(desktop)]
pub(crate) use import::connections as import_connections;
#[cfg(desktop)]
pub(crate) use plans::connections as plan_connections;
pub(crate) use plans::personal as personal_plans;
#[cfg(desktop)]
pub(crate) use plugins::{
    connections as plugin_connections, native as plugin_native, oauth as plugin_oauth,
};
pub(crate) use storage::{assets, mobile as mobile_storage, search, session as session_storage};
pub(crate) use window::printing;
#[cfg(windows)]
pub(crate) use window::tab_drag_preview;
#[cfg(desktop)]
pub(crate) use workspace::git as workspace_git;
#[cfg(desktop)]
pub(crate) use workspace::sync as workspace_sync;
pub(crate) use workspace::{identity as workspace_identity, lock as workspace_lock};

use error::NativeError;
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{Manager, State};

pub struct Session {
    pub root: PathBuf,
    pub id: String,
    pub(crate) root_key: String,
    pub(crate) _watcher: notify::RecommendedWatcher,
    pub(crate) _lock: std::fs::File,
}

#[derive(Default)]
pub struct AppState {
    pub(crate) session: Mutex<Option<Session>>,
}

pub(crate) fn with_session<T>(
    state: State<AppState>,
    f: impl FnOnce(&Session) -> Result<T, String>,
) -> Result<T, String> {
    // Every command using this lock must dispatch off the window thread. Opening
    // a workspace holds it during scanning; a synchronous IPC/asset callback
    // waiting here would stall the WebView and all window events.
    let guard = state.session.lock().map_err(|e| e.to_string())?;
    let session = guard.as_ref().ok_or(NativeError::WorkspaceNotOpen)?;
    if !session.root_key.is_empty() && storage::native_key(&session.root) != session.root_key {
        return Err(NativeError::WorkspaceSwitched("工作区根目录已替换，请重新打开工作区").into());
    }
    identity_manifest::require(&session.root, &session.id)?;
    f(session)
}

pub(crate) fn with_session_for_journal<T>(
    state: State<AppState>,
    f: impl FnOnce(&Session) -> Result<T, String>,
) -> Result<T, String> {
    let guard = state.session.lock().map_err(|e| e.to_string())?;
    f(guard.as_ref().ok_or(NativeError::WorkspaceNotOpen)?)
}

pub fn cache_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("index.sqlite"))
}

pub fn with_workspace_session<T>(
    workspace_id: &str,
    state: State<AppState>,
    f: impl FnOnce(&Session) -> Result<T, String>,
) -> Result<T, String> {
    with_session(state, |session| {
        if session.id != workspace_id {
            return Err(NativeError::WorkspaceSwitched("所属工作空间已切换，操作已取消").into());
        }
        f(session)
    })
}

pub fn with_workspace_mutating_session<T>(
    workspace_id: &str,
    state: State<AppState>,
    _app: &tauri::AppHandle,
    f: impl FnOnce(&Session) -> Result<T, String>,
) -> Result<T, String> {
    with_workspace_session(workspace_id, state, f)
}

/// Called under the workspace session lock before a cloud adapter applies local files.
pub fn assert_cloud_sync_available(data: &Path, workspace_id: &str) -> Result<(), String> {
    let path = data
        .join("workspace-sync")
        .join(workspace_id)
        .join("state.json");
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    let state: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| "同步配置损坏，已停止云端写入")?;
    match state.get("backend") {
        Some(serde_json::Value::Null) => Ok(()),
        Some(serde_json::Value::String(backend)) if backend == "cloud" => Ok(()),
        _ => Err("当前工作区由 Git 同步，已阻止云端文件写入".into()),
    }
}

pub fn app_data(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    Ok(directory)
}

pub fn configure(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    configure_with_commands(builder, &[], |_| false)
}

/// Compose host commands with the local command router without replacing it.
pub fn configure_with_commands(
    builder: tauri::Builder<tauri::Wry>,
    commands: &'static [&'static str],
    extra: impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static,
) -> tauri::Builder<tauri::Wry> {
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    #[cfg(desktop)]
    let builder = builder.manage(assistant::AssistantState::default());
    #[cfg(desktop)]
    let builder = builder.manage(plugin_native::PluginNativeState::default());
    #[cfg(desktop)]
    let builder = builder.manage(plugin_oauth::PluginOAuthState::default());
    #[cfg(desktop)]
    let builder = builder.manage(mail::MailState::default());
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState::default())
        .manage(updates::UpdateState::default())
        .on_window_event(|window, event| {
            #[cfg(desktop)]
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window
                    .state::<assistant::AssistantState>()
                    .stop_window(window.label());
                window
                    .state::<plugin_native::PluginNativeState>()
                    .stop_window(window.label());
            }
        })
        .register_asynchronous_uri_scheme_protocol("tano-asset", |context, request, responder| {
            let app = context.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                let state = app.state::<AppState>();
                let response = match state.session.lock() {
                    Ok(guard) if guard.is_some() => {
                        let session = guard.as_ref().unwrap();
                        assets::respond(&session.root, &session.id, &request)
                    }
                    _ => tauri::http::Response::builder()
                        .status(404)
                        .body(b"No workspace".to_vec())
                        .expect("static response"),
                };
                responder.respond(response);
            });
        })
        .invoke_handler(move |invoke| ipc::dispatch(invoke, commands, &extra))
}
