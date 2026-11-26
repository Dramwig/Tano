// SPDX-License-Identifier: MIT
//! Strict SSH host key verification (TOFU + MITM hard-block).
//! Checks user's `~/.ssh/known_hosts` (read-only) and `app_data_dir/ssh-known-hosts` (managed).

use super::{config::user_home_dir, types::KnownHostRecord};
use crate::storage;
use russh::keys::{
    known_hosts::{check_known_hosts_path, known_host_keys_path, learn_known_hosts_path},
    parse_public_key_base64, Error as KeyError, HashAlg, PublicKey,
};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

static KNOWN_HOSTS_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum HostKeyCheck {
    Trusted,
    Unknown {
        algorithm: String,
        fingerprint: String,
    },
    Mismatch {
        algorithm: String,
        fingerprint: String,
        previous_fingerprint: Option<String>,
        source: String,
    },
}

pub fn tano_known_hosts_path(app_data: &Path) -> PathBuf {
    app_data.join("ssh-known-hosts")
}

pub fn openssh_known_hosts_path() -> Option<PathBuf> {
    user_home_dir().map(|home| home.join(".ssh").join("known_hosts"))
}

pub fn fingerprint_sha256(key: &PublicKey) -> String {
    key.fingerprint(HashAlg::Sha256).to_string()
}

pub fn verify_host_key(
    app_data: &Path,
    hostname: &str,
    port: u16,
    server_key: &PublicKey,
) -> Result<HostKeyCheck, String> {
    let algorithm = server_key.algorithm().to_string();
    let fingerprint = fingerprint_sha256(server_key);
    let _guard = KNOWN_HOSTS_LOCK
        .lock()
        .map_err(|_| "无法检查 SSH 主机指纹")?;

    let tano_path = tano_known_hosts_path(app_data);
    let openssh_path = openssh_known_hosts_path();

    let mut matched = false;
    for (source, path) in [
        ("tano", Some(tano_path.as_path())),
        ("openssh", openssh_path.as_deref()),
    ] {
        let Some(path) = path else {
            continue;
        };
        if !path.is_file() {
            continue;
        }
        match check_known_hosts_path(hostname, port, server_key, path) {
            Ok(true) => matched = true,
            Ok(false) => {}
            Err(KeyError::KeyChanged { .. }) => {
                let previous = known_host_keys_path(hostname, port, path)
                    .ok()
                    .and_then(|keys| {
                        keys.into_iter()
                            .find(|(_, k)| k.algorithm() == server_key.algorithm())
                            .map(|(_, k)| fingerprint_sha256(&k))
                    });
                return Ok(HostKeyCheck::Mismatch {
                    algorithm,
                    fingerprint,
                    previous_fingerprint: previous,
                    source: source.to_owned(),
                });
            }
            Err(_) => {
                // Tolerate unrelated malformed/comment lines in user's OpenSSH known_hosts
                // while still failing safe on explicit key mismatch.
            }
        }
    }

    if matched {
        Ok(HostKeyCheck::Trusted)
    } else {
        Ok(HostKeyCheck::Unknown {
            algorithm,
            fingerprint,
        })
    }
}

pub fn trust_host_key(
    app_data: &Path,
    hostname: &str,
    port: u16,
    server_key: &PublicKey,
) -> Result<(), String> {
    let _guard = KNOWN_HOSTS_LOCK
        .lock()
        .map_err(|_| "无法保存 SSH 主机指纹")?;
    let path = tano_known_hosts_path(app_data);
    learn_known_hosts_path(hostname, port, server_key, &path)
        .map_err(|e| format!("无法保存受信任主机指纹：{e}"))
}

fn record_id(source: &str, line: &str) -> String {
    format!(
        "{source}:{}",
        &format!("{:x}", Sha256::digest(line.as_bytes()))[..16]
    )
}

fn parse_known_hosts_file(path: &Path, source: &str) -> Vec<KnownHostRecord> {
    let Ok(content) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let mut records = Vec::new();
    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut parts = line.split_whitespace();
        let Some(host_pattern) = parts.next() else {
            continue;
        };
        let Some(algorithm) = parts.next() else {
            continue;
        };
        let Some(key_b64) = parts.next() else {
            continue;
        };
        let fingerprint = parse_public_key_base64(key_b64)
            .map(|k| fingerprint_sha256(&k))
            .unwrap_or_else(|_| "无法解析".into());
        records.push(KnownHostRecord {
            id: record_id(source, line),
            host_pattern: host_pattern.to_owned(),
            algorithm: algorithm.to_owned(),
            fingerprint,
            source: source.to_owned(),
        });
    }
    records
}

pub fn list_known_hosts(app_data: &Path) -> Result<Vec<KnownHostRecord>, String> {
    let _guard = KNOWN_HOSTS_LOCK
        .lock()
        .map_err(|_| "无法读取已知主机列表")?;
    let mut records = parse_known_hosts_file(&tano_known_hosts_path(app_data), "tano");
    if let Some(openssh) = openssh_known_hosts_path() {
        records.extend(parse_known_hosts_file(&openssh, "openssh"));
    }
    Ok(records)
}

/// Remove a host fingerprint stored in Tano's managed `ssh-known-hosts` file.
/// User's `~/.ssh/known_hosts` is intentionally read-only.
pub fn remove_known_host(app_data: &Path, id: &str) -> Result<(), String> {
    if !id.starts_with("tano:") {
        return Err("系统 ~/.ssh/known_hosts 条目为只读，请在终端中使用 ssh-keygen -R 移除".into());
    }
    let _guard = KNOWN_HOSTS_LOCK
        .lock()
        .map_err(|_| "无法更新已知主机列表")?;
    let path = tano_known_hosts_path(app_data);
    if !path.is_file() {
        return Ok(());
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("无法读取已知主机列表：{e}"))?;
    let mut kept = Vec::new();
    for raw_line in content.lines() {
        let trimmed = raw_line.trim();
        if !trimmed.is_empty() && !trimmed.starts_with('#') && record_id("tano", trimmed) == id {
            continue;
        }
        kept.push(raw_line);
    }
    let next = if kept.is_empty() {
        String::new()
    } else {
        format!("{}\n", kept.join("\n"))
    };
    storage::temporary(&path, next.as_bytes())?
        .persist(&path)
        .map_err(|e| format!("无法更新已知主机列表：{e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use russh::keys::ssh_key::{private::Ed25519Keypair, PrivateKey};

    #[test]
    fn verifies_trusts_detects_mismatch_and_removes_known_hosts() {
        let dir = tempfile::tempdir().unwrap();
        let key1 = PrivateKey::from(Ed25519Keypair::from_seed(&[1u8; 32]));
        let key2 = PrivateKey::from(Ed25519Keypair::from_seed(&[2u8; 32]));
        let pub1 = key1.public_key();
        let pub2 = key2.public_key();

        assert!(matches!(
            verify_host_key(dir.path(), "test.tano.invalid", 2222, pub1).unwrap(),
            HostKeyCheck::Unknown { .. }
        ));
        trust_host_key(dir.path(), "test.tano.invalid", 2222, pub1).unwrap();
        assert_eq!(
            verify_host_key(dir.path(), "test.tano.invalid", 2222, pub1).unwrap(),
            HostKeyCheck::Trusted
        );
        assert!(matches!(
            verify_host_key(dir.path(), "test.tano.invalid", 2222, pub2).unwrap(),
            HostKeyCheck::Mismatch { .. }
        ));

        let listed = list_known_hosts(dir.path()).unwrap();
        let tano_entry = listed.iter().find(|r| r.source == "tano").unwrap();
        remove_known_host(dir.path(), &tano_entry.id).unwrap();
        assert!(matches!(
            verify_host_key(dir.path(), "test.tano.invalid", 2222, pub1).unwrap(),
            HostKeyCheck::Unknown { .. }
        ));
    }
}
