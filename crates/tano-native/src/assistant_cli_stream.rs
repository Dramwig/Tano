//! Codex app-server transport. Only answer text is provisional; calls are released
//! after a successful turn and validation of the complete structured response.
use super::*;
use tokio::io::{AsyncBufRead, AsyncWrite};

const OUTPUT_LIMIT: usize = 8_000_000;

pub(super) fn command(executable: &Path, directory: &Path) -> Result<Command, String> {
    let mut command = Command::new(executable);
    command
        .args(["app-server", "--listen", "stdio://"])
        .current_dir(directory)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    for value in codex_overrides()? {
        command.arg("--config").arg(value);
    }
    command.args(["--config", "sandbox_mode=\"read-only\""]);
    Ok(command)
}

pub(super) async fn run(
    executable: &Path,
    directory: &Path,
    request: &Value,
    effort: Option<ReasoningEffort>,
    prompt: &str,
    cancelled: watch::Receiver<bool>,
    channel: &Channel<Vec<u8>>,
) -> Result<(Reply, Value, String), String> {
    execute(
        command(executable, directory)?,
        request,
        effort,
        prompt,
        cancelled,
        channel,
        Duration::from_secs(180),
    )
    .await
}

async fn execute(
    mut command: Command,
    request: &Value,
    effort: Option<ReasoningEffort>,
    prompt: &str,
    mut cancelled: watch::Receiver<bool>,
    channel: &Channel<Vec<u8>>,
    timeout: Duration,
) -> Result<(Reply, Value, String), String> {
    if *cancelled.borrow() {
        return Err("已停止生成".into());
    }
    let mut child = command
        .spawn()
        .map_err(|_| "无法启动 Codex CLI，请检查安装及可执行文件路径")?;
    #[cfg(windows)]
    let tree = match ProcessTree::attach(child.id().ok_or("CLI 进程已退出")?) {
        Ok(tree) => tree,
        Err(error) => {
            let _ = child.kill().await;
            return Err(error);
        }
    };
    let mut stdin = child.stdin.take().ok_or("CLI 输入不可用")?;
    let stdout = child.stdout.take().ok_or("CLI 输出不可用")?;
    let stderr = child.stderr.take().ok_or("CLI 错误输出不可用")?;
    let mut reader = BufReader::new(stdout);
    let result = {
        let work = conversation(&mut reader, &mut stdin, request, effort, prompt, channel);
        let drain = async {
            limited(stderr, 65_536).await?;
            std::future::pending::<Result<(Reply, Value, String), String>>().await
        };
        tokio::select! {
            biased;
            _ = cancelled.changed() => Err("已停止生成".into()),
            _ = tokio::time::sleep(timeout) => Err("CLI 生成超时，请减少上下文或重试".into()),
            result = work => result,
            result = drain => result,
        }
    };
    drop(stdin);
    #[cfg(windows)]
    drop(tree);
    // app-server is persistent; reap it even on successful turn completion.
    let _ = child.kill().await;
    result
}

async fn send(writer: &mut (impl AsyncWrite + Unpin), message: Value) -> Result<(), String> {
    let mut bytes = serde_json::to_vec(&message).map_err(|_| "CLI 请求格式无效")?;
    bytes.push(b'\n');
    writer
        .write_all(&bytes)
        .await
        .map_err(|_| "无法发送 CLI 请求")?;
    writer.flush().await.map_err(|_| "无法发送 CLI 请求".into())
}

async fn next(
    reader: &mut (impl AsyncBufRead + Unpin),
    remaining: &mut usize,
) -> Result<Value, String> {
    loop {
        let mut line = Vec::new();
        let count = (&mut *reader)
            .take((*remaining + 1) as u64)
            .read_until(b'\n', &mut line)
            .await
            .map_err(|_| "CLI 输出读取失败")?;
        if count > *remaining {
            return Err("CLI 输出超过大小限制".into());
        }
        *remaining -= count;
        if count == 0 {
            return Err("Codex CLI 响应中断，本轮未完成".into());
        }
        if line.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        let message: Value =
            serde_json::from_slice(&line).map_err(|_| "CLI 输出格式不受支持，请更新 CLI")?;
        // This integration never services native tools, approvals or input requests.
        if message.get("method").is_some() && message.get("id").is_some() {
            return Err("CLI 尝试使用内置工具或请求授权，已停止生成".into());
        }
        return Ok(message);
    }
}

async fn response(
    reader: &mut (impl AsyncBufRead + Unpin),
    id: u64,
    remaining: &mut usize,
) -> Result<Value, String> {
    loop {
        let message = next(reader, remaining).await?;
        if message["id"].as_u64() != Some(id) {
            continue;
        }
        if message.get("error").is_some() {
            return Err(codex_error(&message));
        }
        return message
            .get("result")
            .cloned()
            .filter(Value::is_object)
            .ok_or("CLI 响应格式无效".into());
    }
}

fn turn_params(thread_id: &str, prompt: &str, effort: Option<ReasoningEffort>) -> Value {
    let mut params = json!({"threadId":thread_id, "input":[{"type":"text","text":prompt}], "outputSchema":schema()});
    if let Some(effort) = effort {
        params["effort"] = json!(effort);
    }
    params
}

async fn conversation(
    reader: &mut (impl AsyncBufRead + Unpin),
    writer: &mut (impl AsyncWrite + Unpin),
    request: &Value,
    effort: Option<ReasoningEffort>,
    prompt: &str,
    channel: &Channel<Vec<u8>>,
) -> Result<(Reply, Value, String), String> {
    let mut remaining = OUTPUT_LIMIT;
    send(
        writer,
        json!({"id":0,"method":"initialize","params":{"clientInfo":{
            "name":"tano","title":"Tano","version":env!("CARGO_PKG_VERSION")
        }}}),
    )
    .await?;
    response(reader, 0, &mut remaining).await?;
    send(writer, json!({"method":"initialized"})).await?;
    progress(channel, "connecting")?;
    let mut params = json!({"ephemeral":true,"approvalPolicy":"never","sandbox":"read-only",
        "baseInstructions":INSTRUCTIONS,"developerInstructions":INSTRUCTIONS});
    let model = request["model"].as_str().ok_or("请选择模型")?;
    if model != "cli-default" {
        params["model"] = json!(model);
    }
    send(
        writer,
        json!({"id":1,"method":"thread/start","params":params}),
    )
    .await?;
    let started = response(reader, 1, &mut remaining).await?;
    let thread_id = started
        .pointer("/thread/id")
        .and_then(Value::as_str)
        .ok_or("CLI 会话标识无效")?;
    send(
        writer,
        json!({"id":2,"method":"turn/start","params":turn_params(thread_id,prompt,effort)}),
    )
    .await?;
    let mut turn = TurnStream::default();
    loop {
        let message = next(reader, &mut remaining).await?;
        if message["id"] == 2 {
            if message.get("error").is_some() {
                return Err(codex_error(&message));
            }
            continue;
        }
        let params = &message["params"];
        if params["threadId"] != thread_id {
            continue;
        }
        if turn.event(message["method"].as_str().unwrap_or(""), params, channel)? {
            progress(channel, "validating")?;
            let value = turn.final_value.ok_or("CLI 未返回完整结构化回答")?;
            let reply = validate_reply(value, request)?;
            if !reply.content.starts_with(&turn.shown) {
                return Err("CLI 正文与完整回答不一致".into());
            }
            return Ok((reply, turn.usage, turn.shown));
        }
    }
}

#[derive(Default)]
struct TurnStream {
    json: JsonContent,
    item_id: Option<String>,
    final_value: Option<Value>,
    shown: String,
    usage: Value,
    phase: String,
}

impl TurnStream {
    fn progress(&mut self, kind: &str, channel: &Channel<Vec<u8>>) -> Result<(), String> {
        if self.phase != kind {
            progress(channel, kind)?;
            self.phase = kind.to_owned();
        }
        Ok(())
    }

    fn item(&mut self, id: &Value) -> Result<(), String> {
        let id = id.as_str().ok_or("CLI 消息标识无效")?;
        if self
            .item_id
            .as_deref()
            .is_some_and(|previous| previous != id)
        {
            return Err("CLI 返回多份回答，已停止处理".into());
        }
        self.item_id = Some(id.to_owned());
        Ok(())
    }

    fn text(&mut self, delta: &str, channel: &Channel<Vec<u8>>) -> Result<(), String> {
        let text = self.json.push(delta)?;
        if !text.is_empty() {
            self.progress("generating", channel)?;
            self.shown.push_str(&text);
            send_frame(
                channel,
                json!({"choices":[{"index":0,"delta":{"content":text}}]}),
            )?;
        }
        Ok(())
    }

    fn event(
        &mut self,
        method: &str,
        params: &Value,
        channel: &Channel<Vec<u8>>,
    ) -> Result<bool, String> {
        match method {
            "turn/started" => self.progress("thinking", channel)?,
            "item/reasoning/summaryTextDelta" | "item/reasoning/textDelta" => {
                self.progress("thinking", channel)?
            }
            "item/agentMessage/delta" => {
                self.item(&params["itemId"])?;
                self.text(params["delta"].as_str().ok_or("CLI 正文格式无效")?, channel)?;
            }
            "item/started" | "item/completed" => {
                let item = &params["item"];
                match item["type"].as_str() {
                    Some("userMessage" | "reasoning" | "plan") => {}
                    Some("agentMessage") => {
                        self.item(&item["id"])?;
                        if method == "item/completed" {
                            let text = item["text"].as_str().ok_or("CLI 回答无效")?;
                            let rest = text
                                .strip_prefix(&self.json.raw)
                                .ok_or("CLI 正文与完整回答不一致")?
                                .to_owned();
                            self.text(&rest, channel)?;
                            self.final_value = Some(
                                serde_json::from_str(text).map_err(|_| "CLI 未返回结构化回答")?,
                            );
                        }
                    }
                    _ => return Err("CLI 尝试使用内置工具，已停止生成".into()),
                }
            }
            "thread/tokenUsage/updated" => {
                let usage = &params["tokenUsage"]["last"];
                self.usage = json!({"input_tokens":usage["inputTokens"],"output_tokens":usage["outputTokens"]});
            }
            "error" => {
                if params["willRetry"] == true {
                    self.progress("retrying", channel)?;
                } else {
                    return Err(codex_error(params));
                }
            }
            "turn/completed" => {
                if params["turn"]["status"] != "completed" {
                    return Err(codex_error(&params["turn"]));
                }
                return Ok(true);
            }
            _ => {}
        }
        Ok(false)
    }
}

/// Incrementally decodes only the root `content` string. Tool arguments and
/// reasoning never enter the display stream. Full JSON is validated at completion.
#[derive(Default)]
struct JsonContent {
    raw: String,
    offset: usize,
    depth: usize,
    string_start: Option<usize>,
    key_string: bool,
    content_string: bool,
    expecting_key: bool,
    key: String,
    seen_content: bool,
}

impl JsonContent {
    fn push(&mut self, delta: &str) -> Result<String, String> {
        if self.raw.len() + delta.len() > 2_000_000 {
            return Err("CLI 回答超过大小限制".into());
        }
        self.raw.push_str(delta);
        let mut output = String::new();
        while self.offset < self.raw.len() {
            let ch = self.raw[self.offset..].chars().next().unwrap();
            if let Some(start) = self.string_start {
                if ch == '\\' {
                    let tail = &self.raw[self.offset..];
                    if tail.len() < 2 {
                        break;
                    }
                    let mut length = if tail.as_bytes()[1] == b'u' { 6 } else { 2 };
                    if tail.len() < length {
                        break;
                    }
                    if length == 6 {
                        let code =
                            u16::from_str_radix(tail.get(2..6).ok_or("CLI JSON 转义无效")?, 16)
                                .map_err(|_| "CLI JSON 转义无效")?;
                        if (0xD800..=0xDBFF).contains(&code) {
                            length = 12;
                        }
                        if tail.len() < length {
                            break;
                        }
                    }
                    let escaped = tail.get(..length).ok_or("CLI JSON 转义无效")?;
                    let decoded: String = serde_json::from_str(&format!("\"{escaped}\""))
                        .map_err(|_| "CLI JSON 转义无效")?;
                    if self.content_string {
                        output.push_str(&decoded);
                    }
                    self.offset += length;
                    continue;
                }
                if ch == '"' {
                    if self.key_string {
                        self.key = serde_json::from_str(&self.raw[start..=self.offset])
                            .map_err(|_| "CLI JSON 字段无效")?;
                    }
                    self.string_start = None;
                    self.content_string = false;
                } else if self.content_string {
                    if ch.is_control() {
                        return Err("CLI JSON 字符无效".into());
                    }
                    output.push(ch);
                }
            } else {
                match ch {
                    '{' | '[' => {
                        self.depth += 1;
                        if self.depth == 1 {
                            self.expecting_key = true;
                        }
                    }
                    '}' | ']' => {
                        self.depth = self.depth.checked_sub(1).ok_or("CLI JSON 层级无效")?
                    }
                    ',' if self.depth == 1 => {
                        self.expecting_key = true;
                        self.key.clear();
                    }
                    ':' if self.depth == 1 => self.expecting_key = false,
                    '"' => {
                        self.string_start = Some(self.offset);
                        self.key_string = self.depth == 1 && self.expecting_key;
                        self.content_string =
                            self.depth == 1 && !self.expecting_key && self.key == "content";
                        if self.content_string {
                            if self.seen_content {
                                return Err("CLI 回答字段重复".into());
                            }
                            self.seen_content = true;
                        }
                    }
                    _ => {}
                }
            }
            self.offset += ch.len_utf8();
        }
        Ok(output)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    fn channel() -> (Channel<Vec<u8>>, Arc<Mutex<String>>) {
        let output = Arc::new(Mutex::new(String::new()));
        let received = output.clone();
        (
            Channel::new(move |body| {
                if let tauri::ipc::InvokeResponseBody::Json(value) = body {
                    let bytes: Vec<u8> = serde_json::from_str(&value).unwrap();
                    received
                        .lock()
                        .unwrap()
                        .push_str(std::str::from_utf8(&bytes).unwrap());
                }
                Ok(())
            }),
            output,
        )
    }

    #[test]
    fn decodes_only_root_content_at_every_character_boundary() {
        for raw in [
            r#"{"content":"中\n文\"\\\u4e16\ud83d\ude00","toolCalls":[]}"#,
            r#"{"toolCalls":[{"name":"secret","arguments":"{\"content\":\"hidden\"}"}],"content":"中\n文\"\\\u4e16\ud83d\ude00"}"#,
        ] {
            for split in raw.char_indices().map(|(at, _)| at) {
                let mut decoder = JsonContent::default();
                let mut text = decoder.push(&raw[..split]).unwrap();
                text.push_str(&decoder.push(&raw[split..]).unwrap());
                assert_eq!(text, "中\n文\"\\世😀");
            }
            let mut decoder = JsonContent::default();
            let text: String = raw
                .chars()
                .map(|ch| decoder.push(&ch.to_string()).unwrap())
                .collect();
            assert_eq!(text, "中\n文\"\\世😀");
        }
        for invalid in [
            r#"{"content":"\u中xxx"}"#,
            r#"{"content":"\ud800badbad"}"#,
            r#"{"content":"x","content":"y"}"#,
        ] {
            assert!(JsonContent::default().push(invalid).is_err());
        }
        assert!(JsonContent::default().push(&" ".repeat(2_000_001)).is_err());
    }

    #[test]
    fn streams_preview_and_retry_progress_without_releasing_tools_or_duplicating_text() {
        let (channel, output) = channel();
        let mut turn = TurnStream::default();
        let raw = r#"{"content":"回答","toolCalls":[{"name":"propose_edit","arguments":"{}"}]}"#;
        turn.event("turn/started", &json!({}), &channel).unwrap();
        turn.event(
            "item/agentMessage/delta",
            &json!({"itemId":"m","delta":"{\"content\":\"回"}),
            &channel,
        )
        .unwrap();
        let preview = output.lock().unwrap().clone();
        assert!(preview.contains("回"));
        assert!(!preview.contains("tool_calls"));
        assert!(!preview.contains("[DONE]"));
        turn.event(
            "error",
            &json!({"willRetry":true,"error":{"message":"secret-token"}}),
            &channel,
        )
        .unwrap();
        turn.event(
            "item/completed",
            &json!({"item":{"type":"agentMessage","id":"m","text":raw}}),
            &channel,
        )
        .unwrap();
        assert_eq!(turn.shown, "回答");
        assert!(!output.lock().unwrap().contains("secret-token"));
        assert!(output.lock().unwrap().contains("retrying"));
        assert!(turn
            .event(
                "turn/completed",
                &json!({"turn":{"status":"completed"}}),
                &channel
            )
            .unwrap());
        let request = json!({"tools":[{"function":{"name":"propose_edit"}}]});
        let reply = validate_reply(turn.final_value.unwrap(), &request).unwrap();
        finish_reply(reply, json!({}), &turn.shown, &channel).unwrap();
        let frames = output.lock().unwrap().clone();
        assert_eq!(frames.matches("[DONE]").count(), 1);
        assert_eq!(frames.matches("\"tool_calls\":").count(), 1);
        assert!(!frames.contains("\"content\":\"回答\""));
    }

    #[test]
    fn rejects_native_tools_failed_turns_changed_text_and_incomplete_calls() {
        let (channel, output) = channel();
        for kind in ["commandExecution", "fileChange", "mcpToolCall", "webSearch"] {
            assert!(TurnStream::default()
                .event("item/started", &json!({"item":{"type":kind}}), &channel)
                .is_err());
        }
        for status in ["failed", "interrupted", "inProgress"] {
            assert!(TurnStream::default()
                .event(
                    "turn/completed",
                    &json!({"turn":{"status":status,"error":{"message":"private"}}}),
                    &channel
                )
                .is_err());
        }
        let mut turn = TurnStream::default();
        turn.event(
            "item/agentMessage/delta",
            &json!({"itemId":"m","delta":"{\"content\":\"partial"}),
            &channel,
        )
        .unwrap();
        assert!(turn
            .event(
                "item/completed",
                &json!({"item":{"id":"m","type":"agentMessage","text":"different"}}),
                &channel
            )
            .is_err());
        assert!(turn
            .event(
                "item/agentMessage/delta",
                &json!({"itemId":"other","delta":"new"}),
                &channel
            )
            .is_err());
        assert!(validate_reply(
            json!({"content":"partial","toolCalls":[{"name":"forbidden","arguments":"{}"}]}),
            &json!({})
        )
        .is_err());
        assert!(!output.lock().unwrap().contains("[DONE]"));
    }

    #[tokio::test]
    async fn rpc_handshake_and_partial_text_arrive_before_turn_completion() {
        let (client, server) = tokio::io::duplex(16_384);
        let (client_read, mut client_write) = tokio::io::split(client);
        let (server_read, mut server_write) = tokio::io::split(server);
        let mut client_read = BufReader::new(client_read);
        let mut server_read = BufReader::new(server_read);
        let (channel, output) = channel();
        let request = json!({"model":"chosen-model"});
        let work = conversation(
            &mut client_read,
            &mut client_write,
            &request,
            Some(ReasoningEffort::Low),
            "synthetic",
            &channel,
        );
        let server = async {
            // Read client requests without the server-side-request rejection in next().
            async fn read(reader: &mut (impl AsyncBufRead + Unpin)) -> Value {
                let mut line = String::new();
                reader.read_line(&mut line).await.unwrap();
                serde_json::from_str(&line).unwrap()
            }
            assert_eq!(read(&mut server_read).await["method"], "initialize");
            send(&mut server_write, json!({"id":0,"result":{}}))
                .await
                .unwrap();
            assert_eq!(read(&mut server_read).await["method"], "initialized");
            let thread = read(&mut server_read).await;
            assert_eq!(thread["params"]["model"], "chosen-model");
            assert_eq!(thread["params"]["ephemeral"], true);
            assert_eq!(thread["params"]["sandbox"], "read-only");
            send(
                &mut server_write,
                json!({"id":1,"result":{"thread":{"id":"thread"}}}),
            )
            .await
            .unwrap();
            let start = read(&mut server_read).await;
            assert_eq!(start["params"]["effort"], "low");
            assert_eq!(start["params"]["outputSchema"], schema());
            send(
                &mut server_write,
                json!({"id":2,"result":{"turn":{"id":"turn"}}}),
            )
            .await
            .unwrap();
            send(&mut server_write, json!({"method":"item/agentMessage/delta","params":{"threadId":"thread","itemId":"m","delta":"{\"content\":\"first"}})).await.unwrap();
            tokio::time::timeout(Duration::from_secs(2), async {
                while !output.lock().unwrap().contains("first") {
                    tokio::task::yield_now().await;
                }
            })
            .await
            .expect("preview must arrive while the turn is still open");
            assert!(!output.lock().unwrap().contains("[DONE]"));
            send(&mut server_write, json!({"method":"item/completed","params":{"threadId":"thread","item":{"id":"m","type":"agentMessage","text":"{\"content\":\"first answer\",\"toolCalls\":[]}"}}})).await.unwrap();
            send(&mut server_write, json!({"method":"thread/tokenUsage/updated","params":{"threadId":"thread","tokenUsage":{"last":{"inputTokens":11,"outputTokens":7}}}})).await.unwrap();
            send(&mut server_write, json!({"method":"turn/completed","params":{"threadId":"thread","turn":{"status":"completed"}}})).await.unwrap();
            // EOF is not required for the client to finish an app-server turn.
        };
        let (result, _) = tokio::join!(work, server);
        let (reply, usage, shown) = result.unwrap();
        assert_eq!(reply.content, "first answer");
        assert_eq!(shown, reply.content);
        assert_eq!(usage["input_tokens"], 11);
        assert!(turn_params("t", "p", None).get("effort").is_none());
    }

    #[tokio::test]
    async fn rejects_server_requests_eof_and_bounded_output() {
        for input in [
            "{\"id\":9,\"method\":\"item/commandExecution/requestApproval\"}\n",
            "",
        ] {
            assert!(next(&mut BufReader::new(input.as_bytes()), &mut 1024)
                .await
                .is_err());
        }
        assert!(next(&mut BufReader::new(&b"123456"[..]), &mut 5)
            .await
            .unwrap_err()
            .contains("大小限制"));
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn app_server_cancellation_and_timeout_reap_children() {
        for cancel in [false, true] {
            let directory = tempfile::tempdir().unwrap();
            let (sender, receiver) = watch::channel(false);
            let (channel, _) = channel();
            let request = json!({"model":"test"});
            // Suppress libtest's banner from the helper, leaving the pipe open.
            let mut fixture = Command::new("powershell.exe");
            fixture.args(["-NoProfile", "-NonInteractive", "-Command", "& $env:TANO_CLI_TEST_EXE --exact assistant_cli::tests::fixture_process --ignored --nocapture *> $null"])
                .env("TANO_CLI_TEST_EXE", std::env::current_exe().unwrap())
                .env("TANO_CLI_FIXTURE_MODE", "wait")
                .env("TANO_CLI_FIXTURE_DIR", directory.path())
                .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
                .kill_on_drop(true).creation_flags(0x08000000);
            let run = execute(
                fixture,
                &request,
                None,
                "synthetic",
                receiver,
                &channel,
                Duration::from_secs(4),
            );
            let stop = async {
                if cancel {
                    tokio::time::timeout(Duration::from_secs(3), async {
                        while !directory.path().join("pid").exists() {
                            tokio::time::sleep(Duration::from_millis(10)).await;
                        }
                    })
                    .await
                    .expect("fixture child did not start");
                    sender.send(true).unwrap();
                }
            };
            let (result, _) = tokio::join!(run, stop);
            assert!(result
                .err()
                .unwrap()
                .contains(if cancel { "已停止" } else { "超时" }));
            let pid: u32 = std::fs::read_to_string(directory.path().join("pid"))
                .unwrap()
                .parse()
                .unwrap();
            unsafe {
                use windows_sys::Win32::{
                    Foundation::{CloseHandle, WAIT_OBJECT_0},
                    System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE},
                };
                let process = OpenProcess(PROCESS_SYNCHRONIZE, 0, pid);
                if !process.is_null() {
                    assert_eq!(WaitForSingleObject(process, 2000), WAIT_OBJECT_0);
                    CloseHandle(process);
                }
            }
        }
    }
}
