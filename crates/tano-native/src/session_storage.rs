use crate::storage;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentWorkspace {
    pub(crate) id: String,
    name: String,
    pub(crate) path: String,
    opened_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    icon: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSession {
    version: u32,
    active_id: String,
    documents: Vec<SessionDocument>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    data_tables: Vec<SessionTableDraft>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    tabs: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    layout: Option<serde_json::Value>,
}
#[derive(Serialize, Deserialize)]
pub struct SessionDocument {
    id: String,
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    draft: Option<Draft>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTableDraft {
    id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    file_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    content: String,
    base: DraftBase,
}
#[derive(Serialize, Deserialize)]
pub struct Draft {
    content: String,
    base: DraftBase,
}
#[derive(Serialize, Deserialize)]
pub struct DraftBase {
    content: String,
    hash: String,
    modified: u64,
}
#[derive(Serialize, Deserialize)]
struct Envelope {
    payload: String,
    sha256: String,
}

fn connection(cache: &Path) -> Result<rusqlite::Connection, String> {
    let db = storage::database(cache)?;
    db.execute_batch("CREATE TABLE IF NOT EXISTS recent_workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, opened_at INTEGER NOT NULL);").map_err(|e| e.to_string())?;
    Ok(db)
}
pub fn record(cache: &Path, workspace: &storage::Workspace) -> Result<(), String> {
    let db = connection(cache)?;
    let time = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as u64;
    db.execute("INSERT INTO recent_workspaces VALUES (?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET name=excluded.name,path=excluded.path,opened_at=excluded.opened_at", params![workspace.id,workspace.name,workspace.path,time]).map_err(|e| e.to_string())?;
    Ok(())
}
/// Forget the app registration and menu entry, retaining all content, indexes and recovery drafts.
pub fn unregister(
    cache: &Path,
    app_data: &Path,
    root: &Path,
    workspace_id: &str,
) -> Result<(), String> {
    let mut db = connection(cache)?;
    let transaction = db
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    transaction
        .execute(
            "DELETE FROM recent_workspaces WHERE id = ?1 AND path = ?2",
            params![workspace_id, storage::display_path(root)],
        )
        .map_err(|e| e.to_string())?;
    crate::workspace_identity::unregister_identity(app_data, root, workspace_id)?;
    transaction.commit().map_err(|e| e.to_string())
}
pub fn recent(cache: &Path) -> Result<Vec<RecentWorkspace>, String> {
    let db = connection(cache)?;
    let mut statement = db
        .prepare("SELECT id,name,path,opened_at FROM recent_workspaces ORDER BY opened_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(RecentWorkspace {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                opened_at: row.get(3)?,
                icon: None,
            })
        })
        .map_err(|e| e.to_string())?;
    let rows: Vec<RecentWorkspace> = rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?;
    drop(statement);
    let mut valid = Vec::new();
    for mut workspace in rows {
        match fs::metadata(&workspace.path) {
            Ok(metadata) if metadata.is_dir() => {
                workspace.icon = recent_icon(Path::new(&workspace.path));
                valid.push(workspace);
            }
            Ok(_) => {
                db.execute(
                    "DELETE FROM recent_workspaces WHERE id = ?1 AND path = ?2",
                    params![workspace.id, workspace.path],
                )
                .map_err(|e| e.to_string())?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                db.execute(
                    "DELETE FROM recent_workspaces WHERE id = ?1 AND path = ?2",
                    params![workspace.id, workspace.path],
                )
                .map_err(|e| e.to_string())?;
            }
            Err(_) => valid.push(workspace),
        }
    }
    Ok(valid)
}

// Read presentation from the portable settings, without opening or mutating the workspace.
fn recent_icon(root: &Path) -> Option<String> {
    let root = fs::canonicalize(root).ok()?;
    let path = storage::resolve_storage(&root, ".tano/settings.tano.json", true).ok()?;
    let mut content = String::new();
    fs::File::open(path)
        .ok()?
        .take(262_145)
        .read_to_string(&mut content)
        .ok()?;
    if content.len() > 262_144 {
        return None;
    }
    let settings: serde_json::Value = serde_json::from_str(&content).ok()?;
    if settings.get("version")?.as_u64()? != 1 {
        return None;
    }
    let icon = settings.get("icon")?.as_str()?;
    let valid = if let Some(base64) = icon.strip_prefix("data:image/png;base64,") {
        let data = base64.trim_end_matches('=');
        icon.len() <= 200_000
            && !data.is_empty()
            && base64.len() - data.len() <= 2
            && data
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'+' || byte == b'/')
    } else {
        !icon.starts_with("data:")
            && icon.chars().count() <= 16
            && !icon.chars().any(|character| character <= '\u{1f}')
    };
    valid.then(|| icon.to_owned())
}
pub fn known_identity(cache: &Path, root: &Path) -> Result<Option<String>, String> {
    let db = connection(cache)?;
    let mut statement = db
        .prepare("SELECT id,path FROM recent_workspaces")
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (id, path) = row.map_err(|e| e.to_string())?;
        if fs::canonicalize(path).ok().as_deref() == Some(root) {
            return Ok(Some(id));
        }
    }
    Ok(None)
}
fn path(app_data: &Path, workspace_id: &str) -> Result<PathBuf, String> {
    uuid::Uuid::parse_str(workspace_id).map_err(|_| "无效的工作空间身份")?;
    let directory = app_data.join("sessions");
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    Ok(directory.join(format!("{workspace_id}.json")))
}
fn plugin_tab(id: &str) -> bool {
    let Some((plugin, view)) = id.strip_prefix("plugin:").and_then(|id| id.split_once(':')) else {
        return false;
    };
    let key = |value: &str, max: usize, dots: bool| {
        !value.is_empty()
            && value.len() <= max
            && value.as_bytes()[0].is_ascii_lowercase()
            && value.bytes().all(|byte| {
                byte.is_ascii_lowercase()
                    || byte.is_ascii_digit()
                    || byte == b'-'
                    || (dots && byte == b'.')
            })
    };
    key(plugin, 40, false) && key(view, 80, true)
}
fn validate(session: &WorkspaceSession) -> Result<(), String> {
    if session.version != 1
        || session.documents.len() > 200
        || session.data_tables.len() > 200
        || session.tabs.len() > 200
        || session.active_id.len()
            > if plugin_tab(&session.active_id) {
                128
            } else {
                100
            }
    {
        return Err("会话格式不支持或标签数量超过 200".into());
    }
    let mut ids = std::collections::HashSet::new();
    for doc in &session.documents {
        if doc.id.is_empty()
            || doc.id.len() > 100
            || !ids.insert(&doc.id)
            || doc.path.len() > 900
            || doc.path.contains('\\')
            || doc.path.contains(':')
            || doc
                .path
                .split('/')
                .any(|part| part.is_empty() || part.starts_with('.'))
        {
            return Err("会话中的文档身份或路径无效".into());
        }
        if let Some(draft) = &doc.draft {
            if draft.content.len() > 8 * 1024 * 1024
                || draft.base.content.len() > 8 * 1024 * 1024
                || storage::hash(draft.base.content.as_bytes()) != draft.base.hash
            {
                return Err("崩溃恢复草稿未通过基线校验或超过 8 MB".into());
            }
        }
    }
    let mut tab_ids = std::collections::HashSet::new();
    let mut table_ids = std::collections::HashSet::new();
    for table in &session.data_tables {
        if table.id.len() != 6
            || !table
                .id
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
            || table.file_id.as_ref().is_some_and(|id| {
                id.len() != 6
                    || !id
                        .bytes()
                        .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
            })
            || table.path.as_ref().is_some_and(|path| {
                storage::validate_relative_path(path, storage::is_workspace_data_path(path))
                    .is_err()
            })
            || !table_ids.insert(table.file_id.as_ref().unwrap_or(&table.id))
            || table.content.len() > 8 * 1024 * 1024
            || table.base.content.len() > 8 * 1024 * 1024
            || storage::hash(table.base.content.as_bytes()) != table.base.hash
        {
            return Err("数据表恢复草稿身份或基线无效".into());
        }
    }
    if session.tabs.iter().any(|id| {
        id.is_empty()
            || id.len() > if plugin_tab(id) { 128 } else { 100 }
            || !tab_ids.insert(id)
            || (!id.starts_with("blank:")
                && id != "view:graph"
                && id != "view:plugins"
                && id != "view:calendar"
                && id != "tables"
                && !id.strip_prefix("table:").is_some_and(|table_id| {
                    table_id.len() == 6
                        && table_id
                            .bytes()
                            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
                })
                && !plugin_tab(id)
                && !id.strip_prefix("attachment:").is_some_and(|file_id| {
                    !file_id.is_empty()
                        && file_id.bytes().all(|byte| {
                            byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_'
                        })
                })
                && !ids.contains(id))
    }) {
        return Err("会话中的标签页身份无效".into());
    }
    Ok(())
}
pub fn load(app_data: &Path, workspace_id: &str) -> Result<Option<WorkspaceSession>, String> {
    let path = path(app_data, workspace_id)?;
    if !path.exists() {
        return Ok(None);
    }
    if fs::metadata(&path).map_err(|e| e.to_string())?.len() > 128 * 1024 * 1024 {
        return Err("会话恢复文件超过限制，原文件已保留".into());
    }
    let envelope: Envelope = serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
        .map_err(|_| "会话恢复文件损坏，原文件已保留")?;
    if storage::hash(envelope.payload.as_bytes()) != envelope.sha256 {
        return Err("会话恢复文件校验失败，原文件已保留".into());
    }
    let session: WorkspaceSession =
        serde_json::from_str(&envelope.payload).map_err(|_| "会话格式无效，原文件已保留")?;
    validate(&session)?;
    Ok(Some(session))
}
pub fn save(app_data: &Path, workspace_id: &str, session: &WorkspaceSession) -> Result<(), String> {
    validate(session)?;
    let path = path(app_data, workspace_id)?;
    // Do not silently replace a corrupt recovery record.
    if path.exists() {
        load(app_data, workspace_id)?;
    }
    let payload = serde_json::to_string(session).map_err(|e| e.to_string())?;
    if payload.len() > 64 * 1024 * 1024 {
        return Err("恢复草稿合计超过 64 MB，请先保存部分文档".into());
    }
    let envelope = Envelope {
        sha256: storage::hash(payload.as_bytes()),
        payload,
    };
    let bytes = serde_json::to_vec(&envelope).map_err(|e| e.to_string())?;
    storage::temporary(&path, &bytes)?
        .persist(&path)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unregister_retains_workspace_content_identity_cache_and_recovery_drafts() {
        let data = tempfile::tempdir().unwrap();
        let cache = data.path().join("index.sqlite");
        let workspace = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(workspace.path()).unwrap();
        fs::write(root.join("note.md"), "# 用户内容\n").unwrap();
        fs::write(root.join("attachment.bin"), [0, 1, 2, 255]).unwrap();
        let id = storage::workspace_identity(&root).unwrap();
        let before = storage::scan(&root, &id, &cache).unwrap();
        fs::write(
            root.join(".tano/settings.tano.json"),
            r#"{"version":1,"name":"本地工作区"}"#,
        )
        .unwrap();
        record(&cache, &before).unwrap();
        crate::workspace_identity::register_identity(data.path(), &root, &id).unwrap();
        let draft = session();
        save(data.path(), &id, &draft).unwrap();
        let saved_draft = fs::read(path(data.path(), &id).unwrap()).unwrap();
        let preserved: Vec<_> = [
            "note.md",
            "attachment.bin",
            ".tano/config.json",
            ".tano/identities.json",
            ".tano/settings.tano.json",
        ]
        .into_iter()
        .map(|name| (name, fs::read(root.join(name)).unwrap()))
        .collect();

        let other = tempfile::tempdir().unwrap();
        let other_root = fs::canonicalize(other.path()).unwrap();
        let other_id = storage::workspace_identity(&other_root).unwrap();
        let other_workspace = storage::scan(&other_root, &other_id, &cache).unwrap();
        record(&cache, &other_workspace).unwrap();
        crate::workspace_identity::register_identity(data.path(), &other_root, &other_id).unwrap();

        unregister(&cache, data.path(), &root, &id).unwrap();
        assert_eq!(
            recent(&cache)
                .unwrap()
                .iter()
                .map(|entry| &entry.id)
                .collect::<Vec<_>>(),
            vec![&other_id]
        );
        assert_eq!(
            crate::workspace_identity::registered_identity(data.path(), &root).unwrap(),
            None
        );
        assert_eq!(known_identity(&cache, &root).unwrap(), None);
        for (name, bytes) in &preserved {
            assert_eq!(fs::read(root.join(name)).unwrap(), *bytes, "{name}");
        }
        assert_eq!(
            fs::read(path(data.path(), &id).unwrap()).unwrap(),
            saved_draft
        );
        assert!(load(data.path(), &id).unwrap().is_some());
        assert!(storage::cached_identity_exists(&cache, &id).unwrap());

        let reopened_id =
            crate::workspace_identity::identity_for_open(data.path(), &root, None, &cache).unwrap();
        assert_eq!(reopened_id, id);
        let after = storage::scan(&root, &id, &cache).unwrap();
        for file in &before.files {
            assert!(after
                .files
                .iter()
                .any(|next| next.path == file.path && next.id == file.id));
        }
        record(&cache, &after).unwrap();
        crate::workspace_identity::register_identity(data.path(), &root, &id).unwrap();
        assert!(recent(&cache).unwrap().iter().any(|entry| entry.id == id));
    }

    #[test]
    fn unregister_rolls_back_the_menu_entry_when_registration_identity_has_changed() {
        let data = tempfile::tempdir().unwrap();
        let cache = data.path().join("index.sqlite");
        let workspace = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(workspace.path()).unwrap();
        let id = storage::workspace_identity(&root).unwrap();
        record(&cache, &storage::scan(&root, &id, &cache).unwrap()).unwrap();
        let changed_id = uuid::Uuid::new_v4().to_string();
        crate::workspace_identity::register_identity(data.path(), &root, &changed_id).unwrap();
        assert!(unregister(&cache, data.path(), &root, &id).is_err());
        assert_eq!(recent(&cache).unwrap()[0].id, id);
        assert_eq!(
            crate::workspace_identity::registered_identity(data.path(), &root).unwrap(),
            Some(changed_id)
        );
    }
    #[test]
    fn recent_reads_current_icons_without_rewriting_settings() {
        let data = tempfile::tempdir().unwrap();
        let cache = data.path().join("index.sqlite");
        let root = data.path().join("workspace");
        fs::create_dir_all(root.join(".tano")).unwrap();
        connection(&cache)
            .unwrap()
            .execute(
                "INSERT INTO recent_workspaces VALUES ('workspace', 'Workspace', ?1, 1)",
                [root.to_string_lossy().to_string()],
            )
            .unwrap();
        let settings = root.join(".tano/settings.tano.json");
        for icon in ["🌿", "data:image/png;base64,aGVsbG8=", ""] {
            let content = serde_json::json!({"version": 1, "icon": icon}).to_string();
            fs::write(&settings, &content).unwrap();
            assert_eq!(recent(&cache).unwrap()[0].icon.as_deref(), Some(icon));
            assert_eq!(fs::read_to_string(&settings).unwrap(), content);
        }
        fs::write(&settings, "invalid settings").unwrap();
        assert!(recent(&cache).unwrap()[0].icon.is_none());
        assert_eq!(fs::read_to_string(&settings).unwrap(), "invalid settings");
    }
    #[test]
    #[cfg(unix)]
    fn recent_icons_do_not_follow_workspace_data_symlinks() {
        let data = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(
            outside.path().join("settings.tano.json"),
            r#"{"version":1,"icon":"🌿"}"#,
        )
        .unwrap();
        std::os::unix::fs::symlink(outside.path(), data.path().join(".tano")).unwrap();
        assert!(recent_icon(data.path()).is_none());
    }
    #[test]
    fn recent_removes_missing_and_moved_workspaces_from_history() {
        let data = tempfile::tempdir().unwrap();
        let cache = data.path().join("index.sqlite");
        let existing = data.path().join("existing");
        let moved = data.path().join("moved");
        let new_location = data.path().join("new-location");
        let deleted = data.path().join("deleted");
        fs::create_dir(&existing).unwrap();
        fs::create_dir(&moved).unwrap();
        fs::create_dir(&deleted).unwrap();
        let db = connection(&cache).unwrap();
        for (id, path, opened_at) in [
            ("existing", &existing, 1),
            ("moved", &moved, 2),
            ("deleted", &deleted, 3),
        ] {
            db.execute(
                "INSERT INTO recent_workspaces VALUES (?1, ?2, ?3, ?4)",
                params![id, id, path.to_string_lossy(), opened_at],
            )
            .unwrap();
        }
        fs::rename(&moved, &new_location).unwrap();
        fs::remove_dir(&deleted).unwrap();

        let history = recent(&cache).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].id, "existing");
        let count: i64 = db
            .query_row("SELECT COUNT(*) FROM recent_workspaces", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn recent_returns_all_existing_workspaces_and_prunes_missing_rows() {
        let data = tempfile::tempdir().unwrap();
        let cache = data.path().join("index.sqlite");
        let db = connection(&cache).unwrap();
        for index in 0..13 {
            let path = data.path().join(format!("workspace-{index}"));
            fs::create_dir(&path).unwrap();
            db.execute(
                "INSERT INTO recent_workspaces VALUES (?1, ?2, ?3, ?4)",
                params![
                    format!("id-{index}"),
                    "workspace",
                    path.to_string_lossy(),
                    index
                ],
            )
            .unwrap();
        }
        db.execute(
            "INSERT INTO recent_workspaces VALUES ('missing', 'missing', ?1, 99)",
            [data.path().join("missing").to_string_lossy().to_string()],
        )
        .unwrap();

        let history = recent(&cache).unwrap();
        assert_eq!(history.len(), 13);
        assert_eq!(history[0].id, "id-12");
        assert_eq!(history[12].id, "id-0");
        let count: i64 = db
            .query_row("SELECT COUNT(*) FROM recent_workspaces", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 13);
    }

    fn session() -> WorkspaceSession {
        WorkspaceSession {
            version: 1,
            active_id: "file-id".into(),
            documents: vec![SessionDocument {
                id: "file-id".into(),
                path: "note.md".into(),
                draft: Some(Draft {
                    content: "unsaved human edit".into(),
                    base: DraftBase {
                        content: "base".into(),
                        hash: storage::hash(b"base"),
                        modified: 0,
                    },
                }),
            }],
            data_tables: vec![],
            tabs: vec!["file-id".into(), "blank:test".into()],
            layout: None,
        }
    }
    #[test]
    fn persists_draft_outside_workspace_and_preserves_corrupt_record() {
        let data = tempfile::tempdir().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        save(data.path(), &id, &session()).unwrap();
        assert_eq!(
            load(data.path(), &id).unwrap().unwrap().tabs,
            ["file-id", "blank:test"]
        );
        assert_eq!(
            load(data.path(), &id).unwrap().unwrap().documents[0]
                .draft
                .as_ref()
                .unwrap()
                .content,
            "unsaved human edit"
        );
        let record = path(data.path(), &id).unwrap();
        fs::write(&record, b"corrupted bytes").unwrap();
        assert!(load(data.path(), &id).is_err());
        assert!(save(data.path(), &id, &session()).is_err());
        assert_eq!(fs::read(&record).unwrap(), b"corrupted bytes");
    }
    #[test]
    fn restores_nested_layout_in_application_session() {
        let data = tempfile::tempdir().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let mut saved = session();
        saved.layout = Some(serde_json::json!({
            "kind": "split", "id": "split", "axis": "horizontal", "ratio": 0.6,
            "first": { "kind": "pane", "id": "left", "tabs": ["file-id"], "activeId": "file-id" },
            "second": { "kind": "pane", "id": "right", "tabs": ["blank:test"], "activeId": "blank:test" }
        }));
        save(data.path(), &id, &saved).unwrap();
        let restored = load(data.path(), &id).unwrap().unwrap();
        assert_eq!(restored.layout, saved.layout);
        assert_eq!(
            restored.documents[0].draft.as_ref().unwrap().content,
            "unsaved human edit"
        );
        let old = serde_json::to_value(session()).unwrap();
        assert!(old.get("layout").is_none());
        assert!(serde_json::from_value::<WorkspaceSession>(old)
            .unwrap()
            .layout
            .is_none());
    }
    #[test]
    fn restores_graph_tab_without_a_fake_document() {
        let data = tempfile::tempdir().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let mut saved = session();
        saved.tabs.push("view:graph".into());
        saved.active_id = "view:graph".into();
        save(data.path(), &id, &saved).unwrap();
        let restored = load(data.path(), &id).unwrap().unwrap();
        assert_eq!(restored.active_id, "view:graph");
        assert_eq!(restored.tabs, ["file-id", "blank:test", "view:graph"]);
        assert_eq!(restored.documents.len(), 1);
        saved.tabs.push("view:unknown".into());
        assert!(validate(&saved).is_err());
    }
    #[test]
    fn restores_attachment_tab_without_a_document_draft() {
        let data = tempfile::tempdir().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let mut saved = session();
        saved.tabs.push("attachment:a12345".into());
        saved.active_id = "attachment:a12345".into();
        save(data.path(), &id, &saved).unwrap();
        let restored = load(data.path(), &id).unwrap().unwrap();
        assert_eq!(restored.active_id, "attachment:a12345");
        assert_eq!(restored.documents.len(), 1);
        saved.tabs.push("attachment:".into());
        assert!(validate(&saved).is_err());
    }
    #[test]
    fn restores_table_tabs_and_validated_table_drafts() {
        let data = tempfile::tempdir().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let mut saved = session();
        saved.tabs.extend(["tables".into(), "table:a12345".into()]);
        saved.active_id = "table:a12345".into();
        let content = r#"{"version":1,"id":"a12345","rows":[]}"#;
        saved.data_tables.push(SessionTableDraft {
            id: "a12345".into(),
            file_id: Some("b12345".into()),
            path: Some("研究/候选.table.json".into()),
            content: "unsaved table draft".into(),
            base: DraftBase {
                content: content.into(),
                hash: storage::hash(content.as_bytes()),
                modified: 1,
            },
        });
        save(data.path(), &id, &saved).unwrap();
        let restored = load(data.path(), &id).unwrap().unwrap();
        assert_eq!(restored.active_id, "table:a12345");
        assert_eq!(restored.data_tables[0].content, "unsaved table draft");
        assert_eq!(restored.data_tables[0].file_id.as_deref(), Some("b12345"));
        assert_eq!(
            restored.data_tables[0].path.as_deref(),
            Some("研究/候选.table.json")
        );
        saved.data_tables[0].base.hash = "stale".into();
        assert!(validate(&saved).is_err());
        saved.data_tables.clear();
        saved.tabs.push("table:../secret".into());
        assert!(validate(&saved).is_err());
    }

    #[test]
    fn restores_plugin_tabs_without_losing_document_recovery() {
        let data = tempfile::tempdir().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let mut saved = session();
        let long = format!("plugin:{}:{}", "a".repeat(40), "b".repeat(80));
        saved.tabs.extend([
            "view:plugins".into(),
            "view:calendar".into(),
            "plugin:git-inspector:changes".into(),
            long.clone(),
        ]);
        saved.active_id = long.clone();
        save(data.path(), &id, &saved).unwrap();
        let restored = load(data.path(), &id).unwrap().unwrap();
        assert_eq!(restored.tabs, saved.tabs);
        assert_eq!(restored.active_id, saved.active_id);
        assert_eq!(
            restored.documents[0].draft.as_ref().unwrap().content,
            "unsaved human edit"
        );
        for invalid in [
            "plugin:git:../secret",
            "plugin:git:",
            "plugin:git:extra:part",
            "plugin:Git:changes",
            "plugin:git:1bad",
        ] {
            assert!(!plugin_tab(invalid));
            saved.tabs.push(invalid.into());
            assert!(validate(&saved).is_err());
            saved.tabs.pop();
        }
        assert!(!plugin_tab(&format!("{long}x")));
    }
    #[test]
    fn rejects_invalid_base_before_replacing_recovery_file() {
        let data = tempfile::tempdir().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        save(data.path(), &id, &session()).unwrap();
        let mut invalid = session();
        invalid.documents[0].draft.as_mut().unwrap().base.hash = "incorrect".into();
        assert!(save(data.path(), &id, &invalid).is_err());
        assert_eq!(
            load(data.path(), &id).unwrap().unwrap().documents[0]
                .draft
                .as_ref()
                .unwrap()
                .base
                .hash,
            storage::hash(b"base")
        );
    }
}
