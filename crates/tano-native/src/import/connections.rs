//! Read-only account imports. Tokens stay in process memory, outside workspaces and webviews.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

#[derive(Clone, Serialize)]
pub struct Account {
    pub id: String,
    pub provider: String,
    pub label: String,
    pub context: String,
}
#[derive(Clone)]
pub struct Session {
    pub account: Account,
    pub token: String,
    pub token_secret: String,
    pub api_key: String,
    pub client_secret: String,
}
static ACCOUNTS: Mutex<BTreeMap<String, Session>> = Mutex::new(BTreeMap::new());
static FLOWS: Mutex<BTreeMap<String, Arc<AtomicBool>>> = Mutex::new(BTreeMap::new());
pub const PROVIDERS: &[&str] = &[
    "notion",
    "confluence",
    "evernote",
    "trello",
    "roam",
    "asana",
    "workflowy",
    "jira",
    "monday",
    "quip",
    "google-docs",
];
pub fn token_allowed(provider: &str) -> bool {
    PROVIDERS.contains(&provider) && !["confluence", "jira"].contains(&provider)
}
pub fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "无法建立连接".into())
}
pub async fn bytes(mut response: reqwest::Response, max: usize) -> Result<Vec<u8>, String> {
    let mut result = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "第三方服务响应中断")? {
        if result.len() + chunk.len() > max {
            return Err("第三方服务响应超过限制，请缩小导入范围".into());
        }
        result.extend_from_slice(&chunk);
    }
    Ok(result)
}
#[tauri::command]
pub fn import_capabilities(app: tauri::AppHandle) -> Result<Value, String> {
    let registrations = super::import_oauth::registrations(&app)?;
    Ok(Value::Array(PROVIDERS.iter().map(|provider| json!({"provider":provider,"oauth":registrations.contains_key(*provider),"token":token_allowed(provider)})).collect()))
}
#[tauri::command]
pub fn import_accounts() -> Result<Vec<Account>, String> {
    Ok(ACCOUNTS
        .lock()
        .map_err(|_| "连接暂不可用")?
        .values()
        .map(|session| session.account.clone())
        .collect())
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectInput {
    pub provider: String,
    pub label: String,
    pub context: String,
    pub token: String,
    pub api_key: String,
    pub flow_id: String,
    pub oauth: bool,
}
#[tauri::command]
pub async fn import_connect(app: tauri::AppHandle, input: ConnectInput) -> Result<Account, String> {
    if !PROVIDERS.contains(&input.provider.as_str())
        || input.label.trim().is_empty()
        || input.label.len() > 200
        || input.context.len() > 1000
    {
        return Err("连接信息无效".into());
    }
    uuid::Uuid::parse_str(&input.flow_id).map_err(|_| "授权请求无效")?;
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut flows = FLOWS.lock().map_err(|_| "授权暂不可用")?;
        if flows.len() >= 8 || flows.contains_key(&input.flow_id) {
            return Err("请先完成或取消已有授权".into());
        }
        flows.insert(input.flow_id.clone(), cancel.clone());
    }
    let result = async {
        let mut session = Session {
            account: Account {
                id: uuid::Uuid::new_v4().to_string(),
                provider: input.provider.clone(),
                label: input.label.trim().into(),
                context: input.context.trim().into(),
            },
            token: input.token.trim().into(),
            token_secret: String::new(),
            api_key: input.api_key.trim().into(),
            client_secret: String::new(),
        };
        if input.oauth {
            session = super::import_oauth::authorize(&app, session, cancel.clone()).await?;
        } else if !token_allowed(&input.provider)
            || session.token.is_empty()
            || session.token.len() > 16384
            || session.token.contains(['\r', '\n'])
        {
            return Err("请填写有效的 API 令牌".into());
        }
        if session.account.provider == "roam"
            && (session.account.context.is_empty()
                || !session
                    .account
                    .context
                    .chars()
                    .all(|character| character.is_alphanumeric() || "_-".contains(character)))
        {
            return Err("请填写有效的 Roam Graph 名称".into());
        }
        if session.account.provider == "evernote" && session.account.context.is_empty() {
            let shard = session
                .token
                .split(':')
                .find_map(|part| part.strip_prefix("S="));
            session.account.context = format!(
                "https://www.evernote.com/shard/{}/notestore",
                shard.ok_or("请填写 Evernote NoteStore URL")?
            );
        }
        if session.account.provider == "trello" && session.api_key.is_empty() {
            return Err("Trello 连接需要应用 API Key".into());
        }
        if cancel.load(Ordering::SeqCst) {
            return Err("授权已取消".into());
        }
        let account = session.account.clone();
        ACCOUNTS
            .lock()
            .map_err(|_| "连接暂不可用")?
            .insert(account.id.clone(), session);
        Ok(account)
    }
    .await;
    FLOWS
        .lock()
        .map_err(|_| "授权暂不可用")?
        .remove(&input.flow_id);
    result
}
#[tauri::command]
pub fn import_cancel(flow_id: String) -> Result<(), String> {
    if let Some(cancel) = FLOWS.lock().map_err(|_| "授权暂不可用")?.get(&flow_id) {
        cancel.store(true, Ordering::SeqCst);
    }
    Ok(())
}
#[tauri::command]
pub fn import_disconnect(account_id: String) -> Result<(), String> {
    ACCOUNTS
        .lock()
        .map_err(|_| "连接暂不可用")?
        .remove(&account_id);
    Ok(())
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub path: String,
    #[serde(default = "get")]
    pub method: String,
    pub body: Option<Value>,
    pub rpc: Option<String>,
}
fn get() -> String {
    "GET".into()
}
pub fn request_url(session: &Session, request: &Request) -> Result<tauri::Url, String> {
    let provider = session.account.provider.as_str();
    if request.rpc.is_some() && provider != "evernote" {
        return Err("此服务不支持 EDAM 请求".into());
    }
    let base = match provider {
        "notion" => "https://api.notion.com",
        "asana" => "https://app.asana.com",
        "confluence" | "jira" => "https://api.atlassian.com",
        "google-docs" => "https://www.googleapis.com",
        "monday" => "https://api.monday.com",
        "trello" => "https://api.trello.com",
        "workflowy" => "https://workflowy.com",
        "roam" => "https://api.roamresearch.com",
        "quip" => "https://platform.quip.com",
        "evernote" => &session.account.context,
        _ => return Err("不支持的导入服务".into()),
    };
    let root = tauri::Url::parse(base).map_err(|_| "服务地址无效")?;
    if provider == "evernote"
        && (root.scheme() != "https"
            || root.host_str() != Some("www.evernote.com")
            || !root.path().starts_with("/shard/")
            || !root.path().ends_with("/notestore")
            || root.query().is_some())
    {
        return Err("Evernote NoteStore URL 无效".into());
    }
    if request.path.len() > 8192 || request.path.contains(['\\', '#']) {
        return Err("请求路径无效".into());
    }
    let url = root.join(&request.path).map_err(|_| "请求路径无效")?;
    if url.origin() != root.origin()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.port().is_some()
    {
        return Err("已拒绝向其他服务传递凭据".into());
    }
    let path = url.path();
    let read = request.method == "GET"
        && match provider {
            "notion" => path.starts_with("/v1/blocks/") && path.ends_with("/children"),
            "asana" => path.starts_with("/api/1.0/"),
            "confluence" | "jira" => {
                path == "/oauth/token/accessible-resources"
                    || path.starts_with(&format!("/ex/{provider}/"))
            }
            "google-docs" => path.starts_with("/drive/v3/files"),
            "trello" => path.starts_with("/1/"),
            "workflowy" => path.starts_with("/api/v1/nodes"),
            "quip" => path.starts_with("/1/"),
            _ => false,
        };
    let post = request.method == "POST" && match provider {
        "notion" => path == "/v1/search", "jira" => path.starts_with("/ex/jira/") && path.ends_with("/rest/api/3/search/jql"),
        "monday" => path == "/v2" && request.body.as_ref().is_some_and(|body| body["operationName"] == "TanoImport" && body["query"].as_str().is_some_and(|query| query.starts_with("query TanoImport ") && !query.contains("mutation"))),
        "roam" => path == format!("/api/graph/{}/q", session.account.context) && request.body.as_ref().is_some_and(|body| body["query"].as_str().is_some_and(|query| ["[:find (pull ?p [:node/title :block/string :block/order {:block/children ...}]) :where [?p :node/title]]", "[:find (count ?p) :where [?p :node/title]]"].contains(&query))), _ => false,
    };
    let thrift = provider == "evernote"
        && request.path.is_empty()
        && request
            .rpc
            .as_deref()
            .is_some_and(|rpc| ["listNotebooks", "findNotesMetadata", "getNote"].contains(&rpc));
    if !read && !post && !thrift {
        return Err("账号导入仅允许读取受支持的内容".into());
    }
    Ok(url)
}
#[tauri::command]
pub async fn import_request(account_id: String, request: Request) -> Result<Value, String> {
    let session = ACCOUNTS
        .lock()
        .map_err(|_| "连接暂不可用")?
        .get(&account_id)
        .cloned()
        .ok_or("连接已移除，请重新连接账号")?;
    let mut url = request_url(&session, &request)?;
    let mut outgoing = client()?.request(
        if request.rpc.is_some() {
            reqwest::Method::POST
        } else {
            reqwest::Method::from_bytes(request.method.as_bytes()).map_err(|_| "请求方法无效")?
        },
        url.clone(),
    );
    if session.account.provider == "trello" && session.token_secret.is_empty() {
        url.query_pairs_mut()
            .append_pair("key", &session.api_key)
            .append_pair("token", &session.token);
        outgoing = client()?.get(url);
    } else if !session.token_secret.is_empty() && session.account.provider == "trello" {
        outgoing = outgoing.header(
            "Authorization",
            super::import_oauth::oauth1_header(
                "GET",
                &url,
                &session.api_key,
                &session.client_secret,
                &session.token,
                &session.token_secret,
                &[],
            )?,
        );
    } else if session.account.provider != "evernote" {
        outgoing = outgoing.header(
            "Authorization",
            if session.account.provider == "monday" {
                session.token.clone()
            } else {
                format!("Bearer {}", session.token)
            },
        );
    }
    if session.account.provider == "notion" {
        outgoing = outgoing.header("Notion-Version", "2022-06-28");
    }
    if let Some(rpc) = &request.rpc {
        let suffix = request
            .body
            .as_ref()
            .and_then(Value::as_str)
            .ok_or("Evernote 请求无效")?;
        let fields = STANDARD.decode(suffix).map_err(|_| "Evernote 请求无效")?;
        if fields.len() > 32768 || fields.last() != Some(&0) {
            return Err("Evernote 请求过大或格式无效".into());
        }
        let mut body = vec![0x80, 1, 0, 1];
        body.extend((rpc.len() as i32).to_be_bytes());
        body.extend(rpc.as_bytes());
        body.extend(0i32.to_be_bytes());
        body.extend([11, 0, 1]);
        body.extend((session.token.len() as i32).to_be_bytes());
        body.extend(session.token.as_bytes());
        body.extend(fields);
        outgoing = outgoing
            .header("Content-Type", "application/x-thrift")
            .body(body);
    } else if let Some(body) = &request.body {
        if body.to_string().len() > 65536 {
            return Err("读取请求过大".into());
        }
        outgoing = outgoing.json(body);
    }
    let result = outgoing
        .send()
        .await
        .map_err(|_| "无法连接第三方服务，请检查网络")?;
    let status = result.status().as_u16();
    if (300..400).contains(&status) {
        return Err("第三方服务发生重定向，已停止传递凭据".into());
    }
    if !(200..300).contains(&status) {
        return Ok(json!({"status":status,"body":""}));
    }
    let body = bytes(result, 16 * 1024 * 1024).await?;
    if !ACCOUNTS
        .lock()
        .map_err(|_| "连接暂不可用")?
        .contains_key(&account_id)
    {
        return Err("连接已移除，请重新连接账号".into());
    }
    // Reject direct credential echoes before crossing the webview boundary.
    if body
        .windows(session.token.len())
        .any(|window| window == session.token.as_bytes())
    {
        return Err("服务响应包含敏感凭据，已停止读取".into());
    }
    if request.rpc.is_some() {
        return Ok(json!({"status":status,"body":"","binary":STANDARD.encode(body)}));
    }
    Ok(
        json!({"status":status,"body":String::from_utf8(body).map_err(|_| "第三方服务响应编码无效")?}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    fn session(provider: &str) -> Session {
        Session {
            account: Account {
                id: "test".into(),
                provider: provider.into(),
                label: "Test".into(),
                context: "graph".into(),
            },
            token: "private-token".into(),
            token_secret: String::new(),
            api_key: String::new(),
            client_secret: String::new(),
        }
    }
    fn request(path: &str, method: &str) -> Request {
        Request {
            path: path.into(),
            method: method.into(),
            body: None,
            rpc: None,
        }
    }
    #[test]
    fn import_requests_do_not_forward_credentials_or_allow_writes() {
        let session = session("trello");
        assert!(request_url(&session, &request("/1/members/me/boards", "GET")).is_ok());
        for path in [
            "https://evil.test/1/boards",
            "//evil.test/1/boards",
            "https://user@api.trello.com/1/boards",
            "https://api.trello.com:444/1/boards",
            "/1/boards#fragment",
            "/1/../oauth/token",
            "/1/boards\\evil",
        ] {
            assert!(
                request_url(&session, &request(path, "GET")).is_err(),
                "{path}"
            );
        }
        for method in ["POST", "PUT", "DELETE", "PATCH"] {
            assert!(request_url(&session, &request("/1/cards", method)).is_err());
        }
        let mut rpc = request("/1/cards", "GET");
        rpc.rpc = Some("getNote".into());
        assert!(request_url(&session, &rpc).is_err());
    }
    #[test]
    fn post_requests_are_limited_to_read_operations() {
        let mut read = request("/v2", "POST");
        read.body = Some(
            json!({"operationName":"TanoImport","query":"query TanoImport { boards { id } }"}),
        );
        assert!(request_url(&session("monday"), &read).is_ok());
        read.body = Some(
            json!({"operationName":"TanoImport","query":"mutation TanoImport { create_board { id } }"}),
        );
        assert!(request_url(&session("monday"), &read).is_err());
        assert!(request_url(&session("notion"), &request("/v1/pages", "POST")).is_err());
        assert!(request_url(&session("notion"), &request("/v1/search", "POST")).is_ok());
        assert!(request_url(
            &session("roam"),
            &request("/api/graph/graph/transact", "POST")
        )
        .is_err());
    }
    #[test]
    fn edam_uses_only_the_official_notestore_and_read_rpcs() {
        let mut session = session("evernote");
        session.account.context = "https://www.evernote.com/shard/s1/notestore".into();
        let mut read = request("", "GET");
        read.rpc = Some("listNotebooks".into());
        assert!(request_url(&session, &read).is_ok());
        read.rpc = Some("createNote".into());
        assert!(request_url(&session, &read).is_err());
        read.rpc = Some("getNote".into());
        session.account.context = "https://evil.test/shard/s1/notestore".into();
        assert!(request_url(&session, &read).is_err());
    }
}
