//! Immutable OS credentials, with a durable cleanup journal in application data.
//! Callers hold the selected workspace session (including its cross-process OS lock)
//! and STATE_LOCK throughout every load/mutation. No primary workspace content lives here.
use super::plugin_connection_types::{valid_secret, Config, Connection, Input, OAuthMetadata};
use super::plugin_oauth_types::{self as oauth, Grant};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::Mutex,
};
pub static STATE_LOCK: Mutex<()> = Mutex::new(());

pub trait Vault {
    fn put(&self, id: &str, part: usize, value: &[u8]) -> Result<(), String>;
    fn get(&self, id: &str, part: usize) -> Result<Vec<u8>, String>;
    fn remove(&self, id: &str, part: usize) -> Result<(), String>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        cell::{Cell, RefCell},
        collections::HashMap,
    };
    #[derive(Default)]
    struct MemoryVault {
        values: RefCell<HashMap<(String, usize), Vec<u8>>>,
        fail_put: Cell<Option<usize>>,
        fail_remove: Cell<bool>,
    }
    impl Vault for MemoryVault {
        fn put(&self, id: &str, part: usize, value: &[u8]) -> Result<(), String> {
            if self.fail_put.get() == Some(part) {
                return Err("locked".into());
            }
            self.values
                .borrow_mut()
                .insert((id.into(), part), value.to_vec());
            Ok(())
        }
        fn get(&self, id: &str, part: usize) -> Result<Vec<u8>, String> {
            self.values
                .borrow()
                .get(&(id.into(), part))
                .cloned()
                .ok_or("missing".into())
        }
        fn remove(&self, id: &str, part: usize) -> Result<(), String> {
            if self.fail_remove.get() {
                return Err("locked".into());
            }
            self.values.borrow_mut().remove(&(id.into(), part));
            Ok(())
        }
    }
    fn input(secret: Option<&str>, version: Option<&str>) -> Input {
        Input {
            config: super::super::plugin_connection_types::Config {
                plugin_id: "test".into(),
                origin: "https://api.example.test".into(),
                integrity: "a".repeat(64),
                methods: vec!["GET".into()],
                path_prefix: "/v1/".into(),
                authentication: "bearer".into(),
            },
            secret: secret.map(Into::into),
            version: version.map(Into::into),
        }
    }
    #[test]
    fn restart_cas_renewal_and_revocation_keep_secrets_out_of_metadata() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connections.tano.json");
        let vault = MemoryVault::default();
        let secret = "LongPrivateSecret".repeat(240);
        let first = Store::open(&path)
            .unwrap()
            .save(input(Some(&secret), None), &vault, || Ok(()))
            .unwrap();
        let mut reopened = Store::open(&path).unwrap();
        assert_eq!(
            Store::secret(&reopened.data.records[0], &vault).unwrap(),
            secret
        );
        assert_eq!(vault.values.borrow().len(), 3);
        assert!(!std::fs::read_to_string(&path)
            .unwrap()
            .contains("LongPrivateSecret"));
        assert!(!serde_json::to_string(&reopened.list())
            .unwrap()
            .contains("credential"));
        assert!(reopened
            .save(input(Some("another-secret"), None), &vault, || Ok(()))
            .is_err());
        let mut update = input(None, Some(&first.version));
        update.config.integrity = "b".repeat(64);
        let second = reopened.save(update, &vault, || Ok(())).unwrap();
        assert_ne!(second.version, first.version);
        assert_eq!(vault.values.borrow().len(), 3);
        assert_eq!(
            Store::secret(&reopened.data.records[0], &vault).unwrap(),
            secret
        );
        assert!(reopened
            .remove("test", &first.config.origin, &first.version, &vault)
            .is_err());
        reopened
            .remove("test", &first.config.origin, &second.version, &vault)
            .unwrap();
        assert!(Store::open(&path).unwrap().list().is_empty());
        assert!(vault.values.borrow().is_empty());
        assert!(Store::open(&dir.path().join("different-workspace.json"))
            .unwrap()
            .list()
            .is_empty());
    }
    #[test]
    fn partial_credential_writes_and_cancelled_commit_preserve_previous_connection() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connections.tano.json");
        let vault = MemoryVault::default();
        let first = Store::open(&path)
            .unwrap()
            .save(input(Some("original-secret"), None), &vault, || Ok(()))
            .unwrap();
        vault.fail_put.set(Some(1));
        assert!(Store::open(&path)
            .unwrap()
            .save(
                input(Some(&"x".repeat(4096)), Some(&first.version)),
                &vault,
                || Ok(())
            )
            .is_err());
        let mut reopened = Store::open(&path).unwrap();
        assert_eq!(
            Store::secret(&reopened.data.records[0], &vault).unwrap(),
            "original-secret"
        );
        assert_eq!(reopened.data.pending.len(), 1);
        vault.fail_put.set(None);
        reopened.cleanup(&vault).unwrap();
        assert_eq!(vault.values.borrow().len(), 1);
        let calls = Cell::new(0);
        assert!(reopened
            .save(
                input(Some("replacement-secret"), Some(&first.version)),
                &vault,
                || {
                    calls.set(calls.get() + 1);
                    if calls.get() == 2 {
                        Err("cancelled".into())
                    } else {
                        Ok(())
                    }
                }
            )
            .is_err());
        let mut reopened = Store::open(&path).unwrap();
        reopened.cleanup(&vault).unwrap();
        assert_eq!(reopened.list()[0].version, first.version);
        assert_eq!(vault.values.borrow().len(), 1);
    }
    #[test]
    fn revocation_is_durable_when_keyring_is_locked_and_cleanup_can_retry() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connections.tano.json");
        let vault = MemoryVault::default();
        let first = Store::open(&path)
            .unwrap()
            .save(input(Some("private-secret"), None), &vault, || Ok(()))
            .unwrap();
        vault.fail_remove.set(true);
        assert!(Store::open(&path)
            .unwrap()
            .remove("test", &first.config.origin, &first.version, &vault)
            .is_err());
        let mut reopened = Store::open(&path).unwrap();
        assert!(reopened.list().is_empty());
        assert_eq!(reopened.data.pending.len(), 1);
        vault.fail_remove.set(false);
        reopened
            .remove("test", &first.config.origin, &first.version, &vault)
            .unwrap();
        assert!(vault.values.borrow().is_empty());
        assert!(Store::open(&path).unwrap().data.pending.is_empty());
    }
    #[test]
    fn external_metadata_edit_is_preserved_and_authentication_change_requires_new_secret() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connections.tano.json");
        let vault = MemoryVault::default();
        let first = Store::open(&path)
            .unwrap()
            .save(input(Some("private-secret"), None), &vault, || Ok(()))
            .unwrap();
        let mut stale = Store::open(&path).unwrap();
        let external = format!("{}\n", std::fs::read_to_string(&path).unwrap());
        std::fs::write(&path, &external).unwrap();
        assert!(stale
            .save(
                input(Some("new-secret"), Some(&first.version)),
                &vault,
                || Ok(())
            )
            .is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), external);
        assert_eq!(vault.values.borrow().len(), 1);
        let mut changed = input(None, Some(&first.version));
        changed.config.authentication = "x-api-key".into();
        assert!(Store::open(&path)
            .unwrap()
            .save(changed, &vault, || Ok(()))
            .is_err());
    }
    fn grant(config: &Config) -> Grant {
        let provider = oauth::Provider {
            id: "example".into(),
            label: "示例服务".into(),
            origin: config.origin.clone(),
            scopes: vec!["read".into()],
            authorization_endpoint: "https://login.example.test/authorize".into(),
            token_endpoint: "https://login.example.test/token".into(),
            client_id: "test-client".into(),
        };
        Grant::new(
            &provider,
            config,
            oauth::Tokens {
                access_token: "a".repeat(4096),
                refresh_token: Some("r".repeat(4096)),
                expires_at: Some(1),
            },
        )
    }
    #[test]
    fn oauth_envelopes_survive_restart_without_plaintext_or_api_key_downgrade() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connections.tano.json");
        let vault = MemoryVault::default();
        let config = input(None, None).config;
        let grant = grant(&config);
        let saved = Store::open(&path)
            .unwrap()
            .save_oauth(config.clone(), None, grant.clone(), None, &vault, || Ok(()))
            .unwrap();
        let reopened = Store::open(&path).unwrap();
        let record = reopened.find("test", &config.origin).unwrap();
        assert_eq!(reopened.data.version, 2);
        assert!(vault.values.borrow().len() > 3);
        assert_eq!(
            Store::grant(&record, &vault).unwrap().tokens.refresh_token,
            grant.tokens.refresh_token
        );
        assert!(Store::secret(&record, &vault).is_err());
        let bytes = std::fs::read_to_string(&path).unwrap();
        assert!(!bytes.contains("accessToken"));
        assert!(!bytes.contains(&"r".repeat(64)));
        assert!(Store::open(&path)
            .unwrap()
            .save(input(None, Some(&saved.version)), &vault, || Ok(()))
            .is_err());
        let api = Store::open(&path)
            .unwrap()
            .save(
                input(Some("replacement-api-key"), Some(&saved.version)),
                &vault,
                || Ok(()),
            )
            .unwrap();
        assert!(api.oauth.is_none());
        assert_eq!(vault.values.borrow().len(), 1);
    }
    #[test]
    fn durable_refresh_claim_prevents_replay_and_retains_the_grant_version_after_rotation() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connections.tano.json");
        let vault = MemoryVault::default();
        let config = input(None, None).config;
        let saved = Store::open(&path)
            .unwrap()
            .save_oauth(
                config.clone(),
                None,
                grant(&config),
                None,
                &vault,
                || Ok(()),
            )
            .unwrap();
        let mut store = Store::open(&path).unwrap();
        let record = store.find("test", &config.origin).unwrap();
        let claim = store.claim_refresh(&record).unwrap();
        assert!(Store::open(&path).unwrap().claim_refresh(&record).is_err());
        let mut changed = grant(&config);
        changed.tokens.access_token = "rotated-access-token".into();
        changed.tokens.refresh_token = Some("rotated-refresh-token".into());
        assert!(Store::open(&path)
            .unwrap()
            .save_oauth(
                config.clone(),
                Some(&saved.version),
                changed.clone(),
                Some("wrong"),
                &vault,
                || Ok(())
            )
            .is_err());
        let rotated = Store::open(&path)
            .unwrap()
            .save_oauth(
                config.clone(),
                Some(&saved.version),
                changed,
                Some(&claim.id),
                &vault,
                || Ok(()),
            )
            .unwrap();
        assert_eq!(rotated.version, saved.version);
        let record = Store::open(&path)
            .unwrap()
            .find("test", &config.origin)
            .unwrap();
        assert!(record.refresh.is_none());
        assert_eq!(
            Store::grant(&record, &vault).unwrap().tokens.access_token,
            "rotated-access-token"
        );
        assert_eq!(vault.values.borrow().len(), 1);
        let mut tampered = record.clone();
        tampered.connection.config.integrity = "b".repeat(64);
        assert!(Store::grant(&tampered, &vault).is_err());
        Store::open(&path)
            .unwrap()
            .remove("test", &config.origin, &saved.version, &vault)
            .unwrap();
        assert!(vault.values.borrow().is_empty());
    }
    #[test]
    fn failed_rotated_token_save_keeps_an_uncertain_claim_instead_of_reusing_old_refresh_token() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connections.tano.json");
        let vault = MemoryVault::default();
        let config = input(None, None).config;
        let saved = Store::open(&path)
            .unwrap()
            .save_oauth(
                config.clone(),
                None,
                grant(&config),
                None,
                &vault,
                || Ok(()),
            )
            .unwrap();
        let mut store = Store::open(&path).unwrap();
        let record = store.find("test", &config.origin).unwrap();
        let claim = store.claim_refresh(&record).unwrap();
        vault.fail_put.set(Some(1));
        assert!(store
            .save_oauth(
                config.clone(),
                Some(&saved.version),
                grant(&config),
                Some(&claim.id),
                &vault,
                || Ok(())
            )
            .is_err());
        let mut store = Store::open(&path).unwrap();
        assert!(store.claim_refresh(&record).is_err());
        assert_eq!(
            store
                .find("test", &config.origin)
                .unwrap()
                .connection
                .version,
            saved.version
        );
        vault.fail_put.set(None);
        store
            .remove("test", &config.origin, &saved.version, &vault)
            .unwrap();
        assert!(vault.values.borrow().is_empty());
    }
}
pub struct SystemVault {
    pub service: String,
}
impl SystemVault {
    fn entry(&self, id: &str, part: usize) -> Result<keyring::Entry, String> {
        uuid::Uuid::parse_str(id).map_err(|_| "凭据引用无效")?;
        keyring::Entry::new(&self.service, &format!("{id}:{part}"))
            .map_err(|_| "无法访问系统凭据库".into())
    }
}
impl Vault for SystemVault {
    fn put(&self, id: &str, part: usize, value: &[u8]) -> Result<(), String> {
        self.entry(id, part)?
            .set_secret(value)
            .map_err(|_| "无法保存系统凭据；连接未保存".into())
    }
    fn get(&self, id: &str, part: usize) -> Result<Vec<u8>, String> {
        self.entry(id, part)?
            .get_secret()
            .map_err(|_| "系统凭据不可用，请解锁凭据库或重新配置连接".into())
    }
    fn remove(&self, id: &str, part: usize) -> Result<(), String> {
        match self.entry(id, part)?.delete_credential() {
            Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err("系统凭据清理未完成，请解锁凭据库后刷新连接重试".into()),
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Credential {
    id: String,
    parts: usize,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Record {
    pub connection: Connection,
    credential: Credential,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh: Option<RefreshClaim>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RefreshClaim {
    pub id: String,
    pub started: u64,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Data {
    version: u32,
    records: Vec<Record>,
    pending: Vec<Credential>,
}
pub struct Store {
    path: PathBuf,
    hash: Option<String>,
    data: Data,
}
impl Store {
    pub fn open(path: &Path) -> Result<Self, String> {
        let (data, hash) = if path.exists() {
            let bytes = crate::plugin_git::read_bounded(path, 256 * 1024)?;
            let hash = crate::storage::hash(&bytes);
            (
                serde_json::from_slice::<Data>(&bytes).map_err(|_| "连接配置损坏，原文件已保留")?,
                Some(hash),
            )
        } else {
            (
                Data {
                    version: 1,
                    records: vec![],
                    pending: vec![],
                },
                None,
            )
        };
        if ![1, 2].contains(&data.version) || data.records.len() > 20 || data.pending.len() > 64 {
            return Err("连接配置无效".into());
        }
        let mut scopes = HashSet::new();
        let mut refs = HashSet::new();
        for record in &data.records {
            record.connection.config.validate()?;
            if record
                .connection
                .oauth
                .as_ref()
                .is_some_and(|oauth| !super::plugin_connection_types::valid_id(&oauth.provider_id))
                || record.connection.oauth.is_some()
                    && (data.version != 2 || record.connection.config.authentication != "bearer")
                || record.refresh.as_ref().is_some_and(|claim| {
                    record.connection.oauth.is_none() || uuid::Uuid::parse_str(&claim.id).is_err()
                })
            {
                return Err("账号连接配置无效".into());
            }
            if !scopes.insert((
                &record.connection.config.plugin_id,
                &record.connection.config.origin,
            )) || uuid::Uuid::parse_str(&record.connection.version).is_err()
                || !record.connection.has_secret
            {
                return Err("连接配置无效".into());
            }
        }
        for credential in data
            .records
            .iter()
            .map(|r| &r.credential)
            .chain(data.pending.iter())
        {
            if uuid::Uuid::parse_str(&credential.id).is_err()
                || !(1..=if data.version == 2 { 11 } else { 3 }).contains(&credential.parts)
                || !refs.insert(&credential.id)
            {
                return Err("连接凭据引用无效".into());
            }
        }
        Ok(Self {
            path: path.to_owned(),
            hash,
            data,
        })
    }
    fn commit(&mut self) -> Result<(), String> {
        let content = serde_json::to_string(&self.data).map_err(|_| "连接配置无效")?;
        if let Some(hash) = &self.hash {
            if !matches!(
                crate::storage::write(&self.path, &content, hash)?,
                crate::storage::WriteResult::Saved { .. }
            ) {
                return Err("连接配置已变化，请刷新后重试".into());
            }
        } else {
            std::fs::create_dir_all(self.path.parent().ok_or("连接配置路径无效")?)
                .map_err(|_| "无法保存连接配置")?;
            crate::storage::create(&self.path, &content)?;
        }
        self.hash = Some(crate::storage::hash(content.as_bytes()));
        Ok(())
    }
    pub fn cleanup(&mut self, vault: &impl Vault) -> Result<(), String> {
        if self.data.pending.is_empty() {
            return Ok(());
        }
        let mut failed = false;
        self.data.pending.retain(|credential| {
            let mut keep = false;
            for part in 0..credential.parts {
                if vault.remove(&credential.id, part).is_err() {
                    keep = true;
                }
            }
            failed |= keep;
            keep
        });
        self.commit()?;
        if failed {
            Err("系统凭据清理未完成，请解锁凭据库后刷新连接重试".into())
        } else {
            Ok(())
        }
    }
    pub fn list(&self) -> Vec<Connection> {
        self.data
            .records
            .iter()
            .map(|r| r.connection.clone())
            .collect()
    }
    pub fn find(&self, plugin: &str, origin: &str) -> Option<Record> {
        self.data
            .records
            .iter()
            .find(|r| {
                r.connection.config.plugin_id == plugin && r.connection.config.origin == origin
            })
            .cloned()
    }
    fn credential(record: &Record, vault: &impl Vault) -> Result<String, String> {
        let mut bytes = Vec::new();
        for part in 0..record.credential.parts {
            let chunk = vault.get(&record.credential.id, part)?;
            if chunk.len() > 2000 {
                return Err("系统凭据无效，请重新配置".into());
            }
            bytes.extend(chunk);
        }
        if bytes.len() > 20 * 1024 {
            return Err("系统凭据无效".into());
        }
        String::from_utf8(bytes).map_err(|_| "系统凭据无效".into())
    }
    pub fn secret(record: &Record, vault: &impl Vault) -> Result<String, String> {
        if record.connection.oauth.is_some() {
            return Err("账号连接需要重新登录授权，不能沿用内部令牌作为 API 密钥".into());
        }
        let secret = Self::credential(record, vault)?;
        if !valid_secret(&secret) {
            return Err("系统凭据无效，请重新配置".into());
        }
        Ok(secret)
    }
    pub fn grant(record: &Record, vault: &impl Vault) -> Result<Grant, String> {
        let metadata = record
            .connection
            .oauth
            .as_ref()
            .ok_or("连接不是 OAuth 账号")?;
        let grant: Grant = serde_json::from_str(&Self::credential(record, vault)?)
            .map_err(|_| "系统账号凭据无效")?;
        grant.validate(&record.connection.config, &metadata.provider_id)?;
        Ok(grant)
    }
    pub fn save(
        &mut self,
        input: Input,
        vault: &impl Vault,
        check: impl Fn() -> Result<(), String>,
    ) -> Result<Connection, String> {
        input.config.validate()?;
        let old = self.find(&input.config.plugin_id, &input.config.origin);
        if old.as_ref().map(|r| &r.connection.version) != input.version.as_ref() {
            return Err("连接版本已变化，请刷新后重试".into());
        }
        if old.is_none() && self.data.records.len() >= 20 {
            return Err("此工作区的服务连接已达到 20 个".into());
        }
        let secret = match input.secret {
            Some(secret) if valid_secret(&secret) => secret,
            Some(_) => return Err("密钥格式无效".into()),
            None => {
                let record = old.as_ref().ok_or("请输入服务密钥")?;
                if record.connection.config.authentication != input.config.authentication {
                    return Err("更改认证方式时必须重新输入密钥".into());
                }
                Self::secret(record, vault)?
            }
        };
        self.write_credential(input.config, old, secret, None, false, vault, check)
    }
    pub fn save_oauth(
        &mut self,
        config: Config,
        version: Option<&str>,
        grant: Grant,
        refresh_claim: Option<&str>,
        vault: &impl Vault,
        check: impl Fn() -> Result<(), String>,
    ) -> Result<Connection, String> {
        config.validate()?;
        grant.validate(&config, &grant.provider_id)?;
        let old = self.find(&config.plugin_id, &config.origin);
        if old
            .as_ref()
            .map(|record| record.connection.version.as_str())
            != version
        {
            return Err("连接版本已变化，请重新登录授权".into());
        }
        if old.is_none() && self.data.records.len() >= 20 {
            return Err("此工作区的服务连接已达到 20 个".into());
        }
        if let Some(claim) = refresh_claim {
            if old
                .as_ref()
                .and_then(|record| record.refresh.as_ref())
                .is_none_or(|current| current.id != claim)
            {
                return Err("账号刷新已取消或被替换".into());
            }
        }
        let secret = serde_json::to_string(&grant).map_err(|_| "系统账号凭据无效")?;
        if secret.len() > 20 * 1024 {
            return Err("账号令牌超过凭据容量".into());
        }
        // Version 2 prevents old binaries from treating a compact token envelope as an API key.
        self.data.version = 2;
        self.write_credential(
            config,
            old,
            secret,
            Some(OAuthMetadata {
                provider_id: grant.provider_id,
            }),
            refresh_claim.is_some(),
            vault,
            check,
        )
    }
    pub fn claim_refresh(&mut self, expected: &Record) -> Result<RefreshClaim, String> {
        let record = self
            .data
            .records
            .iter_mut()
            .find(|record| {
                record.connection.config.plugin_id == expected.connection.config.plugin_id
                    && record.connection.config.origin == expected.connection.config.origin
            })
            .ok_or("账号连接已撤销")?;
        if record.connection.version != expected.connection.version
            || record.credential.id != expected.credential.id
            || record.connection.oauth.is_none()
        {
            return Err("账号连接已变化，请重新请求".into());
        }
        if let Some(claim) = &record.refresh {
            return Err(if oauth::now()?.saturating_sub(claim.started) < 30_000 {
                "账号连接正在刷新，请稍后重新操作"
            } else {
                "账号刷新结果不确定，请重新登录授权"
            }
            .into());
        }
        let claim = RefreshClaim {
            id: uuid::Uuid::new_v4().to_string(),
            started: oauth::now()?,
        };
        record.refresh = Some(claim.clone());
        self.data.version = 2;
        self.commit()?;
        Ok(claim)
    }
    fn write_credential(
        &mut self,
        config: Config,
        old: Option<Record>,
        secret: String,
        oauth: Option<OAuthMetadata>,
        preserve_version: bool,
        vault: &impl Vault,
        check: impl Fn() -> Result<(), String>,
    ) -> Result<Connection, String> {
        self.cleanup(vault)?;
        check()?;
        let credential = Credential {
            id: uuid::Uuid::new_v4().to_string(),
            parts: secret.len().div_ceil(2000),
        };
        // Journal BEFORE writing the OS store. Crash/partial write leaves no untracked secret.
        self.data.pending.push(credential.clone());
        self.commit()?;
        for (part, bytes) in secret.as_bytes().chunks(2000).enumerate() {
            vault.put(&credential.id, part, bytes)?;
        }
        check()?;
        let connection = Connection {
            config,
            version: if preserve_version {
                old.as_ref()
                    .ok_or("账号连接已撤销")?
                    .connection
                    .version
                    .clone()
            } else {
                uuid::Uuid::new_v4().to_string()
            },
            updated_at: time::OffsetDateTime::now_utc()
                .format(&time::format_description::well_known::Rfc3339)
                .map_err(|_| "系统时间无效")?,
            has_secret: true,
            oauth,
        };
        self.data.records.retain(|r| {
            r.connection.config.plugin_id != connection.config.plugin_id
                || r.connection.config.origin != connection.config.origin
        });
        self.data.records.push(Record {
            connection: connection.clone(),
            credential: credential.clone(),
            refresh: None,
        });
        self.data.pending.retain(|item| item.id != credential.id);
        if let Some(old) = old {
            self.data.pending.push(old.credential);
        }
        self.commit()?;
        // A committed update stays successful; any cleanup failure is retried/reported by list().
        let _ = self.cleanup(vault);
        Ok(connection)
    }
    pub fn remove(
        &mut self,
        plugin: &str,
        origin: &str,
        version: &str,
        vault: &impl Vault,
    ) -> Result<(), String> {
        let Some(record) = self.find(plugin, origin) else {
            return self.cleanup(vault);
        };
        if record.connection.version != version {
            return Err("连接版本已变化，请刷新后重试".into());
        }
        if self.data.pending.len() >= 64 {
            self.cleanup(vault)?;
        }
        self.data
            .records
            .retain(|r| r.connection.version != version);
        self.data.pending.push(record.credential);
        self.commit()?; // Revocation takes effect even if the OS store is locked.
        self.cleanup(vault)
            .map_err(|_| "连接已撤销；系统凭据清理未完成，请解锁凭据库后刷新连接重试".into())
    }
}
