use rusqlite::{params, Connection};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

const MAX_DOCUMENT_BYTES: u64 = 8 * 1024 * 1024;

#[path = "storage_scan_cache.rs"]
mod scan_cache;

#[derive(Serialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub path: String,
    pub files: Vec<Entry>,
    #[serde(rename = "newlyCreated", skip_serializing_if = "Option::is_none")]
    pub newly_created: Option<bool>,
    #[serde(rename = "reinitialized", skip_serializing_if = "Option::is_none")]
    pub reinitialized: Option<bool>,
}
#[derive(Serialize)]
pub struct Entry {
    pub id: String,
    pub path: String,
    name: String,
    pub kind: String,
    pub(crate) size: u64,
    modified: u64,
    #[serde(rename = "contentHash", skip_serializing_if = "Option::is_none")]
    content_hash: Option<String>,
}
#[derive(Serialize, Debug)]
pub struct Snapshot {
    pub content: String,
    pub hash: String,
    modified: u64,
}
#[derive(Serialize, Debug)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum WriteResult {
    Saved { snapshot: Snapshot },
    Conflict { snapshot: Snapshot },
    Missing,
}

pub fn hash(content: &[u8]) -> String {
    format!("{:x}", Sha256::digest(content))
}
fn hash_path(path: &Path) -> Result<String, String> {
    #[cfg(test)]
    scan_cache::content_read();
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}
fn modified(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
pub(crate) fn is_markdown(path: &Path) -> bool {
    path.extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("markdown"))
}
pub(crate) fn is_data_table(path: &Path) -> bool {
    path.file_name().is_some_and(|name| {
        name.to_string_lossy()
            .to_ascii_lowercase()
            .ends_with(".table.json")
    })
}

/// Existing components must be plain filesystem entries inside the selected root.
pub fn resolve(root: &Path, relative: &str, must_exist: bool) -> Result<PathBuf, String> {
    resolve_path(root, relative, must_exist, false)
}

pub fn is_workspace_data_path(relative: &str) -> bool {
    let Some(path) = relative.strip_prefix(".tano/") else {
        return false;
    };
    matches!(
        path,
        "capabilities.json"
            | "settings.tano.json"
            | "folders.tano.json"
            | "plugins.tano.json"
            | "relations.tano-relations.json"
            | "rules/assistant.md"
    ) || (path.starts_with("objects/") && path.ends_with(".tano.json"))
        || path.strip_prefix("views/").is_some_and(|name| {
            name.strip_suffix(".tano.json").is_some_and(|id| {
                !id.is_empty()
                    && id.len() <= 64
                    && id
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
            })
        })
        || path.strip_prefix("templates/").is_some_and(|name| {
            name.strip_suffix(".md").is_some_and(|id| {
                id.len() == 6
                    && id
                        .bytes()
                        .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
            })
        })
        || (path.starts_with("conflicts/") && path.ends_with(".json"))
        || [
            "annotations/",
            "discussions/",
            "document-layout/",
            "suggestions/",
            "tables/",
            "files/",
        ]
        .iter()
        .any(|prefix| {
            path.strip_prefix(prefix).is_some_and(|name| {
                name.strip_suffix(".tano.json").is_some_and(|id| {
                    id.len() == 6
                        && id
                            .bytes()
                            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
                })
            })
        })
}

pub fn is_workspace_data_directory(relative: &str) -> bool {
    if relative == ".tano" {
        return true;
    }
    let Some(path) = relative.strip_prefix(".tano/") else {
        return false;
    };
    matches!(
        path,
        "objects"
            | "conflicts"
            | "annotations"
            | "discussions"
            | "document-layout"
            | "suggestions"
            | "tables"
            | "rules"
            | "templates"
            | "views"
            | "files"
    ) || path.starts_with("objects/")
        || path.starts_with("conflicts/")
}

pub fn resolve_storage(root: &Path, relative: &str, must_exist: bool) -> Result<PathBuf, String> {
    resolve_path(root, relative, must_exist, is_workspace_data_path(relative))
}

pub(crate) fn validate_relative_path(relative: &str, workspace_data: bool) -> Result<(), String> {
    if relative.is_empty()
        || relative.len() > 900
        || relative.contains('\\')
        || relative.contains(':')
    {
        return Err("无效的工作空间相对路径".into());
    }
    // Check raw components too: Path::components normalizes embedded `.` segments.
    if relative
        .split('/')
        .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err("路径不能离开工作空间".into());
    }
    for (index, component) in Path::new(relative).components().enumerate() {
        let Component::Normal(name) = component else {
            return Err("路径不能离开工作空间".into());
        };
        let name_string = name.to_string_lossy();
        if (name_string.starts_with('.')
            && !(workspace_data && index == 0 && name_string == ".tano"))
            || name_string.ends_with('.')
            || name_string.ends_with(' ')
            || name_string
                .chars()
                .any(|c| c.is_control() || "<>\"|?*".contains(c))
        {
            return Err("不支持隐藏路径或保留字符".into());
        }
    }
    Ok(())
}

fn resolve_path(
    root: &Path,
    relative: &str,
    must_exist: bool,
    workspace_data: bool,
) -> Result<PathBuf, String> {
    validate_relative_path(relative, workspace_data)?;
    let mut current = root.to_path_buf();
    for component in Path::new(relative).components() {
        current.push(component.as_os_str());
        if let Ok(metadata) = fs::symlink_metadata(&current) {
            if metadata.file_type().is_symlink() {
                return Err("为保护工作空间，不跟随符号链接".into());
            }
            let canonical = fs::canonicalize(&current).map_err(|e| e.to_string())?;
            if !canonical.starts_with(root) {
                return Err("路径不能离开工作空间".into());
            }
        }
    }
    if must_exist && !current.exists() {
        return Err("文件已不存在".into());
    }
    let parent = current.parent().ok_or("无效路径")?;
    if !parent.is_dir() {
        return Err("目标文件夹不存在".into());
    }
    Ok(current)
}

/// Validate the whole destination before creating any parents. Hidden access is
/// granted only to the portable data allowlist, never config.json or other dotfiles.
pub fn ensure_file_parent(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let workspace_data = is_workspace_data_path(relative);
    let parts: Vec<_> = relative.split('/').collect();
    validate_relative_path(relative, workspace_data)?;
    for count in 1..parts.len() {
        let parent = resolve_path(root, &parts[..count].join("/"), false, workspace_data)?;
        if !parent.exists() {
            match fs::create_dir(&parent) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(error) => return Err(error.to_string()),
            }
        }
        // Recheck a concurrently created directory, including its symlink status.
        let parent = resolve_path(root, &parts[..count].join("/"), true, workspace_data)?;
        if !parent.is_dir() {
            return Err("目标父路径不是文件夹".into());
        }
    }
    resolve_storage(root, relative, false)
}

pub(crate) fn identity_path(root: &Path) -> Result<PathBuf, String> {
    let dir = root.join(".tano");
    if fs::symlink_metadata(&dir).is_ok_and(|m| m.file_type().is_symlink() || !m.is_dir()) {
        return Err(".tano 必须是普通文件夹，不能是符号链接".into());
    }
    let path = dir.join("config.json");
    if fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink() || !m.is_file()) {
        return Err("工作空间配置必须是普通文件，不能是符号链接".into());
    }
    Ok(path)
}

fn read_identity(path: &Path) -> Result<String, String> {
    let value: serde_json::Value =
        serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
            .map_err(|e| format!("工作空间配置损坏：{e}"))?;
    let id = value
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("工作空间配置缺少 id")?;
    Uuid::parse_str(id).map_err(|_| "工作空间 id 必须是 UUID")?;
    Ok(id.to_string())
}

pub fn existing_workspace_identity(root: &Path) -> Result<Option<String>, String> {
    let path = identity_path(root)?;
    if path.exists() {
        return read_identity(&path).map(Some);
    }
    if root.join(".tano").exists() {
        return Err(".tano/config.json 缺失，已停止打开，未改动现有文件".into());
    }
    Ok(None)
}

pub fn assert_workspace_identity(root: &Path, expected_id: &str) -> Result<(), String> {
    match existing_workspace_identity(root)? {
        Some(id) if id == expected_id => Ok(()),
        _ => Err("工作区身份已丢失或改变，已停止写入；请检查 .tano 数据".into()),
    }
}

pub fn workspace_identity(root: &Path) -> Result<String, String> {
    if !root.is_dir() {
        return Err("工作文件夹已不存在或不是目录，请选择现有文件夹".into());
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
    connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM files WHERE workspace_id=?1 UNION SELECT 1 FROM reference_ids WHERE workspace_id=?1)",
        [workspace_id], |row| row.get(0),
    ).map_err(|e| e.to_string())
}

pub(crate) fn display_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    if let Some(share) = value.strip_prefix("\\\\?\\UNC\\") {
        format!("\\\\{share}")
    } else if let Some(local) = value.strip_prefix("\\\\?\\") {
        local.into()
    } else {
        value.into_owned()
    }
}

pub fn is_short_id(id: &str) -> bool {
    id.len() == 6
        && id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
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

const MAX_WORKSPACE_ENTRIES: usize = 20_000;

pub(crate) fn ignored_workspace_name(name: &str) -> bool {
    name.starts_with('.') || matches!(name, "node_modules" | "target" | "dist")
}

fn walk(
    root: &Path,
    dir: &Path,
    entries: &mut Vec<Entry>,
    limit: usize,
    visited: &mut usize,
) -> Result<(), String> {
    for item in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?;
        let name = item.file_name().to_string_lossy().to_string();
        let path = item
            .path()
            .strip_prefix(root)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        let internal = path == ".tano" || path.starts_with(".tano/");
        if path != ".tano" && ignored_workspace_name(&name) {
            continue;
        }
        let metadata = fs::symlink_metadata(item.path()).map_err(|e| e.to_string())?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        if !metadata.is_dir() && !metadata.is_file() {
            continue;
        }
        if internal && metadata.is_file() && !is_workspace_data_path(&path) {
            continue;
        }
        if *visited >= limit {
            return Err(format!(
                "工作空间超过 {limit} 个文件或文件夹，请选择更小的工作文件夹"
            ));
        }
        *visited += 1;
        if internal {
            if metadata.is_dir() {
                if is_workspace_data_directory(&path) {
                    walk(root, &item.path(), entries, limit, visited)?;
                }
                continue;
            }
        }
        entries.push(Entry {
            content_hash: None,
            id: String::new(),
            path,
            name,
            kind: if metadata.is_dir() {
                "directory"
            } else {
                "file"
            }
            .into(),
            size: metadata.len(),
            modified: modified(&metadata),
        });
        if metadata.is_dir() {
            walk(root, &item.path(), entries, limit, visited)?;
        }
    }
    Ok(())
}

struct CachedIdentity {
    id: String,
    hash: String,
    native_key: String,
    version: i64,
    stamp: String,
    indexed: bool,
}

fn unique_unclaimed<'a>(
    candidates: Option<&Vec<&'a CachedIdentity>>,
    claimed: &HashSet<String>,
) -> Option<&'a CachedIdentity> {
    let mut available = candidates?
        .iter()
        .copied()
        .filter(|cached| !claimed.contains(&cached.id));
    let candidate = available.next()?;
    available.next().is_none().then_some(candidate)
}

pub fn scan(root: &Path, id: &str, cache: &Path) -> Result<Workspace, String> {
    scan_inner(root, id, cache, true)
}

#[cfg(test)]
pub(crate) fn scan_without_content_cache(
    root: &Path,
    id: &str,
    cache: &Path,
) -> Result<Workspace, String> {
    scan_inner(root, id, cache, false)
}

#[cfg(test)]
pub(crate) fn take_scan_content_reads() -> usize {
    scan_cache::take_content_reads()
}

fn scan_inner(root: &Path, id: &str, cache: &Path, reuse: bool) -> Result<Workspace, String> {
    crate::identity_manifest::recover_mutation(root, id, cache)?;
    crate::identity_manifest::recover_move(root, id, cache)?;
    let mut entries = Vec::new();
    walk(root, root, &mut entries, MAX_WORKSPACE_ENTRIES, &mut 0)?;
    let mut connection = database(cache)?;
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    crate::identity_manifest::hydrate(&transaction, root, id)?;
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS scan_fingerprints (
        workspace_id TEXT NOT NULL, path TEXT NOT NULL, hash TEXT NOT NULL, stamp TEXT NOT NULL,
        PRIMARY KEY(workspace_id,path));",
        )
        .map_err(|e| e.to_string())?;
    let old: HashMap<String, CachedIdentity> = {
        let mut statement = transaction
            .prepare(
                "SELECT f.path,f.id,f.hash,f.native_key,f.version,COALESCE(c.stamp,''),s.rowid IS NOT NULL
                 FROM files f LEFT JOIN scan_fingerprints c
                   ON c.workspace_id=f.workspace_id AND c.path=f.path AND c.hash=f.hash
                 LEFT JOIN search_documents s
                   ON s.workspace=f.workspace_id AND s.file_id=f.id AND s.path=f.path AND s.hash=f.hash
                 WHERE f.workspace_id=? AND f.deleted=0",
            )
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    CachedIdentity {
                        id: row.get(1)?,
                        hash: row.get(2)?,
                        native_key: row.get(3)?,
                        version: row.get(4)?,
                        stamp: row.get(5)?,
                        indexed: row.get(6)?,
                    },
                ))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?
    };
    let states: HashMap<String, scan_cache::FileState> = entries
        .iter()
        .filter(|entry| entry.kind != "directory")
        .map(|entry| {
            (
                entry.path.clone(),
                scan_cache::state(&root.join(&entry.path)),
            )
        })
        .collect();
    let native_keys: HashMap<String, String> = states
        .iter()
        .map(|(path, state)| (path.clone(), state.key.clone()))
        .collect();
    let mut current_native_counts: HashMap<&str, usize> = HashMap::new();
    for key in native_keys.values().filter(|key| !key.is_empty()) {
        *current_native_counts.entry(key).or_default() += 1;
    }
    let mut old_by_native: HashMap<&str, Vec<&CachedIdentity>> = HashMap::new();
    for cached in old.values() {
        if !cached.native_key.is_empty() {
            old_by_native
                .entry(&cached.native_key)
                .or_default()
                .push(cached);
        }
    }
    // Reserve identities proven by the filesystem before falling back to paths.
    // Paths may all still exist after an exchange, or a moved file's old path
    // may already hold a newly-created document. Neither is a same-file edit.
    let mut identities: HashMap<String, &CachedIdentity> = HashMap::new();
    let mut claimed = HashSet::new();
    for (path, key) in &native_keys {
        if key.is_empty() {
            continue;
        }
        let previous = old.get(path).filter(|cached| cached.native_key == *key);
        let relocated = || {
            let candidates = old_by_native.get(key.as_str())?;
            (candidates.len() == 1 && current_native_counts.get(key.as_str()) == Some(&1))
                .then_some(candidates[0])
        };
        if let Some(cached) = previous.or_else(relocated) {
            if claimed.insert(cached.id.clone()) {
                identities.insert(path.clone(), cached);
            }
        }
    }
    // Atomic-save tools replace the inode at an unchanged path. Retain its UUID
    // unless the old native file is known to survive elsewhere in this scan.
    for (path, key) in &native_keys {
        if identities.contains_key(path) {
            continue;
        }
        if let Some(cached) = old.get(path) {
            let survives_elsewhere = !cached.native_key.is_empty()
                && cached.native_key != *key
                && current_native_counts.contains_key(cached.native_key.as_str());
            if !survives_elsewhere && claimed.insert(cached.id.clone()) {
                identities.insert(path.clone(), cached);
            }
        }
    }
    // Only unresolved old identities can be content-based rename candidates.
    // Indexed lookups keep large unchanged scans linear rather than quadratic.
    let mut missing_by_hash: HashMap<&str, Vec<&CachedIdentity>> = HashMap::new();
    for cached in old.values().filter(|cached| {
        !claimed.contains(&cached.id)
            && (cached.native_key.is_empty()
                || !current_native_counts.contains_key(cached.native_key.as_str()))
    }) {
        if !cached.hash.is_empty() {
            missing_by_hash
                .entry(&cached.hash)
                .or_default()
                .push(cached);
        }
    }
    let mut unresolved_hashes = HashMap::new();
    let mut current_candidates_by_hash: HashMap<String, usize> = HashMap::new();
    if !missing_by_hash.is_empty() {
        for entry in entries
            .iter()
            .filter(|entry| entry.kind == "file" && !identities.contains_key(&entry.path))
        {
            let digest = hash_path(&root.join(&entry.path))?;
            *current_candidates_by_hash
                .entry(digest.clone())
                .or_default() += 1;
            unresolved_hashes.insert(entry.path.clone(), digest);
        }
    }
    // Retain unchanged rows instead of tombstoning and rewriting the whole index.
    for path in old.keys().filter(|path| !native_keys.contains_key(*path)) {
        transaction
            .execute(
                "UPDATE files SET deleted=1 WHERE workspace_id=?1 AND path=?2",
                params![id, path],
            )
            .map_err(|e| e.to_string())?;
    }
    // Object IDs are source metadata. Remember imported IDs too, even after their file is deleted.
    for entry in entries.iter().filter(|entry| {
        entry.kind == "file"
            && entry.path.ends_with(".tano.json")
            && entry.size <= MAX_DOCUMENT_BYTES
    }) {
        if let Ok(bytes) = fs::read(root.join(&entry.path)) {
            if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                if let Some(object_id) = value
                    .get("id")
                    .and_then(|id| id.as_str())
                    .filter(|id| is_short_id(id))
                {
                    claim_reference_id(&transaction, id, object_id)?;
                }
            }
        }
    }
    for entry in &mut entries {
        if entry.kind == "directory" {
            entry.id = format!("folder:{}", entry.path);
            continue;
        }
        let state = &states[&entry.path];
        let searchable = is_markdown(Path::new(&entry.path)) && entry.size <= MAX_DOCUMENT_BYTES;
        let cached = old.get(&entry.path).filter(|cached| {
            reuse
                && !state.stamp.is_empty()
                && cached.stamp == state.stamp
                && cached.native_key == state.key
                && is_short_id(&cached.id)
                && (!searchable || cached.indexed)
        });
        // Only searchable Markdown needs a retained buffer. Hash attachments in
        // bounded chunks instead of allocating up to 50 MiB per file per scan.
        let bytes = if cached.is_none() && searchable {
            #[cfg(test)]
            scan_cache::content_read();
            Some(fs::read(root.join(&entry.path)).map_err(|e| e.to_string())?)
        } else {
            None
        };
        let digest = match (cached, &bytes) {
            (Some(cached), _) => cached.hash.clone(),
            (_, Some(bytes)) => hash(bytes),
            _ => hash_path(&root.join(&entry.path))?,
        };
        entry.content_hash = (!digest.is_empty()).then(|| digest.clone());
        if unresolved_hashes
            .get(&entry.path)
            .is_some_and(|before| before != &digest)
        {
            return Err("扫描期间文件被外部修改，请重试".into());
        }
        let key = &native_keys[&entry.path];
        let identity = identities.get(&entry.path).copied().or_else(|| {
            (current_candidates_by_hash.get(digest.as_str()) == Some(&1))
                .then(|| unique_unclaimed(missing_by_hash.get(digest.as_str()), &claimed))
                .flatten()
        });
        entry.id = match identity.filter(|cached| is_short_id(&cached.id)) {
            Some(cached) => cached.id.clone(),
            None => allocate_reference_id(&transaction, id)?,
        };
        let version = identity
            .map(|cached| cached.version + i64::from(cached.hash != digest))
            .unwrap_or(1);
        claimed.insert(entry.id.clone());
        if cached.is_none() {
            crate::search::update(
                &transaction,
                id,
                &entry.id,
                &entry.path,
                &digest,
                bytes.as_deref(),
            )?;
        }
        if old.get(&entry.path).is_none_or(|previous| {
            previous.id != entry.id
                || previous.version != version
                || previous.hash != digest
                || previous.native_key != *key
        }) {
            transaction.prepare_cached("INSERT INTO files (workspace_id, path, id, hash, version, deleted, native_key) VALUES (?1,?2,?3,?4,?6,0,?5) ON CONFLICT(workspace_id,path) DO UPDATE SET id=excluded.id, version=excluded.version, hash=excluded.hash, deleted=0, native_key=excluded.native_key")
                .map_err(|e| e.to_string())?.execute(params![id, entry.path, entry.id, digest, key, version]).map_err(|e| e.to_string())?;
        }
        if cached.is_none() {
            let after = scan_cache::state(&root.join(&entry.path));
            // A racing writer must never associate old bytes with a newer stamp.
            let stamp = if scan_cache::unchanged(state, &after) {
                &state.stamp
            } else {
                ""
            };
            transaction.prepare_cached("INSERT INTO scan_fingerprints VALUES(?1,?2,?3,?4)
                ON CONFLICT(workspace_id,path) DO UPDATE SET hash=excluded.hash,stamp=excluded.stamp")
                .map_err(|e| e.to_string())?.execute(params![id, entry.path, digest, stamp]).map_err(|e| e.to_string())?;
        }
    }
    transaction
        .execute(
            "DELETE FROM scan_fingerprints WHERE workspace_id=?1 AND NOT EXISTS (
        SELECT 1 FROM files f WHERE f.workspace_id=scan_fingerprints.workspace_id
        AND f.path=scan_fingerprints.path AND f.deleted=0)",
            [id],
        )
        .map_err(|e| e.to_string())?;
    crate::search::prune(&transaction, id)?;
    crate::identity_manifest::publish(&transaction, root, id)?;
    transaction.commit().map_err(|e| e.to_string())?;
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(Workspace {
        id: id.into(),
        name: root
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into(),
        path: display_path(root),
        files: entries,
        newly_created: None,
        reinitialized: None,
    })
}

pub fn read(path: &Path) -> Result<Snapshot, String> {
    if !is_markdown(path)
        && !is_data_table(path)
        && path.file_name().is_none_or(|name| {
            name != "capabilities.json"
                && !name.to_string_lossy().ends_with(".tano.json")
                && !name.to_string_lossy().ends_with(".tano-relations.json")
        })
    {
        return Err("当前版本仅编辑 Markdown 文档和数据表".into());
    }
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    if metadata.len() > MAX_DOCUMENT_BYTES {
        return Err("文档大于 8 MB，请使用外部编辑器".into());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let content = String::from_utf8(bytes.clone()).map_err(|_| "文档必须使用 UTF-8 编码")?;
    Ok(Snapshot {
        content,
        hash: hash(&bytes),
        modified: modified(&metadata),
    })
}

pub fn temporary(path: &Path, content: &[u8]) -> Result<tempfile::NamedTempFile, String> {
    let mut file = tempfile::Builder::new()
        .prefix(".tano-")
        .tempfile_in(path.parent().ok_or("无效路径")?)
        .map_err(|e| e.to_string())?;
    file.write_all(content).map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    Ok(file)
}

pub fn create_atomic(path: &Path, content: &[u8]) -> Result<(), String> {
    temporary(path, content)?
        .persist_noclobber(path)
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn create(path: &Path, content: &str) -> Result<(), String> {
    if !is_markdown(path)
        && !is_data_table(path)
        && path.file_name().is_none_or(|name| {
            name != "capabilities.json"
                && !name.to_string_lossy().ends_with(".tano.json")
                && !name.to_string_lossy().ends_with(".tano-relations.json")
        })
    {
        return Err("请使用 .md、.markdown 或 .table.json 扩展名".into());
    }
    if content.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err("文档不能超过 8 MB".into());
    }
    create_atomic(path, content.as_bytes())
}

pub fn write(path: &Path, content: &str, expected: &str) -> Result<WriteResult, String> {
    if !path.exists() {
        return Ok(WriteResult::Missing);
    }
    if content.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err("文档不能超过 8 MB".into());
    }
    let current = read(path)?;
    if current.hash != expected {
        return Ok(WriteResult::Conflict { snapshot: current });
    }
    if content == current.content {
        return Ok(WriteResult::Saved { snapshot: current });
    }
    let staged = temporary(path, content.as_bytes())?;
    staged
        .as_file()
        .set_permissions(fs::metadata(path).map_err(|e| e.to_string())?.permissions())
        .map_err(|e| e.to_string())?;
    // Check again after staging: an external writer may have changed the file during I/O.
    if !path.exists() {
        return Ok(WriteResult::Missing);
    }
    let latest = read(path)?;
    if latest.hash != expected {
        return Ok(WriteResult::Conflict { snapshot: latest });
    }
    staged.persist(path).map_err(|e| e.to_string())?;
    // Return exactly the bytes we committed, not a potentially newer external write.
    Ok(WriteResult::Saved {
        snapshot: Snapshot {
            content: content.into(),
            hash: hash(content.as_bytes()),
            modified: modified(&fs::metadata(path).map_err(|e| e.to_string())?),
        },
    })
}

#[cfg(windows)]
fn rename_noclobber(source: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::MoveFileExW;
    let from: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    // Without MOVEFILE_REPLACE_EXISTING, a concurrent destination creation fails safely.
    if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), 0) } == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}

#[cfg(any(target_os = "android", target_os = "linux"))]
fn rename_noclobber(source: &Path, destination: &Path) -> Result<(), String> {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    let from = CString::new(source.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
    let to = CString::new(destination.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
    // renameat2 preserves the inode and atomically refuses an existing destination.
    // Android API 26–29 needs the syscall because Bionic lacks the wrapper.
    // SAFETY: both C strings outlive the syscall; no pointer is retained.
    let result = unsafe {
        libc::syscall(
            libc::SYS_renameat2,
            libc::AT_FDCWD,
            from.as_ptr(),
            libc::AT_FDCWD,
            to.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    if result != 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}

#[cfg(not(any(windows, target_os = "android", target_os = "linux")))]
fn rename_noclobber(source: &Path, destination: &Path) -> Result<(), String> {
    fs::hard_link(source, destination).map_err(|e| e.to_string())?;
    if let Err(error) = fs::remove_file(source) {
        let _ = fs::remove_file(destination);
        return Err(error.to_string());
    }
    Ok(())
}

pub fn rename(
    root: &Path,
    workspace_id: &str,
    from: &str,
    to: &str,
    cache: &Path,
) -> Result<(), String> {
    let source = resolve(root, from, true)?;
    let destination = resolve(root, to, false)?;
    if !source.is_file() || !(is_markdown(&destination) || is_data_table(&destination)) {
        return Err("只能重命名 Markdown 文件和数据表".into());
    }
    move_entry(root, workspace_id, from, to, cache)
}

pub fn move_entry(
    root: &Path,
    workspace_id: &str,
    from: &str,
    to: &str,
    cache: &Path,
) -> Result<(), String> {
    if from == to || to.starts_with(&format!("{from}/")) {
        return Err("不能将文件夹移动到自身或子文件夹".into());
    }
    let source = resolve_storage(root, from, true)?;
    let destination = if is_workspace_data_path(to) {
        ensure_file_parent(root, to)?
    } else {
        resolve(root, to, false)?
    };
    let metadata = fs::symlink_metadata(&source).map_err(|e| e.to_string())?;
    if !metadata.is_file() && !metadata.is_dir() {
        return Err("只能移动普通文件或文件夹".into());
    }
    if destination.exists() {
        return Err("目标名称已经存在".into());
    }
    let mut connection = database(cache)?;
    let transaction = connection.transaction().map_err(|e| e.to_string())?;
    let destination_prefix = format!("{to}/");
    transaction
        .execute(
            "DELETE FROM files WHERE workspace_id=?1 AND (path=?2 OR substr(path,1,length(?3))=?3)",
            params![workspace_id, to, destination_prefix],
        )
        .map_err(|e| e.to_string())?;
    crate::identity_manifest::begin_move(root, workspace_id, cache, from, to)?;
    rename_noclobber(&source, &destination)?;
    let source_prefix = format!("{from}/");
    transaction
        .execute(
            "UPDATE files SET path=?1 || substr(path,length(?2)+1) WHERE workspace_id=?3 AND (path=?2 OR substr(path,1,length(?4))=?4)",
            params![to, from, workspace_id, source_prefix],
        )
        .map_err(|e| e.to_string())?;
    transaction.commit().map_err(|e| e.to_string())?;
    crate::identity_manifest::recover_move(root, workspace_id, cache)?;
    Ok(())
}

fn check_copy_tree(source: &Path, count: &mut usize) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink() || (!metadata.is_file() && !metadata.is_dir()) {
        return Err("副本包含符号链接或不支持的文件类型".into());
    }
    *count += 1;
    if *count > MAX_WORKSPACE_ENTRIES {
        return Err(format!("副本超过 {MAX_WORKSPACE_ENTRIES} 个文件或文件夹"));
    }
    if metadata.is_dir() {
        for item in fs::read_dir(source).map_err(|e| e.to_string())? {
            check_copy_tree(&item.map_err(|e| e.to_string())?.path(), count)?;
        }
    }
    Ok(())
}

fn copy_tree(source: &Path, destination: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("复制时遇到符号链接，已停止".into());
    }
    if metadata.is_dir() {
        fs::create_dir(destination).map_err(|e| e.to_string())?;
        for item in fs::read_dir(source).map_err(|e| e.to_string())? {
            let item = item.map_err(|e| e.to_string())?;
            copy_tree(&item.path(), &destination.join(item.file_name()))?;
        }
    } else if metadata.is_file() {
        let mut input = fs::File::open(source).map_err(|e| e.to_string())?;
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(destination)
            .map_err(|e| e.to_string())?;
        std::io::copy(&mut input, &mut output).map_err(|e| e.to_string())?;
        output.sync_all().map_err(|e| e.to_string())?;
    } else {
        return Err("只能复制普通文件或文件夹".into());
    }
    Ok(())
}

pub fn duplicate_entry(root: &Path, from: &str) -> Result<String, String> {
    let source = resolve(root, from, true)?;
    let metadata = fs::symlink_metadata(&source).map_err(|e| e.to_string())?;
    if !metadata.is_file() && !metadata.is_dir() {
        return Err("只能复制普通文件或文件夹".into());
    }
    let mut count = 0;
    check_copy_tree(&source, &mut count)?;
    let name = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("文件名包含无法复制的字符")?;
    let (stem, extension) = if metadata.is_file() && is_data_table(&source) {
        name.split_at(name.len() - ".table.json".len())
    } else if metadata.is_file() {
        match name.rfind('.') {
            Some(dot) if dot > 0 => (&name[..dot], &name[dot..]),
            _ => (name, ""),
        }
    } else {
        (name, "")
    };
    let parent = from.rsplit_once('/').map(|(parent, _)| parent);
    for number in 1..=10_000 {
        let suffix = if number == 1 {
            " 副本".to_string()
        } else {
            format!(" 副本 {number}")
        };
        let candidate = format!("{stem}{suffix}{extension}");
        let relative = match parent {
            Some(parent) => format!("{parent}/{candidate}"),
            None => candidate,
        };
        let destination = resolve(root, &relative, false)?;
        if destination.exists() {
            continue;
        }
        copy_tree(&source, &destination).map_err(|error| {
            format!("创建副本失败；若目标已出现，请检查部分内容：{relative}（{error}）")
        })?;
        return Ok(relative);
    }
    Err("副本名称已用尽".into())
}

#[cfg(test)]
#[path = "storage_cross_volume_tests.rs"]
mod cross_volume_tests;

#[cfg(test)]
#[path = "storage_scan_cache_tests.rs"]
mod scan_cache_tests;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_core_portable_views_metadata_and_binary_revisions_survive_index_rebuild() {
        let temp = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let db = cache.path().join("first.sqlite");
        let id = workspace_identity(temp.path()).unwrap();
        fs::write(temp.path().join("paper.pdf"), b"%PDF-1.7 first").unwrap();
        let first = scan(temp.path(), &id, &db).unwrap();
        let file_id = first.files[0].id.clone();
        assert_eq!(first.files[0].content_hash, Some(hash(b"%PDF-1.7 first")));
        fs::create_dir_all(temp.path().join(".tano/views")).unwrap();
        fs::create_dir_all(temp.path().join(".tano/files")).unwrap();
        let metadata = format!(".tano/files/{file_id}.tano.json");
        let view = ".tano/views/research.tano.json";
        create(
            &resolve_storage(&fs::canonicalize(temp.path()).unwrap(), &metadata, false).unwrap(),
            "{\"tags\":[\"paper\"]}",
        )
        .unwrap();
        create(
            &resolve_storage(&fs::canonicalize(temp.path()).unwrap(), view, false).unwrap(),
            "{\"sources\":[]}",
        )
        .unwrap();
        let base = read(&temp.path().join(&metadata)).unwrap();
        fs::write(temp.path().join(&metadata), "{\"tags\":[\"external\"]}").unwrap();
        assert!(matches!(
            write(&temp.path().join(&metadata), "{}", &base.hash).unwrap(),
            WriteResult::Conflict { .. }
        ));
        fs::rename(
            temp.path().join("paper.pdf"),
            temp.path().join("renamed.pdf"),
        )
        .unwrap();
        fs::write(temp.path().join("renamed.pdf"), b"%PDF-1.7 changed").unwrap();
        let next = scan(temp.path(), &id, &db).unwrap();
        let file = next.files.iter().find(|file| file.id == file_id).unwrap();
        assert_eq!(file.path, "renamed.pdf");
        assert_eq!(file.content_hash, Some(hash(b"%PDF-1.7 changed")));
        let rebuilt = scan(temp.path(), &id, &cache.path().join("rebuilt.sqlite")).unwrap();
        assert_eq!(
            rebuilt
                .files
                .iter()
                .find(|file| file.path == "renamed.pdf")
                .unwrap()
                .id,
            file_id
        );
        assert!(rebuilt.files.iter().any(|file| file.path == metadata));
        assert!(rebuilt.files.iter().any(|file| file.path == view));
        assert!(!is_workspace_data_path(".tano/views/../escape.tano.json"));
        assert!(!is_workspace_data_path(".tano/files/not-an-id.tano.json"));
    }

    #[test]
    fn large_binary_has_a_streamed_revision_and_content_move_identity() {
        let temp = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let db = cache.path().join("cache.sqlite");
        fs::File::create(temp.path().join("large.bin"))
            .unwrap()
            .set_len(51 * 1024 * 1024)
            .unwrap();
        let first = scan(temp.path(), "workspace", &db).unwrap();
        assert_eq!(first.files[0].content_hash.as_ref().unwrap().len(), 64);
        database(&db)
            .unwrap()
            .execute("UPDATE files SET native_key=''", [])
            .unwrap();
        fs::rename(temp.path().join("large.bin"), temp.path().join("moved.bin")).unwrap();
        let after = scan(temp.path(), "workspace", &db).unwrap();
        assert_eq!(first.files[0].id, after.files[0].id);
        assert_eq!(first.files[0].content_hash, after.files[0].content_hash);
    }

    #[test]
    fn display_path_handles_windows_local_and_unc_prefixes() {
        assert_eq!(display_path(Path::new(r"\\?\C:\Notes")), r"C:\Notes");
        assert_eq!(
            display_path(Path::new(r"\\?\UNC\server\share\Notes")),
            r"\\server\share\Notes"
        );
    }

    #[test]
    fn duplicate_entry_preserves_contents_and_chooses_unused_sibling_names() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::write(root.join("note.md"), "原文").unwrap();
        fs::write(root.join("note 副本.md"), "原有副本").unwrap();
        assert_eq!(duplicate_entry(&root, "note.md").unwrap(), "note 副本 2.md");
        assert_eq!(
            fs::read_to_string(root.join("note 副本.md")).unwrap(),
            "原有副本"
        );
        assert_eq!(
            fs::read_to_string(root.join("note 副本 2.md")).unwrap(),
            "原文"
        );

        fs::create_dir_all(root.join("资料/子目录")).unwrap();
        fs::write(root.join("资料/子目录/image.bin"), [0, 1, 255]).unwrap();
        assert_eq!(duplicate_entry(&root, "资料").unwrap(), "资料 副本");
        assert_eq!(
            fs::read(root.join("资料 副本/子目录/image.bin")).unwrap(),
            [0, 1, 255]
        );
        assert_eq!(duplicate_entry(&root, "资料").unwrap(), "资料 副本 2");
        assert!(duplicate_entry(&root, "../outside").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn duplicate_entry_rejects_nested_symlinks_before_creating_a_destination() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::create_dir(root.join("资料")).unwrap();
        std::os::unix::fs::symlink(temp.path(), root.join("资料/shortcut")).unwrap();
        assert!(duplicate_entry(&root, "资料").is_err());
        assert!(!root.join("资料 副本").exists());
    }

    #[test]
    fn walk_stops_at_entry_limit_even_in_one_directory() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        for name in ["one.md", "two.md", "three.md"] {
            fs::write(root.join(name), name).unwrap();
        }
        let mut entries = Vec::new();
        let error = walk(&root, &root, &mut entries, 2, &mut 0).unwrap_err();
        assert!(error.contains("超过 2 个文件或文件夹"));
        assert_eq!(entries.len(), 2);
    }

    #[test]
    fn reject_escape_and_hidden_paths() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        for path in [
            "../outside.md",
            "/outside.md",
            "C:/outside.md",
            ".tano/config.json",
            "a\\b.md",
        ] {
            assert!(resolve(&root, path, false).is_err(), "{path}");
        }
        assert!(resolve(&root, "note.md", false).is_ok());
    }

    #[test]
    fn stale_save_preserves_external_file() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("note.md");
        create(&path, "base").unwrap();
        let base = read(&path).unwrap();
        fs::write(&path, "agent").unwrap();
        assert!(matches!(
            write(&path, "human", &base.hash).unwrap(),
            WriteResult::Conflict { .. }
        ));
        assert_eq!(read(&path).unwrap().content, "agent");
    }

    #[test]
    fn atomic_save_create_and_deleted_file() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("note.md");
        create(&path, "同页").unwrap();
        assert!(create(&path, "overwrite").is_err());
        let base = read(&path).unwrap();
        assert!(matches!(
            write(&path, "hello", &base.hash).unwrap(),
            WriteResult::Saved { .. }
        ));
        assert_eq!(read(&path).unwrap().content, "hello");
        fs::remove_file(&path).unwrap();
        assert!(matches!(
            write(&path, "resurrect", &base.hash).unwrap(),
            WriteResult::Missing
        ));
    }

    #[test]
    fn identity_survives_rename_and_external_rename() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        let cache_dir = tempfile::tempdir().unwrap();
        let db = cache_dir.path().join("cache.sqlite");
        let workspace_id = workspace_identity(&root).unwrap();
        assert_eq!(workspace_id, workspace_identity(&root).unwrap());
        create(&root.join("first.md"), "content").unwrap();
        let first = scan(&root, &workspace_id, &db).unwrap();
        rename(&root, &workspace_id, "first.md", "next.md", &db).unwrap();
        let next = scan(&root, &workspace_id, &db).unwrap();
        assert_eq!(first.files[0].id, next.files[0].id);
        fs::rename(root.join("next.md"), root.join("external.md")).unwrap();
        let external = scan(&root, &workspace_id, &db).unwrap();
        assert_eq!(first.files[0].id, external.files[0].id);
    }

    #[cfg(any(windows, target_os = "linux", target_os = "android"))]
    #[test]
    fn moving_a_folder_keeps_descendant_identities_and_never_overwrites() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        let cache_dir = tempfile::tempdir().unwrap();
        let db = cache_dir.path().join("cache.sqlite");
        let workspace_id = workspace_identity(&root).unwrap();
        fs::create_dir(root.join("source")).unwrap();
        fs::create_dir(root.join("source/nested")).unwrap();
        fs::create_dir(root.join("archive")).unwrap();
        create(&root.join("source/nested/note.md"), "content").unwrap();
        fs::write(root.join("source/image.png"), b"image").unwrap();
        let before = scan(&root, &workspace_id, &db).unwrap();
        let note_id = before
            .files
            .iter()
            .find(|entry| entry.path == "source/nested/note.md")
            .unwrap()
            .id
            .clone();
        let image_id = before
            .files
            .iter()
            .find(|entry| entry.path == "source/image.png")
            .unwrap()
            .id
            .clone();

        move_entry(&root, &workspace_id, "source", "archive/source", &db).unwrap();
        let after = scan(&root, &workspace_id, &db).unwrap();
        assert_eq!(
            after
                .files
                .iter()
                .find(|entry| entry.path == "archive/source/nested/note.md")
                .unwrap()
                .id,
            note_id
        );
        assert_eq!(
            after
                .files
                .iter()
                .find(|entry| entry.path == "archive/source/image.png")
                .unwrap()
                .id,
            image_id
        );
        assert!(!root.join("source").exists());
        assert!(move_entry(
            &root,
            &workspace_id,
            "archive/source",
            "archive/source/nested/copy",
            &db
        )
        .is_err());
        fs::create_dir(root.join("source")).unwrap();
        assert!(move_entry(&root, &workspace_id, "archive/source", "source", &db).is_err());
        assert_eq!(
            fs::read(root.join("archive/source/image.png")).unwrap(),
            b"image"
        );
    }

    #[test]
    fn binary_identity_survives_rename_and_in_place_edit() {
        let temp = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let db = cache.path().join("cache.sqlite");
        let source = temp.path().join("image.bin");
        let target = temp.path().join("renamed.bin");
        fs::write(&source, [0, 255, 128, 1]).unwrap();
        let first = scan(temp.path(), "workspace", &db).unwrap();
        fs::rename(&source, &target).unwrap();
        fs::write(&target, [2, 254, 129, 3]).unwrap();
        let next = scan(temp.path(), "workspace", &db).unwrap();
        assert_eq!(first.files[0].id, next.files[0].id);
        assert_eq!(next.files[0].path, "renamed.bin");
        let version: i64 = database(&db)
            .unwrap()
            .query_row(
                "SELECT version FROM files WHERE path='renamed.bin'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(version, 2);
        // Identical content in two different files must not collapse their identities.
        fs::copy(&target, &source).unwrap();
        let copied = scan(temp.path(), "workspace", &db).unwrap();
        assert_ne!(copied.files[0].id, copied.files[1].id);
    }

    #[test]
    fn identity_follows_exchanged_files_and_does_not_transfer_to_a_replacement() {
        let temp = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let db = cache.path().join("cache.sqlite");
        let root = temp.path();
        fs::write(root.join("first.md"), "first document marker").unwrap();
        fs::write(root.join("second.md"), "second document marker").unwrap();
        let ids = |snapshot: Workspace| -> HashMap<String, String> {
            snapshot
                .files
                .into_iter()
                .map(|entry| (entry.path, entry.id))
                .collect()
        };
        let before = ids(scan(root, "workspace", &db).unwrap());
        fs::rename(root.join("first.md"), root.join("temporary.md")).unwrap();
        fs::rename(root.join("second.md"), root.join("first.md")).unwrap();
        fs::rename(root.join("temporary.md"), root.join("second.md")).unwrap();
        fs::write(
            root.join("second.md"),
            "first document edited during exchange",
        )
        .unwrap();
        let exchanged = ids(scan(root, "workspace", &db).unwrap());
        assert_eq!(exchanged["first.md"], before["second.md"]);
        assert_eq!(exchanged["second.md"], before["first.md"]);
        let hits = crate::search::query(&db, "workspace", "edited during exchange").unwrap();
        assert_eq!(hits[0].id, before["first.md"]);
        assert_eq!(hits[0].path, "second.md");
        fs::rename(root.join("first.md"), root.join("moved.md")).unwrap();
        fs::write(root.join("first.md"), "new document occupies old path").unwrap();
        let replaced = ids(scan(root, "workspace", &db).unwrap());
        assert_eq!(replaced["moved.md"], before["second.md"]);
        assert_ne!(replaced["first.md"], before["second.md"]);
        assert_ne!(replaced["first.md"], before["first.md"]);
        assert_eq!(replaced.values().collect::<HashSet<_>>().len(), 3);
        // Atomic-save tools replace an inode without moving the original file
        // elsewhere. That remains an edit of the same path/UUID.
        let saved = read(&root.join("first.md")).unwrap();
        assert!(matches!(
            write(&root.join("first.md"), "atomic editor update", &saved.hash).unwrap(),
            WriteResult::Saved { .. }
        ));
        let atomic = ids(scan(root, "workspace", &db).unwrap());
        assert_eq!(atomic["first.md"], replaced["first.md"]);
    }

    #[cfg(not(target_os = "android"))]
    #[test]
    fn a_new_hardlink_does_not_steal_the_existing_paths_identity() {
        let temp = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let db = cache.path().join("cache.sqlite");
        fs::write(temp.path().join("original.md"), "shared bytes").unwrap();
        let before = scan(temp.path(), "workspace", &db).unwrap();
        fs::hard_link(
            temp.path().join("original.md"),
            temp.path().join("alias.md"),
        )
        .unwrap();
        let after = scan(temp.path(), "workspace", &db).unwrap();
        assert_eq!(
            after
                .files
                .iter()
                .find(|entry| entry.path == "original.md")
                .unwrap()
                .id,
            before.files[0].id
        );
        assert_ne!(after.files[0].id, after.files[1].id);
        // If both hardlink paths move, their shared native key is ambiguous.
        // A new equal-content file at the old path cannot claim either UUID.
        fs::rename(
            temp.path().join("original.md"),
            temp.path().join("moved-original.md"),
        )
        .unwrap();
        fs::rename(
            temp.path().join("alias.md"),
            temp.path().join("moved-alias.md"),
        )
        .unwrap();
        fs::write(temp.path().join("original.md"), "shared bytes").unwrap();
        let moved = scan(temp.path(), "workspace", &db).unwrap();
        for entry in &moved.files {
            assert!(after.files.iter().all(|old| old.id != entry.id));
        }
        assert_eq!(
            moved
                .files
                .iter()
                .map(|entry| &entry.id)
                .collect::<HashSet<_>>()
                .len(),
            3
        );
    }

    #[test]
    fn replaces_non_short_cached_identities_without_rewriting_content() {
        let temp = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let db = cache.path().join("cache.sqlite");
        fs::write(temp.path().join("note.md"), "old").unwrap();
        let connection = Connection::open(&db).unwrap();
        connection.execute_batch("CREATE TABLE files (workspace_id TEXT NOT NULL, path TEXT NOT NULL, id TEXT NOT NULL, hash TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (workspace_id,path));").unwrap();
        connection
            .execute(
                "INSERT INTO files VALUES ('workspace','note.md','retained-id',?1,7,0)",
                [hash(b"old")],
            )
            .unwrap();
        drop(connection);
        let migrated = scan(temp.path(), "workspace", &db).unwrap();
        assert!(is_short_id(&migrated.files[0].id));
        assert_eq!(
            fs::read_to_string(temp.path().join("note.md")).unwrap(),
            "old"
        );
        assert_eq!(
            scan(temp.path(), "workspace", &db).unwrap().files[0].id,
            migrated.files[0].id
        );
        let connection = database(&db).unwrap();
        let (version, key): (i64, String) = connection
            .query_row(
                "SELECT version,native_key FROM files WHERE path='note.md'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(version, 7);
        assert!(!key.is_empty());
    }

    #[test]
    fn rename_candidates_keep_ambiguous_hashes_separate() {
        let temp = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let db = cache.path().join("cache.sqlite");
        for name in ["one.md", "two.md"] {
            fs::write(temp.path().join(name), "identical content").unwrap();
        }
        let first = scan(temp.path(), "workspace", &db).unwrap();
        // Simulate a legacy/cross-volume cache with no native identity: two
        // vanished equal-content files must not be assigned by iteration order.
        database(&db)
            .unwrap()
            .execute("UPDATE files SET native_key=''", [])
            .unwrap();
        fs::rename(temp.path().join("one.md"), temp.path().join("new-one.md")).unwrap();
        fs::rename(temp.path().join("two.md"), temp.path().join("new-two.md")).unwrap();
        let next = scan(temp.path(), "workspace", &db).unwrap();
        assert_ne!(next.files[0].id, next.files[1].id);
        for file in &next.files {
            assert!(first.files.iter().all(|old| old.id != file.id));
        }

        // Native identities distinguish identical content, including a source
        // renamed and edited while another equal-content source also moves.
        fs::rename(
            temp.path().join("new-one.md"),
            temp.path().join("final-one.md"),
        )
        .unwrap();
        fs::write(temp.path().join("final-one.md"), "changed while renamed").unwrap();
        fs::rename(
            temp.path().join("new-two.md"),
            temp.path().join("final-two.md"),
        )
        .unwrap();
        let final_scan = scan(temp.path(), "workspace", &db).unwrap();
        assert_eq!(next.files[0].id, final_scan.files[0].id);
        assert_eq!(next.files[1].id, final_scan.files[1].id);
    }

    #[test]
    fn one_missing_identity_is_not_assigned_to_either_equal_content_copy() {
        let directory = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(directory.path()).unwrap();
        let id = workspace_identity(&root).unwrap();
        let cache = data.path().join("index.sqlite");
        fs::write(root.join("old.md"), "same bytes").unwrap();
        let original = scan(&root, &id, &cache).unwrap().files[0].id.clone();
        fs::rename(root.join("old.md"), root.join("copy-a.md")).unwrap();
        fs::write(root.join("copy-b.md"), "same bytes").unwrap();
        fs::remove_file(&cache).unwrap();
        let restored = scan(&root, &id, &cache).unwrap();
        assert_eq!(restored.files.len(), 2);
        assert!(restored.files.iter().all(|file| file.id != original));
        assert_ne!(restored.files[0].id, restored.files[1].id);
        assert!(crate::identity_manifest::read(&root, &id)
            .unwrap()
            .unwrap()
            .reserved_ids
            .contains(&original));
    }

    #[test]
    fn rename_never_overwrites_an_existing_document() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        let cache_dir = tempfile::tempdir().unwrap();
        let db = cache_dir.path().join("cache.sqlite");
        create(&root.join("source.md"), "human").unwrap();
        create(&root.join("destination.md"), "agent").unwrap();
        assert!(rename(&root, "workspace", "source.md", "destination.md", &db).is_err());
        assert_eq!(read(&root.join("source.md")).unwrap().content, "human");
        assert_eq!(read(&root.join("destination.md")).unwrap().content, "agent");
    }

    #[test]
    fn rejects_non_utf8_without_modifying_the_file() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("legacy.md");
        let original = [0xff, 0xfe, 0x61, 0x00];
        fs::write(&path, original).unwrap();
        assert!(read(&path).is_err());
        assert!(write(&path, "new", &hash(&original)).is_err());
        assert_eq!(fs::read(&path).unwrap(), original);
    }

    #[test]
    fn invalid_workspace_configuration_is_not_replaced() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join(".tano");
        fs::create_dir(&dir).unwrap();
        let path = dir.join("config.json");
        fs::write(&path, "invalid JSON").unwrap();
        assert!(workspace_identity(temp.path()).is_err());
        assert_eq!(fs::read_to_string(path).unwrap(), "invalid JSON");
    }

    #[test]
    fn old_hidden_data_is_ignored_and_never_migrated() {
        let temp = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        let cache = data.path().join("index.sqlite");
        fs::create_dir_all(root.join(".workspace/objects")).unwrap();
        let old_id = Uuid::new_v4().to_string();
        let config = serde_json::json!({ "id": old_id, "format": 1 }).to_string();
        fs::write(root.join(".workspace/config.json"), &config).unwrap();
        fs::write(
            root.join(".workspace/objects/a00001.tano.json"),
            "original bytes",
        )
        .unwrap();
        fs::write(root.join("note.md"), "# Note").unwrap();

        let id = workspace_identity(&root).unwrap();
        assert_ne!(id, old_id);
        assert_eq!(workspace_identity(&root).unwrap(), id);
        let indexed = scan(&root, &id, &cache).unwrap();
        assert_eq!(indexed.files.len(), 1);
        assert_eq!(indexed.files[0].path, "note.md");
        assert_eq!(
            fs::read_to_string(root.join(".workspace/config.json")).unwrap(),
            config
        );
        assert_eq!(
            fs::read_to_string(root.join(".workspace/objects/a00001.tano.json")).unwrap(),
            "original bytes"
        );
        assert!(!root.join(".tano/objects").exists());

        for path in [
            ".workspace/config.json",
            ".workspace/objects/a00001.tano.json",
            ".workspace/capabilities.json",
            ".workspace/relations.tano-relations.json",
            ".workspace/conflicts/copy.json",
        ] {
            assert!(!is_workspace_data_path(path));
            assert!(resolve_storage(&root, path, false).is_err());
            assert!(ensure_file_parent(&root, path).is_err());
        }
        assert!(!is_workspace_data_directory(".workspace"));
        for path in [
            ".tano/annotations/a0b1c2.tano.json",
            ".tano/discussions/a0b1c2.tano.json",
            ".tano/document-layout/a0b1c2.tano.json",
            ".tano/suggestions/a0b1c2.tano.json",
            ".tano/rules/assistant.md",
            ".tano/templates/a0b1c2.md",
        ] {
            assert!(is_workspace_data_path(path));
            assert!(ensure_file_parent(&root, path).is_ok());
            assert!(resolve_storage(&root, path, false).is_ok());
        }
        assert!(!is_workspace_data_path(
            ".tano/annotations/not-an-id.tano.json"
        ));
        assert!(!is_workspace_data_directory(".workspace/objects"));
    }

    #[test]
    fn unrelated_hidden_configs_do_not_affect_tano_identity() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        let id = workspace_identity(&root).unwrap();
        let config = fs::read(root.join(".tano/config.json")).unwrap();
        fs::create_dir(root.join(".workspace")).unwrap();
        let old = root.join(".workspace/config.json");
        fs::write(&old, "invalid JSON").unwrap();
        assert_eq!(workspace_identity(&root).unwrap(), id);
        assert_eq!(fs::read_to_string(&old).unwrap(), "invalid JSON");
        assert_eq!(fs::read(root.join(".tano/config.json")).unwrap(), config);
        assert!(resolve_storage(&root, ".tano/config.json", true).is_err());
    }

    #[test]
    fn data_tables_are_portable_and_use_compared_writes() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        let cache = tempfile::tempdir().unwrap();
        let id = workspace_identity(&root).unwrap();
        let relative = ".tano/tables/a0b1c2.tano.json";
        let path = ensure_file_parent(&root, relative).unwrap();
        create(&path, r#"{"version":1,"id":"a0b1c2","rows":[]}"#).unwrap();
        let base = read(&path).unwrap();
        let scanned = scan(&root, &id, &cache.path().join("index.sqlite")).unwrap();
        assert!(scanned.files.iter().any(|entry| entry.path == relative));
        fs::write(&path, "external table").unwrap();
        assert!(matches!(
            write(&path, "local table", &base.hash).unwrap(),
            WriteResult::Conflict { .. }
        ));
        assert_eq!(read(&path).unwrap().content, "external table");
        for invalid in [
            ".tano/tables/not-an-id.tano.json",
            ".tano/tables/../config.json",
            ".tano/tables/ABCDEF.tano.json",
        ] {
            assert!(resolve_storage(&root, invalid, false).is_err());
        }
    }

    #[test]
    fn visible_data_tables_move_duplicate_and_save_as_ordinary_workspace_files() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        let cache = tempfile::tempdir().unwrap();
        let db = cache.path().join("index.sqlite");
        let workspace_id = workspace_identity(&root).unwrap();
        fs::create_dir(root.join("研究")).unwrap();
        let source = resolve(&root, "研究/候选.table.json", false).unwrap();
        create(&source, r#"{"version":1,"id":"a0b1c2","rows":[]}"#).unwrap();
        let scanned = scan(&root, &workspace_id, &db).unwrap();
        let file_id = scanned
            .files
            .iter()
            .find(|file| file.path == "研究/候选.table.json")
            .unwrap()
            .id
            .clone();
        rename(
            &root,
            &workspace_id,
            "研究/候选.table.json",
            "研究/改名.table.json",
            &db,
        )
        .unwrap();
        move_entry(&root, &workspace_id, "研究", "归档", &db).unwrap();
        let moved = scan(&root, &workspace_id, &db).unwrap();
        assert_eq!(
            moved
                .files
                .iter()
                .find(|file| file.path == "归档/改名.table.json")
                .unwrap()
                .id,
            file_id
        );
        let path = resolve(&root, "归档/改名.table.json", true).unwrap();
        let base = read(&path).unwrap();
        assert!(matches!(
            write(&path, "changed", &base.hash).unwrap(),
            WriteResult::Saved { .. }
        ));
        assert!(matches!(
            write(&path, "stale", &base.hash).unwrap(),
            WriteResult::Conflict { .. }
        ));
        assert_eq!(
            duplicate_entry(&root, "归档/改名.table.json").unwrap(),
            "归档/改名 副本.table.json"
        );
        assert_eq!(
            read(&root.join("归档/改名 副本.table.json"))
                .unwrap()
                .content,
            "changed"
        );
        assert!(!source.exists());
        assert!(resolve(&root, "../outside.table.json", false).is_err());
    }

    #[test]
    fn table_layout_files_are_portable_and_use_compared_writes() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        let cache = tempfile::tempdir().unwrap();
        let id = workspace_identity(&root).unwrap();
        let relative = ".tano/document-layout/a0b1c2.tano.json";
        let path = ensure_file_parent(&root, relative).unwrap();
        create(&path, r#"{"version":1,"fileId":"a0b1c2","tables":[]}"#).unwrap();
        let base = read(&path).unwrap();
        let scanned = scan(&root, &id, &cache.path().join("index.sqlite")).unwrap();
        assert!(scanned.files.iter().any(|entry| entry.path == relative));
        fs::write(&path, "external layout").unwrap();
        assert!(matches!(
            write(&path, "local layout", &base.hash).unwrap(),
            WriteResult::Conflict { .. }
        ));
        assert_eq!(read(&path).unwrap().content, "external layout");
        assert!(
            resolve_storage(&root, ".tano/document-layout/not-an-id.tano.json", false).is_err()
        );
    }

    #[test]
    fn suggestion_files_are_portable_and_never_overwrite_external_edits() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        let cache = tempfile::tempdir().unwrap();
        let id = workspace_identity(&root).unwrap();
        let relative = ".tano/suggestions/a0b1c2.tano.json";
        let path = ensure_file_parent(&root, relative).unwrap();
        create(&path, r#"{"version":1,"suggestions":[]}"#).unwrap();
        let base = read(&path).unwrap();
        let scanned = scan(&root, &id, &cache.path().join("index.sqlite")).unwrap();
        assert!(scanned.files.iter().any(|entry| entry.path == relative));
        fs::write(&path, "external suggestion review").unwrap();
        assert!(matches!(
            write(&path, "local suggestion review", &base.hash).unwrap(),
            WriteResult::Conflict { .. }
        ));
        assert_eq!(read(&path).unwrap().content, "external suggestion review");
        assert!(resolve_storage(&root, ".tano/suggestions/not-an-id.tano.json", false).is_err());
        assert!(resolve_storage(&root, ".tano/suggestions/../config.json", false).is_err());
    }

    #[test]
    fn portable_capabilities_use_conflict_checked_writes() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        let path = ensure_file_parent(&root, ".tano/capabilities.json").unwrap();
        create(&path, "{\"features\":{\"math\":true}}").unwrap();
        let base = read(&path).unwrap();
        assert!(create(&path, "{}").is_err());
        fs::write(&path, "{\"features\":{\"math\":false}}").unwrap();
        assert!(matches!(
            write(&path, "{}", &base.hash).unwrap(),
            WriteResult::Conflict { .. }
        ));
        assert_eq!(
            read(&path).unwrap().content,
            "{\"features\":{\"math\":false}}"
        );
        let latest = read(&path).unwrap();
        assert!(matches!(
            write(&path, "{}", &latest.hash).unwrap(),
            WriteResult::Saved { .. }
        ));
        assert!(create(&temp.path().join("other.json"), "{}").is_err());
    }

    #[test]
    fn workspace_settings_are_portable_and_preserve_external_edits() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        let relative = ".tano/settings.tano.json";
        assert!(is_workspace_data_path(relative));
        let path = ensure_file_parent(&root, relative).unwrap();
        create(&path, "{\"version\":1,\"name\":\"A\"}").unwrap();
        let base = read(&path).unwrap();
        fs::write(&path, "{\"version\":1,\"name\":\"B\"}").unwrap();
        assert!(matches!(
            write(&path, "{}", &base.hash).unwrap(),
            WriteResult::Conflict { .. }
        ));
        assert_eq!(
            read(&path).unwrap().content,
            "{\"version\":1,\"name\":\"B\"}"
        );
    }
    #[test]
    fn plugin_rules_are_portable_and_conflict_checked() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        let relative = ".tano/plugins.tano.json";
        assert!(is_workspace_data_path(relative));
        assert!(!is_workspace_data_path(".tano/plugins/main.js"));
        let path = ensure_file_parent(&root, relative).unwrap();
        create(&path, "{\"version\":1,\"plugins\":[]}").unwrap();
        let base = read(&path).unwrap();
        fs::write(&path, "external rules").unwrap();
        assert!(matches!(
            write(&path, "new rules", &base.hash).unwrap(),
            WriteResult::Conflict { .. }
        ));
        assert_eq!(read(&path).unwrap().content, "external rules");
    }
    #[test]
    fn workspace_objects_use_conflict_checked_writes() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        let path = ensure_file_parent(&root, ".tano/objects/person.tano.json").unwrap();
        create(&path, "{\"id\":\"a\",\"name\":\"Alice\"}").unwrap();
        let base = read(&path).unwrap();
        assert!(create(&path, "{}").is_err());
        fs::write(&path, "external object edit").unwrap();
        assert!(matches!(
            write(&path, "ours", &base.hash).unwrap(),
            WriteResult::Conflict { .. }
        ));
        assert_eq!(read(&path).unwrap().content, "external object edit");
        let latest = read(&path).unwrap();
        assert!(matches!(
            write(&path, "updated", &latest.hash).unwrap(),
            WriteResult::Saved { .. }
        ));
        assert!(create(&temp.path().join("other.json"), "{}").is_err());
    }

    #[test]
    fn relation_files_use_compared_writes_without_opening_arbitrary_json() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        let path = ensure_file_parent(&root, ".tano/relations.tano-relations.json").unwrap();
        create(&path, r#"{"version":1,"relations":[]}"#).unwrap();
        let base = read(&path).unwrap();
        fs::write(&path, r#"{"version":1,"relations":[],"external":true}"#).unwrap();
        assert!(matches!(
            write(&path, &base.content, &base.hash).unwrap(),
            WriteResult::Conflict { .. }
        ));
        let latest = read(&path).unwrap();
        assert!(matches!(
            write(&path, &base.content, &latest.hash).unwrap(),
            WriteResult::Saved { .. }
        ));
        assert!(create(&temp.path().join("plugin.json"), "{}").is_err());
    }

    #[test]
    fn scanner_indexes_changes_without_putting_cache_in_workspace() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        let cache_dir = tempfile::tempdir().unwrap();
        let db = cache_dir.path().join("cache.sqlite");
        let id = workspace_identity(&root).unwrap();
        create(&root.join("note.md"), "first").unwrap();
        let first = scan(&root, &id, &db).unwrap();
        fs::write(root.join("note.md"), "second").unwrap();
        let second = scan(&root, &id, &db).unwrap();
        assert_eq!(first.files[0].id, second.files[0].id);
        let connection = database(&db).unwrap();
        let version: i64 = connection
            .query_row(
                "SELECT version FROM files WHERE workspace_id=? AND path='note.md'",
                [&id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(version, 2);
        assert!(!root.join("index.sqlite").exists());
        let names = fs::read_dir(root.join(".tano"))
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect::<HashSet<_>>();
        assert_eq!(
            names,
            HashSet::from(["config.json".into(), "identities.json".into()])
        );
    }
    #[test]
    fn short_ids_are_reserved_across_restarts_and_concurrent_allocations() {
        let cache = tempfile::tempdir().unwrap();
        let db = cache.path().join("cache.sqlite");
        let connection = database(&db).unwrap();
        assert!(claim_reference_id(&connection, "workspace", "a82f91").unwrap());
        drop(connection);
        let connection = database(&db).unwrap();
        assert!(!claim_reference_id(&connection, "workspace", "a82f91").unwrap());
        assert!(claim_reference_id(&connection, "other", "a82f91").unwrap());
        drop(connection);
        let threads: Vec<_> = (0..4)
            .map(|_| {
                let db = db.clone();
                std::thread::spawn(move || {
                    (0..10)
                        .map(|_| reserve_reference_id(&db, "workspace", &[]).unwrap())
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        let ids: Vec<_> = threads
            .into_iter()
            .flat_map(|thread| thread.join().unwrap())
            .collect();
        assert!(ids.iter().all(|id| is_short_id(id)));
        assert_eq!(
            ids.iter().collect::<std::collections::HashSet<_>>().len(),
            40
        );
        assert!(!ids.iter().any(|id| id == "a82f91"));
    }

    #[test]
    fn deletion_keeps_document_and_imported_object_ids_reserved() {
        let root = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let db = cache.path().join("cache.sqlite");
        fs::write(root.path().join("note.md"), "first").unwrap();
        fs::write(root.path().join("person.tano.json"), r#"{"id":"a82f91"}"#).unwrap();
        let first = scan(root.path(), "workspace", &db).unwrap();
        let old = first
            .files
            .iter()
            .find(|file| file.path == "note.md")
            .unwrap()
            .id
            .clone();
        assert!(is_short_id(&old));
        fs::remove_file(root.path().join("note.md")).unwrap();
        fs::remove_file(root.path().join("person.tano.json")).unwrap();
        scan(root.path(), "workspace", &db).unwrap();
        fs::write(root.path().join("note.md"), "new").unwrap();
        let next = scan(root.path(), "workspace", &db).unwrap();
        assert_ne!(old, next.files[0].id);
        let connection = database(&db).unwrap();
        assert!(!claim_reference_id(&connection, "workspace", &old).unwrap());
        assert!(!claim_reference_id(&connection, "workspace", "a82f91").unwrap());
    }
}
