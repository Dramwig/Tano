mod agent;
mod assets;
pub mod identity_manifest;
mod mobile_storage;
#[cfg(test)]
mod performance;
mod search;
mod session_storage;
pub mod storage;
mod updates;
mod workspace_archive;
mod workspace_backup;
mod workspace_lock;
mod workspace_recovery;

use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{Emitter, Manager, State};

pub struct Session {
    pub root: PathBuf,
    pub id: String,
    data: PathBuf,
    _watcher: notify::RecommendedWatcher,
    _lock: std::fs::File,
}

#[derive(Default)]
pub struct AppState {
    session: Mutex<Option<Session>>,
}

fn workspace_lock_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
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

fn should_notify_workspace_change(relative: &Path) -> bool {
    let path = relative.to_string_lossy().replace('\\', "/");
    path == ".tano"
        || path.starts_with(".tano/")
        || !relative
            .components()
            .any(|component| component.as_os_str().to_string_lossy().starts_with('.'))
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
        for path in [".workspace/objects/old.tano.json", ".git/HEAD"] {
            assert!(!should_notify_workspace_change(Path::new(path)), "{path}");
        }
    }
}

fn with_session<T>(
    state: State<AppState>,
    f: impl FnOnce(&Session) -> Result<T, String>,
) -> Result<T, String> {
    let guard = state.session.lock().map_err(|e| e.to_string())?;
    let session = guard.as_ref().ok_or("请先打开一个工作空间")?;
    if workspace_backup::pending_restore(&session.data, &session.root, &session.id)?.is_some() {
        return Err("工作区恢复尚未完成，请继续上一次恢复".into());
    }
    identity_manifest::require(&session.root, &session.id)?;
    f(session)
}

fn with_mutating_session<T>(
    state: State<AppState>,
    app: &tauri::AppHandle,
    f: impl FnOnce(&Session) -> Result<T, String>,
) -> Result<T, String> {
    with_session(state, |session| {
        let result = f(session)?;
        if let Err(error) = workspace_backup::create(&session.data, &session.root, &session.id) {
            let _ = app.emit("workspace-backup-error", format!("自动备份未完成：{error}"));
        }
        Ok(result)
    })
}

fn with_session_for_recovery<T>(
    state: State<AppState>,
    f: impl FnOnce(&Session) -> Result<T, String>,
) -> Result<T, String> {
    let guard = state.session.lock().map_err(|e| e.to_string())?;
    f(guard.as_ref().ok_or("请先打开一个工作空间")?)
}

pub fn cache_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("index.sqlite"))
}

#[tauri::command]
async fn open_workspace(path: String, app: tauri::AppHandle) -> Result<storage::Workspace, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        open_workspace_blocking(path, app.clone(), state)
    })
    .await
    .map_err(|e| format!("打开工作空间任务失败：{e}"))?
}

#[tauri::command]
fn close_workspace(
    workspace_id: String,
    state: State<AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let mut guard = state.session.lock().map_err(|e| e.to_string())?;
    if guard
        .as_ref()
        .is_some_and(|session| session.id == workspace_id)
    {
        if app.webview_windows().len() > 1 {
            return Err("请先关闭此工作区的独立窗口，再退出工作区".into());
        }
        guard.take();
    }
    Ok(())
}

fn open_workspace_blocking(
    path: String,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<storage::Workspace, String> {
    let mut guard = state.session.lock().map_err(|e| e.to_string())?;
    let root = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;
    #[cfg(mobile)]
    let root = mobile_storage::validate(&app_data(&app)?, &root)?;
    if !root.is_dir() {
        return Err("请选择一个文件夹".into());
    }
    if let Some(session) = guard.as_ref() {
        if session.root == root {
            if workspace_backup::pending_restore(&session.data, &root, &session.id)?.is_some() {
                return Err("工作区恢复尚未完成，请继续上一次恢复".into());
            }
            identity_manifest::require(&root, &session.id)?;
            let mut workspace = storage::scan(&root, &session.id, &cache_path(&app)?)?;
            if let Err(error) = workspace_backup::create(&session.data, &root, &session.id) {
                workspace.backup_warning = Some(format!("自动备份未完成：{error}"));
            }
            return Ok(workspace);
        }
        if app.webview_windows().len() > 1 {
            return Err("请先关闭此工作区的独立窗口，再切换工作区".into());
        }
    }
    let data = app_data(&app)?;
    let recent_id = if workspace_recovery::registered_identity(&data, &root)?.is_none() {
        session_storage::known_identity(&cache_path(&app)?, &root)?
    } else {
        None
    };
    let id = workspace_recovery::identity_for_open(
        &data,
        &root,
        recent_id.as_deref(),
        &cache_path(&app)?,
    )?;
    let reuse_lock = guard.as_ref().is_some_and(|session| session.id == id);
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
    workspace_recovery::register_identity(&data, &root, &id)?;
    if let Err(error) = workspace_backup::create(&data, &root, &id) {
        workspace.backup_warning = Some(format!("自动备份未完成：{error}"));
    }
    let lock = match lock {
        Some(lock) => lock,
        None => guard.take().ok_or("工作区会话已关闭")?._lock,
    };
    *guard = Some(Session {
        root,
        id,
        data,
        _watcher: watcher,
        _lock: lock,
    });
    Ok(workspace)
}

#[tauri::command]
async fn refresh_workspace(app: tauri::AppHandle) -> Result<storage::Workspace, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        with_session(state, |s| {
            let mut workspace = storage::scan(&s.root, &s.id, &cache_path(&app)?)?;
            if let Err(error) = workspace_backup::create(&app_data(&app)?, &s.root, &s.id) {
                workspace.backup_warning = Some(format!("自动备份未完成：{error}"));
            }
            Ok(workspace)
        })
    })
    .await
    .map_err(|e| format!("刷新工作空间任务失败：{e}"))?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceBackupCatalog {
    path: String,
    workspace_id: String,
    snapshots: Vec<workspace_backup::BackupSummary>,
    pending_restore: Option<String>,
}

fn backup_identity(app: &tauri::AppHandle, root: &std::path::Path) -> Result<String, String> {
    if let Some(id) = workspace_recovery::registered_identity(&app_data(app)?, root)? {
        return Ok(id);
    }
    session_storage::known_identity(&cache_path(app)?, root)?
        .ok_or_else(|| "此文件夹没有可识别的本机工作区登记".into())
}

#[tauri::command]
async fn workspace_backup_catalog(
    path: String,
    app: tauri::AppHandle,
) -> Result<WorkspaceBackupCatalog, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;
        let id = backup_identity(&app, &root)?;
        let data = app_data(&app)?;
        Ok(WorkspaceBackupCatalog {
            path: root.to_string_lossy().into_owned(),
            workspace_id: id.clone(),
            snapshots: workspace_backup::list(&data, &root, &id)?,
            pending_restore: workspace_backup::pending_restore(&data, &root, &id)?,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn workspace_backup_preview(
    path: String,
    snapshot_id: String,
    app: tauri::AppHandle,
) -> Result<workspace_backup::RecoveryPreview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;
        let id = backup_identity(&app, &root)?;
        workspace_backup::preview(&app_data(&app)?, &root, &id, &snapshot_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn restore_workspace_backup(
    path: String,
    snapshot_id: String,
    current_fingerprint: Option<String>,
    app: tauri::AppHandle,
) -> Result<storage::Workspace, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;
        let id = backup_identity(&app, &root)?;
        let state = app.state::<AppState>();
        let guard = state.session.lock().map_err(|e| e.to_string())?;
        if guard
            .as_ref()
            .is_some_and(|session| session.root == root && session.id != id)
        {
            return Err("当前会话的工作区身份与备份不同".into());
        }
        let _lock = if guard.as_ref().is_some_and(|session| session.root == root) {
            None
        } else {
            Some(workspace_lock::acquire(
                &workspace_lock_directory(&app)?,
                &id,
            )?)
        };
        let workspace = workspace_backup::restore(
            &app_data(&app)?,
            &root,
            &id,
            &snapshot_id,
            current_fingerprint.as_deref(),
            &cache_path(&app)?,
        )?;
        session_storage::record(&cache_path(&app)?, &workspace)?;
        Ok(workspace)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn export_workspace(
    destination_parent: String,
    app: tauri::AppHandle,
) -> Result<workspace_archive::ArchiveResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        with_mutating_session(state, &app, |session| {
            storage::scan(&session.root, &session.id, &cache_path(&app)?)?;
            workspace_archive::export(
                &session.root,
                &session.id,
                std::path::Path::new(&destination_parent),
            )
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn import_workspace_export(
    source: String,
    destination_parent: String,
) -> Result<workspace_archive::ArchiveResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        workspace_archive::import(
            std::path::Path::new(&source),
            std::path::Path::new(&destination_parent),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn search_documents(
    workspace_id: String,
    query: String,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<Vec<search::SearchHit>, String> {
    with_workspace_session(&workspace_id, state, |s| {
        search::query(&cache_path(&app)?, &s.id, &query)
    })
}

#[tauri::command]
fn recent_workspaces(
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
fn runtime_platform() -> serde_json::Value {
    serde_json::json!({"mobile": cfg!(mobile), "os": std::env::consts::OS})
}

#[tauri::command]
async fn tab_drag_release() -> Result<serde_json::Value, String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(|| {
            use windows_sys::Win32::Foundation::POINT;
            use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
            use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;

            // The WebView may not dispatch dragend after an OS drag ends outside its window.
            // Observe the button on a host thread so renderer timer throttling cannot lose it.
            while unsafe { GetAsyncKeyState(VK_LBUTTON.into()) < 0 } {
                std::thread::sleep(std::time::Duration::from_millis(8));
            }
            let mut point = POINT { x: 0, y: 0 };
            if unsafe { GetCursorPos(&mut point) } == 0 {
                return Err(std::io::Error::last_os_error().to_string());
            }
            Ok(serde_json::json!({"x": point.x, "y": point.y}))
        })
        .await
        .map_err(|error| error.to_string())?
    }
    #[cfg(not(windows))]
    {
        Err("Tab drag release observation is only available on Windows".to_owned())
    }
}

#[tauri::command]
async fn open_mobile_workspace(
    name: Option<String>,
    app: tauri::AppHandle,
) -> Result<storage::Workspace, String> {
    if !cfg!(mobile) {
        return Err("仅在移动应用中创建沙箱空间".into());
    }
    let data = app_data(&app)?;
    let path = match name {
        Some(name) => mobile_storage::create(&data, &name)?,
        None => mobile_storage::default_workspace(&data)?,
    };
    open_workspace(path.to_string_lossy().to_string(), app).await
}

#[tauri::command]
fn mobile_recycled(
    workspace_id: String,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<Vec<mobile_storage::RecycledFile>, String> {
    if !cfg!(mobile) {
        return Err("桌面端请使用系统回收站".into());
    }
    with_workspace_session(&workspace_id, state, |s| {
        mobile_storage::recycled(&app_data(&app)?, &s.id)
    })
}

#[tauri::command]
fn mobile_recover(
    workspace_id: String,
    id: String,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<String, String> {
    if !cfg!(mobile) {
        return Err("桌面端请使用系统回收站".into());
    }
    with_workspace_session(&workspace_id, state, |s| {
        mobile_storage::recover(&app_data(&app)?, &s.root, &s.id, &id)
    })
}
#[tauri::command]
fn load_session(
    workspace_id: String,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<Option<session_storage::WorkspaceSession>, String> {
    with_session_for_recovery(state, |s| {
        if s.id != workspace_id {
            return Err("会话所属工作区已切换".into());
        }
        session_storage::load(&app_data(&app)?, &s.id)
    })
}
#[tauri::command]
fn save_session(
    workspace_id: String,
    session: session_storage::WorkspaceSession,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    with_session_for_recovery(state, |s| {
        if s.id != workspace_id {
            return Err("会话所属工作区已切换".into());
        }
        session_storage::save(&app_data(&app)?, &s.id, &session)
    })
}

#[tauri::command]
fn import_attachment(
    workspace_id: String,
    name: String,
    content: String,
    require_image: bool,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<assets::ImportedAsset, String> {
    use base64::Engine;
    if content.len() > 70 * 1024 * 1024 {
        return Err("附件过大".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(content)
        .map_err(|_| "附件编码无效")?;
    with_workspace_mutating_session(&workspace_id, state, &app, |s| {
        assets::import(
            &s.root,
            &name,
            &bytes,
            require_image,
            Some((&s.id, &cache_path(&app)?)),
        )
    })
}

#[tauri::command]
fn export_attachment(
    workspace_id: String,
    path: String,
    destination: String,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    with_workspace_session(&workspace_id, state, |s| {
        let bytes = assets::read(&s.root, &path)?;
        #[cfg(mobile)]
        {
            use std::io::Write;
            use tauri_plugin_fs::FsExt;
            let destination: tauri_plugin_fs::FilePath = destination
                .parse()
                .map_err(|e| format!("无效导出位置：{e}"))?;
            #[cfg(target_os = "android")]
            if !matches!(&destination, tauri_plugin_fs::FilePath::Url(url) if url.scheme() == "content")
            {
                return Err("请通过 Android 文件选择器选择导出位置".into());
            }
            #[cfg(target_os = "ios")]
            {
                let target = destination.clone().into_path().map_err(|e| e.to_string())?;
                let parent = std::fs::canonicalize(target.parent().ok_or("导出路径无效")?)
                    .map_err(|e| e.to_string())?;
                if parent
                    .starts_with(std::fs::canonicalize(app_data(&app)?).map_err(|e| e.to_string())?)
                {
                    return Err("请选择工作空间之外的导出位置".into());
                }
            }
            let mut options = tauri_plugin_fs::OpenOptions::new();
            options.write(true).truncate(true).create(true);
            let result = (|| {
                let mut file = app
                    .fs()
                    .open(destination.clone(), options)
                    .map_err(|e| e.to_string())?;
                file.write_all(&bytes).map_err(|e| e.to_string())?;
                file.sync_all().map_err(|e| e.to_string())
            })();
            #[cfg(target_os = "ios")]
            let _ = app
                .fs()
                .stop_accessing_security_scoped_resource(destination);
            result
        }
        #[cfg(desktop)]
        {
            let _ = app;
            let target = PathBuf::from(destination);
            if !target.is_absolute() {
                return Err("请选择完整的保存路径".into());
            }
            storage::create_atomic(&target, &bytes)
                .map_err(|e| format!("无法导出；请使用尚未存在的文件名：{e}"))
        }
    })
}

#[tauri::command]
fn open_external_url(url: String, app: tauri::AppHandle) -> Result<(), String> {
    let parsed = validated_external_url(&url)?;
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|e| e.to_string())
}

fn validated_external_url(url: &str) -> Result<tauri::Url, String> {
    let parsed = tauri::Url::parse(url).map_err(|_| "链接地址无效")?;
    match parsed.scheme() {
        "http" | "https" if parsed.username().is_empty() && parsed.password().is_none() => {}
        "mailto" => {
            let address = parsed.path();
            let valid_address = address.split_once('@').is_some_and(|(local, domain)| {
                !local.is_empty()
                    && !domain.is_empty()
                    && !domain.contains('@')
                    && address.bytes().all(|byte| {
                        byte.is_ascii_alphanumeric()
                            || matches!(byte, b'@' | b'.' | b'_' | b'+' | b'-')
                    })
            });
            if !valid_address || parsed.query().is_some() || parsed.fragment().is_some() {
                return Err("邮箱链接仅支持单个有效地址".into());
            }
        }
        _ => return Err("外部链接只支持 HTTP、HTTPS 和 mailto 地址".into()),
    }
    Ok(parsed)
}

#[cfg(test)]
mod external_url_tests {
    use super::validated_external_url;

    #[test]
    fn accepts_web_and_email_links() {
        assert!(validated_external_url("https://example.com/path").is_ok());
        assert!(validated_external_url("mailto:test+tag@example.com").is_ok());
    }

    #[test]
    fn rejects_unsafe_or_ambiguous_external_links() {
        for url in [
            "javascript:alert(1)",
            "https://user:secret@example.com",
            "mailto:test@example.com?subject=hello",
            "mailto:test%0a@example.com",
            "mailto:test@example.com,other@example.com",
        ] {
            assert!(validated_external_url(url).is_err(), "{url}");
        }
    }
}

#[tauri::command]
fn read_document(path: String, state: State<AppState>) -> Result<storage::Snapshot, String> {
    with_session(state, |s| {
        storage::read(&storage::resolve_storage(&s.root, &path, true)?)
    })
}

#[tauri::command]
fn write_document(
    path: String,
    content: String,
    expected_hash: String,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<storage::WriteResult, String> {
    let workspace_data = storage::is_workspace_data_path(&path);
    let write = |s: &Session| {
        let target = storage::resolve_storage(&s.root, &path, false)?;
        storage::write(&target, &content, &expected_hash)
    };
    if workspace_data {
        with_mutating_session(state, &app, write)
    } else {
        with_session(state, write)
    }
}

#[tauri::command]
fn reserve_reference_id(
    app: tauri::AppHandle,
    occupied: Vec<String>,
    state: State<AppState>,
) -> Result<String, String> {
    with_mutating_session(state, &app, |s| {
        identity_manifest::reserve(&s.root, &s.id, &cache_path(&app)?, &occupied)
    })
}

#[tauri::command]
fn create_document(
    path: String,
    content: String,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    with_mutating_session(state, &app, |s| {
        let target = if storage::is_workspace_data_path(&path) {
            storage::ensure_file_parent(&s.root, &path)?
        } else {
            storage::resolve(&s.root, &path, false)?
        };
        let cache = cache_path(&app)?;
        identity_manifest::begin_create(&s.root, &s.id, &cache, &path, content.as_bytes())?;
        if let Err(error) = storage::create(&target, &content) {
            let _ = identity_manifest::recover_mutation(&s.root, &s.id, &cache);
            return Err(error);
        }
        identity_manifest::recover_mutation(&s.root, &s.id, &cache)
    })
}

#[tauri::command]
fn create_folder(path: String, state: State<AppState>) -> Result<(), String> {
    with_session(state, |s| {
        std::fs::create_dir(storage::resolve(&s.root, &path, false)?).map_err(|e| e.to_string())
    })
}

#[tauri::command]
fn rename_document(
    from: String,
    to: String,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    with_mutating_session(state, &app, |s| {
        storage::rename(&s.root, &s.id, &from, &to, &cache_path(&app)?)
    })
}

#[tauri::command]
fn move_entry(
    from: String,
    to: String,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    with_mutating_session(state, &app, |s| {
        storage::move_entry(&s.root, &s.id, &from, &to, &cache_path(&app)?)
    })
}

#[tauri::command]
fn remove_document(
    path: String,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    with_mutating_session(state, &app, |s| {
        let target = storage::resolve_storage(&s.root, &path, true)?;
        #[cfg(mobile)]
        if !target.is_file() {
            return Err("手机回收站暂不支持文件夹".into());
        }
        let cache = cache_path(&app)?;
        identity_manifest::begin_delete(&s.root, &s.id, &cache, &path)?;
        #[cfg(desktop)]
        {
            if let Err(error) = trash::delete(target) {
                let _ = identity_manifest::recover_mutation(&s.root, &s.id, &cache);
                return Err(error.to_string());
            }
        }
        #[cfg(mobile)]
        {
            if let Err(error) = mobile_storage::recycle(&app_data(&app)?, &s.root, &s.id, &path) {
                let _ = identity_manifest::recover_mutation(&s.root, &s.id, &cache);
                return Err(error);
            }
        }
        identity_manifest::recover_mutation(&s.root, &s.id, &cache)
    })
}

#[tauri::command]
fn reveal_workspace(state: State<AppState>) -> Result<(), String> {
    #[cfg(mobile)]
    {
        let _ = state;
        return Err("手机空间保存在应用沙箱中".into());
    }
    #[cfg(desktop)]
    with_session(state, |s| {
        #[cfg(windows)]
        let command = "explorer";
        #[cfg(target_os = "macos")]
        let command = "open";
        #[cfg(all(unix, not(target_os = "macos")))]
        let command = "xdg-open";
        std::process::Command::new(command)
            .arg(&s.root)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[tauri::command]
fn open_workspace_entry(
    workspace_id: String,
    path: String,
    reveal: bool,
    state: State<AppState>,
) -> Result<(), String> {
    #[cfg(mobile)]
    {
        let _ = (workspace_id, path, reveal, state);
        return Err("请在桌面端打开工作区文件".into());
    }
    #[cfg(desktop)]
    with_workspace_session(&workspace_id, state, |s| {
        let target = storage::resolve(&s.root, &path, true)?;
        if reveal {
            tauri_plugin_opener::reveal_item_in_dir(&target)
        } else {
            tauri_plugin_opener::open_path(&target, None::<&str>)
        }
        .map_err(|e| e.to_string())
    })
}

#[tauri::command]
fn workspace_entry_path(
    workspace_id: String,
    path: String,
    state: State<AppState>,
) -> Result<String, String> {
    #[cfg(mobile)]
    {
        let _ = (workspace_id, path, state);
        return Err("请在桌面端复制工作区文件路径".into());
    }
    #[cfg(desktop)]
    with_workspace_session(&workspace_id, state, |s| {
        storage::resolve(&s.root, &path, true)?
            .into_os_string()
            .into_string()
            .map_err(|_| "文件路径包含无法复制的字符".into())
    })
}

#[tauri::command]
fn duplicate_workspace_entry(
    workspace_id: String,
    path: String,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<String, String> {
    with_workspace_mutating_session(&workspace_id, state, &app, |s| {
        let duplicate = storage::duplicate_entry(&s.root, &path)?;
        storage::scan(&s.root, &s.id, &cache_path(&app)?)?;
        Ok(duplicate)
    })
}

#[tauri::command]
fn open_workspace_terminal(workspace_id: String, state: State<AppState>) -> Result<(), String> {
    if cfg!(mobile) {
        return Err("请在电脑端打开工作区终端".into());
    }
    with_workspace_session(&workspace_id, state, |s| agent::terminal(&s.root))
}

#[tauri::command]
fn agent_setup(
    workspace_id: String,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<serde_json::Value, String> {
    if cfg!(mobile) {
        return Err("本机 MCP 仅在桌面提供，请在电脑端使用".into());
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

#[tauri::command]
fn agent_changes(
    workspace_id: String,
    selected: Option<String>,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<Vec<agent::Change>, String> {
    with_workspace_session(&workspace_id, state, |s| {
        agent::changes(&app_data(&app)?, &s.id, &s.root, selected.as_deref())
    })
}

pub fn with_workspace_session<T>(
    workspace_id: &str,
    state: State<AppState>,
    f: impl FnOnce(&Session) -> Result<T, String>,
) -> Result<T, String> {
    with_session(state, |session| {
        if session.id != workspace_id {
            return Err("所属工作空间已切换，操作已取消".into());
        }
        f(session)
    })
}

pub fn with_workspace_mutating_session<T>(
    workspace_id: &str,
    state: State<AppState>,
    app: &tauri::AppHandle,
    f: impl FnOnce(&Session) -> Result<T, String>,
) -> Result<T, String> {
    with_mutating_session(state, app, |session| {
        if session.id != workspace_id {
            return Err("所属工作空间已切换，操作已取消".into());
        }
        f(session)
    })
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
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState::default())
        .manage(updates::UpdateState::default())
        .register_uri_scheme_protocol("tano-asset", |context, request| {
            let state = context.app_handle().state::<AppState>();
            let guard = state.session.lock();
            if let Ok(guard) = guard {
                if let Some(session) = guard.as_ref() {
                    return assets::respond(&session.root, &session.id, &request);
                }
            }
            tauri::http::Response::builder()
                .status(404)
                .body(b"No workspace".to_vec())
                .expect("static response")
        })
        .invoke_handler(move |invoke| {
            if commands.contains(&invoke.message.command()) {
                extra(invoke)
            } else {
                let handler: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![
                    updates::update_status,
                    updates::update_check,
                    updates::update_download,
                    updates::update_install,
                    open_workspace,
                    close_workspace,
                    runtime_platform,
                    tab_drag_release,
                    open_mobile_workspace,
                    mobile_recycled,
                    mobile_recover,
                    search_documents,
                    recent_workspaces,
                    load_session,
                    save_session,
                    import_attachment,
                    export_attachment,
                    open_external_url,
                    refresh_workspace,
                    workspace_backup_catalog,
                    workspace_backup_preview,
                    restore_workspace_backup,
                    export_workspace,
                    import_workspace_export,
                    reserve_reference_id,
                    read_document,
                    write_document,
                    create_document,
                    create_folder,
                    rename_document,
                    move_entry,
                    remove_document,
                    reveal_workspace,
                    open_workspace_entry,
                    workspace_entry_path,
                    duplicate_workspace_entry,
                    open_workspace_terminal,
                    agent_setup,
                    agent_changes
                ];
                handler(invoke)
            }
        })
}
