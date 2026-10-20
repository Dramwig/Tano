use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::path::Path;

// AppImage resources live in a temporary mount that disappears on exit.
// Publish a complete standalone bundle to a stable, application-owned location.
#[cfg(target_os = "linux")]
pub fn persistent_mcp_script(source: &Path, data: &Path) -> Result<std::path::PathBuf, String> {
    use std::io::Write;
    let bytes = std::fs::read(source).map_err(|e| e.to_string())?;
    let directory = data.join("mcp");
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let target = directory.join("tano-mcp.cjs");
    if std::fs::read(&target).ok().as_deref() != Some(bytes.as_slice()) {
        let mut staged = tempfile::NamedTempFile::new_in(&directory).map_err(|e| e.to_string())?;
        staged.write_all(&bytes).map_err(|e| e.to_string())?;
        staged.as_file().sync_all().map_err(|e| e.to_string())?;
        staged.persist(&target).map_err(|e| e.to_string())?;
        std::fs::File::open(&directory)
            .and_then(|dir| dir.sync_all())
            .map_err(|e| e.to_string())?;
    }
    std::fs::canonicalize(target).map_err(|e| e.to_string())
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    id: String,
    path: String,
    client: String,
    instance_id: String,
    operation: String,
    created_at: i64,
    status: String,
    before_hash: Option<String>,
    after_hash: String,
    error: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    before_content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    after_content: Option<String>,
}

pub fn changes(
    data: &Path,
    id: &str,
    root: &Path,
    selected: Option<&str>,
) -> Result<Vec<Change>, String> {
    uuid::Uuid::parse_str(id).map_err(|_| "工作区标识无效")?;
    let path = data.join("agents").join(format!("{id}.sqlite"));
    if !path.exists() {
        return Ok(Vec::new());
    }
    let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;
    db.busy_timeout(std::time::Duration::from_secs(3))
        .map_err(|e| e.to_string())?;
    let root = root
        .display()
        .to_string()
        .trim_start_matches("\\\\?\\")
        .to_string();
    let body = if selected.is_some() {
        "before_content,after_content"
    } else {
        "NULL,NULL"
    };
    let has_instance_id: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('agent_changes') WHERE name='instance_id')",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let instance = if has_instance_id { "instance_id" } else { "''" };
    let collation = if cfg!(windows) { "COLLATE NOCASE" } else { "" };
    let sql = format!("SELECT id,path,client,{instance},operation,created_at,status,before_hash,after_hash,error,{body} FROM agent_changes WHERE root = ?1 {collation} AND (?2 IS NULL OR id = ?2) ORDER BY created_at DESC LIMIT 200");
    let mut statement = db.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = statement
        .query_map(rusqlite::params![root, selected], |row| {
            Ok(Change {
                id: row.get(0)?,
                path: row.get(1)?,
                client: row.get(2)?,
                instance_id: row.get(3)?,
                operation: row.get(4)?,
                created_at: row.get(5)?,
                status: row.get(6)?,
                before_hash: row.get(7)?,
                after_hash: row.get(8)?,
                error: row.get(9)?,
                before_content: row.get(10)?,
                after_content: row.get(11)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for row in rows {
        let change = row.map_err(|e| e.to_string())?;
        if !matches!(change.operation.as_str(), "create" | "write")
            || !matches!(change.status.as_str(), "prepared" | "applied" | "failed")
        {
            return Err("Agent 活动格式不受支持".into());
        }
        if let Some(before) = &change.before_content {
            if before.len() > 8 * 1024 * 1024
                || change.before_hash.as_deref()
                    != Some(crate::storage::hash(before.as_bytes()).as_str())
            {
                return Err("Agent 活动的修改前内容校验失败".into());
            }
        }
        if let Some(after) = &change.after_content {
            if after.len() > 8 * 1024 * 1024
                || change.after_hash != crate::storage::hash(after.as_bytes())
            {
                return Err("Agent 活动的修改后内容校验失败".into());
            }
        }
        result.push(change);
    }
    Ok(result)
}

pub fn terminal(root: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let windows = std::env::var_os("SystemRoot").ok_or("找不到 Windows 系统目录")?;
        std::process::Command::new(
            Path::new(&windows).join("System32/WindowsPowerShell/v1.0/powershell.exe"),
        )
        .args(["-NoLogo", "-NoProfile", "-NoExit"])
        .current_dir(root)
        .creation_flags(0x00000010) // A terminal explicitly requested by the user.
        .spawn()
        .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-a", "Terminal"])
            .arg(root)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        for program in ["x-terminal-emulator", "gnome-terminal", "konsole", "xterm"] {
            if std::process::Command::new(program)
                .current_dir(root)
                .spawn()
                .is_ok()
            {
                return Ok(());
            }
        }
        Err("未找到终端程序，请从系统终端打开此目录".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_os = "linux")]
    #[test]
    fn mcp_config_survives_appimage_unmount_and_refreshes_same_path() {
        let data = tempfile::tempdir().unwrap();
        let mount = tempfile::tempdir().unwrap();
        let source = mount.path().join("tano-mcp.cjs");
        std::fs::write(&source, b"first standalone bundle").unwrap();
        let script = persistent_mcp_script(&source, data.path()).unwrap();
        mount.close().unwrap();
        assert_eq!(std::fs::read(&script).unwrap(), b"first standalone bundle");
        let next_mount = tempfile::tempdir().unwrap();
        let next_source = next_mount.path().join("tano-mcp.cjs");
        std::fs::write(&next_source, b"updated standalone bundle").unwrap();
        assert_eq!(
            persistent_mcp_script(&next_source, data.path()).unwrap(),
            script
        );
        assert_eq!(
            std::fs::read(&script).unwrap(),
            b"updated standalone bundle"
        );
        std::fs::write(&script, b"interrupted or damaged copy").unwrap();
        persistent_mcp_script(&next_source, data.path()).unwrap();
        assert_eq!(
            std::fs::read(&script).unwrap(),
            b"updated standalone bundle"
        );
    }
    #[test]
    fn reads_only_selected_workspace_and_validates_diff_bytes() {
        let temp = tempfile::tempdir().unwrap();
        let data = temp.path().join("data");
        std::fs::create_dir_all(data.join("agents")).unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let db = Connection::open(data.join("agents").join(format!("{id}.sqlite"))).unwrap();
        db.execute_batch("CREATE TABLE agent_changes (id TEXT,path TEXT,client TEXT,instance_id TEXT,operation TEXT,created_at INTEGER,status TEXT,before_hash TEXT,after_hash TEXT,error TEXT,before_content TEXT,after_content TEXT,root TEXT)").unwrap();
        let root = temp
            .path()
            .display()
            .to_string()
            .trim_start_matches("\\\\?\\")
            .to_string();
        db.execute("INSERT INTO agent_changes VALUES ('one','note.md','client','instance-1','write',1,'applied',?1,?2,'','before','after',?3)", rusqlite::params![crate::storage::hash(b"before"), crate::storage::hash(b"after"), root]).unwrap();
        assert_eq!(changes(&data, &id, temp.path(), None).unwrap().len(), 1);
        assert!(changes(&data, &id, &temp.path().join("other"), None)
            .unwrap()
            .is_empty());
        assert_eq!(
            changes(&data, &id, temp.path(), Some("one")).unwrap()[0]
                .after_content
                .as_deref(),
            Some("after")
        );
        let large = "x".repeat(600 * 1024);
        db.execute(
            "UPDATE agent_changes SET after_content=?1,after_hash=?2",
            rusqlite::params![large, crate::storage::hash(large.as_bytes())],
        )
        .unwrap();
        assert_eq!(
            changes(&data, &id, temp.path(), Some("one")).unwrap()[0]
                .after_content
                .as_ref()
                .unwrap()
                .len(),
            large.len()
        );
        db.execute("UPDATE agent_changes SET after_content='tampered'", [])
            .unwrap();
        assert!(changes(&data, &id, temp.path(), Some("one"))
            .unwrap_err()
            .contains("校验失败"));
    }

    #[test]
    fn reads_legacy_activity_schema_without_instance_id() {
        let temp = tempfile::tempdir().unwrap();
        let data = temp.path().join("data");
        std::fs::create_dir_all(data.join("agents")).unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let db = Connection::open(data.join("agents").join(format!("{id}.sqlite"))).unwrap();
        db.execute_batch("CREATE TABLE agent_changes (id TEXT,path TEXT,client TEXT,operation TEXT,created_at INTEGER,status TEXT,before_hash TEXT,after_hash TEXT,error TEXT,before_content TEXT,after_content TEXT,root TEXT)").unwrap();
        let root = temp.path().display().to_string();
        db.execute("INSERT INTO agent_changes VALUES ('legacy','note.md','client','write',1,'applied',?1,?2,'','before','after',?3)", rusqlite::params![crate::storage::hash(b"before"), crate::storage::hash(b"after"), root]).unwrap();
        assert_eq!(
            changes(&data, &id, temp.path(), None).unwrap()[0].instance_id,
            ""
        );
    }
}
