// SPDX-License-Identifier: MIT
//! OS keyring secret storage for SSH passwords and key passphrases.
//! Follows the same atomic chunked manifest pattern as `mail/accounts.rs`
//! under the dedicated `Tano.Ssh` keyring service namespace.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;

const KEYRING_SERVICE: &str = "Tano.Ssh";

static KEYRING_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshSecrets {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub passphrase: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct CredentialManifest {
    generation: String,
    chunks: usize,
}

fn validate_host_key(host_id: &str) -> Result<(), String> {
    if super::uri::is_valid_host_id(host_id) {
        Ok(())
    } else {
        Err("SSH 主机标识无效".into())
    }
}

fn manifest_entry(host_id: &str) -> Result<keyring::Entry, String> {
    validate_host_key(host_id)?;
    keyring::Entry::new(KEYRING_SERVICE, host_id).map_err(|_| "无法访问系统凭据库".into())
}

fn chunk_entry(
    host_id: &str,
    manifest: &CredentialManifest,
    index: usize,
) -> Result<keyring::Entry, String> {
    validate_host_key(host_id)?;
    uuid::Uuid::parse_str(&manifest.generation).map_err(|_| "SSH 凭据格式无效")?;
    keyring::Entry::new(
        KEYRING_SERVICE,
        &format!("{host_id}:{}:{index}", manifest.generation),
    )
    .map_err(|_| "无法访问系统凭据库".into())
}

fn read_manifest(host_id: &str) -> Result<Option<CredentialManifest>, String> {
    let raw = match manifest_entry(host_id)?.get_password() {
        Ok(raw) => raw,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(_) => return Err("无法读取系统凭据库中的 SSH 凭据".into()),
    };
    let manifest: CredentialManifest =
        serde_json::from_str(&raw).map_err(|_| "SSH 凭据索引损坏，请重新输入凭据")?;
    uuid::Uuid::parse_str(&manifest.generation).map_err(|_| "SSH 凭据索引无效")?;
    if manifest.chunks == 0 || manifest.chunks > 64 {
        return Err("SSH 凭据索引无效".into());
    }
    Ok(Some(manifest))
}

fn remove_chunks(host_id: &str, manifest: &CredentialManifest) {
    for index in 0..manifest.chunks {
        if let Ok(entry) = chunk_entry(host_id, manifest, index) {
            let _ = entry.delete_credential();
        }
    }
}

pub fn read_secrets(host_id: &str) -> Result<SshSecrets, String> {
    let _guard = KEYRING_LOCK.lock().map_err(|_| "无法访问系统凭据库")?;
    let Some(manifest) = read_manifest(host_id)? else {
        return Ok(SshSecrets::default());
    };
    let mut bytes = Vec::new();
    for index in 0..manifest.chunks {
        bytes.extend(
            chunk_entry(host_id, &manifest, index)?
                .get_secret()
                .map_err(|_| "SSH 凭据不可用，请重新输入密码或口令")?,
        );
    }
    serde_json::from_slice(&bytes).map_err(|_| "SSH 凭据内容损坏，请重新输入".into())
}

pub fn save_secrets(host_id: &str, secrets: &SshSecrets) -> Result<(), String> {
    if secrets.password.is_none() && secrets.passphrase.is_none() {
        return delete_secrets(host_id);
    }
    let _guard = KEYRING_LOCK.lock().map_err(|_| "无法访问系统凭据库")?;
    let previous = read_manifest(host_id).ok().flatten();
    let bytes = serde_json::to_vec(secrets).map_err(|e| e.to_string())?;
    let manifest = CredentialManifest {
        generation: uuid::Uuid::new_v4().to_string(),
        chunks: bytes.len().div_ceil(2000),
    };
    if manifest.chunks > 64 {
        return Err("SSH 凭据内容过大".into());
    }
    let commit = || -> Result<(), String> {
        for (index, chunk) in bytes.chunks(2000).enumerate() {
            chunk_entry(host_id, &manifest, index)?
                .set_secret(chunk)
                .map_err(|_| "无法保存 SSH 凭据到系统凭据库")?;
        }
        let encoded = serde_json::to_string(&manifest).map_err(|e| e.to_string())?;
        manifest_entry(host_id)?
            .set_password(&encoded)
            .map_err(|_| "无法保存 SSH 凭据到系统凭据库".into())
    };
    if let Err(err) = commit() {
        remove_chunks(host_id, &manifest);
        return Err(err);
    }
    if let Some(old) = previous {
        remove_chunks(host_id, &old);
    }
    Ok(())
}

pub fn delete_secrets(host_id: &str) -> Result<(), String> {
    let _guard = KEYRING_LOCK.lock().map_err(|_| "无法访问系统凭据库")?;
    let previous = read_manifest(host_id).ok().flatten();
    if let Ok(entry) = manifest_entry(host_id) {
        let _ = entry.delete_credential();
    }
    if let Some(old) = previous {
        remove_chunks(host_id, &old);
    }
    Ok(())
}
