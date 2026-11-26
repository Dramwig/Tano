// SPDX-License-Identifier: MIT
//! Remote SSH workspace storage operations with full Tano invariants:
//! - `.tano/config.json` (v1) and `.tano/identities.json` (v1) on remote server
//! - Local SQLite `index.sqlite` cache for stable short IDs, scan fingerprints, and FTS5 search
//! - Strict base-hash compare-and-swap atomic writes and symlink escape defense
//! - Remote attachments, Excel backup-and-save, and bounded-cache `tano-asset://` responses

use super::{
    transport::{RemoteScannedEntry, RemoteTransport, RemoteWriteCheckOutcome},
    types::{RemoteConnectionPhase, RemoteTrashMode, RemoteWorkspaceInfo},
    uri::{join_remote_posix, remote_display_name},
};
use crate::{
    assets,
    assistant_files::FileChangeRequest,
    error::NativeError,
    identity_manifest::{self, IdentityFile, IdentityManifest},
    storage::{
        self, allocate_reference_id, claim_reference_id, database, hash, is_editable_code_path,
        is_markdown, is_short_id, is_workspace_data_path, Entry, Snapshot, Workspace, WriteResult,
        MAX_DOCUMENT_BYTES, MAX_WORKSPACE_ENTRIES,
    },
};
use rusqlite::{params, Transaction};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    path::Path,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::http::{Request, Response, StatusCode};

const MAX_CODE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_ASSET_BYTES: u64 = 50 * 1024 * 1024;
const MAX_MANIFEST_BYTES: u64 = 16 * 1024 * 1024;
const ASSET_CACHE_MAX_BYTES: usize = 32 * 1024 * 1024;

#[derive(Default)]
pub struct AssetCache {
    entries: HashMap<String, Vec<u8>>,
    order: VecDeque<String>,
    total_bytes: usize,
}

impl AssetCache {
    pub fn get(&mut self, key: &str) -> Option<Vec<u8>> {
        let bytes = self.entries.get(key)?.clone();
        self.order.retain(|k| k != key);
        self.order.push_back(key.to_owned());
        Some(bytes)
    }

    pub fn insert(&mut self, key: String, bytes: Vec<u8>) {
        if bytes.len() > ASSET_CACHE_MAX_BYTES / 2 {
            return;
        }
        if let Some(old) = self.entries.remove(&key) {
            self.total_bytes = self.total_bytes.saturating_sub(old.len());
            self.order.retain(|k| k != &key);
        }
        while self.total_bytes + bytes.len() > ASSET_CACHE_MAX_BYTES {
            let Some(evict) = self.order.pop_front() else {
                break;
            };
            if let Some(removed) = self.entries.remove(&evict) {
                self.total_bytes = self.total_bytes.saturating_sub(removed.len());
            }
        }
        self.total_bytes += bytes.len();
        self.order.push_back(key.clone());
        self.entries.insert(key, bytes);
    }

    pub fn clear(&mut self) {
        self.entries.clear();
        self.order.clear();
        self.total_bytes = 0;
    }
}

fn is_standard_document_path(relative: &str) -> bool {
    let p = Path::new(relative);
    is_markdown(p)
        || storage::is_data_table(p)
        || p.file_name().is_some_and(|name| {
            let s = name.to_string_lossy();
            s == "capabilities.json"
                || s.ends_with(".tano.json")
                || s.ends_with(".tano-relations.json")
        })
}

fn validate_editable_relative(relative: &str) -> Result<bool, String> {
    let data_path = is_workspace_data_path(relative);
    storage::validate_relative_path(relative, data_path)?;
    if is_standard_document_path(relative) {
        Ok(false)
    } else if !data_path && is_editable_code_path(Path::new(relative)) {
        Ok(true)
    } else {
        Err(
            NativeError::UnsupportedFormat("当前版本仅编辑 Markdown、数据表和常见代码/纯文本文件")
                .into(),
        )
    }
}

pub(crate) async fn ensure_no_symlink_chain(
    transport: &dyn RemoteTransport,
    root: &str,
    relative: &str,
) -> Result<String, String> {
    let full = join_remote_posix(root, relative).map_err(|e| e.to_string())?;
    let mut current = root.to_owned();
    for segment in relative.split('/').filter(|s| !s.is_empty()) {
        current = if current == "/" {
            format!("/{segment}")
        } else {
            format!("{current}/{segment}")
        };
        if let Some(stat) = transport.lstat(&current).await.map_err(|e| e.to_string())? {
            if stat.is_symlink {
                return Err(
                    NativeError::SymlinkEscape("为保护工作空间，不跟随远端符号链接").into(),
                );
            }
        }
    }
    Ok(full)
}

async fn ensure_remote_parent_dirs(
    transport: &dyn RemoteTransport,
    root: &str,
    relative: &str,
) -> Result<String, String> {
    let data_path = is_workspace_data_path(relative);
    storage::validate_relative_path(relative, data_path)?;
    let parts: Vec<&str> = relative.split('/').collect();
    for count in 1..parts.len() {
        let parent_rel = parts[..count].join("/");
        let parent_abs = ensure_no_symlink_chain(transport, root, &parent_rel).await?;
        match transport
            .lstat(&parent_abs)
            .await
            .map_err(|e| e.to_string())?
        {
            Some(stat) if stat.is_dir && !stat.is_symlink => {}
            Some(stat) if stat.is_symlink => {
                return Err(
                    NativeError::SymlinkEscape("为保护工作空间，不跟随远端符号链接").into(),
                );
            }
            Some(_) => {
                return Err(NativeError::InvalidPath("远端目标父路径不是文件夹").into());
            }
            None => {
                transport
                    .mkdir(&parent_abs)
                    .await
                    .map_err(|e| e.to_string())?;
            }
        }
    }
    ensure_no_symlink_chain(transport, root, relative).await
}

pub async fn existing_workspace_identity(
    transport: &dyn RemoteTransport,
    root: &str,
) -> Result<Option<String>, String> {
    let tano_dir = join_remote_posix(root, ".tano").map_err(|e| e.to_string())?;
    let Some(dir_stat) = transport
        .lstat(&tano_dir)
        .await
        .map_err(|e| e.to_string())?
    else {
        return Ok(None);
    };
    if dir_stat.is_symlink || !dir_stat.is_dir {
        return Err(NativeError::SymlinkEscape(".tano 必须是普通文件夹，不能是符号链接").into());
    }
    let config_path = join_remote_posix(root, ".tano/config.json").map_err(|e| e.to_string())?;
    let Some(cfg_stat) = transport
        .lstat(&config_path)
        .await
        .map_err(|e| e.to_string())?
    else {
        return Err(
            NativeError::NotFound(".tano/config.json 缺失，已停止打开，未改动远端文件").into(),
        );
    };
    if cfg_stat.is_symlink || !cfg_stat.is_file {
        return Err(
            NativeError::SymlinkEscape("工作空间配置必须是普通文件，不能是符号链接").into(),
        );
    }
    let (bytes, _) = transport
        .read_bytes(&config_path, 262_144)
        .await
        .map_err(|e| e.to_string())?;
    let value: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|e| format!("工作空间配置损坏：{e}"))?;
    if value
        .get("format")
        .is_some_and(|format| format.as_u64() != Some(1))
    {
        return Err(NativeError::UnsupportedFormat(
            "此远端工作区的数据格式不受当前版本支持，请升级 Tano；已停止打开和写入，原文件已保留",
        )
        .into());
    }
    let id = value
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or(NativeError::UnsupportedFormat("工作空间配置缺少 id"))?;
    uuid::Uuid::parse_str(id)
        .map_err(|_| NativeError::UnsupportedFormat("工作空间 id 必须是 UUID"))?;
    Ok(Some(id.to_owned()))
}

pub async fn assert_workspace_identity(
    transport: &dyn RemoteTransport,
    root: &str,
    expected_id: &str,
) -> Result<(), String> {
    match existing_workspace_identity(transport, root).await? {
        Some(id) if id == expected_id => Ok(()),
        _ => Err(NativeError::WorkspaceSwitched(
            "远端工作区身份已丢失或改变，已停止写入；请检查 .tano 数据",
        )
        .into()),
    }
}

pub async fn ensure_workspace_identity(
    transport: &dyn RemoteTransport,
    root: &str,
) -> Result<(String, bool), String> {
    if let Some(existing) = existing_workspace_identity(transport, root).await? {
        return Ok((existing, false));
    }
    let tano_dir = join_remote_posix(root, ".tano").map_err(|e| e.to_string())?;
    transport
        .mkdir(&tano_dir)
        .await
        .map_err(|e| format!("无法在远端创建 .tano 目录：{e}"))?;
    let id = uuid::Uuid::new_v4().to_string();
    let created_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as u64;
    let content = serde_json::to_string_pretty(&serde_json::json!({
        "id": id,
        "format": 1,
        "name": "Tano",
        "createdAt": created_at,
    }))
    .map_err(|e| e.to_string())?;
    let config_path = join_remote_posix(root, ".tano/config.json").map_err(|e| e.to_string())?;
    transport
        .write_atomic_replace(&config_path, content.as_bytes())
        .await
        .map_err(|e| format!("无法在远端写入 .tano/config.json：{e}"))?;
    Ok((id, true))
}

pub async fn read_manifest(
    transport: &dyn RemoteTransport,
    root: &str,
    workspace_id: &str,
) -> Result<Option<IdentityManifest>, String> {
    let manifest_path =
        join_remote_posix(root, ".tano/identities.json").map_err(|e| e.to_string())?;
    let Some(stat) = transport
        .lstat(&manifest_path)
        .await
        .map_err(|e| e.to_string())?
    else {
        return Ok(None);
    };
    if !stat.is_file || stat.is_symlink || stat.size > MAX_MANIFEST_BYTES {
        return Err("远端工作区身份清单必须是不超过 16 MiB 的普通文件".into());
    }
    let (bytes, _) = transport
        .read_bytes(&manifest_path, MAX_MANIFEST_BYTES)
        .await
        .map_err(|e| e.to_string())?;
    let manifest: IdentityManifest = serde_json::from_slice(&bytes)
        .map_err(|e| format!("远端工作区身份清单损坏，原文件已保留：{e}"))?;
    identity_manifest::validate(&manifest, workspace_id)?;
    Ok(Some(manifest))
}

fn hydrate_manifest_tx(
    tx: &Transaction,
    manifest: &IdentityManifest,
    workspace_id: &str,
) -> Result<(), String> {
    for reserved in &manifest.reserved_ids {
        claim_reference_id(tx, workspace_id, reserved)?;
    }
    for file in &manifest.files {
        claim_reference_id(tx, workspace_id, &file.id)?;
        let existing: Option<(String, i64, i64)> = tx
            .query_row(
                "SELECT id, version, deleted FROM files WHERE workspace_id=?1 AND path=?2",
                params![workspace_id, file.path],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .ok();
        let should_apply = match existing {
            None => true,
            Some((old_id, old_ver, _)) => old_id != file.id || file.version > old_ver,
        };
        if should_apply {
            tx.execute(
                "INSERT INTO files (workspace_id, path, id, hash, version, deleted, native_key)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, '')
                 ON CONFLICT(workspace_id, path) DO UPDATE SET
                   id=excluded.id, hash=excluded.hash, version=excluded.version, deleted=excluded.deleted",
                params![
                    workspace_id,
                    file.path,
                    file.id,
                    file.hash,
                    file.version,
                    i64::from(file.deleted)
                ],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn build_manifest_from_tx(
    tx: &Transaction,
    workspace_id: &str,
    previous: Option<&IdentityManifest>,
) -> Result<IdentityManifest, String> {
    let mut files = Vec::new();
    {
        let mut stmt = tx
            .prepare(
                "SELECT path, id, hash, version, deleted FROM files WHERE workspace_id=?1 ORDER BY path",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([workspace_id], |row| {
                Ok(IdentityFile {
                    path: row.get(0)?,
                    id: row.get(1)?,
                    hash: row.get(2)?,
                    version: row.get(3)?,
                    deleted: row.get::<_, i64>(4)? != 0,
                })
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let item = row.map_err(|e| e.to_string())?;
            if is_short_id(&item.id) {
                files.push(item);
            }
        }
    }
    let mut reserved_set: HashSet<String> = HashSet::new();
    {
        let mut stmt = tx
            .prepare("SELECT id FROM reference_ids WHERE workspace_id=?1 ORDER BY id")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([workspace_id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        for row in rows {
            let id = row.map_err(|e| e.to_string())?;
            if is_short_id(&id) {
                reserved_set.insert(id);
            }
        }
    }
    for file in &files {
        reserved_set.insert(file.id.clone());
    }
    let mut reserved_ids: Vec<String> = reserved_set.into_iter().collect();
    reserved_ids.sort();

    let prev_rev = previous.map(|m| m.revision).unwrap_or(0);
    let unchanged = previous.is_some_and(|m| m.files == files && m.reserved_ids == reserved_ids);
    let revision = if unchanged && prev_rev > 0 {
        prev_rev
    } else {
        prev_rev.saturating_add(1).max(1)
    };
    let manifest = IdentityManifest {
        format: 1,
        workspace_id: workspace_id.to_owned(),
        revision,
        files,
        reserved_ids,
    };
    identity_manifest::validate(&manifest, workspace_id)?;
    Ok(manifest)
}

async fn publish_manifest_if_changed(
    transport: &dyn RemoteTransport,
    root: &str,
    workspace_id: &str,
    previous: Option<&IdentityManifest>,
    next: &IdentityManifest,
) -> Result<(), String> {
    if previous.is_some_and(|prev| {
        prev.files == next.files
            && prev.reserved_ids == next.reserved_ids
            && prev.revision == next.revision
    }) {
        return Ok(());
    }
    assert_workspace_identity(transport, root, workspace_id).await?;
    let bytes = serde_json::to_vec_pretty(next).map_err(|e| e.to_string())?;
    let manifest_path =
        join_remote_posix(root, ".tano/identities.json").map_err(|e| e.to_string())?;
    transport
        .write_atomic_replace(&manifest_path, &bytes)
        .await
        .map_err(|e| format!("无法同步远端身份清单 .tano/identities.json：{e}"))?;
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

pub async fn remote_scan(
    transport: &dyn RemoteTransport,
    root: &str,
    uri: &str,
    host_id: &str,
    host_label: &str,
    workspace_id: &str,
    cache: &Path,
    latency_ms: Option<u64>,
) -> Result<Workspace, String> {
    assert_workspace_identity(transport, root, workspace_id).await?;
    let remote_manifest = read_manifest(transport, root, workspace_id).await?;
    let scanned: Vec<RemoteScannedEntry> = transport
        .scan_tree(root, MAX_WORKSPACE_ENTRIES)
        .await
        .map_err(|e| e.to_string())?;

    // Hydrate cache and read existing rows before doing any remote hashing/reading.
    let old: HashMap<String, CachedIdentity> = {
        let mut connection = database(cache)?;
        let tx = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        if let Some(manifest) = &remote_manifest {
            hydrate_manifest_tx(&tx, manifest, workspace_id)?;
        }
        tx.execute_batch(
            "CREATE TABLE IF NOT EXISTS scan_fingerprints (
                workspace_id TEXT NOT NULL, path TEXT NOT NULL, hash TEXT NOT NULL, stamp TEXT NOT NULL,
                PRIMARY KEY(workspace_id, path));",
        )
        .map_err(|e| e.to_string())?;
        let map = {
            let mut stmt = tx
                .prepare(
                    "SELECT f.path, f.id, f.hash, f.native_key, f.version, COALESCE(c.stamp, ''), s.rowid IS NOT NULL
                     FROM files f
                     LEFT JOIN scan_fingerprints c
                       ON c.workspace_id=f.workspace_id AND c.path=f.path AND c.hash=f.hash
                     LEFT JOIN search_documents s
                       ON s.workspace=f.workspace_id AND s.file_id=f.id AND s.path=f.path AND s.hash=f.hash
                     WHERE f.workspace_id=?1 AND f.deleted=0",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([workspace_id], |row| {
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
            rows.collect::<Result<HashMap<_, _>, _>>()
                .map_err(|e| e.to_string())?
        };
        tx.commit().map_err(|e| e.to_string())?;
        map
    };

    // Determine which files changed and need remote hashing or Markdown content reads for FTS5.
    let mut need_hash = Vec::new();
    let mut need_markdown_bytes = Vec::new();
    let mut need_object_id_bytes = Vec::new();
    for item in &scanned {
        if item.is_dir {
            continue;
        }
        let searchable = is_markdown(Path::new(&item.path)) && item.size <= MAX_DOCUMENT_BYTES;
        let is_cached = old.get(&item.path).is_some_and(|cached| {
            !item.stamp.is_empty()
                && cached.stamp == item.stamp
                && cached.native_key == item.native_key
                && is_short_id(&cached.id)
                && !cached.hash.is_empty()
                && (!searchable || cached.indexed)
        });
        if !is_cached {
            if searchable {
                need_markdown_bytes.push(item.path.clone());
            } else {
                need_hash.push(item.path.clone());
            }
        }
        if item.path.ends_with(".tano.json") && item.size <= MAX_DOCUMENT_BYTES {
            need_object_id_bytes.push(item.path.clone());
        }
    }

    let mut fetched_markdown: HashMap<String, Vec<u8>> = HashMap::new();
    for rel in &need_markdown_bytes {
        let full = join_remote_posix(root, rel).map_err(|e| e.to_string())?;
        if let Ok((bytes, _)) = transport.read_bytes(&full, MAX_DOCUMENT_BYTES).await {
            fetched_markdown.insert(rel.clone(), bytes);
        }
    }
    let batched_hashes = transport
        .batch_hash(root, &need_hash)
        .await
        .map_err(|e| e.to_string())?;

    let mut claimed_object_ids = Vec::new();
    for rel in &need_object_id_bytes {
        let full = join_remote_posix(root, rel).map_err(|e| e.to_string())?;
        if let Ok((bytes, _)) = transport.read_bytes(&full, MAX_DOCUMENT_BYTES).await {
            if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                if let Some(obj_id) = value
                    .get("id")
                    .and_then(|v| v.as_str())
                    .filter(|id| is_short_id(id))
                {
                    claimed_object_ids.push(obj_id.to_owned());
                }
            }
        }
    }

    // Reconcile identities in a single SQLite transaction.
    let mut current_paths = HashSet::new();
    let mut current_native_counts: HashMap<&str, usize> = HashMap::new();
    for item in scanned.iter().filter(|e| !e.is_dir) {
        current_paths.insert(item.path.as_str());
        if !item.native_key.is_empty() {
            *current_native_counts
                .entry(item.native_key.as_str())
                .or_default() += 1;
        }
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

    let mut identities: HashMap<String, &CachedIdentity> = HashMap::new();
    let mut claimed = HashSet::new();
    // 1. Match by inode/native_key
    for item in scanned
        .iter()
        .filter(|e| !e.is_dir && !e.native_key.is_empty())
    {
        let prev = old
            .get(&item.path)
            .filter(|c| c.native_key == item.native_key);
        let relocated = || {
            let candidates = old_by_native.get(item.native_key.as_str())?;
            (candidates.len() == 1
                && current_native_counts.get(item.native_key.as_str()) == Some(&1))
            .then_some(candidates[0])
        };
        if let Some(cached) = prev.or_else(relocated) {
            if claimed.insert(cached.id.clone()) {
                identities.insert(item.path.clone(), cached);
            }
        }
    }
    // 2. Match unchanged paths (covers atomic-save inode replacement and SFTP-only empty native_key)
    for item in scanned.iter().filter(|e| !e.is_dir) {
        if identities.contains_key(&item.path) {
            continue;
        }
        if let Some(cached) = old.get(&item.path) {
            let survives_elsewhere = !cached.native_key.is_empty()
                && cached.native_key != item.native_key
                && current_native_counts.contains_key(cached.native_key.as_str());
            if !survives_elsewhere && claimed.insert(cached.id.clone()) {
                identities.insert(item.path.clone(), cached);
            }
        }
    }

    // 3. Content-hash rename matching for unresolved entries
    let mut missing_by_hash: HashMap<&str, Vec<&CachedIdentity>> = HashMap::new();
    for cached in old.values().filter(|c| {
        !claimed.contains(&c.id)
            && (c.native_key.is_empty()
                || !current_native_counts.contains_key(c.native_key.as_str()))
    }) {
        if !cached.hash.is_empty() {
            missing_by_hash
                .entry(&cached.hash)
                .or_default()
                .push(cached);
        }
    }

    let mut digests: HashMap<String, String> = HashMap::new();
    let mut unresolved_hash_counts: HashMap<String, usize> = HashMap::new();
    for item in scanned.iter().filter(|e| !e.is_dir) {
        let digest = if let Some(bytes) = fetched_markdown.get(&item.path) {
            hash(bytes)
        } else if let Some(d) = batched_hashes.get(&item.path) {
            d.clone()
        } else if let Some(cached) = old.get(&item.path) {
            cached.hash.clone()
        } else {
            String::new()
        };
        if !identities.contains_key(&item.path) && !digest.is_empty() {
            *unresolved_hash_counts.entry(digest.clone()).or_default() += 1;
        }
        digests.insert(item.path.clone(), digest);
    }

    let mut entries = Vec::with_capacity(scanned.len());
    let next_manifest = {
        let mut connection = database(cache)?;
        let tx = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        for obj_id in &claimed_object_ids {
            claim_reference_id(&tx, workspace_id, obj_id)?;
        }
        for old_path in old.keys().filter(|p| !current_paths.contains(p.as_str())) {
            tx.execute(
                "UPDATE files SET deleted=1 WHERE workspace_id=?1 AND path=?2",
                params![workspace_id, old_path],
            )
            .map_err(|e| e.to_string())?;
        }

        for item in &scanned {
            if item.is_dir {
                entries.push(Entry::new(
                    format!("folder:{}", item.path),
                    item.path.clone(),
                    item.name.clone(),
                    "directory".into(),
                    0,
                    item.modified_ms,
                    None,
                ));
                continue;
            }
            let digest = digests.get(&item.path).cloned().unwrap_or_default();
            let identity = identities.get(&item.path).copied().or_else(|| {
                (unresolved_hash_counts.get(digest.as_str()) == Some(&1))
                    .then(|| {
                        let candidates = missing_by_hash.get(digest.as_str())?;
                        let mut avail = candidates
                            .iter()
                            .copied()
                            .filter(|c| !claimed.contains(&c.id));
                        let one = avail.next()?;
                        avail.next().is_none().then_some(one)
                    })
                    .flatten()
            });
            let file_id = match identity.filter(|c| is_short_id(&c.id)) {
                Some(cached) => cached.id.clone(),
                None => allocate_reference_id(&tx, workspace_id)?,
            };
            let version = identity
                .map(|c| c.version + i64::from(c.hash != digest))
                .unwrap_or(1);
            claimed.insert(file_id.clone());

            if let Some(bytes) = fetched_markdown.get(&item.path) {
                crate::search::update(
                    &tx,
                    workspace_id,
                    &file_id,
                    &item.path,
                    &digest,
                    Some(bytes.as_slice()),
                )?;
            }

            tx.prepare_cached(
                "INSERT INTO files (workspace_id, path, id, hash, version, deleted, native_key)
                 VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)
                 ON CONFLICT(workspace_id, path) DO UPDATE SET
                   id=excluded.id, version=excluded.version, hash=excluded.hash,
                   deleted=0, native_key=excluded.native_key",
            )
            .map_err(|e| e.to_string())?
            .execute(params![
                workspace_id,
                item.path,
                file_id,
                digest,
                version,
                item.native_key
            ])
            .map_err(|e| e.to_string())?;

            tx.prepare_cached(
                "INSERT INTO scan_fingerprints VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(workspace_id, path) DO UPDATE SET hash=excluded.hash, stamp=excluded.stamp",
            )
            .map_err(|e| e.to_string())?
            .execute(params![workspace_id, item.path, digest, item.stamp])
            .map_err(|e| e.to_string())?;

            entries.push(Entry::new(
                file_id,
                item.path.clone(),
                item.name.clone(),
                "file".into(),
                item.size,
                item.modified_ms,
                (!digest.is_empty()).then_some(digest),
            ));
        }

        tx.execute(
            "DELETE FROM scan_fingerprints WHERE workspace_id=?1 AND NOT EXISTS (
                SELECT 1 FROM files f WHERE f.workspace_id=scan_fingerprints.workspace_id
                AND f.path=scan_fingerprints.path AND f.deleted=0)",
            [workspace_id],
        )
        .map_err(|e| e.to_string())?;
        crate::search::prune(&tx, workspace_id)?;
        let manifest = build_manifest_from_tx(&tx, workspace_id, remote_manifest.as_ref())?;
        tx.commit().map_err(|e| e.to_string())?;
        manifest
    };

    publish_manifest_if_changed(
        transport,
        root,
        workspace_id,
        remote_manifest.as_ref(),
        &next_manifest,
    )
    .await?;

    let has_git_dir = match join_remote_posix(root, ".git") {
        Ok(git_path) => transport
            .lstat(&git_path)
            .await
            .ok()
            .flatten()
            .is_some_and(|s| s.is_dir && !s.is_symlink),
        Err(_) => false,
    };

    entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(Workspace {
        id: workspace_id.into(),
        name: remote_display_name(root),
        path: uri.into(),
        files: entries,
        newly_created: None,
        reinitialized: None,
        remote: Some(RemoteWorkspaceInfo {
            kind: "ssh".into(),
            host_id: host_id.into(),
            host_label: host_label.into(),
            remote_path: root.into(),
            transport: transport.transport_kind().into(),
            status: RemoteConnectionPhase::Connected,
            latency_ms,
            capabilities: Some(transport.capabilities()),
            git_repo: has_git_dir.then_some(true),
        }),
    })
}

pub async fn remote_read_document(
    transport: &dyn RemoteTransport,
    root: &str,
    workspace_id: &str,
    relative: &str,
) -> Result<Snapshot, String> {
    assert_workspace_identity(transport, root, workspace_id).await?;
    let is_code = validate_editable_relative(relative)?;
    let full = ensure_no_symlink_chain(transport, root, relative).await?;
    let limit = if is_code {
        MAX_CODE_BYTES
    } else {
        MAX_DOCUMENT_BYTES
    };
    let (bytes, stat) = transport
        .read_bytes(&full, limit)
        .await
        .map_err(|e| e.to_string())?;
    if is_code && bytes.contains(&0) {
        return Err(NativeError::UnsupportedFormat("检测到二进制文件，无法作为纯文本编辑").into());
    }
    let content = String::from_utf8(bytes.clone())
        .map_err(|_| NativeError::InvalidEncoding("文档必须使用 UTF-8 编码"))?;
    Ok(Snapshot::new(content, hash(&bytes), stat.modified_ms))
}

pub async fn remote_write_document(
    transport: &dyn RemoteTransport,
    root: &str,
    workspace_id: &str,
    relative: &str,
    content: &str,
    expected_hash: &str,
) -> Result<WriteResult, String> {
    assert_workspace_identity(transport, root, workspace_id).await?;
    let is_code = validate_editable_relative(relative)?;
    let limit = if is_code {
        MAX_CODE_BYTES
    } else {
        MAX_DOCUMENT_BYTES
    };
    if content.len() as u64 > limit {
        return Err(NativeError::SizeLimit("文档超过大小限制").into());
    }
    if is_code && content.as_bytes().contains(&0) {
        return Err(NativeError::InvalidEncoding("纯文本内容不能包含空字节").into());
    }
    let outcome = transport
        .write_atomic_checked(root, relative, content.as_bytes(), Some(expected_hash))
        .await
        .map_err(|e| e.to_string())?;
    match outcome {
        RemoteWriteCheckOutcome::Missing => Ok(WriteResult::Missing),
        RemoteWriteCheckOutcome::Conflict {
            current_bytes,
            current_hash,
            modified_ms,
        } => {
            let disk_content = String::from_utf8(current_bytes)
                .map_err(|_| NativeError::InvalidEncoding("远端文件已不再是有效 UTF-8 文本"))?;
            Ok(WriteResult::Conflict {
                snapshot: Snapshot::new(disk_content, current_hash, modified_ms),
            })
        }
        RemoteWriteCheckOutcome::Saved { modified_ms } => Ok(WriteResult::Saved {
            snapshot: Snapshot::new(content.into(), hash(content.as_bytes()), modified_ms),
        }),
    }
}

pub async fn remote_create_document(
    transport: &dyn RemoteTransport,
    root: &str,
    workspace_id: &str,
    relative: &str,
    content: &str,
) -> Result<(), String> {
    assert_workspace_identity(transport, root, workspace_id).await?;
    let is_code = validate_editable_relative(relative)?;
    let limit = if is_code {
        MAX_CODE_BYTES
    } else {
        MAX_DOCUMENT_BYTES
    };
    if content.len() as u64 > limit {
        return Err(NativeError::SizeLimit("文档超过大小限制").into());
    }
    if is_workspace_data_path(relative) {
        let _ = ensure_remote_parent_dirs(transport, root, relative).await?;
    } else {
        let _ = ensure_no_symlink_chain(transport, root, relative).await?;
    }
    transport
        .write_atomic_checked(root, relative, content.as_bytes(), None)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn remote_reserve_reference_id(
    transport: &dyn RemoteTransport,
    root: &str,
    workspace_id: &str,
    cache: &Path,
    occupied: &[String],
) -> Result<String, String> {
    assert_workspace_identity(transport, root, workspace_id).await?;
    let remote_manifest = read_manifest(transport, root, workspace_id).await?;
    let (allocated, next_manifest) = {
        let mut connection = database(cache)?;
        let tx = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        if let Some(m) = &remote_manifest {
            hydrate_manifest_tx(&tx, m, workspace_id)?;
        }
        for id in occupied {
            if is_short_id(id) {
                claim_reference_id(&tx, workspace_id, id)?;
            }
        }
        let allocated = allocate_reference_id(&tx, workspace_id)?;
        let next = build_manifest_from_tx(&tx, workspace_id, remote_manifest.as_ref())?;
        tx.commit().map_err(|e| e.to_string())?;
        (allocated, next)
    };
    publish_manifest_if_changed(
        transport,
        root,
        workspace_id,
        remote_manifest.as_ref(),
        &next_manifest,
    )
    .await?;
    Ok(allocated)
}

pub async fn remote_create_agent_record(
    transport: &dyn RemoteTransport,
    root: &str,
    workspace_id: &str,
    cache: &Path,
    relative: &str,
    content: &str,
) -> Result<(), String> {
    let object: serde_json::Value = serde_json::from_str(content).map_err(|_| "对象 JSON 无效")?;
    let id = object
        .get("id")
        .and_then(serde_json::Value::as_str)
        .ok_or("对象身份缺失")?;
    if !is_short_id(id)
        || !(relative == format!(".tano/objects/{id}.tano.json")
            || (!relative.starts_with('.') && relative.ends_with(".table.json")))
    {
        return Err(NativeError::InvalidPath("对象路径无效").into());
    }
    assert_workspace_identity(transport, root, workspace_id).await?;
    let target = ensure_remote_parent_dirs(transport, root, relative).await?;
    if transport
        .lstat(&target)
        .await
        .map_err(|e| e.to_string())?
        .is_some()
    {
        return Err(NativeError::AlreadyExists("对象路径已存在").into());
    }
    let remote_manifest = read_manifest(transport, root, workspace_id).await?;
    let next_manifest = {
        let mut connection = database(cache)?;
        let tx = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        if let Some(m) = &remote_manifest {
            hydrate_manifest_tx(&tx, m, workspace_id)?;
        }
        if !claim_reference_id(&tx, workspace_id, id)? {
            return Err("对象 ID 已被使用或预留，请重新生成建议".into());
        }
        let next = build_manifest_from_tx(&tx, workspace_id, remote_manifest.as_ref())?;
        tx.commit().map_err(|e| e.to_string())?;
        next
    };
    publish_manifest_if_changed(
        transport,
        root,
        workspace_id,
        remote_manifest.as_ref(),
        &next_manifest,
    )
    .await?;
    transport
        .write_atomic_checked(root, relative, content.as_bytes(), None)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn remote_create_folder(
    transport: &dyn RemoteTransport,
    root: &str,
    workspace_id: &str,
    relative: &str,
) -> Result<(), String> {
    assert_workspace_identity(transport, root, workspace_id).await?;
    storage::validate_relative_path(relative, false)?;
    let target = ensure_no_symlink_chain(transport, root, relative).await?;
    transport.mkdir(&target).await.map_err(|e| e.to_string())
}

pub async fn remote_remove_empty_folder(
    transport: &dyn RemoteTransport,
    root: &str,
    workspace_id: &str,
    relative: &str,
) -> Result<(), String> {
    assert_workspace_identity(transport, root, workspace_id).await?;
    storage::validate_relative_path(relative, false)?;
    let target = ensure_no_symlink_chain(transport, root, relative).await?;
    let stat = transport
        .lstat(&target)
        .await
        .map_err(|e| e.to_string())?
        .ok_or(NativeError::NotFound("文件夹已不存在"))?;
    if stat.is_symlink {
        return Err(NativeError::SymlinkEscape("不能转换符号链接文件夹").into());
    }
    if !stat.is_dir {
        return Err(NativeError::InvalidPath("只能移除空文件夹").into());
    }
    transport.rmdir(&target).await.map_err(|e| e.to_string())
}

fn update_moved_paths_in_db(
    cache: &Path,
    workspace_id: &str,
    from: &str,
    to: &str,
    is_dir: bool,
) -> Result<(), String> {
    let mut conn = database(cache)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    if !is_dir {
        tx.execute(
            "UPDATE files SET path=?3 WHERE workspace_id=?1 AND path=?2",
            params![workspace_id, from, to],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "UPDATE scan_fingerprints SET path=?3 WHERE workspace_id=?1 AND path=?2",
            params![workspace_id, from, to],
        )
        .ok();
    } else {
        let prefix = format!("{from}/");
        let rows: Vec<String> = {
            let mut stmt = tx
                .prepare("SELECT path FROM files WHERE workspace_id=?1 AND path LIKE ?2")
                .map_err(|e| e.to_string())?;
            let mapped = stmt
                .query_map(params![workspace_id, format!("{prefix}%")], |r| {
                    r.get::<_, String>(0)
                })
                .map_err(|e| e.to_string())?;
            mapped
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        for old_path in rows {
            if let Some(rest) = old_path.strip_prefix(&prefix) {
                let new_path = format!("{to}/{rest}");
                tx.execute(
                    "UPDATE files SET path=?3 WHERE workspace_id=?1 AND path=?2",
                    params![workspace_id, old_path, new_path],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn remote_move_entry(
    transport: &dyn RemoteTransport,
    root: &str,
    workspace_id: &str,
    cache: &Path,
    from: &str,
    to: &str,
) -> Result<(), String> {
    assert_workspace_identity(transport, root, workspace_id).await?;
    storage::validate_relative_path(from, false)?;
    storage::validate_relative_path(to, false)?;
    if from == to || to.starts_with(&format!("{from}/")) {
        return Err("不能将文件夹移动到自身或子文件夹".into());
    }
    let src = ensure_no_symlink_chain(transport, root, from).await?;
    let dst = ensure_no_symlink_chain(transport, root, to).await?;
    let stat = transport
        .lstat(&src)
        .await
        .map_err(|e| e.to_string())?
        .ok_or(NativeError::NotFound("文件或文件夹已不存在"))?;
    transport
        .rename_noclobber(&src, &dst)
        .await
        .map_err(|e| e.to_string())?;
    let _ = update_moved_paths_in_db(cache, workspace_id, from, to, stat.is_dir);
    Ok(())
}

pub async fn remote_duplicate_entry(
    transport: &dyn RemoteTransport,
    root: &str,
    workspace_id: &str,
    relative: &str,
) -> Result<String, String> {
    assert_workspace_identity(transport, root, workspace_id).await?;
    storage::validate_relative_path(relative, false)?;
    let src = ensure_no_symlink_chain(transport, root, relative).await?;
    let stat = transport
        .lstat(&src)
        .await
        .map_err(|e| e.to_string())?
        .ok_or(NativeError::NotFound("文件已不存在"))?;
    if stat.is_dir {
        return Err("SSH 远程工作区暂仅支持复制单个文件".into());
    }
    let (bytes, _) = transport
        .read_bytes(&src, MAX_ASSET_BYTES)
        .await
        .map_err(|e| e.to_string())?;
    let (parent, name) = match relative.rsplit_once('/') {
        Some((p, n)) => (Some(p), n),
        None => (None, relative),
    };
    let (stem, ext) = if let Some(s) = name.strip_suffix(".table.json") {
        (s, ".table.json")
    } else if let Some((s, _e)) = name.rsplit_once('.') {
        (s, &name[s.len()..])
    } else {
        (name, "")
    };
    for index in 1..=200 {
        let suffix = if index == 1 {
            " 副本".to_owned()
        } else {
            format!(" 副本 {index}")
        };
        let candidate_name = format!("{stem}{suffix}{ext}");
        let candidate_rel = match parent {
            Some(p) => format!("{p}/{candidate_name}"),
            None => candidate_name,
        };
        let candidate_abs = ensure_no_symlink_chain(transport, root, &candidate_rel).await?;
        if transport
            .lstat(&candidate_abs)
            .await
            .map_err(|e| e.to_string())?
            .is_none()
        {
            transport
                .write_atomic_checked(root, &candidate_rel, &bytes, None)
                .await
                .map_err(|e| e.to_string())?;
            return Ok(candidate_rel);
        }
    }
    Err("无法生成可用的副本文件名".into())
}

pub async fn remote_remove_entry(
    transport: &dyn RemoteTransport,
    root: &str,
    workspace_id: &str,
    relative: &str,
    trash_mode: RemoteTrashMode,
) -> Result<(), String> {
    assert_workspace_identity(transport, root, workspace_id).await?;
    let data_path = is_workspace_data_path(relative);
    storage::validate_relative_path(relative, data_path)?;
    let target = ensure_no_symlink_chain(transport, root, relative).await?;
    let stat = transport
        .lstat(&target)
        .await
        .map_err(|e| e.to_string())?
        .ok_or(NativeError::NotFound("文件或文件夹已不存在"))?;

    if trash_mode == RemoteTrashMode::RemoteTrash {
        if let Ok(home) = transport.home_dir().await {
            let trash_dir = format!("{home}/.tano/trash/{workspace_id}");
            if transport.mkdir_all(&trash_dir).await.is_ok() {
                let ts = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                let base = relative.rsplit('/').next().unwrap_or("entry");
                let dest = format!(
                    "{trash_dir}/{ts}-{}-{}",
                    &uuid::Uuid::new_v4().simple().to_string()[..6],
                    base
                );
                if transport.rename_noclobber(&target, &dest).await.is_ok() {
                    return Ok(());
                }
            }
        }
    }

    if stat.is_dir {
        transport
            .remove_dir_recursive(&target)
            .await
            .map_err(|e| e.to_string())
    } else {
        transport
            .remove_file(&target)
            .await
            .map_err(|e| e.to_string())
    }
}

pub async fn remote_change_assistant_file(
    transport: &dyn RemoteTransport,
    root: &str,
    workspace_id: &str,
    cache: &Path,
    request: &FileChangeRequest,
    trash_mode: RemoteTrashMode,
    object_delete: bool,
) -> Result<WriteResult, String> {
    if request.workspace_id != workspace_id {
        return Err("工作区已切换".into());
    }
    assert_workspace_identity(transport, root, workspace_id).await?;
    if object_delete {
        let name = request.path.strip_prefix(".tano/objects/");
        if request.destination.is_some()
            || !name.is_some_and(|n| !n.contains('/') && n.ends_with(".tano.json"))
        {
            return Err("对象删除路径无效".into());
        }
    } else {
        storage::validate_relative_path(&request.path, false)?;
        let p = Path::new(&request.path);
        if !(is_markdown(p) || storage::is_data_table(p)) {
            return Err("只能操作普通 Markdown 文档或数据表".into());
        }
    }

    // Verify stable file identity from local cache (synced with remote manifest).
    let expected_id: Option<String> = {
        let conn = database(cache)?;
        conn.query_row(
            "SELECT id FROM files WHERE workspace_id=?1 AND path=?2 AND deleted=0",
            params![workspace_id, request.path],
            |row| row.get(0),
        )
        .ok()
    };
    if expected_id.as_deref() != Some(request.file_id.as_str()) {
        return Err("文件身份已变化，请重新审阅".into());
    }

    let snapshot = match remote_read_document(transport, root, workspace_id, &request.path).await {
        Ok(s) => s,
        Err(_) => return Ok(WriteResult::Missing),
    };
    if snapshot.hash != request.expected_hash {
        return Ok(WriteResult::Conflict { snapshot });
    }

    if let Some(dest) = &request.destination {
        storage::validate_relative_path(dest, false)?;
        let src_p = Path::new(&request.path);
        let dst_p = Path::new(dest);
        if !(is_markdown(dst_p) || storage::is_data_table(dst_p))
            || storage::is_data_table(src_p) != storage::is_data_table(dst_p)
            || dest == &request.path
        {
            return Err("目标文档路径无效".into());
        }
        remote_move_entry(transport, root, workspace_id, cache, &request.path, dest).await?;
    } else {
        remote_remove_entry(transport, root, workspace_id, &request.path, trash_mode).await?;
    }
    Ok(WriteResult::Saved { snapshot })
}

pub async fn remote_import_attachment(
    transport: &dyn RemoteTransport,
    root: &str,
    workspace_id: &str,
    name: &str,
    bytes: &[u8],
    require_image: bool,
) -> Result<assets::ImportedAsset, String> {
    assert_workspace_identity(transport, root, workspace_id).await?;
    if bytes.len() as u64 > MAX_ASSET_BYTES {
        return Err("附件不能超过 50 MiB".into());
    }
    let image = assets::image_type(bytes);
    if require_image && image.is_none() {
        return Err("图片支持 PNG、JPEG、GIF 和 WebP；SVG 等格式请作为附件导入".into());
    }
    let basename = name.rsplit(['/', '\\']).next().unwrap_or("attachment");
    let (stem, extension) = basename.rsplit_once('.').unwrap_or((basename, ""));
    let stem: String = stem
        .chars()
        .filter(|c| !c.is_control() && !"<>:\"/\\|?*.".contains(*c))
        .take(40)
        .collect::<String>()
        .trim()
        .into();
    let extension = image.map(|(_, ext)| ext.to_owned()).unwrap_or_else(|| {
        extension
            .chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .take(12)
            .collect()
    });
    let assets_dir = ensure_no_symlink_chain(transport, root, "assets").await?;
    match transport
        .lstat(&assets_dir)
        .await
        .map_err(|e| e.to_string())?
    {
        Some(stat) if stat.is_dir && !stat.is_symlink => {}
        Some(_) => return Err("assets 已存在且不是文件夹".into()),
        None => transport
            .mkdir(&assets_dir)
            .await
            .map_err(|e| e.to_string())?,
    }
    let filename = format!(
        "{}-{}{}",
        if stem.is_empty() { "attachment" } else { &stem },
        uuid::Uuid::new_v4(),
        if extension.is_empty() {
            String::new()
        } else {
            format!(".{extension}")
        }
    );
    let relative = format!("assets/{filename}");
    transport
        .write_atomic_checked(root, &relative, bytes, None)
        .await
        .map_err(|e| e.to_string())?;
    Ok(assets::ImportedAsset::new(
        relative,
        basename.into(),
        image.is_some(),
    ))
}

pub async fn remote_read_attachment(
    transport: &dyn RemoteTransport,
    root: &str,
    workspace_id: &str,
    relative: &str,
) -> Result<Vec<u8>, String> {
    assert_workspace_identity(transport, root, workspace_id).await?;
    storage::validate_relative_path(relative, false)?;
    let full = ensure_no_symlink_chain(transport, root, relative).await?;
    let (bytes, _) = transport
        .read_bytes(&full, MAX_ASSET_BYTES)
        .await
        .map_err(|e| e.to_string())?;
    Ok(bytes)
}

pub async fn remote_write_spreadsheet(
    transport: &dyn RemoteTransport,
    root: &str,
    workspace_id: &str,
    relative: &str,
    bytes: &[u8],
    expected_hash: &str,
    local_backups: &Path,
) -> Result<String, String> {
    assert_workspace_identity(transport, root, workspace_id).await?;
    storage::validate_relative_path(relative, false)?;
    let ext = Path::new(relative)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !matches!(ext.as_str(), "xls" | "xlsx") || bytes.len() as u64 > MAX_ASSET_BYTES {
        return Err("仅支持保存 50 MiB 以内的 Excel 工作簿".into());
    }
    if !(ext == "xlsx" && bytes.starts_with(b"PK\x03\x04")
        || ext == "xls" && bytes.starts_with(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"))
    {
        return Err("工作簿内容与扩展名不符".into());
    }
    let original = remote_read_attachment(transport, root, workspace_id, relative).await?;
    if hash(&original) != expected_hash {
        return Err("远端工作簿已被外部修改，本地草稿已保留；请重新打开后处理冲突".into());
    }
    std::fs::create_dir_all(local_backups).map_err(|e| e.to_string())?;
    let backup = local_backups.join(format!("{}.{}", uuid::Uuid::new_v4(), ext));
    storage::create_atomic(&backup, &original)?;

    match transport
        .write_atomic_checked(root, relative, bytes, Some(expected_hash))
        .await
        .map_err(|e| e.to_string())?
    {
        RemoteWriteCheckOutcome::Saved { .. } => Ok(backup.to_string_lossy().into_owned()),
        RemoteWriteCheckOutcome::Conflict { .. } => {
            Err("远端工作簿已被外部修改，本地草稿与原文件备份已保留".into())
        }
        RemoteWriteCheckOutcome::Missing => Err("远端工作簿已被移除，本地备份已保留".into()),
    }
}

pub async fn remote_respond_asset(
    transport: &dyn RemoteTransport,
    root: &str,
    workspace_id: &str,
    cache: &Mutex<AssetCache>,
    request: &Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let result = async {
        if request.method() != "GET" {
            return Err(StatusCode::METHOD_NOT_ALLOWED);
        }
        let decoded =
            percent_encoding::percent_decode_str(request.uri().path().trim_start_matches('/'))
                .decode_utf8()
                .map_err(|_| StatusCode::BAD_REQUEST)?;
        let (id, path) = decoded.split_once('/').ok_or(StatusCode::BAD_REQUEST)?;
        if id != workspace_id {
            return Err(StatusCode::NOT_FOUND);
        }
        if storage::validate_relative_path(path, false).is_err() {
            return Err(StatusCode::NOT_FOUND);
        }
        let cache_key = format!(
            "{workspace_id}:{path}:{}",
            request.uri().query().unwrap_or("")
        );
        let bytes = if let Some(hit) = cache.lock().ok().and_then(|mut c| c.get(&cache_key)) {
            hit
        } else {
            let full = ensure_no_symlink_chain(transport, root, path)
                .await
                .map_err(|_| StatusCode::NOT_FOUND)?;
            let (data, _) = transport
                .read_bytes(&full, MAX_ASSET_BYTES)
                .await
                .map_err(|_| StatusCode::NOT_FOUND)?;
            if let Ok(mut guard) = cache.lock() {
                guard.insert(cache_key, data.clone());
            }
            data
        };
        let (mime, _) = assets::image_type(&bytes).ok_or(StatusCode::UNSUPPORTED_MEDIA_TYPE)?;
        Ok((mime, bytes))
    }
    .await;

    let (status, mime, bytes) = match result {
        Ok((mime, bytes)) => (StatusCode::OK, mime, bytes),
        Err(status) => (status, "text/plain", b"Image unavailable".to_vec()),
    };
    let mut response = Response::builder()
        .status(status)
        .header("Content-Type", mime)
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .header("Content-Security-Policy", "default-src 'none'; sandbox")
        .body(bytes)
        .expect("static response headers");
    if let Some(origin) = request.headers().get("Origin") {
        if origin
            .to_str()
            .ok()
            .and_then(|value| tauri::Url::parse(value).ok())
            .is_some_and(|url| {
                matches!(url.scheme(), "http" | "https" | "tauri")
                    && matches!(
                        url.host_str(),
                        Some("localhost" | "127.0.0.1" | "tauri.localhost")
                    )
            })
        {
            response
                .headers_mut()
                .insert("Access-Control-Allow-Origin", origin.clone());
            response
                .headers_mut()
                .insert("Vary", "Origin".parse().unwrap());
        }
    }
    response
}
