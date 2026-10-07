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
        None if expected.is_some() => Err("工作区 .tano 已丢失，已停止打开，未改动现有文件".into()),
        None => storage::workspace_identity(root),
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
    fn known_workspace_loss_never_generates_a_new_identity() {
        let data = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(root.path()).unwrap();
        let cache = data.path().join("index.sqlite");
        let id = identity_for_open(data.path(), &root, None, &cache).unwrap();
        register_identity(data.path(), &root, &id).unwrap();
        fs::remove_dir_all(root.join(".tano")).unwrap();
        assert!(identity_for_open(data.path(), &root, None, &cache)
            .unwrap_err()
            .contains("已丢失"));
        assert!(!root.join(".tano").exists());
        fs::create_dir(root.join(".tano")).unwrap();
        assert!(identity_for_open(data.path(), &root, None, &cache).is_err());
        assert!(!root.join(".tano/config.json").exists());
    }
    #[test]
    fn recent_index_also_protects_unregistered_existing_workspaces() {
        let data = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(root.path()).unwrap();
        let old = uuid::Uuid::new_v4().to_string();
        assert!(identity_for_open(
            data.path(),
            &root,
            Some(&old),
            &data.path().join("index.sqlite")
        )
        .is_err());
        assert!(!root.join(".tano").exists());
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
