use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::Serialize;
use std::path::Path;

pub fn initialize(db: &Connection) -> Result<(), String> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS search_documents (
        rowid INTEGER PRIMARY KEY, workspace TEXT NOT NULL, file_id TEXT NOT NULL,
        path TEXT NOT NULL, hash TEXT NOT NULL, UNIQUE(workspace, file_id));
        CREATE VIRTUAL TABLE IF NOT EXISTS document_fts USING fts5(path, content, tokenize='trigram');")
        .map_err(|e| e.to_string())
}

// The caller supplies the same bytes used for the filesystem hash. All index changes
// commit with the metadata scan, so renames and tombstones cannot leave stale hits.
pub fn update(
    tx: &Transaction,
    workspace: &str,
    id: &str,
    path: &str,
    hash: &str,
    bytes: Option<&[u8]>,
) -> Result<(), String> {
    let old: Option<(i64, String, String)> = tx
        .query_row(
            "SELECT rowid,path,hash FROM search_documents WHERE workspace=?1 AND file_id=?2",
            params![workspace, id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let content = bytes
        .filter(|bytes| {
            !hash.is_empty()
                && bytes.len() <= 8 * 1024 * 1024
                && Path::new(path).extension().is_some_and(|e| {
                    e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("markdown")
                })
        })
        .and_then(|bytes| std::str::from_utf8(bytes).ok());
    if let Some((row, previous_path, previous_hash)) = &old {
        if content.is_some() && previous_path == path && previous_hash == hash {
            return Ok(());
        }
        tx.execute("DELETE FROM document_fts WHERE rowid=?", [row])
            .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM search_documents WHERE rowid=?", [row])
            .map_err(|e| e.to_string())?;
    }
    if let Some(content) = content {
        tx.execute(
            "INSERT INTO search_documents(workspace,file_id,path,hash) VALUES (?1,?2,?3,?4)",
            params![workspace, id, path, hash],
        )
        .map_err(|e| e.to_string())?;
        let row = tx.last_insert_rowid();
        tx.execute(
            "INSERT INTO document_fts(rowid,path,content) VALUES (?1,?2,?3)",
            params![row, path, content],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn prune(tx: &Transaction, workspace: &str) -> Result<(), String> {
    let stale = "SELECT rowid FROM search_documents s WHERE workspace=?1 AND NOT EXISTS(SELECT 1 FROM files f WHERE f.workspace_id=s.workspace AND f.id=s.file_id AND f.path=s.path AND f.deleted=0)";
    tx.execute(
        &format!("DELETE FROM document_fts WHERE rowid IN ({stale})"),
        [workspace],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        &format!("DELETE FROM search_documents WHERE rowid IN ({stale})"),
        [workspace],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct SearchHit {
    pub id: String,
    pub path: String,
    pub excerpt: String,
}

pub fn query(cache: &Path, workspace: &str, query: &str) -> Result<Vec<SearchHit>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(vec![]);
    }
    if query.chars().count() > 200 || query.contains('\0') {
        return Err("搜索词不能超过 200 字或包含空字符".into());
    }
    let db = crate::storage::database(cache)?;
    // A quoted FTS phrase treats quotes, operators and punctuation as literal text.
    // One/two-character queries use a bounded result scan: trigram has no such tokens.
    let (sql, needle) = if query.chars().count() >= 3 {
        ("SELECT s.file_id,s.path,snippet(document_fts,1,'','',' … ',48) FROM document_fts JOIN search_documents s ON s.rowid=document_fts.rowid WHERE document_fts MATCH ?1 AND s.workspace=?2 ORDER BY bm25(document_fts,5.0,1.0),s.path LIMIT 80", format!("\"{}\"", query.replace('"', "\"\"")))
    } else {
        ("SELECT s.file_id,s.path,substr(content,max(1,instr(lower(content),lower(?1))-30),150) FROM document_fts JOIN search_documents s ON s.rowid=document_fts.rowid WHERE s.workspace=?2 AND (instr(lower(document_fts.path),lower(?1))>0 OR instr(lower(content),lower(?1))>0) ORDER BY s.path LIMIT 80", query.to_string())
    };
    let mut statement = db.prepare(sql).map_err(|e| e.to_string())?;
    let results = statement
        .query_map(params![needle, workspace], |r| {
            Ok(SearchHit {
                id: r.get(0)?,
                path: r.get(1)?,
                excerpt: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string());
    results
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    #[test]
    fn streamed_files_are_not_indexed_as_empty_markdown() {
        let directory = tempfile::tempdir().unwrap();
        let mut db = crate::storage::database(&directory.path().join("index.sqlite")).unwrap();
        let tx = db.transaction().unwrap();
        update(
            &tx,
            "one",
            "aabbcc",
            "note.md",
            "small",
            Some(b"searchable text"),
        )
        .unwrap();
        update(&tx, "one", "aabbcc", "note.md", "large", None).unwrap();
        let count: i64 = tx
            .query_row("SELECT count(*) FROM search_documents", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 0);
        update(&tx, "one", "aabbcc", "note.md", "empty", Some(b"")).unwrap();
        let count: i64 = tx
            .query_row("SELECT count(*) FROM search_documents", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(
            count, 1,
            "an actual empty document remains searchable by its path"
        );
    }

    #[test]
    fn indexes_external_edits_renames_deletion_and_rebuild() {
        let root = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(root.path()).unwrap();
        let cache_dir = tempfile::tempdir().unwrap();
        let cache = cache_dir.path().join("index.sqlite");
        fs::write(
            root.join("first.md"),
            "# 文档\n中文全文搜索，人与 Agent 同页工作。 literal OR \"quoted\" 100%_",
        )
        .unwrap();
        fs::write(root.join("binary.md"), [0xff]).unwrap();
        fs::write(root.join("secret.txt"), "only attachment").unwrap();
        crate::storage::scan(&root, "one", &cache).unwrap();
        let hit = query(&cache, "one", "全文搜索").unwrap();
        assert_eq!(hit.len(), 1);
        let identity = &hit[0].id;
        assert_eq!(query(&cache, "one", "同页").unwrap().len(), 1);
        assert_eq!(query(&cache, "one", "agent").unwrap().len(), 1);
        assert_eq!(query(&cache, "one", "\"quoted\"").unwrap().len(), 1);
        assert_eq!(query(&cache, "one", "100%_").unwrap().len(), 1);
        assert!(query(&cache, "two", "全文搜索").unwrap().is_empty());
        assert!(query(&cache, "one", "only attachment").unwrap().is_empty());
        let db = crate::storage::database(&cache).unwrap();
        db.execute_batch("CREATE TRIGGER unchanged_index BEFORE INSERT ON search_documents BEGIN SELECT RAISE(ABORT,'unchanged content reindexed'); END;").unwrap();
        crate::storage::scan(&root, "one", &cache).unwrap();
        db.execute_batch("DROP TRIGGER unchanged_index;").unwrap();
        drop(db);
        fs::rename(root.join("first.md"), root.join("renamed.md")).unwrap();
        fs::write(root.join("renamed.md"), "完全不同的更新内容 updated text").unwrap();
        crate::storage::scan(&root, "one", &cache).unwrap();
        assert!(query(&cache, "one", "全文搜索").unwrap().is_empty());
        let changed = query(&cache, "one", "更新内容").unwrap();
        assert_eq!(changed[0].path, "renamed.md");
        assert_eq!(&changed[0].id, identity);
        fs::remove_file(root.join("renamed.md")).unwrap();
        crate::storage::scan(&root, "one", &cache).unwrap();
        assert!(query(&cache, "one", "updated").unwrap().is_empty());
        fs::write(root.join("new.md"), "重建索引恢复").unwrap();
        let rebuilt = cache_dir.path().join("rebuilt.sqlite");
        crate::storage::scan(&root, "one", &rebuilt).unwrap();
        assert_eq!(query(&rebuilt, "one", "重建索引").unwrap().len(), 1);
    }
}
