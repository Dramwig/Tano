use super::import_connections::{bytes, client, Session, PROVIDERS};
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use serde_json::Value;
use sha1::Sha1;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tauri_plugin_opener::OpenerExt;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Registration {
    pub client_id: String,
    #[serde(default)]
    pub client_secret: String,
    #[serde(default = "redirect")]
    pub redirect_uri: String,
}
fn redirect() -> String {
    "http://127.0.0.1:43843/callback".into()
}
pub fn registrations(app: &tauri::AppHandle) -> Result<BTreeMap<String, Registration>, String> {
    let source = match std::env::var("TANO_IMPORT_OAUTH") {
        Ok(source) => source,
        Err(_) => {
            let path = crate::app_data(app)?.join("import-oauth.json");
            if !path.exists() {
                return Ok(BTreeMap::new());
            }
            std::fs::read_to_string(path).map_err(|_| "无法读取导入授权配置")?
        }
    };
    let result: BTreeMap<String, Registration> = serde_json::from_str(&source)
        .map_err(|_| "导入授权配置格式无效，请检查 import-oauth.json")?;
    for (provider, config) in &result {
        if !PROVIDERS.contains(&provider.as_str())
            || ["workflowy", "roam"].contains(&provider.as_str())
            || config.client_id.trim().is_empty()
            || config.client_id.len() > 1024
            || config.client_secret.len() > 4096
        {
            return Err("导入授权应用配置无效".into());
        }
        callback_url(&config.redirect_uri)?;
    }
    Ok(result)
}
fn callback_url(value: &str) -> Result<tauri::Url, String> {
    let url = tauri::Url::parse(value).map_err(|_| "授权回调地址无效")?;
    if url.scheme() != "http"
        || !matches!(url.host_str(), Some("127.0.0.1" | "localhost"))
        || url.port().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(
            "桌面授权回调必须使用带端口的 http://127.0.0.1 或 http://localhost 地址".into(),
        );
    }
    Ok(url)
}
fn endpoints(provider: &str) -> Result<(&'static str, &'static str, &'static str), String> {
    match provider {
        "notion" => Ok((
            "https://api.notion.com/v1/oauth/authorize",
            "https://api.notion.com/v1/oauth/token",
            "",
        )),
        "google-docs" => Ok((
            "https://accounts.google.com/o/oauth2/v2/auth",
            "https://oauth2.googleapis.com/token",
            "https://www.googleapis.com/auth/drive.readonly",
        )),
        "asana" => Ok((
            "https://app.asana.com/-/oauth_authorize",
            "https://app.asana.com/-/oauth_token",
            "default",
        )),
        "monday" => Ok((
            "https://auth.monday.com/oauth2/authorize",
            "https://auth.monday.com/oauth2/token",
            "boards:read",
        )),
        "quip" => Ok((
            "https://platform.quip.com/1/oauth/login",
            "https://platform.quip.com/1/oauth/access_token",
            "",
        )),
        "confluence" => Ok((
            "https://auth.atlassian.com/authorize",
            "https://auth.atlassian.com/oauth/token",
            "read:space:confluence read:page:confluence read:confluence-content.all",
        )),
        "jira" => Ok((
            "https://auth.atlassian.com/authorize",
            "https://auth.atlassian.com/oauth/token",
            "read:jira-work read:jira-user",
        )),
        _ => Err("此平台使用 API 令牌或 OAuth 1.0 授权".into()),
    }
}
async fn wait_callback(
    listener: std::net::TcpListener,
    redirect: tauri::Url,
    state: String,
    cancel: Arc<AtomicBool>,
) -> Result<BTreeMap<String, String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::{Read, Write};
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(180);
        while std::time::Instant::now() < deadline {
            if cancel.load(Ordering::SeqCst) { return Err("授权已取消".into()); }
            match listener.accept() {
                Ok((mut stream, _)) => {
                    stream.set_read_timeout(Some(std::time::Duration::from_secs(2))).ok();
                    let mut buffer = [0; 8192]; let size = stream.read(&mut buffer).unwrap_or(0);
                    let source = String::from_utf8_lossy(&buffer[..size]);
                    let target = source.lines().next().and_then(|line| line.strip_prefix("GET ")).and_then(|line| line.split_whitespace().next()).unwrap_or("");
                    let url = tauri::Url::parse(&format!("http://127.0.0.1{target}"));
                    let query: BTreeMap<_, _> = url.as_ref().ok().map(|url| url.query_pairs().into_owned().collect()).unwrap_or_default();
                    if url.as_ref().map(|url| url.path()).ok() != Some(redirect.path()) || query.get("state") != Some(&state) {
                        let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"); continue;
                    }
                    let body = "Authorization received. Return to Tano to continue importing.";
                    let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
                    if query.contains_key("error") || query.contains_key("denied") { return Err("第三方账号授权已取消".into()); }
                    return Ok(query);
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(std::time::Duration::from_millis(50)),
                Err(_) => return Err("授权回调读取失败".into()),
            }
        }
        Err("账号授权等待超时，请重试".into())
    }).await.map_err(|_| "授权回调任务失败")?
}
pub async fn authorize(
    app: &tauri::AppHandle,
    mut session: Session,
    cancel: Arc<AtomicBool>,
) -> Result<Session, String> {
    let config = registrations(app)?
        .remove(&session.account.provider)
        .ok_or("尚未配置此平台的 OAuth 应用，请按账号导入文档配置后重启")?;
    let redirect = callback_url(&config.redirect_uri)?;
    let listener = std::net::TcpListener::bind(("127.0.0.1", redirect.port().unwrap()))
        .map_err(|_| "账号授权回调端口被占用，请完成已有授权或修改配置")?;
    listener
        .set_nonblocking(true)
        .map_err(|_| "无法启动账号授权回调")?;
    if ["evernote", "trello"].contains(&session.account.provider.as_str()) {
        return authorize1(app, session, config, listener, redirect, cancel).await;
    }
    let provider = session.account.provider.as_str();
    let (authorization, token_endpoint, scope) = endpoints(provider)?;
    let state = uuid::Uuid::new_v4().to_string();
    let verifier = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let mut url = tauri::Url::parse(authorization).map_err(|_| "平台授权地址无效")?;
    url.query_pairs_mut().extend_pairs([
        ("client_id", config.client_id.as_str()),
        ("redirect_uri", config.redirect_uri.as_str()),
        ("response_type", "code"),
        ("state", state.as_str()),
    ]);
    if !scope.is_empty() {
        url.query_pairs_mut().append_pair("scope", scope);
    }
    if ["google-docs", "asana"].contains(&provider) {
        url.query_pairs_mut().extend_pairs([
            ("code_challenge", challenge.as_str()),
            ("code_challenge_method", "S256"),
        ]);
    }
    if ["jira", "confluence"].contains(&provider) {
        url.query_pairs_mut()
            .extend_pairs([("audience", "api.atlassian.com"), ("prompt", "consent")]);
    }
    if provider == "notion" {
        url.query_pairs_mut().append_pair("owner", "user");
    }
    if provider == "google-docs" {
        url.query_pairs_mut().append_pair("prompt", "consent");
    }
    app.opener()
        .open_url(url.as_str(), None::<String>)
        .map_err(|_| "无法打开系统浏览器")?;
    let mut callback = wait_callback(listener, redirect, state, cancel.clone()).await?;
    let code = callback.remove("code").ok_or("授权响应缺少授权码")?;
    if cancel.load(Ordering::SeqCst) {
        return Err("授权已取消".into());
    }
    let mut fields = BTreeMap::from([
        ("grant_type", "authorization_code".to_string()),
        ("code", code),
        ("redirect_uri", config.redirect_uri.clone()),
    ]);
    if ["google-docs", "asana"].contains(&provider) {
        fields.insert("code_verifier", verifier);
    }
    let mut outgoing = client()?.post(token_endpoint);
    if provider == "notion" {
        outgoing = outgoing
            .basic_auth(&config.client_id, Some(&config.client_secret))
            .json(&fields);
    } else {
        fields.insert("client_id", config.client_id.clone());
        if !config.client_secret.is_empty() {
            fields.insert("client_secret", config.client_secret.clone());
        }
        outgoing = if ["jira", "confluence", "monday"].contains(&provider) {
            outgoing.json(&fields)
        } else {
            outgoing.form(&fields)
        };
    }
    let response = outgoing
        .send()
        .await
        .map_err(|_| "无法连接平台授权服务器")?;
    if !response.status().is_success() {
        return Err("账号授权交换失败，请核对 OAuth 应用配置后重试".into());
    }
    let tokens: Value =
        serde_json::from_slice(&bytes(response, 32768).await?).map_err(|_| "账号授权响应无效")?;
    session.token = tokens["access_token"]
        .as_str()
        .filter(|value| !value.is_empty() && value.len() <= 16384)
        .ok_or("授权响应缺少令牌")?
        .into();
    Ok(session)
}
const OAUTH_ENCODE: &percent_encoding::AsciiSet = &percent_encoding::NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'.')
    .remove(b'_')
    .remove(b'~');
fn encode(value: &str) -> String {
    percent_encoding::utf8_percent_encode(value, OAUTH_ENCODE).to_string()
}
pub fn oauth1_header(
    method: &str,
    url: &tauri::Url,
    key: &str,
    secret: &str,
    token: &str,
    token_secret: &str,
    extra: &[(&str, &str)],
) -> Result<String, String> {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "系统时间无效")?
        .as_secs()
        .to_string();
    sign1(
        method,
        url,
        key,
        secret,
        token,
        token_secret,
        extra,
        &uuid::Uuid::new_v4().simple().to_string(),
        &timestamp,
    )
}
#[allow(clippy::too_many_arguments)]
fn sign1(
    method: &str,
    url: &tauri::Url,
    key: &str,
    secret: &str,
    token: &str,
    token_secret: &str,
    extra: &[(&str, &str)],
    nonce: &str,
    timestamp: &str,
) -> Result<String, String> {
    let mut oauth = vec![
        ("oauth_consumer_key".to_string(), key.to_string()),
        ("oauth_nonce".into(), nonce.into()),
        ("oauth_signature_method".into(), "HMAC-SHA1".into()),
        ("oauth_timestamp".into(), timestamp.into()),
        ("oauth_version".into(), "1.0".into()),
    ];
    if !token.is_empty() {
        oauth.push(("oauth_token".into(), token.into()));
    }
    oauth.extend(
        extra
            .iter()
            .map(|(key, value)| (key.to_string(), value.to_string())),
    );
    let mut values: Vec<_> = oauth
        .iter()
        .cloned()
        .chain(url.query_pairs().into_owned())
        .map(|(key, value)| (encode(&key), encode(&value)))
        .collect();
    values.sort();
    let mut base = url.clone();
    base.set_query(None);
    base.set_fragment(None);
    let normalized = values
        .iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>()
        .join("&");
    let source = format!(
        "{}&{}&{}",
        method,
        encode(base.as_str()),
        encode(&normalized)
    );
    let mut mac = Hmac::<Sha1>::new_from_slice(
        format!("{}&{}", encode(secret), encode(token_secret)).as_bytes(),
    )
    .map_err(|_| "授权签名失败")?;
    mac.update(source.as_bytes());
    oauth.push((
        "oauth_signature".into(),
        STANDARD.encode(mac.finalize().into_bytes()),
    ));
    Ok(format!(
        "OAuth {}",
        oauth
            .iter()
            .map(|(key, value)| format!("{}=\"{}\"", encode(key), encode(value)))
            .collect::<Vec<_>>()
            .join(", ")
    ))
}
async fn oauth1_token(
    url: &tauri::Url,
    key: &str,
    secret: &str,
    token: &str,
    token_secret: &str,
    extra: &[(&str, &str)],
) -> Result<BTreeMap<String, String>, String> {
    let response = client()?
        .post(url.clone())
        .header(
            "Authorization",
            oauth1_header("POST", url, key, secret, token, token_secret, extra)?,
        )
        .send()
        .await
        .map_err(|_| "无法连接平台授权服务器")?;
    if !response.status().is_success() {
        return Err("OAuth 1.0 授权失败，请检查应用权限与密钥".into());
    }
    let body = String::from_utf8(bytes(response, 32768).await?).map_err(|_| "授权响应无效")?;
    let parsed =
        tauri::Url::parse(&format!("http://127.0.0.1/?{body}")).map_err(|_| "授权响应无效")?;
    Ok(parsed.query_pairs().into_owned().collect())
}
async fn authorize1(
    app: &tauri::AppHandle,
    mut session: Session,
    config: Registration,
    listener: std::net::TcpListener,
    redirect: tauri::Url,
    cancel: Arc<AtomicBool>,
) -> Result<Session, String> {
    let trello = session.account.provider == "trello";
    let root = if trello {
        "https://trello.com"
    } else {
        "https://www.evernote.com"
    };
    let request_url = tauri::Url::parse(&format!(
        "{root}{}",
        if trello {
            "/1/OAuthGetRequestToken"
        } else {
            "/oauth"
        }
    ))
    .map_err(|_| "授权地址无效")?;
    let state = uuid::Uuid::new_v4().to_string();
    let mut callback = redirect.clone();
    callback.query_pairs_mut().append_pair("state", &state);
    let pending = oauth1_token(
        &request_url,
        &config.client_id,
        &config.client_secret,
        "",
        "",
        &[("oauth_callback", callback.as_str())],
    )
    .await?;
    let token = pending.get("oauth_token").ok_or("授权响应缺少临时令牌")?;
    let token_secret = pending
        .get("oauth_token_secret")
        .ok_or("授权响应缺少临时密钥")?;
    let mut authorization = tauri::Url::parse(&format!(
        "{root}{}",
        if trello {
            "/1/OAuthAuthorizeToken"
        } else {
            "/OAuth.action"
        }
    ))
    .map_err(|_| "授权地址无效")?;
    authorization
        .query_pairs_mut()
        .append_pair("oauth_token", token);
    if trello {
        authorization.query_pairs_mut().extend_pairs([
            ("scope", "read"),
            ("name", "Tano"),
            ("expiration", "1day"),
        ]);
    }
    if cancel.load(Ordering::SeqCst) {
        return Err("授权已取消".into());
    }
    app.opener()
        .open_url(authorization.as_str(), None::<String>)
        .map_err(|_| "无法打开系统浏览器")?;
    let result = wait_callback(listener, redirect, state, cancel.clone()).await?;
    if result.get("oauth_token") != Some(token) {
        return Err("授权回调令牌不匹配".into());
    }
    let verifier = result.get("oauth_verifier").ok_or("授权响应缺少确认码")?;
    if cancel.load(Ordering::SeqCst) {
        return Err("授权已取消".into());
    }
    let endpoint = tauri::Url::parse(&format!(
        "{root}{}",
        if trello {
            "/1/OAuthGetAccessToken"
        } else {
            "/oauth"
        }
    ))
    .map_err(|_| "授权地址无效")?;
    let result = oauth1_token(
        &endpoint,
        &config.client_id,
        &config.client_secret,
        token,
        token_secret,
        &[("oauth_verifier", verifier)],
    )
    .await?;
    session.token = result
        .get("oauth_token")
        .filter(|token| !token.is_empty())
        .ok_or("授权响应缺少令牌")?
        .clone();
    session.token_secret = result
        .get("oauth_token_secret")
        .cloned()
        .unwrap_or_default();
    session.api_key = config.client_id;
    session.client_secret = config.client_secret;
    if !trello {
        session.account.context = result
            .get("edam_noteStoreUrl")
            .cloned()
            .ok_or("Evernote 授权缺少 NoteStore URL")?;
    }
    Ok(session)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn callback_rejects_wrong_state_before_accepting_the_matching_attempt() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let redirect =
            tauri::Url::parse(&format!("http://localhost:{}/callback", address.port())).unwrap();
        let sender = std::thread::spawn(move || {
            for (state, status) in [("wrong", "400"), ("matching", "200")] {
                let mut socket = std::net::TcpStream::connect(address).unwrap();
                socket
                    .set_read_timeout(Some(std::time::Duration::from_secs(3)))
                    .unwrap();
                write!(
                    socket,
                    "GET /callback?state={state}&code=code HTTP/1.1\r\nHost: {address}\r\n\r\n"
                )
                .unwrap();
                let mut output = String::new();
                socket.read_to_string(&mut output).unwrap();
                assert!(output.contains(status));
            }
        });
        let result = wait_callback(
            listener,
            redirect,
            "matching".into(),
            Arc::new(AtomicBool::new(false)),
        )
        .await
        .unwrap();
        sender.join().unwrap();
        assert_eq!(result.get("code").map(String::as_str), Some("code"));
    }
    #[tokio::test]
    async fn callback_honors_cancellation() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let redirect = tauri::Url::parse(&format!(
            "http://{}/callback",
            listener.local_addr().unwrap()
        ))
        .unwrap();
        assert!(wait_callback(
            listener,
            redirect,
            "state".into(),
            Arc::new(AtomicBool::new(true))
        )
        .await
        .unwrap_err()
        .contains("取消"));
    }
    #[test]
    fn callbacks_are_loopback_only() {
        assert!(callback_url("http://127.0.0.1:43843/callback").is_ok());
        assert!(callback_url("http://localhost:43843/callback").is_ok());
        for value in [
            "https://example.com/callback",
            "http://localhost.example.com:43843/callback",
            "http://127.0.0.2:43843/callback",
            "http://localhost/callback",
            "http://user@localhost:43843/callback",
            "http://localhost:43843/callback#fragment",
            "http://127.0.0.1:43843/callback?state=wrong",
        ] {
            assert!(callback_url(value).is_err());
        }
    }
    #[test]
    fn oauth1_matches_the_rfc5849_signature_example() {
        let header = sign1(
            "GET",
            &tauri::Url::parse("http://photos.example.net/photos?file=vacation.jpg&size=original")
                .unwrap(),
            "dpf43f3p2l4k3l03",
            "kd94hf93k423kf44",
            "nnch734d00sl2jdk",
            "pfkkdhi9sl3r4s00",
            &[],
            "kllo9940pd9333jh",
            "1191242096",
        )
        .unwrap();
        assert!(header.contains("tR3%2BTy81lMeYAr%2FFid0kMTYa%2FWM%3D"));
    }
}
