//! Tauri IPC command handlers for the desktop native mail client.
//! All IMAP blocking operations are dispatched off the main window thread via spawn_blocking.

use super::accounts;
use super::imap_client;
use super::mime;
use super::smtp_client;
use super::store::MailStore;
use super::types::{
    mail_presets, unix_timestamp_secs, validate_account_input, AppendSentPolicy, MailAccount,
    MailAccountInput, MailCacheStats, MailCredentials, MailDownloadedAttachment, MailDraft,
    MailFlagsPatch, MailFolder, MailMessageDetail, MailMessageSummary, MailPreset, MailSendRequest,
    MailSendResult, MailSyncSummary, MailTestResult,
};
use base64::Engine;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::State;

#[derive(Default)]
pub struct MailState {
    account_locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
}

impl MailState {
    fn lock_for(&self, account_id: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut map = self
            .account_locks
            .lock()
            .expect("mail account lock map poisoned");
        map.entry(account_id.to_string())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone()
    }
}

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    crate::app_data(app)
}

#[tauri::command]
pub fn mail_presets_list() -> Vec<MailPreset> {
    mail_presets()
}

#[tauri::command]
pub fn mail_accounts_list(app: tauri::AppHandle) -> Result<Vec<MailAccount>, String> {
    let dir = data_dir(&app)?;
    accounts::list_accounts(&dir)
}

#[tauri::command]
pub async fn mail_account_test(
    input: MailAccountInput,
    credentials: MailCredentials,
) -> Result<MailTestResult, String> {
    let validated = validate_account_input(&input)?;
    let account = MailAccount {
        id: validated
            .id
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
        provider: validated.provider,
        label: validated.label,
        email: validated.email.clone(),
        display_name: validated.display_name,
        imap_host: validated.imap_host,
        imap_port: validated.imap_port,
        imap_tls: validated.imap_tls,
        smtp_host: validated.smtp_host,
        smtp_port: validated.smtp_port,
        smtp_tls: validated.smtp_tls,
        append_sent: validated.append_sent,
        send_imap_id: validated.send_imap_id,
        created_at: 0,
    };
    let mut creds = credentials;
    if creds.username.trim().is_empty() {
        creds.username = account.email.clone();
    }
    if creds.password.is_empty() {
        return Err("请输入授权码或密码".into());
    }

    let imap_account = account.clone();
    let imap_creds = creds.clone();
    let folder_count =
        tokio::task::spawn_blocking(move || imap_client::test_imap(&imap_account, &imap_creds))
            .await
            .map_err(|_| "IMAP 测试任务意外中断".to_string())??;

    smtp_client::test_smtp(&account, &creds).await?;

    Ok(MailTestResult {
        imap_ok: true,
        smtp_ok: true,
        folder_count,
        message: format!("连接成功：IMAP 已发现 {folder_count} 个文件夹，SMTP 认证通过。"),
    })
}

#[tauri::command]
pub fn mail_account_save(
    app: tauri::AppHandle,
    input: MailAccountInput,
    credentials: Option<MailCredentials>,
) -> Result<MailAccount, String> {
    let dir = data_dir(&app)?;
    accounts::save_account(&dir, input, credentials)
}

#[tauri::command]
pub async fn mail_account_remove(
    app: tauri::AppHandle,
    state: State<'_, MailState>,
    account_id: String,
) -> Result<(), String> {
    let lock = state.lock_for(&account_id);
    let _guard = lock.lock().await;
    let dir = data_dir(&app)?;
    let store = MailStore::open(&dir)?;
    store.delete_account_data(&account_id)?;
    accounts::remove_account(&dir, &account_id)
}

#[tauri::command]
pub fn mail_folders_list(
    app: tauri::AppHandle,
    account_id: Option<String>,
) -> Result<Vec<MailFolder>, String> {
    let dir = data_dir(&app)?;
    let store = MailStore::open(&dir)?;
    store.list_folders(account_id.as_deref())
}

#[tauri::command]
pub async fn mail_sync_account(
    app: tauri::AppHandle,
    state: State<'_, MailState>,
    account_id: String,
) -> Result<MailSyncSummary, String> {
    let lock = state.lock_for(&account_id);
    let _guard = lock.lock().await;
    let dir = data_dir(&app)?;
    let account = accounts::get_account(&dir, &account_id)?;
    let creds = accounts::read_credentials(&account_id)?;

    let sync_dir = dir.clone();
    tokio::task::spawn_blocking(move || {
        let store = MailStore::open(&sync_dir)?;
        let remote_folders = imap_client::list_remote_folders(&account, &creds)?;
        let stored_folders = store.upsert_folders(&account.id, &remote_folders)?;

        let mut messages_added = 0usize;
        // Prioritize INBOX and Sent during account-wide sync for fast startup.
        let targets: Vec<&MailFolder> = stored_folders
            .iter()
            .filter(|f| matches!(f.special_use.as_deref(), Some("inbox") | Some("sent")))
            .collect();
        let sync_list: Vec<&MailFolder> = if targets.is_empty() {
            stored_folders.iter().take(1).collect()
        } else {
            targets
        };

        for folder in sync_list {
            let last_uid = store.max_uid_in_folder(&folder.id)?;
            let batch = imap_client::sync_folder_headers(
                &account,
                &creds,
                &folder.remote_name,
                folder.uid_validity,
                last_uid,
            )?;
            if batch.uid_validity_changed {
                if let Some(new_val) = batch.uid_validity {
                    store.reset_folder_on_uidvalidity_change(&folder.id, new_val)?;
                }
            }
            messages_added += store.upsert_headers(
                &account.id,
                &folder.id,
                batch.uid_validity,
                batch.uid_next,
                batch.unread_count,
                batch.total_count,
                &batch.headers,
            )?;
            if !batch.flag_updates.is_empty() {
                store.update_known_flags(&folder.id, &batch.flag_updates)?;
            }
        }

        Ok(MailSyncSummary {
            account_id: account.id,
            folders_synced: stored_folders.len(),
            messages_added,
            synced_at: unix_timestamp_secs(),
        })
    })
    .await
    .map_err(|_| "邮箱同步任务意外中断".to_string())?
}

#[tauri::command]
pub async fn mail_sync_folder(
    app: tauri::AppHandle,
    state: State<'_, MailState>,
    folder_id: String,
) -> Result<MailSyncSummary, String> {
    let dir = data_dir(&app)?;
    let store = MailStore::open(&dir)?;
    let folder = store.get_folder(&folder_id)?;
    let lock = state.lock_for(&folder.account_id);
    let _guard = lock.lock().await;
    let account = accounts::get_account(&dir, &folder.account_id)?;
    let creds = accounts::read_credentials(&folder.account_id)?;

    let sync_dir = dir.clone();
    tokio::task::spawn_blocking(move || {
        let store = MailStore::open(&sync_dir)?;
        let last_uid = store.max_uid_in_folder(&folder.id)?;
        let batch = imap_client::sync_folder_headers(
            &account,
            &creds,
            &folder.remote_name,
            folder.uid_validity,
            last_uid,
        )?;
        if batch.uid_validity_changed {
            if let Some(new_val) = batch.uid_validity {
                store.reset_folder_on_uidvalidity_change(&folder.id, new_val)?;
            }
        }
        let messages_added = store.upsert_headers(
            &account.id,
            &folder.id,
            batch.uid_validity,
            batch.uid_next,
            batch.unread_count,
            batch.total_count,
            &batch.headers,
        )?;
        if !batch.flag_updates.is_empty() {
            store.update_known_flags(&folder.id, &batch.flag_updates)?;
        }
        Ok(MailSyncSummary {
            account_id: account.id,
            folders_synced: 1,
            messages_added,
            synced_at: unix_timestamp_secs(),
        })
    })
    .await
    .map_err(|_| "文件夹同步任务意外中断".to_string())?
}

#[tauri::command]
pub fn mail_messages_list(
    app: tauri::AppHandle,
    folder_id: String,
    limit: Option<usize>,
    offset: Option<usize>,
    filter: Option<String>,
) -> Result<Vec<MailMessageSummary>, String> {
    let dir = data_dir(&app)?;
    let store = MailStore::open(&dir)?;
    store.list_messages(
        &folder_id,
        limit.unwrap_or(50),
        offset.unwrap_or(0),
        filter.as_deref(),
    )
}

#[tauri::command]
pub fn mail_messages_search(
    app: tauri::AppHandle,
    account_id: Option<String>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<MailMessageSummary>, String> {
    let dir = data_dir(&app)?;
    let store = MailStore::open(&dir)?;
    store.search_messages(account_id.as_deref(), &query, limit.unwrap_or(50))
}

#[tauri::command]
pub async fn mail_message_get(
    app: tauri::AppHandle,
    message_id: String,
    force_refresh: Option<bool>,
) -> Result<MailMessageDetail, String> {
    let dir = data_dir(&app)?;
    let store = MailStore::open(&dir)?;
    let existing = store.get_message_detail(&message_id)?;
    if existing.summary.body_fetched && !force_refresh.unwrap_or(false) {
        return Ok(existing);
    }

    let folder = store.get_folder(&existing.summary.folder_id)?;
    let account = accounts::get_account(&dir, &existing.summary.account_id)?;
    let creds = accounts::read_credentials(&existing.summary.account_id)?;
    let uid = existing.summary.uid;
    let msg_id = message_id.clone();

    tokio::task::spawn_blocking(move || {
        let raw = imap_client::fetch_message_raw(&account, &creds, &folder.remote_name, uid)?;
        let parsed = mime::parse_rfc822_body(&raw);
        let store = MailStore::open(&dir)?;
        store.store_message_body(&account.id, &msg_id, &parsed)?;
        store.get_message_detail(&msg_id)
    })
    .await
    .map_err(|_| "加载邮件正文中断".to_string())?
}

#[tauri::command]
pub async fn mail_message_flags_update(
    app: tauri::AppHandle,
    message_id: String,
    patch: MailFlagsPatch,
) -> Result<MailMessageDetail, String> {
    let dir = data_dir(&app)?;
    let store = MailStore::open(&dir)?;
    let (folder_id, uid, _next_flags) =
        store.update_flags_local(&message_id, patch.seen, patch.flagged)?;
    let folder = store.get_folder(&folder_id)?;
    let account = accounts::get_account(&dir, &folder.account_id)?;
    let creds = accounts::read_credentials(&folder.account_id)?;

    let seen = patch.seen;
    let flagged = patch.flagged;
    tokio::task::spawn_blocking(move || {
        imap_client::update_remote_flags(&account, &creds, &folder.remote_name, uid, seen, flagged)
    })
    .await
    .map_err(|_| "更新邮件状态中断".to_string())??;

    store.get_message_detail(&message_id)
}

#[tauri::command]
pub async fn mail_message_move(
    app: tauri::AppHandle,
    message_id: String,
    target_folder_id: String,
) -> Result<(), String> {
    let dir = data_dir(&app)?;
    let store = MailStore::open(&dir)?;
    let detail = store.get_message_detail(&message_id)?;
    let from_folder = store.get_folder(&detail.summary.folder_id)?;
    let to_folder = store.get_folder(&target_folder_id)?;
    if from_folder.account_id != to_folder.account_id {
        return Err("不支持跨邮箱账号移动邮件".into());
    }
    let account = accounts::get_account(&dir, &from_folder.account_id)?;
    let creds = accounts::read_credentials(&from_folder.account_id)?;
    let uid = detail.summary.uid;

    tokio::task::spawn_blocking(move || {
        imap_client::move_remote_message(
            &account,
            &creds,
            &from_folder.remote_name,
            &to_folder.remote_name,
            uid,
        )
    })
    .await
    .map_err(|_| "移动邮件中断".to_string())??;

    store.remove_message_local(&message_id)?;
    Ok(())
}

#[tauri::command]
pub fn mail_invite_update(
    app: tauri::AppHandle,
    invite_id: String,
    imported_object_id: Option<String>,
    rsvp_status: Option<String>,
) -> Result<(), String> {
    let dir = data_dir(&app)?;
    let store = MailStore::open(&dir)?;
    store.update_invite_state(
        &invite_id,
        imported_object_id.as_deref(),
        rsvp_status.as_deref(),
    )
}

#[tauri::command]
pub async fn mail_attachment_download(
    app: tauri::AppHandle,
    attachment_id: String,
) -> Result<MailDownloadedAttachment, String> {
    let dir = data_dir(&app)?;
    let store = MailStore::open(&dir)?;
    let (message_id, part_id, filename, content_type, _size_bytes, cache_path) =
        store.get_attachment_row(&attachment_id)?;

    if let Some(existing_path) = cache_path {
        if let Ok(bytes) = std::fs::read(&existing_path) {
            return Ok(MailDownloadedAttachment {
                id: attachment_id,
                filename,
                content_type,
                size_bytes: bytes.len() as u64,
                bytes_base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
            });
        }
    }

    let detail = store.get_message_detail(&message_id)?;
    let folder = store.get_folder(&detail.summary.folder_id)?;
    let account = accounts::get_account(&dir, &detail.summary.account_id)?;
    let creds = accounts::read_credentials(&detail.summary.account_id)?;
    let uid = detail.summary.uid;
    let part_index: usize = part_id
        .parse()
        .map_err(|_| "附件分片标识无效".to_string())?;
    let att_id = attachment_id.clone();

    let bytes = tokio::task::spawn_blocking(move || {
        let raw = imap_client::fetch_message_raw(&account, &creds, &folder.remote_name, uid)?;
        let bytes = mime::extract_attachment_bytes(&raw, part_index)?;
        let store = MailStore::open(&dir)?;
        store.save_attachment_bytes(&account.id, &att_id, &bytes)?;
        Ok::<Vec<u8>, String>(bytes)
    })
    .await
    .map_err(|_| "下载附件中断".to_string())??;

    Ok(MailDownloadedAttachment {
        id: attachment_id,
        filename,
        content_type,
        size_bytes: bytes.len() as u64,
        bytes_base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
    })
}

#[tauri::command]
pub async fn mail_send(
    app: tauri::AppHandle,
    request: MailSendRequest,
) -> Result<MailSendResult, String> {
    let dir = data_dir(&app)?;
    let account = accounts::get_account(&dir, &request.account_id)?;
    let creds = accounts::read_credentials(&request.account_id)?;
    let (message_id, formatted_raw) = smtp_client::send_mail(&account, &creds, &request).await?;

    let should_append = match account.append_sent {
        AppendSentPolicy::Never => false,
        AppendSentPolicy::Always | AppendSentPolicy::Auto => true,
    };

    let mut appended_to_sent = false;
    if should_append {
        let store = MailStore::open(&dir)?;
        if let Ok(Some(sent_folder)) = store.find_special_folder(&account.id, "sent") {
            let append_account = account.clone();
            let append_creds = creds.clone();
            let remote_name = sent_folder.remote_name.clone();
            let res = tokio::task::spawn_blocking(move || {
                imap_client::append_to_sent(
                    &append_account,
                    &append_creds,
                    &remote_name,
                    &formatted_raw,
                )
            })
            .await;
            if let Ok(Ok(())) = res {
                appended_to_sent = true;
            }
        }
    }

    Ok(MailSendResult {
        message_id,
        appended_to_sent,
    })
}

#[tauri::command]
pub fn mail_cache_stats(app: tauri::AppHandle) -> Result<MailCacheStats, String> {
    let dir = data_dir(&app)?;
    let store = MailStore::open(&dir)?;
    store.cache_stats()
}

#[tauri::command]
pub fn mail_cache_clear(app: tauri::AppHandle) -> Result<MailCacheStats, String> {
    let dir = data_dir(&app)?;
    let store = MailStore::open(&dir)?;
    store.clear_cache()
}

#[tauri::command]
pub fn mail_drafts_list(
    app: tauri::AppHandle,
    account_id: Option<String>,
) -> Result<Vec<MailDraft>, String> {
    let dir = data_dir(&app)?;
    let store = MailStore::open(&dir)?;
    store.list_drafts(account_id.as_deref())
}

#[tauri::command]
pub fn mail_draft_save(app: tauri::AppHandle, draft: MailDraft) -> Result<MailDraft, String> {
    let dir = data_dir(&app)?;
    let store = MailStore::open(&dir)?;
    store.save_draft(draft)
}

#[tauri::command]
pub fn mail_draft_delete(app: tauri::AppHandle, draft_id: String) -> Result<(), String> {
    let dir = data_dir(&app)?;
    let store = MailStore::open(&dir)?;
    store.delete_draft(&draft_id)
}
