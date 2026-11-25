//! Device-local IMAP/SMTP mail client module for desktop Tano.

pub mod accounts;
pub mod commands;
pub mod imap_client;
pub mod mime;
pub mod smtp_client;
pub mod store;
pub mod types;

pub use commands::MailState;

#[cfg(test)]
mod tests {
    use super::mime::{decode_modified_utf7, parse_rfc822_body, sanitize_email_html};
    use super::store::{FolderUpsert, HeaderUpsert, MailStore};
    use super::types::{
        mail_presets, validate_email_address, validate_host_and_port, MailAddress, MailDraft,
        FLAG_FLAGGED, FLAG_SEEN,
    };
    use std::collections::HashMap;
    use tempfile::tempdir;

    #[test]
    fn validates_hosts_and_blocks_loopback_or_link_local() {
        assert!(validate_host_and_port("imap.qq.com", 993, "IMAP").is_ok());
        assert!(validate_host_and_port("imap.gmail.com", 993, "IMAP").is_ok());
        assert!(validate_host_and_port("127.0.0.1", 993, "IMAP").is_err());
        assert!(validate_host_and_port("::1", 993, "IMAP").is_err());
        assert!(validate_host_and_port("169.254.169.254", 993, "IMAP").is_err());
        assert!(validate_host_and_port("localhost", 993, "IMAP").is_err());
        assert!(validate_host_and_port("https://imap.qq.com", 993, "IMAP").is_err());
        assert!(validate_host_and_port("imap.qq.com", 0, "IMAP").is_err());

        assert!(validate_email_address("alice@qq.com").is_ok());
        assert!(validate_email_address("bad-email").is_err());
        assert!(validate_email_address("alice@qq.com\r\nBcc: evil@x.com").is_err());
    }

    #[test]
    fn decodes_modified_utf7_chinese_folder_names() {
        assert_eq!(decode_modified_utf7("INBOX"), "INBOX");
        assert_eq!(decode_modified_utf7("&XfJT0ZAB-"), "已发送");
        assert_eq!(decode_modified_utf7("&UXZO1mWHTvZZOQ-"), "其他文件夹");
        assert_eq!(decode_modified_utf7("&g0l6P3ux-"), "草稿箱");
        assert_eq!(decode_modified_utf7("Work &- Life"), "Work & Life");
    }

    #[test]
    fn sanitizes_html_and_blocks_remote_tracking_images() {
        let raw = r#"
            <div>
                <p onclick="alert(1)">Hello</p>
                <script>window.evil = true;</script>
                <iframe src="https://evil.example"></iframe>
                <a href="javascript:alert(1)">Bad</a>
                <a href="https://tano.page">Good</a>
                <img src="https://tracker.example/pixel.gif" alt="px" />
                <img src="cid:inline-logo" alt="logo" />
            </div>
        "#;
        let mut cids = HashMap::new();
        cids.insert(
            "inline-logo".to_string(),
            "data:image/png;base64,AAAA".to_string(),
        );
        let (clean, has_remote) = sanitize_email_html(raw, &cids);
        assert!(has_remote);
        assert!(!clean.contains("<script"));
        assert!(!clean.contains("<iframe"));
        assert!(!clean.contains("onclick"));
        assert!(!clean.contains("javascript:"));
        assert!(!clean.contains(" src=\"https://tracker.example/pixel.gif\""));
        assert!(clean.contains("data-tano-remote-src=\"https://tracker.example/pixel.gif\""));
        assert!(clean.contains("src=\"data:image/png;base64,AAAA\""));
        assert!(clean.contains("https://tano.page"));
    }

    #[test]
    fn parses_mime_with_ics_calendar_invitation() {
        let raw = concat!(
            "From: Alice <alice@example.com>\r\n",
            "To: Bob <bob@example.com>\r\n",
            "Subject: Weekly Sync\r\n",
            "MIME-Version: 1.0\r\n",
            "Content-Type: multipart/mixed; boundary=\"BOUND\"\r\n",
            "\r\n",
            "--BOUND\r\n",
            "Content-Type: text/plain; charset=utf-8\r\n",
            "\r\n",
            "Please join the weekly sync.\r\n",
            "--BOUND\r\n",
            "Content-Type: text/calendar; charset=utf-8; method=REQUEST; name=\"invite.ics\"\r\n",
            "Content-Disposition: attachment; filename=\"invite.ics\"\r\n",
            "\r\n",
            "BEGIN:VCALENDAR\r\n",
            "VERSION:2.0\r\n",
            "METHOD:REQUEST\r\n",
            "BEGIN:VEVENT\r\n",
            "UID:sync-2026-001@example.com\r\n",
            "SUMMARY:Tano Architecture Review\r\n",
            "DTSTART:20261126T020000Z\r\n",
            "DTEND:20261126T030000Z\r\n",
            "END:VEVENT\r\n",
            "END:VCALENDAR\r\n",
            "--BOUND--\r\n"
        );
        let parsed = parse_rfc822_body(raw.as_bytes());
        assert!(parsed.text_body.contains("weekly sync"));
        assert_eq!(parsed.invites.len(), 1);
        assert_eq!(parsed.invites[0].ics_uid, "sync-2026-001@example.com");
        assert_eq!(parsed.invites[0].method, "REQUEST");
        assert_eq!(parsed.invites[0].summary, "Tano Architecture Review");
    }

    #[test]
    fn sqlite_store_handles_sync_search_flags_drafts_and_cleanup() {
        let dir = tempdir().expect("tempdir");
        let store = MailStore::open(dir.path()).expect("open store");
        let account_id = "11111111-1111-4111-8111-111111111111";

        let folders = store
            .upsert_folders(
                account_id,
                &[
                    FolderUpsert {
                        remote_name: "INBOX".into(),
                        display_name: "收件箱".into(),
                        special_use: Some("inbox".into()),
                        uid_validity: Some(42),
                        uid_next: Some(10),
                        unread_count: 1,
                        total_count: 1,
                    },
                    FolderUpsert {
                        remote_name: "Sent".into(),
                        display_name: "已发送".into(),
                        special_use: Some("sent".into()),
                        uid_validity: Some(43),
                        uid_next: Some(1),
                        unread_count: 0,
                        total_count: 0,
                    },
                ],
            )
            .expect("upsert folders");
        assert_eq!(folders.len(), 2);
        let inbox = &folders[0];
        assert_eq!(inbox.special_use.as_deref(), Some("inbox"));

        let added = store
            .upsert_headers(
                account_id,
                &inbox.id,
                Some(42),
                Some(11),
                1,
                1,
                &[HeaderUpsert {
                    uid: 10,
                    message_id: "msg-10@example.com".into(),
                    thread_key: "msg-10@example.com".into(),
                    subject: "项目周会邀请".into(),
                    from: vec![MailAddress {
                        name: "Alice".into(),
                        address: "alice@example.com".into(),
                    }],
                    to: vec![MailAddress {
                        name: "Bob".into(),
                        address: "bob@qq.com".into(),
                    }],
                    cc: vec![],
                    reply_to: vec![],
                    in_reply_to: None,
                    references: vec![],
                    date_ts: 1_764_000_000,
                    snippet: "本周四下午三点开会".into(),
                    flags: 0,
                    has_attachments: false,
                    has_ics: true,
                }],
            )
            .expect("upsert headers");
        assert_eq!(added, 1);

        let found = store
            .search_messages(Some(account_id), "周会", 20)
            .expect("fts search");
        assert_eq!(found.len(), 1);
        let msg_id = found[0].id.clone();

        let (_, _, flags) = store
            .update_flags_local(&msg_id, Some(true), Some(true))
            .expect("update flags");
        assert_eq!(flags, FLAG_SEEN | FLAG_FLAGGED);

        let updated_inbox = store.get_folder(&inbox.id).expect("get folder");
        assert_eq!(updated_inbox.unread_count, 0);

        let draft = store
            .save_draft(MailDraft {
                id: String::new(),
                account_id: account_id.into(),
                to: vec!["alice@example.com".into()],
                cc: vec![],
                bcc: vec![],
                subject: "回复：周会".into(),
                markdown_body: "好的，我会准时参加。".into(),
                in_reply_to: Some("msg-10@example.com".into()),
                references: vec!["msg-10@example.com".into()],
                updated_at: 0,
            })
            .expect("save draft");
        assert_eq!(store.list_drafts(Some(account_id)).unwrap().len(), 1);
        store.delete_draft(&draft.id).expect("delete draft");
        assert_eq!(store.list_drafts(Some(account_id)).unwrap().len(), 0);

        store
            .delete_account_data(account_id)
            .expect("cascade delete");
        assert!(store.list_folders(Some(account_id)).unwrap().is_empty());
        assert!(mail_presets()
            .iter()
            .any(|p| p.id == "qq" && p.imap_port == 993));
        assert!(mail_presets()
            .iter()
            .any(|p| p.id == "netease-163" && p.send_imap_id));
        assert!(mail_presets().iter().any(|p| p.id == "gmail"));
    }
}
