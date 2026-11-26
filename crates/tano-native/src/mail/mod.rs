//! Device-local IMAP/SMTP mail client module for desktop Tano.

pub mod accounts;
pub mod commands;
pub mod folders;
pub mod imap_client;
pub mod mime;
pub mod oauth;
pub mod smtp_client;
pub mod store;
pub mod types;

pub use commands::MailState;

#[cfg(test)]
mod tests {
    use super::folders::{
        classify_remote_folders, normalize_cached_folders, RemoteFolderCandidate,
    };
    use super::imap_client::Xoauth2Authenticator;
    use super::mime::{decode_modified_utf7, parse_rfc822_body, sanitize_email_html};
    use super::oauth::{
        build_authorize_url, build_pkce_pair, parse_id_token_claims, resolve_microsoft_config,
        token_needs_refresh, validate_client_id, validate_loopback_redirect_uri, validate_tenant,
        MicrosoftOAuthConfig,
    };
    use super::store::{FolderUpsert, HeaderUpsert, MailStore};
    use super::types::{
        mail_presets, mail_presets_with_oauth, validate_email_address, validate_host_and_port,
        AppendSentPolicy, MailAddress, MailAuthKind, MailCredentials, MailDraft, MailFolder,
        TlsMode, FLAG_FLAGGED, FLAG_SEEN,
    };
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    use imap::Authenticator;
    use imap_proto::NameAttribute;
    use sha2::{Digest, Sha256};
    use std::borrow::Cow;
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
                        delimiter: Some("/".into()),
                        uid_validity: Some(42),
                        uid_next: Some(10),
                        unread_count: 1,
                        total_count: 1,
                    },
                    FolderUpsert {
                        remote_name: "Sent".into(),
                        display_name: "已发送".into(),
                        special_use: Some("sent".into()),
                        delimiter: Some("/".into()),
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
        let presets = mail_presets();
        assert_eq!(presets.len(), 8);
        assert!(presets.iter().any(|p| p.id == "qq" && p.imap_port == 993));
        assert!(presets.iter().any(|p| p.id == "netease-163"
            && p.send_imap_id
            && p.append_sent == AppendSentPolicy::Never));
        assert!(presets.iter().any(|p| p.id == "netease-126"
            && p.send_imap_id
            && p.append_sent == AppendSentPolicy::Never));
        assert!(presets.iter().any(|p| {
            p.id == "outlook"
                && p.auth_kind == MailAuthKind::Oauth2Microsoft
                && p.imap_host == "outlook.office365.com"
                && p.smtp_host == "smtp.office365.com"
                && p.smtp_port == 587
                && p.smtp_tls == TlsMode::Starttls
                && p.append_sent == AppendSentPolicy::Never
                && !p.oauth_configured
        }));
        assert!(mail_presets_with_oauth(true)
            .iter()
            .any(|p| p.id == "outlook" && p.oauth_configured));
        assert!(presets.iter().any(|p| p.id == "gmail"));
        assert!(presets
            .iter()
            .any(|p| p.id == "yahoo" && p.imap_host == "imap.mail.yahoo.com"));
    }

    #[test]
    fn outlook_xoauth2_and_pkce_helpers_behave_safely() {
        // 1. XOAUTH2 SASL string and error-challenge empty acknowledgement
        let auth = Xoauth2Authenticator::new("alice@outlook.com", "tok_123");
        assert_eq!(
            auth.process(&[]),
            "user=alice@outlook.com\x01auth=Bearer tok_123\x01\x01"
        );
        assert_eq!(auth.process(b"{\"status\":\"401\"}"), "");

        // 2. PKCE S256 verifier / challenge pair
        let (verifier, challenge) = build_pkce_pair();
        assert_eq!(verifier.len(), 64);
        assert_eq!(
            challenge,
            URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
        );

        // 3. Validation rules for client_id, tenant, loopback redirect URI
        assert!(validate_client_id("12345678-1234-1234-1234-123456789abc").is_ok());
        assert!(validate_client_id("bad/id").is_err());
        assert_eq!(validate_tenant("").unwrap(), "common");
        assert_eq!(validate_tenant("consumers").unwrap(), "consumers");
        assert!(validate_tenant("../evil").is_err());
        assert!(validate_loopback_redirect_uri("http://localhost").is_ok());
        assert!(validate_loopback_redirect_uri("http://127.0.0.1:43845/callback").is_ok());
        assert!(validate_loopback_redirect_uri("https://evil.example/cb").is_err());
        assert!(validate_loopback_redirect_uri("http://localhost:8080/cb?x=1").is_err());

        // 4. Authorize URL structure
        let cfg = MicrosoftOAuthConfig {
            client_id: "test-client-id".into(),
            tenant: "common".into(),
            redirect_uri: "http://localhost".into(),
        };
        let url = build_authorize_url(
            &cfg,
            "http://localhost:54321/",
            "state-xyz",
            &challenge,
            Some("alice@outlook.com"),
        )
        .expect("authorize url");
        assert!(url.starts_with("https://login.microsoftonline.com/common/oauth2/v2.0/authorize?"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains("IMAP.AccessAsUser.All"));
        assert!(url.contains("SMTP.Send"));
        assert!(url.contains("login_hint=alice%40outlook.com"));

        // 5. ID token JWT payload claim parsing
        let payload = URL_SAFE_NO_PAD
            .encode(r#"{"preferred_username":"alice@outlook.com","name":"Alice Wang"}"#);
        let claims = parse_id_token_claims(&format!("header.{payload}.sig"));
        assert_eq!(claims.email.as_deref(), Some("alice@outlook.com"));
        assert_eq!(claims.display_name.as_deref(), Some("Alice Wang"));
        assert_eq!(parse_id_token_claims("not-a-jwt").email, None);

        // 6. Token refresh skew check
        let fresh = MailCredentials {
            username: "alice@outlook.com".into(),
            access_token: Some("tok".into()),
            expires_at: Some(2_000),
            ..MailCredentials::default()
        };
        assert!(!token_needs_refresh(&fresh, 1_500));
        assert!(token_needs_refresh(&fresh, 1_900));
        assert!(token_needs_refresh(&MailCredentials::default(), 1_500));

        // 7. Config file resolution + explicit override
        let dir = tempdir().expect("tempdir");
        std::fs::write(
            dir.path().join("mail-oauth.json"),
            r#"{"outlook":{"clientId":"file-client-123","tenant":"consumers"}}"#,
        )
        .expect("write mail-oauth.json");
        let resolved = resolve_microsoft_config(Some(dir.path()), None, None).expect("resolved");
        assert_eq!(resolved.client_id, "file-client-123");
        assert_eq!(resolved.tenant, "consumers");
        let overridden = resolve_microsoft_config(
            Some(dir.path()),
            Some("ui-client-456"),
            Some("organizations"),
        )
        .expect("overridden");
        assert_eq!(overridden.client_id, "ui-client-456");
        assert_eq!(overridden.tenant, "organizations");
    }

    #[test]
    fn accounts_registry_persists_atomically_in_app_data() {
        use super::accounts::{get_account, list_accounts, write_accounts_map};
        use super::types::MailAccount;
        use std::collections::BTreeMap;

        let dir = tempdir().expect("tempdir");
        let account_id = "22222222-2222-4222-8222-222222222222".to_string();
        let mut map = BTreeMap::new();
        map.insert(
            account_id.clone(),
            MailAccount {
                id: account_id.clone(),
                provider: "outlook".into(),
                label: "Outlook".into(),
                email: "alice@outlook.com".into(),
                display_name: "Alice".into(),
                auth_kind: MailAuthKind::Oauth2Microsoft,
                oauth_client_id: Some("4397e6d7-0c2a-468a-8422-7ba9fe9197b4".into()),
                oauth_tenant: Some("common".into()),
                imap_host: "outlook.office365.com".into(),
                imap_port: 993,
                imap_tls: TlsMode::Tls,
                smtp_host: "smtp.office365.com".into(),
                smtp_port: 587,
                smtp_tls: TlsMode::Starttls,
                append_sent: AppendSentPolicy::Never,
                send_imap_id: false,
                created_at: 1_764_000_000,
            },
        );

        // Creating mail-accounts.json from scratch must succeed.
        write_accounts_map(dir.path(), &map).expect("create mail-accounts.json");
        let listed = list_accounts(dir.path()).expect("list accounts");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].email, "alice@outlook.com");

        // Updating an existing mail-accounts.json must atomically replace it.
        map.get_mut(&account_id).unwrap().label = "Work Outlook".into();
        write_accounts_map(dir.path(), &map).expect("update mail-accounts.json");
        let fetched = get_account(dir.path(), &account_id).expect("get account");
        assert_eq!(fetched.label, "Work Outlook");
    }

    #[test]
    fn classifies_outlook_folders_hides_sync_issues_and_recognizes_archive_and_notes() {
        let candidates = [
            RemoteFolderCandidate {
                remote_name: "INBOX",
                decoded_path: "INBOX".into(),
                delimiter: Some("/".into()),
                attributes: &[],
            },
            RemoteFolderCandidate {
                remote_name: "Sent",
                decoded_path: "Sent".into(),
                delimiter: Some("/".into()),
                attributes: &[NameAttribute::Sent],
            },
            RemoteFolderCandidate {
                remote_name: "Drafts",
                decoded_path: "Drafts".into(),
                delimiter: Some("/".into()),
                attributes: &[NameAttribute::Drafts],
            },
            RemoteFolderCandidate {
                remote_name: "Junk",
                decoded_path: "Junk".into(),
                delimiter: Some("/".into()),
                attributes: &[NameAttribute::Junk],
            },
            // Extra custom folder with same name-fallback word should not steal Junk role.
            RemoteFolderCandidate {
                remote_name: "Spam",
                decoded_path: "Spam".into(),
                delimiter: Some("/".into()),
                attributes: &[],
            },
            RemoteFolderCandidate {
                remote_name: "Deleted",
                decoded_path: "Deleted".into(),
                delimiter: Some("/".into()),
                attributes: &[NameAttribute::Trash],
            },
            RemoteFolderCandidate {
                remote_name: "Deleted/POP",
                decoded_path: "Deleted/POP".into(),
                delimiter: Some("/".into()),
                attributes: &[],
            },
            RemoteFolderCandidate {
                remote_name: "Notes",
                decoded_path: "Notes".into(),
                delimiter: Some("/".into()),
                attributes: &[],
            },
            RemoteFolderCandidate {
                remote_name: "Outbox",
                decoded_path: "Outbox".into(),
                delimiter: Some("/".into()),
                attributes: &[],
            },
            RemoteFolderCandidate {
                remote_name: "&VAxrZX7f9Jg-",
                decoded_path: "同步问题".into(),
                delimiter: Some("/".into()),
                attributes: &[],
            },
            RemoteFolderCandidate {
                remote_name: "&VAxrZX7f9Jg-/&UhF6gQ-",
                decoded_path: "同步问题/冲突".into(),
                delimiter: Some("/".into()),
                attributes: &[],
            },
            RemoteFolderCandidate {
                remote_name: "&VAxrZX7f9Jg-/&Z1lWb1ZoZUV6nA-",
                decoded_path: "同步问题/服务器故障".into(),
                delimiter: Some("/".into()),
                attributes: &[],
            },
            RemoteFolderCandidate {
                remote_name: "&VAxrZX7f9Jg-/&ZyycXWZFeZw-",
                decoded_path: "同步问题/本地故障".into(),
                delimiter: Some("/".into()),
                attributes: &[],
            },
            RemoteFolderCandidate {
                remote_name: "&W1hoYw-",
                decoded_path: "存档".into(),
                delimiter: Some("/".into()),
                attributes: &[],
            },
        ];

        let classified = classify_remote_folders(&candidates);
        assert!(
            !classified
                .iter()
                .any(|f| f.decoded_path.starts_with("同步问题")),
            "Sync Issues diagnostic folders must be skipped"
        );

        let archive = classified
            .iter()
            .find(|f| f.decoded_path == "存档")
            .expect("Chinese Outlook 存档 folder");
        assert_eq!(archive.special_use.as_deref(), Some("archive"));
        assert_eq!(archive.display_name, "归档");

        let notes = classified
            .iter()
            .find(|f| f.decoded_path == "Notes")
            .expect("Notes folder");
        assert_eq!(notes.special_use.as_deref(), Some("notes"));
        assert_eq!(notes.display_name, "便签");

        let outbox = classified
            .iter()
            .find(|f| f.decoded_path == "Outbox")
            .expect("Outbox folder");
        assert!(outbox.hide_when_empty);
        assert_eq!(outbox.special_use, None);

        let pop = classified
            .iter()
            .find(|f| f.decoded_path == "Deleted/POP")
            .expect("Deleted/POP subfolder");
        assert_eq!(pop.special_use, None);
        assert!(!pop.hide_when_empty);

        let extra_spam = classified
            .iter()
            .find(|f| f.decoded_path == "Spam")
            .expect("custom Spam folder");
        assert_eq!(
            extra_spam.special_use, None,
            "second junk-like folder must not duplicate server-marked Junk"
        );
    }

    #[test]
    fn classifies_gmail_qq_netease_yahoo_icloud_and_dot_namespace_folders() {
        // Gmail with [Gmail] container, \Important extension, and user subfolder Work/Archive
        let gmail = [
            RemoteFolderCandidate {
                remote_name: "INBOX",
                decoded_path: "INBOX".into(),
                delimiter: Some("/".into()),
                attributes: &[],
            },
            RemoteFolderCandidate {
                remote_name: "[Gmail]",
                decoded_path: "[Gmail]".into(),
                delimiter: Some("/".into()),
                attributes: &[NameAttribute::NoSelect],
            },
            RemoteFolderCandidate {
                remote_name: "[Gmail]/All Mail",
                decoded_path: "[Gmail]/All Mail".into(),
                delimiter: Some("/".into()),
                attributes: &[NameAttribute::All],
            },
            RemoteFolderCandidate {
                remote_name: "[Gmail]/Important",
                decoded_path: "[Gmail]/Important".into(),
                delimiter: Some("/".into()),
                attributes: &[NameAttribute::Extension(Cow::Borrowed("\\Important"))],
            },
            RemoteFolderCandidate {
                remote_name: "[Gmail]/Chats",
                decoded_path: "[Gmail]/Chats".into(),
                delimiter: Some("/".into()),
                attributes: &[],
            },
            RemoteFolderCandidate {
                remote_name: "Work/Archive",
                decoded_path: "Work/Archive".into(),
                delimiter: Some("/".into()),
                attributes: &[],
            },
        ];
        let gmail_out = classify_remote_folders(&gmail);
        assert!(!gmail_out.iter().any(|f| f.remote_name == "[Gmail]"));
        assert_eq!(
            gmail_out
                .iter()
                .find(|f| f.remote_name == "[Gmail]/Important")
                .and_then(|f| f.special_use.as_deref()),
            Some("important")
        );
        let gmail_chats = gmail_out
            .iter()
            .find(|f| f.remote_name == "[Gmail]/Chats")
            .expect("Gmail Chats");
        assert!(gmail_chats.hide_when_empty);
        assert_eq!(gmail_chats.display_name, "聊天记录");
        // Subfolder `Work/Archive` must NOT be misclassified as account Archive!
        let work_archive = gmail_out
            .iter()
            .find(|f| f.remote_name == "Work/Archive")
            .expect("Work/Archive");
        assert_eq!(work_archive.special_use, None);

        // QQ Mail + NetEase 163/126 + Yahoo + iCloud quirks
        let cn_and_global = [
            RemoteFolderCandidate {
                remote_name: "INBOX",
                decoded_path: "INBOX".into(),
                delimiter: Some("/".into()),
                attributes: &[],
            },
            RemoteFolderCandidate {
                remote_name: "Bulk Mail",
                decoded_path: "Bulk Mail".into(),
                delimiter: Some("/".into()),
                attributes: &[],
            },
            RemoteFolderCandidate {
                remote_name: "&dcVr0mWHTvZZOQ-",
                decoded_path: "病毒文件夹".into(),
                delimiter: Some("/".into()),
                attributes: &[],
            },
            RemoteFolderCandidate {
                remote_name: "&UXZO1mWHTvZZOQ-/&bwJt1HQb-",
                decoded_path: "其他文件夹/漂流瓶".into(),
                delimiter: Some("/".into()),
                attributes: &[],
            },
            RemoteFolderCandidate {
                remote_name: "已归档",
                decoded_path: "已归档".into(),
                delimiter: Some("/".into()),
                attributes: &[],
            },
            RemoteFolderCandidate {
                remote_name: "Apple Mail To Do",
                decoded_path: "Apple Mail To Do".into(),
                delimiter: Some("/".into()),
                attributes: &[],
            },
        ];
        let cn_out = classify_remote_folders(&cn_and_global);
        assert_eq!(
            cn_out
                .iter()
                .find(|f| f.remote_name == "Bulk Mail")
                .and_then(|f| f.special_use.as_deref()),
            Some("junk")
        );
        assert!(
            cn_out
                .iter()
                .find(|f| f.decoded_path == "病毒文件夹")
                .unwrap()
                .hide_when_empty
        );
        assert!(
            cn_out
                .iter()
                .find(|f| f.decoded_path == "其他文件夹/漂流瓶")
                .unwrap()
                .hide_when_empty
        );
        assert_eq!(
            cn_out
                .iter()
                .find(|f| f.decoded_path == "已归档")
                .and_then(|f| f.special_use.as_deref()),
            Some("archive")
        );
        assert!(
            cn_out
                .iter()
                .find(|f| f.decoded_path == "Apple Mail To Do")
                .unwrap()
                .hide_when_empty
        );

        // Courier / Cyrus dot delimiter with INBOX. namespace
        let dot_ns = [
            RemoteFolderCandidate {
                remote_name: "INBOX",
                decoded_path: "INBOX".into(),
                delimiter: Some(".".into()),
                attributes: &[],
            },
            RemoteFolderCandidate {
                remote_name: "INBOX.Sent",
                decoded_path: "INBOX.Sent".into(),
                delimiter: Some(".".into()),
                attributes: &[],
            },
            RemoteFolderCandidate {
                remote_name: "INBOX.Work.Sent",
                decoded_path: "INBOX.Work.Sent".into(),
                delimiter: Some(".".into()),
                attributes: &[],
            },
        ];
        let dot_out = classify_remote_folders(&dot_ns);
        assert_eq!(
            dot_out
                .iter()
                .find(|f| f.remote_name == "INBOX.Sent")
                .and_then(|f| f.special_use.as_deref()),
            Some("sent")
        );
        assert_eq!(
            dot_out
                .iter()
                .find(|f| f.remote_name == "INBOX.Work.Sent")
                .and_then(|f| f.special_use.as_deref()),
            None
        );
    }

    #[test]
    fn normalizes_legacy_cached_outlook_folders_before_resync() {
        let make =
            |remote: &str, decoded: &str, display: &str, special: Option<&str>, total: u32| {
                MailFolder {
                    id: format!("id-{remote}"),
                    account_id: "acc-1".into(),
                    remote_name: remote.into(),
                    decoded_path: decoded.into(),
                    display_name: display.into(),
                    special_use: special.map(str::to_string),
                    delimiter: None,
                    uid_validity: None,
                    uid_next: None,
                    unread_count: 0,
                    total_count: total,
                    synced_at: None,
                }
            };

        let cached = vec![
            make("INBOX", "INBOX", "收件箱", Some("inbox"), 70),
            make("Deleted", "Deleted", "已删除", Some("trash"), 2),
            make("Deleted/POP", "Deleted/POP", "Deleted/POP", None, 0),
            make("Notes", "Notes", "Notes", None, 0),
            make("Outbox", "Outbox", "Outbox", None, 0),
            make("sync-root", "同步问题", "同步问题", None, 3),
            make("sync-child", "同步问题/冲突", "同步问题/冲突", None, 1),
            make("archive-cn", "存档", "存档", None, 5),
        ];

        let normalized = normalize_cached_folders(cached);
        let paths: Vec<&str> = normalized.iter().map(|f| f.decoded_path.as_str()).collect();
        assert_eq!(
            paths,
            vec!["INBOX", "存档", "Deleted", "Notes", "Deleted/POP"]
        );
        assert_eq!(normalized[1].special_use.as_deref(), Some("archive"));
        assert_eq!(normalized[1].display_name, "归档");
        assert_eq!(normalized[3].special_use.as_deref(), Some("notes"));
        assert_eq!(normalized[3].display_name, "便签");
    }

    #[test]
    fn tracks_folder_synced_at_only_after_header_sync_and_invalidates_move_target() {
        let dir = tempdir().expect("tempdir");
        let store = MailStore::open(dir.path()).expect("open store");
        let account_id = "33333333-3333-4333-8333-333333333333";

        let folders = store
            .upsert_folders(
                account_id,
                &[
                    FolderUpsert {
                        remote_name: "INBOX".into(),
                        display_name: "收件箱".into(),
                        special_use: Some("inbox".into()),
                        delimiter: Some("/".into()),
                        uid_validity: Some(1),
                        uid_next: Some(2),
                        unread_count: 1,
                        total_count: 1,
                    },
                    FolderUpsert {
                        remote_name: "Work".into(),
                        display_name: "Work".into(),
                        special_use: None,
                        delimiter: Some("/".into()),
                        uid_validity: Some(2),
                        uid_next: Some(1),
                        unread_count: 0,
                        total_count: 0,
                    },
                ],
            )
            .expect("upsert folders");
        // Freshly discovered folders have never had message headers synced.
        assert!(folders.iter().all(|f| f.synced_at.is_none()));

        let inbox = folders.iter().find(|f| f.remote_name == "INBOX").unwrap();
        let work = folders.iter().find(|f| f.remote_name == "Work").unwrap();

        // Syncing headers sets `synced_at` on both folders.
        store
            .upsert_headers(
                account_id,
                &inbox.id,
                Some(1),
                Some(2),
                1,
                1,
                &[HeaderUpsert {
                    uid: 1,
                    message_id: "m1@example.com".into(),
                    thread_key: "m1@example.com".into(),
                    subject: "报销单".into(),
                    from: vec![],
                    to: vec![],
                    cc: vec![],
                    reply_to: vec![],
                    in_reply_to: None,
                    references: vec![],
                    date_ts: 1_764_000_000,
                    snippet: String::new(),
                    flags: 0,
                    has_attachments: false,
                    has_ics: false,
                }],
            )
            .expect("upsert inbox headers");
        store
            .upsert_headers(account_id, &work.id, Some(2), Some(1), 0, 0, &[])
            .expect("upsert work headers");
        assert!(store.get_folder(&inbox.id).unwrap().synced_at.is_some());
        assert!(store.get_folder(&work.id).unwrap().synced_at.is_some());

        // Subsequent metadata upsert preserves existing `synced_at`.
        store
            .upsert_folders(
                account_id,
                &[
                    FolderUpsert {
                        remote_name: "INBOX".into(),
                        display_name: "收件箱".into(),
                        special_use: Some("inbox".into()),
                        delimiter: Some("/".into()),
                        uid_validity: Some(1),
                        uid_next: Some(2),
                        unread_count: 1,
                        total_count: 1,
                    },
                    FolderUpsert {
                        remote_name: "Work".into(),
                        display_name: "Work".into(),
                        special_use: None,
                        delimiter: Some("/".into()),
                        uid_validity: Some(2),
                        uid_next: Some(1),
                        unread_count: 0,
                        total_count: 0,
                    },
                ],
            )
            .expect("refresh folder metadata");
        assert!(store.get_folder(&work.id).unwrap().synced_at.is_some());

        // Moving the unread message updates both counts and invalidates target `synced_at`.
        let msg_id = MailStore::message_row_id(&inbox.id, 1);
        store
            .record_message_moved_local(&msg_id, &inbox.id, &work.id)
            .expect("record move");

        let inbox_after = store.get_folder(&inbox.id).unwrap();
        let work_after = store.get_folder(&work.id).unwrap();
        assert_eq!(inbox_after.total_count, 0);
        assert_eq!(inbox_after.unread_count, 0);
        assert_eq!(work_after.total_count, 1);
        assert_eq!(work_after.unread_count, 1);
        assert!(work_after.synced_at.is_none());
    }

    #[test]
    fn prunes_remotely_deleted_uids_deletes_permanently_and_queries_unified_inbox() {
        let dir = tempdir().expect("tempdir");
        let store = MailStore::open(dir.path()).expect("open store");
        let acc1 = "44444444-4444-4444-8444-444444444441";
        let acc2 = "44444444-4444-4444-8444-444444444442";

        let f1 = store
            .upsert_folders(
                acc1,
                &[
                    FolderUpsert {
                        remote_name: "INBOX".into(),
                        display_name: "收件箱".into(),
                        special_use: Some("inbox".into()),
                        delimiter: Some("/".into()),
                        uid_validity: Some(1),
                        uid_next: Some(3),
                        unread_count: 2,
                        total_count: 2,
                    },
                    FolderUpsert {
                        remote_name: "Sent".into(),
                        display_name: "已发送".into(),
                        special_use: Some("sent".into()),
                        delimiter: Some("/".into()),
                        uid_validity: Some(1),
                        uid_next: Some(2),
                        unread_count: 0,
                        total_count: 1,
                    },
                ],
            )
            .expect("acc1 folders");
        let f2 = store
            .upsert_folders(
                acc2,
                &[FolderUpsert {
                    remote_name: "INBOX".into(),
                    display_name: "收件箱".into(),
                    special_use: Some("inbox".into()),
                    delimiter: Some("/".into()),
                    uid_validity: Some(1),
                    uid_next: Some(2),
                    unread_count: 1,
                    total_count: 1,
                }],
            )
            .expect("acc2 folders");

        let inbox1 = f1
            .iter()
            .find(|f| f.special_use.as_deref() == Some("inbox"))
            .unwrap();
        let sent1 = f1
            .iter()
            .find(|f| f.special_use.as_deref() == Some("sent"))
            .unwrap();
        let inbox2 = &f2[0];

        let header = |uid: u32, subject: &str, date_ts: i64, flags: u32| HeaderUpsert {
            uid,
            message_id: format!("m-{uid}-{date_ts}@example.com"),
            thread_key: format!("t-{uid}-{date_ts}"),
            subject: subject.into(),
            from: vec![],
            to: vec![],
            cc: vec![],
            reply_to: vec![],
            in_reply_to: None,
            references: vec![],
            date_ts,
            snippet: String::new(),
            flags,
            has_attachments: false,
            has_ics: false,
        };

        store
            .upsert_headers(
                acc1,
                &inbox1.id,
                Some(1),
                Some(3),
                2,
                2,
                &[
                    header(1, "旧邮件-将在远端删除", 1_764_000_100, 0),
                    header(2, "账号1新邮件", 1_764_000_300, 0),
                ],
            )
            .expect("inbox1 headers");
        store
            .upsert_headers(
                acc1,
                &sent1.id,
                Some(1),
                Some(2),
                0,
                1,
                &[header(1, "已发送测试", 1_764_000_400, FLAG_SEEN)],
            )
            .expect("sent1 headers");
        store
            .upsert_headers(
                acc2,
                &inbox2.id,
                Some(1),
                Some(2),
                1,
                1,
                &[header(10, "账号2邮件", 1_764_000_200, 0)],
            )
            .expect("inbox2 headers");

        // Unified inbox merges both accounts' inboxes sorted newest-first and excludes Sent.
        let unified = store
            .list_unified_inbox_messages(50, 0, None)
            .expect("unified inbox");
        let subjects: Vec<&str> = unified.iter().map(|m| m.subject.as_str()).collect();
        assert_eq!(
            subjects,
            vec!["账号1新邮件", "账号2邮件", "旧邮件-将在远端删除"]
        );

        // Remote UID pruning removes uid 1 (deleted on another client) while keeping uid 2.
        let pruned = store
            .prune_missing_uids(&inbox1.id, &[2])
            .expect("prune missing");
        assert_eq!(pruned, 1);
        let after_prune = store
            .list_messages(&inbox1.id, 50, 0, None)
            .expect("inbox1 after prune");
        assert_eq!(after_prune.len(), 1);
        assert_eq!(after_prune[0].uid, 2);

        // Permanent delete removes row and decrements total/unread counts.
        let msg2_id = MailStore::message_row_id(&inbox2.id, 10);
        store
            .record_message_deleted_local(&msg2_id, &inbox2.id)
            .expect("permanent delete local");
        let inbox2_after = store.get_folder(&inbox2.id).unwrap();
        assert_eq!(inbox2_after.total_count, 0);
        assert_eq!(inbox2_after.unread_count, 0);
        assert!(store
            .list_messages(&inbox2.id, 50, 0, None)
            .unwrap()
            .is_empty());

        // Invalidating Sent after mail_send clears `synced_at` so next view / background sync refreshes it.
        assert!(store.get_folder(&sent1.id).unwrap().synced_at.is_some());
        store
            .invalidate_folder_sync(&sent1.id)
            .expect("invalidate sent");
        assert!(store.get_folder(&sent1.id).unwrap().synced_at.is_none());
    }
}
