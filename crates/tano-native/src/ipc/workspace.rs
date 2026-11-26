use crate::{
    app_data, cache_path, error::NativeError, identity_manifest, mobile_storage, search,
    session_storage, storage, with_session, with_session_id_for_journal, with_workspace_session,
    workspace_identity, workspace_lock, ActiveSession, AppState, Session,
};
use notify::{RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager, State};

pub(crate) fn workspace_switch_blocked(app: &tauri::AppHandle) -> bool {
    // Auxiliary windows share the main workspace session. File and print windows
    // have their own storage and do not participate in workspace switching.
    app.webview_windows().keys().any(|label| {
        label != "main"
            && !label.starts_with("aux-")
            && !label.starts_with("file-")
            && !label.starts_with("print-")
    })
}

pub(crate) fn workspace_lock_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    #[cfg(desktop)]
    {
        Ok(workspace_lock::shared_directory(
            &app.path().data_dir().map_err(|e| e.to_string())?,
        ))
    }
    #[cfg(mobile)]
    {
        Ok(app_data(app)?.join("locks"))
    }
}

pub(crate) fn should_notify_workspace_change(relative: &Path) -> bool {
    relative.components().enumerate().all(|(index, component)| {
        let name = component.as_os_str().to_string_lossy();
        (index == 0 && name == ".tano") || !storage::ignored_workspace_name(&name)
    })
}

pub(crate) fn stop_workspace_plugin_calls(_app: &tauri::AppHandle) {
    // Cancel at the transition itself, so switching away and back between polling
    // ticks cannot revive a previous workspace's request or account login.
    #[cfg(desktop)]
    if let Some(state) = _app.try_state::<crate::plugin_native::PluginNativeState>() {
        state.stop_workspace();
    }
}

#[tauri::command]
pub(crate) async fn open_workspace(
    path: String,
    app: tauri::AppHandle,
) -> Result<storage::Workspace, String> {
    #[cfg(desktop)]
    if crate::ssh::uri::is_remote_workspace_uri(&path) {
        return crate::ssh::session::open_remote_workspace(path, app).await;
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        open_workspace_blocking(path, app.clone(), state)
    })
    .await
    .map_err(|e| format!("打开工作空间任务失败：{e}"))?
}

#[tauri::command(async)]
pub(crate) fn close_workspace(
    workspace_id: String,
    state: State<AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let mut guard = state.session.lock().map_err(|e| e.to_string())?;
    if guard
        .as_ref()
        .is_some_and(|session| session.id() == workspace_id)
    {
        if workspace_switch_blocked(&app) {
            return Err("请先关闭此工作区的独立窗口，再退出工作区".into());
        }
        stop_workspace_plugin_calls(&app);
        guard.take();
    }
    Ok(())
}

#[tauri::command(async)]
pub(crate) fn unregister_workspace(
    workspace_id: String,
    state: State<AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let mut guard = state.session.lock().map_err(|e| e.to_string())?;
    let active = guard.as_ref().ok_or(NativeError::WorkspaceNotOpen)?;
    if active.id() != workspace_id {
        return Err(NativeError::WorkspaceSwitched("工作区已切换，请重新确认删除注册").into());
    }
    match active {
        ActiveSession::Local(session) => {
            session_storage::unregister(
                &cache_path(&app)?,
                &app_data(&app)?,
                &session.root,
                &session.id,
            )?;
        }
        #[cfg(desktop)]
        ActiveSession::Remote(remote) => {
            session_storage::unregister_remote(&cache_path(&app)?, &remote.id, &remote.uri)?;
        }
    }
    stop_workspace_plugin_calls(&app);
    guard.take();
    Ok(())
}

fn open_workspace_blocking(
    path: String,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<storage::Workspace, String> {
    let mut guard = state.session.lock().map_err(|e| e.to_string())?;
    let root = std::fs::canonicalize(&path)
        .map_err(|e| format!("无法打开工作文件夹，请确认目录仍然存在：{e}"))?;
    #[cfg(mobile)]
    let root = mobile_storage::validate(&app_data(&app)?, &root)?;
    if !root.is_dir() {
        return Err(NativeError::InvalidPath("请选择一个文件夹").into());
    }
    let newly_created = storage::existing_workspace_identity(&root)?.is_none();
    if let Some(active) = guard.as_ref() {
        if let ActiveSession::Local(session) = active {
            if session.root == root && !newly_created {
                identity_manifest::require(&root, &session.id)?;
                return storage::scan(&root, &session.id, &cache_path(&app)?);
            }
        }
        if workspace_switch_blocked(&app) {
            return Err("请先关闭此工作区的独立窗口，再切换工作区".into());
        }
    }
    let data = app_data(&app)?;
    let registered = workspace_identity::registered_identity(&data, &root)?;
    let recent_id = if registered.is_none() {
        guard
            .as_ref()
            .and_then(|active| match active {
                ActiveSession::Local(session) if session.root == root => Some(session.id.clone()),
                _ => None,
            })
            .or(session_storage::known_identity(&cache_path(&app)?, &root)?)
    } else {
        None
    };
    let reinitialized = newly_created && (registered.is_some() || recent_id.is_some());
    let id = workspace_identity::identity_for_open(
        &data,
        &root,
        recent_id.as_deref(),
        &cache_path(&app)?,
    )?;
    let reuse_lock = guard.as_ref().is_some_and(|session| session.id() == id);
    let lock = if reuse_lock {
        None
    } else {
        Some(workspace_lock::acquire(
            &workspace_lock_directory(&app)?,
            &id,
        )?)
    };
    storage::assert_workspace_identity(&root, &id)?;
    let mut workspace = storage::scan(&root, &id, &cache_path(&app)?)?;
    workspace.newly_created = newly_created.then_some(true);
    workspace.reinitialized = reinitialized.then_some(true);
    let handle = app.clone();
    let watch_root = root.clone();
    let mut watcher = notify::recommended_watcher(
        move |event: Result<notify::Event, notify::Error>| match event {
            Ok(event) => {
                if matches!(event.kind, notify::EventKind::Access(_)) {
                    return;
                }
                if event.paths.iter().any(|path| {
                    path.strip_prefix(&watch_root)
                        .is_ok_and(should_notify_workspace_change)
                }) {
                    let _ = handle.emit("workspace-changed", ());
                }
            }
            Err(error) => {
                let _ = handle.emit("workspace-watch-error", error.to_string());
            }
        },
    )
    .map_err(|e| e.to_string())?;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
    session_storage::record(&cache_path(&app)?, &workspace)?;
    workspace_identity::register_identity(&data, &root, &id)?;
    let lock = match lock {
        Some(lock) => lock,
        None => match guard.take().ok_or("工作区会话已关闭")? {
            ActiveSession::Local(local) => local._lock,
            #[cfg(desktop)]
            ActiveSession::Remote(_) => {
                workspace_lock::acquire(&workspace_lock_directory(&app)?, &id)?
            }
        },
    };
    stop_workspace_plugin_calls(&app);
    *guard = Some(ActiveSession::Local(Session {
        root_key: storage::native_key(&root),
        root,
        id,
        _watcher: watcher,
        _lock: lock,
    }));
    Ok(workspace)
}

#[tauri::command]
pub(crate) async fn refresh_workspace(app: tauri::AppHandle) -> Result<storage::Workspace, String> {
    #[cfg(desktop)]
    if let Some(remote) = crate::remote_session(&app.state::<AppState>()) {
        let cache = cache_path(&app)?;
        let latency = remote.latency_ms.load(std::sync::atomic::Ordering::Relaxed);
        return crate::ssh::storage::remote_scan(
            remote.transport.as_ref(),
            &remote.remote_root,
            &remote.uri,
            &remote.host_id,
            &remote.host_label,
            &remote.id,
            &cache,
            Some(latency),
        )
        .await;
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        with_session(state, |s| storage::scan(&s.root, &s.id, &cache_path(&app)?))
    })
    .await
    .map_err(|e| format!("刷新工作空间任务失败：{e}"))?
}

#[tauri::command]
pub(crate) async fn search_documents(
    workspace_id: String,
    query: String,
    app: tauri::AppHandle,
) -> Result<Vec<search::SearchHit>, String> {
    #[cfg(desktop)]
    if let Some(remote) = crate::remote_workspace_session(&workspace_id, &app.state::<AppState>())?
    {
        let cache = cache_path(&app)?;
        let mut hits = search::query(&cache, &remote.id, &query)?;
        if let Ok(remote_hits) = crate::ssh::remote_search::remote_search(
            remote.transport.as_ref(),
            &remote.remote_root,
            &remote.id,
            &cache,
            &query,
        )
        .await
        {
            let mut seen: std::collections::HashSet<String> =
                hits.iter().map(|h| h.path.clone()).collect();
            for hit in remote_hits {
                if hits.len() >= 80 {
                    break;
                }
                if seen.insert(hit.path.clone()) {
                    hits.push(hit);
                }
            }
        }
        return Ok(hits);
    }
    tauri::async_runtime::spawn_blocking(move || {
        with_workspace_session(&workspace_id, app.state::<AppState>(), |s| {
            search::query(&cache_path(&app)?, &s.id, &query)
        })
    })
    .await
    .map_err(|e| format!("搜索文档任务失败：{e}"))?
}

#[tauri::command(async)]
pub(crate) fn recent_workspaces(
    app: tauri::AppHandle,
) -> Result<Vec<session_storage::RecentWorkspace>, String> {
    let recent = session_storage::recent(&cache_path(&app)?)?;
    #[cfg(mobile)]
    let data = app_data(&app)?;
    #[cfg(mobile)]
    let recent = recent
        .into_iter()
        .filter(|entry| mobile_storage::validate(&data, std::path::Path::new(&entry.path)).is_ok())
        .collect();
    Ok(recent)
}

#[tauri::command]
pub(crate) async fn open_mobile_workspace(
    name: Option<String>,
    app: tauri::AppHandle,
) -> Result<storage::Workspace, String> {
    if !cfg!(mobile) {
        return Err(NativeError::PlatformUnavailable("仅在移动应用中创建沙箱空间").into());
    }
    let data = app_data(&app)?;
    let path = match name {
        Some(name) => mobile_storage::create(&data, &name)?,
        None => mobile_storage::default_workspace(&data)?,
    };
    open_workspace(path.to_string_lossy().to_string(), app).await
}

#[tauri::command(async)]
pub(crate) fn mobile_recycled(
    workspace_id: String,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<Vec<mobile_storage::RecycledFile>, String> {
    if !cfg!(mobile) {
        return Err(NativeError::PlatformUnavailable("桌面端请使用系统回收站").into());
    }
    with_workspace_session(&workspace_id, state, |s| {
        mobile_storage::recycled(&app_data(&app)?, &s.id)
    })
}

#[tauri::command(async)]
pub(crate) fn mobile_recover(
    workspace_id: String,
    id: String,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<String, String> {
    if !cfg!(mobile) {
        return Err(NativeError::PlatformUnavailable("桌面端请使用系统回收站").into());
    }
    with_workspace_session(&workspace_id, state, |s| {
        mobile_storage::recover(&app_data(&app)?, &s.root, &s.id, &id)
    })
}

#[tauri::command(async)]
pub(crate) fn load_session(
    workspace_id: String,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<Option<session_storage::WorkspaceSession>, String> {
    with_session_id_for_journal(state, |id| {
        if id != workspace_id {
            return Err(NativeError::WorkspaceSwitched("会话所属工作区已切换").into());
        }
        session_storage::load(&app_data(&app)?, id)
    })
}

#[tauri::command(async)]
pub(crate) fn save_session(
    workspace_id: String,
    session: session_storage::WorkspaceSession,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    with_session_id_for_journal(state, |id| {
        if id != workspace_id {
            return Err(NativeError::WorkspaceSwitched("会话所属工作区已切换").into());
        }
        session_storage::save(&app_data(&app)?, id, &session)
    })
}

#[cfg(test)]
mod watcher_path_tests {
    use super::should_notify_workspace_change;
    use std::path::Path;

    #[test]
    fn refreshes_for_identity_metadata_but_ignores_old_hidden_data() {
        for path in [
            ".tano",
            ".tano/config.json",
            ".tano/identities.json",
            "note.md",
        ] {
            assert!(should_notify_workspace_change(Path::new(path)), "{path}");
        }
        for path in [
            ".workspace/objects/old.tano.json",
            ".git/HEAD",
            "node_modules/package/index.js",
            "nested/target/debug/app.exe",
            "dist/index.html",
            ".tano/.tano-temporary",
            "notes/.draft.md",
        ] {
            assert!(!should_notify_workspace_change(Path::new(path)), "{path}");
        }
    }
}
