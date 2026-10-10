//! Bounded compatibility negotiation before any model output is delivered.
//! Never changes the model, host, credentials, tools, or storage policy.
use super::{
    authenticate, generation_endpoint, request_body, Connection, Protocol, StoredConnection,
};
use serde_json::Value;
use tokio::sync::watch;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Profile {
    protocol: Protocol,
    legacy_max_tokens: bool,
    omit_usage: bool,
}

fn continuation_protocol(request: &Value) -> Option<Protocol> {
    let messages = request.get("messages")?.as_array()?;
    if messages
        .iter()
        .any(|message| message.get("responseItems").is_some())
    {
        Some(Protocol::Responses)
    } else if messages.iter().any(|message| {
        message.get("role").and_then(Value::as_str) == Some("tool")
            || message.get("tool_calls").is_some()
    }) {
        Some(Protocol::ChatCompletions)
    } else {
        None
    }
}

impl Profile {
    pub(super) fn for_request(config: &Connection, request: &Value, cached: Option<Self>) -> Self {
        let mut profile = if config.auto_adapt { cached } else { None }.unwrap_or(Self {
            protocol: config.protocol,
            legacy_max_tokens: false,
            omit_usage: false,
        });
        // A tool round must keep the protocol that produced its call IDs and reasoning.
        if let Some(protocol) = continuation_protocol(request) {
            profile.protocol = protocol;
        }
        profile
    }

    fn body(&self, config: &Connection, request: &Value) -> Result<Value, String> {
        let mut config = config.clone();
        config.protocol = self.protocol;
        let mut body = request_body(&config, request.clone())?;
        if self.protocol == Protocol::ChatCompletions {
            let object = body.as_object_mut().ok_or("模型请求无效")?;
            if self.legacy_max_tokens {
                if let Some(limit) = object.remove("max_completion_tokens") {
                    object.insert("max_tokens".into(), limit);
                }
            }
            if self.omit_usage {
                object.remove("stream_options");
            }
        }
        Ok(body)
    }

    fn adapt(&self, error: &ProviderError, request: &Value) -> Option<(Self, &'static str)> {
        if !matches!(error.status, 400 | 404 | 405 | 422) {
            return None;
        }
        if matches!(
            error.code.as_deref(),
            Some(
                "model_not_found"
                    | "invalid_model"
                    | "context_length_exceeded"
                    | "insufficient_quota"
                    | "permission_denied"
            )
        ) {
            return None;
        }
        let mut next = *self;
        if error.protocol_mismatch(self.protocol) && continuation_protocol(request).is_none() {
            next.protocol = match self.protocol {
                Protocol::Responses => Protocol::ChatCompletions,
                Protocol::ChatCompletions => Protocol::Responses,
            };
            return Some((next, "protocol"));
        }
        if self.protocol == Protocol::ChatCompletions && matches!(error.status, 400 | 422) {
            if !self.legacy_max_tokens && error.unsupported_parameter("max_completion_tokens") {
                next.legacy_max_tokens = true;
                return Some((next, "max-tokens"));
            }
            if !self.omit_usage && error.unsupported_parameter("stream_options") {
                next.omit_usage = true;
                return Some((next, "usage"));
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
        time::{Duration, Instant},
    };

    fn connection() -> StoredConnection {
        StoredConnection {
            config: serde_json::from_value(json!({
                "id": "1735eb4e-b089-42e4-b1e2-1d92d4992063", "name": "fixture",
                "endpoint": "http://127.0.0.1:1234/v1", "protocol": "responses",
                "tools": true, "maxOutputTokens": 2048
            }))
            .unwrap(),
            credential: None,
        }
    }

    fn request() -> Value {
        json!({"model": "chosen-model", "messages": [{"role": "user", "content": "question"}],
            "tools": [{"type": "function", "function": {"name": "read_document", "description": "read", "parameters": {"type": "object"}}}]})
    }

    fn error(status: u16, code: &str, param: &str) -> ProviderError {
        ProviderError::parse(
            status,
            &serde_json::to_vec(&json!({"error": {"code": code, "param": param}})).unwrap(),
        )
    }

    #[test]
    fn old_connections_enable_adaptation_and_profiles_are_isolated() {
        let stored = connection();
        assert!(stored.config.auto_adapt);
        let mut other = stored.clone();
        other.config.auto_adapt = false;
        let cached = Profile {
            protocol: Protocol::ChatCompletions,
            legacy_max_tokens: true,
            omit_usage: true,
        };
        let initial = Profile::for_request(&other.config, &request(), Some(cached));
        assert_eq!(initial.protocol, Protocol::Responses);
        assert!(!initial.legacy_max_tokens && !initial.omit_usage);
        assert_eq!(
            Profile::for_request(&stored.config, &request(), Some(cached)),
            cached
        );
        assert_ne!(
            profile_key(&stored, &request()).unwrap(),
            profile_key(&other, &request()).unwrap()
        );
        other = stored.clone();
        other.config.endpoint = "https://example.com/v1".into();
        assert_ne!(
            profile_key(&stored, &request()).unwrap(),
            profile_key(&other, &request()).unwrap()
        );
        other = stored.clone();
        other.credential = Some("new-key-record".into());
        assert_ne!(
            profile_key(&stored, &request()).unwrap(),
            profile_key(&other, &request()).unwrap()
        );
        let mut other_request = request();
        other_request["model"] = json!("another-model");
        assert_ne!(
            profile_key(&stored, &request()).unwrap(),
            profile_key(&stored, &other_request).unwrap()
        );
    }

    #[test]
    fn adapts_only_explicit_compatibility_errors_and_keeps_limits_and_tools() {
        let stored = connection();
        let wire = request();
        let profile = Profile::for_request(&stored.config, &wire, None);
        for status in [401, 403, 429, 500] {
            assert!(profile
                .adapt(&error(status, "protocol_not_supported", ""), &wire)
                .is_none());
        }
        for code in [
            "model_not_found",
            "invalid_model",
            "context_length_exceeded",
            "insufficient_quota",
            "permission_denied",
        ] {
            assert!(profile.adapt(&error(404, code, ""), &wire).is_none());
        }
        assert!(profile
            .adapt(&ProviderError::parse(400, b"{}"), &wire)
            .is_none());
        let (chat, _) = profile
            .adapt(&error(400, "protocol_not_supported", ""), &wire)
            .unwrap();
        assert_eq!(chat.protocol, Protocol::ChatCompletions);
        assert!(chat
            .adapt(&error(400, "invalid_value", "max_completion_tokens"), &wire)
            .is_none());
        let (legacy, _) = chat
            .adapt(
                &error(400, "unsupported_parameter", "max_completion_tokens"),
                &wire,
            )
            .unwrap();
        let (without_usage, _) = legacy
            .adapt(
                &error(422, "unsupported_parameter", "stream_options.include_usage"),
                &wire,
            )
            .unwrap();
        let body = without_usage.body(&stored.config, &wire).unwrap();
        assert_eq!(body["max_tokens"], 2048);
        assert_eq!(body["tools"], wire["tools"]);
        assert_eq!(body["model"], wire["model"]);
        assert_eq!(body["messages"], wire["messages"]);
        assert_eq!(body["stream"], true);
        assert!(body.get("max_completion_tokens").is_none());
        assert!(body.get("stream_options").is_none());
        assert!(without_usage
            .adapt(&error(400, "unsupported_parameter", "tools"), &wire)
            .is_none());
        assert!(without_usage
            .adapt(&error(400, "unsupported_parameter", "max_tokens"), &wire)
            .is_none());
        let message = ProviderError::parse(
            400,
            br#"{"error":{"message":"Unsupported parameter: 'max_completion_tokens'"}}"#,
        );
        assert!(chat.adapt(&message, &wire).is_some());
    }

    #[test]
    fn keeps_tool_continuations_in_their_original_protocol() {
        let stored = connection();
        let items = json!([{ "type": "reasoning", "encrypted_content": "opaque", "summary": [] },
            {"type": "function_call", "call_id": "one", "name": "read_document", "arguments": "{}"}]);
        let wire = json!({"model": "chosen-model", "messages": [
            {"role": "assistant", "content": null, "responseItems": items},
            {"role": "tool", "tool_call_id": "one", "content": "result"}
        ]});
        let chat = Profile {
            protocol: Protocol::ChatCompletions,
            legacy_max_tokens: false,
            omit_usage: false,
        };
        let profile = Profile::for_request(&stored.config, &wire, Some(chat));
        assert_eq!(profile.protocol, Protocol::Responses);
        let body = profile.body(&stored.config, &wire).unwrap();
        assert_eq!(body["input"][0], items[0]);
        assert_eq!(body["input"][1], items[1]);
        assert_eq!(body["store"], false);
        assert_eq!(body["include"], json!(["reasoning.encrypted_content"]));
        assert!(profile
            .adapt(&error(400, "protocol_not_supported", ""), &wire)
            .is_none());
        let chat_wire = json!({"model": "chosen-model", "messages": [
            {"role": "assistant", "content": null, "tool_calls": [{"id": "one", "type": "function", "function": {"name": "read_document", "arguments": "{}"}}]},
            {"role": "tool", "tool_call_id": "one", "content": "result"}
        ]});
        let pinned = Profile::for_request(&stored.config, &chat_wire, Some(profile));
        assert_eq!(pinned.protocol, Protocol::ChatCompletions);
        assert!(pinned
            .adapt(&error(400, "protocol_not_supported", ""), &chat_wire)
            .is_none());
    }

    // A real loopback HTTP fixture exercises request serialization and retry count.
    fn server(
        replies: Vec<(u16, Value)>,
    ) -> (StoredConnection, thread::JoinHandle<Vec<(String, Value)>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let mut stored = connection();
        stored.config.endpoint = format!("http://{}/v1", listener.local_addr().unwrap());
        let handle = thread::spawn(move || {
            let mut requests = Vec::new();
            for (status, body) in replies {
                let deadline = Instant::now() + Duration::from_secs(5);
                let mut socket = loop {
                    match listener.accept() {
                        Ok((socket, _)) => break socket,
                        Err(error)
                            if error.kind() == std::io::ErrorKind::WouldBlock
                                && Instant::now() < deadline =>
                        {
                            thread::sleep(Duration::from_millis(5))
                        }
                        Err(error) => panic!("fixture request did not arrive: {error}"),
                    }
                };
                // Windows can inherit the listener's nonblocking mode. Only
                // accept is polled; request reads must wait for the client.
                socket.set_nonblocking(false).unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut bytes = Vec::new();
                let (header, length) = loop {
                    let mut chunk = [0; 4096];
                    let count = socket.read(&mut chunk).unwrap();
                    assert!(count > 0);
                    bytes.extend_from_slice(&chunk[..count]);
                    if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                        let header = String::from_utf8(bytes[..end].to_vec()).unwrap();
                        let length: usize = header
                            .lines()
                            .find_map(|line| {
                                line.to_lowercase()
                                    .strip_prefix("content-length:")
                                    .map(|value| value.trim().parse().unwrap())
                            })
                            .unwrap();
                        break (header, (end + 4, length));
                    }
                };
                while bytes.len() < length.0 + length.1 {
                    let mut chunk = [0; 4096];
                    let count = socket.read(&mut chunk).unwrap();
                    assert!(count > 0);
                    bytes.extend_from_slice(&chunk[..count]);
                }
                requests.push((
                    header.lines().next().unwrap().to_owned(),
                    serde_json::from_slice(&bytes[length.0..length.0 + length.1]).unwrap(),
                ));
                let body = serde_json::to_vec(&body).unwrap();
                write!(socket, "HTTP/1.1 {status} Fixture\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).unwrap();
                socket.write_all(&body).unwrap();
            }
            requests
        });
        (stored, handle)
    }

    #[tokio::test]
    async fn negotiates_protocol_and_both_chat_parameters_with_at_most_four_requests() {
        let (stored, server) = server(vec![
            (404, json!({})),
            (
                400,
                json!({"error": {"code": "unsupported_parameter", "param": "max_completion_tokens"}}),
            ),
            (
                400,
                json!({"error": {"code": "unsupported_parameter", "param": "stream_options"}}),
            ),
            (200, json!({})),
        ]);
        let wire = request();
        let mut profile = Profile::for_request(&stored.config, &wire, None);
        let (_sender, mut cancelled) = watch::channel(false);
        let mut notices = Vec::new();
        let response = open_stream(
            &super::super::http_client(Duration::from_secs(5)).unwrap(),
            &stored,
            &wire,
            &mut profile,
            &mut cancelled,
            |notice| {
                notices.push(notice);
                Ok(())
            },
        )
        .await
        .unwrap();
        assert_eq!(response.status(), 200);
        let requests = server.join().unwrap();
        assert_eq!(notices, ["protocol", "max-tokens", "usage"]);
        assert_eq!(requests.len(), 4);
        assert!(requests[0].0.contains("/v1/responses"));
        assert!(requests[1..]
            .iter()
            .all(|(path, body)| path.contains("/v1/chat/completions")
                && body["model"] == "chosen-model"
                && body["tools"] == wire["tools"]));
        assert_eq!(requests[0].1["store"], false);
        assert_eq!(requests[3].1["max_tokens"], 2048);
        assert!(requests[3].1.get("stream_options").is_none());
        assert_eq!(
            Profile::for_request(&stored.config, &wire, Some(profile)),
            profile
        );
    }

    #[tokio::test]
    async fn stops_on_client_restrictions_and_manual_mode_without_echoing_provider_text() {
        for (auto_adapt, status, body) in [
            (
                true,
                403,
                json!({"error": {"message": "Please use the STANDARD Codex client; secret"}}),
            ),
            (
                false,
                400,
                json!({"error": {"code": "protocol_not_supported"}}),
            ),
        ] {
            let (mut stored, server) = server(vec![(status, body)]);
            stored.config.auto_adapt = auto_adapt;
            let wire = request();
            let mut profile = Profile::for_request(&stored.config, &wire, None);
            let (_sender, mut cancelled) = watch::channel(false);
            let result = open_stream(
                &super::super::http_client(Duration::from_secs(5)).unwrap(),
                &stored,
                &wire,
                &mut profile,
                &mut cancelled,
                |_| panic!("must not retry"),
            )
            .await;
            let message = result.unwrap_err();
            assert!(!message.contains("secret"));
            if status == 403 {
                assert!(message.contains("Codex CLI"));
            }
            assert_eq!(server.join().unwrap().len(), 1);
        }
    }

    #[tokio::test]
    async fn stops_protocol_oscillation_and_cancellation_before_retry() {
        let failure = json!({"error": {"code": "protocol_not_supported"}});
        let (stored, server) = server(vec![(400, failure.clone()), (400, failure.clone())]);
        let wire = request();
        let mut profile = Profile::for_request(&stored.config, &wire, None);
        let (_sender, mut cancelled) = watch::channel(false);
        let result = open_stream(
            &super::super::http_client(Duration::from_secs(5)).unwrap(),
            &stored,
            &wire,
            &mut profile,
            &mut cancelled,
            |_| Ok(()),
        )
        .await;
        assert!(result.unwrap_err().contains("已尝试自动适配"));
        assert_eq!(server.join().unwrap().len(), 2);
        let (stored, server) = self::server(vec![(400, failure)]);
        let mut profile = Profile::for_request(&stored.config, &wire, None);
        let (sender, mut cancelled) = watch::channel(false);
        let result = open_stream(
            &super::super::http_client(Duration::from_secs(5)).unwrap(),
            &stored,
            &wire,
            &mut profile,
            &mut cancelled,
            |_| {
                sender.send(true).unwrap();
                Ok(())
            },
        )
        .await;
        assert_eq!(result.unwrap_err(), "已停止生成");
        assert_eq!(server.join().unwrap().len(), 1);
    }
}

pub(super) fn profile_key(config: &StoredConnection, request: &Value) -> Result<String, String> {
    // Configuration/credential generation and model isolate each learned profile.
    // Contains no API secret; kept only in process memory.
    serde_json::to_string(&(&config.config, &config.credential, &request["model"]))
        .map_err(|_| "模型连接设置无效".into())
}

pub(super) struct ProviderError {
    status: u16,
    code: Option<String>,
    param: Option<String>,
    message: String,
}

impl ProviderError {
    pub(super) fn parse(status: u16, bytes: &[u8]) -> Self {
        let value: Value = serde_json::from_slice(bytes).unwrap_or(Value::Null);
        let error = value.get("error").unwrap_or(&value);
        Self {
            status,
            code: error.get("code").and_then(Value::as_str).map(str::to_owned),
            param: error
                .get("param")
                .and_then(Value::as_str)
                .map(str::to_owned),
            message: error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_lowercase(),
        }
    }

    fn unsupported_parameter(&self, name: &str) -> bool {
        let named = self
            .param
            .as_deref()
            .is_some_and(|param| param == name || param.starts_with(&format!("{name}.")))
            || self.message.contains(&format!("'{name}'"))
            || self.message.contains(&format!("\"{name}\""))
            || self.message.contains(&format!("`{name}`"));
        named
            && (matches!(
                self.code.as_deref(),
                Some("unsupported_parameter" | "unknown_parameter" | "unrecognized_parameter")
            ) || [
                "not supported",
                "unsupported",
                "unknown parameter",
                "unrecognized",
                "不支持",
                "未知参数",
            ]
            .iter()
            .any(|phrase| self.message.contains(phrase)))
    }

    fn protocol_mismatch(&self, protocol: Protocol) -> bool {
        if matches!(
            self.code.as_deref(),
            Some("protocol_not_supported" | "unsupported_protocol" | "unsupported_endpoint")
        ) {
            return true;
        }
        // Missing route is different from a missing/inaccessible model.
        if matches!(self.status, 404 | 405)
            && matches!(
                self.code.as_deref(),
                None | Some("not_found" | "not_found_error" | "method_not_allowed")
            )
            && !self.message.contains("model")
            && !self.message.contains("模型")
        {
            return true;
        }
        if !matches!(self.status, 400 | 422)
            || !matches!(self.code.as_deref(), None | Some("invalid_request_error"))
        {
            return false;
        }
        let path = match protocol {
            Protocol::Responses => "/responses",
            Protocol::ChatCompletions => "/chat/completions",
        };
        self.message.contains(path)
            && (self.message.contains("not supported") || self.message.contains("unsupported"))
    }

    pub(super) fn display(&self) -> String {
        let detail = if self.status == 403
            && (self.message.contains("标准 codex 客户端")
                || self.message.contains("standard codex client")
                || self.message.contains("official codex client"))
        {
            "服务要求通过标准 Codex 客户端使用此模型；请改选允许第三方应用使用的模型，或在模型连接中接入已登录且具有对应权限的 Codex CLI，也可联系供应商调整权限"
        } else {
            match self.code.as_deref() {
                Some(
                    "protocol_not_supported" | "unsupported_protocol" | "unsupported_endpoint",
                ) => "当前模型不支持所选接口协议，请在模型连接中切换 Responses 或 Chat Completions",
                Some("model_not_found" | "invalid_model") => {
                    "当前模型不存在或没有访问权限，请在对话中重新选择模型"
                }
                Some("context_length_exceeded") => {
                    "对话超过模型上下文上限，请减少参考内容或新建会话"
                }
                Some("insufficient_quota") => "模型服务额度不足，请检查服务账户",
                _ => match self.status {
                    401 | 403 => "API 密钥无效或没有模型权限，请改选模型或检查模型连接与供应商权限",
                    429 => "模型服务限流或额度不足，请稍后重试",
                    _ => "请核对接口协议、当前对话模型与服务地址",
                },
            }
        };
        format!("模型服务返回 HTTP {}；{detail}", self.status)
    }
}

async fn read_error(mut response: reqwest::Response) -> ProviderError {
    let status = response.status().as_u16();
    let mut bytes = Vec::new();
    while let Ok(Some(chunk)) = response.chunk().await {
        if bytes.len() + chunk.len() > 32_768 {
            return ProviderError::parse(status, &[]);
        }
        bytes.extend_from_slice(&chunk);
    }
    ProviderError::parse(status, &bytes)
}

pub(super) async fn open_stream(
    client: &reqwest::Client,
    config: &StoredConnection,
    request: &Value,
    profile: &mut Profile,
    cancelled: &mut watch::Receiver<bool>,
    mut notice: impl FnMut(&'static str) -> Result<(), String>,
) -> Result<reqwest::Response, String> {
    let mut tried = Vec::new();
    loop {
        if *cancelled.borrow() {
            return Err("已停止生成".into());
        }
        tried.push(*profile);
        let mut selected = config.config.clone();
        selected.protocol = profile.protocol;
        let body = profile.body(&selected, request)?;
        let outgoing = authenticate(
            client.post(generation_endpoint(&selected)?).json(&body),
            config,
        )?;
        let response = tokio::select! {
            _ = cancelled.changed() => return Err("已停止生成".into()),
            response = outgoing.send() => response.map_err(|_| "模型连接失败或超时，请检查网络与服务地址")?,
        };
        if response.status().is_success() {
            return Ok(response);
        }
        let error = tokio::select! {
            _ = cancelled.changed() => return Err("已停止生成".into()),
            error = read_error(response) => error,
        };
        if config.config.auto_adapt && tried.len() < 4 {
            if let Some((next, reason)) = profile.adapt(&error, request) {
                if !tried.contains(&next) {
                    *profile = next;
                    notice(reason)?;
                    continue;
                }
            }
        }
        return Err(if tried.len() > 1 {
            format!("{}；已尝试自动适配，仍未成功", error.display())
        } else {
            error.display()
        });
    }
}
