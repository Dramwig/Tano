use crate::{identity_manifest, storage};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Serialize, Deserialize)]
struct Registration {
    root: String,
    workspace_id: String,
}

fn registration_path(app_data: &Path, root: &Path) -> Result<PathBuf, String> {
    let directory = app_data.join("workspace-registrations");
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let root = root.to_string_lossy();
    let key = if cfg!(windows) {
        root.to_lowercase()
    } else {
        root.into_owned()
    };
    Ok(directory.join(format!("{:x}.json", Sha256::digest(key.as_bytes()))))
}

pub fn registered_identity(app_data: &Path, root: &Path) -> Result<Option<String>, String> {
    let path = registration_path(app_data, root)?;
    if !path.exists() {
        return Ok(None);
    }
    let registration: Registration =
        serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
            .map_err(|e| format!("工作区身份登记损坏，原文件已保留：{e}"))?;
    if registration.root != root.to_string_lossy()
        || uuid::Uuid::parse_str(&registration.workspace_id).is_err()
    {
        return Err("工作区身份登记无效，原文件已保留".into());
    }
    Ok(Some(registration.workspace_id))
}

pub fn register_identity(app_data: &Path, root: &Path, workspace_id: &str) -> Result<(), String> {
    if let Some(existing) = registered_identity(app_data, root)? {
        if existing != workspace_id {
            return Err("工作区身份与本机登记不一致，已停止写入".into());
        }
        return Ok(());
    }
    let path = registration_path(app_data, root)?;
    let bytes = serde_json::to_vec(&Registration {
        root: root.to_string_lossy().into_owned(),
        workspace_id: workspace_id.into(),
    })
    .map_err(|e| e.to_string())?;
    storage::create_atomic(&path, &bytes)
}

/// Remove only this app's registration; the workspace's portable identity stays on disk.
pub fn unregister_identity(app_data: &Path, root: &Path, workspace_id: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(workspace_id).map_err(|_| "无效的工作空间身份")?;
    match registered_identity(app_data, root)? {
        Some(existing) if existing != workspace_id => {
            Err("工作区身份登记已变化，未删除其他工作区的注册".into())
        }
        Some(_) => fs::remove_file(registration_path(app_data, root)?).map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

pub fn identity_for_open(
    app_data: &Path,
    root: &Path,
    recent_id: Option<&str>,
    cache: &Path,
) -> Result<String, String> {
    let registered = registered_identity(app_data, root)?;
    let expected = registered.as_deref().or(recent_id);
    match storage::existing_workspace_identity(root)? {
        Some(id) => {
            if expected.is_some_and(|prior| prior != id) {
                return Err(
                    "工作区身份与本机登记不一致，已停止打开；请检查选定目录的 .tano 数据".into(),
                );
            }
            if registered.is_some() {
                identity_manifest::require(root, &id)?;
            } else if identity_manifest::read(root, &id)?.is_none()
                && !storage::cached_identity_exists(cache, &id)?
            {
                return Err("此文件夹已有 .tano/config.json，但缺少 .tano/identities.json，且本机没有可导出的旧 ID；为避免改变已有文件身份，已停止打开，请检查 .tano 数据".into());
            }
            Ok(id)
        }
        None => {
            let id = storage::workspace_identity(root)?;
            if let Some(previous) = expected {
                // Deleting all of .tano starts a new workspace. Keep old indexes
                // and drafts isolated under the old UUID, never import them.
                identity_manifest::publish_cache(root, &id, cache)?;
                crate::session_storage::unregister(cache, app_data, root, previous)?;
                register_identity(app_data, root, &id)?;
            }
            Ok(id)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn deleted_workspace_folder_is_never_recreated() {
        for registered in [false, true] {
            let data = tempfile::tempdir().unwrap();
            let parent = tempfile::tempdir().unwrap();
            let root = parent.path().join("workspace");
            fs::create_dir(&root).unwrap();
            let root = fs::canonicalize(root).unwrap();
            let cache = data.path().join("index.sqlite");
            let id = identity_for_open(data.path(), &root, None, &cache).unwrap();
            if registered {
                register_identity(data.path(), &root, &id).unwrap();
            }
            fs::remove_dir_all(&root).unwrap();

            assert!(identity_for_open(data.path(), &root, None, &cache).is_err());
            assert!(storage::workspace_identity(&root).is_err());
            assert!(!root.exists());
        }
    }

    #[test]
    fn registration_is_independent_of_index_and_never_replaces_another_identity() {
        let data = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(root.path()).unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        assert_eq!(registered_identity(data.path(), &root).unwrap(), None);
        register_identity(data.path(), &root, &id).unwrap();
        assert_eq!(
            registered_identity(data.path(), &root).unwrap(),
            Some(id.clone())
        );
        assert!(register_identity(data.path(), &root, &uuid::Uuid::new_v4().to_string()).is_err());
    }
    #[test]
    fn deleted_metadata_starts_a_new_workspace_and_preserves_existing_content() {
        for registered in [false, true] {
            let data = tempfile::tempdir().unwrap();
            let root = tempfile::tempdir().unwrap();
            let root = fs::canonicalize(root.path()).unwrap();
            let cache = data.path().join("index.sqlite");
            let old = identity_for_open(data.path(), &root, None, &cache).unwrap();
            fs::write(root.join("note.md"), "original").unwrap();
            fs::write(root.join("image.png"), [0, 1, 255, 128]).unwrap();
            fs::create_dir(root.join(".tano/objects")).unwrap();
            let object = ".tano/objects/a12345.tano.json";
            fs::write(root.join(object), r#"{"id":"a12345","type":"event"}"#).unwrap();
            let before = storage::scan(&root, &old, &cache).unwrap();
            crate::session_storage::record(&cache, &before).unwrap();
            if registered {
                register_identity(data.path(), &root, &old).unwrap();
            }
            // Leave a pending operation with the old identity: it must not run
            // against the new workspace or prevent it from opening.
            identity_manifest::begin_create(&root, &old, &cache, "pending.md", b"old").unwrap();
            fs::write(root.join("pending.md"), "external replacement").unwrap();
            fs::remove_dir_all(root.join(".tano")).unwrap();
            fs::write(root.join("note.md"), "external edit after deletion").unwrap();

            assert!(identity_manifest::require(&root, &old).is_err());
            assert!(!root.join(".tano").exists());
            let recent = (!registered).then_some(old.as_str());
            let new = identity_for_open(data.path(), &root, recent, &cache).unwrap();
            assert_ne!(new, old);
            assert_eq!(
                registered_identity(data.path(), &root).unwrap(),
                Some(new.clone())
            );
            let reopened = storage::scan(&root, &new, &cache).unwrap();
            crate::session_storage::record(&cache, &reopened).unwrap();
            let manifest = identity_manifest::read(&root, &new).unwrap().unwrap();
            assert_eq!(manifest.workspace_id, new);
            assert_eq!(manifest.files.len(), 3);
            assert!(!manifest.files.iter().any(|file| file.path == object));
            assert!(!manifest.reserved_ids.contains(&"a12345".to_string()));
            for file in &reopened.files {
                assert!(storage::is_short_id(&file.id));
            }
            assert_eq!(
                fs::read_to_string(root.join("note.md")).unwrap(),
                "external edit after deletion"
            );
            assert_eq!(
                fs::read_to_string(root.join("pending.md")).unwrap(),
                "external replacement"
            );
            assert_eq!(fs::read(root.join("image.png")).unwrap(), [0, 1, 255, 128]);
            assert!(!root.join(".tano/objects").exists());
            assert!(storage::cached_identity_exists(&cache, &old).unwrap());
            assert_eq!(
                crate::session_storage::known_identity(&cache, &root).unwrap(),
                Some(new.clone())
            );
            let recent = crate::session_storage::recent(&cache).unwrap();
            assert_eq!(recent.len(), 1);
            assert_eq!(recent[0].id, new);
            assert_eq!(
                identity_for_open(data.path(), &root, None, &cache).unwrap(),
                new
            );
            assert!(!root.join("index.sqlite").exists());
        }
    }

    #[test]
    fn deleted_metadata_starts_fresh_without_a_cached_index() {
        for registered in [false, true] {
            let data = tempfile::tempdir().unwrap();
            let root = tempfile::tempdir().unwrap();
            let root = fs::canonicalize(root.path()).unwrap();
            let old = uuid::Uuid::new_v4().to_string();
            if registered {
                register_identity(data.path(), &root, &old).unwrap();
            }
            fs::write(root.join("note.md"), "keep this content").unwrap();
            let cache = data.path().join("index.sqlite");
            let new = identity_for_open(data.path(), &root, Some(&old), &cache).unwrap();
            assert_ne!(new, old);
            let opened = storage::scan(&root, &new, &cache).unwrap();
            identity_manifest::require(&root, &new).unwrap();
            assert_eq!(opened.files.len(), 1);
            assert!(storage::is_short_id(&opened.files[0].id));
            assert_eq!(
                fs::read_to_string(root.join("note.md")).unwrap(),
                "keep this content"
            );
        }
    }
    #[test]
    fn partial_or_replaced_metadata_is_preserved() {
        let data = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(root.path()).unwrap();
        let cache = data.path().join("index.sqlite");
        let id = identity_for_open(data.path(), &root, None, &cache).unwrap();
        storage::scan(&root, &id, &cache).unwrap();
        register_identity(data.path(), &root, &id).unwrap();
        fs::remove_file(root.join(".tano/identities.json")).unwrap();
        assert!(identity_for_open(data.path(), &root, None, &cache).is_err());
        assert!(!root.join(".tano/identities.json").exists());
        fs::remove_file(root.join(".tano/config.json")).unwrap();
        assert!(identity_for_open(data.path(), &root, None, &cache).is_err());
        assert!(!root.join(".tano/config.json").exists());
        fs::write(root.join(".tano/config.json"), "broken JSON").unwrap();
        assert!(identity_for_open(data.path(), &root, None, &cache).is_err());
        assert_eq!(
            fs::read_to_string(root.join(".tano/config.json")).unwrap(),
            "broken JSON"
        );
        let replaced = serde_json::json!({"id": uuid::Uuid::new_v4().to_string()}).to_string();
        fs::write(root.join(".tano/config.json"), &replaced).unwrap();
        assert!(identity_for_open(data.path(), &root, None, &cache).is_err());
        assert_eq!(
            fs::read_to_string(root.join(".tano/config.json")).unwrap(),
            replaced
        );
    }

    #[cfg(unix)]
    #[test]
    fn rebuilding_does_not_follow_a_metadata_directory_symlink() {
        let data = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(root.path()).unwrap();
        register_identity(data.path(), &root, &uuid::Uuid::new_v4().to_string()).unwrap();
        std::os::unix::fs::symlink(outside.path(), root.join(".tano")).unwrap();
        assert!(
            identity_for_open(data.path(), &root, None, &data.path().join("index.sqlite")).is_err()
        );
        assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0);
    }

    #[test]
    fn legacy_workspace_needs_cached_ids_before_first_portable_manifest() {
        let data = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(root.path()).unwrap();
        let id = storage::workspace_identity(&root).unwrap();
        fs::write(root.join("note.md"), "legacy").unwrap();
        let cache = data.path().join("index.sqlite");
        assert!(identity_for_open(data.path(), &root, None, &cache)
            .unwrap_err()
            .contains("旧 ID"));
        assert!(!root.join(".tano/identities.json").exists());

        let connection = storage::database(&cache).unwrap();
        connection.execute("INSERT INTO files(workspace_id,path,id,hash,version,deleted,native_key) VALUES(?1,'note.md','a82f91',?2,1,0,'')",
            rusqlite::params![id, storage::hash(b"legacy")]).unwrap();
        connection
            .execute(
                "INSERT INTO reference_ids(workspace_id,id) VALUES(?1,'a82f91')",
                [&id],
            )
            .unwrap();
        drop(connection);
        assert_eq!(
            identity_for_open(data.path(), &root, None, &cache).unwrap(),
            id
        );
        let workspace = storage::scan(&root, &id, &cache).unwrap();
        assert_eq!(workspace.files[0].id, "a82f91");
        assert!(root.join(".tano/identities.json").exists());
    }
}
