use crate::{identity_manifest, storage};
use serde::Deserialize;
use std::path::Path;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileChangeRequest {
    pub workspace_id: String,
    pub file_id: String,
    pub path: String,
    pub expected_hash: String,
    pub destination: Option<String>,
}

pub fn change(
    root: &Path,
    workspace_id: &str,
    cache: &Path,
    request: &FileChangeRequest,
    recycle: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<storage::WriteResult, String> {
    if request.workspace_id != workspace_id {
        return Err("工作区已切换".into());
    }
    storage::assert_workspace_identity(root, workspace_id)?;
    let source = storage::resolve(root, &request.path, false)?;
    if !(storage::is_markdown(&source) || storage::is_data_table(&source)) {
        return Err("只能操作普通 Markdown 文档或数据表".into());
    }
    let workspace = storage::scan(root, workspace_id, cache)?;
    let Some(file) = workspace
        .files
        .iter()
        .find(|file| file.path == request.path)
    else {
        return Ok(storage::WriteResult::Missing);
    };
    if file.id != request.file_id || file.kind != "file" {
        return Err("文件身份已变化，请重新审阅".into());
    }
    let snapshot = storage::read(&source)?;
    if snapshot.hash != request.expected_hash {
        return Ok(storage::WriteResult::Conflict { snapshot });
    }
    if let Some(destination) = &request.destination {
        let target = storage::resolve(root, destination, false)?;
        if !(storage::is_markdown(&target) || storage::is_data_table(&target))
            || storage::is_data_table(&source) != storage::is_data_table(&target)
            || destination == &request.path
        {
            return Err("目标文档路径无效".into());
        }
        // rename uses a no-clobber filesystem operation and preserves the stable file ID.
        storage::rename(root, workspace_id, &request.path, destination, cache)?;
    } else {
        identity_manifest::begin_delete(root, workspace_id, cache, &request.path)?;
        // Preparing the identity journal performs I/O. Recheck before recycling.
        let latest = storage::read(&source)?;
        if latest.hash != request.expected_hash {
            identity_manifest::recover_mutation(root, workspace_id, cache)?;
            return Ok(storage::WriteResult::Conflict { snapshot: latest });
        }
        if let Err(error) = recycle(&source) {
            let _ = identity_manifest::recover_mutation(root, workspace_id, cache);
            return Err(error);
        }
        identity_manifest::recover_mutation(root, workspace_id, cache)?;
    }
    Ok(storage::WriteResult::Saved { snapshot })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn table_file_changes_keep_identity_and_refuse_stale_content_or_type_changes() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("workspace");
        fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let cache = temp.path().join("cache.sqlite");
        let id = storage::workspace_identity(&root).unwrap();
        fs::write(root.join("table.table.json"), "table bytes").unwrap();
        let workspace = storage::scan(&root, &id, &cache).unwrap();
        let file_id = workspace
            .files
            .iter()
            .find(|file| file.path == "table.table.json")
            .unwrap()
            .id
            .clone();
        let mut request = FileChangeRequest {
            workspace_id: id.clone(),
            file_id: file_id.clone(),
            path: "table.table.json".into(),
            expected_hash: storage::hash(b"table bytes"),
            destination: Some("wrong.md".into()),
        };
        assert!(change(&root, &id, &cache, &request, |_| panic!("must not delete")).is_err());
        request.destination = Some("renamed.table.json".into());
        fs::write(root.join("table.table.json"), "external").unwrap();
        assert!(matches!(
            change(&root, &id, &cache, &request, |_| panic!("must not delete")).unwrap(),
            storage::WriteResult::Conflict { .. }
        ));
        request.expected_hash = storage::hash(b"external");
        assert!(matches!(
            change(&root, &id, &cache, &request, |_| panic!("must not delete")).unwrap(),
            storage::WriteResult::Saved { .. }
        ));
        let moved = storage::scan(&root, &id, &cache).unwrap();
        assert_eq!(
            moved
                .files
                .iter()
                .find(|file| file.path == "renamed.table.json")
                .unwrap()
                .id,
            file_id
        );
        request.path = "renamed.table.json".into();
        request.destination = None;
        let recovered = temp.path().join("recycled.table.json");
        assert!(matches!(
            change(&root, &id, &cache, &request, |source| fs::rename(
                source, &recovered
            )
            .map_err(|e| e.to_string()))
            .unwrap(),
            storage::WriteResult::Saved { .. }
        ));
        assert_eq!(fs::read_to_string(recovered).unwrap(), "external");
    }

    #[test]
    fn reviewed_file_changes_preserve_identity_and_refuse_stale_or_occupied_targets() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("workspace");
        fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let cache = temp.path().join("cache.sqlite");
        let id = storage::workspace_identity(&root).unwrap();
        fs::write(root.join("note.md"), "before").unwrap();
        let workspace = storage::scan(&root, &id, &cache).unwrap();
        let file_id = workspace
            .files
            .iter()
            .find(|file| file.path == "note.md")
            .unwrap()
            .id
            .clone();
        let mut request = FileChangeRequest {
            workspace_id: id.clone(),
            file_id: file_id.clone(),
            path: "note.md".into(),
            expected_hash: storage::hash(b"before"),
            destination: Some("renamed.md".into()),
        };
        fs::write(root.join("note.md"), "external").unwrap();
        assert!(matches!(
            change(&root, &id, &cache, &request, |_| panic!("must not delete")).unwrap(),
            storage::WriteResult::Conflict { .. }
        ));
        request.expected_hash = storage::hash(b"external");
        fs::write(root.join("renamed.md"), "occupied").unwrap();
        assert!(change(&root, &id, &cache, &request, |_| panic!("must not delete")).is_err());
        assert_eq!(
            fs::read_to_string(root.join("renamed.md")).unwrap(),
            "occupied"
        );
        request.destination = Some("moved.md".into());
        assert!(matches!(
            change(&root, &id, &cache, &request, |_| panic!("must not delete")).unwrap(),
            storage::WriteResult::Saved { .. }
        ));
        let moved = storage::scan(&root, &id, &cache).unwrap();
        assert_eq!(
            moved
                .files
                .iter()
                .find(|file| file.path == "moved.md")
                .unwrap()
                .id,
            file_id
        );
        request.path = "moved.md".into();
        request.destination = None;
        request.file_id = "ffffff".into();
        assert!(change(&root, &id, &cache, &request, |_| panic!("must not delete")).is_err());
        request.file_id = file_id;
        let recovered = temp.path().join("recycled.md");
        assert!(matches!(
            change(&root, &id, &cache, &request, |source| fs::rename(
                source, &recovered
            )
            .map_err(|e| e.to_string()))
            .unwrap(),
            storage::WriteResult::Saved { .. }
        ));
        assert_eq!(fs::read_to_string(recovered).unwrap(), "external");
        assert!(!root.join("moved.md").exists());
    }
}
