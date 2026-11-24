use super::*;
use tokio::io::{AsyncBufRead, AsyncWrite};

const RESPONSE_LIMIT: usize = 4_000_000;
const MODEL_LIMIT: usize = 999; // The UI accepts 1,000 entries including cli-default.

pub async fn models(
    kind: Kind,
    path: &str,
    data: &Path,
    cancelled: watch::Receiver<bool>,
) -> Result<Vec<String>, String> {
    if *cancelled.borrow() {
        return Err("已取消读取模型列表".into());
    }
    let executable = resolve(kind, path)?;
    if kind == Kind::ClaudeCli {
        return Ok(["cli-default", "sonnet", "opus", "haiku"]
            .map(str::to_owned)
            .to_vec());
    }
    let runs = data.join("runs");
    std::fs::create_dir_all(&runs).map_err(|_| "无法创建 CLI 临时目录")?;
    let directory = tempfile::tempdir_in(runs).map_err(|_| "无法创建 CLI 临时目录")?;
    let mut command = Command::new(executable);
    command
        .args(["app-server", "--listen", "stdio://"])
        .current_dir(directory.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    // Use the same provider/authentication and disabled tools as generation.
    // No thread or inference turn is started, and no workspace is passed to Codex.
    for value in codex_overrides()? {
        command.arg("--config").arg(value);
    }
    command.args(["--config", "sandbox_mode=\"read-only\""]);
    discover(command, cancelled, Duration::from_secs(30)).await
}

async fn discover(
    mut command: Command,
    mut cancelled: watch::Receiver<bool>,
    timeout: Duration,
) -> Result<Vec<String>, String> {
    if *cancelled.borrow() {
        return Err("已取消读取模型列表".into());
    }
    let mut child = command
        .spawn()
        .map_err(|_| "无法启动 Codex CLI 读取模型列表")?;
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
        let query = catalog(&mut reader, &mut stdin);
        // Drain stderr concurrently without forwarding configuration or credential details.
        let drain = async {
            limited(stderr, 65_536).await?;
            std::future::pending::<Result<Vec<String>, String>>().await
        };
        tokio::select! {
            _ = cancelled.changed() => Err("已取消读取模型列表".into()),
            _ = tokio::time::sleep(timeout) => Err("Codex CLI 模型列表读取超时，请检查 CLI 配置后重试".into()),
            result = query => result,
            result = drain => result,
        }
    };
    drop(stdin);
    #[cfg(windows)]
    drop(tree);
    // app-server stays alive after replying; reap it on success as well as failure.
    let _ = child.kill().await;
    result
}

async fn send(writer: &mut (impl AsyncWrite + Unpin), message: Value) -> Result<(), String> {
    let mut bytes = serde_json::to_vec(&message).map_err(|_| "模型列表请求格式无效")?;
    bytes.push(b'\n');
    writer
        .write_all(&bytes)
        .await
        .map_err(|_| "无法发送模型列表请求")?;
    writer
        .flush()
        .await
        .map_err(|_| "无法发送模型列表请求".into())
}

async fn response(
    reader: &mut (impl AsyncBufRead + Unpin),
    id: u64,
    remaining: &mut usize,
) -> Result<Value, String> {
    loop {
        let mut line = Vec::new();
        let count = (&mut *reader)
            .take((*remaining + 1) as u64)
            .read_until(b'\n', &mut line)
            .await
            .map_err(|_| "Codex CLI 模型列表响应中断")?;
        if count > *remaining {
            return Err("Codex CLI 模型列表响应超过大小限制".into());
        }
        *remaining -= count;
        if count == 0 {
            return Err("Codex CLI 未返回模型列表，请检查 CLI 版本、登录和供应商配置".into());
        }
        if line.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        let message: Value =
            serde_json::from_slice(&line).map_err(|_| "Codex CLI 模型列表不是有效 JSON")?;
        if message["id"].as_u64() != Some(id) {
            continue; // Initialization notifications may arrive between RPC replies.
        }
        if message.get("error").is_some() {
            return Err("Codex CLI 无法读取模型列表，请检查 CLI 版本、登录和供应商配置".into());
        }
        return message
            .get("result")
            .cloned()
            .filter(Value::is_object)
            .ok_or_else(|| "Codex CLI 模型列表响应格式无效".into());
    }
}

async fn catalog(
    reader: &mut (impl AsyncBufRead + Unpin),
    writer: &mut (impl AsyncWrite + Unpin),
) -> Result<Vec<String>, String> {
    let mut remaining = RESPONSE_LIMIT;
    send(
        writer,
        json!({"id":0,"method":"initialize","params":{"clientInfo":{
            "name":"tano","title":"Tano","version":env!("CARGO_PKG_VERSION")
        }}}),
    )
    .await?;
    response(reader, 0, &mut remaining).await?;
    send(writer, json!({"method":"initialized"})).await?;
    let mut models = vec!["cli-default".to_owned()];
    let mut seen = BTreeSet::from(["cli-default".to_owned()]);
    let mut cursors = BTreeSet::new();
    let mut cursor: Option<String> = None;
    let mut count = 0;
    for id in 1..=100 {
        send(
            writer,
            json!({"id":id,"method":"model/list","params":{
                "cursor":cursor,"limit":100,"includeHidden":true
            }}),
        )
        .await?;
        let page = response(reader, id, &mut remaining).await?;
        let entries = page["data"]
            .as_array()
            .ok_or("Codex CLI 模型列表格式无效")?;
        count += entries.len();
        if count > MODEL_LIMIT {
            return Err("Codex CLI 模型列表超过数量限制".into());
        }
        for entry in entries {
            // `id` identifies a catalog entry; `model` is the actual --model value.
            let model = entry["model"]
                .as_str()
                .filter(|id| crate::assistant::valid_model_id(id))
                .ok_or("Codex CLI 模型 ID 无效")?;
            if seen.insert(model.to_owned()) {
                models.push(model.to_owned());
            }
        }
        cursor = match page.get("nextCursor") {
            None | Some(Value::Null) => return Ok(models),
            Some(Value::String(value)) if !value.is_empty() && value.len() <= 4096 => {
                Some(value.clone())
            }
            _ => return Err("Codex CLI 模型列表分页无效".into()),
        };
        if !cursors.insert(cursor.clone()) {
            return Err("Codex CLI 模型列表分页重复".into());
        }
    }
    Err("Codex CLI 模型列表超过分页限制".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn read_pages(pages: Vec<Value>) -> (Result<Vec<String>, String>, Vec<Value>) {
        let mut output = json!({"id":0,"result":{}}).to_string() + "\n";
        output.push_str("{\"method\":\"notice\",\"params\":{}}\n");
        for (index, page) in pages.into_iter().enumerate() {
            output.push_str(&json!({"id":index+1,"result":page}).to_string());
            output.push('\n');
        }
        let mut requests = Vec::new();
        let result = catalog(&mut output.as_bytes(), &mut requests).await;
        let requests = String::from_utf8(requests)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        (result, requests)
    }

    #[tokio::test]
    async fn lists_every_page_in_cli_order_using_model_values_and_deduplicates() {
        let (result, requests) = read_pages(vec![
            json!({"data":[{"id":"preset","model":"model-b"},{"model":"model-a","hidden":true}],"nextCursor":"next"}),
            json!({"data":[{"model":"model-b"},{"model":"model-c"}],"nextCursor":null}),
        ]).await;
        assert_eq!(
            result.unwrap(),
            ["cli-default", "model-b", "model-a", "model-c"]
        );
        assert_eq!(requests[0]["method"], "initialize");
        assert_eq!(requests[1]["method"], "initialized");
        assert_eq!(requests[2]["params"]["includeHidden"], true);
        assert_eq!(requests[3]["params"]["cursor"], "next");
        assert!(requests.iter().all(|r| matches!(
            r["method"].as_str(),
            Some("initialize" | "initialized" | "model/list")
        )));
    }

    #[tokio::test]
    async fn rejects_malformed_models_oversized_catalogs_and_repeated_cursors() {
        for page in [
            json!({"data":[{"model":" spaced "}]}),
            json!({"data":[{"model":"bad\nmodel"}]}),
            json!({"data":[{"model":"a".repeat(201)}]}),
            json!({"data":[{"id":"no-model-value"}]}),
            json!({"data":{}}),
            json!({"data":vec![json!({"model":"a"});1000]}),
            json!({"data":[],"nextCursor":12}),
        ] {
            assert!(read_pages(vec![page]).await.0.is_err());
        }
        let repeated = json!({"data":[],"nextCursor":"same"});
        assert!(read_pages(vec![repeated.clone(), repeated])
            .await
            .0
            .unwrap_err()
            .contains("分页重复"));
        assert_eq!(
            read_pages(vec![json!({"data":[]})]).await.0.unwrap(),
            ["cli-default"]
        );
    }

    #[tokio::test]
    async fn bounds_response_bytes_and_redacts_rpc_errors() {
        let mut remaining = 20;
        assert!(response(&mut &[b'a'; 21][..], 0, &mut remaining)
            .await
            .unwrap_err()
            .contains("大小限制"));
        let error = b"{\"id\":0,\"error\":{\"message\":\"secret\"}}\n";
        let result = response(&mut &error[..], 0, &mut 1000).await.unwrap_err();
        assert!(!result.contains("secret"));
    }

    #[tokio::test]
    async fn cancelled_discovery_does_not_start_a_process() {
        let (_sender, receiver) = watch::channel(true);
        assert!(discover(
            Command::new("must-not-be-started"),
            receiver,
            Duration::from_secs(1)
        )
        .await
        .unwrap_err()
        .contains("已取消"));
    }

    #[tokio::test]
    #[ignore = "uses the installed Codex CLI and its model catalog; does not run inference"]
    async fn installed_codex_model_catalog() {
        let directory = tempfile::tempdir().unwrap();
        let (_sender, receiver) = watch::channel(false);
        let result = models(Kind::CodexCli, "", directory.path(), receiver)
            .await
            .unwrap();
        assert_eq!(result.first().map(String::as_str), Some("cli-default"));
        assert!(
            result.len() > 1,
            "installed Codex returned no selectable models"
        );
        eprintln!("Codex CLI models: {}", result.join(", "));
    }
}
