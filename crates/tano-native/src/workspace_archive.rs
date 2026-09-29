use crate::{identity_manifest, storage};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_ENTRIES: usize = 200_000;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveFile {
    path: String,
    size: u64,
    sha256: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveManifest {
    format: u32,
    workspace_id: String,
    workspace_name: String,
    created_at: u64,
    directories: Vec<String>,
    files: Vec<ArchiveFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveResult {
    pub path: String,
    pub workspace_id: String,
    pub file_count: usize,
    pub bytes: u64,
}

fn now() -> Result<u64, String> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as u64)
}

fn relative_path(value: &str) -> Result<PathBuf, String> {
    if value.is_empty()
        || value.len() > 900
        || value.contains(['\\', ':'])
        || value
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err("归档包含无效路径".into());
    }
    let path = PathBuf::from(value);
    if path
        .components()
        .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("归档路径不能离开工作区".into());
    }
    Ok(path)
}

fn ensure_plain(path: &Path, root: &Path, directory: bool) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink()
        || metadata.is_dir() != directory
        || (!directory && !metadata.is_file())
    {
        return Err(format!("归档包含符号链接或特殊文件：{}", path.display()));
    }
    if !fs::canonicalize(path)
        .map_err(|e| e.to_string())?
        .starts_with(root)
    {
        return Err(format!("归档路径离开了工作区：{}", path.display()));
    }
    Ok(())
}

fn transfer(source: &Path, destination: Option<&Path>) -> Result<(u64, String), String> {
    let mut input = fs::File::open(source).map_err(|e| e.to_string())?;
    let mut output = match destination {
        Some(path) => Some(
            fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path)
                .map_err(|e| e.to_string())?,
        ),
        None => None,
    };
    let mut size = 0_u64;
    let mut hash = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = input.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        size = size.checked_add(count as u64).ok_or("归档文件过大")?;
        hash.update(&buffer[..count]);
        if let Some(output) = &mut output {
            output
                .write_all(&buffer[..count])
                .map_err(|e| e.to_string())?;
        }
    }
    if let Some(output) = output {
        output.sync_all().map_err(|e| e.to_string())?;
    }
    Ok((size, format!("{:x}", hash.finalize())))
}

fn walk(
    root: &Path,
    current: &Path,
    prefix: &str,
    destination: Option<&Path>,
    directories: &mut Vec<String>,
    files: &mut Vec<ArchiveFile>,
) -> Result<(), String> {
    ensure_plain(current, root, true)?;
    for item in fs::read_dir(current).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?;
        let name = item
            .file_name()
            .into_string()
            .map_err(|_| "归档遇到无法表示的文件名")?;
        let relative = if prefix.is_empty() {
            name
        } else {
            format!("{prefix}/{name}")
        };
        relative_path(&relative)?;
        if directories.len() + files.len() >= MAX_ENTRIES {
            return Err("归档文件数量超过上限".into());
        }
        let path = item.path();
        let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if metadata.is_dir() {
            ensure_plain(&path, root, true)?;
            if let Some(target) = destination {
                fs::create_dir(target.join(&relative)).map_err(|e| e.to_string())?;
            }
            directories.push(relative.clone());
            walk(root, &path, &relative, destination, directories, files)?;
        } else {
            ensure_plain(&path, root, false)?;
            let target = destination.map(|base| base.join(&relative));
            let (size, sha256) = transfer(&path, target.as_deref())?;
            files.push(ArchiveFile {
                path: relative,
                size,
                sha256,
            });
        }
    }
    Ok(())
}

fn inventory(
    root: &Path,
    destination: Option<&Path>,
) -> Result<(Vec<String>, Vec<ArchiveFile>), String> {
    let canonical = fs::canonicalize(root).map_err(|e| e.to_string())?;
    if canonical != root {
        return Err("工作区路径必须先规范化".into());
    }
    let mut directories = Vec::new();
    let mut files = Vec::new();
    walk(root, root, "", destination, &mut directories, &mut files)?;
    directories.sort();
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok((directories, files))
}

fn validate(manifest: &ArchiveManifest) -> Result<(), String> {
    uuid::Uuid::parse_str(&manifest.workspace_id).map_err(|_| "归档工作区身份无效")?;
    if manifest.format != 1
        || manifest.workspace_name.is_empty()
        || manifest.workspace_name.len() > 120
        || manifest.workspace_name.contains(['/', '\\', ':'])
        || manifest.workspace_name == "."
        || manifest.workspace_name == ".."
        || manifest.directories.len() + manifest.files.len() > MAX_ENTRIES
    {
        return Err("归档清单格式或名称无效".into());
    }
    let dirs = manifest.directories.iter().collect::<HashSet<_>>();
    let mut names = HashSet::new();
    for dir in &manifest.directories {
        relative_path(dir)?;
        if !names.insert(dir.to_lowercase())
            || dir
                .rsplit_once('/')
                .is_some_and(|(parent, _)| !dirs.contains(&parent.to_string()))
        {
            return Err("归档目录重复或父目录缺失".into());
        }
    }
    for file in &manifest.files {
        relative_path(&file.path)?;
        if !names.insert(file.path.to_lowercase())
            || file
                .path
                .rsplit_once('/')
                .is_some_and(|(parent, _)| !dirs.contains(&parent.to_string()))
            || file.sha256.len() != 64
            || !file.sha256.bytes().all(|c| c.is_ascii_hexdigit())
        {
            return Err("归档文件路径或校验值无效".into());
        }
    }
    manifest.files.iter().try_fold(0_u64, |sum, file| {
        sum.checked_add(file.size).ok_or("归档总大小无效")
    })?;
    if !dirs.contains(&".tano".to_string())
        || !manifest
            .files
            .iter()
            .any(|file| file.path == ".tano/config.json")
        || !manifest
            .files
            .iter()
            .any(|file| file.path == ".tano/identities.json")
    {
        return Err("归档缺少完整的 .tano 身份数据".into());
    }
    Ok(())
}

fn verify_workspace(root: &Path, manifest: &ArchiveManifest) -> Result<(), String> {
    let actual = inventory(root, None)?;
    if actual != (manifest.directories.clone(), manifest.files.clone()) {
        return Err("归档文件与校验清单不一致".into());
    }
    if storage::existing_workspace_identity(root)?.as_deref() != Some(&manifest.workspace_id) {
        return Err("归档中的工作区 UUID 不一致".into());
    }
    identity_manifest::validate_backup_bytes(
        &fs::read(root.join(".tano/identities.json")).map_err(|e| e.to_string())?,
        &manifest.workspace_id,
    )
}

fn load(source: &Path) -> Result<ArchiveManifest, String> {
    let file = source.join("manifest.json");
    let metadata = fs::symlink_metadata(&file).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 32 * 1024 * 1024
    {
        return Err("归档清单不是有效的普通文件".into());
    }
    let manifest: ArchiveManifest =
        serde_json::from_slice(&fs::read(file).map_err(|e| e.to_string())?)
            .map_err(|e| format!("归档清单损坏：{e}"))?;
    validate(&manifest)?;
    verify_workspace(&source.join("workspace"), &manifest)?;
    Ok(manifest)
}

fn result(path: &Path, manifest: &ArchiveManifest) -> ArchiveResult {
    ArchiveResult {
        path: storage::display_path(path),
        workspace_id: manifest.workspace_id.clone(),
        file_count: manifest.files.len(),
        bytes: manifest.files.iter().map(|file| file.size).sum(),
    }
}

pub fn export(
    root: &Path,
    workspace_id: &str,
    destination_parent: &Path,
) -> Result<ArchiveResult, String> {
    identity_manifest::require(root, workspace_id)?;
    let parent = fs::canonicalize(destination_parent).map_err(|e| e.to_string())?;
    if parent.starts_with(root) {
        return Err("导出位置必须在工作区之外".into());
    }
    let before = inventory(root, None)?;
    let stage = tempfile::Builder::new()
        .prefix(".tano-export-")
        .tempdir_in(&parent)
        .map_err(|e| e.to_string())?;
    let payload = stage.path().join("workspace");
    fs::create_dir(&payload).map_err(|e| e.to_string())?;
    let copied = inventory_copy(root, &payload)?;
    if copied != before || inventory(root, None)? != before {
        return Err("导出期间文件发生变化，请重试；未完成的归档已清除".into());
    }
    let name = root
        .file_name()
        .and_then(|part| part.to_str())
        .unwrap_or("workspace")
        .to_string();
    let manifest = ArchiveManifest {
        format: 1,
        workspace_id: workspace_id.into(),
        workspace_name: name,
        created_at: now()?,
        directories: copied.0,
        files: copied.1,
    };
    validate(&manifest)?;
    verify_workspace(&payload, &manifest)?;
    storage::create_atomic(
        &stage.path().join("manifest.json"),
        &serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?,
    )?;
    load(stage.path())?;
    let target = parent.join(format!(
        "tano-export-{}-{}",
        manifest.created_at,
        uuid::Uuid::new_v4()
    ));
    fs::rename(stage.path(), &target).map_err(|e| e.to_string())?;
    Ok(result(&target, &manifest))
}

fn inventory_copy(root: &Path, target: &Path) -> Result<(Vec<String>, Vec<ArchiveFile>), String> {
    inventory(root, Some(target))
}

pub fn import(source: &Path, destination_parent: &Path) -> Result<ArchiveResult, String> {
    let source = fs::canonicalize(source).map_err(|e| e.to_string())?;
    let parent = fs::canonicalize(destination_parent).map_err(|e| e.to_string())?;
    if parent.starts_with(&source) {
        return Err("导入位置不能位于归档之内".into());
    }
    let manifest = load(&source)?;
    let stage = tempfile::Builder::new()
        .prefix(".tano-import-")
        .tempdir_in(&parent)
        .map_err(|e| e.to_string())?;
    let copied = inventory_copy(&source.join("workspace"), stage.path())?;
    if copied != (manifest.directories.clone(), manifest.files.clone()) {
        return Err("导入期间归档文件发生变化，请重试".into());
    }
    verify_workspace(stage.path(), &manifest)?;
    load(&source)?;
    let target = parent.join(format!(
        "{}-imported-{}-{}",
        manifest.workspace_name,
        now()?,
        &uuid::Uuid::new_v4().simple().to_string()[..8]
    ));
    fs::rename(stage.path(), &target).map_err(|e| e.to_string())?;
    Ok(result(&target, &manifest))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn full_export_import_keeps_bytes_and_ids_without_original_index() {
        let source = tempfile::tempdir().unwrap();
        let destination = tempfile::tempdir().unwrap();
        let app_data = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(source.path()).unwrap();
        let id = storage::workspace_identity(&root).unwrap();
        fs::write(root.join("note.md"), "# [[person:a82f91]]").unwrap();
        fs::create_dir(root.join("assets")).unwrap();
        fs::write(root.join("assets/image.png"), [0_u8, 255, 12, 42]).unwrap();
        fs::create_dir(root.join(".tano/objects")).unwrap();
        fs::write(root.join(".tano/objects/a82f91.tano.json"), r#"{"version":1,"id":"a82f91","type":"person","name":"Alice","description":"","archived":false,"properties":{}}"#).unwrap();
        fs::create_dir(root.join(".git")).unwrap();
        fs::write(root.join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
        let index = app_data.path().join("index.sqlite");
        let initial = storage::scan(&root, &id, &index).unwrap();
        let document_id = initial
            .files
            .iter()
            .find(|file| file.path == "note.md")
            .unwrap()
            .id
            .clone();
        let relation = serde_json::json!({
            "version": 1,
            "relations": [{
                "id": "b82f91",
                "type": "related",
                "source": { "type": "person", "id": "a82f91" },
                "target": { "type": "document", "id": document_id },
            }],
        });
        let relation_bytes = serde_json::to_vec(&relation).unwrap();
        fs::write(
            root.join(".tano/relations.tano-relations.json"),
            &relation_bytes,
        )
        .unwrap();
        let before = storage::scan(&root, &id, &index).unwrap();
        let archive = export(&root, &id, destination.path()).unwrap();
        fs::remove_file(index).unwrap();
        let imported = import(Path::new(&archive.path), destination.path()).unwrap();
        let restored = storage::scan(
            Path::new(&imported.path),
            &id,
            &app_data.path().join("fresh.sqlite"),
        )
        .unwrap();
        assert_eq!(restored.id, before.id);
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
            fs::read(Path::new(&imported.path).join("assets/image.png")).unwrap(),
            [0, 255, 12, 42]
        );
        assert_eq!(
            fs::read(Path::new(&imported.path).join("note.md")).unwrap(),
            b"# [[person:a82f91]]"
        );
        assert_eq!(
            fs::read(Path::new(&imported.path).join(".tano/relations.tano-relations.json"))
                .unwrap(),
            relation_bytes
        );
        assert_eq!(
            relation["relations"][0]["target"]["id"].as_str(),
            restored
                .files
                .iter()
                .find(|file| file.path == "note.md")
                .map(|file| file.id.as_str())
        );
        assert_eq!(
            fs::read_to_string(Path::new(&imported.path).join(".git/HEAD")).unwrap(),
            "ref: refs/heads/main\n"
        );
        assert!(fs::read_to_string(
            Path::new(&imported.path).join(".tano/objects/a82f91.tano.json")
        )
        .unwrap()
        .contains("Alice"));
    }

    #[test]
    fn import_rejects_tampering_without_publishing_a_workspace() {
        let source = tempfile::tempdir().unwrap();
        let destination = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(source.path()).unwrap();
        let id = storage::workspace_identity(&root).unwrap();
        storage::scan(&root, &id, &destination.path().join("index.sqlite")).unwrap();
        let archive = export(&root, &id, destination.path()).unwrap();
        fs::write(
            Path::new(&archive.path).join("workspace/.tano/config.json"),
            "damaged",
        )
        .unwrap();
        assert!(import(Path::new(&archive.path), destination.path()).is_err());
        assert!(!fs::read_dir(destination.path())
            .unwrap()
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().contains("-imported-")));
    }
}
