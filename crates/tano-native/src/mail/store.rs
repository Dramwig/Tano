//! Device-local SQLite storage (mail.sqlite) and bounded attachment cache (mail-cache/).
//! Completely isolated from workspace files and workspace index.sqlite.

use super::folders::normalize_cached_folders;
use super::mime::decode_modified_utf7;
use super::types::{
    unix_timestamp_secs, MailAddress, MailAttachmentInfo, MailCacheStats, MailCalendarInvite,
    MailDraft, MailFolder, MailMessageDetail, MailMessageSummary, DEFAULT_CACHE_LIMIT_BYTES,
    FLAG_ANSWERED, FLAG_FLAGGED, FLAG_SEEN,
};
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

const SCHEMA_VERSION: i64 = 1;

pub struct MailStore {
    db_path: PathBuf,
    cache_dir: PathBuf,
}

#[derive(Clone, Debug)]
pub struct FolderUpsert {
    pub remote_name: String,
    pub display_name: String,
    pub special_use: Option<String>,
    pub delimiter: Option<String>,
    pub uid_validity: Option<u32>,
    pub uid_next: Option<u32>,
    pub unread_count: u32,
    pub total_count: u32,
}

#[derive(Clone, Debug)]
pub struct HeaderUpsert {
    pub uid: u32,
    pub message_id: String,
    pub thread_key: String,
    pub subject: String,
    pub from: Vec<MailAddress>,
    pub to: Vec<MailAddress>,
    pub cc: Vec<MailAddress>,
    pub reply_to: Vec<MailAddress>,
    pub in_reply_to: Option<String>,
    pub references: Vec<String>,
    pub date_ts: i64,
    pub snippet: String,
    pub flags: u32,
    pub has_attachments: bool,
    pub has_ics: bool,
}

#[derive(Clone, Debug)]
pub struct ParsedAttachmentRecord {
    pub part_id: String,
    pub filename: String,
    pub content_type: String,
    pub size_bytes: u64,
    pub cid: Option<String>,
    pub is_inline: bool,
    pub inline_bytes: Option<Vec<u8>>,
}

#[derive(Clone, Debug)]
pub struct ParsedInviteRecord {
    pub ics_uid: String,
    pub method: String,
    pub summary: String,
    pub raw_ics: String,
}

#[derive(Clone, Debug)]
pub struct ParsedBodyPayload {
    pub text_body: String,
    pub html_sanitized: String,
    pub snippet: String,
    pub has_remote_images: bool,
    pub attachments: Vec<ParsedAttachmentRecord>,
    pub invites: Vec<ParsedInviteRecord>,
}

impl MailStore {
    pub fn open(data_dir: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
        let db_path = data_dir.join("mail.sqlite");
        let cache_dir = data_dir.join("mail-cache");
        std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
        let store = Self { db_path, cache_dir };
        let conn = store.connect()?;
        init_schema(&conn)?;
        Ok(store)
    }

    fn connect(&self) -> Result<Connection, String> {
        let conn = Connection::open(&self.db_path).map_err(|e| e.to_string())?;
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(|e| e.to_string())?;
        conn.pragma_update(None, "foreign_keys", "ON")
            .map_err(|e| e.to_string())?;
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        Ok(conn)
    }

    pub fn folder_id(account_id: &str, remote_name: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(account_id.as_bytes());
        hasher.update(b"::");
        hasher.update(remote_name.as_bytes());
        format!("{:x}", hasher.finalize())[..32].to_string()
    }

    pub fn message_row_id(folder_id: &str, uid: u32) -> String {
        format!("{folder_id}:{uid}")
    }

    pub fn upsert_folders(
        &self,
        account_id: &str,
        folders: &[FolderUpsert],
    ) -> Result<Vec<MailFolder>, String> {
        let mut conn = self.connect()?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let mut keep_ids = Vec::with_capacity(folders.len());
        for folder in folders {
            let id = Self::folder_id(account_id, &folder.remote_name);
            keep_ids.push(id.clone());
            // Keep `synced_at` NULL until message headers for this folder are actually synced
            // via `upsert_headers`, and preserve any existing `synced_at` on metadata refreshes.
            tx.execute(
                "INSERT INTO mail_folders (
                    id, account_id, remote_name, display_name, special_use, delimiter,
                    uid_validity, uid_next, unread_count, total_count, synced_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL)
                ON CONFLICT(id) DO UPDATE SET
                    display_name = excluded.display_name,
                    special_use = excluded.special_use,
                    delimiter = excluded.delimiter,
                    uid_validity = COALESCE(excluded.uid_validity, mail_folders.uid_validity),
                    uid_next = COALESCE(excluded.uid_next, mail_folders.uid_next),
                    unread_count = excluded.unread_count,
                    total_count = excluded.total_count",
                params![
                    id,
                    account_id,
                    folder.remote_name,
                    folder.display_name,
                    folder.special_use,
                    folder.delimiter,
                    folder.uid_validity,
                    folder.uid_next,
                    folder.unread_count,
                    folder.total_count
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        // Remove stale folders that no longer exist on the remote server.
        let existing_ids: Vec<String> = {
            let mut stmt = tx
                .prepare("SELECT id FROM mail_folders WHERE account_id = ?1")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![account_id], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        for old_id in existing_ids {
            if !keep_ids.contains(&old_id) {
                tx.execute("DELETE FROM mail_folders WHERE id = ?1", params![old_id])
                    .map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        self.list_folders(Some(account_id))
    }

    pub fn list_folders(&self, account_id: Option<&str>) -> Result<Vec<MailFolder>, String> {
        let conn = self.connect()?;
        let sql = if account_id.is_some() {
            "SELECT id, account_id, remote_name, display_name, special_use, delimiter, uid_validity, uid_next, unread_count, total_count, synced_at
             FROM mail_folders WHERE account_id = ?1
             ORDER BY CASE special_use
                WHEN 'inbox' THEN 0
                WHEN 'flagged' THEN 1
                WHEN 'important' THEN 2
                WHEN 'sent' THEN 3
                WHEN 'drafts' THEN 4
                WHEN 'archive' THEN 5
                WHEN 'all' THEN 6
                WHEN 'junk' THEN 7
                WHEN 'trash' THEN 8
                WHEN 'notes' THEN 9
                ELSE 10 END, display_name COLLATE NOCASE"
        } else {
            "SELECT id, account_id, remote_name, display_name, special_use, delimiter, uid_validity, uid_next, unread_count, total_count, synced_at
             FROM mail_folders
             ORDER BY account_id, CASE special_use
                WHEN 'inbox' THEN 0
                WHEN 'flagged' THEN 1
                WHEN 'important' THEN 2
                WHEN 'sent' THEN 3
                WHEN 'drafts' THEN 4
                WHEN 'archive' THEN 5
                WHEN 'all' THEN 6
                WHEN 'junk' THEN 7
                WHEN 'trash' THEN 8
                WHEN 'notes' THEN 9
                ELSE 10 END, display_name COLLATE NOCASE"
        };
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let rows = if let Some(account_id) = account_id {
            stmt.query_map(params![account_id], map_folder_row)
        } else {
            stmt.query_map([], map_folder_row)
        }
        .map_err(|e| e.to_string())?;
        let list = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(normalize_cached_folders(list))
    }

    pub fn get_folder(&self, folder_id: &str) -> Result<MailFolder, String> {
        let conn = self.connect()?;
        conn.query_row(
            "SELECT id, account_id, remote_name, display_name, special_use, delimiter, uid_validity, uid_next, unread_count, total_count, synced_at
             FROM mail_folders WHERE id = ?1",
            params![folder_id],
            map_folder_row,
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "找不到该邮箱文件夹".into())
    }

    pub fn find_special_folder(
        &self,
        account_id: &str,
        special_use: &str,
    ) -> Result<Option<MailFolder>, String> {
        let folders = self.list_folders(Some(account_id))?;
        Ok(folders
            .into_iter()
            .find(|folder| folder.special_use.as_deref() == Some(special_use)))
    }

    pub fn max_uid_in_folder(&self, folder_id: &str) -> Result<u32, String> {
        let conn = self.connect()?;
        let max_uid: Option<u32> = conn
            .query_row(
                "SELECT MAX(uid) FROM mail_messages WHERE folder_id = ?1",
                params![folder_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        Ok(max_uid.unwrap_or(0))
    }

    pub fn reset_folder_on_uidvalidity_change(
        &self,
        folder_id: &str,
        new_uid_validity: u32,
    ) -> Result<(), String> {
        let mut conn = self.connect()?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "DELETE FROM mail_messages WHERE folder_id = ?1",
            params![folder_id],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "UPDATE mail_folders SET uid_validity = ?2, uid_next = NULL WHERE id = ?1",
            params![folder_id, new_uid_validity],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    }

    pub fn upsert_headers(
        &self,
        account_id: &str,
        folder_id: &str,
        uid_validity: Option<u32>,
        uid_next: Option<u32>,
        unread_count: u32,
        total_count: u32,
        headers: &[HeaderUpsert],
    ) -> Result<usize, String> {
        let mut conn = self.connect()?;
        let now = unix_timestamp_secs();
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let mut inserted = 0usize;
        for item in headers {
            let row_id = Self::message_row_id(folder_id, item.uid);
            let existed: bool = tx
                .query_row(
                    "SELECT 1 FROM mail_messages WHERE id = ?1",
                    params![&row_id],
                    |_| Ok(true),
                )
                .optional()
                .map_err(|e| e.to_string())?
                .unwrap_or(false);
            let from_json = serde_json::to_string(&item.from).map_err(|e| e.to_string())?;
            let to_json = serde_json::to_string(&item.to).map_err(|e| e.to_string())?;
            let cc_json = serde_json::to_string(&item.cc).map_err(|e| e.to_string())?;
            let reply_to_json = serde_json::to_string(&item.reply_to).map_err(|e| e.to_string())?;
            let refs_json = serde_json::to_string(&item.references).map_err(|e| e.to_string())?;
            let from_text = format_addresses_text(&item.from);
            let to_text = format_addresses_text(&item.to);
            tx.execute(
                "INSERT INTO mail_messages (
                    id, account_id, folder_id, uid, message_id, thread_key, subject,
                    from_json, to_json, cc_json, reply_to_json, in_reply_to, references_json,
                    from_text, to_text, date_ts, snippet, flags,
                    has_attachments, has_ics, body_fetched, text_body, html_sanitized,
                    has_remote_images, body_size, last_accessed_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7,
                    ?8, ?9, ?10, ?11, ?12, ?13,
                    ?14, ?15, ?16, ?17, ?18,
                    ?19, ?20, 0, '', '', 0, 0, ?21
                )
                ON CONFLICT(id) DO UPDATE SET
                    flags = excluded.flags,
                    subject = CASE WHEN excluded.subject != '' THEN excluded.subject ELSE mail_messages.subject END,
                    has_attachments = MAX(mail_messages.has_attachments, excluded.has_attachments),
                    has_ics = MAX(mail_messages.has_ics, excluded.has_ics)",
                params![
                    &row_id,
                    account_id,
                    folder_id,
                    item.uid,
                    &item.message_id,
                    &item.thread_key,
                    &item.subject,
                    &from_json,
                    &to_json,
                    &cc_json,
                    &reply_to_json,
                    &item.in_reply_to,
                    &refs_json,
                    &from_text,
                    &to_text,
                    item.date_ts,
                    &item.snippet,
                    item.flags,
                    i32::from(item.has_attachments),
                    i32::from(item.has_ics),
                    now,
                ],
            )
            .map_err(|e| e.to_string())?;
            if !existed {
                inserted += 1;
            }
        }
        tx.execute(
            "UPDATE mail_folders
             SET uid_validity = COALESCE(?2, uid_validity),
                 uid_next = COALESCE(?3, uid_next),
                 unread_count = ?4,
                 total_count = ?5,
                 synced_at = ?6
             WHERE id = ?1",
            params![
                folder_id,
                uid_validity,
                uid_next,
                unread_count,
                total_count,
                now
            ],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(inserted)
    }

    pub fn update_known_flags(
        &self,
        folder_id: &str,
        updates: &[(u32, u32)],
    ) -> Result<(), String> {
        let mut conn = self.connect()?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        for (uid, flags) in updates {
            let row_id = Self::message_row_id(folder_id, *uid);
            tx.execute(
                "UPDATE mail_messages SET flags = ?2 WHERE id = ?1",
                params![row_id, flags],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())
    }

    pub fn store_message_body(
        &self,
        account_id: &str,
        message_id: &str,
        payload: &ParsedBodyPayload,
    ) -> Result<(), String> {
        let mut conn = self.connect()?;
        let now = unix_timestamp_secs();
        let body_size = (payload.text_body.len() + payload.html_sanitized.len()) as i64;
        let has_attachments = payload.attachments.iter().any(|att| !att.is_inline);
        let has_ics = !payload.invites.is_empty();
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "UPDATE mail_messages
             SET body_fetched = 1,
                 text_body = ?2,
                 html_sanitized = ?3,
                 snippet = CASE WHEN ?4 != '' THEN ?4 ELSE snippet END,
                 has_remote_images = ?5,
                 has_attachments = MAX(has_attachments, ?6),
                 has_ics = MAX(has_ics, ?7),
                 body_size = ?8,
                 last_accessed_at = ?9
             WHERE id = ?1",
            params![
                message_id,
                &payload.text_body,
                &payload.html_sanitized,
                &payload.snippet,
                i32::from(payload.has_remote_images),
                i32::from(has_attachments),
                i32::from(has_ics),
                body_size,
                now,
            ],
        )
        .map_err(|e| e.to_string())?;

        tx.execute(
            "DELETE FROM mail_attachments WHERE message_id = ?1",
            params![message_id],
        )
        .map_err(|e| e.to_string())?;
        for (index, att) in payload.attachments.iter().enumerate() {
            let att_id = format!("{message_id}:att:{index}");
            let (cache_path, downloaded_at) = if let Some(bytes) = &att.inline_bytes {
                let path = self.write_cache_blob(account_id, bytes)?;
                (Some(path.to_string_lossy().to_string()), Some(now))
            } else {
                (None, None)
            };
            tx.execute(
                "INSERT INTO mail_attachments (
                    id, message_id, part_id, filename, content_type, size_bytes,
                    cid, is_inline, cache_path, downloaded_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    att_id,
                    message_id,
                    &att.part_id,
                    &att.filename,
                    &att.content_type,
                    att.size_bytes as i64,
                    &att.cid,
                    i32::from(att.is_inline),
                    cache_path,
                    downloaded_at,
                ],
            )
            .map_err(|e| e.to_string())?;
        }

        for (index, inv) in payload.invites.iter().enumerate() {
            let inv_id = format!("{message_id}:ics:{index}");
            tx.execute(
                "INSERT INTO mail_calendar_invites (
                    id, message_id, ics_uid, method, summary, raw_ics
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                ON CONFLICT(id) DO UPDATE SET
                    ics_uid = excluded.ics_uid,
                    method = excluded.method,
                    summary = excluded.summary,
                    raw_ics = excluded.raw_ics",
                params![
                    inv_id,
                    message_id,
                    &inv.ics_uid,
                    &inv.method,
                    &inv.summary,
                    &inv.raw_ics,
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        let _ = self.enforce_cache_budget(DEFAULT_CACHE_LIMIT_BYTES);
        Ok(())
    }

    pub fn list_messages(
        &self,
        folder_id: &str,
        limit: usize,
        offset: usize,
        filter: Option<&str>,
    ) -> Result<Vec<MailMessageSummary>, String> {
        let conn = self.connect()?;
        let extra = match filter {
            Some("unread") => "AND (flags & 1) = 0",
            Some("flagged") => "AND (flags & 2) != 0",
            Some("calendar") => "AND has_ics = 1",
            Some("attachments") => "AND has_attachments = 1",
            _ => "",
        };
        let sql = format!(
            "SELECT id, account_id, folder_id, uid, message_id, thread_key, subject,
                    from_json, to_json, date_ts, snippet, flags,
                    has_attachments, has_ics, body_fetched
             FROM mail_messages
             WHERE folder_id = ?1 {extra}
             ORDER BY date_ts DESC, uid DESC
             LIMIT ?2 OFFSET ?3"
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(
                params![folder_id, limit.min(200) as i64, offset as i64],
                map_summary_row,
            )
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    /// Lists cached messages across all accounts' primary inbox folders (`special_use = 'inbox'`),
    /// sorted newest-first for the Unified Inbox view.
    pub fn list_unified_inbox_messages(
        &self,
        limit: usize,
        offset: usize,
        filter: Option<&str>,
    ) -> Result<Vec<MailMessageSummary>, String> {
        let conn = self.connect()?;
        let extra = match filter {
            Some("unread") => "AND (m.flags & 1) = 0",
            Some("flagged") => "AND (m.flags & 2) != 0",
            Some("calendar") => "AND m.has_ics = 1",
            Some("attachments") => "AND m.has_attachments = 1",
            _ => "",
        };
        let sql = format!(
            "SELECT m.id, m.account_id, m.folder_id, m.uid, m.message_id, m.thread_key, m.subject,
                    m.from_json, m.to_json, m.date_ts, m.snippet, m.flags,
                    m.has_attachments, m.has_ics, m.body_fetched
             FROM mail_messages m
             JOIN mail_folders f ON f.id = m.folder_id
             WHERE f.special_use = 'inbox' {extra}
             ORDER BY m.date_ts DESC, m.uid DESC
             LIMIT ?1 OFFSET ?2"
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(
                params![limit.min(200) as i64, offset as i64],
                map_summary_row,
            )
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn search_messages(
        &self,
        account_id: Option<&str>,
        query: &str,
        limit: usize,
    ) -> Result<Vec<MailMessageSummary>, String> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }
        let capped = limit.min(100) as i64;
        let conn = self.connect()?;
        let fts_query = sanitize_fts_query(trimmed);
        let fts_sql = if account_id.is_some() {
            "SELECT m.id, m.account_id, m.folder_id, m.uid, m.message_id, m.thread_key, m.subject,
                    m.from_json, m.to_json, m.date_ts, m.snippet, m.flags,
                    m.has_attachments, m.has_ics, m.body_fetched
             FROM mail_messages_fts f
             JOIN mail_messages m ON m.rowid = f.rowid
             WHERE mail_messages_fts MATCH ?1 AND m.account_id = ?2
             ORDER BY m.date_ts DESC
             LIMIT ?3"
        } else {
            "SELECT m.id, m.account_id, m.folder_id, m.uid, m.message_id, m.thread_key, m.subject,
                    m.from_json, m.to_json, m.date_ts, m.snippet, m.flags,
                    m.has_attachments, m.has_ics, m.body_fetched
             FROM mail_messages_fts f
             JOIN mail_messages m ON m.rowid = f.rowid
             WHERE mail_messages_fts MATCH ?1
             ORDER BY m.date_ts DESC
             LIMIT ?2"
        };
        let fts_results: Vec<MailMessageSummary> = {
            let mut stmt = conn.prepare(fts_sql).map_err(|e| e.to_string())?;
            let rows = if let Some(account_id) = account_id {
                stmt.query_map(params![fts_query, account_id, capped], map_summary_row)
            } else {
                stmt.query_map(params![fts_query, capped], map_summary_row)
            }
            .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        if !fts_results.is_empty() {
            return Ok(fts_results);
        }

        // Fallback substring match for short CJK terms (e.g. 2-char Chinese words inside unsegmented text).
        let like_pattern = format!(
            "%{}%",
            trimmed
                .replace('\\', "\\\\")
                .replace('%', "\\%")
                .replace('_', "\\_")
        );
        let like_sql = if account_id.is_some() {
            "SELECT id, account_id, folder_id, uid, message_id, thread_key, subject,
                    from_json, to_json, date_ts, snippet, flags,
                    has_attachments, has_ics, body_fetched
             FROM mail_messages
             WHERE account_id = ?1 AND (
                subject LIKE ?2 ESCAPE '\\' OR
                from_text LIKE ?2 ESCAPE '\\' OR
                to_text LIKE ?2 ESCAPE '\\' OR
                snippet LIKE ?2 ESCAPE '\\' OR
                text_body LIKE ?2 ESCAPE '\\'
             )
             ORDER BY date_ts DESC
             LIMIT ?3"
        } else {
            "SELECT id, account_id, folder_id, uid, message_id, thread_key, subject,
                    from_json, to_json, date_ts, snippet, flags,
                    has_attachments, has_ics, body_fetched
             FROM mail_messages
             WHERE subject LIKE ?1 ESCAPE '\\' OR
                   from_text LIKE ?1 ESCAPE '\\' OR
                   to_text LIKE ?1 ESCAPE '\\' OR
                   snippet LIKE ?1 ESCAPE '\\' OR
                   text_body LIKE ?1 ESCAPE '\\'
             ORDER BY date_ts DESC
             LIMIT ?2"
        };
        let mut stmt = conn.prepare(like_sql).map_err(|e| e.to_string())?;
        let rows = if let Some(account_id) = account_id {
            stmt.query_map(params![account_id, like_pattern, capped], map_summary_row)
        } else {
            stmt.query_map(params![like_pattern, capped], map_summary_row)
        }
        .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn get_message_detail(&self, message_id: &str) -> Result<MailMessageDetail, String> {
        let conn = self.connect()?;
        let now = unix_timestamp_secs();
        let _ = conn.execute(
            "UPDATE mail_messages SET last_accessed_at = ?2 WHERE id = ?1",
            params![message_id, now],
        );
        let row = conn
            .query_row(
                "SELECT id, account_id, folder_id, uid, message_id, thread_key, subject,
                        from_json, to_json, date_ts, snippet, flags,
                        has_attachments, has_ics, body_fetched,
                        cc_json, reply_to_json, in_reply_to, references_json,
                        text_body, html_sanitized, has_remote_images
                 FROM mail_messages WHERE id = ?1",
                params![message_id],
                |row| {
                    let summary = map_summary_row(row)?;
                    let cc_raw: String = row.get(15)?;
                    let reply_to_raw: String = row.get(16)?;
                    let in_reply_to: Option<String> = row.get(17)?;
                    let refs_raw: String = row.get(18)?;
                    let text_body: String = row.get(19)?;
                    let html_sanitized: String = row.get(20)?;
                    let has_remote_images: i32 = row.get(21)?;
                    Ok((
                        summary,
                        serde_json::from_str::<Vec<MailAddress>>(&cc_raw).unwrap_or_default(),
                        serde_json::from_str::<Vec<MailAddress>>(&reply_to_raw).unwrap_or_default(),
                        in_reply_to,
                        serde_json::from_str::<Vec<String>>(&refs_raw).unwrap_or_default(),
                        text_body,
                        html_sanitized,
                        has_remote_images != 0,
                    ))
                },
            )
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "找不到该邮件".to_string())?;

        let attachments = {
            let mut stmt = conn
                .prepare(
                    "SELECT id, message_id, part_id, filename, content_type, size_bytes, cid, is_inline, cache_path
                     FROM mail_attachments WHERE message_id = ?1 ORDER BY rowid ASC",
                )
                .map_err(|e| e.to_string())?;
            let items = stmt
                .query_map(params![message_id], |r| {
                    let cache_path: Option<String> = r.get(8)?;
                    let downloaded = cache_path
                        .as_deref()
                        .map(|p| Path::new(p).exists())
                        .unwrap_or(false);
                    Ok(MailAttachmentInfo {
                        id: r.get(0)?,
                        message_id: r.get(1)?,
                        part_id: r.get(2)?,
                        filename: r.get(3)?,
                        content_type: r.get(4)?,
                        size_bytes: r.get::<_, i64>(5)?.max(0) as u64,
                        cid: r.get(6)?,
                        is_inline: r.get::<_, i32>(7)? != 0,
                        downloaded,
                    })
                })
                .map_err(|e| e.to_string())?;
            items
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };

        let invites = {
            let mut stmt = conn
                .prepare(
                    "SELECT id, message_id, ics_uid, method, summary, raw_ics, imported_object_id, rsvp_status
                     FROM mail_calendar_invites WHERE message_id = ?1 ORDER BY rowid ASC",
                )
                .map_err(|e| e.to_string())?;
            let items = stmt
                .query_map(params![message_id], |r| {
                    Ok(MailCalendarInvite {
                        id: r.get(0)?,
                        message_id: r.get(1)?,
                        ics_uid: r.get(2)?,
                        method: r.get(3)?,
                        summary: r.get(4)?,
                        raw_ics: r.get(5)?,
                        imported_object_id: r.get(6)?,
                        rsvp_status: r.get(7)?,
                    })
                })
                .map_err(|e| e.to_string())?;
            items
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };

        Ok(MailMessageDetail {
            summary: row.0,
            cc: row.1,
            reply_to: row.2,
            in_reply_to: row.3,
            references: row.4,
            text_body: row.5,
            html_sanitized: row.6,
            has_remote_images: row.7,
            attachments,
            invites,
        })
    }

    pub fn update_flags_local(
        &self,
        message_id: &str,
        seen: Option<bool>,
        flagged: Option<bool>,
    ) -> Result<(String, u32, u32), String> {
        let mut conn = self.connect()?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let (folder_id, uid, current_flags): (String, u32, u32) = tx
            .query_row(
                "SELECT folder_id, uid, flags FROM mail_messages WHERE id = ?1",
                params![message_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "找不到该邮件".to_string())?;
        let mut next = current_flags;
        if let Some(v) = seen {
            if v {
                next |= FLAG_SEEN;
            } else {
                next &= !FLAG_SEEN;
            }
        }
        if let Some(v) = flagged {
            if v {
                next |= FLAG_FLAGGED;
            } else {
                next &= !FLAG_FLAGGED;
            }
        }
        tx.execute(
            "UPDATE mail_messages SET flags = ?2 WHERE id = ?1",
            params![message_id, next],
        )
        .map_err(|e| e.to_string())?;
        let was_unread = (current_flags & FLAG_SEEN) == 0;
        let is_unread = (next & FLAG_SEEN) == 0;
        if was_unread != is_unread {
            let delta: i64 = if is_unread { 1 } else { -1 };
            tx.execute(
                "UPDATE mail_folders SET unread_count = MAX(0, unread_count + ?2) WHERE id = ?1",
                params![&folder_id, delta],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok((folder_id, uid, next))
    }

    pub fn remove_message_local(&self, message_id: &str) -> Result<(), String> {
        let conn = self.connect()?;
        conn.execute(
            "DELETE FROM mail_messages WHERE id = ?1",
            params![message_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Removes the moved message from the source folder cache, updates local total/unread
    /// counts on both folders, and clears the destination folder's `synced_at` so the next
    /// visit automatically fetches the newly assigned remote UID.
    pub fn record_message_moved_local(
        &self,
        message_id: &str,
        from_folder_id: &str,
        to_folder_id: &str,
    ) -> Result<(), String> {
        let mut conn = self.connect()?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let flags: Option<u32> = tx
            .query_row(
                "SELECT flags FROM mail_messages WHERE id = ?1",
                params![message_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let was_unread = flags.map(|bits| (bits & FLAG_SEEN) == 0).unwrap_or(false);
        let unread_delta: i64 = if was_unread { 1 } else { 0 };

        tx.execute(
            "DELETE FROM mail_messages WHERE id = ?1",
            params![message_id],
        )
        .map_err(|e| e.to_string())?;

        if flags.is_some() {
            tx.execute(
                "UPDATE mail_folders
                 SET total_count = MAX(0, total_count - 1),
                     unread_count = MAX(0, unread_count - ?2)
                 WHERE id = ?1",
                params![from_folder_id, unread_delta],
            )
            .map_err(|e| e.to_string())?;
            tx.execute(
                "UPDATE mail_folders
                 SET total_count = total_count + 1,
                     unread_count = unread_count + ?2,
                     synced_at = NULL
                 WHERE id = ?1",
                params![to_folder_id, unread_delta],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Removes locally cached messages in `folder_id` whose remote UIDs are no longer
    /// present on the IMAP server (deleted or moved on another device).
    pub fn prune_missing_uids(
        &self,
        folder_id: &str,
        present_uids: &[u32],
    ) -> Result<usize, String> {
        let mut conn = self.connect()?;
        let present: HashSet<u32> = present_uids.iter().copied().collect();
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let stale_ids: Vec<String> = {
            let mut stmt = tx
                .prepare("SELECT id, uid FROM mail_messages WHERE folder_id = ?1")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![folder_id], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, u32>(1)?))
                })
                .map_err(|e| e.to_string())?;
            let mut stale = Vec::new();
            for row in rows {
                let (id, uid) = row.map_err(|e| e.to_string())?;
                if !present.contains(&uid) {
                    stale.push(id);
                }
            }
            stale
        };
        let count = stale_ids.len();
        for id in stale_ids {
            tx.execute("DELETE FROM mail_messages WHERE id = ?1", params![id])
                .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(count)
    }

    /// Removes a permanently deleted message locally and decrements folder total/unread counts.
    pub fn record_message_deleted_local(
        &self,
        message_id: &str,
        folder_id: &str,
    ) -> Result<(), String> {
        let mut conn = self.connect()?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let flags: Option<u32> = tx
            .query_row(
                "SELECT flags FROM mail_messages WHERE id = ?1",
                params![message_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let was_unread = flags.map(|bits| (bits & FLAG_SEEN) == 0).unwrap_or(false);
        let unread_delta: i64 = if was_unread { 1 } else { 0 };

        tx.execute(
            "DELETE FROM mail_messages WHERE id = ?1",
            params![message_id],
        )
        .map_err(|e| e.to_string())?;

        if flags.is_some() {
            tx.execute(
                "UPDATE mail_folders
                 SET total_count = MAX(0, total_count - 1),
                     unread_count = MAX(0, unread_count - ?2)
                 WHERE id = ?1",
                params![folder_id, unread_delta],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Clears `synced_at` on a folder so the next visit or background sync re-fetches headers.
    pub fn invalidate_folder_sync(&self, folder_id: &str) -> Result<(), String> {
        let conn = self.connect()?;
        conn.execute(
            "UPDATE mail_folders SET synced_at = NULL WHERE id = ?1",
            params![folder_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_invite_state(
        &self,
        invite_id: &str,
        imported_object_id: Option<&str>,
        rsvp_status: Option<&str>,
    ) -> Result<(), String> {
        let conn = self.connect()?;
        conn.execute(
            "UPDATE mail_calendar_invites
             SET imported_object_id = COALESCE(?2, imported_object_id),
                 rsvp_status = COALESCE(?3, rsvp_status)
             WHERE id = ?1",
            params![invite_id, imported_object_id, rsvp_status],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_attachment_row(
        &self,
        attachment_id: &str,
    ) -> Result<(String, String, String, String, u64, Option<String>), String> {
        let conn = self.connect()?;
        conn.query_row(
            "SELECT message_id, part_id, filename, content_type, size_bytes, cache_path
             FROM mail_attachments WHERE id = ?1",
            params![attachment_id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get::<_, i64>(4)?.max(0) as u64,
                    r.get(5)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "找不到该附件".into())
    }

    pub fn save_attachment_bytes(
        &self,
        account_id: &str,
        attachment_id: &str,
        bytes: &[u8],
    ) -> Result<PathBuf, String> {
        let path = self.write_cache_blob(account_id, bytes)?;
        let conn = self.connect()?;
        let now = unix_timestamp_secs();
        conn.execute(
            "UPDATE mail_attachments SET cache_path = ?2, downloaded_at = ?3, size_bytes = ?4 WHERE id = ?1",
            params![
                attachment_id,
                path.to_string_lossy().to_string(),
                now,
                bytes.len() as i64
            ],
        )
        .map_err(|e| e.to_string())?;
        let _ = self.enforce_cache_budget(DEFAULT_CACHE_LIMIT_BYTES);
        Ok(path)
    }

    pub fn write_cache_blob(&self, account_id: &str, bytes: &[u8]) -> Result<PathBuf, String> {
        let account_dir = self.cache_dir.join(account_id);
        std::fs::create_dir_all(&account_dir).map_err(|e| e.to_string())?;
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        let digest = format!("{:x}", hasher.finalize());
        let path = account_dir.join(digest);
        if !path.exists() {
            std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
        }
        Ok(path)
    }

    pub fn delete_account_data(&self, account_id: &str) -> Result<(), String> {
        let conn = self.connect()?;
        conn.execute(
            "DELETE FROM mail_folders WHERE account_id = ?1",
            params![account_id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM mail_drafts WHERE account_id = ?1",
            params![account_id],
        )
        .map_err(|e| e.to_string())?;
        let account_cache = self.cache_dir.join(account_id);
        if account_cache.exists() {
            let _ = std::fs::remove_dir_all(account_cache);
        }
        Ok(())
    }

    pub fn cache_stats(&self) -> Result<MailCacheStats, String> {
        let conn = self.connect()?;
        let (message_count, cached_body_bytes): (i64, i64) = conn
            .query_row(
                "SELECT COUNT(*), COALESCE(SUM(body_size), 0) FROM mail_messages",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|e| e.to_string())?;
        let cached_attachment_bytes = dir_size(&self.cache_dir);
        Ok(MailCacheStats {
            message_count: message_count.max(0) as u64,
            cached_body_bytes: cached_body_bytes.max(0) as u64,
            cached_attachment_bytes,
            limit_bytes: DEFAULT_CACHE_LIMIT_BYTES,
        })
    }

    pub fn clear_cache(&self) -> Result<MailCacheStats, String> {
        let conn = self.connect()?;
        conn.execute(
            "UPDATE mail_messages SET body_fetched = 0, text_body = '', html_sanitized = '', body_size = 0",
            [],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE mail_attachments SET cache_path = NULL, downloaded_at = NULL",
            [],
        )
        .map_err(|e| e.to_string())?;
        if self.cache_dir.exists() {
            let _ = std::fs::remove_dir_all(&self.cache_dir);
        }
        std::fs::create_dir_all(&self.cache_dir).map_err(|e| e.to_string())?;
        self.cache_stats()
    }

    pub fn enforce_cache_budget(&self, limit_bytes: u64) -> Result<(), String> {
        let stats = self.cache_stats()?;
        let mut total = stats.cached_body_bytes + stats.cached_attachment_bytes;
        if total <= limit_bytes {
            return Ok(());
        }
        let conn = self.connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, body_size FROM mail_messages
                 WHERE body_fetched = 1
                 ORDER BY last_accessed_at ASC LIMIT 200",
            )
            .map_err(|e| e.to_string())?;
        let candidates: Vec<(String, u64)> = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?.max(0) as u64,
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        drop(stmt);

        for (msg_id, size) in candidates {
            if total <= limit_bytes {
                break;
            }
            let att_paths: Vec<String> = {
                let mut astmt = conn
                    .prepare(
                        "SELECT cache_path FROM mail_attachments WHERE message_id = ?1 AND cache_path IS NOT NULL",
                    )
                    .map_err(|e| e.to_string())?;
                let rows = astmt
                    .query_map(params![&msg_id], |r| r.get::<_, String>(0))
                    .map_err(|e| e.to_string())?;
                rows.collect::<Result<Vec<_>, _>>()
                    .map_err(|e| e.to_string())?
            };
            for path in att_paths {
                if let Ok(meta) = std::fs::metadata(&path) {
                    total = total.saturating_sub(meta.len());
                }
                let _ = std::fs::remove_file(&path);
            }
            let _ = conn.execute(
                "UPDATE mail_attachments SET cache_path = NULL, downloaded_at = NULL WHERE message_id = ?1",
                params![&msg_id],
            );
            let _ = conn.execute(
                "UPDATE mail_messages SET body_fetched = 0, text_body = '', html_sanitized = '', body_size = 0 WHERE id = ?1",
                params![&msg_id],
            );
            total = total.saturating_sub(size);
        }
        Ok(())
    }

    pub fn list_drafts(&self, account_id: Option<&str>) -> Result<Vec<MailDraft>, String> {
        let conn = self.connect()?;
        let sql = if account_id.is_some() {
            "SELECT id, account_id, to_json, cc_json, bcc_json, subject, markdown_body, in_reply_to, references_json, updated_at
             FROM mail_drafts WHERE account_id = ?1 ORDER BY updated_at DESC"
        } else {
            "SELECT id, account_id, to_json, cc_json, bcc_json, subject, markdown_body, in_reply_to, references_json, updated_at
             FROM mail_drafts ORDER BY updated_at DESC"
        };
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let mapper = |r: &rusqlite::Row<'_>| {
            Ok(MailDraft {
                id: r.get(0)?,
                account_id: r.get(1)?,
                to: serde_json::from_str(&r.get::<_, String>(2)?).unwrap_or_default(),
                cc: serde_json::from_str(&r.get::<_, String>(3)?).unwrap_or_default(),
                bcc: serde_json::from_str(&r.get::<_, String>(4)?).unwrap_or_default(),
                subject: r.get(5)?,
                markdown_body: r.get(6)?,
                in_reply_to: r.get(7)?,
                references: serde_json::from_str(&r.get::<_, String>(8)?).unwrap_or_default(),
                updated_at: r.get(9)?,
            })
        };
        let rows = if let Some(account_id) = account_id {
            stmt.query_map(params![account_id], mapper)
        } else {
            stmt.query_map([], mapper)
        }
        .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn save_draft(&self, mut draft: MailDraft) -> Result<MailDraft, String> {
        if draft.id.trim().is_empty() {
            draft.id = uuid::Uuid::new_v4().to_string();
        }
        draft.updated_at = unix_timestamp_secs();
        let conn = self.connect()?;
        conn.execute(
            "INSERT INTO mail_drafts (
                id, account_id, to_json, cc_json, bcc_json, subject, markdown_body,
                in_reply_to, references_json, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            ON CONFLICT(id) DO UPDATE SET
                account_id = excluded.account_id,
                to_json = excluded.to_json,
                cc_json = excluded.cc_json,
                bcc_json = excluded.bcc_json,
                subject = excluded.subject,
                markdown_body = excluded.markdown_body,
                in_reply_to = excluded.in_reply_to,
                references_json = excluded.references_json,
                updated_at = excluded.updated_at",
            params![
                &draft.id,
                &draft.account_id,
                serde_json::to_string(&draft.to).map_err(|e| e.to_string())?,
                serde_json::to_string(&draft.cc).map_err(|e| e.to_string())?,
                serde_json::to_string(&draft.bcc).map_err(|e| e.to_string())?,
                &draft.subject,
                &draft.markdown_body,
                &draft.in_reply_to,
                serde_json::to_string(&draft.references).map_err(|e| e.to_string())?,
                draft.updated_at,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(draft)
    }

    pub fn delete_draft(&self, draft_id: &str) -> Result<(), String> {
        let conn = self.connect()?;
        conn.execute("DELETE FROM mail_drafts WHERE id = ?1", params![draft_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    let version: i64 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if version > SCHEMA_VERSION {
        return Err("本地邮件数据库版本较新，请升级 Tano".into());
    }
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS mail_folders (
            id TEXT PRIMARY KEY,
            account_id TEXT NOT NULL,
            remote_name TEXT NOT NULL,
            display_name TEXT NOT NULL,
            special_use TEXT,
            delimiter TEXT,
            uid_validity INTEGER,
            uid_next INTEGER,
            unread_count INTEGER NOT NULL DEFAULT 0,
            total_count INTEGER NOT NULL DEFAULT 0,
            synced_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_mail_folders_account ON mail_folders(account_id);

        CREATE TABLE IF NOT EXISTS mail_messages (
            id TEXT PRIMARY KEY,
            account_id TEXT NOT NULL,
            folder_id TEXT NOT NULL REFERENCES mail_folders(id) ON DELETE CASCADE,
            uid INTEGER NOT NULL,
            message_id TEXT NOT NULL DEFAULT '',
            thread_key TEXT NOT NULL DEFAULT '',
            subject TEXT NOT NULL DEFAULT '',
            from_json TEXT NOT NULL DEFAULT '[]',
            to_json TEXT NOT NULL DEFAULT '[]',
            cc_json TEXT NOT NULL DEFAULT '[]',
            reply_to_json TEXT NOT NULL DEFAULT '[]',
            in_reply_to TEXT,
            references_json TEXT NOT NULL DEFAULT '[]',
            from_text TEXT NOT NULL DEFAULT '',
            to_text TEXT NOT NULL DEFAULT '',
            date_ts INTEGER NOT NULL DEFAULT 0,
            snippet TEXT NOT NULL DEFAULT '',
            flags INTEGER NOT NULL DEFAULT 0,
            has_attachments INTEGER NOT NULL DEFAULT 0,
            has_ics INTEGER NOT NULL DEFAULT 0,
            body_fetched INTEGER NOT NULL DEFAULT 0,
            text_body TEXT NOT NULL DEFAULT '',
            html_sanitized TEXT NOT NULL DEFAULT '',
            has_remote_images INTEGER NOT NULL DEFAULT 0,
            body_size INTEGER NOT NULL DEFAULT 0,
            last_accessed_at INTEGER NOT NULL DEFAULT 0
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_messages_folder_uid ON mail_messages(folder_id, uid);
        CREATE INDEX IF NOT EXISTS idx_mail_messages_folder_date ON mail_messages(folder_id, date_ts DESC);
        CREATE INDEX IF NOT EXISTS idx_mail_messages_account_date ON mail_messages(account_id, date_ts DESC);

        CREATE TABLE IF NOT EXISTS mail_attachments (
            id TEXT PRIMARY KEY,
            message_id TEXT NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
            part_id TEXT NOT NULL,
            filename TEXT NOT NULL,
            content_type TEXT NOT NULL,
            size_bytes INTEGER NOT NULL DEFAULT 0,
            cid TEXT,
            is_inline INTEGER NOT NULL DEFAULT 0,
            cache_path TEXT,
            downloaded_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_mail_attachments_msg ON mail_attachments(message_id);

        CREATE TABLE IF NOT EXISTS mail_calendar_invites (
            id TEXT PRIMARY KEY,
            message_id TEXT NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
            ics_uid TEXT NOT NULL,
            method TEXT NOT NULL,
            summary TEXT NOT NULL,
            raw_ics TEXT NOT NULL,
            imported_object_id TEXT,
            rsvp_status TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_mail_invites_msg ON mail_calendar_invites(message_id);

        CREATE TABLE IF NOT EXISTS mail_drafts (
            id TEXT PRIMARY KEY,
            account_id TEXT NOT NULL,
            to_json TEXT NOT NULL DEFAULT '[]',
            cc_json TEXT NOT NULL DEFAULT '[]',
            bcc_json TEXT NOT NULL DEFAULT '[]',
            subject TEXT NOT NULL DEFAULT '',
            markdown_body TEXT NOT NULL DEFAULT '',
            in_reply_to TEXT,
            references_json TEXT NOT NULL DEFAULT '[]',
            updated_at INTEGER NOT NULL DEFAULT 0
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS mail_messages_fts USING fts5(
            subject, from_text, to_text, text_body,
            content='mail_messages', content_rowid='rowid'
        );

        CREATE TRIGGER IF NOT EXISTS mail_messages_ai AFTER INSERT ON mail_messages BEGIN
            INSERT INTO mail_messages_fts(rowid, subject, from_text, to_text, text_body)
            VALUES (new.rowid, new.subject, new.from_text, new.to_text, new.text_body);
        END;
        CREATE TRIGGER IF NOT EXISTS mail_messages_ad AFTER DELETE ON mail_messages BEGIN
            INSERT INTO mail_messages_fts(mail_messages_fts, rowid, subject, from_text, to_text, text_body)
            VALUES ('delete', old.rowid, old.subject, old.from_text, old.to_text, old.text_body);
        END;
        CREATE TRIGGER IF NOT EXISTS mail_messages_au AFTER UPDATE OF subject, from_text, to_text, text_body ON mail_messages BEGIN
            INSERT INTO mail_messages_fts(mail_messages_fts, rowid, subject, from_text, to_text, text_body)
            VALUES ('delete', old.rowid, old.subject, old.from_text, old.to_text, old.text_body);
            INSERT INTO mail_messages_fts(rowid, subject, from_text, to_text, text_body)
            VALUES (new.rowid, new.subject, new.from_text, new.to_text, new.text_body);
        END;",
    )
    .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "user_version", SCHEMA_VERSION)
        .map_err(|e| e.to_string())?;
    ensure_mail_folders_delimiter_column(conn)?;
    Ok(())
}

fn ensure_mail_folders_delimiter_column(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(mail_folders)")
        .map_err(|e| e.to_string())?;
    let cols = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    if !cols.iter().any(|col| col == "delimiter") {
        conn.execute("ALTER TABLE mail_folders ADD COLUMN delimiter TEXT", [])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn map_folder_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MailFolder> {
    let remote_name: String = row.get(2)?;
    let decoded_path = decode_modified_utf7(&remote_name);
    Ok(MailFolder {
        id: row.get(0)?,
        account_id: row.get(1)?,
        remote_name,
        decoded_path,
        display_name: row.get(3)?,
        special_use: row.get(4)?,
        delimiter: row.get(5)?,
        uid_validity: row.get(6)?,
        uid_next: row.get(7)?,
        unread_count: row.get(8)?,
        total_count: row.get(9)?,
        synced_at: row.get(10)?,
    })
}

fn map_summary_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MailMessageSummary> {
    let from_raw: String = row.get(7)?;
    let to_raw: String = row.get(8)?;
    let flags: u32 = row.get(11)?;
    Ok(MailMessageSummary {
        id: row.get(0)?,
        account_id: row.get(1)?,
        folder_id: row.get(2)?,
        uid: row.get(3)?,
        message_id: row.get(4)?,
        thread_key: row.get(5)?,
        subject: row.get(6)?,
        from: serde_json::from_str(&from_raw).unwrap_or_default(),
        to: serde_json::from_str(&to_raw).unwrap_or_default(),
        date_ts: row.get(9)?,
        snippet: row.get(10)?,
        seen: (flags & FLAG_SEEN) != 0,
        flagged: (flags & FLAG_FLAGGED) != 0,
        answered: (flags & FLAG_ANSWERED) != 0,
        has_attachments: row.get::<_, i32>(12)? != 0,
        has_ics: row.get::<_, i32>(13)? != 0,
        body_fetched: row.get::<_, i32>(14)? != 0,
    })
}

fn format_addresses_text(items: &[MailAddress]) -> String {
    items
        .iter()
        .map(|a| {
            if a.name.is_empty() {
                a.address.clone()
            } else {
                format!("{} {}", a.name, a.address)
            }
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn sanitize_fts_query(input: &str) -> String {
    let tokens: Vec<String> = input
        .split_whitespace()
        .filter_map(|token| {
            let cleaned: String = token
                .chars()
                .filter(|c| !matches!(c, '"' | '\'' | '*' | '(' | ')' | ':' | '^' | '-'))
                .collect();
            if cleaned.is_empty() {
                None
            } else {
                Some(format!("\"{cleaned}\"*"))
            }
        })
        .collect();
    if tokens.is_empty() {
        "\"\"".into()
    } else {
        tokens.join(" AND ")
    }
}

fn dir_size(path: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    let mut total = 0u64;
    for entry in entries.flatten() {
        if let Ok(meta) = entry.metadata() {
            if meta.is_dir() {
                total = total.saturating_add(dir_size(&entry.path()));
            } else {
                total = total.saturating_add(meta.len());
            }
        }
    }
    total
}
