use crate::{
    assistant_files, cache_path, error::NativeError, identity_manifest, storage, with_session,
    with_workspace_mutating_session, with_workspace_session, AppState,
};
use tauri::State;

#[cfg(mobile)]
use crate::{app_data, mobile_storage};

#[tauri::command(async)]
pub(crate) fn read_document(
    path: String,
    state: State<AppState>,
) -> Result<storage::Snapshot, String> {
    with_session(state, |s| {
        storage::read(&storage::resolve_storage(&s.root, &path, true)?)
    })
}

#[tauri::command(async)]
pub(crate) fn write_document(
    path: String,
    content: String,
    expected_hash: String,
    state: State<AppState>,
) -> Result<storage::WriteResult, String> {
    with_session(state, |s| {
        let target = storage::resolve_storage(&s.root, &path, false)?;
        storage::write(&target, &content, &expected_hash)
    })
}

#[tauri::command(async)]
pub(crate) fn create_agent_record(
    path: String,
    content: String,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    let object: serde_json::Value = serde_json::from_str(&content).map_err(|_| "对象 JSON 无效")?;
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
    with_session(state, |s| {
        let target = storage::ensure_file_parent(&s.root, &path)?;
        if target.exists() {
            return Err(NativeError::AlreadyExists("对象路径已存在").into());
        }
        identity_manifest::claim_external(&s.root, &s.id, &cache_path(&app)?, id)?;
        // Failed publication deliberately keeps the ID reserved; never reuse an identity.
        storage::create_atomic(&target, content.as_bytes())
    })
}

#[tauri::command(async)]
pub(crate) fn reserve_reference_id(
    app: tauri::AppHandle,
    occupied: Vec<String>,
    state: State<AppState>,
) -> Result<String, String> {
    with_session(state, |s| {
        identity_manifest::reserve(&s.root, &s.id, &cache_path(&app)?, &occupied)
    })
}

#[tauri::command(async)]
pub(crate) fn create_document(
    path: String,
    content: String,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    with_session(state, |s| {
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

#[tauri::command(async)]
pub(crate) fn create_folder(path: String, state: State<AppState>) -> Result<(), String> {
    with_session(state, |s| {
        std::fs::create_dir(storage::resolve(&s.root, &path, false)?).map_err(|e| e.to_string())
    })
}

#[tauri::command(async)]
pub(crate) fn rename_document(
    from: String,
    to: String,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    with_session(state, |s| {
        storage::rename(&s.root, &s.id, &from, &to, &cache_path(&app)?)
    })
}

#[tauri::command(async)]
pub(crate) fn remove_empty_folder(
    workspace_id: String,
    path: String,
    state: State<AppState>,
) -> Result<(), String> {
    with_session(state, |s| {
        if s.id != workspace_id {
            return Err(NativeError::WorkspaceSwitched("工作区已切换").into());
        }
        storage::remove_empty_folder(&s.root, &s.id, &path)
    })
}

#[tauri::command(async)]
pub(crate) fn move_entry(
    from: String,
    to: String,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    with_session(state, |s| {
        storage::move_entry(&s.root, &s.id, &from, &to, &cache_path(&app)?)
    })
}

#[tauri::command(async)]
pub(crate) fn remove_document(
    path: String,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    with_session(state, |s| {
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
            if let Err(error) = mobile_storage::recycle(&app_data(&app)?, &s.root, &s.id, &path) {
                let _ = identity_manifest::recover_mutation(&s.root, &s.id, &cache);
                return Err(error);
            }
        }
        identity_manifest::recover_mutation(&s.root, &s.id, &cache)
    })
}

#[tauri::command(async)]
pub(crate) fn change_assistant_file(
    request: assistant_files::FileChangeRequest,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<storage::WriteResult, String> {
    with_session(state, |s| {
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
}

#[tauri::command(async)]
pub(crate) fn delete_workspace_object(
    request: assistant_files::FileChangeRequest,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<storage::WriteResult, String> {
    with_session(state, |s| {
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
}

#[tauri::command(async)]
pub(crate) fn reveal_workspace(state: State<AppState>) -> Result<(), String> {
    #[cfg(mobile)]
    {
        let _ = state;
        return Err(NativeError::PlatformUnavailable("手机空间保存在应用沙箱中").into());
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
    with_workspace_session(&workspace_id, state, |s| {
        storage::resolve(&s.root, &path, true)?
            .into_os_string()
            .into_string()
            .map_err(|_| "文件路径包含无法复制的字符".into())
    })
}

#[tauri::command(async)]
pub(crate) fn duplicate_workspace_entry(
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
