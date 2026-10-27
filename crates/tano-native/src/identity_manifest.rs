use crate::storage;
use rusqlite::{params, Transaction};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, fs, io::Read, path::Path};

const FILE: &str = "identities.json";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityFile {
    pub path: String,
    pub id: String,
    pub hash: String,
    pub version: i64,
    pub deleted: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityManifest {
    pub format: u32,
    pub workspace_id: String,
    pub revision: u64,
    pub files: Vec<IdentityFile>,
    pub reserved_ids: Vec<String>,
}

fn path(root: &Path) -> std::path::PathBuf {
    root.join(".tano").join(FILE)
}

fn active(root: &Path, workspace_id: &str) -> Result<bool, String> {
    Ok(storage::existing_workspace_identity(root)?.as_deref() == Some(workspace_id))
}

pub fn require(root: &Path, workspace_id: &str) -> Result<(), String> {
    storage::assert_workspace_identity(root, workspace_id)?;
    if !path(root).is_file() {
        return Err("工作区身份清单已丢失，已停止写入；请检查 .tano/identities.json".into());
    }
    read(root, workspace_id)?
        .ok_or("工作区身份清单已丢失，请检查 .tano/identities.json".to_string())?;
    Ok(())
}

pub fn read(root: &Path, workspace_id: &str) -> Result<Option<IdentityManifest>, String> {
    let file = path(root);
    let metadata = fs::symlink_metadata(&file);
    let metadata = match metadata {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 16 * 1024 * 1024
    {
        return Err("工作区身份清单必须是不超过 16 MiB 的普通文件".into());
    }
    let manifest: IdentityManifest =
        serde_json::from_slice(&fs::read(&file).map_err(|e| e.to_string())?)
            .map_err(|e| format!("工作区身份清单损坏，原文件已保留：{e}"))?;
    validate(&manifest, workspace_id)?;
    Ok(Some(manifest))
}

pub(crate) fn validate(manifest: &IdentityManifest, workspace_id: &str) -> Result<(), String> {
    if manifest.format != 1
        || manifest.workspace_id != workspace_id
        || manifest.revision == 0
        || manifest.files.len() > 20_000
        || manifest.reserved_ids.len() > 100_000
    {
        return Err("工作区身份清单格式、空间身份或数量无效".into());
    }
    let mut paths = HashSet::new();
    let mut active_ids = HashSet::new();
    let reserved: HashSet<_> = manifest.reserved_ids.iter().collect();
    if reserved.len() != manifest.reserved_ids.len()
        || reserved.iter().any(|id| !storage::is_short_id(id))
    {
        return Err("身份清单包含重复或无效占号".into());
    }
    for file in &manifest.files {
        storage::validate_relative_path(&file.path, storage::is_workspace_data_path(&file.path))?;
        if !storage::is_short_id(&file.id)
            || !reserved.contains(&file.id)
            || (!file.hash.is_empty()
                && (file.hash.len() != 64 || !file.hash.bytes().all(|c| c.is_ascii_hexdigit())))
            || file.version < 1
            || !paths.insert(&file.path)
            || (!file.deleted && !active_ids.insert(&file.id))
        {
            return Err("工作区身份清单中的文件身份、路径或 hash 无效".into());
        }
    }
    Ok(())
}

fn bytes(manifest: &IdentityManifest) -> Result<Vec<u8>, String> {
    serde_json::to_vec_pretty(manifest).map_err(|e| e.to_string())
}

fn cache_revision(
    transaction: &Transaction<'_>,
    workspace_id: &str,
) -> Result<Option<(u64, String)>, String> {
    transaction.execute_batch("CREATE TABLE IF NOT EXISTS identity_revisions (workspace_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, hash TEXT NOT NULL)")
        .map_err(|e| e.to_string())?;
    let result = transaction.query_row(
        "SELECT revision, hash FROM identity_revisions WHERE workspace_id=?",
        [workspace_id],
        |row| Ok((row.get::<_, u64>(0)?, row.get(1)?)),
    );
    match result {
        Ok(value) => Ok(Some(value)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn set_cache_revision(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    revision: u64,
    hash: &str,
) -> Result<(), String> {
    transaction.execute("INSERT INTO identity_revisions VALUES (?1,?2,?3) ON CONFLICT(workspace_id) DO UPDATE SET revision=excluded.revision, hash=excluded.hash",
        params![workspace_id, revision, hash]).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn hydrate(
    transaction: &Transaction<'_>,
    root: &Path,
    workspace_id: &str,
) -> Result<(), String> {
    if !active(root, workspace_id)? {
        return Ok(());
    }
    let prior_revision = cache_revision(transaction, workspace_id)?;
    let Some(manifest) = read(root, workspace_id)? else {
        if prior_revision.is_some() {
            return Err("工作区身份清单已丢失，已停止扫描；请检查 .tano/identities.json".into());
        }
        return Ok(());
    };
    let hash = storage::hash(&bytes(&manifest)?);
    if prior_revision == Some((manifest.revision, hash.clone())) {
        return Ok(());
    }

    let mut native_keys = std::collections::HashMap::new();
    {
        let mut stmt = transaction
            .prepare("SELECT path,id,native_key FROM files WHERE workspace_id=? AND deleted=0")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([workspace_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (path, id, key) = row.map_err(|e| e.to_string())?;
            native_keys.insert((path, id), key);
        }
    }
    transaction
        .execute("DELETE FROM files WHERE workspace_id=?", [workspace_id])
        .map_err(|e| e.to_string())?;
    transaction
        .execute(
            "DELETE FROM reference_ids WHERE workspace_id=?",
            [workspace_id],
        )
        .map_err(|e| e.to_string())?;
    for file in &manifest.files {
        let key = native_keys
            .get(&(file.path.clone(), file.id.clone()))
            .map(String::as_str)
            .unwrap_or("");
        transaction.execute("INSERT INTO files(workspace_id,path,id,hash,version,deleted,native_key) VALUES(?1,?2,?3,?4,?5,?6,?7)",
            params![workspace_id, file.path, file.id, file.hash, file.version, file.deleted, key]).map_err(|e| e.to_string())?;
    }
    for id in &manifest.reserved_ids {
        transaction
            .execute(
                "INSERT INTO reference_ids(workspace_id,id) VALUES(?1,?2)",
                params![workspace_id, id],
            )
            .map_err(|e| e.to_string())?;
    }
    set_cache_revision(transaction, workspace_id, manifest.revision, &hash)
}

fn from_cache(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    revision: u64,
) -> Result<IdentityManifest, String> {
    let files = {
        let mut statement = transaction
            .prepare(
                "SELECT path,id,hash,version,deleted FROM files WHERE workspace_id=? ORDER BY path",
            )
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([workspace_id], |row| {
                Ok(IdentityFile {
                    path: row.get(0)?,
                    id: row.get(1)?,
                    hash: row.get(2)?,
                    version: row.get(3)?,
                    deleted: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?
    };
    let reserved_ids = {
        let mut statement = transaction
            .prepare("SELECT id FROM reference_ids WHERE workspace_id=? ORDER BY id")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([workspace_id], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<String>, _>>()
            .map_err(|e| e.to_string())?
            .into_iter()
            .filter(|id| storage::is_short_id(id))
            .collect()
    };
    Ok(IdentityManifest {
        format: 1,
        workspace_id: workspace_id.into(),
        revision,
        files,
        reserved_ids,
    })
}

pub fn publish(
    transaction: &Transaction<'_>,
    root: &Path,
    workspace_id: &str,
) -> Result<(), String> {
    if !active(root, workspace_id)? {
        return Ok(());
    }
    let old = read(root, workspace_id)?;
    let revision = old.as_ref().map_or(1, |m| m.revision + 1);
    let proposed = from_cache(transaction, workspace_id, revision)?;
    validate(&proposed, workspace_id)?;
    if let Some(previous) = &old {
        if previous.files == proposed.files && previous.reserved_ids == proposed.reserved_ids {
            return set_cache_revision(
                transaction,
                workspace_id,
                previous.revision,
                &storage::hash(&bytes(previous)?),
            );
        }
    }
    let target = path(root);
    let new_bytes = bytes(&proposed)?;
    if let Some(previous) = old {
        let current = read(root, workspace_id)?.ok_or("身份清单被外部删除")?;
        if current != previous {
            return Err("身份清单已被外部修改，已保留双方版本".into());
        }
        storage::temporary(&target, &new_bytes)?
            .persist(&target)
            .map_err(|e| e.to_string())?;
    } else {
        storage::create_atomic(&target, &new_bytes)?;
    }
    set_cache_revision(
        transaction,
        workspace_id,
        revision,
        &storage::hash(&new_bytes),
    )
}

pub fn publish_cache(root: &Path, workspace_id: &str, cache: &Path) -> Result<(), String> {
    let mut connection = storage::database(cache)?;
    let transaction = connection.transaction().map_err(|e| e.to_string())?;
    // Reinitialization can publish an empty manifest before the first scan.
    cache_revision(&transaction, workspace_id)?;
    publish(&transaction, root, workspace_id)?;
    transaction.commit().map_err(|e| e.to_string())
}

pub fn reserve(
    root: &Path,
    workspace_id: &str,
    cache: &Path,
    occupied: &[String],
) -> Result<String, String> {
    let mut connection = storage::database(cache)?;
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    hydrate(&transaction, root, workspace_id)?;
    for id in occupied {
        if storage::is_short_id(id) {
            storage::claim_reference_id(&transaction, workspace_id, id)?;
        }
    }
    let id = storage::allocate_reference_id(&transaction, workspace_id)?;
    publish(&transaction, root, workspace_id)?;
    transaction.commit().map_err(|e| e.to_string())?;
    Ok(id)
}

pub fn claim_external(
    root: &Path,
    workspace_id: &str,
    cache: &Path,
    id: &str,
) -> Result<(), String> {
    if !storage::is_short_id(id) {
        return Err("对象身份无效".into());
    }
    let mut connection = storage::database(cache)?;
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    hydrate(&transaction, root, workspace_id)?;
    if !storage::claim_reference_id(&transaction, workspace_id, id)? {
        return Err("对象 ID 已被使用或预留，请重新生成建议".into());
    }
    publish(&transaction, root, workspace_id)?;
    transaction.commit().map_err(|e| e.to_string())
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PendingMove {
    root: String,
    workspace_id: String,
    from: String,
    to: String,
}

fn journal_path(cache: &Path, workspace_id: &str) -> Result<std::path::PathBuf, String> {
    uuid::Uuid::parse_str(workspace_id).map_err(|_| "无效的工作区身份")?;
    let directory = cache
        .parent()
        .ok_or("无效应用数据路径")?
        .join("identity-operations");
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    Ok(directory.join(format!("{workspace_id}.json")))
}

pub fn begin_move(
    root: &Path,
    workspace_id: &str,
    cache: &Path,
    from: &str,
    to: &str,
) -> Result<(), String> {
    if !active(root, workspace_id)? {
        return Ok(());
    }
    require(root, workspace_id)?;
    storage::validate_relative_path(from, storage::is_workspace_data_path(from))?;
    storage::validate_relative_path(to, storage::is_workspace_data_path(to))?;
    let journal = journal_path(cache, workspace_id)?;
    if journal.exists() || mutation_path(cache, workspace_id)?.exists() {
        return Err("上一次文件移动尚未恢复，请先刷新工作区".into());
    }
    let bytes = serde_json::to_vec(&PendingMove {
        root: root.to_string_lossy().into_owned(),
        workspace_id: workspace_id.into(),
        from: from.into(),
        to: to.into(),
    })
    .map_err(|e| e.to_string())?;
    storage::create_atomic(&journal, &bytes)
}

pub fn recover_move(root: &Path, workspace_id: &str, cache: &Path) -> Result<(), String> {
    if !active(root, workspace_id)? {
        return Ok(());
    }
    let journal = journal_path(cache, workspace_id)?;
    let Ok(metadata) = fs::symlink_metadata(&journal) else {
        return Ok(());
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 8 * 1024 {
        return Err("文件身份操作日志无效，原文件已保留".into());
    }
    let pending: PendingMove =
        serde_json::from_slice(&fs::read(&journal).map_err(|e| e.to_string())?)
            .map_err(|e| format!("文件身份操作日志损坏：{e}"))?;
    if pending.root != root.to_string_lossy()
        || pending.workspace_id != workspace_id
        || pending.from == pending.to
        || pending.to.starts_with(&format!("{}/", pending.from))
    {
        return Err("文件身份操作日志与当前工作区不匹配".into());
    }
    storage::validate_relative_path(
        &pending.from,
        storage::is_workspace_data_path(&pending.from),
    )?;
    storage::validate_relative_path(&pending.to, storage::is_workspace_data_path(&pending.to))?;
    let source = root.join(&pending.from);
    let destination = root.join(&pending.to);
    let source_exists = fs::symlink_metadata(&source).is_ok();
    let destination_exists = fs::symlink_metadata(&destination).is_ok();
    match (source_exists, destination_exists) {
        (true, false) => {
            fs::remove_file(journal).map_err(|e| e.to_string())?;
            Ok(())
        }
        (false, true) => {
            let mut manifest = read(root, workspace_id)?.ok_or("移动中身份清单缺失")?;
            let mut changed = false;
            for file in &mut manifest.files {
                if file.deleted {
                    continue;
                }
                if file.path == pending.from || file.path.starts_with(&format!("{}/", pending.from))
                {
                    file.path = format!("{}{}", pending.to, &file.path[pending.from.len()..]);
                    changed = true;
                }
            }
            if changed {
                manifest.files.sort_by(|a, b| a.path.cmp(&b.path));
                manifest.revision += 1;
                validate(&manifest, workspace_id)?;
                let target = path(root);
                storage::temporary(&target, &bytes(&manifest)?)?
                    .persist(&target)
                    .map_err(|e| e.to_string())?;
            }
            fs::remove_file(journal).map_err(|e| e.to_string())?;
            Ok(())
        }
        _ => Err("移动中源和目标状态不明确，已保留原文件及操作日志，请手动处理".into()),
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PendingMutation {
    root: String,
    workspace_id: String,
    kind: String,
    path: String,
    id: Option<String>,
    fingerprint: String,
    #[serde(default)]
    content_hash: Option<String>,
    manifest_hash: String,
    #[serde(default)]
    completed_hash: Option<String>,
}

fn mutation_path(cache: &Path, workspace_id: &str) -> Result<std::path::PathBuf, String> {
    uuid::Uuid::parse_str(workspace_id).map_err(|_| "无效的工作区身份")?;
    let directory = cache
        .parent()
        .ok_or("无效应用数据路径")?
        .join("identity-operations");
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    Ok(directory.join(format!("{workspace_id}-mutation.json")))
}

fn file_fingerprint(content: &[u8]) -> String {
    let mut hash = Sha256::new();
    hash.update(b"F");
    hash.update(content);
    format!("{:x}", hash.finalize())
}

fn fingerprint(root: &Path, target: &Path, count: &mut usize) -> Result<Option<String>, String> {
    let metadata = match fs::symlink_metadata(target) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    if metadata.file_type().is_symlink()
        || (!metadata.is_file() && !metadata.is_dir())
        || !fs::canonicalize(target)
            .map_err(|e| e.to_string())?
            .starts_with(root)
    {
        return Err("身份操作遇到符号链接或工作区外路径".into());
    }
    *count += 1;
    if *count > 20_000 {
        return Err("身份操作包含过多文件".into());
    }
    let mut hash = Sha256::new();
    if metadata.is_file() {
        hash.update(b"F");
        let mut file = fs::File::open(target).map_err(|e| e.to_string())?;
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let size = file.read(&mut buffer).map_err(|e| e.to_string())?;
            if size == 0 {
                break;
            }
            hash.update(&buffer[..size]);
        }
    } else {
        hash.update(b"D");
        let mut children = fs::read_dir(target)
            .map_err(|e| e.to_string())?
            .map(|entry| entry.map_err(|e| e.to_string()))
            .collect::<Result<Vec<_>, _>>()?;
        children.sort_by_key(|entry| entry.file_name());
        for child in children {
            let name = child
                .file_name()
                .into_string()
                .map_err(|_| "身份操作遇到无法表示的文件名")?;
            let digest =
                fingerprint(root, &child.path(), count)?.ok_or("身份操作期间文件已改变")?;
            hash.update((name.len() as u64).to_le_bytes());
            hash.update(name.as_bytes());
            hash.update(digest.as_bytes());
        }
    }
    Ok(Some(format!("{:x}", hash.finalize())))
}

fn start_mutation(
    workspace_id: &str,
    cache: &Path,
    pending: PendingMutation,
) -> Result<(), String> {
    let journal = mutation_path(cache, workspace_id)?;
    if journal.exists() || journal_path(cache, workspace_id)?.exists() {
        return Err("上一次文件身份操作尚未完成，请先刷新工作区".into());
    }
    storage::create_atomic(
        &journal,
        &serde_json::to_vec(&pending).map_err(|e| e.to_string())?,
    )
}

pub fn begin_create(
    root: &Path,
    workspace_id: &str,
    cache: &Path,
    relative: &str,
    content: &[u8],
) -> Result<(), String> {
    require(root, workspace_id)?;
    storage::validate_relative_path(relative, storage::is_workspace_data_path(relative))?;
    if fs::symlink_metadata(root.join(relative)).is_ok() {
        return Err("目标文件已存在".into());
    }
    if mutation_path(cache, workspace_id)?.exists() || journal_path(cache, workspace_id)?.exists() {
        return Err("上一次文件身份操作尚未完成".into());
    }
    let id = reserve(root, workspace_id, cache, &[])?;
    let manifest = read(root, workspace_id)?.ok_or("工作区身份清单缺失")?;
    start_mutation(
        workspace_id,
        cache,
        PendingMutation {
            root: root.to_string_lossy().into_owned(),
            workspace_id: workspace_id.into(),
            kind: "create".into(),
            path: relative.into(),
            id: Some(id),
            fingerprint: file_fingerprint(content),
            content_hash: Some(storage::hash(content)),
            manifest_hash: storage::hash(&bytes(&manifest)?),
            completed_hash: None,
        },
    )
}

pub fn begin_delete(
    root: &Path,
    workspace_id: &str,
    cache: &Path,
    relative: &str,
) -> Result<(), String> {
    require(root, workspace_id)?;
    storage::validate_relative_path(relative, storage::is_workspace_data_path(relative))?;
    let current = fingerprint(root, &root.join(relative), &mut 0)?.ok_or("删除目标已不存在")?;
    let manifest = read(root, workspace_id)?.ok_or("工作区身份清单缺失")?;
    start_mutation(
        workspace_id,
        cache,
        PendingMutation {
            root: root.to_string_lossy().into_owned(),
            workspace_id: workspace_id.into(),
            kind: "delete".into(),
            path: relative.into(),
            id: None,
            fingerprint: current,
            content_hash: None,
            manifest_hash: storage::hash(&bytes(&manifest)?),
            completed_hash: None,
        },
    )
}

pub fn recover_mutation(root: &Path, workspace_id: &str, cache: &Path) -> Result<(), String> {
    if !active(root, workspace_id)? {
        return Ok(());
    }
    let journal = mutation_path(cache, workspace_id)?;
    let metadata = match fs::symlink_metadata(&journal) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 8 * 1024 {
        return Err("文件身份操作日志无效，原文件已保留".into());
    }
    let mut pending: PendingMutation =
        serde_json::from_slice(&fs::read(&journal).map_err(|e| e.to_string())?)
            .map_err(|e| format!("文件身份操作日志损坏：{e}"))?;
    if pending.root != root.to_string_lossy()
        || pending.workspace_id != workspace_id
        || !matches!(pending.kind.as_str(), "create" | "delete")
    {
        return Err("文件身份操作日志与当前工作区不匹配".into());
    }
    storage::validate_relative_path(
        &pending.path,
        storage::is_workspace_data_path(&pending.path),
    )?;
    let mut manifest = read(root, workspace_id)?.ok_or("文件身份操作期间清单丢失")?;
    let current_hash = storage::hash(&bytes(&manifest)?);
    if pending.completed_hash.as_deref() == Some(current_hash.as_str()) {
        return fs::remove_file(journal).map_err(|e| e.to_string());
    }
    if current_hash != pending.manifest_hash {
        return Err("身份清单在文件操作期间被外部修改，已保留操作日志".into());
    }
    let current = fingerprint(root, &root.join(&pending.path), &mut 0)?;
    let changed = match pending.kind.as_str() {
        "create" => match current {
            None => false,
            Some(value) if value == pending.fingerprint => {
                let id = pending
                    .id
                    .as_deref()
                    .filter(|id| {
                        storage::is_short_id(id)
                            && manifest.reserved_ids.iter().any(|reserved| reserved == *id)
                    })
                    .ok_or("创建操作中的短 ID 无效")?;
                let content_hash = pending
                    .content_hash
                    .as_deref()
                    .filter(|hash| {
                        hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit())
                    })
                    .ok_or("创建操作中的内容 hash 无效")?;
                manifest.files.retain(|file| file.path != pending.path);
                manifest.files.push(IdentityFile {
                    path: pending.path.clone(),
                    id: id.into(),
                    hash: content_hash.into(),
                    version: 1,
                    deleted: false,
                });
                true
            }
            _ => return Err("创建期间目标文件被外部修改，已保留操作日志".into()),
        },
        "delete" => match current {
            None => {
                let prefix = format!("{}/", pending.path);
                for file in &mut manifest.files {
                    if file.path == pending.path || file.path.starts_with(&prefix) {
                        file.deleted = true;
                    }
                }
                true
            }
            Some(value) if value == pending.fingerprint => false,
            _ => return Err("删除期间目标文件被外部修改，已保留操作日志".into()),
        },
        _ => unreachable!(),
    };
    if changed {
        manifest.revision += 1;
        manifest.files.sort_by(|a, b| a.path.cmp(&b.path));
        validate(&manifest, workspace_id)?;
        let proposed = bytes(&manifest)?;
        let completed_hash = storage::hash(&proposed);
        let before = read(root, workspace_id)?.ok_or("身份清单被外部删除")?;
        if storage::hash(&bytes(&before)?) != pending.manifest_hash {
            return Err("身份清单已被外部修改，已保留操作日志".into());
        }
        pending.completed_hash = Some(completed_hash);
        storage::temporary(
            &journal,
            &serde_json::to_vec(&pending).map_err(|e| e.to_string())?,
        )?
        .persist(&journal)
        .map_err(|e| e.to_string())?;
        storage::temporary(&path(root), &proposed)?
            .persist(path(root))
            .map_err(|e| e.to_string())?;
    }
    fs::remove_file(journal).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace() -> (
        tempfile::TempDir,
        tempfile::TempDir,
        std::path::PathBuf,
        String,
        std::path::PathBuf,
    ) {
        let directory = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(directory.path()).unwrap();
        let id = storage::workspace_identity(&root).unwrap();
        let cache = data.path().join("index.sqlite");
        (directory, data, root, id, cache)
    }

    #[test]
    fn external_identity_claims_never_reuse_reserved_ids_even_after_index_loss() {
        let (_directory, _data, root, id, cache) = workspace();
        storage::scan(&root, &id, &cache).unwrap();
        claim_external(&root, &id, &cache, "f12345").unwrap();
        assert!(claim_external(&root, &id, &cache, "f12345").is_err());
        let fresh_cache = cache.with_file_name("fresh.sqlite");
        assert!(claim_external(&root, &id, &fresh_cache, "f12345").is_err());
        claim_external(&root, &id, &fresh_cache, "f12346").unwrap();
    }

    #[test]
    fn portable_manifest_recovers_file_and_object_ids_after_index_loss() {
        let (_directory, _data, root, workspace_id, cache) = workspace();
        fs::write(root.join("note.md"), "# [[person:a82f91]]").unwrap();
        fs::create_dir(root.join(".tano/objects")).unwrap();
        fs::write(root.join(".tano/objects/person.tano.json"),
            r#"{"version":1,"id":"a82f91","type":"person","name":"Alice","description":"","archived":false,"properties":{}}"#).unwrap();
        fs::write(
            root.join(".tano/relations.tano-relations.json"),
            r#"{"version":1,"relations":[]}"#,
        )
        .unwrap();
        let before = storage::scan(&root, &workspace_id, &cache).unwrap();
        let identities: Vec<_> = before
            .files
            .iter()
            .map(|file| (file.path.clone(), file.id.clone()))
            .collect();
        let manifest = read(&root, &workspace_id).unwrap().unwrap();
        assert!(manifest.reserved_ids.contains(&"a82f91".to_string()));
        assert_eq!(manifest.files.len(), 3);
        fs::remove_file(&cache).unwrap();
        let after = storage::scan(&root, &workspace_id, &cache).unwrap();
        assert_eq!(
            after
                .files
                .iter()
                .map(|file| (file.path.clone(), file.id.clone()))
                .collect::<Vec<_>>(),
            identities
        );
        assert_eq!(
            fs::read_to_string(root.join("note.md")).unwrap(),
            "# [[person:a82f91]]"
        );
        assert_eq!(
            storage::reserve_reference_id(&cache, &workspace_id, &["a82f91".into()])
                .unwrap()
                .len(),
            6
        );
    }

    #[test]
    fn interrupted_move_recovers_identity_with_duplicate_content_and_empty_cache() {
        let (_directory, _data, root, workspace_id, cache) = workspace();
        fs::write(root.join("one.md"), "same bytes").unwrap();
        fs::write(root.join("two.md"), "same bytes").unwrap();
        let before = storage::scan(&root, &workspace_id, &cache).unwrap();
        let original = before
            .files
            .iter()
            .find(|file| file.path == "one.md")
            .unwrap()
            .id
            .clone();
        begin_move(&root, &workspace_id, &cache, "one.md", "moved.md").unwrap();
        fs::rename(root.join("one.md"), root.join("moved.md")).unwrap();
        fs::remove_file(&cache).unwrap();
        let after = storage::scan(&root, &workspace_id, &cache).unwrap();
        assert_eq!(
            after
                .files
                .iter()
                .find(|file| file.path == "moved.md")
                .unwrap()
                .id,
            original
        );
        assert_eq!(
            after
                .files
                .iter()
                .find(|file| file.path == "two.md")
                .unwrap()
                .id,
            before
                .files
                .iter()
                .find(|file| file.path == "two.md")
                .unwrap()
                .id
        );
        assert_eq!(
            read(&root, &workspace_id)
                .unwrap()
                .unwrap()
                .files
                .iter()
                .find(|file| file.path == "moved.md")
                .unwrap()
                .id,
            original
        );
    }

    #[test]
    fn invalid_manifest_is_preserved_and_missing_manifest_is_not_recreated() {
        let (_directory, _data, root, workspace_id, cache) = workspace();
        fs::write(root.join("note.md"), "text").unwrap();
        storage::scan(&root, &workspace_id, &cache).unwrap();
        let file = path(&root);
        fs::write(&file, "broken JSON").unwrap();
        assert!(storage::scan(&root, &workspace_id, &cache).is_err());
        assert_eq!(fs::read_to_string(&file).unwrap(), "broken JSON");
        fs::remove_file(&file).unwrap();
        assert!(storage::scan(&root, &workspace_id, &cache).is_err());
        assert!(!file.exists());
    }

    #[test]
    fn interrupted_delete_and_create_at_same_path_get_distinct_ids_without_index() {
        let (_directory, _data, root, workspace_id, cache) = workspace();
        fs::write(root.join("note.md"), "original").unwrap();
        let old = storage::scan(&root, &workspace_id, &cache).unwrap().files[0]
            .id
            .clone();
        begin_delete(&root, &workspace_id, &cache, "note.md").unwrap();
        fs::remove_file(root.join("note.md")).unwrap();
        fs::remove_file(&cache).unwrap();
        storage::scan(&root, &workspace_id, &cache).unwrap();
        assert!(read(&root, &workspace_id)
            .unwrap()
            .unwrap()
            .files
            .iter()
            .any(|file| file.id == old && file.deleted));

        begin_create(&root, &workspace_id, &cache, "note.md", b"replacement").unwrap();
        fs::write(root.join("note.md"), "replacement").unwrap();
        fs::remove_file(&cache).unwrap();
        let reopened = storage::scan(&root, &workspace_id, &cache).unwrap();
        let new_id = &reopened.files[0].id;
        assert_ne!(new_id, &old);
        let manifest = read(&root, &workspace_id).unwrap().unwrap();
        assert!(manifest.reserved_ids.contains(&old));
        assert!(manifest.reserved_ids.contains(new_id));
        assert_eq!(
            fs::read_to_string(root.join("note.md")).unwrap(),
            "replacement"
        );
    }

    #[test]
    fn mutation_recovery_preserves_external_changes_and_replays_completed_manifest() {
        let (_directory, _data, root, workspace_id, cache) = workspace();
        storage::scan(&root, &workspace_id, &cache).unwrap();
        begin_create(&root, &workspace_id, &cache, "note.md", b"expected").unwrap();
        fs::write(root.join("note.md"), "external").unwrap();
        assert!(storage::scan(&root, &workspace_id, &cache)
            .err()
            .unwrap()
            .contains("外部修改"));
        assert_eq!(
            fs::read_to_string(root.join("note.md")).unwrap(),
            "external"
        );
        assert!(mutation_path(&cache, &workspace_id).unwrap().exists());

        fs::write(root.join("note.md"), "expected").unwrap();
        let journal = mutation_path(&cache, &workspace_id).unwrap();
        let mut pending: PendingMutation =
            serde_json::from_slice(&fs::read(&journal).unwrap()).unwrap();
        let mut manifest = read(&root, &workspace_id).unwrap().unwrap();
        manifest.files.push(IdentityFile {
            path: "note.md".into(),
            id: pending.id.clone().unwrap(),
            hash: pending.content_hash.clone().unwrap(),
            version: 1,
            deleted: false,
        });
        manifest.revision += 1;
        let completed = bytes(&manifest).unwrap();
        pending.completed_hash = Some(storage::hash(&completed));
        fs::write(&journal, serde_json::to_vec(&pending).unwrap()).unwrap();
        fs::write(path(&root), completed).unwrap();
        let opened = storage::scan(&root, &workspace_id, &cache).unwrap();
        assert_eq!(opened.files[0].id, pending.id.unwrap());
        assert!(!journal.exists());
    }
}
