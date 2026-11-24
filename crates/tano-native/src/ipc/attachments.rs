use crate::{
    app_data, assets, cache_path, error::NativeError, storage, with_workspace_mutating_session,
    with_workspace_session, AppState,
};
use std::path::PathBuf;
use tauri::State;

#[tauri::command(async)]
pub(crate) fn import_attachment(
    workspace_id: String,
    name: String,
    content: String,
    require_image: bool,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<assets::ImportedAsset, String> {
    use base64::Engine;
    if content.len() > 70 * 1024 * 1024 {
        return Err(NativeError::SizeLimit("附件过大").into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(content)
        .map_err(|_| NativeError::InvalidEncoding("附件编码无效"))?;
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

#[tauri::command(async)]
pub(crate) fn read_attachment(
    workspace_id: String,
    path: String,
    state: State<AppState>,
) -> Result<String, String> {
    use base64::Engine;
    with_workspace_session(&workspace_id, state, |s| {
        let bytes = assets::read(&s.root, &path)?;
        Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
    })
}

#[tauri::command(async)]
pub(crate) fn export_attachment(
    workspace_id: String,
    path: String,
    destination: String,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    with_workspace_session(&workspace_id, state, |s| {
        let bytes = assets::read(&s.root, &path)?;
        write_export(&app, &destination, &bytes)
    })
}

#[tauri::command(async)]
pub(crate) fn write_spreadsheet(
    workspace_id: String,
    path: String,
    content: String,
    expected: String,
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<String, String> {
    use base64::Engine;
    if content.len() > 70 * 1024 * 1024 {
        return Err(NativeError::SizeLimit("附件过大").into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(content)
        .map_err(|_| NativeError::InvalidEncoding("附件编码无效"))?;
    with_workspace_mutating_session(&workspace_id, state, &app, |s| {
        assets::write_spreadsheet(
            &s.root,
            &path,
            &bytes,
            &expected,
            &app_data(&app)?
                .join("spreadsheet-backups")
                .join(storage::hash(s.id.as_bytes())),
        )
    })
}

#[tauri::command(async)]
pub(crate) fn export_document(
    content: String,
    destination: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    use base64::Engine;
    if content.len() > 70 * 1024 * 1024 {
        return Err(NativeError::SizeLimit("导出文件不能超过 50 MiB").into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(content)
        .map_err(|e| format!("无效导出内容：{e}"))?;
    if bytes.len() > 50 * 1024 * 1024 {
        return Err(NativeError::SizeLimit("导出文件不能超过 50 MiB").into());
    }
    write_export(&app, &destination, &bytes)
}

fn write_export(app: &tauri::AppHandle, destination: &str, bytes: &[u8]) -> Result<(), String> {
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
            return Err(NativeError::InvalidPath("请选择完整的保存路径").into());
        }
        storage::create_atomic(&target, bytes)
            .map_err(|e| format!("无法导出；请使用尚未存在的文件名：{e}"))
    }
}
