//! Device-local connection configuration. Passwords and OAuth tokens never enter workspace files.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeMap, sync::Mutex};

static STATE_LOCK: Mutex<()> = Mutex::new(());
static CREDENTIAL_LOCK: Mutex<()> = Mutex::new(());
#[derive(Serialize, Deserialize)]
struct CredentialManifest {
    generation: String,
    chunks: usize,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub provider: String,
    pub label: String,
    pub server: String,
}
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Secret {
    #[serde(default)]
    username: String,
    #[serde(default)]
    password: String,
    #[serde(default)]
    access_token: String,
    #[serde(default)]
    refresh_token: String,
    #[serde(default)]
    client_id: String,
    #[serde(default)]
    client_secret: String,
    #[serde(default)]
    expires_at: u64,
}
fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn id(value: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| "连接 ID 无效".into())
}
fn entry(account: &str) -> Result<keyring::Entry, String> {
    id(account)?;
    keyring::Entry::new("Tano.Planning", account).map_err(|_| "无法访问系统凭据库".into())
}
fn secret(account: &str) -> Result<Secret, String> {
    let _guard = CREDENTIAL_LOCK.lock().map_err(|_| "无法访问系统凭据库")?;
    let manifest = read_manifest(account)?;
    let mut bytes = Vec::new();
    for index in 0..manifest.chunks {
        bytes.extend(
            part_entry(account, &manifest, index)?
                .get_secret()
                .map_err(|_| "授权信息不可用，请重新连接账号")?,
        );
    }
    serde_json::from_slice(&bytes).map_err(|_| "授权信息损坏，请重新连接账号".into())
}
fn read_manifest(account: &str) -> Result<CredentialManifest, String> {
    let manifest: CredentialManifest = serde_json::from_str(
        &entry(account)?
            .get_password()
            .map_err(|_| "授权信息不可用，请重新连接账号")?,
    )
    .map_err(|_| "授权信息损坏，请重新连接账号")?;
    id(&manifest.generation)?;
    if manifest.chunks == 0 || manifest.chunks > 128 {
        return Err("授权信息无效".into());
    }
    Ok(manifest)
}
fn part_entry(
    account: &str,
    manifest: &CredentialManifest,
    index: usize,
) -> Result<keyring::Entry, String> {
    id(account)?;
    id(&manifest.generation)?;
    keyring::Entry::new(
        "Tano.Planning",
        &format!("{account}:{}:{index}", manifest.generation),
    )
    .map_err(|_| "无法访问系统凭据库".into())
}
fn remove_parts(account: &str, manifest: &CredentialManifest) {
    for index in 0..manifest.chunks {
        if let Ok(entry) = part_entry(account, manifest, index) {
            let _ = entry.delete_credential();
        }
    }
}
fn save_secret(account: &str, value: &Secret) -> Result<(), String> {
    let _guard = CREDENTIAL_LOCK.lock().map_err(|_| "无法访问系统凭据库")?;
    let previous = read_manifest(account).ok();
    let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    // Windows credential blobs are limited to 2560 bytes. A generation manifest commits all chunks atomically.
    let manifest = CredentialManifest {
        generation: uuid::Uuid::new_v4().to_string(),
        chunks: bytes.len().div_ceil(2000),
    };
    if manifest.chunks > 128 {
        return Err("授权信息过大".into());
    }
    let save = || -> Result<(), String> {
        for (index, chunk) in bytes.chunks(2000).enumerate() {
            part_entry(account, &manifest, index)?
                .set_secret(chunk)
                .map_err(|_| "无法保存到系统凭据库；连接未保存")?;
        }
        entry(account)?
            .set_password(&serde_json::to_string(&manifest).map_err(|e| e.to_string())?)
            .map_err(|_| "无法保存到系统凭据库；连接未保存".into())
    };
    if let Err(error) = save() {
        remove_parts(account, &manifest);
        return Err(error);
    }
    if let Some(old) = previous {
        remove_parts(account, &old);
    }
    Ok(())
}
fn file(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(crate::app_data(app)?.join("planning-connections.json"))
}
fn accounts(app: &tauri::AppHandle) -> Result<BTreeMap<String, Account>, String> {
    let path = file(app)?;
    if !path.exists() {
        return Ok(BTreeMap::new());
    }
    serde_json::from_str(&std::fs::read_to_string(path).map_err(|e| e.to_string())?)
        .map_err(|_| "连接配置损坏，原文件已保留".into())
}
fn write_accounts(
    app: &tauri::AppHandle,
    values: &BTreeMap<String, Account>,
) -> Result<(), String> {
    let path = file(app)?;
    let body = serde_json::to_string_pretty(values).map_err(|e| e.to_string())?;
    if path.exists() {
        let base = crate::storage::read(&path)?;
        match crate::storage::write(&path, &body, &base.hash)? {
            crate::storage::WriteResult::Saved { .. } => Ok(()),
            _ => Err("连接配置已变化，请重试".into()),
        }
    } else {
        crate::storage::create(&path, &body)
    }
}
fn validate_server(provider: &str, server: &str) -> Result<tauri::Url, String> {
    let url = tauri::Url::parse(server).map_err(|_| "服务器地址无效")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("请使用不含账号密码的 HTTPS 服务器地址".into());
    }
    let host = url.host_str().unwrap_or("");
    let allowed = match provider {
        "google" => host == "www.googleapis.com" && url.path().starts_with("/calendar/v3/"),
        "microsoft" => host == "graph.microsoft.com" && url.path().starts_with("/v1.0/me/todo/"),
        "todoist" => host == "api.todoist.com" && url.path().starts_with("/api/v1/"),
        "icloud" => {
            host == "caldav.icloud.com"
                || (host.ends_with(".icloud.com")
                    && host.starts_with('p')
                    && host.contains("-caldav"))
        }
        "feishu" | "caldav" => true,
        _ => false,
    };
    if !allowed {
        return Err("服务器不属于所选服务".into());
    }
    Ok(url)
}
fn request_url(account: &Account, value: &str) -> Result<tauri::Url, String> {
    let base = validate_server(&account.provider, &account.server)?;
    let url = base.join(value).map_err(|_| "请求地址无效")?;
    validate_server(&account.provider, url.as_str())?;
    if account.provider != "icloud" && url.origin() != base.origin() {
        return Err("服务器返回了其他站点的地址，已停止传递凭据".into());
    }
    Ok(url)
}
fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "无法建立网络连接".into())
}
#[tauri::command]
pub fn plan_accounts_list(app: tauri::AppHandle) -> Result<Vec<Account>, String> {
    let _guard = STATE_LOCK.lock().map_err(|e| e.to_string())?;
    Ok(accounts(&app)?.into_values().collect())
}
#[tauri::command]
pub fn plan_account_save(
    app: tauri::AppHandle,
    mut account: Account,
    credentials: Secret,
) -> Result<Account, String> {
    validate_server(&account.provider, &account.server)?;
    if !["caldav", "icloud", "feishu", "todoist"].contains(&account.provider.as_str()) {
        return Err("此服务需要浏览器授权".into());
    }
    if account.label.trim().is_empty() || account.label.len() > 200 {
        return Err("请填写连接名称".into());
    }
    account.id = uuid::Uuid::new_v4().to_string();
    save_secret(&account.id, &credentials)?;
    let _guard = STATE_LOCK.lock().map_err(|e| e.to_string())?;
    let mut values = accounts(&app)?;
    values.insert(account.id.clone(), account.clone());
    write_accounts(&app, &values)?;
    Ok(account)
}
#[tauri::command]
pub fn plan_account_remove(app: tauri::AppHandle, account_id: String) -> Result<(), String> {
    let _guard = STATE_LOCK.lock().map_err(|e| e.to_string())?;
    let mut values = accounts(&app)?;
    let _credentials = CREDENTIAL_LOCK.lock().map_err(|_| "无法访问系统凭据库")?;
    let manifest = read_manifest(&account_id).ok();
    match entry(&account_id)?.delete_credential() {
        Ok(_) | Err(keyring::Error::NoEntry) => {}
        Err(_) => return Err("无法移除系统凭据，请重试".into()),
    }
    if let Some(manifest) = manifest {
        remove_parts(&account_id, &manifest);
    }
    values.remove(&account_id);
    write_accounts(&app, &values)
}
fn oauth_endpoints(
    provider: &str,
) -> Result<(&'static str, &'static str, &'static str, &'static str), String> {
    match provider {
        "google" => Ok(("https://accounts.google.com/o/oauth2/v2/auth", "https://oauth2.googleapis.com/token", "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly", "https://www.googleapis.com/calendar/v3/")),
        "microsoft" => Ok(("https://login.microsoftonline.com/common/oauth2/v2.0/authorize", "https://login.microsoftonline.com/common/oauth2/v2.0/token", "offline_access Tasks.ReadWrite", "https://graph.microsoft.com/v1.0/me/todo/")),
        _ => Err("不支持此授权服务".into()),
    }
}
async fn exchange(
    provider: &str,
    form: Vec<(&str, String)>,
    value: &mut Secret,
) -> Result<(), String> {
    let (_, endpoint, _, _) = oauth_endpoints(provider)?;
    let response = client()?
        .post(endpoint)
        .form(&form)
        .send()
        .await
        .map_err(|_| "授权服务器连接失败")?;
    if !response.status().is_success() {
        return Err("授权失败或已过期，请核对应用配置并重新连接".into());
    }
    let token: Value = response.json().await.map_err(|_| "授权响应无效")?;
    value.access_token = token["access_token"]
        .as_str()
        .ok_or("授权响应缺少令牌")?
        .into();
    if let Some(refresh) = token["refresh_token"].as_str() {
        value.refresh_token = refresh.into();
    }
    value.expires_at = now() + token["expires_in"].as_u64().unwrap_or(3600);
    Ok(())
}
#[tauri::command]
pub async fn plan_account_oauth(
    app: tauri::AppHandle,
    provider: String,
    label: String,
    client_id: String,
    client_secret: String,
) -> Result<Account, String> {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    use sha2::{Digest, Sha256};
    use tauri_plugin_opener::OpenerExt;
    let (authorize, _, scope, server) = oauth_endpoints(&provider)?;
    if client_id.trim().is_empty() || label.trim().is_empty() {
        return Err("请先填写应用 Client ID 和连接名称".into());
    }
    let listener =
        std::net::TcpListener::bind("127.0.0.1:0").map_err(|_| "无法启动本机授权回调")?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let redirect = format!(
        "http://{}:{}/",
        if provider == "microsoft" {
            "localhost"
        } else {
            "127.0.0.1"
        },
        listener.local_addr().map_err(|e| e.to_string())?.port()
    );
    let state = uuid::Uuid::new_v4().to_string();
    let verifier = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let mut url = tauri::Url::parse(authorize).map_err(|e| e.to_string())?;
    url.query_pairs_mut().extend_pairs([
        ("client_id", client_id.as_str()),
        ("redirect_uri", redirect.as_str()),
        ("response_type", "code"),
        ("scope", scope),
        ("state", state.as_str()),
        ("code_challenge", challenge.as_str()),
        ("code_challenge_method", "S256"),
        ("access_type", "offline"),
        ("prompt", "consent"),
    ]);
    app.opener()
        .open_url(url.as_str(), None::<String>)
        .map_err(|_| "无法打开系统浏览器")?;
    let code = tauri::async_runtime::spawn_blocking(move || {
        use std::io::{Read, Write};
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(180);
        while std::time::Instant::now() < deadline {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    stream.set_read_timeout(Some(std::time::Duration::from_secs(2))).ok();
                    let mut bytes = [0; 8192];
                    let count = stream.read(&mut bytes).unwrap_or(0);
                    let line = String::from_utf8_lossy(&bytes[..count]);
                    let target = line.lines().next().and_then(|s| s.strip_prefix("GET ")).and_then(|s| s.split_whitespace().next()).unwrap_or("");
                    let Some(url) = tauri::Url::parse(&format!("http://127.0.0.1{target}")).ok() else { continue; };
                    let query: BTreeMap<_, _> = url.query_pairs().into_owned().collect();
                    if url.path() != "/" || query.get("state") != Some(&state) {
                        let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                        continue;
                    }
                    let body = "Authorization received. You can close this tab and return to Tano.";
                    let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
                    return query.get("code").cloned().ok_or_else(|| "授权已取消".to_string());
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(std::time::Duration::from_millis(50)),
                Err(_) => return Err("授权回调失败".into()),
            }
        }
        Err("授权等待超时，请重试".into())
    }).await.map_err(|e| e.to_string())??;
    let mut credentials = Secret {
        client_id: client_id.clone(),
        client_secret: client_secret.clone(),
        ..Secret::default()
    };
    let mut form = vec![
        ("grant_type", "authorization_code".into()),
        ("code", code),
        ("redirect_uri", redirect),
        ("client_id", client_id),
        ("code_verifier", verifier),
    ];
    if !client_secret.is_empty() {
        form.push(("client_secret", client_secret));
    }
    exchange(&provider, form, &mut credentials).await?;
    let account = Account {
        id: uuid::Uuid::new_v4().to_string(),
        provider,
        label,
        server: server.into(),
    };
    save_secret(&account.id, &credentials)?;
    let _guard = STATE_LOCK.lock().map_err(|e| e.to_string())?;
    let mut values = accounts(&app)?;
    values.insert(account.id.clone(), account.clone());
    write_accounts(&app, &values)?;
    Ok(account)
}
#[tauri::command]
pub async fn plan_remote_request(
    app: tauri::AppHandle,
    account_id: String,
    path: String,
    method: String,
    headers: BTreeMap<String, String>,
    body: Option<String>,
) -> Result<Value, String> {
    let account = accounts(&app)?.remove(&account_id).ok_or("连接已移除")?;
    let mut credentials = secret(&account_id)?;
    if ["google", "microsoft"].contains(&account.provider.as_str())
        && credentials.expires_at <= now() + 60
    {
        if credentials.refresh_token.is_empty() {
            return Err("授权已过期，请重新连接账号".into());
        }
        let mut form = vec![
            ("grant_type", "refresh_token".into()),
            ("refresh_token", credentials.refresh_token.clone()),
            ("client_id", credentials.client_id.clone()),
        ];
        if !credentials.client_secret.is_empty() {
            form.push(("client_secret", credentials.client_secret.clone()));
        }
        exchange(&account.provider, form, &mut credentials).await?;
        save_secret(&account_id, &credentials)?;
    }
    if ![
        "GET", "POST", "PATCH", "PUT", "DELETE", "PROPFIND", "REPORT",
    ]
    .contains(&method.as_str())
    {
        return Err("不支持的同步请求".into());
    }
    if body.as_ref().is_some_and(|v| v.len() > 5_000_000) {
        return Err("同步数据过大".into());
    }
    let mut url = request_url(&account, &path)?;
    for _ in 0..5 {
        let mut request = client()?.request(
            reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?,
            url.clone(),
        );
        request = if credentials.access_token.is_empty() {
            request.basic_auth(&credentials.username, Some(&credentials.password))
        } else {
            request.bearer_auth(&credentials.access_token)
        };
        for (key, value) in &headers {
            if ![
                "content-type",
                "if-match",
                "if-none-match",
                "depth",
                "x-request-id",
                "prefer",
            ]
            .contains(&key.to_ascii_lowercase().as_str())
            {
                return Err("不支持的同步请求头".into());
            }
            request = request.header(key, value);
        }
        if let Some(body) = &body {
            request = request.body(body.clone());
        }
        let mut response = request
            .send()
            .await
            .map_err(|_| "无法连接服务，请检查网络与服务器地址")?;
        if response.status().is_redirection()
            && ["GET", "PROPFIND", "REPORT"].contains(&method.as_str())
        {
            let next = response
                .headers()
                .get("location")
                .and_then(|v| v.to_str().ok())
                .ok_or("服务重定向无效")?;
            url = request_url(
                &account,
                url.join(next).map_err(|_| "服务重定向无效")?.as_str(),
            )?;
            continue;
        }
        let status = response.status().as_u16();
        let etag = response
            .headers()
            .get("etag")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_owned();
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| "同步响应中断")? {
            if bytes.len() + chunk.len() > 16_000_000 {
                return Err("单次同步响应过大，请缩小日历范围".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        return Ok(
            json!({ "status": status, "etag": etag, "url": url.as_str(), "body": String::from_utf8(bytes).map_err(|_| "同步响应编码无效")? }),
        );
    }
    Err("服务重定向次数过多".into())
}
#[tauri::command]
pub fn plan_sync_state_read(app: tauri::AppHandle) -> Result<Value, String> {
    let _guard = STATE_LOCK.lock().map_err(|e| e.to_string())?;
    let path = crate::app_data(&app)?.join("planning-sync.json");
    if !path.exists() {
        return Ok(json!({ "content": "", "hash": "" }));
    }
    let snapshot = crate::storage::read(&path)?;
    Ok(json!({ "content": snapshot.content, "hash": snapshot.hash }))
}
#[tauri::command]
pub fn plan_sync_state_write(
    app: tauri::AppHandle,
    content: String,
    expected_hash: String,
) -> Result<Value, String> {
    let _guard = STATE_LOCK.lock().map_err(|e| e.to_string())?;
    if content.len() > 32_000_000 {
        return Err("同步状态过大".into());
    }
    serde_json::from_str::<Value>(&content).map_err(|_| "同步状态无效")?;
    let path = crate::app_data(&app)?.join("planning-sync.json");
    if !path.exists() && expected_hash.is_empty() {
        crate::storage::create(&path, &content)?;
    } else if !matches!(
        crate::storage::write(&path, &content, &expected_hash)?,
        crate::storage::WriteResult::Saved { .. }
    ) {
        return Err("另一窗口已更新同步状态，请重试".into());
    }
    let snapshot = crate::storage::read(&path)?;
    Ok(json!({ "content": snapshot.content, "hash": snapshot.hash }))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_credential_leaks_and_provider_escape() {
        let a = Account {
            id: uuid::Uuid::new_v4().to_string(),
            provider: "google".into(),
            label: "test".into(),
            server: "https://www.googleapis.com/calendar/v3/".into(),
        };
        for url in [
            "https://evil.test/",
            "http://www.googleapis.com/calendar/v3/",
            "https://user:password@www.googleapis.com/calendar/v3/",
            "https://www.googleapis.com/drive/v3/",
        ] {
            assert!(request_url(&a, url).is_err());
        }
        assert!(request_url(&a, "users/me/calendarList").is_ok());
        let dav = Account {
            provider: "caldav".into(),
            server: "https://calendar.example.test/".into(),
            ..a
        };
        assert!(request_url(&dav, "https://other.example.test/").is_err());
    }
}
