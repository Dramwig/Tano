//! Native IMAP client built on `imap` + `rustls-tls`.
//! Supports IMAPS (993) and STARTTLS (143), RFC 2971 IMAP ID (required by NetEase 163/126),
//! Modified UTF-7 Chinese folder decoding, SPECIAL-USE folder mapping, incremental UID header sync,
//! on-demand body fetch, flag updates, message moves, and Sent folder append.

use super::folders::{classify_remote_folders, RemoteFolderCandidate};
use super::mime::{decode_modified_utf7, make_snippet, parse_header_addresses, parse_references};
use super::store::{FolderUpsert, HeaderUpsert};
use super::types::{
    is_blocked_ip, MailAccount, MailAuthKind, MailCredentials, TlsMode, FLAG_ANSWERED, FLAG_DRAFT,
    FLAG_FLAGGED, FLAG_SEEN, INITIAL_SYNC_LIMIT,
};
use imap::types::Flag;
use imap_proto::{BodyStructure, ContentDisposition};
use mail_parser::{MessageParser, MimeHeaders};
use std::net::ToSocketAddrs;
use std::sync::atomic::{AtomicBool, Ordering};

type ImapSession = imap::Session<imap::Connection>;

pub(crate) struct Xoauth2Authenticator {
    user: String,
    access_token: String,
    responded: AtomicBool,
}

impl Xoauth2Authenticator {
    pub(crate) fn new(user: impl Into<String>, access_token: impl Into<String>) -> Self {
        Self {
            user: user.into(),
            access_token: access_token.into(),
            responded: AtomicBool::new(false),
        }
    }
}

impl imap::Authenticator for Xoauth2Authenticator {
    type Response = String;

    fn process(&self, _challenge: &[u8]) -> Self::Response {
        if self.responded.swap(true, Ordering::SeqCst) {
            // Acknowledge server error challenge with empty line so IMAP terminates cleanly.
            return String::new();
        }
        format!(
            "user={}\x01auth=Bearer {}\x01\x01",
            self.user, self.access_token
        )
    }
}

fn verify_resolved_host(host: &str, port: u16) -> Result<(), String> {
    let addrs = (host, port)
        .to_socket_addrs()
        .map_err(|_| format!("无法解析邮件服务器域名：{host}"))?;
    let mut found = false;
    for addr in addrs {
        found = true;
        if is_blocked_ip(addr.ip()) {
            return Err("服务器解析到受限的本地地址，已中止连接".into());
        }
    }
    if !found {
        return Err(format!("无法解析邮件服务器域名：{host}"));
    }
    Ok(())
}

fn connect_session(account: &MailAccount, creds: &MailCredentials) -> Result<ImapSession, String> {
    verify_resolved_host(&account.imap_host, account.imap_port)?;
    let mut builder = imap::ClientBuilder::new(&account.imap_host, account.imap_port);
    if matches!(account.imap_tls, TlsMode::Starttls) {
        builder = builder.mode(imap::ConnectionMode::StartTls);
    }
    let client = builder
        .connect()
        .map_err(|err| format!("无法连接 IMAP 服务器：{}", summarize_imap_error(&err)))?;
    let username = if creds.username.trim().is_empty() {
        account.email.as_str()
    } else {
        creds.username.as_str()
    };
    let mut session = match account.auth_kind {
        MailAuthKind::Password => client
            .login(username, &creds.password)
            .map_err(|(err, _)| {
                format!(
                    "IMAP 登录失败，请检查邮箱账号或授权码（{}）",
                    summarize_imap_error(&err)
                )
            })?,
        MailAuthKind::Oauth2Microsoft => {
            let access_token = creds
                .access_token
                .as_deref()
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .ok_or_else(|| "缺少 Outlook 访问令牌，请重新登录授权".to_string())?;
            let auth = Xoauth2Authenticator::new(username, access_token);
            client.authenticate("XOAUTH2", &auth).map_err(|(err, _)| {
                format!(
                    "IMAP OAuth 认证失败，请确认账号已开启 IMAP 或重新登录授权（{}）",
                    summarize_imap_error(&err)
                )
            })?
        }
    };

    // NetEase 163/126/Yeah reject SELECT with "Unsafe Login" unless RFC 2971 ID is sent.
    let should_send_id = account.send_imap_id
        || session
            .capabilities()
            .map(|caps| caps.has_str("ID"))
            .unwrap_or(false);
    if should_send_id {
        let id_cmd = format!(
            "ID (\"name\" \"Tano\" \"version\" \"{}\" \"vendor\" \"Tano\" \"support-email\" \"support@tano.page\")",
            env!("CARGO_PKG_VERSION")
        );
        let _ = session.run_command_and_check_ok(&id_cmd);
    }
    Ok(session)
}

fn summarize_imap_error(err: &imap::Error) -> String {
    match err {
        imap::Error::No(msg) => {
            if msg
                .information
                .to_ascii_lowercase()
                .contains("unsafe login")
            {
                "服务器拒绝登录（可能需要开启 IMAP 或授权码）".into()
            } else {
                "认证被拒绝或邮箱拒绝操作".into()
            }
        }
        imap::Error::Bad(_) => "服务器协议响应异常".into(),
        imap::Error::Io(io) => format!("网络错误：{}", io.kind()),
        imap::Error::ConnectionLost => "服务器断开了连接".into(),
        _ => "连接或认证失败".into(),
    }
}

pub fn test_imap(account: &MailAccount, creds: &MailCredentials) -> Result<usize, String> {
    let mut session = connect_session(account, creds)?;
    let names = session
        .list(None, Some("*"))
        .map_err(|err| format!("读取邮箱文件夹失败：{}", summarize_imap_error(&err)))?;
    let count = names.len();
    let _ = session.logout();
    Ok(count)
}

pub fn list_remote_folders(
    account: &MailAccount,
    creds: &MailCredentials,
) -> Result<Vec<FolderUpsert>, String> {
    let mut session = connect_session(account, creds)?;
    let names = session
        .list(None, Some("*"))
        .map_err(|err| format!("读取邮箱文件夹失败：{}", summarize_imap_error(&err)))?;

    let candidates: Vec<RemoteFolderCandidate<'_>> = names
        .iter()
        .map(|name| {
            let remote_name = name.name();
            RemoteFolderCandidate {
                remote_name,
                decoded_path: decode_modified_utf7(remote_name),
                delimiter: name
                    .delimiter()
                    .filter(|d| !d.is_empty())
                    .map(str::to_string),
                attributes: name.attributes(),
            }
        })
        .collect();
    let classified = classify_remote_folders(&candidates);

    let mut folders = Vec::with_capacity(classified.len());
    for item in classified {
        let (uid_validity, uid_next, unread_count, total_count) =
            match session.status(&item.remote_name, "(MESSAGES UNSEEN UIDNEXT UIDVALIDITY)") {
                Ok(status) => (
                    status.uid_validity,
                    status.uid_next,
                    status.unseen.unwrap_or(0),
                    status.exists,
                ),
                Err(_) => (None, None, 0, 0),
            };
        if item.hide_when_empty && total_count == 0 && unread_count == 0 {
            continue;
        }
        folders.push(FolderUpsert {
            remote_name: item.remote_name,
            display_name: item.display_name,
            special_use: item.special_use,
            delimiter: item.delimiter,
            uid_validity,
            uid_next,
            unread_count,
            total_count,
        });
    }
    let _ = session.logout();
    Ok(folders)
}

pub struct FolderSyncBatch {
    pub uid_validity: Option<u32>,
    pub uid_next: Option<u32>,
    pub total_count: u32,
    pub unread_count: u32,
    pub uid_validity_changed: bool,
    pub headers: Vec<HeaderUpsert>,
    pub flag_updates: Vec<(u32, u32)>,
    /// Full authoritative set of UIDs currently present in this remote folder (when
    /// `UID SEARCH ALL` succeeded cleanly), used to prune locally cached messages deleted
    /// or moved on other devices.
    pub present_uids: Option<Vec<u32>>,
}

pub fn sync_folder_headers(
    account: &MailAccount,
    creds: &MailCredentials,
    remote_folder: &str,
    known_uid_validity: Option<u32>,
    last_uid: u32,
) -> Result<FolderSyncBatch, String> {
    let mut session = connect_session(account, creds)?;
    let mailbox = session
        .examine(remote_folder)
        .map_err(|err| format!("打开文件夹失败：{}", summarize_imap_error(&err)))?;
    let total_count = mailbox.exists;
    let uid_validity = mailbox.uid_validity;
    let uid_next = mailbox.uid_next;
    let uid_validity_changed = matches!(
        (known_uid_validity, uid_validity),
        (Some(prev), Some(curr)) if prev != curr
    );

    let unread_count = session
        .uid_search("UNSEEN")
        .map(|set| set.len() as u32)
        .unwrap_or(0);

    let effective_last_uid = if uid_validity_changed { 0 } else { last_uid };
    let all_search = session.uid_search("ALL");
    let (present_uids, target_uids): (Option<Vec<u32>>, Vec<u32>) = match all_search {
        Ok(set) => {
            let mut all: Vec<u32> = set.into_iter().collect();
            all.sort_unstable();
            // Guard against buggy servers returning an empty search set for a non-empty mailbox.
            let present = if !all.is_empty() || total_count == 0 {
                Some(all.clone())
            } else {
                None
            };
            let mut targets: Vec<u32> = if effective_last_uid > 0 {
                all.into_iter()
                    .filter(|uid| *uid > effective_last_uid)
                    .collect()
            } else {
                all
            };
            if targets.len() > INITIAL_SYNC_LIMIT {
                targets = targets[targets.len() - INITIAL_SYNC_LIMIT..].to_vec();
            }
            (present, targets)
        }
        Err(_) => {
            // Fall back to incremental range search without pruning if `UID SEARCH ALL` failed.
            let mut targets = if effective_last_uid > 0 {
                let query = format!("UID {}:*", effective_last_uid.saturating_add(1));
                session
                    .uid_search(&query)
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|uid| *uid > effective_last_uid)
                    .collect::<Vec<_>>()
            } else {
                Vec::new()
            };
            targets.sort_unstable();
            if targets.len() > INITIAL_SYNC_LIMIT {
                targets = targets[targets.len() - INITIAL_SYNC_LIMIT..].to_vec();
            }
            (None, targets)
        }
    };

    let mut headers = Vec::new();
    for chunk in target_uids.chunks(40) {
        let seq = chunk
            .iter()
            .map(u32::to_string)
            .collect::<Vec<_>>()
            .join(",");
        if seq.is_empty() {
            continue;
        }
        let fetched = session
            .uid_fetch(
                &seq,
                "(UID FLAGS INTERNALDATE BODYSTRUCTURE BODY.PEEK[HEADER.FIELDS (FROM TO CC REPLY-TO SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES CONTENT-TYPE)])",
            )
            .map_err(|err| format!("同步邮件头失败：{}", summarize_imap_error(&err)))?;
        for item in fetched.iter() {
            let Some(uid) = item.uid else {
                continue;
            };
            let flags = encode_flags(item.flags());
            let (has_attachments, has_ics) = inspect_bodystructure(item.bodystructure());
            let raw_header = item.header().or_else(|| item.body()).unwrap_or(&[]);
            let internal_ts = item.internal_date().map(|dt| dt.timestamp()).unwrap_or(0);
            headers.push(build_header_upsert(
                uid,
                flags,
                internal_ts,
                has_attachments,
                has_ics,
                raw_header,
            ));
        }
    }

    // Refresh recent flags when doing incremental sync.
    let mut flag_updates = Vec::new();
    if effective_last_uid > 0 && !uid_validity_changed {
        let window_start = effective_last_uid.saturating_sub(80).max(1);
        let range = format!("{window_start}:{effective_last_uid}");
        if let Ok(flag_fetches) = session.uid_fetch(&range, "(UID FLAGS)") {
            for item in flag_fetches.iter() {
                if let Some(uid) = item.uid {
                    flag_updates.push((uid, encode_flags(item.flags())));
                }
            }
        }
    }

    let _ = session.logout();
    Ok(FolderSyncBatch {
        uid_validity,
        uid_next,
        total_count,
        unread_count,
        uid_validity_changed,
        headers,
        flag_updates,
        present_uids,
    })
}

pub fn fetch_message_raw(
    account: &MailAccount,
    creds: &MailCredentials,
    remote_folder: &str,
    uid: u32,
) -> Result<Vec<u8>, String> {
    let mut session = connect_session(account, creds)?;
    session
        .examine(remote_folder)
        .map_err(|err| format!("打开文件夹失败：{}", summarize_imap_error(&err)))?;
    let fetched = session
        .uid_fetch(uid.to_string(), "BODY.PEEK[]")
        .map_err(|err| format!("拉取邮件正文失败：{}", summarize_imap_error(&err)))?;
    let raw = fetched
        .iter()
        .next()
        .and_then(|item| item.body())
        .map(|bytes| bytes.to_vec())
        .ok_or_else(|| "服务器上找不到该邮件正文".to_string())?;
    let _ = session.logout();
    Ok(raw)
}

pub fn update_remote_flags(
    account: &MailAccount,
    creds: &MailCredentials,
    remote_folder: &str,
    uid: u32,
    seen: Option<bool>,
    flagged: Option<bool>,
) -> Result<(), String> {
    let mut session = connect_session(account, creds)?;
    session
        .select(remote_folder)
        .map_err(|err| format!("打开文件夹失败：{}", summarize_imap_error(&err)))?;
    let uid_str = uid.to_string();
    if let Some(val) = seen {
        let query = if val {
            "+FLAGS.SILENT (\\Seen)"
        } else {
            "-FLAGS.SILENT (\\Seen)"
        };
        session
            .uid_store(&uid_str, query)
            .map_err(|err| format!("更新已读状态失败：{}", summarize_imap_error(&err)))?;
    }
    if let Some(val) = flagged {
        let query = if val {
            "+FLAGS.SILENT (\\Flagged)"
        } else {
            "-FLAGS.SILENT (\\Flagged)"
        };
        session
            .uid_store(&uid_str, query)
            .map_err(|err| format!("更新星标状态失败：{}", summarize_imap_error(&err)))?;
    }
    let _ = session.logout();
    Ok(())
}

pub fn move_remote_message(
    account: &MailAccount,
    creds: &MailCredentials,
    from_folder: &str,
    to_folder: &str,
    uid: u32,
) -> Result<(), String> {
    let mut session = connect_session(account, creds)?;
    session
        .select(from_folder)
        .map_err(|err| format!("打开原文件夹失败：{}", summarize_imap_error(&err)))?;
    let uid_str = uid.to_string();
    if session.uid_mv(&uid_str, to_folder).is_err() {
        session
            .uid_copy(&uid_str, to_folder)
            .map_err(|err| format!("移动邮件失败：{}", summarize_imap_error(&err)))?;
        session
            .uid_store(&uid_str, "+FLAGS.SILENT (\\Deleted)")
            .map_err(|err| format!("标记删除原邮件失败：{}", summarize_imap_error(&err)))?;
        let _ = session.expunge();
    }
    let _ = session.logout();
    Ok(())
}

/// Permanently deletes a single message from a remote IMAP folder by marking `\Deleted`
/// and expunging (preferring RFC 4315 `UID EXPUNGE` when advertised by the server).
pub fn delete_remote_message(
    account: &MailAccount,
    creds: &MailCredentials,
    remote_folder: &str,
    uid: u32,
) -> Result<(), String> {
    let mut session = connect_session(account, creds)?;
    session
        .select(remote_folder)
        .map_err(|err| format!("打开文件夹失败：{}", summarize_imap_error(&err)))?;
    let uid_str = uid.to_string();
    session
        .uid_store(&uid_str, "+FLAGS.SILENT (\\Deleted)")
        .map_err(|err| format!("标记永久删除失败：{}", summarize_imap_error(&err)))?;
    let has_uidplus = session
        .capabilities()
        .map(|caps| caps.has_str("UIDPLUS"))
        .unwrap_or(false);
    let expunge_res = if has_uidplus {
        let cmd = format!("UID EXPUNGE {uid_str}");
        session
            .run_command_and_check_ok(&cmd)
            .or_else(|_| session.expunge().map(|_| ()))
    } else {
        session.expunge().map(|_| ())
    };
    expunge_res.map_err(|err| format!("永久删除邮件失败：{}", summarize_imap_error(&err)))?;
    let _ = session.logout();
    Ok(())
}

pub fn append_to_sent(
    account: &MailAccount,
    creds: &MailCredentials,
    sent_folder: &str,
    raw_message: &[u8],
) -> Result<(), String> {
    let mut session = connect_session(account, creds)?;
    session
        .append(sent_folder, raw_message)
        .flag(Flag::Seen)
        .finish()
        .map_err(|err| format!("同步到已发送文件夹失败：{}", summarize_imap_error(&err)))?;
    let _ = session.logout();
    Ok(())
}

fn build_header_upsert(
    uid: u32,
    flags: u32,
    internal_ts: i64,
    has_attachments: bool,
    has_ics: bool,
    raw_header: &[u8],
) -> HeaderUpsert {
    if let Some(parsed) = MessageParser::default().parse_headers(raw_header) {
        let (from, to, cc, reply_to) = parse_header_addresses(&parsed);
        let (in_reply_to, references) = parse_references(&parsed);
        let subject = parsed
            .subject()
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        let message_id = parsed
            .message_id()
            .map(|s| s.trim().trim_matches(|c| c == '<' || c == '>').to_string())
            .unwrap_or_else(|| format!("uid-{uid}"));
        let thread_key = references
            .first()
            .cloned()
            .or_else(|| in_reply_to.clone())
            .unwrap_or_else(|| message_id.clone());
        let date_ts = parsed
            .date()
            .map(|d| d.to_timestamp())
            .filter(|ts| *ts > 0)
            .unwrap_or(internal_ts);
        let header_has_ics = has_ics
            || parsed
                .content_type()
                .map(|ct| {
                    ct.ctype().eq_ignore_ascii_case("text")
                        && ct
                            .subtype()
                            .map(|s| s.eq_ignore_ascii_case("calendar"))
                            .unwrap_or(false)
                })
                .unwrap_or(false);
        return HeaderUpsert {
            uid,
            message_id,
            thread_key,
            subject: if subject.is_empty() {
                "（无主题）".into()
            } else {
                subject
            },
            from,
            to,
            cc,
            reply_to,
            in_reply_to,
            references,
            date_ts,
            snippet: make_snippet(parsed.subject().unwrap_or("")),
            flags,
            has_attachments,
            has_ics: header_has_ics,
        };
    }

    HeaderUpsert {
        uid,
        message_id: format!("uid-{uid}"),
        thread_key: format!("uid-{uid}"),
        subject: "（无主题）".into(),
        from: Vec::new(),
        to: Vec::new(),
        cc: Vec::new(),
        reply_to: Vec::new(),
        in_reply_to: None,
        references: Vec::new(),
        date_ts: internal_ts,
        snippet: String::new(),
        flags,
        has_attachments,
        has_ics,
    }
}

fn encode_flags(flags: &[Flag<'_>]) -> u32 {
    let mut bits = 0u32;
    for flag in flags {
        match flag {
            Flag::Seen => bits |= FLAG_SEEN,
            Flag::Flagged => bits |= FLAG_FLAGGED,
            Flag::Answered => bits |= FLAG_ANSWERED,
            Flag::Draft => bits |= FLAG_DRAFT,
            _ => {}
        }
    }
    bits
}

fn inspect_bodystructure(structure: Option<&BodyStructure<'_>>) -> (bool, bool) {
    let Some(bs) = structure else {
        return (false, false);
    };
    let mut has_attachments = false;
    let mut has_ics = false;
    walk_bodystructure(bs, &mut has_attachments, &mut has_ics);
    (has_attachments, has_ics)
}

fn walk_bodystructure(bs: &BodyStructure<'_>, has_attachments: &mut bool, has_ics: &mut bool) {
    match bs {
        BodyStructure::Multipart { bodies, .. } => {
            for child in bodies {
                walk_bodystructure(child, has_attachments, has_ics);
            }
        }
        BodyStructure::Basic { common, .. } => {
            let ty = common.ty.ty.to_ascii_lowercase();
            let sub = common.ty.subtype.to_ascii_lowercase();
            if (ty == "text" && sub == "calendar") || (ty == "application" && sub == "ics") {
                *has_ics = true;
            }
            if is_attachment_disposition(common.disposition.as_ref()) {
                *has_attachments = true;
            }
        }
        BodyStructure::Text { common, .. } => {
            let sub = common.ty.subtype.to_ascii_lowercase();
            if sub == "calendar" {
                *has_ics = true;
            }
            if is_attachment_disposition(common.disposition.as_ref()) {
                *has_attachments = true;
            }
        }
        BodyStructure::Message { common, body, .. } => {
            if is_attachment_disposition(common.disposition.as_ref()) {
                *has_attachments = true;
            }
            walk_bodystructure(body, has_attachments, has_ics);
        }
    }
}

fn is_attachment_disposition(disp: Option<&ContentDisposition<'_>>) -> bool {
    disp.map(|d| d.ty.eq_ignore_ascii_case("attachment"))
        .unwrap_or(false)
}
