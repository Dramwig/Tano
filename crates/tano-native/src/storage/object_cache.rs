//! Device-local SQLite snapshot cache for workspace object files (`.tano/objects/*.tano.json`).
//!
//! Workspace files remain the sole source of truth. Cached snapshots are stored strictly in
//! application data and are reused only when path containment checks succeed and the OS file
//! fingerprint (`scan_cache::state`) matches exactly. Any external edit, race, or symlink
//! invalidates the cached entry and falls back to reading the file from disk.

use super::{
    identity::database,
    path_guard::resolve_storage,
    scan_cache::{self, FileState},
    Snapshot,
};
use rusqlite::{params, Connection};
use std::{collections::HashMap, path::Path};

const MAX_CACHED_OBJECT_BYTES: usize = 512 * 1024;

#[derive(Clone)]
struct CachedSnapshot {
    stamp: String,
    hash: String,
    modified: u64,
    content: String,
}

pub(crate) fn is_cacheable_object_path(path: &str) -> bool {
    path.starts_with(".tano/objects/") && path.ends_with(".tano.json")
}

fn ensure_table(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS object_snapshot_cache (
                workspace_id TEXT NOT NULL,
                path TEXT NOT NULL,
                stamp TEXT NOT NULL,
                hash TEXT NOT NULL,
                modified INTEGER NOT NULL,
                content TEXT NOT NULL,
                PRIMARY KEY (workspace_id, path)
            );",
        )
        .map_err(|e| e.to_string())
}

fn load_cached(cache: &Path, workspace_id: &str) -> HashMap<String, CachedSnapshot> {
    let Ok(connection) = database(cache) else {
        return HashMap::new();
    };
    if ensure_table(&connection).is_err() {
        return HashMap::new();
    }
    let Ok(mut statement) = connection.prepare(
        "SELECT path, stamp, hash, modified, content
         FROM object_snapshot_cache
         WHERE workspace_id = ?1",
    ) else {
        return HashMap::new();
    };
    let Ok(rows) = statement.query_map([workspace_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            CachedSnapshot {
                stamp: row.get(1)?,
                hash: row.get(2)?,
                modified: row.get::<_, i64>(3)?.max(0) as u64,
                content: row.get(4)?,
            },
        ))
    }) else {
        return HashMap::new();
    };
    let mut map = HashMap::new();
    for row in rows.flatten() {
        map.insert(row.0, row.1);
    }
    map
}

fn persist_updates(
    cache: &Path,
    workspace_id: &str,
    upserts: &[(String, String, String, u64, String)],
    removals: &[String],
) {
    if upserts.is_empty() && removals.is_empty() {
        return;
    }
    let Ok(mut connection) = database(cache) else {
        return;
    };
    if ensure_table(&connection).is_err() {
        return;
    }
    let Ok(transaction) =
        connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
    else {
        return;
    };
    if !upserts.is_empty() {
        if let Ok(mut statement) = transaction.prepare_cached(
            "INSERT INTO object_snapshot_cache (workspace_id, path, stamp, hash, modified, content)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(workspace_id, path) DO UPDATE SET
               stamp = excluded.stamp,
               hash = excluded.hash,
               modified = excluded.modified,
               content = excluded.content",
        ) {
            for (path, stamp, hash, modified, content) in upserts {
                let _ = statement.execute(params![
                    workspace_id,
                    path,
                    stamp,
                    hash,
                    *modified as i64,
                    content
                ]);
            }
        }
    }
    if !removals.is_empty() {
        if let Ok(mut statement) = transaction.prepare_cached(
            "DELETE FROM object_snapshot_cache WHERE workspace_id = ?1 AND path = ?2",
        ) {
            for path in removals {
                let _ = statement.execute(params![workspace_id, path]);
            }
        }
    }
    let _ = transaction.commit();
}

enum ReadOutcome {
    Hit(Snapshot),
    MissOk {
        snapshot: Snapshot,
        cache_entry: Option<(String, String, u64, String)>,
    },
    Err {
        error: String,
        evict: bool,
    },
}

fn read_one_with_cache(
    root: &Path,
    path: &str,
    cached: Option<&CachedSnapshot>,
    read_one: &(impl Fn(&str) -> Result<Snapshot, String> + Sync),
) -> ReadOutcome {
    let cacheable = is_cacheable_object_path(path);
    if !cacheable {
        return match read_one(path) {
            Ok(snapshot) => ReadOutcome::MissOk {
                snapshot,
                cache_entry: None,
            },
            Err(error) => ReadOutcome::Err {
                error,
                evict: false,
            },
        };
    }

    // Always enforce workspace path containment & symlink rejection before consulting cache.
    let target = match resolve_storage(root, path, true) {
        Ok(target) => target,
        Err(error) => {
            return ReadOutcome::Err {
                error,
                evict: cached.is_some(),
            };
        }
    };

    let before: FileState = scan_cache::state(&target);
    if let Some(entry) = cached {
        if !before.stamp.is_empty() && before.stamp == entry.stamp {
            return ReadOutcome::Hit(Snapshot::new(
                entry.content.clone(),
                entry.hash.clone(),
                entry.modified,
            ));
        }
    }

    match read_one(path) {
        Ok(snapshot) => {
            let after = scan_cache::state(&target);
            let cache_entry = if scan_cache::unchanged(&before, &after)
                && snapshot.content.len() <= MAX_CACHED_OBJECT_BYTES
            {
                Some((
                    before.stamp,
                    snapshot.hash.clone(),
                    snapshot.modified,
                    snapshot.content.clone(),
                ))
            } else {
                None
            };
            ReadOutcome::MissOk {
                snapshot,
                cache_entry,
            }
        }
        Err(error) => ReadOutcome::Err {
            error,
            evict: cached.is_some(),
        },
    }
}

/// Reads a batch of paths in parallel, reusing validated SQLite snapshots for `.tano/objects/*.tano.json`.
pub(crate) fn read_batch_cached(
    root: &Path,
    workspace_id: &str,
    cache: &Path,
    paths: &[String],
    read_one: &(impl Fn(&str) -> Result<Snapshot, String> + Sync),
) -> Result<HashMap<String, Result<Snapshot, String>>, String> {
    if paths.is_empty() {
        return Ok(HashMap::new());
    }
    let has_cacheable = paths.iter().any(|p| is_cacheable_object_path(p));
    let cached_map = if has_cacheable {
        load_cached(cache, workspace_id)
    } else {
        HashMap::new()
    };

    let workers = std::thread::available_parallelism()
        .map(usize::from)
        .unwrap_or(1)
        .min(8)
        .min(paths.len() / 64)
        .max(1);

    let process_chunk = |chunk: &[String]| {
        let mut results = Vec::with_capacity(chunk.len());
        for path in chunk {
            let outcome = read_one_with_cache(root, path, cached_map.get(path), read_one);
            results.push((path.clone(), outcome));
        }
        results
    };

    let outcomes = if workers == 1 {
        process_chunk(paths)
    } else {
        std::thread::scope(|scope| {
            let mut jobs = Vec::with_capacity(workers);
            let mut all = Vec::with_capacity(paths.len());
            for chunk in paths.chunks(paths.len().div_ceil(workers)) {
                match std::thread::Builder::new()
                    .name("tano-object-cache".into())
                    .spawn_scoped(scope, move || process_chunk(chunk))
                {
                    Ok(job) => jobs.push(job),
                    Err(_) => all.extend(process_chunk(chunk)),
                }
            }
            for job in jobs {
                all.extend(
                    job.join()
                        .map_err(|_| "批量读取对象缓存的后台任务失败".to_string())?,
                );
            }
            Ok::<_, String>(all)
        })?
    };

    let mut out = HashMap::with_capacity(paths.len());
    let mut upserts = Vec::new();
    let mut removals = Vec::new();
    for (path, outcome) in outcomes {
        match outcome {
            ReadOutcome::Hit(snapshot) => {
                out.insert(path, Ok(snapshot));
            }
            ReadOutcome::MissOk {
                snapshot,
                cache_entry,
            } => {
                if let Some((stamp, hash, modified, content)) = cache_entry {
                    upserts.push((path.clone(), stamp, hash, modified, content));
                }
                out.insert(path, Ok(snapshot));
            }
            ReadOutcome::Err { error, evict } => {
                if evict {
                    removals.push(path.clone());
                }
                out.insert(path, Err(error));
            }
        }
    }

    if has_cacheable {
        persist_updates(cache, workspace_id, &upserts, &removals);
    }
    Ok(out)
}

pub(super) fn prune(
    transaction: &rusqlite::Transaction<'_>,
    workspace_id: &str,
) -> Result<(), String> {
    let exists: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='object_snapshot_cache')",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !exists {
        return Ok(());
    }
    transaction
        .execute(
            "DELETE FROM object_snapshot_cache WHERE workspace_id=?1 AND NOT EXISTS (
                SELECT 1 FROM files f WHERE f.workspace_id=object_snapshot_cache.workspace_id
                AND f.path=object_snapshot_cache.path AND f.deleted=0)",
            [workspace_id],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage;
    use std::{
        fs,
        sync::atomic::{AtomicUsize, Ordering},
    };

    fn make_object(id: &str, name: &str) -> String {
        serde_json::json!({
            "version": 1,
            "id": id,
            "type": "event",
            "name": name,
            "description": "",
            "archived": false,
            "properties": { "checkable": true }
        })
        .to_string()
    }

    #[test]
    fn reuses_cached_snapshots_and_invalidates_on_external_edit_and_delete() {
        let dir = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        let cache_dir = tempfile::tempdir().unwrap();
        let cache = cache_dir.path().join("index.sqlite");
        let workspace_id = storage::workspace_identity(&root).unwrap();

        let p1 = ".tano/objects/a00001.tano.json".to_string();
        let p2 = ".tano/objects/a00002.tano.json".to_string();
        let target1 = storage::ensure_file_parent(&root, &p1).unwrap();
        let target2 = storage::ensure_file_parent(&root, &p2).unwrap();
        storage::create(&target1, &make_object("a00001", "一")).unwrap();
        storage::create(&target2, &make_object("a00002", "二")).unwrap();

        let paths = vec![p1.clone(), p2.clone()];
        let disk_reads = AtomicUsize::new(0);
        let read_one = |path: &str| {
            disk_reads.fetch_add(1, Ordering::SeqCst);
            let target = storage::resolve_storage(&root, path, true)?;
            storage::read(&target)
        };

        // Cold read: both objects read from disk and cached.
        let first = read_batch_cached(&root, &workspace_id, &cache, &paths, &read_one).unwrap();
        assert_eq!(disk_reads.load(Ordering::SeqCst), 2);
        let snap1 = first.get(&p1).unwrap().as_ref().unwrap();
        assert!(snap1.content.contains("一"));

        // Warm read: both objects served from SQLite cache with 0 disk reads.
        disk_reads.store(0, Ordering::SeqCst);
        let second = read_batch_cached(&root, &workspace_id, &cache, &paths, &read_one).unwrap();
        assert_eq!(disk_reads.load(Ordering::SeqCst), 0);
        assert_eq!(second.get(&p1).unwrap().as_ref().unwrap().hash, snap1.hash);
        assert_eq!(
            second.get(&p1).unwrap().as_ref().unwrap().content,
            snap1.content
        );

        // External edit to p1: only p1 misses cache and re-reads from disk.
        fs::write(&target1, make_object("a00001", "外部修改")).unwrap();
        disk_reads.store(0, Ordering::SeqCst);
        let third = read_batch_cached(&root, &workspace_id, &cache, &paths, &read_one).unwrap();
        assert_eq!(disk_reads.load(Ordering::SeqCst), 1);
        let updated1 = third.get(&p1).unwrap().as_ref().unwrap();
        assert!(updated1.content.contains("外部修改"));
        assert_ne!(updated1.hash, snap1.hash);

        // Delete p2: must return Err and never serve stale cached content.
        fs::remove_file(&target2).unwrap();
        disk_reads.store(0, Ordering::SeqCst);
        let fourth = read_batch_cached(&root, &workspace_id, &cache, &paths, &read_one).unwrap();
        assert_eq!(disk_reads.load(Ordering::SeqCst), 0);
        assert!(fourth.get(&p1).unwrap().is_ok());
        assert!(fourth.get(&p2).unwrap().is_err());
    }
}
