//! Deployment-owned public clients. Plugins never supply OAuth endpoints or client registrations.
use super::plugin_connection_types::{self as types, Config};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use tauri::Url;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Provider {
    pub id: String,
    pub label: String,
    pub origin: String,
    pub scopes: Vec<String>,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub client_id: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Providers {
    pub version: u32,
    pub providers: Vec<Provider>,
}
impl Providers {
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() > 64 * 1024 {
            return Err("本机 OAuth 配置过大".into());
        }
        let value: Self = serde_json::from_slice(bytes)
            .map_err(|_| "本机 OAuth 配置无效；只支持不含客户端秘密的公共客户端")?;
        if value.version != 1 || value.providers.len() > 20 {
            return Err("本机 OAuth 配置版本或数量无效".into());
        }
        let mut ids = HashSet::new();
        for provider in &value.providers {
            provider.validate()?;
            if !ids.insert(&provider.id) {
                return Err("本机 OAuth 服务标识重复".into());
            }
        }
        Ok(value)
    }
}
fn endpoint(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "OAuth 端点无效")?;
    if value.len() > 2048
        || url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.as_str() != value
    {
        return Err("OAuth 端点必须是无查询、片段或用户凭据的 HTTPS 地址".into());
    }
    Ok(url)
}
impl Provider {
    pub fn validate(&self) -> Result<(), String> {
        types::origin(&self.origin)?;
        endpoint(&self.authorization_endpoint)?;
        endpoint(&self.token_endpoint)?;
        if !types::valid_id(&self.id)
            || self.label.trim().is_empty()
            || self.label.chars().count() > 80
            || self.label.chars().any(char::is_control)
            || self.client_id.is_empty()
            || self.client_id.len() > 256
            || !self.client_id.bytes().all(|b| (0x21..=0x7e).contains(&b))
            || self.scopes.len() > 30
            || self.scopes.iter().collect::<HashSet<_>>().len() != self.scopes.len()
            || self.scopes.iter().any(|scope| {
                scope.is_empty()
                    || scope.len() > 128
                    || !scope.bytes().all(|b| {
                        b == 0x21 || (0x23..=0x5b).contains(&b) || (0x5d..=0x7e).contains(&b)
                    })
            })
        {
            return Err("本机 OAuth 客户端设置无效".into());
        }
        Ok(())
    }
    pub fn fingerprint(&self) -> String {
        crate::storage::hash(&serde_json::to_vec(self).expect("serializable provider"))
    }
    pub fn metadata(&self) -> Value {
        serde_json::json!({"id":self.id,"label":self.label,"origin":self.origin,"scopes":self.scopes})
    }
    pub fn authorization_url(
        &self,
        redirect: &str,
        state: &str,
        verifier: &str,
    ) -> Result<String, String> {
        let mut url = endpoint(&self.authorization_endpoint)?;
        url.query_pairs_mut().extend_pairs([
            ("response_type", "code"),
            ("client_id", self.client_id.as_str()),
            ("redirect_uri", redirect),
            ("state", state),
            ("code_challenge_method", "S256"),
            (
                "code_challenge",
                &URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())),
            ),
        ]);
        if !self.scopes.is_empty() {
            url.query_pairs_mut()
                .append_pair("scope", &self.scopes.join(" "));
        }
        Ok(url.into())
    }
}
pub fn random_token() -> String {
    // Two independent UUID v4 values provide 244 bits from the OS random source.
    URL_SAFE_NO_PAD.encode(
        [
            uuid::Uuid::new_v4().as_bytes().as_slice(),
            uuid::Uuid::new_v4().as_bytes().as_slice(),
        ]
        .concat(),
    )
}
pub fn now() -> Result<u64, String> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|time| time.as_millis() as u64)
        .map_err(|_| "系统时间无效".into())
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Tokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<u64>,
}
impl Tokens {
    pub fn parse(value: Value) -> Result<Self, String> {
        let fail = || "服务授权或令牌刷新失败，请重新连接账号".to_owned();
        if !value
            .get("token_type")
            .and_then(Value::as_str)
            .is_some_and(|value| value.eq_ignore_ascii_case("bearer"))
        {
            return Err(fail());
        }
        let expires_at = match value.get("expires_in") {
            None => None,
            Some(value) => {
                let seconds = value
                    .as_u64()
                    .filter(|s| (1..=365 * 86400).contains(s))
                    .ok_or_else(fail)?;
                Some(now()?.checked_add(seconds * 1000).ok_or_else(fail)?)
            }
        };
        let tokens = Self {
            access_token: value
                .get("access_token")
                .and_then(Value::as_str)
                .ok_or_else(fail)?
                .into(),
            refresh_token: value
                .get("refresh_token")
                .map(|v| v.as_str().map(str::to_owned).ok_or_else(fail))
                .transpose()?,
            expires_at,
        };
        tokens.validate()?;
        Ok(tokens)
    }
    pub fn validate(&self) -> Result<(), String> {
        if !types::valid_secret(&self.access_token)
            || self
                .refresh_token
                .as_deref()
                .is_some_and(|v| !types::valid_secret(v))
            || self.expires_at.is_some_and(|v| v > 9_007_199_254_740_991)
        {
            return Err("服务账号令牌无效，请重新连接".into());
        }
        Ok(())
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Grant {
    pub provider_id: String,
    pub fingerprint: String,
    pub binding: String,
    pub tokens: Tokens,
}
impl Grant {
    pub fn new(provider: &Provider, config: &Config, tokens: Tokens) -> Self {
        Self {
            provider_id: provider.id.clone(),
            fingerprint: provider.fingerprint(),
            binding: Self::binding(config),
            tokens,
        }
    }
    fn binding(config: &Config) -> String {
        crate::storage::hash(&serde_json::to_vec(config).expect("serializable config"))
    }
    pub fn validate(&self, config: &Config, provider: &str) -> Result<(), String> {
        self.tokens.validate()?;
        if !types::valid_id(&self.provider_id)
            || !types::valid_hash(&self.fingerprint)
            || self.binding != Self::binding(config)
            || self.provider_id != provider
            || config.authentication != "bearer"
        {
            return Err("账号连接范围已变化，请重新登录授权".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn provider() -> Value {
        serde_json::json!({"id":"example","label":"示例服务","origin":"https://api.example.test","scopes":["read"],
        "authorizationEndpoint":"https://login.example.test/authorize","tokenEndpoint":"https://login.example.test/token","clientId":"test-public-client"})
    }
    #[test]
    fn validates_public_clients_and_pkce_without_exporting_registration_details() {
        let parse = |provider| {
            Providers::parse(
                &serde_json::to_vec(&serde_json::json!({"version":1,"providers":[provider]}))
                    .unwrap(),
            )
        };
        let registration = parse(provider()).unwrap().providers.remove(0);
        assert!(registration.metadata().get("clientId").is_none());
        for (key, value) in [
            ("clientSecret", serde_json::json!("not-allowed")),
            ("origin", serde_json::json!("https://api.example.test/path")),
            (
                "authorizationEndpoint",
                serde_json::json!("https://login.example.test/authorize?redirect_uri=other"),
            ),
            (
                "tokenEndpoint",
                serde_json::json!("http://login.example.test/token"),
            ),
            ("scopes", serde_json::json!(["read all"])),
        ] {
            let mut bad = provider();
            bad[key] = value;
            assert!(parse(bad).is_err(), "{key}");
        }
        let state = random_token();
        let verifier = random_token();
        assert_eq!(state.len(), 43);
        assert_ne!(state, verifier);
        let url = Url::parse(
            &registration
                .authorization_url("http://127.0.0.1:1234/oauth/example", &state, &verifier)
                .unwrap(),
        )
        .unwrap();
        let query: std::collections::HashMap<_, _> = url.query_pairs().collect();
        assert_eq!(query["state"], state);
        assert_eq!(query["code_challenge_method"], "S256");
        assert_eq!(
            query["code_challenge"],
            URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
        );
        assert!(!url.as_str().contains(&verifier));
    }
    #[test]
    fn bounds_token_responses_and_preserves_only_required_credentials() {
        let good = serde_json::json!({"access_token":"test-access-token","refresh_token":"test-refresh-token","token_type":"Bearer","expires_in":3600,"id_token":"not-stored"});
        let tokens = Tokens::parse(good.clone()).unwrap();
        assert!(tokens.expires_at.unwrap() > now().unwrap());
        assert!(!serde_json::to_string(&tokens)
            .unwrap()
            .contains("not-stored"));
        for (key, value) in [
            ("access_token", serde_json::json!("bad\r\nheader")),
            ("expires_in", serde_json::json!(-1)),
            ("expires_in", serde_json::json!("3600")),
            ("token_type", serde_json::json!("MAC")),
            ("refresh_token", Value::Null),
        ] {
            let mut bad = good.clone();
            bad[key] = value;
            assert!(Tokens::parse(bad).is_err());
        }
    }
}
