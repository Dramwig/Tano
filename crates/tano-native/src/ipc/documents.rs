use crate::{
    assistant_files, cache_path, error::NativeError, identity_manifest, storage, with_session,
    with_workspace_mutating_session, with_workspace_session, AppState,
};
use std::path::Path;
use tauri::{Manager, State};

#[cfg(mobile)]
use crate::{app_data, mobile_storage};

#[tauri::command]
pub(crate) async fn read_document<R: tauri::Runtime>(
    path: String,
    app: tauri::AppHandle<R>,
) -> Result<storage::Snapshot, String> {
    #[cfg(desktop)]
    if let Some(remote) = crate::remote_session(&app.state::<AppState>()) {
        return crate::ssh::storage::remote_read_document(
            remote.transport.as_ref(),
            &remote.remote_root,
            &remote.id,
            &path,
        )
        .await;
    }
    tauri::async_runtime::spawn_blocking(move || {
        with_session(app.state::<AppState>(), |s| {
            let target = storage::resolve_storage(&s.root, &path, true)?;
            if !storage::is_workspace_data_path(&path)
                && storage::is_editable_code_path(Path::new(&path))
            {
                storage::read_code(&target)
            } else {
                storage::read(&target)
            }
        })
    })
    .await
    .map_err(|e| format!("读取文档任务失败：{e}"))?
}

#[tauri::command]
pub(crate) async fn write_document<R: tauri::Runtime>(
    path: String,
    content: String,
    expected_hash: String,
    app: tauri::AppHandle<R>,
) -> Result<storage::WriteResult, String> {
    #[cfg(desktop)]
    if let Some(remote) = crate::remote_session(&app.state::<AppState>()) {
        return crate::ssh::storage::remote_write_document(
            remote.transport.as_ref(),
            &remote.remote_root,
            &remote.id,
            &path,
            &content,
            &expected_hash,
        )
        .await;
    }
    tauri::async_runtime::spawn_blocking(move || {
        with_session(app.state::<AppState>(), |s| {
            let target = storage::resolve_storage(&s.root, &path, false)?;
            if !storage::is_workspace_data_path(&path)
                && storage::is_editable_code_path(Path::new(&path))
            {
                storage::write_code(&target, &content, &expected_hash)
            } else {
                storage::write(&target, &content, &expected_hash)
            }
        })
    })
    .await
    .map_err(|e| format!("保存文档任务失败：{e}"))?
}

#[tauri::command]
pub(crate) async fn create_agent_record(
    path: String,
    content: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    #[cfg(desktop)]
    if let Some(remote) = crate::remote_session(&app.state::<AppState>()) {
        let cache = cache_path(&app)?;
        return crate::ssh::storage::remote_create_agent_record(
            remote.transport.as_ref(),
            &remote.remote_root,
            &remote.id,
            &cache,
            &path,
            &content,
        )
        .await;
    }
    tauri::async_runtime::spawn_blocking(move || {
        let object: serde_json::Value =
            serde_json::from_str(&content).map_err(|_| "对象 JSON 无效")?;
        let id = object
            .get("id")
            .and_then(serde_json::Value::as_str)
            .ok_or("对象身份缺失")?;
        if !storage::is_short_id(id)
            || !(path == format!(".tano/objects/{id}.tano.json")
                || (!path.starts_with('.') && path.ends_with(".table.json")))
        {
            return Err(NativeError::InvalidPath("对象路径无效").into());
        }
        with_session(app.state::<AppState>(), |s| {
            let target = storage::ensure_file_parent(&s.root, &path)?;
            if target.exists() {
                return Err(NativeError::AlreadyExists("对象路径已存在").into());
            }
            identity_manifest::claim_external(&s.root, &s.id, &cache_path(&app)?, id)?;
            // Failed publication deliberately keeps the ID reserved; never reuse an identity.
            storage::create_atomic(&target, content.as_bytes())
        })
    })
    .await
    .map_err(|e| format!("创建对象任务失败：{e}"))?
}

#[tauri::command]
pub(crate) async fn reserve_reference_id(
    app: tauri::AppHandle,
    occupied: Vec<String>,
) -> Result<String, String> {
    #[cfg(desktop)]
    if let Some(remote) = crate::remote_session(&app.state::<AppState>()) {
        let cache = cache_path(&app)?;
        return crate::ssh::storage::remote_reserve_reference_id(
            remote.transport.as_ref(),
            &remote.remote_root,
            &remote.id,
            &cache,
            &occupied,
        )
        .await;
    }
    tauri::async_runtime::spawn_blocking(move || {
        with_session(app.state::<AppState>(), |s| {
            identity_manifest::reserve(&s.root, &s.id, &cache_path(&app)?, &occupied)
        })
    })
    .await
    .map_err(|e| format!("预留身份任务失败：{e}"))?
}

#[tauri::command]
pub(crate) async fn create_document(
    path: String,
    content: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    #[cfg(desktop)]
    if let Some(remote) = crate::remote_session(&app.state::<AppState>()) {
        return crate::ssh::storage::remote_create_document(
            remote.transport.as_ref(),
            &remote.remote_root,
            &remote.id,
            &path,
            &content,
        )
        .await;
    }
    tauri::async_runtime::spawn_blocking(move || {
        with_session(app.state::<AppState>(), |s| {
            let target = if storage::is_workspace_data_path(&path) {
                storage::ensure_file_parent(&s.root, &path)?
            } else {
                storage::resolve(&s.root, &path, false)?
            };
            let cache = cache_path(&app)?;
            identity_manifest::begin_create(&s.root, &s.id, &cache, &path, content.as_bytes())?;
            let write_res = if !storage::is_workspace_data_path(&path)
                && storage::is_editable_code_path(Path::new(&path))
            {
                storage::create_code(&target, &content)
            } else {
                storage::create(&target, &content)
            };
            if let Err(error) = write_res {
                let _ = identity_manifest::recover_mutation(&s.root, &s.id, &cache);
                return Err(error);
            }
            identity_manifest::recover_mutation(&s.root, &s.id, &cache)
        })
    })
    .await
    .map_err(|e| format!("创建文档任务失败：{e}"))?
}

#[tauri::command]
pub(crate) async fn create_folder<R: tauri::Runtime>(
    path: String,
    app: tauri::AppHandle<R>,
) -> Result<(), String> {
    #[cfg(desktop)]
    if let Some(remote) = crate::remote_session(&app.state::<AppState>()) {
        return crate::ssh::storage::remote_create_folder(
            remote.transport.as_ref(),
            &remote.remote_root,
            &remote.id,
            &path,
        )
        .await;
    }
    tauri::async_runtime::spawn_blocking(move || {
        with_session(app.state::<AppState>(), |s| {
            std::fs::create_dir(storage::resolve(&s.root, &path, false)?).map_err(|e| e.to_string())
        })
    })
    .await
    .map_err(|e| format!("创建文件夹任务失败：{e}"))?
}

#[tauri::command]
pub(crate) async fn rename_document(
    from: String,
    to: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    #[cfg(desktop)]
    if let Some(remote) = crate::remote_session(&app.state::<AppState>()) {
        let cache = cache_path(&app)?;
        return crate::ssh::storage::remote_move_entry(
            remote.transport.as_ref(),
            &remote.remote_root,
            &remote.id,
            &cache,
            &from,
            &to,
        )
        .await;
    }
    tauri::async_runtime::spawn_blocking(move || {
        with_session(app.state::<AppState>(), |s| {
            storage::rename(&s.root, &s.id, &from, &to, &cache_path(&app)?)
        })
    })
    .await
    .map_err(|e| format!("重命名任务失败：{e}"))?
}

#[tauri::command]
pub(crate) async fn remove_empty_folder(
    workspace_id: String,
    path: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    #[cfg(desktop)]
    if let Some(remote) = crate::remote_workspace_session(&workspace_id, &app.state::<AppState>())?
    {
        return crate::ssh::storage::remote_remove_empty_folder(
            remote.transport.as_ref(),
            &remote.remote_root,
            &remote.id,
            &path,
        )
        .await;
    }
    tauri::async_runtime::spawn_blocking(move || {
        with_session(app.state::<AppState>(), |s| {
            if s.id != workspace_id {
                return Err(NativeError::WorkspaceSwitched("工作区已切换").into());
            }
            storage::remove_empty_folder(&s.root, &s.id, &path)
        })
    })
    .await
    .map_err(|e| format!("移除文件夹任务失败：{e}"))?
}

#[tauri::command]
pub(crate) async fn move_entry(
    from: String,
    to: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    #[cfg(desktop)]
    if let Some(remote) = crate::remote_session(&app.state::<AppState>()) {
        let cache = cache_path(&app)?;
        return crate::ssh::storage::remote_move_entry(
            remote.transport.as_ref(),
            &remote.remote_root,
            &remote.id,
            &cache,
            &from,
            &to,
        )
        .await;
    }
    tauri::async_runtime::spawn_blocking(move || {
        with_session(app.state::<AppState>(), |s| {
            storage::move_entry(&s.root, &s.id, &from, &to, &cache_path(&app)?)
        })
    })
    .await
    .map_err(|e| format!("移动条目任务失败：{e}"))?
}

#[tauri::command]
pub(crate) async fn remove_document(path: String, app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    if let Some(remote) = crate::remote_session(&app.state::<AppState>()) {
        let res = crate::ssh::storage::remote_remove_entry(
            remote.transport.as_ref(),
            &remote.remote_root,
            &remote.id,
            &path,
            remote.trash_mode,
        )
        .await;
        if res.is_ok() {
            remote.clear_asset_cache();
        }
        return res;
    }
    tauri::async_runtime::spawn_blocking(move || {
        with_session(app.state::<AppState>(), |s| {
            let target = storage::resolve_storage(&s.root, &path, true)?;
            #[cfg(mobile)]
            if !target.is_file() {
                return Err(NativeError::PlatformUnavailable("手机回收站暂不支持文件夹").into());
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
                if let Err(error) = mobile_storage::recycle(&app_data(&app)?, &s.root, &s.id, &path)
                {
                    let _ = identity_manifest::recover_mutation(&s.root, &s.id, &cache);
                    return Err(error);
                }
            }
            identity_manifest::recover_mutation(&s.root, &s.id, &cache)
        })
    })
    .await
    .map_err(|e| format!("删除条目任务失败：{e}"))?
}

#[tauri::command]
pub(crate) async fn change_assistant_file(
    request: assistant_files::FileChangeRequest,
    app: tauri::AppHandle,
) -> Result<storage::WriteResult, String> {
    #[cfg(desktop)]
    if let Some(remote) =
        crate::remote_workspace_session(&request.workspace_id, &app.state::<AppState>())?
    {
        let cache = cache_path(&app)?;
        return crate::ssh::storage::remote_change_assistant_file(
            remote.transport.as_ref(),
            &remote.remote_root,
            &remote.id,
            &cache,
            &request,
            remote.trash_mode,
            false,
        )
        .await;
    }
    tauri::async_runtime::spawn_blocking(move || {
        with_session(app.state::<AppState>(), |s| {
            assistant_files::change(&s.root, &s.id, &cache_path(&app)?, &request, |target| {
                #[cfg(desktop)]
                {
                    trash::delete(target).map_err(|error| error.to_string())
                }
                #[cfg(mobile)]
                {
                    let _ = target;
                    mobile_storage::recycle(&app_data(&app)?, &s.root, &s.id, &request.path)
                }
            })
        })
    })
    .await
    .map_err(|e| format!("助手文件操作失败：{e}"))?
}

#[tauri::command]
pub(crate) async fn delete_workspace_object(
    request: assistant_files::FileChangeRequest,
    app: tauri::AppHandle,
) -> Result<storage::WriteResult, String> {
    #[cfg(desktop)]
    if let Some(remote) =
        crate::remote_workspace_session(&request.workspace_id, &app.state::<AppState>())?
    {
        let cache = cache_path(&app)?;
        return crate::ssh::storage::remote_change_assistant_file(
            remote.transport.as_ref(),
            &remote.remote_root,
            &remote.id,
            &cache,
            &request,
            remote.trash_mode,
            true,
        )
        .await;
    }
    tauri::async_runtime::spawn_blocking(move || {
        with_session(app.state::<AppState>(), |s| {
            assistant_files::delete_object(&s.root, &s.id, &cache_path(&app)?, &request, |target| {
                #[cfg(desktop)]
                {
                    trash::delete(target).map_err(|error| error.to_string())
                }
                #[cfg(mobile)]
                {
                    let _ = target;
                    mobile_storage::recycle(&app_data(&app)?, &s.root, &s.id, &request.path)
                }
            })
        })
    })
    .await
    .map_err(|e| format!("删除工作区对象失败：{e}"))?
}

#[tauri::command(async)]
pub(crate) fn reveal_workspace(state: State<AppState>) -> Result<(), String> {
    #[cfg(mobile)]
    {
        let _ = state;
        return Err(NativeError::PlatformUnavailable("手机空间保存在应用沙箱中").into());
    }
    #[cfg(desktop)]
    {
        if crate::remote_session(&state).is_some() {
            return Err(NativeError::PlatformUnavailable(
                "SSH 远程工作区位于远端服务器，请使用「打开远端终端」访问目录",
            )
            .into());
        }
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
}

#[tauri::command(async)]
pub(crate) fn open_workspace_entry(
    workspace_id: String,
    path: String,
    reveal: bool,
    state: State<AppState>,
) -> Result<(), String> {
    #[cfg(mobile)]
    {
        let _ = (workspace_id, path, reveal, state);
        return Err(NativeError::PlatformUnavailable("请在桌面端打开工作区文件").into());
    }
    #[cfg(desktop)]
    {
        if crate::remote_workspace_session(&workspace_id, &state)?.is_some() {
            return Err(NativeError::PlatformUnavailable(
                "远端文件无法直接用本机文件管理器打开，请复制路径或导出副本",
            )
            .into());
        }
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
}

#[tauri::command(async)]
pub(crate) fn workspace_entry_path(
    workspace_id: String,
    path: String,
    state: State<AppState>,
) -> Result<String, String> {
    #[cfg(mobile)]
    {
        let _ = (workspace_id, path, state);
        return Err(NativeError::PlatformUnavailable("请在桌面端复制工作区文件路径").into());
    }
    #[cfg(desktop)]
    {
        if let Some(remote) = crate::remote_workspace_session(&workspace_id, &state)? {
            storage::validate_relative_path(&path, false)?;
            return crate::ssh::uri::join_remote_posix(&remote.remote_root, &path)
                .map_err(|e| e.to_string());
        }
        with_workspace_session(&workspace_id, state, |s| {
            storage::resolve(&s.root, &path, true)?
                .into_os_string()
                .into_string()
                .map_err(|_| "文件路径包含无法复制的字符".into())
        })
    }
}

#[tauri::command]
pub(crate) async fn duplicate_workspace_entry(
    workspace_id: String,
    path: String,
    app: tauri::AppHandle,
) -> Result<String, String> {
    #[cfg(desktop)]
    if let Some(remote) = crate::remote_workspace_session(&workspace_id, &app.state::<AppState>())?
    {
        let duplicate = crate::ssh::storage::remote_duplicate_entry(
            remote.transport.as_ref(),
            &remote.remote_root,
            &remote.id,
            &path,
        )
        .await?;
        let cache = cache_path(&app)?;
        let latency = remote.latency_ms.load(std::sync::atomic::Ordering::Relaxed);
        let _ = crate::ssh::storage::remote_scan(
            remote.transport.as_ref(),
            &remote.remote_root,
            &remote.uri,
            &remote.host_id,
            &remote.host_label,
            &remote.id,
            &cache,
            Some(latency),
        )
        .await?;
        return Ok(duplicate);
    }
    tauri::async_runtime::spawn_blocking(move || {
        with_workspace_mutating_session(&workspace_id, app.state::<AppState>(), &app, |s| {
            let duplicate = storage::duplicate_entry(&s.root, &path)?;
            storage::scan(&s.root, &s.id, &cache_path(&app)?)?;
            Ok(duplicate)
        })
    })
    .await
    .map_err(|e| format!("复制文件任务失败：{e}"))?
}
