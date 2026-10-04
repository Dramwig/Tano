use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{ipc::Channel, State, WebviewWindow};
use tokio::sync::watch;

static CONNECTION_LOCK: Mutex<()> = Mutex::new(());
static SESSION_LOCK: Mutex<()> = Mutex::new(());

#[derive(Default)]
pub struct AssistantState {
    requests: Mutex<Requests>,
}

#[derive(Default)]
struct Requests {
    active: HashMap<String, watch::Sender<bool>>,
    stopped: HashMap<String, Instant>,
}

impl Requests {
    fn stop_window(&self, label: &str) {
        for (owner, sender) in &self.active {
            if owner
                .rsplit_once(':')
                .is_some_and(|(window, _)| window == label)
            {
                let _ = sender.send(true);
            }
        }
    }
    fn start(&mut self, owner: &str) -> Result<watch::Receiver<bool>, String> {
        self.stopped
            .retain(|_, at| at.elapsed() < Duration::from_secs(180));
        if self.stopped.remove(owner).is_some() {
            return Err("已停止生成".into());
        }
        if self.active.len() >= 8 || self.active.contains_key(owner) {
            return Err("助手运行数量超过限制或标识重复".into());
        }
        let (sender, receiver) = watch::channel(false);
        self.active.insert(owner.to_owned(), sender);
        Ok(receiver)
    }

    fn stop(&mut self, owner: String) -> Result<(), String> {
        if let Some(sender) = self.active.get(&owner) {
            let _ = sender.send(true);
        } else {
            self.stopped
                .retain(|_, at| at.elapsed() < Duration::from_secs(180));
            if self.stopped.len() >= 128 {
                return Err("停止请求过多，请稍后重试".into());
            }
            self.stopped.insert(owner, Instant::now());
        }
        Ok(())
    }
}

impl AssistantState {
    pub fn stop_window(&self, label: &str) {
        if let Ok(requests) = self.requests.lock() {
            requests.stop_window(label);
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum Protocol {
    ChatCompletions,
    Responses,
}

impl Default for Protocol {
    fn default() -> Self {
        Self::ChatCompletions
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Connection {
    id: String,
    name: String,
    #[serde(default)]
    kind: crate::assistant_cli::Kind,
    #[serde(default)]
    cli_path: String,
    endpoint: String,
    #[serde(default)]
    protocol: Protocol,
    #[serde(default, skip_serializing, rename = "model")]
    _legacy_model: Option<String>,
    tools: bool,
    max_output_tokens: u32,
    #[serde(default)]
    has_key: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredConnection {
    config: Connection,
    credential: Option<String>,
}

fn assistant_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = crate::app_data(app)?.join("assistant");
    std::fs::create_dir_all(&dir).map_err(|_| "无法创建助手数据目录")?;
    Ok(dir)
}

fn valid_id(id: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(id)
        .map(|_| ())
        .map_err(|_| "助手记录标识无效".into())
}

fn endpoint(value: &str) -> Result<reqwest::Url, String> {
    service_endpoint(value, "chat/completions")
}

fn generation_endpoint(config: &Connection) -> Result<reqwest::Url, String> {
    service_endpoint(
        &config.endpoint,
        match config.protocol {
            Protocol::ChatCompletions => "chat/completions",
            Protocol::Responses => "responses",
        },
    )
}

fn service_endpoint(value: &str, resource: &str) -> Result<reqwest::Url, String> {
    let mut url = reqwest::Url::parse(value).map_err(|_| "模型服务地址无效")?;
    let local = matches!(
        url.host_str(),
        Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
    );
    if (url.scheme() != "https" && !(url.scheme() == "http" && local))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.host_str().is_none()
    {
        return Err("远程模型须使用 HTTPS；地址不能包含凭据、查询或片段".into());
    }
    let path = url.path().trim_end_matches('/').to_string();
    url.set_path(&format!("{path}/{resource}"));
    Ok(url)
}

fn validate_connection(connection: &Connection) -> Result<(), String> {
    valid_id(&connection.id)?;
    if connection.name.trim().is_empty()
        || connection.name.len() > 120
        || connection.endpoint.len() > 2000
        || !(256..=32768).contains(&connection.max_output_tokens)
    {
        return Err("模型连接设置无效".into());
    }
    if connection.kind == crate::assistant_cli::Kind::Api {
        endpoint(&connection.endpoint)?;
    } else if connection.cli_path.len() > 2000 || connection.cli_path.chars().any(char::is_control)
    {
        return Err("CLI 路径无效".into());
    }
    Ok(())
}

fn read_connections(directory: &Path) -> Result<Vec<StoredConnection>, String> {
    let path = directory.join("connections.json");
    if !path.exists() {
        return Ok(Vec::new());
    }
    let bytes = std::fs::read(path).map_err(|_| "无法读取模型连接")?;
    let connections: Vec<StoredConnection> =
        serde_json::from_slice(&bytes).map_err(|_| "模型连接数据损坏，原记录已保留")?;
    if connections.len() > 20 {
        return Err("模型连接数量超过限制".into());
    }
    for stored in &connections {
        validate_connection(&stored.config)?;
        if let Some(credential) = &stored.credential {
            valid_id(credential)?;
        }
    }
    Ok(connections)
}

fn atomic_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let parent = path.parent().ok_or("助手数据路径无效")?;
    std::fs::create_dir_all(parent).map_err(|_| "无法创建助手数据目录")?;
    let bytes = serde_json::to_vec(value).map_err(|_| "助手数据无法序列化")?;
    let mut staged = tempfile::NamedTempFile::new_in(parent).map_err(|_| "无法保存助手数据")?;
    staged.write_all(&bytes).map_err(|_| "无法保存助手数据")?;
    staged
        .as_file()
        .sync_all()
        .map_err(|_| "无法持久化助手数据")?;
    staged.persist(path).map_err(|_| "无法发布助手数据")?;
    Ok(())
}

fn credential(id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new("Tano.Assistant", id).map_err(|_| "无法访问系统凭据库".into())
}

fn load_connection(app: &tauri::AppHandle, id: &str) -> Result<StoredConnection, String> {
    valid_id(id)?;
    let _guard = CONNECTION_LOCK.lock().map_err(|_| "模型连接正忙")?;
    read_connections(&assistant_dir(app)?)?
        .into_iter()
        .find(|item| item.config.id == id)
        .ok_or_else(|| "模型连接已移除".into())
}

fn http_client(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .timeout(timeout)
        .build()
        .map_err(|_| "无法建立模型连接".into())
}

fn authenticate(
    request: reqwest::RequestBuilder,
    config: &StoredConnection,
) -> Result<reqwest::RequestBuilder, String> {
    match &config.credential {
        Some(id) => {
            let secret = credential(id)?
                .get_password()
                .map_err(|_| "无法读取 API 密钥，请重新配置连接")?;
            Ok(request.bearer_auth(secret))
        }
        None => Ok(request),
    }
}

fn valid_model_id(model: &str) -> bool {
    !model.is_empty()
        && model.trim() == model
        && model.encode_utf16().count() <= 200
        && !model.chars().any(char::is_control)
}

fn parse_models(value: Value) -> Result<Vec<String>, String> {
    let entries = value
        .get("data")
        .and_then(Value::as_array)
        .ok_or("模型列表格式无效")?;
    if entries.len() > 1000 {
        return Err("模型列表超过 1000 项".into());
    }
    let mut models = std::collections::BTreeSet::new();
    for entry in entries {
        let id = entry
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| valid_model_id(id))
            .ok_or("模型列表包含无效 ID")?;
        models.insert(id.to_owned());
    }
    Ok(models.into_iter().collect())
}

#[tauri::command]
pub async fn assistant_models(
    app: tauri::AppHandle,
    window: WebviewWindow,
    state: State<'_, AssistantState>,
    connection_id: String,
    request_id: String,
) -> Result<Vec<String>, String> {
    valid_id(&request_id)?;
    let config = load_connection(&app, &connection_id)?;
    if config.config.kind != crate::assistant_cli::Kind::Api {
        crate::assistant_cli::resolve(config.config.kind, &config.config.cli_path)?;
        return Ok(crate::assistant_cli::models(config.config.kind));
    }
    let url = service_endpoint(&config.config.endpoint, "models")?;
    let request = authenticate(http_client(Duration::from_secs(30))?.get(url), &config)?;
    let owner = format!("{}:{request_id}", window.label());
    let mut cancelled = state
        .requests
        .lock()
        .map_err(|_| "助手运行正忙")?
        .start(&owner)?;
    let result = async {
        let mut response = tokio::select! {
            _ = cancelled.changed() => return Err("已取消读取模型列表".into()),
            response = request.send() => response.map_err(|_| "模型列表读取失败或超时，请检查网络与服务地址")?,
        };
        if !response.status().is_success() {
            return Err(match response.status().as_u16() {
                401 | 403 => "API 密钥无效或无权读取模型列表".into(),
                404 | 405 => "服务不支持模型列表".into(),
                429 => "模型服务限流或额度不足，请稍后重试".into(),
                status => format!("模型列表返回 HTTP {status}"),
            });
        }
        let mut bytes = Vec::new();
        loop {
            let chunk = tokio::select! {
                _ = cancelled.changed() => return Err("已取消读取模型列表".into()),
                chunk = response.chunk() => chunk.map_err(|_| "模型列表响应中断或超时")?,
            };
            let Some(chunk) = chunk else { break; };
            if bytes.len() + chunk.len() > 1_000_000 { return Err("模型列表响应超过大小限制".into()); }
            bytes.extend_from_slice(&chunk);
        }
        let value = serde_json::from_slice(&bytes).map_err(|_| "模型列表不是有效 JSON")?;
        parse_models(value)
    }.await;
    state
        .requests
        .lock()
        .map_err(|_| "助手运行正忙")?
        .active
        .remove(&owner);
    result
}

#[tauri::command]
pub fn assistant_protocol_version() -> u32 {
    6
}

#[tauri::command]
pub fn assistant_connections(app: tauri::AppHandle) -> Result<Vec<Connection>, String> {
    let _guard = CONNECTION_LOCK.lock().map_err(|_| "模型连接正忙")?;
    Ok(read_connections(&assistant_dir(&app)?)?
        .into_iter()
        .map(|stored| Connection {
            has_key: stored.credential.is_some(),
            ..stored.config
        })
        .collect())
}

#[tauri::command]
pub fn assistant_connection_save(
    app: tauri::AppHandle,
    connection: Connection,
    key: Option<String>,
) -> Result<(), String> {
    validate_connection(&connection)?;
    let _guard = CONNECTION_LOCK.lock().map_err(|_| "模型连接正忙")?;
    let directory = assistant_dir(&app)?;
    let mut connections = read_connections(&directory)?;
    let old = connections
        .iter()
        .find(|item| item.config.id == connection.id)
        .cloned();
    if old.is_none() && connections.len() >= 20 {
        return Err("最多保存 20 个模型连接".into());
    }
    if connection.kind != crate::assistant_cli::Kind::Api {
        crate::assistant_cli::resolve(connection.kind, &connection.cli_path)?;
        connections.retain(|item| item.config.id != connection.id);
        connections.push(StoredConnection {
            config: connection,
            credential: None,
        });
        atomic_json(&directory.join("connections.json"), &connections)?;
        if let Some(id) = old.and_then(|old| old.credential) {
            let _ = credential(&id)?.delete_credential();
        }
        return Ok(());
    }
    let supplied = key.filter(|value| !value.is_empty());
    if let Some(previous) = &old {
        if previous.credential.is_some()
            && supplied.is_none()
            && previous.config.kind == crate::assistant_cli::Kind::Api
            && endpoint(&previous.config.endpoint)?.origin()
                != endpoint(&connection.endpoint)?.origin()
        {
            return Err("模型服务主机已变化，请重新填写 API 密钥或新增无密钥的本机连接".into());
        }
    }
    if supplied
        .as_ref()
        .is_some_and(|value| value.len() > 2000 || value.contains(['\r', '\n']))
    {
        return Err("API 密钥格式无效".into());
    }
    if supplied.is_none()
        && old.as_ref().is_some_and(|old| {
            old.config.kind == crate::assistant_cli::Kind::Api
                && old.config.endpoint != connection.endpoint
        })
    {
        return Err("更换服务地址时请重新填写 API 密钥".into());
    }
    let new_id = supplied.as_ref().map(|_| uuid::Uuid::new_v4().to_string());
    let credential_id = new_id
        .clone()
        .or_else(|| old.as_ref().and_then(|old| old.credential.clone()));
    let remote = reqwest::Url::parse(&connection.endpoint)
        .map_err(|_| "模型地址无效")?
        .scheme()
        == "https";
    if remote && credential_id.is_none() {
        return Err("请填写 API 密钥".into());
    }
    if let (Some(id), Some(secret)) = (&new_id, &supplied) {
        credential(id)?
            .set_password(secret)
            .map_err(|_| "无法将 API 密钥存入系统凭据库")?;
    }
    connections.retain(|item| item.config.id != connection.id);
    connections.push(StoredConnection {
        config: connection,
        credential: credential_id.clone(),
    });
    if let Err(error) = atomic_json(&directory.join("connections.json"), &connections) {
        if let Some(id) = new_id {
            let _ = credential(&id)?.delete_credential();
        }
        return Err(error);
    }
    if let Some(id) = old
        .and_then(|old| old.credential)
        .filter(|id| Some(id) != credential_id.as_ref())
    {
        let _ = credential(&id)?.delete_credential();
    }
    Ok(())
}

#[tauri::command]
pub fn assistant_connection_remove(app: tauri::AppHandle, id: String) -> Result<(), String> {
    valid_id(&id)?;
    let _guard = CONNECTION_LOCK.lock().map_err(|_| "模型连接正忙")?;
    let directory = assistant_dir(&app)?;
    let mut connections = read_connections(&directory)?;
    let removed = connections
        .iter()
        .find(|item| item.config.id == id)
        .and_then(|item| item.credential.clone());
    connections.retain(|item| item.config.id != id);
    atomic_json(&directory.join("connections.json"), &connections)?;
    if let Some(id) = removed {
        let _ = credential(&id)?.delete_credential();
    }
    Ok(())
}

fn request_body(config: &Connection, request: Value) -> Result<Value, String> {
    if serde_json::to_vec(&request)
        .map_err(|_| "模型请求无效")?
        .len()
        > 1_000_000
    {
        return Err("模型请求超过大小限制".into());
    }
    let messages = request
        .get("messages")
        .and_then(Value::as_array)
        .ok_or("模型消息无效")?;
    if messages.is_empty() || messages.len() > 350 {
        return Err("模型消息数量无效".into());
    }
    let model = request
        .get("model")
        .and_then(Value::as_str)
        .filter(|model| valid_model_id(model))
        .ok_or("请为当前对话选择有效模型")?;
    let mut body = match config.protocol {
        Protocol::ChatCompletions => {
            let mut messages = messages.clone();
            for message in &mut messages {
                if let Some(message) = message.as_object_mut() {
                    message.remove("responseItems");
                }
            }
            json!({ "model": model, "messages": messages, "stream": true,
                "stream_options": { "include_usage": true }, "max_completion_tokens": config.max_output_tokens })
        }
        Protocol::Responses => {
            let mut instructions = Vec::new();
            let mut input = Vec::new();
            for message in messages {
                let role = message
                    .get("role")
                    .and_then(Value::as_str)
                    .ok_or("模型消息角色无效")?;
                let content = message.get("content").and_then(Value::as_str);
                match role {
                    "system" => instructions.push(content.ok_or("模型指令无效")?),
                    "tool" => input.push(json!({"type": "function_call_output", "call_id": message.get("tool_call_id").and_then(Value::as_str).ok_or("工具回执标识无效")?, "output": content.ok_or("工具回执无效")?})),
                    "assistant" if message.get("responseItems").is_some() => {
                        let items = message["responseItems"].as_array().ok_or("模型续轮数据无效")?;
                        if items.iter().any(|item| !matches!(item.get("type").and_then(Value::as_str), Some("reasoning" | "message" | "function_call"))) {
                            return Err("模型续轮类型不受支持".into());
                        }
                        input.extend(items.clone());
                    }
                    "user" | "assistant" => {
                        if let Some(content) = content {
                            input.push(json!({"role": role, "content": content}));
                        }
                        if role == "assistant" {
                            if let Some(calls) = message.get("tool_calls") {
                                for call in calls.as_array().ok_or("模型工具调用无效")? {
                                    input.push(json!({"type": "function_call", "call_id": call.get("id").and_then(Value::as_str).ok_or("模型工具标识无效")?, "name": call.pointer("/function/name").and_then(Value::as_str).ok_or("模型工具名称无效")?, "arguments": call.pointer("/function/arguments").and_then(Value::as_str).ok_or("模型工具参数无效")?}));
                                }
                            }
                        }
                    }
                    _ => return Err("模型消息角色无效".into()),
                }
            }
            json!({"model": model, "instructions": instructions.join("\n\n"), "input": input,
                "stream": true, "store": false, "include": ["reasoning.encrypted_content"],
                "max_output_tokens": config.max_output_tokens})
        }
    };
    if let Some(tools) = request.get("tools") {
        let tools = tools.as_array().ok_or("模型工具无效")?;
        if !config.tools
            || tools.len() > 12
            || tools.iter().any(|tool| {
                !matches!(
                    tool.pointer("/function/name").and_then(Value::as_str),
                    Some(
                        "propose_edit"
                            | "propose_create"
                            | "search_documents"
                            | "read_document"
                            | "read_workspace_objects"
                            | "read_reference_context"
                            | "propose_event"
                            | "propose_relation"
                            | "propose_task_update"
                            | "propose_assignment"
                            | "propose_relation_change"
                            | "query_tasks"
                    )
                )
            })
        {
            return Err("模型工具未授权".into());
        }
        body["tools"] = Value::Array(match config.protocol {
            Protocol::ChatCompletions => tools.clone(),
            Protocol::Responses => tools
                .iter()
                .map(|tool| {
                    json!({"type": "function",
                "name": tool["function"]["name"], "description": tool["function"]["description"],
                "parameters": tool["function"]["parameters"], "strict": false})
                })
                .collect(),
        });
    }
    Ok(body)
}

fn provider_error(status: u16, bytes: &[u8]) -> String {
    let value: Value = serde_json::from_slice(bytes).unwrap_or(Value::Null);
    let code = value.pointer("/error/code").and_then(Value::as_str);
    let codex_only = status == 403
        && value
            .pointer("/error/message")
            .and_then(Value::as_str)
            .is_some_and(|message| {
                message.contains("标准 Codex 客户端") || message.contains("standard Codex client")
            });
    if codex_only {
        return format!("模型服务返回 HTTP {status}；服务要求通过标准 Codex 客户端使用此模型，请在对话中改选允许第三方应用使用的模型，或联系供应商调整权限");
    }
    let detail = match code {
        Some("protocol_not_supported") => {
            "当前模型不支持所选接口协议，请在模型连接中切换 Responses 或 Chat Completions"
        }
        Some("model_not_found" | "invalid_model") => {
            "当前模型不存在或没有访问权限，请在对话中重新选择模型"
        }
        Some("context_length_exceeded") => "对话超过模型上下文上限，请减少参考内容或新建会话",
        Some("insufficient_quota") => "模型服务额度不足，请检查服务账户",
        _ => match status {
            401 | 403 => "API 密钥无效或没有模型权限",
            429 => "模型服务限流或额度不足，请稍后重试",
            _ => "请核对接口协议、当前对话模型与服务地址",
        },
    };
    format!("模型服务返回 HTTP {status}；{detail}")
}

async fn read_provider_error(mut response: reqwest::Response) -> String {
    let status = response.status().as_u16();
    let mut bytes = Vec::new();
    while let Ok(Some(chunk)) = response.chunk().await {
        if bytes.len() + chunk.len() > 32_768 {
            return provider_error(status, &[]);
        }
        bytes.extend_from_slice(&chunk);
    }
    provider_error(status, &bytes)
}

#[tauri::command]
pub async fn assistant_request(
    app: tauri::AppHandle,
    window: WebviewWindow,
    state: State<'_, AssistantState>,
    connection_id: String,
    request_id: String,
    request: Value,
    on_chunk: Channel<Vec<u8>>,
) -> Result<(), String> {
    valid_id(&request_id)?;
    let config = load_connection(&app, &connection_id)?;
    if config.config.kind != crate::assistant_cli::Kind::Api {
        let mut validation = config.config.clone();
        validation.protocol = Protocol::ChatCompletions;
        let body = request_body(&validation, request)?;
        let owner = format!("{}:{request_id}", window.label());
        let cancelled = state
            .requests
            .lock()
            .map_err(|_| "助手运行正忙")?
            .start(&owner)?;
        let result = crate::assistant_cli::run(
            config.config.kind,
            &config.config.cli_path,
            &assistant_dir(&app)?,
            body,
            cancelled,
            &on_chunk,
        )
        .await;
        state
            .requests
            .lock()
            .map_err(|_| "助手运行正忙")?
            .active
            .remove(&owner);
        result?;
        return on_chunk
            .send(Vec::new())
            .map_err(|_| "助手界面已关闭".into());
    }
    let url = generation_endpoint(&config.config)?;
    let body = request_body(&config.config, request)?;
    let client = http_client(Duration::from_secs(180))?;
    let request = authenticate(client.post(url).json(&body), &config)?;
    let owner = format!("{}:{request_id}", window.label());
    let mut cancelled = state
        .requests
        .lock()
        .map_err(|_| "助手运行正忙")?
        .start(&owner)?;
    let result = async {
        let mut response = tokio::select! {
            _ = cancelled.changed() => return Err("已停止生成".into()),
            response = request.send() => response.map_err(|_| "模型连接失败或超时，请检查网络与服务地址")?,
        };
        if !response.status().is_success() {
            return Err(tokio::select! {
                _ = cancelled.changed() => "已停止生成".into(),
                error = read_provider_error(response) => error,
            });
        }
        let mut size = 0;
        loop {
            let chunk = tokio::select! {
                _ = cancelled.changed() => return Err("已停止生成".into()),
                chunk = response.chunk() => chunk.map_err(|_| "模型响应中断或超时")?,
            };
            let Some(chunk) = chunk else { break; };
            size += chunk.len();
            if size > 4_000_000 { return Err("模型响应超过大小限制".into()); }
            if !chunk.is_empty() {
                on_chunk.send(chunk.to_vec()).map_err(|_| "助手界面已关闭")?;
            }
        }
        Ok(())
    }.await;
    state
        .requests
        .lock()
        .map_err(|_| "助手运行正忙")?
        .active
        .remove(&owner);
    result?;
    // Ordered channel completion is separate from the command's IPC response.
    on_chunk
        .send(Vec::new())
        .map_err(|_| "助手界面已关闭".into())
}

#[tauri::command]
pub fn assistant_cancel(
    window: WebviewWindow,
    state: State<AssistantState>,
    request_id: String,
) -> Result<(), String> {
    valid_id(&request_id)?;
    let owner = format!("{}:{request_id}", window.label());
    state
        .requests
        .lock()
        .map_err(|_| "助手运行正忙")?
        .stop(owner)
}

fn session_directory(
    app: &tauri::AppHandle,
    workspace_id: &str,
    state: State<crate::AppState>,
) -> Result<PathBuf, String> {
    crate::with_workspace_session(workspace_id, state, |session| {
        let location = format!(
            "{}:{}:{}",
            session.id,
            session.root.to_string_lossy(),
            session.root_key
        );
        Ok(assistant_dir(app)?
            .join("sessions")
            .join(crate::storage::hash(location.as_bytes())))
    })
}

fn validate_session(session: &Value, workspace_id: &str) -> Result<String, String> {
    let id = session
        .get("id")
        .and_then(Value::as_str)
        .ok_or("助手会话标识无效")?;
    valid_id(id)?;
    if session.get("version").and_then(Value::as_u64) != Some(1)
        || session.get("workspaceId").and_then(Value::as_str) != Some(workspace_id)
        || session
            .get("messages")
            .and_then(Value::as_array)
            .is_none_or(|messages| messages.len() > 300)
        || serde_json::to_vec(session)
            .map_err(|_| "助手会话无效")?
            .len()
            > 8_000_000
    {
        return Err("助手会话身份或大小无效".into());
    }
    Ok(id.to_string())
}

fn external_root_key(key: &str) -> Result<String, String> {
    let parts: Vec<_> = key.split(':').collect();
    if parts.len() == 3 {
        let high = parts[1].parse::<u32>().map_err(|_| "工作区本机身份无效")?;
        let low = parts[2].parse::<u32>().map_err(|_| "工作区本机身份无效")?;
        Ok(format!(
            "{}:{}",
            parts[0],
            (u64::from(high) << 32) | u64::from(low)
        ))
    } else if parts.len() == 2 {
        Ok(key.to_owned())
    } else {
        Err("工作区本机身份不可用".into())
    }
}

#[tauri::command]
pub fn assistant_external_sessions(
    app: tauri::AppHandle,
    state: State<crate::AppState>,
    workspace_id: String,
) -> Result<Vec<Value>, String> {
    crate::with_workspace_session(&workspace_id, state, |session| {
        let path = crate::app_data(&app)?
            .join("agents")
            .join(format!("{workspace_id}.sqlite"));
        if !path.exists() {
            return Ok(Vec::new());
        }
        let db =
            rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|_| "无法读取外部提案")?;
        let exists: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_proposals')", [], |row| row.get(0)).map_err(|_| "无法读取外部提案")?;
        if !exists {
            return Ok(Vec::new());
        }
        let root = session
            .root
            .to_string_lossy()
            .trim_start_matches("\\\\?\\")
            .to_string();
        let mut statement = db.prepare("SELECT body FROM agent_proposals WHERE root=?1 COLLATE NOCASE AND root_key=?2 AND status='ready' ORDER BY rowid DESC LIMIT 200").map_err(|_| "无法读取外部提案")?;
        let rows = statement
            .query_map(
                rusqlite::params![root, external_root_key(&session.root_key)?],
                |row| row.get::<_, String>(0),
            )
            .map_err(|_| "无法读取外部提案")?;
        let mut values = Vec::new();
        for row in rows {
            let body = row.map_err(|_| "无法读取外部提案")?;
            if body.len() > 2_000_000 {
                return Err("外部提案超过大小限制".into());
            }
            let value: Value =
                serde_json::from_str(&body).map_err(|_| "外部提案格式损坏，原记录已保留")?;
            validate_session(&value, &workspace_id)?;
            values.push(value);
        }
        Ok(values)
    })
}

#[tauri::command]
pub fn assistant_external_result(
    app: tauri::AppHandle,
    state: State<crate::AppState>,
    workspace_id: String,
    id: String,
    expected_revision: u64,
) -> Result<(), String> {
    valid_id(&id)?;
    let _guard = SESSION_LOCK.lock().map_err(|_| "助手会话正忙")?;
    let directory = session_directory(&app, &workspace_id, state.clone())?;
    let value: Value = serde_json::from_slice(
        &std::fs::read(directory.join(format!("{id}.json"))).map_err(|_| "请先保存助手提案结果")?,
    )
    .map_err(|_| "助手结果记录损坏")?;
    if value.get("revision").and_then(Value::as_u64) != Some(expected_revision)
        || value.get("external").and_then(Value::as_bool) != Some(true)
    {
        return Err("助手结果记录已变化".into());
    }
    let proposal = value
        .pointer("/messages/0/proposals/0")
        .ok_or("助手提案结果缺失")?;
    if proposal.get("id").and_then(Value::as_str) != Some(id.as_str()) {
        return Err("外部提案身份无效".into());
    }
    let status = proposal
        .get("status")
        .and_then(Value::as_str)
        .ok_or("提案状态无效")?;
    if !matches!(
        status,
        "applied" | "rejected" | "unknown" | "ready" | "conflicted"
    ) {
        return Err("提案尚未处理完成".into());
    }
    crate::with_workspace_session(&workspace_id, state, |session| {
        let db = rusqlite::Connection::open(
            crate::app_data(&app)?
                .join("agents")
                .join(format!("{workspace_id}.sqlite")),
        )
        .map_err(|_| "无法记录外部提案结果")?;
        db.busy_timeout(Duration::from_secs(3))
            .map_err(|_| "外部提案记录正忙")?;
        let root = session
            .root
            .to_string_lossy()
            .trim_start_matches("\\\\?\\")
            .to_string();
        let changed = db.execute("UPDATE agent_proposals SET status=?1 WHERE id=?2 AND root=?3 COLLATE NOCASE AND root_key=?4", rusqlite::params![status, id, root, external_root_key(&session.root_key)?]).map_err(|_| "无法记录外部提案结果")?;
        if changed != 1 {
            return Err("外部提案已移除或工作区本机身份已变化".into());
        }
        Ok(())
    })
}

#[tauri::command]
pub fn assistant_sessions_load(
    app: tauri::AppHandle,
    state: State<crate::AppState>,
    workspace_id: String,
) -> Result<Vec<Value>, String> {
    let _guard = SESSION_LOCK.lock().map_err(|_| "助手会话正忙")?;
    let directory = session_directory(&app, &workspace_id, state)?;
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut sessions = Vec::new();
    for entry in std::fs::read_dir(directory).map_err(|_| "无法读取助手会话")? {
        let entry = entry.map_err(|_| "无法读取助手会话")?;
        if entry.path().extension().is_none_or(|ext| ext != "json") {
            continue;
        }
        if entry
            .file_type()
            .map_err(|_| "无法读取助手会话")?
            .is_symlink()
            || entry.metadata().map_err(|_| "无法读取助手会话")?.len() > 8_000_000
        {
            return Err("助手会话文件无效，原记录已保留".into());
        }
        let value: Value =
            serde_json::from_slice(&std::fs::read(entry.path()).map_err(|_| "无法读取助手会话")?)
                .map_err(|_| "助手会话记录损坏，原记录已保留")?;
        validate_session(&value, &workspace_id)?;
        sessions.push(value);
        if sessions.len() > 200 {
            return Err("助手会话超过 200 条，请清理旧会话".into());
        }
    }
    Ok(sessions)
}

#[tauri::command]
pub fn assistant_session_save(
    app: tauri::AppHandle,
    state: State<crate::AppState>,
    mut session: Value,
) -> Result<u64, String> {
    let _guard = SESSION_LOCK.lock().map_err(|_| "助手会话正忙")?;
    let workspace_id = session
        .get("workspaceId")
        .and_then(Value::as_str)
        .ok_or("工作区身份无效")?
        .to_string();
    let id = validate_session(&session, &workspace_id)?;
    let directory = session_directory(&app, &workspace_id, state)?;
    let path = directory.join(format!("{id}.json"));
    let expected = session
        .get("revision")
        .and_then(Value::as_u64)
        .ok_or("助手会话版本无效")?;
    let current = if path.exists() {
        let old: Value =
            serde_json::from_slice(&std::fs::read(&path).map_err(|_| "无法读取助手会话")?)
                .map_err(|_| "助手会话记录损坏，原记录已保留")?;
        if validate_session(&old, &workspace_id)? != id {
            return Err("助手会话身份损坏，原记录已保留".into());
        }
        old.get("revision")
            .and_then(Value::as_u64)
            .ok_or("助手会话版本损坏")?
    } else {
        if directory.exists()
            && std::fs::read_dir(&directory)
                .map_err(|_| "无法读取助手会话")?
                .filter_map(Result::ok)
                .filter(|entry| {
                    entry
                        .path()
                        .extension()
                        .is_some_and(|extension| extension == "json")
                })
                .count()
                >= 200
        {
            return Err("助手会话已达到 200 条，请先删除旧会话".into());
        }
        0
    };
    if expected != current {
        return Err("助手会话已在其他窗口更新，请重新打开；当前记录已保留".into());
    }
    session["revision"] = json!(current + 1);
    atomic_json(&path, &session)?;
    Ok(current + 1)
}

#[tauri::command]
pub fn assistant_session_delete(
    app: tauri::AppHandle,
    state: State<crate::AppState>,
    workspace_id: String,
    id: String,
    expected_revision: u64,
) -> Result<(), String> {
    valid_id(&id)?;
    let _guard = SESSION_LOCK.lock().map_err(|_| "助手会话正忙")?;
    let path = session_directory(&app, &workspace_id, state)?.join(format!("{id}.json"));
    if path.exists() {
        let value: Value =
            serde_json::from_slice(&std::fs::read(&path).map_err(|_| "无法读取助手会话")?)
                .map_err(|_| "助手会话记录损坏，原记录已保留")?;
        if validate_session(&value, &workspace_id)? != id {
            return Err("助手会话身份损坏，原记录已保留".into());
        }
        if value.get("revision").and_then(Value::as_u64) != Some(expected_revision) {
            return Err("助手会话已在其他窗口更新，请重新打开后删除".into());
        }
        std::fs::remove_file(path).map_err(|_| "无法删除助手会话")?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    #[ignore = "opt-in authenticated provider diagnostic; sends only a synthetic prompt"]
    async fn configured_provider_diagnostic() {
        let directory = std::env::var("TANO_ASSISTANT_DIAGNOSTIC_DATA")
            .expect("explicit assistant data directory required");
        let connection_id = std::env::var("TANO_ASSISTANT_DIAGNOSTIC_CONNECTION")
            .expect("explicit connection ID required");
        let model =
            std::env::var("TANO_ASSISTANT_DIAGNOSTIC_MODEL").expect("explicit model required");
        let config = read_connections(Path::new(&directory))
            .unwrap()
            .into_iter()
            .find(|entry| entry.config.id == connection_id)
            .expect("selected connection not found");
        let body = request_body(&config.config, json!({"model": model, "messages": [{"role": "user", "content": "Reply only OK. This is a connection diagnostic."}]})).unwrap();
        let response = authenticate(
            http_client(Duration::from_secs(30))
                .unwrap()
                .post(generation_endpoint(&config.config).unwrap())
                .json(&body),
            &config,
        )
        .unwrap()
        .send()
        .await
        .expect("provider request failed");
        println!("Provider diagnostic HTTP {}", response.status().as_u16());
        if response.status().is_success() {
            return;
        }
        let bytes = response.bytes().await.unwrap();
        assert!(bytes.len() <= 32_768, "diagnostic error body too large");
        let value: Value = serde_json::from_slice(&bytes).expect("provider error is not JSON");
        let secret = config
            .credential
            .as_ref()
            .map(|id| credential(id).unwrap().get_password().unwrap())
            .unwrap_or_default();
        for field in ["type", "code", "param", "message"] {
            if let Some(text) = value
                .pointer(&format!("/error/{field}"))
                .and_then(Value::as_str)
            {
                let text = if secret.is_empty() {
                    text.to_owned()
                } else {
                    text.replace(&secret, "[redacted]")
                };
                println!(
                    "{field}: {}",
                    text.chars()
                        .filter(|character| !character.is_control())
                        .take(400)
                        .collect::<String>()
                );
            }
        }
    }
    #[test]
    fn external_root_keys_match_node_file_identity() {
        assert_eq!(external_root_key("100:1:5").unwrap(), "100:4294967301");
        assert_eq!(external_root_key("100:1000").unwrap(), "100:1000");
        assert!(external_root_key("").is_err());
    }
    #[test]
    fn cancellation_before_registration_and_between_windows() {
        let mut requests = Requests::default();
        requests.stop("main:one".into()).unwrap();
        assert!(requests.start("main:one").is_err());
        let receiver = requests.start("other:one").unwrap();
        assert!(!*receiver.borrow());
        requests.stop("other:one".into()).unwrap();
        assert!(*receiver.borrow());
        assert!(requests.start("other:one").is_err());
        let main = requests.start("main:two").unwrap();
        let other = requests.start("other:two").unwrap();
        requests.stop_window("main");
        assert!(*main.borrow());
        assert!(!*other.borrow());
    }
    #[test]
    fn rejects_leaking_or_insecure_endpoints() {
        for url in [
            "http://example.com/v1",
            "https://user:secret@example.com",
            "https://example.com?key=secret",
            "file:///notes",
            "https://example.com/#token",
        ] {
            assert!(endpoint(url).is_err(), "{url}");
        }
        assert_eq!(
            endpoint("https://example.com/v1/").unwrap().as_str(),
            "https://example.com/v1/chat/completions"
        );
        assert!(endpoint("http://127.0.0.1:1234/v1").is_ok());
    }
    #[test]
    fn builds_only_authorized_requests_and_scopes_session_identity() {
        let connection = Connection {
            id: uuid::Uuid::new_v4().to_string(),
            name: "test".into(),
            kind: crate::assistant_cli::Kind::Api,
            cli_path: String::new(),
            endpoint: "https://example.com/v1".into(),
            protocol: Protocol::ChatCompletions,
            _legacy_model: Some("old-default".into()),
            tools: false,
            max_output_tokens: 2048,
            has_key: false,
        };
        assert!(request_body(&connection, json!({"model": "test", "messages": [{"role": "user", "content": "hello"}], "tools": [{"function": {"name": "execute_shell"}}]})).is_err());
        assert!(request_body(
            &connection,
            json!({"messages": [{"role": "user", "content": "hello"}]})
        )
        .is_err());
        let body = request_body(
            &connection,
            json!({"model": "test", "messages": [{"role": "user", "content": "hello"}]}),
        )
        .unwrap();
        assert_eq!(body["model"], "test");
        let session = json!({"version": 1, "id": uuid::Uuid::new_v4().to_string(), "workspaceId": "one", "messages": []});
        assert!(validate_session(&session, "two").is_err());
        assert!(validate_session(&session, "one").is_ok());
        let reference_request = json!({"model": "test", "messages": [{"role": "user", "content": "context"}],
            "tools": [{"type": "function", "function": {"name": "read_reference_context", "parameters": {"type": "object"}}}]});
        assert!(request_body(&connection, reference_request.clone()).is_err());
        let mut enabled = connection;
        enabled.tools = true;
        for protocol in [Protocol::ChatCompletions, Protocol::Responses] {
            enabled.protocol = protocol;
            let body = request_body(&enabled, reference_request.clone()).unwrap();
            let name = if matches!(enabled.protocol, Protocol::Responses) {
                &body["tools"][0]["name"]
            } else {
                &body["tools"][0]["function"]["name"]
            };
            assert_eq!(name, "read_reference_context");
        }
    }
    #[test]
    fn atomic_data_replacement_and_corrupt_connections_are_preserved() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("connections.json");
        atomic_json(&path, &Vec::<StoredConnection>::new()).unwrap();
        assert!(read_connections(temp.path()).unwrap().is_empty());
        let stored = StoredConnection {
            config: Connection {
                id: uuid::Uuid::new_v4().to_string(),
                name: "fixture".into(),
                kind: crate::assistant_cli::Kind::Api,
                cli_path: String::new(),
                endpoint: "http://127.0.0.1:1441/v1".into(),
                protocol: Protocol::ChatCompletions,
                _legacy_model: None,
                tools: true,
                max_output_tokens: 4096,
                has_key: false,
            },
            credential: None,
        };
        atomic_json(&path, &vec![stored.clone()]).unwrap();
        let loaded = read_connections(temp.path()).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].config.id, stored.config.id);
        assert!(!loaded[0].config.has_key);
        std::fs::write(&path, b"corrupt").unwrap();
        assert!(read_connections(temp.path()).is_err());
        assert_eq!(std::fs::read(path).unwrap(), b"corrupt");
    }
    #[test]
    fn legacy_models_are_read_but_not_saved_as_connection_settings() {
        let value = json!({"id": uuid::Uuid::new_v4().to_string(), "name": "legacy", "endpoint": "https://example.com/v1", "model": "legacy-model", "tools": true, "maxOutputTokens": 2048});
        let connection: Connection = serde_json::from_value(value).unwrap();
        validate_connection(&connection).unwrap();
        assert_eq!(connection._legacy_model.as_deref(), Some("legacy-model"));
        let serialized = serde_json::to_value(connection).unwrap();
        assert!(serialized.get("model").is_none());
        let restored: Connection = serde_json::from_value(serialized).unwrap();
        assert!(restored._legacy_model.is_none());
        assert!(matches!(restored.protocol, Protocol::ChatCompletions));
    }
    #[test]
    fn authorizes_task_follow_up_tools_for_both_api_protocols() {
        let names = [
            "propose_edit",
            "propose_create",
            "search_documents",
            "read_document",
            "read_workspace_objects",
            "read_reference_context",
            "propose_event",
            "propose_relation",
            "propose_task_update",
            "propose_assignment",
            "propose_relation_change",
            "query_tasks",
        ];
        for protocol in ["responses", "chat-completions"] {
            let config: Connection =
                serde_json::from_value(json!({"id": uuid::Uuid::new_v4().to_string(),
                "name": "test", "endpoint": "https://example.com/v1", "protocol": protocol,
                "tools": true, "maxOutputTokens": 2048}))
                .unwrap();
            let tools: Vec<Value> = names
                .iter()
                .map(|name| {
                    json!({"type": "function", "function": {
                "name": name, "description": "review", "parameters": {"type": "object"}}})
                })
                .collect();
            let request = json!({"model": "test", "messages": [{"role": "user", "content": "follow up"}], "tools": tools});
            assert_eq!(
                request_body(&config, request.clone()).unwrap()["tools"]
                    .as_array()
                    .unwrap()
                    .len(),
                12
            );
            let mut forbidden = request;
            forbidden["tools"][10]["function"]["name"] = json!("execute_shell");
            assert!(request_body(&config, forbidden).is_err());
        }
        assert_eq!(assistant_protocol_version(), 6);
    }
    #[test]
    fn responses_requests_preserve_reasoning_and_use_flat_tools() {
        let config: Connection = serde_json::from_value(json!({"id": uuid::Uuid::new_v4().to_string(), "name": "test", "endpoint": "https://example.com/v1", "protocol": "responses", "tools": true, "maxOutputTokens": 2048})).unwrap();
        let items = json!([
            {"type": "reasoning", "encrypted_content": "opaque", "summary": []},
            {"type": "function_call", "call_id": "call_one", "name": "propose_create", "arguments": "{}"}
        ]);
        let body = request_body(&config, json!({"model": "chosen-model", "messages": [
            {"role": "system", "content": "first"}, {"role": "system", "content": "second"},
            {"role": "user", "content": "hello"},
            {"role": "assistant", "content": null, "responseItems": items},
            {"role": "tool", "tool_call_id": "call_one", "content": "{\"written\":false}"}
        ], "tools": [{"type": "function", "function": {"name": "propose_create", "description": "propose", "parameters": {"type": "object"}}}]})).unwrap();
        assert_eq!(
            generation_endpoint(&config).unwrap().as_str(),
            "https://example.com/v1/responses"
        );
        assert_eq!(body["model"], "chosen-model");
        assert_eq!(body["instructions"], "first\n\nsecond");
        assert_eq!(body["input"][1], items[0]);
        assert_eq!(body["input"][2], items[1]);
        assert_eq!(body["input"][3]["type"], "function_call_output");
        assert_eq!(body["input"][3]["call_id"], "call_one");
        assert_eq!(body["tools"][0]["name"], "propose_create");
        assert_eq!(body["tools"][0]["strict"], false);
        assert_eq!(body["store"], false);
        assert_eq!(body["include"], json!(["reasoning.encrypted_content"]));
        assert_eq!(body["max_output_tokens"], 2048);
        assert!(body.get("messages").is_none());
        assert!(body.get("max_completion_tokens").is_none());
        assert!(request_body(&config, json!({"model": "test", "messages": [{"role": "assistant", "responseItems": [{"type": "computer_call"}]}]})).is_err());
    }
    #[test]
    fn provider_errors_explain_known_causes_without_echoing_untrusted_text() {
        let bytes =
            br#"{"error":{"code":"protocol_not_supported","message":"secret and untrusted text"}}"#;
        let error = provider_error(400, bytes);
        assert!(error.contains("切换 Responses"));
        assert!(!error.contains("secret"));
        assert!(provider_error(400, b"<html>secret</html>").contains("HTTP 400"));
        assert!(!provider_error(400, b"<html>secret</html>").contains("secret"));
        assert!(provider_error(401, b"{}").contains("API 密钥"));
        assert!(provider_error(
            403,
            br#"{"error":{"code":"api_error","message":"Please use the standard Codex client"}}"#
        )
        .contains("标准 Codex 客户端"));
    }
    #[test]
    fn lists_unique_valid_models_and_builds_safe_discovery_endpoints() {
        assert_eq!(
            parse_models(json!({"data": [{"id": "b"}, {"id": "a"}, {"id": "b"}]})).unwrap(),
            vec!["a", "b"]
        );
        assert!(parse_models(json!({"data": []})).unwrap().is_empty());
        for value in [
            json!({}),
            json!({"data": ["a"]}),
            json!({"data": [{"id": ""}]}),
            json!({"data": [{"id": "a\nb"}]}),
        ] {
            assert!(parse_models(value).is_err());
        }
        assert!(parse_models(json!({"data": vec![json!({"id": "a"}); 1001]})).is_err());
        assert!(!valid_model_id(&"a".repeat(201)));
        assert!(!valid_model_id(" spaced "));
        assert_eq!(
            service_endpoint("https://example.com/v1/", "models")
                .unwrap()
                .as_str(),
            "https://example.com/v1/models"
        );
        assert!(service_endpoint("http://example.com/v1", "models").is_err());
    }
}
