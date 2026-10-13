//! Real Markdown folders inside the app sandbox; metadata stays in sibling app data.
use crate::storage;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

fn directory(path: &Path) -> Result<PathBuf, String> {
    if fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err("手机空间不能是符号链接".into());
    }
    fs::create_dir_all(path).map_err(|e| e.to_string())?;
    fs::canonicalize(path).map_err(|e| e.to_string())
}
pub fn workspace_root(data: &Path) -> Result<PathBuf, String> {
    directory(&data.join("Workspaces"))
}
pub fn validate(data: &Path, path: &Path) -> Result<PathBuf, String> {
    let root = workspace_root(data)?;
    if fs::symlink_metadata(path)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("手机空间不能是符号链接".into());
    }
    let path = fs::canonicalize(path).map_err(|e| e.to_string())?;
    if path.parent() != Some(root.as_path()) || !path.is_dir() {
        return Err("手机端只能打开应用沙箱中的工作空间".into());
    }
    Ok(path)
}
pub fn create(data: &Path, name: &str) -> Result<PathBuf, String> {
    if name.trim() != name
        || name.is_empty()
        || name.chars().count() > 60
        || name.contains('/')
        || name.contains('\\')
    {
        return Err("请填写 1–60 字的工作空间名称，不含路径分隔符".into());
    }
    let root = workspace_root(data)?;
    let path = storage::resolve(&root, name, false)?;
    fs::create_dir(&path).map_err(|e| format!("无法创建手机空间（名称可能已存在）：{e}"))?;
    // Let open_workspace create identity and the first manifest together. A
    // pre-created config without a manifest is correctly treated as data loss.
    storage::create(&path.join("README.md"), "# 同一页，随身带走\n\n这是保存在这台设备中的 Markdown 工作空间。手机和平板离线也可以写作。\n\n当前本地版不提供网络同步。请通过导入和导出传递文档，并在卸载应用前备份工作空间。\n")?;
    Ok(path)
}
pub fn default_workspace(data: &Path) -> Result<PathBuf, String> {
    let path = workspace_root(data)?.join("我的空间");
    if path.exists() {
        validate(data, &path)
    } else {
        create(data, "我的空间")
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RecycledFile {
    pub id: String,
    pub workspace_id: String,
    pub path: String,
    pub deleted_at: u64,
}
fn recycle_root(data: &Path, workspace: &str) -> Result<PathBuf, String> {
    uuid::Uuid::parse_str(workspace).map_err(|_| "无效工作空间标识")?;
    directory(&directory(&data.join("recycle"))?.join(workspace))
}
// The desktop build keeps this module's unit tests available even though the
// command call site is compiled only for mobile targets.
#[cfg_attr(not(mobile), allow(dead_code))]
pub fn recycle(data: &Path, root: &Path, workspace: &str, path: &str) -> Result<(), String> {
    let source = storage::resolve(root, path, true)?;
    if !source.is_file() {
        return Err("只能移除单个文件".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let target = recycle_root(data, workspace)?.join(&id);
    fs::create_dir(&target).map_err(|e| e.to_string())?;
    let entry = RecycledFile {
        id,
        workspace_id: workspace.into(),
        path: path.into(),
        deleted_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_millis() as u64,
    };
    storage::create_atomic(
        &target.join("record.json"),
        &serde_json::to_vec(&entry).map_err(|e| e.to_string())?,
    )?;
    fs::rename(source, target.join("content")).map_err(|e| e.to_string())
}
pub fn recycled(data: &Path, workspace: &str) -> Result<Vec<RecycledFile>, String> {
    let mut records = Vec::new();
    for entry in fs::read_dir(recycle_root(data, workspace)?).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_type().map_err(|e| e.to_string())?.is_symlink() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if uuid::Uuid::parse_str(&name).is_err() {
            continue;
        }
        let path = entry.path();
        let record_path = storage::resolve(&path, "record.json", true)?;
        let content_path = storage::resolve(&path, "content", false)?;
        if !content_path.is_file() {
            continue;
        } // prepared move did not happen
        let record: RecycledFile =
            serde_json::from_slice(&fs::read(record_path).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        if record.id != name || record.workspace_id != workspace {
            return Err("回收记录标识不一致".into());
        }
        records.push(record);
    }
    records.sort_by_key(|r| std::cmp::Reverse(r.deleted_at));
    Ok(records)
}
pub fn recover(data: &Path, root: &Path, workspace: &str, id: &str) -> Result<String, String> {
    uuid::Uuid::parse_str(id).map_err(|_| "无效回收记录")?;
    let record = recycled(data, workspace)?
        .into_iter()
        .find(|r| r.id == id)
        .ok_or("回收记录不存在")?;
    let folder = storage::resolve(&recycle_root(data, workspace)?, id, true)?;
    let content = storage::resolve(&folder, "content", true)?;
    if fs::metadata(&content).map_err(|e| e.to_string())?.len() > 50 * 1024 * 1024 {
        return Err("文件超过 50 MiB".into());
    }
    let original = Path::new(&record.path);
    let stem = original
        .file_stem()
        .and_then(|n| n.to_str())
        .ok_or("回收文件名无效")?;
    let extension = original
        .extension()
        .and_then(|n| n.to_str())
        .map(|s| format!(".{s}"))
        .unwrap_or_default();
    let name = format!(
        "{}-recovered-{}{}",
        stem.chars().take(60).collect::<String>(),
        uuid::Uuid::new_v4(),
        extension
    );
    let target = storage::resolve(root, &name, false)?;
    storage::create_atomic(&target, &fs::read(content).map_err(|e| e.to_string())?)?;
    Ok(name) // Preserve the recycle record as well; no destructive cleanup.
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn new_mobile_workspace_uses_normal_identity_bootstrap_and_reopens() {
        let temporary = tempfile::tempdir().unwrap();
        let data = temporary.path();
        let root = create(data, "Mobile").unwrap();
        let cache = data.join("index.sqlite");
        assert!(storage::existing_workspace_identity(&root)
            .unwrap()
            .is_none());
        let id = crate::workspace_identity::identity_for_open(data, &root, None, &cache).unwrap();
        let opened = storage::scan(&root, &id, &cache).unwrap();
        crate::workspace_identity::register_identity(data, &root, &id).unwrap();
        crate::identity_manifest::require(&root, &id).unwrap();
        let reopened_id =
            crate::workspace_identity::identity_for_open(data, &root, None, &cache).unwrap();
        assert_eq!(id, reopened_id);
        let reopened = storage::scan(&root, &id, &cache).unwrap();
        assert_eq!(opened.files[0].id, reopened.files[0].id);
        assert!(!root.join("index.sqlite").exists());
        fs::remove_file(root.join(".tano/identities.json")).unwrap();
        assert!(crate::workspace_identity::identity_for_open(data, &root, None, &cache).is_err());
        assert_eq!(
            storage::existing_workspace_identity(&root).unwrap(),
            Some(id)
        );
    }
    #[test]
    fn sandbox_reopen_and_recycle_preserve_markdown_and_isolate_workspaces() {
        let temporary = tempfile::tempdir().unwrap();
        let data = temporary.path();
        let root = create(data, "Research").unwrap();
        let id = storage::workspace_identity(&root).unwrap();
        assert_eq!(
            validate(data, &root).unwrap(),
            fs::canonicalize(&root).unwrap()
        );
        assert_eq!(storage::workspace_identity(&root).unwrap(), id);
        assert!(create(data, "Research").is_err());
        assert!(create(data, "../outside").is_err());
        assert!(validate(data, data).is_err());
        fs::create_dir(root.join("notes")).unwrap();
        fs::write(root.join("notes/a.md"), b"# Offline\n").unwrap();
        recycle(data, &root, &id, "notes/a.md").unwrap();
        assert!(!root.join("notes/a.md").exists());
        let records = recycled(data, &id).unwrap();
        assert_eq!(records.len(), 1);
        assert!(recycled(data, &uuid::Uuid::new_v4().to_string())
            .unwrap()
            .is_empty());
        fs::remove_dir(root.join("notes")).unwrap();
        let copy = recover(data, &root, &id, &records[0].id).unwrap();
        assert_eq!(fs::read(root.join(copy)).unwrap(), b"# Offline\n");
        assert_eq!(recycled(data, &id).unwrap().len(), 1);
        assert!(!root.join("index.sqlite").exists());
    }
}
