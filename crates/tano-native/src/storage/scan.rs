use super::{
    display_path, hash,
    identity::{allocate_reference_id, claim_reference_id, database, is_short_id},
    is_markdown, modified,
    path_guard::{ignored_workspace_name, is_workspace_data_directory, is_workspace_data_path},
    scan_cache, Entry, Workspace, MAX_DOCUMENT_BYTES, MAX_WORKSPACE_ENTRIES,
};
use rusqlite::params;
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Read,
    path::Path,
};

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

pub(super) fn walk(
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
    let paths: Vec<&str> = entries
        .iter()
        .filter(|entry| entry.kind != "directory")
        .map(|entry| entry.path.as_str())
        .collect();
    let states = scan_cache::states(root, &paths)?;
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
            transaction
                .prepare_cached(
                    "INSERT INTO scan_fingerprints VALUES(?1,?2,?3,?4)
                ON CONFLICT(workspace_id,path) DO UPDATE SET hash=excluded.hash,stamp=excluded.stamp",
                )
                .map_err(|e| e.to_string())?
                .execute(params![id, entry.path, digest, stamp])
                .map_err(|e| e.to_string())?;
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
    super::object_cache::prune(&transaction, id)?;
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
        #[cfg(desktop)]
        remote: None,
    })
}
