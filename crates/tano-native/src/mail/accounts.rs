//! Device-local mail account registry and OS keyring credential storage.
//! Account metadata lives under app_data_dir/mail-accounts.json; passwords/app-passwords
//! are chunked atomically into the OS keyring under the `Tano.Mail` service namespace
//! and never enter workspace files or frontend state.

use super::types::{
    unix_timestamp_secs, validate_account_input, MailAccount, MailAccountInput, MailCredentials,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::Mutex,
};

const KEYRING_SERVICE: &str = "Tano.Mail";

static ACCOUNTS_LOCK: Mutex<()> = Mutex::new(());
static KEYRING_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize, Deserialize)]
struct CredentialManifest {
    generation: String,
    chunks: usize,
}

fn validate_uuid(value: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| "邮箱账号 ID 无效".into())
}

fn manifest_entry(account_id: &str) -> Result<keyring::Entry, String> {
    validate_uuid(account_id)?;
    keyring::Entry::new(KEYRING_SERVICE, account_id).map_err(|_| "无法访问系统凭据库".into())
}

fn chunk_entry(
    account_id: &str,
    manifest: &CredentialManifest,
    index: usize,
) -> Result<keyring::Entry, String> {
    validate_uuid(account_id)?;
    validate_uuid(&manifest.generation)?;
    keyring::Entry::new(
        KEYRING_SERVICE,
        &format!("{account_id}:{}:{index}", manifest.generation),
    )
    .map_err(|_| "无法访问系统凭据库".into())
}

fn read_manifest(account_id: &str) -> Result<CredentialManifest, String> {
    let raw = manifest_entry(account_id)?
        .get_password()
        .map_err(|_| "邮箱授权信息不可用，请重新填写授权码")?;
    let manifest: CredentialManifest =
        serde_json::from_str(&raw).map_err(|_| "邮箱授权信息损坏，请重新填写授权码")?;
    validate_uuid(&manifest.generation)?;
    if manifest.chunks == 0 || manifest.chunks > 64 {
        return Err("邮箱授权信息无效".into());
    }
    Ok(manifest)
}

fn remove_chunks(account_id: &str, manifest: &CredentialManifest) {
    for index in 0..manifest.chunks {
        if let Ok(entry) = chunk_entry(account_id, manifest, index) {
            let _ = entry.delete_credential();
        }
    }
}

pub fn save_credentials(account_id: &str, credentials: &MailCredentials) -> Result<(), String> {
    let has_secret = !credentials.password.is_empty()
        || credentials
            .access_token
            .as_deref()
            .is_some_and(|v| !v.is_empty())
        || credentials
            .refresh_token
            .as_deref()
            .is_some_and(|v| !v.is_empty());
    if credentials.username.trim().is_empty() || !has_secret {
        return Err("请填写完整的邮箱账号与授权凭据".into());
    }
    let _guard = KEYRING_LOCK.lock().map_err(|_| "无法访问系统凭据库")?;
    let previous = read_manifest(account_id).ok();
    let bytes = serde_json::to_vec(credentials).map_err(|e| e.to_string())?;
    // Stay well below the 2560-byte Windows Credential Manager blob limit.
    let manifest = CredentialManifest {
        generation: uuid::Uuid::new_v4().to_string(),
        chunks: bytes.len().div_ceil(2000),
    };
    if manifest.chunks > 64 {
        return Err("授权信息过大".into());
    }
    let commit = || -> Result<(), String> {
        for (index, chunk) in bytes.chunks(2000).enumerate() {
            chunk_entry(account_id, &manifest, index)?
                .set_secret(chunk)
                .map_err(|_| "无法保存到系统凭据库，邮箱账号未保存")?;
        }
        let encoded = serde_json::to_string(&manifest).map_err(|e| e.to_string())?;
        manifest_entry(account_id)?
            .set_password(&encoded)
            .map_err(|_| "无法保存到系统凭据库，邮箱账号未保存".into())
    };
    if let Err(err) = commit() {
        remove_chunks(account_id, &manifest);
        return Err(err);
    }
    if let Some(old) = previous {
        remove_chunks(account_id, &old);
    }
    Ok(())
}

pub fn read_credentials(account_id: &str) -> Result<MailCredentials, String> {
    let _guard = KEYRING_LOCK.lock().map_err(|_| "无法访问系统凭据库")?;
    let manifest = read_manifest(account_id)?;
    let mut bytes = Vec::new();
    for index in 0..manifest.chunks {
        bytes.extend(
            chunk_entry(account_id, &manifest, index)?
                .get_secret()
                .map_err(|_| "邮箱授权信息不可用，请重新填写授权码")?,
        );
    }
    serde_json::from_slice(&bytes).map_err(|_| "邮箱授权信息损坏，请重新填写授权码".into())
}

pub fn delete_credentials(account_id: &str) -> Result<(), String> {
    let _guard = KEYRING_LOCK.lock().map_err(|_| "无法访问系统凭据库")?;
    let manifest = read_manifest(account_id).ok();
    match manifest_entry(account_id)?.delete_credential() {
        Ok(_) | Err(keyring::Error::NoEntry) => {}
        Err(_) => return Err("无法移除系统凭据，请重试".into()),
    }
    if let Some(old) = manifest {
        remove_chunks(account_id, &old);
    }
    Ok(())
}

fn accounts_file(data_dir: &Path) -> PathBuf {
    data_dir.join("mail-accounts.json")
}

fn read_accounts_map(data_dir: &Path) -> Result<BTreeMap<String, MailAccount>, String> {
    let path = accounts_file(data_dir);
    if !path.exists() {
        return Ok(BTreeMap::new());
    }
    let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|_| "邮箱账号配置损坏，原文件已保留".into())
}

pub(crate) fn write_accounts_map(
    data_dir: &Path,
    map: &BTreeMap<String, MailAccount>,
) -> Result<(), String> {
    std::fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
    let path = accounts_file(data_dir);
    let body = serde_json::to_string_pretty(map).map_err(|e| e.to_string())?;
    // App-data registry file: write atomically without workspace document extension checks.
    crate::storage::temporary(&path, body.as_bytes())?
        .persist(&path)
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list_accounts(data_dir: &Path) -> Result<Vec<MailAccount>, String> {
    let _guard = ACCOUNTS_LOCK.lock().map_err(|e| e.to_string())?;
    let mut items: Vec<MailAccount> = read_accounts_map(data_dir)?.into_values().collect();
    items.sort_by_key(|item| (item.created_at, item.email.clone()));
    Ok(items)
}

pub fn get_account(data_dir: &Path, account_id: &str) -> Result<MailAccount, String> {
    validate_uuid(account_id)?;
    let _guard = ACCOUNTS_LOCK.lock().map_err(|e| e.to_string())?;
    read_accounts_map(data_dir)?
        .remove(account_id)
        .ok_or_else(|| "找不到该邮箱账号".into())
}

pub fn save_account(
    data_dir: &Path,
    input: MailAccountInput,
    credentials: Option<MailCredentials>,
) -> Result<MailAccount, String> {
    let validated = validate_account_input(&input)?;
    let _guard = ACCOUNTS_LOCK.lock().map_err(|e| e.to_string())?;
    let mut map = read_accounts_map(data_dir)?;
    let (id, created_at) = match validated.id {
        Some(existing_id) => {
            validate_uuid(&existing_id)?;
            let existing = map
                .get(&existing_id)
                .ok_or_else(|| "要更新的邮箱账号不存在".to_string())?;
            (existing_id, existing.created_at)
        }
        None => (
            uuid::Uuid::new_v4().to_string(),
            unix_timestamp_secs().max(0) as u64,
        ),
    };
    let account = MailAccount {
        id: id.clone(),
        provider: validated.provider,
        label: validated.label,
        email: validated.email.clone(),
        display_name: if validated.display_name.is_empty() {
            validated.email.clone()
        } else {
            validated.display_name
        },
        auth_kind: validated.auth_kind,
        oauth_client_id: validated.oauth_client_id,
        oauth_tenant: validated.oauth_tenant,
        imap_host: validated.imap_host,
        imap_port: validated.imap_port,
        imap_tls: validated.imap_tls,
        smtp_host: validated.smtp_host,
        smtp_port: validated.smtp_port,
        smtp_tls: validated.smtp_tls,
        append_sent: validated.append_sent,
        send_imap_id: validated.send_imap_id,
        created_at,
    };

    let is_new = !map.contains_key(&id);
    if let Some(mut creds) = credentials {
        if creds.username.trim().is_empty() {
            creds.username = account.email.clone();
        }
        save_credentials(&id, &creds)?;
    } else if is_new {
        return Err("新增邮箱账号必须提供授权码或密码".into());
    }

    map.insert(id.clone(), account.clone());
    if let Err(err) = write_accounts_map(data_dir, &map) {
        if is_new {
            let _ = delete_credentials(&id);
        }
        return Err(err);
    }
    Ok(account)
}

pub fn remove_account(data_dir: &Path, account_id: &str) -> Result<(), String> {
    validate_uuid(account_id)?;
    let _guard = ACCOUNTS_LOCK.lock().map_err(|e| e.to_string())?;
    let mut map = read_accounts_map(data_dir)?;
    delete_credentials(account_id)?;
    if map.remove(account_id).is_some() {
        write_accounts_map(data_dir, &map)?;
    }
    Ok(())
}
