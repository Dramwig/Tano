//! Provider-aware IMAP folder classification, noise filtering, and normalization.
//!
//! Handles real-world IMAP quirks across Outlook / Microsoft 365, Gmail (`[Gmail]/` &
//! `[Google Mail]/`), QQ Mail (`其他文件夹/...`), NetEase 163 / 126 (`病毒文件夹`),
//! iCloud (`Notes`), Yahoo (`Bulk Mail`), and custom Courier / Dovecot / Cyrus servers
//! (`.` hierarchy delimiter and `INBOX.` personal namespaces).

use super::types::MailFolder;
use imap_proto::NameAttribute;
use std::collections::{HashMap, HashSet};

/// RFC 6154 / RFC 8457 and Tano display priority for special-use folders.
/// Values `0..=8` are primary mailbox folders; `9` (`notes`) and `10` (custom) belong
/// to the secondary section.
pub fn special_use_rank(special_use: Option<&str>) -> u8 {
    match special_use {
        Some("inbox") => 0,
        Some("flagged") => 1,
        Some("important") => 2,
        Some("sent") => 3,
        Some("drafts") => 4,
        Some("archive") => 5,
        Some("all") => 6,
        Some("junk") => 7,
        Some("trash") => 8,
        Some("notes") => 9,
        _ => 10,
    }
}

/// Returns true when the IMAP server marks a mailbox as non-selectable (container-only)
/// or non-existent.
pub fn is_unselectable(attributes: &[NameAttribute<'_>]) -> bool {
    attributes.iter().any(|attr| match attr {
        NameAttribute::NoSelect => true,
        NameAttribute::Extension(name) => matches!(
            name.trim_start_matches('\\').to_ascii_lowercase().as_str(),
            "noselect" | "nonexistent"
        ),
        _ => false,
    })
}

/// Infers the hierarchy delimiter when the server omitted one or when reading legacy
/// cached rows from SQLite.
pub fn effective_delimiter<'a>(decoded_path: &str, delimiter: Option<&'a str>) -> Option<&'a str> {
    if let Some(delim) = delimiter.filter(|d| !d.is_empty()) {
        return Some(delim);
    }
    if decoded_path.contains('/') {
        return Some("/");
    }
    if decoded_path.len() > 6 && decoded_path[..6].eq_ignore_ascii_case("INBOX.") {
        return Some(".");
    }
    None
}

/// Splits a decoded folder path using its effective hierarchy delimiter.
pub fn split_segments<'a>(decoded_path: &'a str, delimiter: Option<&str>) -> Vec<&'a str> {
    match effective_delimiter(decoded_path, delimiter) {
        Some(delim) => decoded_path
            .split(delim)
            .filter(|seg| !seg.is_empty())
            .collect(),
        None => {
            if decoded_path.is_empty() {
                Vec::new()
            } else {
                vec![decoded_path]
            }
        }
    }
}

/// Returns true for IMAP system namespace wrappers like `[Gmail]` or `[Google Mail]`.
pub fn is_gmail_namespace(segment: &str) -> bool {
    let lower = segment.trim().to_ascii_lowercase();
    matches!(lower.as_str(), "[gmail]" | "[google mail]")
}

/// Strips a leading transparent IMAP namespace prefix (`[Gmail]/`, `[Google Mail]/`, or
/// Courier/Cyrus `INBOX.` when delimiter is `.`) and returns `(effective_segments, in_gmail_ns)`.
fn strip_system_namespace<'a>(
    decoded_path: &'a str,
    delimiter: Option<&str>,
) -> (Vec<&'a str>, bool) {
    let delim = effective_delimiter(decoded_path, delimiter);
    let segments = split_segments(decoded_path, delim);
    if segments.is_empty() {
        return (segments, false);
    }
    if segments.len() >= 2 && is_gmail_namespace(segments[0]) {
        return (segments[1..].to_vec(), true);
    }
    if segments.len() >= 2 && delim == Some(".") && segments[0].eq_ignore_ascii_case("INBOX") {
        return (segments[1..].to_vec(), false);
    }
    (segments, false)
}

/// Returns true for non-mail system/diagnostic folders that should always be hidden
/// (e.g., Exchange / Outlook `Sync Issues` / `同步问题` and their child log folders).
pub fn is_always_hidden_folder(decoded_path: &str, delimiter: Option<&str>) -> bool {
    let segments = split_segments(decoded_path, delimiter);
    if segments.is_empty() {
        return true;
    }
    // Never show bare `[Gmail]` / `[Google Mail]` namespace roots even if selectable.
    if segments.len() == 1 && is_gmail_namespace(segments[0]) {
        return true;
    }
    let (effective, _) = strip_system_namespace(decoded_path, delimiter);
    let Some(first) = effective.first() else {
        return true;
    };
    let root = first.trim().to_ascii_lowercase();
    matches!(
        root.as_str(),
        // Exchange / Outlook diagnostic sync-log folders (and all children under them)
        "sync issues"
            | "同步问题"
            | "同步处理问题"
            | "同步處理問題"
            | "synchronisierungsprobleme"
            | "problèmes de synchronisation"
            | "problemas de sincronización"
            | "同期の問題"
            // Exchange internal retention & MAPI metadata folders
            | "recoverable items"
            | "可恢复的项目"
            | "可復原的項目"
            | "conversation action settings"
            | "quick step settings"
            | "social activity notifications"
            | "yammer root"
            | "externalcontacts"
            | "recipient cache"
            | "personmetadata"
    )
}

/// Returns true for transient queue or legacy quarantine folders that official clients
/// hide while empty, but surface if a message actually resides in them.
pub fn is_hide_when_empty_folder(decoded_path: &str, delimiter: Option<&str>) -> bool {
    let (effective, in_gmail_ns) = strip_system_namespace(decoded_path, delimiter);
    if effective.is_empty() {
        return false;
    }
    if effective.len() == 1 {
        let name = effective[0].trim().to_ascii_lowercase();
        if in_gmail_ns && matches!(name.as_str(), "chats" | "聊天记录" | "聊天記錄") {
            return true;
        }
        return matches!(
            name.as_str(),
            // Sending queue buffer (Outlook / Exchange / Alimail / Yahoo / generic)
            "outbox"
                | "发件箱"
                | "寄件匣"
                // NetEase 163 / 126 quarantine folder
                | "病毒文件夹"
                | "病毒邮件"
                // Legacy Apple Mail / iCloud folders
                | "apple mail to do"
                | "recovered messages"
        );
    }
    // QQ Mail discontinued Drift Bottle subfolder (`其他文件夹/漂流瓶`).
    if effective.len() == 2
        && effective[0].trim() == "其他文件夹"
        && effective[1].trim() == "漂流瓶"
    {
        return true;
    }
    false
}

/// Extracts RFC 6154 / RFC 8457 special-use role purely from IMAP LIST attributes
/// (plus the mandatory `INBOX` rule from RFC 3501).
pub fn detect_special_use_from_attributes(
    remote_name: &str,
    attributes: &[NameAttribute<'_>],
) -> Option<&'static str> {
    if remote_name.eq_ignore_ascii_case("INBOX") {
        return Some("inbox");
    }
    for attr in attributes {
        match attr {
            NameAttribute::Sent => return Some("sent"),
            NameAttribute::Drafts => return Some("drafts"),
            NameAttribute::Trash => return Some("trash"),
            NameAttribute::Junk => return Some("junk"),
            NameAttribute::Archive => return Some("archive"),
            NameAttribute::Flagged => return Some("flagged"),
            NameAttribute::All => return Some("all"),
            NameAttribute::Extension(name) => {
                let ext = name.trim_start_matches('\\').to_ascii_lowercase();
                match ext.as_str() {
                    "sent" => return Some("sent"),
                    "drafts" | "draft" => return Some("drafts"),
                    "trash" | "deleted" => return Some("trash"),
                    "junk" | "spam" => return Some("junk"),
                    "archive" => return Some("archive"),
                    "flagged" | "starred" => return Some("flagged"),
                    "all" | "allmail" => return Some("all"),
                    "important" => return Some("important"),
                    _ => {}
                }
            }
            _ => {}
        }
    }
    None
}

/// Fallback special-use detection by folder name.
///
/// Only applies to top-level folders or direct children of known system namespaces
/// (`[Gmail]/`, `[Google Mail]/`, or `INBOX.` with `.` delimiter), so user subfolders
/// like `Projects/Archive` or `Deleted/POP` are never misclassified.
pub fn detect_special_use_from_name(
    decoded_path: &str,
    delimiter: Option<&str>,
) -> Option<&'static str> {
    if decoded_path.eq_ignore_ascii_case("INBOX") {
        return Some("inbox");
    }
    let (effective, _in_gmail_ns) = strip_system_namespace(decoded_path, delimiter);
    if effective.len() != 1 {
        return None;
    }
    let lower = effective[0].trim().to_ascii_lowercase();
    match lower.as_str() {
        "sent" | "sent messages" | "sent mail" | "sent items" | "已发送" | "已发送邮件"
        | "已发邮件" | "已傳送" | "寄件備份" => Some("sent"),
        "drafts" | "draft" | "草稿箱" | "草稿" => Some("drafts"),
        "trash" | "bin" | "deleted" | "deleted messages" | "deleted items" | "已删除"
        | "已删除邮件" | "已刪除" | "已刪除郵件" | "废纸篓" | "廢紙簍" | "回收站" => {
            Some("trash")
        }
        "junk" | "junk email" | "junk e-mail" | "spam" | "bulk" | "bulk mail" | "垃圾邮件"
        | "垃圾郵件" => Some("junk"),
        "archive" | "archives" | "归档" | "存档" | "已归档" | "歸檔" | "存檔" => {
            Some("archive")
        }
        "flagged" | "starred" | "星标邮件" | "已加星标" | "红旗邮件" | "已加星號" => {
            Some("flagged")
        }
        "all" | "all mail" | "全部邮件" | "所有邮件" | "所有郵件" => Some("all"),
        "important" | "重要邮件" | "重要郵件" => Some("important"),
        "notes" | "便签" | "便箋" | "记事本" => Some("notes"),
        _ => None,
    }
}

/// Computes the default Simplified Chinese friendly display name for a folder.
pub fn friendly_folder_name(
    decoded_path: &str,
    delimiter: Option<&str>,
    special_use: Option<&str>,
) -> String {
    match special_use {
        Some("inbox") => "收件箱".into(),
        Some("flagged") => "星标邮件".into(),
        Some("important") => "重要邮件".into(),
        Some("sent") => "已发送".into(),
        Some("drafts") => "草稿箱".into(),
        Some("archive") => "归档".into(),
        Some("all") => "全部邮件".into(),
        Some("junk") => "垃圾邮件".into(),
        Some("trash") => "已删除".into(),
        Some("notes") => "便签".into(),
        _ => {
            let (effective, in_gmail_ns) = strip_system_namespace(decoded_path, delimiter);
            if in_gmail_ns && effective.len() == 1 {
                let leaf = effective[0].trim();
                if leaf.eq_ignore_ascii_case("chats") {
                    return "聊天记录".into();
                }
                return leaf.to_string();
            }
            decoded_path.to_string()
        }
    }
}

/// Input item for two-pass remote folder classification.
pub struct RemoteFolderCandidate<'a> {
    pub remote_name: &'a str,
    pub decoded_path: String,
    pub delimiter: Option<String>,
    pub attributes: &'a [NameAttribute<'a>],
}

/// Classified remote folder metadata prior to fetching IMAP STATUS counts.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClassifiedRemoteFolder {
    pub remote_name: String,
    pub decoded_path: String,
    pub delimiter: Option<String>,
    pub special_use: Option<String>,
    pub display_name: String,
    pub hide_when_empty: bool,
}

/// Classifies a full account's IMAP LIST results in two passes:
/// 1. Skip unselectable containers and pure diagnostic folders (`Sync Issues/*`, `同步问题/*`).
/// 2. Assign RFC 6154 / RFC 8457 attribute-backed `special_use` roles first.
/// 3. Assign unclaimed `special_use` roles via root/namespace name fallback (at most one
///    folder per role, avoiding duplicate system folders such as Outlook's custom `Junk`).
pub fn classify_remote_folders(
    candidates: &[RemoteFolderCandidate<'_>],
) -> Vec<ClassifiedRemoteFolder> {
    let mut kept: Vec<&RemoteFolderCandidate<'_>> = Vec::with_capacity(candidates.len());
    for item in candidates {
        if is_unselectable(item.attributes) {
            continue;
        }
        if is_always_hidden_folder(&item.decoded_path, item.delimiter.as_deref()) {
            continue;
        }
        kept.push(item);
    }

    let mut roles: Vec<Option<&'static str>> = vec![None; kept.len()];
    let mut claimed: HashSet<&'static str> = HashSet::new();

    // Pass 1: Authoritative server attributes + INBOX.
    for (idx, item) in kept.iter().enumerate() {
        if let Some(role) = detect_special_use_from_attributes(item.remote_name, item.attributes) {
            roles[idx] = Some(role);
            claimed.insert(role);
        }
    }

    // Pass 2: Name-based fallback only for unclaimed roles.
    for (idx, item) in kept.iter().enumerate() {
        if roles[idx].is_some() {
            continue;
        }
        if let Some(role) =
            detect_special_use_from_name(&item.decoded_path, item.delimiter.as_deref())
        {
            if claimed.insert(role) {
                roles[idx] = Some(role);
            }
        }
    }

    kept.iter()
        .zip(roles)
        .map(|(item, role)| {
            let special_use = role.map(str::to_string);
            let display_name = friendly_folder_name(
                &item.decoded_path,
                item.delimiter.as_deref(),
                special_use.as_deref(),
            );
            let hide_when_empty = role.is_none()
                && is_hide_when_empty_folder(&item.decoded_path, item.delimiter.as_deref());
            ClassifiedRemoteFolder {
                remote_name: item.remote_name.to_string(),
                decoded_path: item.decoded_path.clone(),
                delimiter: item.delimiter.clone(),
                special_use,
                display_name,
                hide_when_empty,
            }
        })
        .collect()
}

/// Normalizes and filters cached SQLite folders per account so existing local databases
/// immediately reflect updated classification, hiding rules, and ordering even before the
/// next manual IMAP sync.
pub fn normalize_cached_folders(folders: Vec<MailFolder>) -> Vec<MailFolder> {
    let mut by_account: HashMap<String, Vec<MailFolder>> = HashMap::new();
    let mut account_order: Vec<String> = Vec::new();
    for folder in folders {
        if !by_account.contains_key(&folder.account_id) {
            account_order.push(folder.account_id.clone());
        }
        by_account
            .entry(folder.account_id.clone())
            .or_default()
            .push(folder);
    }

    let mut out = Vec::new();
    for account_id in account_order {
        let Some(mut group) = by_account.remove(&account_id) else {
            continue;
        };

        // Drop diagnostic folders and empty transient system folders.
        group.retain(|folder| {
            let delim = folder.delimiter.as_deref();
            if is_always_hidden_folder(&folder.decoded_path, delim) {
                return false;
            }
            if folder.special_use.is_none()
                && is_hide_when_empty_folder(&folder.decoded_path, delim)
                && folder.total_count == 0
                && folder.unread_count == 0
            {
                return false;
            }
            true
        });

        // Claim roles already persisted in SQLite, clearing obvious subfolder false-positives
        // only when needed is deferred to sync; here we safely fill missing roles (e.g. `存档`, `Notes`).
        let mut claimed: HashSet<String> =
            group.iter().filter_map(|f| f.special_use.clone()).collect();

        for folder in &mut group {
            if folder.special_use.is_none() {
                if let Some(role) =
                    detect_special_use_from_name(&folder.decoded_path, folder.delimiter.as_deref())
                {
                    if claimed.insert(role.to_string()) {
                        folder.special_use = Some(role.to_string());
                        folder.display_name = friendly_folder_name(
                            &folder.decoded_path,
                            folder.delimiter.as_deref(),
                            Some(role),
                        );
                    }
                }
            }
        }

        group.sort_by(|a, b| {
            special_use_rank(a.special_use.as_deref())
                .cmp(&special_use_rank(b.special_use.as_deref()))
                .then_with(|| {
                    a.display_name
                        .to_lowercase()
                        .cmp(&b.display_name.to_lowercase())
                })
        });
        out.extend(group);
    }
    out
}
