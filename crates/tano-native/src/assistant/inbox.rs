use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::{path::Path, time::Duration};
use tauri::State;

fn database(path: &Path) -> Result<Connection, String> {
    std::fs::create_dir_all(path.parent().ok_or("机器人数据路径无效")?)
        .map_err(|_| "无法创建机器人数据目录")?;
    let db = Connection::open(path).map_err(|_| "无法打开机器人收件箱")?;
    db.busy_timeout(Duration::from_secs(5))
        .map_err(|_| "无法配置机器人收件箱")?;
    db.execute_batch("CREATE TABLE IF NOT EXISTS inbox (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, data TEXT NOT NULL);")
        .map_err(|_| "无法初始化机器人收件箱")?;
    Ok(db)
}

fn validate(inbox: &Value, workspace_id: &str) -> Result<u64, String> {
    if inbox.get("version").and_then(Value::as_u64) != Some(1)
        || inbox.get("workspaceId").and_then(Value::as_str) != Some(workspace_id)
        || inbox
            .get("bindings")
            .and_then(Value::as_array)
            .is_none_or(|v| v.len() > 1000)
        || inbox
            .get("tasks")
            .and_then(Value::as_array)
            .is_none_or(|v| v.len() > 10000)
        || serde_json::to_vec(inbox)
            .map_err(|_| "机器人收件箱无效")?
            .len()
            > 32_000_000
    {
        return Err("机器人收件箱身份或大小无效".into());
    }
    inbox
        .get("revision")
        .and_then(Value::as_u64)
        .filter(|revision| *revision <= 9_007_199_254_740_991)
        .ok_or_else(|| "机器人收件箱版本无效".into())
}

fn load(db: &Connection, workspace_id: &str) -> Result<Value, String> {
    let row: Option<(u64, String)> = db
        .query_row("SELECT revision,data FROM inbox WHERE id=1", [], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .optional()
        .map_err(|_| "无法读取机器人收件箱")?;
    let Some((revision, data)) = row else {
        return Ok(
            json!({"version":1,"workspaceId":workspace_id,"revision":0,"bindings":[],"tasks":[]}),
        );
    };
    let value = serde_json::from_str(&data).map_err(|_| "机器人收件箱损坏，原记录已保留")?;
    if validate(&value, workspace_id)? != revision {
        return Err("机器人收件箱版本损坏，原记录已保留".into());
    }
    Ok(value)
}

fn save(db: &Connection, inbox: &Value, workspace_id: &str, expected: u64) -> Result<bool, String> {
    let revision = validate(inbox, workspace_id)?;
    if expected.checked_add(1) != Some(revision) {
        return Err("机器人收件箱版本无效".into());
    }
    let data = serde_json::to_string(inbox).map_err(|_| "机器人收件箱无效")?;
    let changed = if expected == 0 {
        db.execute(
            "INSERT OR IGNORE INTO inbox(id,revision,data) VALUES(1,?1,?2)",
            params![revision, data],
        )
    } else {
        db.execute(
            "UPDATE inbox SET revision=?1,data=?2 WHERE id=1 AND revision=?3",
            params![revision, data, expected],
        )
    }
    .map_err(|_| "无法保存机器人收件箱")?;
    Ok(changed == 1)
}

#[tauri::command(async)]
pub fn assistant_inbox_load(
    app: tauri::AppHandle,
    state: State<crate::AppState>,
    workspace_id: String,
) -> Result<Value, String> {
    let directory = super::session_directory(&app, &workspace_id, state)?;
    load(&database(&directory.join("inbox.sqlite"))?, &workspace_id)
}

#[tauri::command(async)]
pub fn assistant_inbox_save(
    app: tauri::AppHandle,
    state: State<crate::AppState>,
    inbox: Value,
    expected_revision: u64,
) -> Result<bool, String> {
    let workspace_id = inbox
        .get("workspaceId")
        .and_then(Value::as_str)
        .ok_or("工作区身份无效")?;
    let directory = super::session_directory(&app, workspace_id, state)?;
    save(
        &database(&directory.join("inbox.sqlite"))?,
        &inbox,
        workspace_id,
        expected_revision,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inbox_compare_exchange_survives_reopen_and_rejects_stale_writers() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("inbox.sqlite");
        let first = database(&path).unwrap();
        let second = database(&path).unwrap();
        let mut value = load(&first, "workspace").unwrap();
        value["revision"] = json!(1);
        assert!(save(&first, &value, "workspace", 0).unwrap());
        assert!(!save(&second, &value, "workspace", 0).unwrap());
        value["revision"] = json!(2);
        assert!(save(&second, &value, "workspace", 1).unwrap());
        assert!(!save(&first, &value, "workspace", 1).unwrap());
        drop(first);
        drop(second);
        assert_eq!(
            load(&database(&path).unwrap(), "workspace").unwrap()["revision"],
            2
        );
        assert!(load(&database(&path).unwrap(), "other").is_err());
    }
}
