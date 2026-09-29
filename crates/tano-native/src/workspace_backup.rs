use crate::{identity_manifest, storage};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_ENTRIES: usize = 20_000;
const MAX_TOTAL_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const RETAIN_LATEST: usize = 24;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupFile {
    path: String,
    size: u64,
    sha256: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupManifest {
    format: u32,
    workspace_id: String,
    snapshot_id: String,
    created_at: u64,
    directories: Vec<String>,
    files: Vec<BackupFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSummary {
    pub snapshot_id: String,
    pub created_at: u64,
    pub file_count: usize,
    pub bytes: u64,
    pub error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryPreview {
    pub workspace_id: String,
    pub snapshot: BackupSummary,
    pub current_fingerprint: String,
    pub changes: Vec<BackupChange>,
    pub markdown_and_attachments_unchanged: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupChange {
    pub path: String,
    pub kind: String,
}

fn now() -> Result<u64, String> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as u64)
}

fn backup_root(app_data: &Path, root: &Path, workspace_id: &str) -> Result<PathBuf, String> {
    uuid::Uuid::parse_str(workspace_id).map_err(|_| "无效的工作区身份")?;
    let data = fs::canonicalize(app_data).map_err(|e| e.to_string())?;
    if data.starts_with(root) {
        return Err("备份目录不能位于工作区内，请检查应用数据位置".into());
    }
    let root_key = if cfg!(windows) {
        root.to_string_lossy().to_lowercase()
    } else {
        root.to_string_lossy().into_owned()
    };
    let path = data
        .join("workspace-backups")
        .join(workspace_id)
        .join(format!("{:x}", Sha256::digest(root_key.as_bytes())));
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}

fn relative_path(path: &str) -> Result<PathBuf, String> {
    if path.is_empty()
        || path.contains('\\')
        || path.contains(':')
        || path.len() > 900
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err("备份包含无效路径".into());
    }
    let result = PathBuf::from(path);
    if result
        .components()
        .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("备份路径不能离开 .tano".into());
    }
    Ok(result)
}

fn walk(
    source: &Path,
    prefix: &str,
    directories: &mut Vec<String>,
    files: &mut Vec<BackupFile>,
    mut copy_to: Option<&mut Path>,
) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source).map_err(|e| e.to_string())?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(".tano 必须是普通目录".into());
    }
    for item in fs::read_dir(source).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?;
        let name = item
            .file_name()
            .into_string()
            .map_err(|_| "备份遇到无法表示的文件名")?;
        let relative = if prefix.is_empty() {
            name
        } else {
            format!("{prefix}/{name}")
        };
        relative_path(&relative)?;
        let source = item.path();
        let metadata = fs::symlink_metadata(&source).map_err(|e| e.to_string())?;
        if metadata.file_type().is_symlink() {
            return Err(format!("备份遇到符号链接：{relative}"));
        }
        if directories.len() + files.len() >= MAX_ENTRIES {
            return Err(".tano 文件数超过备份上限".into());
        }
        if metadata.is_dir() {
            if let Some(destination) = copy_to.as_deref_mut() {
                fs::create_dir(destination.join(&relative)).map_err(|e| e.to_string())?;
            }
            directories.push(relative.clone());
            walk(
                &source,
                &relative,
                directories,
                files,
                copy_to.as_deref_mut(),
            )?;
        } else if metadata.is_file() {
            let (size, sha256) = if let Some(destination) = copy_to.as_deref_mut() {
                copy_file(&source, &destination.join(&relative))?
            } else {
                hash_file(&source)?
            };
            files.push(BackupFile {
                path: relative,
                size,
                sha256,
            });
        } else {
            return Err(".tano 包含不支持的文件类型".into());
        }
    }
    Ok(())
}

fn hash_file(path: &Path) -> Result<(u64, String), String> {
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("备份文件不是普通文件".into());
    }
    let mut input = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut size = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = input.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        size += count as u64;
        if size > MAX_TOTAL_BYTES {
            return Err(".tano 单个文件超过备份容量上限".into());
        }
        hasher.update(&buffer[..count]);
    }
    Ok((size, format!("{:x}", hasher.finalize())))
}

fn copy_file(source: &Path, destination: &Path) -> Result<(u64, String), String> {
    let metadata = fs::symlink_metadata(source).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("备份源文件不是普通文件".into());
    }
    let mut input = fs::File::open(source).map_err(|e| e.to_string())?;
    let mut temporary = tempfile::Builder::new()
        .prefix(".tano-backup-")
        .tempfile_in(destination.parent().ok_or("无效备份路径")?)
        .map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut size = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = input.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        size += count as u64;
        if size > MAX_TOTAL_BYTES {
            return Err(".tano 单个文件超过备份容量上限".into());
        }
        hasher.update(&buffer[..count]);
        temporary
            .write_all(&buffer[..count])
            .map_err(|e| e.to_string())?;
    }
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    temporary
        .persist_noclobber(destination)
        .map_err(|e| e.to_string())?;
    Ok((size, format!("{:x}", hasher.finalize())))
}

fn inventory(root: &Path) -> Result<(Vec<String>, Vec<BackupFile>), String> {
    let data = root.join(".tano");
    match fs::symlink_metadata(&data) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok((Vec::new(), Vec::new()))
        }
        Err(error) => return Err(error.to_string()),
    }
    let mut directories = Vec::new();
    let mut files = Vec::new();
    walk(&data, "", &mut directories, &mut files, None)?;
    directories.sort();
    files.sort_by(|a, b| a.path.cmp(&b.path));
    if files.iter().map(|file| file.size).sum::<u64>() > MAX_TOTAL_BYTES {
        return Err(".tano 超过 2 GiB 备份上限".into());
    }
    Ok((directories, files))
}

fn summary(manifest: &BackupManifest) -> BackupSummary {
    BackupSummary {
        snapshot_id: manifest.snapshot_id.clone(),
        created_at: manifest.created_at,
        file_count: manifest.files.len(),
        bytes: manifest.files.iter().map(|file| file.size).sum(),
        error: None,
    }
}

fn snapshot_path(base: &Path, snapshot_id: &str) -> Result<PathBuf, String> {
    if snapshot_id.len() > 90
        || snapshot_id.is_empty()
        || !snapshot_id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte.is_ascii_hexdigit() || byte == b'-')
    {
        return Err("备份标识无效".into());
    }
    Ok(base.join(snapshot_id))
}

fn load(base: &Path, workspace_id: &str, snapshot_id: &str) -> Result<BackupManifest, String> {
    let location = snapshot_path(base, snapshot_id)?;
    if fs::symlink_metadata(&location)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("备份目录不能是符号链接".into());
    }
    let file = location.join("manifest.json");
    let metadata = fs::symlink_metadata(&file).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 16 * 1024 * 1024
    {
        return Err("备份清单缺失或无效".into());
    }
    let manifest: BackupManifest =
        serde_json::from_slice(&fs::read(file).map_err(|e| e.to_string())?)
            .map_err(|e| format!("备份清单损坏：{e}"))?;
    if manifest.format != 1
        || manifest.workspace_id != workspace_id
        || manifest.snapshot_id != snapshot_id
        || manifest.files.len() + manifest.directories.len() > MAX_ENTRIES
        || manifest.files.iter().map(|f| f.size).sum::<u64>() > MAX_TOTAL_BYTES
    {
        return Err("备份清单身份或大小无效".into());
    }
    let mut names = std::collections::HashSet::new();
    let directories = manifest
        .directories
        .iter()
        .cloned()
        .collect::<std::collections::HashSet<_>>();
    for dir in &manifest.directories {
        relative_path(dir)?;
        if !names.insert(dir.to_lowercase())
            || dir
                .rsplit_once('/')
                .is_some_and(|(parent, _)| !directories.contains(parent))
        {
            return Err("备份目录重复或父目录缺失".into());
        }
    }
    for file in &manifest.files {
        relative_path(&file.path)?;
        if !names.insert(file.path.to_lowercase())
            || file
                .path
                .rsplit_once('/')
                .is_some_and(|(parent, _)| !directories.contains(parent))
            || file.sha256.len() != 64
            || !file.sha256.bytes().all(|c| c.is_ascii_hexdigit())
        {
            return Err("备份文件路径或校验值无效".into());
        }
    }
    Ok(manifest)
}

fn verify(base: &Path, manifest: &BackupManifest) -> Result<(), String> {
    let data = snapshot_path(base, &manifest.snapshot_id)?.join("data");
    let mut directories = Vec::new();
    let mut files = Vec::new();
    walk(&data, "", &mut directories, &mut files, None)?;
    directories.sort();
    files.sort_by(|a, b| a.path.cmp(&b.path));
    let mut expected_dirs = manifest.directories.clone();
    expected_dirs.sort();
    let mut expected_files = manifest.files.clone();
    expected_files.sort_by(|a, b| a.path.cmp(&b.path));
    if (directories, files) != (expected_dirs, expected_files) {
        return Err("备份内容与清单不一致，原备份已保留".into());
    }
    let config = fs::read(data.join("config.json")).map_err(|e| e.to_string())?;
    let config: serde_json::Value = serde_json::from_slice(&config).map_err(|e| e.to_string())?;
    if config.get("id").and_then(|id| id.as_str()) != Some(&manifest.workspace_id) {
        return Err("备份中的工作区身份不一致".into());
    }
    identity_manifest::validate_backup_bytes(
        &fs::read(data.join("identities.json")).map_err(|e| e.to_string())?,
        &manifest.workspace_id,
    )?;
    Ok(())
}

pub fn list(
    app_data: &Path,
    root: &Path,
    workspace_id: &str,
) -> Result<Vec<BackupSummary>, String> {
    let base = backup_root(app_data, root, workspace_id)?;
    let mut summaries = Vec::new();
    for item in fs::read_dir(&base).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?;
        let id = item.file_name().to_string_lossy().to_string();
        if !item.file_type().map_err(|e| e.to_string())?.is_dir()
            || snapshot_path(&base, &id).is_err()
        {
            continue;
        }
        let entry = match load(&base, workspace_id, &id) {
            Ok(manifest) => {
                let mut entry = summary(&manifest);
                entry.error = verify(&base, &manifest).err();
                entry
            }
            Err(error) => BackupSummary {
                snapshot_id: id,
                created_at: 0,
                file_count: 0,
                bytes: 0,
                error: Some(error),
            },
        };
        summaries.push(entry);
    }
    summaries.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(summaries)
}

pub fn create(
    app_data: &Path,
    root: &Path,
    workspace_id: &str,
) -> Result<Option<BackupSummary>, String> {
    identity_manifest::require(root, workspace_id)?;
    let base = backup_root(app_data, root, workspace_id)?;
    let before = inventory(root)?;
    let mut prior = fs::read_dir(&base)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| load(&base, workspace_id, &entry.file_name().to_string_lossy()).ok())
        .collect::<Vec<_>>();
    prior.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    if let Some(latest) = prior.first() {
        if latest.directories == before.0
            && latest.files == before.1
            && verify(&base, latest).is_ok()
        {
            return Ok(None);
        }
    }
    let created_at = now()?;
    let snapshot_id = format!("{created_at}-{}", uuid::Uuid::new_v4());
    let stage = tempfile::Builder::new()
        .prefix(".pending-")
        .tempdir_in(&base)
        .map_err(|e| e.to_string())?;
    let data = stage.path().join("data");
    fs::create_dir(&data).map_err(|e| e.to_string())?;
    let mut directories = Vec::new();
    let mut files = Vec::new();
    let mut data_arg = data.clone();
    walk(
        &root.join(".tano"),
        "",
        &mut directories,
        &mut files,
        Some(&mut data_arg),
    )?;
    directories.sort();
    files.sort_by(|a, b| a.path.cmp(&b.path));
    if before != (directories.clone(), files.clone()) || inventory(root)? != before {
        return Err("备份期间 .tano 被外部修改；上次完整快照已保留".into());
    }
    let mut copied_directories = Vec::new();
    let mut copied_files = Vec::new();
    walk(&data, "", &mut copied_directories, &mut copied_files, None)?;
    copied_directories.sort();
    copied_files.sort_by(|a, b| a.path.cmp(&b.path));
    if (copied_directories, copied_files) != (directories.clone(), files.clone()) {
        return Err("备份副本校验失败；上次完整快照已保留".into());
    }
    identity_manifest::require(root, workspace_id)?;
    let manifest = BackupManifest {
        format: 1,
        workspace_id: workspace_id.into(),
        snapshot_id: snapshot_id.clone(),
        created_at,
        directories,
        files,
    };
    storage::create_atomic(
        &stage.path().join("manifest.json"),
        &serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?,
    )?;
    fs::rename(stage.path(), base.join(&snapshot_id)).map_err(|e| e.to_string())?;
    prune(&base, workspace_id)?;
    Ok(Some(summary(&manifest)))
}

fn prune(base: &Path, workspace_id: &str) -> Result<(), String> {
    let mut snapshots = Vec::new();
    for item in fs::read_dir(base).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?;
        let id = item.file_name().to_string_lossy().to_string();
        if let Ok(manifest) = load(base, workspace_id, &id) {
            if verify(base, &manifest).is_ok() {
                snapshots.push(manifest);
            }
        }
    }
    snapshots.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    for old in snapshots.iter().skip(RETAIN_LATEST) {
        fs::remove_dir_all(snapshot_path(base, &old.snapshot_id)?).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn preview(
    app_data: &Path,
    root: &Path,
    workspace_id: &str,
    snapshot_id: &str,
) -> Result<RecoveryPreview, String> {
    let base = backup_root(app_data, root, workspace_id)?;
    let manifest = load(&base, workspace_id, snapshot_id)?;
    verify(&base, &manifest)?;
    let current = inventory(root)?;
    let old = manifest
        .files
        .iter()
        .map(|file| (&file.path, &file.sha256))
        .collect::<std::collections::HashMap<_, _>>();
    let now = current
        .1
        .iter()
        .map(|file| (&file.path, &file.sha256))
        .collect::<std::collections::HashMap<_, _>>();
    let mut paths = old
        .keys()
        .chain(now.keys())
        .map(|name| (*name).clone())
        .collect::<Vec<_>>();
    paths.sort();
    paths.dedup();
    let changes = paths
        .into_iter()
        .filter_map(|path| {
            let kind = match (now.get(&path), old.get(&path)) {
                (None, Some(_)) => "将恢复",
                (Some(_), None) => "当前文件将保留在恢复前副本",
                (Some(a), Some(b)) if a != b => "内容不同，当前版本将保留在恢复前副本",
                _ => return None,
            };
            Some(BackupChange {
                path,
                kind: kind.into(),
            })
        })
        .collect();
    let fingerprint = storage::hash(&serde_json::to_vec(&current).map_err(|e| e.to_string())?);
    Ok(RecoveryPreview {
        workspace_id: workspace_id.into(),
        snapshot: summary(&manifest),
        current_fingerprint: fingerprint,
        changes,
        markdown_and_attachments_unchanged: true,
    })
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestoreJournal {
    root: String,
    workspace_id: String,
    snapshot_id: String,
    preimage: Option<String>,
}

fn restore_journal(base: &Path) -> PathBuf {
    base.join("restore.json")
}

pub fn pending_restore(
    app_data: &Path,
    root: &Path,
    workspace_id: &str,
) -> Result<Option<String>, String> {
    let base = backup_root(app_data, root, workspace_id)?;
    let file = restore_journal(&base);
    let metadata = match fs::symlink_metadata(&file) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 8 * 1024 {
        return Err("恢复操作日志无效，原文件已保留".into());
    }
    let journal: RestoreJournal =
        serde_json::from_slice(&fs::read(&file).map_err(|e| e.to_string())?)
            .map_err(|e| format!("恢复操作日志损坏：{e}"))?;
    if journal.root != root.to_string_lossy() || journal.workspace_id != workspace_id {
        return Err("恢复操作日志与选定工作区不匹配".into());
    }
    Ok(Some(journal.snapshot_id))
}

fn preimage(base: &Path, root: &Path, workspace_id: &str) -> Result<Option<String>, String> {
    if fs::symlink_metadata(root.join(".tano")).is_err() {
        return Ok(None);
    }
    let before = inventory(root)?;
    let directory = base.join("pre-restore");
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let id = format!("{}-{}", now()?, uuid::Uuid::new_v4());
    let stage = tempfile::Builder::new()
        .prefix(".pending-")
        .tempdir_in(&directory)
        .map_err(|e| e.to_string())?;
    let data = stage.path().join("data");
    fs::create_dir(&data).map_err(|e| e.to_string())?;
    let mut dirs = Vec::new();
    let mut files = Vec::new();
    let mut destination = data.clone();
    walk(
        &root.join(".tano"),
        "",
        &mut dirs,
        &mut files,
        Some(&mut destination),
    )?;
    dirs.sort();
    files.sort_by(|a, b| a.path.cmp(&b.path));
    if (dirs.clone(), files.clone()) != before || inventory(root)? != before {
        return Err("恢复前备份时 .tano 被修改，未改动当前数据".into());
    }
    let manifest = BackupManifest {
        format: 1,
        workspace_id: workspace_id.into(),
        snapshot_id: id.clone(),
        created_at: now()?,
        directories: dirs,
        files,
    };
    storage::create_atomic(
        &stage.path().join("manifest.json"),
        &serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?,
    )?;
    fs::rename(stage.path(), directory.join(&id)).map_err(|e| e.to_string())?;
    Ok(Some(id))
}

fn restore_directory(data: &Path, root: &Path, manifest: &BackupManifest) -> Result<(), String> {
    let target = root.join(".tano");
    if fs::symlink_metadata(&target).is_ok() {
        let _ = inventory(root)?;
        fs::remove_dir_all(&target).map_err(|e| e.to_string())?;
    }
    fs::create_dir(&target).map_err(|e| e.to_string())?;
    let mut directories = manifest.directories.clone();
    directories.sort_by_key(|path| path.matches('/').count());
    for directory in directories {
        let mut current = target.clone();
        for component in relative_path(&directory)?.components() {
            current.push(component.as_os_str());
            match fs::symlink_metadata(&current) {
                Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
                Ok(_) => return Err("恢复目标包含符号链接或非目录，已停止".into()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    fs::create_dir(&current).map_err(|e| e.to_string())?
                }
                Err(error) => return Err(error.to_string()),
            }
        }
    }
    for file in &manifest.files {
        let relative = relative_path(&file.path)?;
        let destination = target.join(&relative);
        let parent = destination.parent().ok_or("恢复路径无效")?;
        if !fs::symlink_metadata(parent)
            .map_err(|e| e.to_string())?
            .is_dir()
        {
            return Err("恢复目标父路径不是普通目录".into());
        }
        let (size, hash) = copy_file(&data.join(relative), &destination)?;
        if size != file.size || hash != file.sha256 {
            return Err(format!("恢复后文件校验失败：{}", file.path));
        }
    }
    Ok(())
}

pub fn restore(
    app_data: &Path,
    root: &Path,
    workspace_id: &str,
    snapshot_id: &str,
    current_fingerprint: Option<&str>,
    cache: &Path,
) -> Result<storage::Workspace, String> {
    let base = backup_root(app_data, root, workspace_id)?;
    let manifest = load(&base, workspace_id, snapshot_id)?;
    verify(&base, &manifest)?;
    let restored_ids = identity_manifest::parse_backup_bytes(
        &fs::read(base.join(snapshot_id).join("data/identities.json"))
            .map_err(|e| e.to_string())?,
        workspace_id,
    )?;
    let journal_file = restore_journal(&base);
    if let Some(pending) = pending_restore(app_data, root, workspace_id)? {
        if pending != snapshot_id {
            return Err("另一项恢复尚未完成，请先继续原备份的恢复".into());
        }
        preimage(&base, root, workspace_id)?;
    } else {
        let preview = preview(app_data, root, workspace_id, snapshot_id)?;
        if current_fingerprint != Some(preview.current_fingerprint.as_str()) {
            return Err("工作区自预览后发生变化，请刷新恢复预览".into());
        }
        let old = preimage(&base, root, workspace_id)?;
        storage::create_atomic(
            &journal_file,
            &serde_json::to_vec(&RestoreJournal {
                root: root.to_string_lossy().into_owned(),
                workspace_id: workspace_id.into(),
                snapshot_id: snapshot_id.into(),
                preimage: old,
            })
            .map_err(|e| e.to_string())?,
        )?;
    }
    restore_directory(&base.join(snapshot_id).join("data"), root, &manifest)?;
    identity_manifest::require(root, workspace_id)?;
    identity_manifest::invalidate_native_keys_after_restore(cache, workspace_id)?;
    let mut workspace = storage::scan(root, workspace_id, cache)?;
    let current_ids = workspace
        .files
        .iter()
        .filter(|file| file.kind == "file")
        .map(|file| file.id.as_str())
        .collect::<std::collections::HashSet<_>>();
    let missing = restored_ids
        .files
        .iter()
        .filter(|file| !file.deleted && !current_ids.contains(file.id.as_str()))
        .map(|file| file.id.as_str())
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        workspace.backup_warning = Some(format!(
            "恢复完成，但 {} 个原文件身份未匹配到现有文件（如 {}）；请核对缺失文件与引用",
            missing.len(),
            missing
                .iter()
                .take(5)
                .copied()
                .collect::<Vec<_>>()
                .join("、"),
        ));
    }
    fs::remove_file(&journal_file).map_err(|e| e.to_string())?;
    Ok(workspace)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace() -> (
        tempfile::TempDir,
        tempfile::TempDir,
        PathBuf,
        String,
        PathBuf,
    ) {
        let directory = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(directory.path()).unwrap();
        let id = storage::workspace_identity(&root).unwrap();
        fs::create_dir(root.join(".tano/objects")).unwrap();
        fs::write(root.join(".tano/objects/a82f91.tano.json"), r#"{"version":1,"id":"a82f91","type":"person","name":"Alice","description":"","archived":false,"properties":{}}"#).unwrap();
        fs::write(
            root.join(".tano/relations.tano-relations.json"),
            r#"{"version":1,"relations":[]}"#,
        )
        .unwrap();
        fs::write(root.join("note.md"), "# [[person:a82f91]]").unwrap();
        let cache = data.path().join("index.sqlite");
        storage::scan(&root, &id, &cache).unwrap();
        (directory, data, root, id, cache)
    }

    #[test]
    fn deleted_metadata_restores_bytes_workspace_and_reference_ids() {
        let (_directory, data, root, id, cache) = workspace();
        fs::write(root.join("attachment.bin"), [0_u8, 255, 17, 42]).unwrap();
        let before = storage::scan(&root, &id, &cache).unwrap();
        crate::workspace_recovery::register_identity(data.path(), &root, &id).unwrap();
        let snapshot = create(data.path(), &root, &id).unwrap().unwrap();
        assert!(create(data.path(), &root, &id).unwrap().is_none());
        fs::remove_dir_all(root.join(".tano")).unwrap();
        fs::remove_file(&cache).unwrap();
        fs::write(root.join("attachment.bin"), [0_u8, 255, 99, 42]).unwrap();
        assert!(identity_manifest::require(&root, &id).is_err());
        assert!(
            crate::workspace_recovery::identity_for_open(data.path(), &root, None, &cache).is_err()
        );
        let preview = preview(data.path(), &root, &id, &snapshot.snapshot_id).unwrap();
        assert!(preview
            .changes
            .iter()
            .any(|change| change.path == "config.json"));
        let restored = restore(
            data.path(),
            &root,
            &id,
            &snapshot.snapshot_id,
            Some(&preview.current_fingerprint),
            &cache,
        )
        .unwrap();
        assert_eq!(restored.id, id);
        assert_eq!(
            restored
                .files
                .iter()
                .map(|file| (&file.path, &file.id))
                .collect::<Vec<_>>(),
            before
                .files
                .iter()
                .map(|file| (&file.path, &file.id))
                .collect::<Vec<_>>()
        );
        assert_eq!(
            fs::read_to_string(root.join("note.md")).unwrap(),
            "# [[person:a82f91]]"
        );
        assert_eq!(
            fs::read(root.join("attachment.bin")).unwrap(),
            [0, 255, 99, 42]
        );
        assert!(
            fs::read_to_string(root.join(".tano/objects/a82f91.tano.json"))
                .unwrap()
                .contains("Alice")
        );
        assert_eq!(
            fs::read_to_string(root.join(".tano/relations.tano-relations.json")).unwrap(),
            r#"{"version":1,"relations":[]}"#
        );
        assert!(read_snapshot_id(data.path(), &root, &id, &snapshot.snapshot_id).is_ok());
    }

    fn read_snapshot_id(
        app_data: &Path,
        root: &Path,
        id: &str,
        snapshot: &str,
    ) -> Result<(), String> {
        let base = backup_root(app_data, root, id)?;
        verify(&base, &load(&base, id, snapshot)?)
    }

    #[test]
    fn partial_metadata_keeps_current_bytes_outside_workspace_before_restore() {
        let (_directory, data, root, id, cache) = workspace();
        let before = storage::scan(&root, &id, &cache).unwrap();
        crate::workspace_recovery::register_identity(data.path(), &root, &id).unwrap();
        let snapshot = create(data.path(), &root, &id).unwrap().unwrap();
        fs::remove_file(root.join(".tano/config.json")).unwrap();
        fs::write(root.join(".tano/objects/a82f91.tano.json"), "external edit").unwrap();
        assert!(identity_manifest::require(&root, &id).is_err());
        assert!(
            crate::workspace_recovery::identity_for_open(data.path(), &root, None, &cache).is_err()
        );
        let preview = preview(data.path(), &root, &id, &snapshot.snapshot_id).unwrap();
        let restored = restore(
            data.path(),
            &root,
            &id,
            &snapshot.snapshot_id,
            Some(&preview.current_fingerprint),
            &cache,
        )
        .unwrap();
        assert_eq!(restored.id, id);
        assert_eq!(
            restored
                .files
                .iter()
                .map(|file| (&file.path, &file.id))
                .collect::<Vec<_>>(),
            before
                .files
                .iter()
                .map(|file| (&file.path, &file.id))
                .collect::<Vec<_>>()
        );
        let preimages = fs::read_dir(
            backup_root(data.path(), &root, &id)
                .unwrap()
                .join("pre-restore"),
        )
        .unwrap()
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with(char::is_numeric)
        })
        .collect::<Vec<_>>();
        assert_eq!(preimages.len(), 1);
        assert_eq!(
            fs::read_to_string(preimages[0].path().join("data/objects/a82f91.tano.json")).unwrap(),
            "external edit"
        );
        assert!(
            fs::read_to_string(root.join(".tano/objects/a82f91.tano.json"))
                .unwrap()
                .contains("Alice")
        );
    }

    #[test]
    fn damaged_backup_and_changed_target_are_not_overwritten() {
        let (_directory, data, root, id, cache) = workspace();
        let snapshot = create(data.path(), &root, &id).unwrap().unwrap();
        let initial_preview = preview(data.path(), &root, &id, &snapshot.snapshot_id).unwrap();
        fs::write(root.join(".tano/capabilities.json"), "new current rules").unwrap();
        assert!(restore(
            data.path(),
            &root,
            &id,
            &snapshot.snapshot_id,
            Some(&initial_preview.current_fingerprint),
            &cache
        )
        .is_err());
        assert_eq!(
            fs::read_to_string(root.join(".tano/capabilities.json")).unwrap(),
            "new current rules"
        );
        let base = backup_root(data.path(), &root, &id).unwrap();
        fs::write(
            base.join(&snapshot.snapshot_id).join("data/config.json"),
            "damaged",
        )
        .unwrap();
        assert!(list(data.path(), &root, &id).unwrap()[0].error.is_some());
        assert!(preview(data.path(), &root, &id, &snapshot.snapshot_id).is_err());
        assert_eq!(
            fs::read_to_string(root.join(".tano/capabilities.json")).unwrap(),
            "new current rules"
        );
    }

    #[test]
    fn restore_journal_resumes_after_mid_copy_crash_and_preserves_partial_bytes() {
        let (_directory, data, root, id, cache) = workspace();
        let snapshot = create(data.path(), &root, &id).unwrap().unwrap();
        let base = backup_root(data.path(), &root, &id).unwrap();
        storage::create_atomic(
            &restore_journal(&base),
            &serde_json::to_vec(&RestoreJournal {
                root: root.to_string_lossy().into_owned(),
                workspace_id: id.clone(),
                snapshot_id: snapshot.snapshot_id.clone(),
                preimage: None,
            })
            .unwrap(),
        )
        .unwrap();
        fs::remove_dir_all(root.join(".tano")).unwrap();
        fs::create_dir(root.join(".tano")).unwrap();
        fs::copy(
            base.join(&snapshot.snapshot_id).join("data/config.json"),
            root.join(".tano/config.json"),
        )
        .unwrap();
        fs::write(root.join(".tano/incomplete.bin"), [0_u8, 255, 24]).unwrap();
        assert_eq!(
            pending_restore(data.path(), &root, &id).unwrap(),
            Some(snapshot.snapshot_id.clone())
        );
        restore(data.path(), &root, &id, &snapshot.snapshot_id, None, &cache).unwrap();
        assert!(pending_restore(data.path(), &root, &id).unwrap().is_none());
        assert_eq!(
            storage::existing_workspace_identity(&root).unwrap(),
            Some(id)
        );
        assert!(root.join(".tano/identities.json").exists());
        assert!(root.join(".tano/objects/a82f91.tano.json").exists());
        assert!(!root.join(".tano/incomplete.bin").exists());
        let preimages = fs::read_dir(base.join("pre-restore"))
            .unwrap()
            .filter_map(Result::ok)
            .collect::<Vec<_>>();
        assert!(preimages.iter().any(|entry| {
            fs::read(entry.path().join("data/incomplete.bin"))
                .is_ok_and(|bytes| bytes == [0, 255, 24])
        }));
    }

    #[test]
    fn failed_backup_preserves_the_last_complete_snapshot() {
        let (_directory, data, root, id, _cache) = workspace();
        let snapshot = create(data.path(), &root, &id).unwrap().unwrap();
        fs::write(root.join(".tano/identities.json"), "broken").unwrap();
        assert!(create(data.path(), &root, &id).is_err());
        assert_eq!(
            list(data.path(), &root, &id).unwrap()[0].snapshot_id,
            snapshot.snapshot_id
        );
        assert!(list(data.path(), &root, &id).unwrap()[0].error.is_none());
    }

    #[test]
    fn retains_recent_complete_snapshots_without_replacing_them_after_metadata_loss() {
        let (_directory, data, root, id, _cache) = workspace();
        let first = create(data.path(), &root, &id).unwrap().unwrap();
        for version in 0..RETAIN_LATEST {
            fs::write(
                root.join(".tano/capabilities.json"),
                format!("version {version}"),
            )
            .unwrap();
            assert!(create(data.path(), &root, &id).unwrap().is_some());
        }
        let snapshots = list(data.path(), &root, &id).unwrap();
        assert_eq!(snapshots.len(), RETAIN_LATEST);
        assert!(snapshots.iter().all(|snapshot| snapshot.error.is_none()));
        assert!(!snapshots
            .iter()
            .any(|snapshot| snapshot.snapshot_id == first.snapshot_id));

        fs::remove_dir_all(root.join(".tano")).unwrap();
        assert!(create(data.path(), &root, &id).is_err());
        assert_eq!(list(data.path(), &root, &id).unwrap().len(), RETAIN_LATEST);
    }

    #[test]
    fn running_metadata_loss_blocks_writes_and_missing_manifest_recovers_from_snapshot() {
        let (_directory, data, root, id, cache) = workspace();
        let before = storage::scan(&root, &id, &cache).unwrap();
        let snapshot = create(data.path(), &root, &id).unwrap().unwrap();
        // Model a reused filesystem key: without invalidation, the scan would
        // assign the object's ID to note.md before consulting the manifest path.
        let connection = storage::database(&cache).unwrap();
        let note_key: String = connection
            .query_row(
                "SELECT native_key FROM files WHERE workspace_id=? AND path='note.md'",
                [&id],
                |row| row.get(0),
            )
            .unwrap();
        if !note_key.is_empty() {
            connection
                .execute(
                    "UPDATE files SET native_key='' WHERE workspace_id=? AND path='note.md'",
                    [&id],
                )
                .unwrap();
            connection
                .execute(
                    "UPDATE files SET native_key=? WHERE workspace_id=? AND path='.tano/objects/a82f91.tano.json'",
                    rusqlite::params![note_key, id],
                )
                .unwrap();
        }
        drop(connection);
        fs::remove_file(root.join(".tano/identities.json")).unwrap();
        assert!(identity_manifest::require(&root, &id).is_err());
        assert!(create(data.path(), &root, &id).is_err());
        assert!(list(data.path(), &root, &id)
            .unwrap()
            .iter()
            .any(|item| item.snapshot_id == snapshot.snapshot_id && item.error.is_none()));
        let review = preview(data.path(), &root, &id, &snapshot.snapshot_id).unwrap();
        let restored = restore(
            data.path(),
            &root,
            &id,
            &snapshot.snapshot_id,
            Some(&review.current_fingerprint),
            &cache,
        )
        .unwrap();
        assert_eq!(
            restored
                .files
                .iter()
                .map(|file| (&file.path, &file.id))
                .collect::<Vec<_>>(),
            before
                .files
                .iter()
                .map(|file| (&file.path, &file.id))
                .collect::<Vec<_>>()
        );
        fs::remove_file(&cache).unwrap();
        let after = storage::scan(&root, &id, &cache).unwrap();
        assert_eq!(
            after
                .files
                .iter()
                .map(|file| (&file.path, &file.id))
                .collect::<Vec<_>>(),
            before
                .files
                .iter()
                .map(|file| (&file.path, &file.id))
                .collect::<Vec<_>>()
        );
        assert_eq!(
            fs::read_to_string(root.join("note.md")).unwrap(),
            "# [[person:a82f91]]"
        );
    }

    #[test]
    fn ambiguous_equal_content_renames_report_unmatched_reference_ids() {
        let (_directory, data, root, id, cache) = workspace();
        let before = storage::scan(&root, &id, &cache).unwrap();
        let old_id = before
            .files
            .iter()
            .find(|file| file.path == "note.md")
            .unwrap()
            .id
            .clone();
        let snapshot = create(data.path(), &root, &id).unwrap().unwrap();
        fs::remove_dir_all(root.join(".tano")).unwrap();
        fs::rename(root.join("note.md"), root.join("copy-a.md")).unwrap();
        fs::write(root.join("copy-b.md"), "# [[person:a82f91]]").unwrap();
        fs::remove_file(&cache).unwrap();
        let review = preview(data.path(), &root, &id, &snapshot.snapshot_id).unwrap();
        let restored = restore(
            data.path(),
            &root,
            &id,
            &snapshot.snapshot_id,
            Some(&review.current_fingerprint),
            &cache,
        )
        .unwrap();
        assert!(restored
            .backup_warning
            .as_deref()
            .unwrap()
            .contains(&old_id));
        assert!(restored
            .files
            .iter()
            .filter(|file| file.path.starts_with("copy-"))
            .all(|file| file.id != old_id));
        assert_eq!(
            fs::read_to_string(root.join("copy-a.md")).unwrap(),
            "# [[person:a82f91]]"
        );
        assert_eq!(
            fs::read_to_string(root.join("copy-b.md")).unwrap(),
            "# [[person:a82f91]]"
        );
    }
}
