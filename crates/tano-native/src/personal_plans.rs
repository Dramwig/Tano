//! An independent, file-backed personal space. Never changes the active workspace session.
use crate::{identity_manifest, storage, workspace_lock};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

static OPERATIONS: Mutex<()> = Mutex::new(());
const LOCK_ID: &str = "e0d2cb11-18b9-49b8-9a7b-06b095cf180e";

struct PersonalSpace {
    root: PathBuf,
    id: String,
    cache: PathBuf,
}
fn with_space<T>(
    data: &Path,
    run: impl FnOnce(&PersonalSpace) -> Result<T, String>,
) -> Result<T, String> {
    let _guard = OPERATIONS.lock().map_err(|e| e.to_string())?;
    let _lock = workspace_lock::acquire(&data.join("personal-locks"), LOCK_ID)?;
    let data = fs::canonicalize(data).map_err(|e| e.to_string())?;
    let root = storage::resolve(&data, "personal", false)?;
    if !root.exists() {
        fs::create_dir(&root).map_err(|e| e.to_string())?;
    }
    let root =
        fs::canonicalize(storage::resolve(&data, "personal", true)?).map_err(|e| e.to_string())?;
    let id = storage::workspace_identity(&root)?;
    run(&PersonalSpace {
        root,
        id,
        cache: data.join("personal-index.sqlite"),
    })
}
fn check_path(path: &str) -> Result<(), String> {
    let id = path
        .strip_prefix(".tano/objects/")
        .and_then(|name| name.strip_suffix(".tano.json"))
        .ok_or("无效的个人事项路径")?;
    if id.len() != 6
        || !id
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    {
        return Err("无效的个人事项 ID".into());
    }
    Ok(())
}
fn check_content(path: &str, content: &str) -> Result<(), String> {
    check_path(path)?;
    let value: serde_json::Value = serde_json::from_str(content).map_err(|e| e.to_string())?;
    let id = value["id"].as_str().ok_or("个人事项缺少 ID")?;
    if value["version"] != 1
        || value["type"] != "event"
        || path != format!(".tano/objects/{id}.tano.json")
        || !value["name"].is_string()
        || !value["description"].is_string()
        || !value["archived"].is_boolean()
        || !value["properties"].is_object()
    {
        return Err("个人计划仅支持有效的事件对象".into());
    }
    Ok(())
}
fn list(data: &Path) -> Result<storage::Workspace, String> {
    with_space(data, |space| {
        let mut result = storage::scan(&space.root, &space.id, &space.cache)?;
        result.name = "个人".into();
        Ok(result)
    })
}
fn read(data: &Path, path: &str) -> Result<storage::Snapshot, String> {
    check_path(path)?;
    with_space(data, |space| {
        storage::read(&storage::resolve_storage(&space.root, path, true)?)
    })
}
fn reserve(data: &Path, occupied: &[String]) -> Result<String, String> {
    with_space(data, |space| {
        identity_manifest::reserve(&space.root, &space.id, &space.cache, occupied)
    })
}
fn create(data: &Path, path: &str, content: &str) -> Result<(), String> {
    check_content(path, content)?;
    with_space(data, |space| {
        let target = storage::ensure_file_parent(&space.root, path)?;
        identity_manifest::begin_create(
            &space.root,
            &space.id,
            &space.cache,
            path,
            content.as_bytes(),
        )?;
        let result = storage::create(&target, content);
        identity_manifest::recover_mutation(&space.root, &space.id, &space.cache)?;
        result
    })
}
fn write(
    data: &Path,
    path: &str,
    content: &str,
    expected: &str,
) -> Result<storage::WriteResult, String> {
    check_content(path, content)?;
    with_space(data, |space| {
        storage::write(
            &storage::resolve_storage(&space.root, path, false)?,
            content,
            expected,
        )
    })
}

#[tauri::command]
pub fn personal_plans_list(app: tauri::AppHandle) -> Result<storage::Workspace, String> {
    list(&crate::app_data(&app)?)
}
#[tauri::command]
pub fn personal_plans_read(
    app: tauri::AppHandle,
    path: String,
) -> Result<storage::Snapshot, String> {
    read(&crate::app_data(&app)?, &path)
}
#[tauri::command]
pub fn personal_plans_reserve(
    app: tauri::AppHandle,
    occupied: Vec<String>,
) -> Result<String, String> {
    reserve(&crate::app_data(&app)?, &occupied)
}
#[tauri::command]
pub fn personal_plans_create(
    app: tauri::AppHandle,
    path: String,
    content: String,
) -> Result<(), String> {
    create(&crate::app_data(&app)?, &path, &content)
}
#[tauri::command]
pub fn personal_plans_write(
    app: tauri::AppHandle,
    path: String,
    content: String,
    expected_hash: String,
) -> Result<storage::WriteResult, String> {
    write(&crate::app_data(&app)?, &path, &content, &expected_hash)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn event(id: &str, name: &str) -> String {
        serde_json::json!({"version":1,"id":id,"type":"event","name":name,"description":"","archived":false,"properties":{"checkable":true}}).to_string()
    }
    #[test]
    fn persists_independently_and_rejects_stale_writes_and_path_escape() {
        let data = tempfile::tempdir().unwrap();
        let workspace = tempfile::tempdir().unwrap();
        let first = list(data.path()).unwrap();
        let id = reserve(data.path(), &[]).unwrap();
        let path = format!(".tano/objects/{id}.tano.json");
        create(data.path(), &path, &event(&id, "个人事项")).unwrap();
        let before = read(data.path(), &path).unwrap();
        fs::write(
            data.path().join("personal").join(&path),
            event(&id, "外部修改"),
        )
        .unwrap();
        assert!(matches!(
            write(data.path(), &path, &event(&id, "本次修改"), &before.hash).unwrap(),
            storage::WriteResult::Conflict { .. }
        ));
        assert_eq!(
            read(data.path(), &path).unwrap().content,
            event(&id, "外部修改")
        );
        let current = read(data.path(), &path).unwrap();
        assert!(matches!(
            write(data.path(), &path, &event(&id, "保存"), &current.hash).unwrap(),
            storage::WriteResult::Saved { .. }
        ));
        assert_eq!(list(data.path()).unwrap().id, first.id);
        assert!(list(data.path())
            .unwrap()
            .files
            .iter()
            .any(|entry| entry.path == path));
        assert!(!workspace.path().join(".tano").exists());
        assert!(create(data.path(), &path, &event(&id, "覆盖")).is_err());
        assert!(read(data.path(), "../outside").is_err());
        assert!(create(data.path(), ".tano/config.json", "{}").is_err());
        assert!(create(
            data.path(),
            ".tano/objects/000001.tano.json",
            &event(&id, "错位")
        )
        .is_err());
        fs::write(data.path().join("personal/.tano/config.json"), "broken").unwrap();
        assert!(list(data.path()).is_err());
        assert_eq!(
            fs::read_to_string(data.path().join("personal/.tano/config.json")).unwrap(),
            "broken"
        );
    }
    #[test]
    fn does_not_follow_an_objects_directory_symlink() {
        let data = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        list(data.path()).unwrap();
        let target = data.path().join("personal/.tano/objects");
        #[cfg(unix)]
        std::os::unix::fs::symlink(outside.path(), &target).unwrap();
        #[cfg(windows)]
        if std::os::windows::fs::symlink_dir(outside.path(), &target).is_err() {
            return;
        }
        assert!(create(
            data.path(),
            ".tano/objects/000001.tano.json",
            &event("000001", "外部")
        )
        .is_err());
        assert!(!outside.path().join("000001.tano.json").exists());
    }
}
