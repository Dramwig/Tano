//! Microsoft Outlook / Microsoft 365 OAuth 2.0 (PKCE) & XOAUTH2 token management.
//!
//! Uses RFC 8252 loopback redirection (`http://localhost:{port}/`) with S256 PKCE for
//! Microsoft Entra ID public desktop clients. Access/refresh tokens are persisted only
//! in the OS keyring (`Tano.Mail`) and are never serialized to disk or returned to WebView.

use super::types::{unix_timestamp_secs, validate_email_address, MailAccount, MailCredentials};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    net::TcpListener,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri_plugin_opener::OpenerExt;

pub const DEFAULT_MICROSOFT_TENANT: &str = "common";
pub const DEFAULT_MICROSOFT_REDIRECT_URI: &str = "http://localhost";
pub const MICROSOFT_MAIL_SCOPES: &str = "openid profile email offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send";
const TOKEN_REFRESH_SKEW_SECS: i64 = 120;
const MAX_OAUTH_RESPONSE_BYTES: usize = 64 * 1024;

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OAuthFileProviderConfig {
    #[serde(default)]
    client_id: String,
    #[serde(default)]
    tenant: String,
    #[serde(default)]
    redirect_uri: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MicrosoftOAuthConfig {
    pub client_id: String,
    pub tenant: String,
    pub redirect_uri: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MicrosoftTokenBundle {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: i64,
    pub email: Option<String>,
    pub display_name: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct IdTokenClaims {
    pub email: Option<String>,
    pub display_name: Option<String>,
}

pub fn validate_client_id(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty()
        || trimmed.len() > 128
        || !trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return Err("Microsoft 应用 Client ID 格式无效".into());
    }
    Ok(trimmed.to_string())
}

pub fn validate_tenant(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(DEFAULT_MICROSOFT_TENANT.to_string());
    }
    if trimmed.len() > 128
        || trimmed.starts_with('.')
        || trimmed.ends_with('.')
        || trimmed.contains("..")
        || !trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.'))
    {
        return Err("Microsoft 租户标识（Tenant）格式无效".into());
    }
    Ok(trimmed.to_string())
}

pub fn validate_loopback_redirect_uri(raw: &str) -> Result<tauri::Url, String> {
    let trimmed = raw.trim();
    let candidate = if trimmed.is_empty() {
        DEFAULT_MICROSOFT_REDIRECT_URI
    } else {
        trimmed
    };
    let url = tauri::Url::parse(candidate).map_err(|_| "OAuth 回调地址格式无效".to_string())?;
    if url.scheme() != "http"
        || !matches!(url.host_str(), Some("localhost" | "127.0.0.1"))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("桌面端 OAuth 回调地址仅允许使用 http://localhost 或 http://127.0.0.1".into());
    }
    Ok(url)
}

fn load_file_or_env_defaults(data_dir: Option<&Path>) -> Option<OAuthFileProviderConfig> {
    let mut cfg = OAuthFileProviderConfig::default();

    // 1. Compile-time public Client ID (for official desktop releases)
    if let Some(built_in) = option_env!("TANO_MAIL_OUTLOOK_CLIENT_ID") {
        if !built_in.trim().is_empty() {
            cfg.client_id = built_in.trim().to_string();
        }
    }

    // 2. App data mail-oauth.json
    if let Some(dir) = data_dir {
        let path = dir.join("mail-oauth.json");
        if let Ok(raw) = std::fs::read_to_string(path) {
            if let Ok(map) = serde_json::from_str::<BTreeMap<String, OAuthFileProviderConfig>>(&raw)
            {
                if let Some(outlook) = map.get("outlook") {
                    if !outlook.client_id.trim().is_empty() {
                        cfg.client_id = outlook.client_id.trim().to_string();
                    }
                    if !outlook.tenant.trim().is_empty() {
                        cfg.tenant = outlook.tenant.trim().to_string();
                    }
                    if !outlook.redirect_uri.trim().is_empty() {
                        cfg.redirect_uri = outlook.redirect_uri.trim().to_string();
                    }
                }
            }
        }
    }

    // 3. JSON env var TANO_MAIL_OAUTH
    if let Ok(raw) = std::env::var("TANO_MAIL_OAUTH") {
        if let Ok(map) = serde_json::from_str::<BTreeMap<String, OAuthFileProviderConfig>>(&raw) {
            if let Some(outlook) = map.get("outlook") {
                if !outlook.client_id.trim().is_empty() {
                    cfg.client_id = outlook.client_id.trim().to_string();
                }
                if !outlook.tenant.trim().is_empty() {
                    cfg.tenant = outlook.tenant.trim().to_string();
                }
                if !outlook.redirect_uri.trim().is_empty() {
                    cfg.redirect_uri = outlook.redirect_uri.trim().to_string();
                }
            }
        }
    }

    // 4. Direct convenience env vars
    if let Ok(val) = std::env::var("TANO_MAIL_OUTLOOK_CLIENT_ID") {
        if !val.trim().is_empty() {
            cfg.client_id = val.trim().to_string();
        }
    }
    if let Ok(val) = std::env::var("TANO_MAIL_OUTLOOK_TENANT") {
        if !val.trim().is_empty() {
            cfg.tenant = val.trim().to_string();
        }
    }
    if let Ok(val) = std::env::var("TANO_MAIL_OUTLOOK_REDIRECT_URI") {
        if !val.trim().is_empty() {
            cfg.redirect_uri = val.trim().to_string();
        }
    }

    if cfg.client_id.is_empty() {
        None
    } else {
        Some(cfg)
    }
}

pub fn has_default_microsoft_config(data_dir: Option<&Path>) -> bool {
    load_file_or_env_defaults(data_dir)
        .and_then(|cfg| validate_client_id(&cfg.client_id).ok())
        .is_some()
}

pub fn resolve_microsoft_config(
    data_dir: Option<&Path>,
    override_client_id: Option<&str>,
    override_tenant: Option<&str>,
) -> Result<MicrosoftOAuthConfig, String> {
    let defaults = load_file_or_env_defaults(data_dir).unwrap_or_default();
    let raw_client_id = override_client_id
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or(defaults.client_id.as_str());
    if raw_client_id.is_empty() {
        return Err(
            "尚未配置 Outlook OAuth 应用 Client ID。请在下方填写 Microsoft Entra ID 公共客户端 ID，或在应用数据目录配置 mail-oauth.json / 环境变量 TANO_MAIL_OUTLOOK_CLIENT_ID。".into(),
        );
    }
    let client_id = validate_client_id(raw_client_id)?;
    let raw_tenant = override_tenant
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or(defaults.tenant.as_str());
    let tenant = validate_tenant(raw_tenant)?;
    let redirect = validate_loopback_redirect_uri(&defaults.redirect_uri)?;
    Ok(MicrosoftOAuthConfig {
        client_id,
        tenant,
        redirect_uri: redirect.to_string(),
    })
}

pub fn build_pkce_pair() -> (String, String) {
    // 64 lowercase hex chars (256 bits from OS CSPRNG via UUID v4), valid RFC 7636 verifier.
    let verifier = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

pub fn build_authorize_url(
    config: &MicrosoftOAuthConfig,
    redirect_uri: &str,
    state: &str,
    code_challenge: &str,
    login_hint: Option<&str>,
) -> Result<String, String> {
    let endpoint = format!(
        "https://login.microsoftonline.com/{}/oauth2/v2.0/authorize",
        config.tenant
    );
    let mut url = tauri::Url::parse(&endpoint).map_err(|_| "Microsoft 授权地址无效".to_string())?;
    url.query_pairs_mut().extend_pairs([
        ("client_id", config.client_id.as_str()),
        ("response_type", "code"),
        ("redirect_uri", redirect_uri),
        ("response_mode", "query"),
        ("scope", MICROSOFT_MAIL_SCOPES),
        ("state", state),
        ("code_challenge", code_challenge),
        ("code_challenge_method", "S256"),
        ("prompt", "select_account"),
    ]);
    if let Some(hint) = login_hint.map(str::trim).filter(|v| !v.is_empty()) {
        url.query_pairs_mut().append_pair("login_hint", hint);
    }
    Ok(url.to_string())
}

pub fn parse_id_token_claims(id_token: &str) -> IdTokenClaims {
    let Some(payload_b64) = id_token.split('.').nth(1) else {
        return IdTokenClaims::default();
    };
    let Ok(bytes) = URL_SAFE_NO_PAD.decode(payload_b64) else {
        return IdTokenClaims::default();
    };
    let Ok(json) = serde_json::from_slice::<Value>(&bytes) else {
        return IdTokenClaims::default();
    };
    let email = ["email", "preferred_username", "upn"]
        .iter()
        .find_map(|key| {
            json.get(*key)
                .and_then(Value::as_str)
                .and_then(|v| validate_email_address(v).ok())
        });
    let display_name = json
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(|v| v.chars().take(120).collect::<String>());
    IdTokenClaims {
        email,
        display_name,
    }
}

fn build_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| "无法初始化 OAuth 网络客户端".to_string())
}

fn summarize_token_error(body: &[u8], status: reqwest::StatusCode) -> String {
    if let Ok(json) = serde_json::from_slice::<Value>(body) {
        let code = json
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or_default();
        match code {
            "invalid_grant" => {
                return "Outlook 授权已过期或被撤销，请重新点击登录授权。".into();
            }
            "unauthorized_client" | "invalid_client" => {
                return "Microsoft 应用 Client ID 无效，或未在 Entra ID 中开启「公共客户端流」与个人账号支持。".into();
            }
            "invalid_scope" => {
                return "Microsoft 应用未配置所需的 IMAP / SMTP 权限范围（IMAP.AccessAsUser.All、SMTP.Send）。".into();
            }
            "access_denied" => {
                return "Microsoft 账号授权已被拒绝或取消。".into();
            }
            "interaction_required" | "consent_required" | "login_required" => {
                return "Microsoft 要求重新交互登录或管理员同意权限，请重新授权。".into();
            }
            _ => {}
        }
    }
    format!("Microsoft OAuth 令牌请求失败（HTTP {}）", status.as_u16())
}

async fn post_token_request(
    tenant: &str,
    form: Vec<(&str, String)>,
) -> Result<MicrosoftTokenBundle, String> {
    let endpoint = format!("https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token");
    let response = build_http_client()?
        .post(&endpoint)
        .form(&form)
        .send()
        .await
        .map_err(|_| "无法连接 Microsoft 登录服务器，请检查网络连接".to_string())?;
    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "读取 Microsoft OAuth 响应失败".to_string())?;
    if bytes.len() > MAX_OAUTH_RESPONSE_BYTES {
        return Err("Microsoft OAuth 响应超出大小限制".into());
    }
    if !status.is_success() {
        return Err(summarize_token_error(&bytes, status));
    }
    let json: Value =
        serde_json::from_slice(&bytes).map_err(|_| "Microsoft OAuth 响应格式无效".to_string())?;
    let access_token = json
        .get("access_token")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty() && v.len() <= 16384)
        .ok_or_else(|| "Microsoft OAuth 响应缺少访问令牌".to_string())?
        .to_string();
    let refresh_token = json
        .get("refresh_token")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty() && v.len() <= 16384)
        .map(ToString::to_string);
    let expires_in = json
        .get("expires_in")
        .and_then(Value::as_i64)
        .unwrap_or(3600)
        .clamp(60, 86_400);
    let claims = json
        .get("id_token")
        .and_then(Value::as_str)
        .map(parse_id_token_claims)
        .unwrap_or_default();
    Ok(MicrosoftTokenBundle {
        access_token,
        refresh_token,
        expires_at: unix_timestamp_secs().saturating_add(expires_in),
        email: claims.email,
        display_name: claims.display_name,
    })
}

fn bind_loopback_listener(
    configured_redirect: &str,
) -> Result<(TcpListener, String, String), String> {
    let mut url = validate_loopback_redirect_uri(configured_redirect)?;
    let requested_port = url.port().unwrap_or(0);
    let listener = TcpListener::bind(("127.0.0.1", requested_port)).map_err(|_| {
        if requested_port == 0 {
            "无法启动本机 OAuth 回调监听端口".to_string()
        } else {
            format!("本机 OAuth 回调端口 {requested_port} 已被占用，请稍后重试")
        }
    })?;
    listener
        .set_nonblocking(true)
        .map_err(|_| "无法初始化本机 OAuth 回调监听".to_string())?;
    let bound_port = listener
        .local_addr()
        .map_err(|_| "无法获取本机 OAuth 回调端口".to_string())?
        .port();
    url.set_port(Some(bound_port))
        .map_err(|_| "无法构造 OAuth 回调地址".to_string())?;
    let expected_path = url.path().to_string();
    Ok((listener, url.to_string(), expected_path))
}

async fn wait_for_callback(
    listener: TcpListener,
    expected_path: String,
    expected_state: String,
    cancel: Arc<AtomicBool>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::{Read, Write};
        let deadline = std::time::Instant::now() + Duration::from_secs(180);
        while std::time::Instant::now() < deadline {
            if cancel.load(Ordering::SeqCst) {
                return Err("已取消 Microsoft 账号授权".into());
            }
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                    let mut buf = [0u8; 8192];
                    let count = stream.read(&mut buf).unwrap_or(0);
                    if count == 0 {
                        continue;
                    }
                    let req = String::from_utf8_lossy(&buf[..count]);
                    let target = req
                        .lines()
                        .next()
                        .and_then(|line| line.strip_prefix("GET "))
                        .and_then(|line| line.split_whitespace().next())
                        .unwrap_or("");
                    let Ok(parsed) = tauri::Url::parse(&format!("http://127.0.0.1{target}")) else {
                        let _ = stream.write_all(
                            b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                        );
                        continue;
                    };
                    if parsed.path() != expected_path {
                        let _ = stream.write_all(
                            b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                        );
                        continue;
                    }
                    let query: BTreeMap<String, String> =
                        parsed.query_pairs().into_owned().collect();
                    if query.get("state").map(String::as_str) != Some(expected_state.as_str()) {
                        let _ = stream.write_all(
                            b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                        );
                        continue;
                    }
                    if let Some(err_code) = query.get("error") {
                        let html = "<!doctype html><meta charset=\"utf-8\"><title>Tano</title><body style=\"font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#141414;color:#eee\"><div style=\"text-align:center\"><h2>授权未完成</h2><p>可以关闭此标签页并返回 Tano。</p></div></body>";
                        let _ = write!(
                            stream,
                            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            html.len(),
                            html
                        );
                        if err_code == "access_denied" {
                            return Err("已取消 Microsoft 账号授权".into());
                        }
                        return Err(format!("Microsoft 授权失败（{err_code}）"));
                    }
                    let html = "<!doctype html><meta charset=\"utf-8\"><title>Tano</title><body style=\"font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#141414;color:#eee\"><div style=\"text-align:center\"><h2>Outlook 授权成功</h2><p>请关闭此标签页并返回 Tano 完成同步。</p></div></body>";
                    let _ = write!(
                        stream,
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        html.len(),
                        html
                    );
                    return query
                        .get("code")
                        .filter(|v| !v.is_empty())
                        .cloned()
                        .ok_or_else(|| "授权回调缺少授权码".to_string());
                }
                Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(50));
                }
                Err(_) => return Err("本机 OAuth 回调接收失败".into()),
            }
        }
        Err("等待 Microsoft 登录授权超时，请重试".into())
    })
    .await
    .map_err(|_| "OAuth 回调任务意外中断".to_string())?
}

pub async fn authorize_microsoft(
    app: &tauri::AppHandle,
    config: &MicrosoftOAuthConfig,
    login_hint: Option<&str>,
    cancel: Arc<AtomicBool>,
) -> Result<MicrosoftTokenBundle, String> {
    let (listener, redirect_uri, expected_path) = bind_loopback_listener(&config.redirect_uri)?;
    let state = uuid::Uuid::new_v4().to_string();
    let (code_verifier, code_challenge) = build_pkce_pair();
    let auth_url = build_authorize_url(config, &redirect_uri, &state, &code_challenge, login_hint)?;

    app.opener()
        .open_url(auth_url.as_str(), None::<String>)
        .map_err(|_| "无法打开系统浏览器进行 Microsoft 登录".to_string())?;

    let code = wait_for_callback(listener, expected_path, state, cancel.clone()).await?;
    if cancel.load(Ordering::SeqCst) {
        return Err("已取消 Microsoft 账号授权".into());
    }

    let form = vec![
        ("grant_type", "authorization_code".to_string()),
        ("client_id", config.client_id.clone()),
        ("code", code),
        ("redirect_uri", redirect_uri),
        ("code_verifier", code_verifier),
        ("scope", MICROSOFT_MAIL_SCOPES.to_string()),
    ];
    post_token_request(&config.tenant, form).await
}

pub fn token_needs_refresh(creds: &MailCredentials, now_secs: i64) -> bool {
    let has_token = creds
        .access_token
        .as_deref()
        .map(str::trim)
        .is_some_and(|v| !v.is_empty());
    if !has_token {
        return true;
    }
    creds.expires_at.unwrap_or(0) <= now_secs.saturating_add(TOKEN_REFRESH_SKEW_SECS)
}

pub async fn refresh_microsoft_credentials(
    data_dir: Option<&Path>,
    account: &MailAccount,
    mut creds: MailCredentials,
) -> Result<MailCredentials, String> {
    let refresh_token = creds
        .refresh_token
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "Outlook 授权已失效且缺少刷新令牌，请重新登录授权。".to_string())?
        .to_string();

    let config = resolve_microsoft_config(
        data_dir,
        account.oauth_client_id.as_deref(),
        account.oauth_tenant.as_deref(),
    )?;

    let form = vec![
        ("grant_type", "refresh_token".to_string()),
        ("client_id", config.client_id),
        ("refresh_token", refresh_token),
        ("scope", MICROSOFT_MAIL_SCOPES.to_string()),
    ];
    let refreshed = post_token_request(&config.tenant, form).await?;
    creds.access_token = Some(refreshed.access_token);
    if let Some(next_refresh) = refreshed.refresh_token {
        creds.refresh_token = Some(next_refresh);
    }
    creds.expires_at = Some(refreshed.expires_at);
    Ok(creds)
}
