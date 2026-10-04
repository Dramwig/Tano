use crate::storage;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::{
    fs,
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
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSession {
    version: u32,
    active_id: String,
    documents: Vec<SessionDocument>,
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
            })
        })
        .map_err(|e| e.to_string())?;
    let rows: Vec<RecentWorkspace> = rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?;
    drop(statement);
    let mut valid = Vec::new();
    for workspace in rows {
        match fs::metadata(&workspace.path) {
            Ok(metadata) if metadata.is_dir() => valid.push(workspace),
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
fn validate(session: &WorkspaceSession) -> Result<(), String> {
    if session.version != 1
        || session.documents.len() > 200
        || session.tabs.len() > 200
        || session.active_id.len() > 100
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
    if session.tabs.iter().any(|id| {
        id.is_empty()
            || id.len() > 100
            || !tab_ids.insert(id)
            || (!id.starts_with("blank:")
                && id != "view:graph"
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
