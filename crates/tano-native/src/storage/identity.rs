use super::io::create_atomic;
use crate::error::{NativeError, NativeResult};
use rusqlite::{params, Connection};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

pub(crate) fn identity_path(root: &Path) -> Result<PathBuf, String> {
    identity_path_inner(root).map_err(String::from)
}

fn identity_path_inner(root: &Path) -> NativeResult<PathBuf> {
    let dir = root.join(".tano");
    if fs::symlink_metadata(&dir).is_ok_and(|m| m.file_type().is_symlink() || !m.is_dir()) {
        return Err(NativeError::SymlinkEscape(
            ".tano 必须是普通文件夹，不能是符号链接",
        ));
    }
    let path = dir.join("config.json");
    if fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink() || !m.is_file()) {
        return Err(NativeError::SymlinkEscape(
            "工作空间配置必须是普通文件，不能是符号链接",
        ));
    }
    Ok(path)
}

fn read_identity(path: &Path) -> NativeResult<String> {
    let value: serde_json::Value = serde_json::from_slice(&fs::read(path)?)
        .map_err(|e| NativeError::Message(format!("工作空间配置损坏：{e}")))?;
    // Missing format is the original v1 identity. Never interpret an unknown
    // format as v1 or rewrite it while opening an older Local/Product build.
    if value
        .get("format")
        .is_some_and(|format| format.as_u64() != Some(1))
    {
        return Err(NativeError::UnsupportedFormat(
            "此工作区的数据格式不受当前版本支持，请升级 Tano 或 Tano Local；已停止打开和写入，原文件已保留",
        ));
    }
    let id = value
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or(NativeError::UnsupportedFormat("工作空间配置缺少 id"))?;
    Uuid::parse_str(id).map_err(|_| NativeError::UnsupportedFormat("工作空间 id 必须是 UUID"))?;
    Ok(id.to_string())
}

pub fn existing_workspace_identity(root: &Path) -> Result<Option<String>, String> {
    existing_workspace_identity_inner(root).map_err(String::from)
}

fn existing_workspace_identity_inner(root: &Path) -> NativeResult<Option<String>> {
    let path = identity_path_inner(root)?;
    if path.exists() {
        return read_identity(&path).map(Some);
    }
    if root.join(".tano").exists() {
        return Err(NativeError::NotFound(
            ".tano/config.json 缺失，已停止打开，未改动现有文件",
        ));
    }
    Ok(None)
}

pub fn assert_workspace_identity(root: &Path, expected_id: &str) -> Result<(), String> {
    match existing_workspace_identity_inner(root)? {
        Some(id) if id == expected_id => Ok(()),
        _ => Err(NativeError::WorkspaceSwitched(
            "工作区身份已丢失或改变，已停止写入；请检查 .tano 数据",
        )
        .into()),
    }
}

pub fn workspace_identity(root: &Path) -> Result<String, String> {
    if !root.is_dir() {
        return Err(
            NativeError::InvalidPath("工作文件夹已不存在或不是目录，请选择现有文件夹").into(),
        );
    }
    if let Some(id) = existing_workspace_identity(root)? {
        return Ok(id);
    }
    let path = identity_path(root)?;
    fs::create_dir(root.join(".tano")).map_err(|e| format!("无法创建工作空间配置：{e}"))?;
    let id = Uuid::new_v4().to_string();
    let created_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as u64;
    let content = serde_json::to_string_pretty(&serde_json::json!({
        "id": id, "format": 1, "name": "Tano", "createdAt": created_at
    }))
    .map_err(|e| e.to_string())?;
    create_atomic(&path, content.as_bytes())?;
    Ok(id)
}

pub fn database(path: &Path) -> Result<Connection, String> {
    let mut connection = Connection::open(path).map_err(|e| e.to_string())?;
    connection
        .busy_timeout(std::time::Duration::from_secs(3))
        .map_err(|e| e.to_string())?;
    connection.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS files (workspace_id TEXT NOT NULL, path TEXT NOT NULL, id TEXT NOT NULL, hash TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (workspace_id, path));").map_err(|e| e.to_string())?;
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let has_native_key: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('files') WHERE name='native_key')",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !has_native_key {
        transaction
            .execute(
                "ALTER TABLE files ADD COLUMN native_key TEXT NOT NULL DEFAULT ''",
                [],
            )
            .map_err(|e| e.to_string())?;
    }
    transaction.execute_batch("CREATE TABLE IF NOT EXISTS reference_ids (workspace_id TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY(workspace_id,id)); INSERT OR IGNORE INTO reference_ids SELECT workspace_id,id FROM files;").map_err(|e| e.to_string())?;
    transaction.commit().map_err(|e| e.to_string())?;
    crate::search::initialize(&connection)?;
    Ok(connection)
}

pub(crate) fn cached_identity_exists(cache: &Path, workspace_id: &str) -> Result<bool, String> {
    if !cache.exists() {
        return Ok(false);
    }
    let connection = database(cache)?;
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM files WHERE workspace_id=?1 UNION SELECT 1 FROM reference_ids WHERE workspace_id=?1)",
            [workspace_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())
}

pub fn is_short_id(id: &str) -> bool {
    tano_protocol::is_short_id(id)
}

pub(crate) fn claim_reference_id(
    connection: &Connection,
    workspace: &str,
    candidate: &str,
) -> Result<bool, String> {
    Ok(connection
        .execute(
            "INSERT OR IGNORE INTO reference_ids(workspace_id,id) VALUES(?1,?2)",
            params![workspace, candidate],
        )
        .map_err(|e| e.to_string())?
        == 1)
}

pub(crate) fn allocate_reference_id(
    connection: &Connection,
    workspace: &str,
) -> Result<String, String> {
    for _ in 0..256 {
        let candidate = Uuid::new_v4().simple().to_string()[..6].to_string();
        if claim_reference_id(connection, workspace, &candidate)? {
            return Ok(candidate);
        }
    }
    Err("无法分配未占用的短 ID，请稍后重试".into())
}

#[cfg(test)]
pub(crate) fn reserve_reference_id(
    cache: &Path,
    workspace: &str,
    occupied: &[String],
) -> Result<String, String> {
    let mut connection = database(cache)?;
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    for id in occupied {
        claim_reference_id(&transaction, workspace, id)?;
    }
    let id = allocate_reference_id(&transaction, workspace)?;
    transaction.commit().map_err(|e| e.to_string())?;
    Ok(id)
}

#[cfg(windows)]
pub(crate) fn native_key(path: &Path) -> String {
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_FLAG_BACKUP_SEMANTICS,
    };
    let Ok(file) = fs::OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(path)
    else {
        return String::new();
    };
    let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
    if unsafe { GetFileInformationByHandle(file.as_raw_handle() as _, &mut info) } == 0 {
        return String::new();
    }
    format!(
        "{}:{}:{}",
        info.dwVolumeSerialNumber, info.nFileIndexHigh, info.nFileIndexLow
    )
}

#[cfg(unix)]
pub(crate) fn native_key(path: &Path) -> String {
    use std::os::unix::fs::MetadataExt;
    fs::metadata(path)
        .map(|metadata| format!("{}:{}", metadata.dev(), metadata.ino()))
        .unwrap_or_default()
}

#[cfg(not(any(windows, unix)))]
pub(crate) fn native_key(_path: &Path) -> String {
    String::new()
}
