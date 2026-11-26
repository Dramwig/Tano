// SPDX-License-Identifier: MIT
//! Execute Codex CLI or Claude CLI on a remote SSH server over the existing
//! multiplexed SSH transport, reusing Tano's strict read-only sandbox flags and
//! structured output validator.

use super::{transport::RemoteTransport, uri::shell_single_quote};
use crate::assistant_cli::{self, Kind, ReasoningEffort};
use serde_json::Value;
use std::time::Duration;
use tauri::ipc::Channel;
use tokio::sync::watch;

const MAX_REMOTE_CLI_OUTPUT: usize = 4_000_000;
const REMOTE_CLI_TIMEOUT: Duration = Duration::from_secs(180);

fn q(value: &str) -> Result<String, String> {
    shell_single_quote(value).map_err(|e| e.to_string())
}

pub fn validate_remote_cli_path(path: &str) -> Result<Option<String>, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if !trimmed.starts_with('/')
        || trimmed.chars().any(|c| c.is_control() || c == '\0')
        || trimmed.len() > 1024
    {
        return Err("远端 CLI 路径必须是 POSIX 绝对路径（例如 /usr/local/bin/codex）".into());
    }
    Ok(Some(trimmed.to_owned()))
}

pub fn build_remote_cli_command(
    kind: Kind,
    explicit_path: Option<&str>,
    model: &str,
    reasoning_effort: Option<ReasoningEffort>,
    schema_file: &str,
) -> Result<String, String> {
    let default_bin = match kind {
        Kind::CodexCli => "codex",
        Kind::ClaudeCli => "claude",
        Kind::Api => return Err("此连接不是 CLI".into()),
    };
    let bin = match explicit_path {
        Some(path) => q(path)?,
        None => default_bin.to_owned(),
    };
    if model.chars().any(char::is_control) || model.len() > 200 {
        return Err("模型名称无效".into());
    }

    let cleanup = format!("trap 'rm -f {}' EXIT", q(schema_file)?);

    let run_cmd = if kind == Kind::CodexCli {
        let mut parts = vec![
            bin,
            "exec".into(),
            "--json".into(),
            "--ephemeral".into(),
            "--ignore-rules".into(),
            "--skip-git-repo-check".into(),
            "--sandbox".into(),
            "read-only".into(),
            "--color".into(),
            "never".into(),
            "--output-schema".into(),
            q(schema_file)?,
            "--config".into(),
            q("approval_policy=\"never\"")?,
            "--config".into(),
            q("web_search=\"disabled\"")?,
            "--config".into(),
            q("tools.view_image=false")?,
            "--config".into(),
            q("history.persistence=\"none\"")?,
            "--config".into(),
            q("project_doc_max_bytes=0")?,
        ];
        if let Some(effort) = reasoning_effort {
            let effort_name = serde_json::to_value(effort)
                .ok()
                .and_then(|v| v.as_str().map(str::to_owned))
                .unwrap_or_else(|| "medium".into());
            parts.push("--config".into());
            parts.push(q(&format!("model_reasoning_effort=\"{effort_name}\""))?);
        }
        if model != "cli-default" {
            parts.push("--model".into());
            parts.push(q(model)?);
        }
        parts.push("-".into());
        parts.join(" ")
    } else {
        let mut parts = vec![
            bin,
            "--print".into(),
            "--output-format".into(),
            "stream-json".into(),
            "--verbose".into(),
            "--safe-mode".into(),
            "--tools".into(),
            q("")?,
            "--strict-mcp-config".into(),
            "--mcp-config".into(),
            q("{\"mcpServers\":{}}")?,
            "--disable-slash-commands".into(),
            "--no-session-persistence".into(),
            "--no-chrome".into(),
            "--permission-mode".into(),
            "dontAsk".into(),
            "--permission-prompts".into(),
            "none".into(),
            "--settings".into(),
            q("{\"disableAllHooks\":true}")?,
            "--json-schema".into(),
            format!("\"$(cat {})\"", q(schema_file)?),
        ];
        if model != "cli-default" {
            parts.push("--model".into());
            parts.push(q(model)?);
        }
        parts.join(" ")
    };

    Ok(format!("{cleanup}; {run_cmd}"))
}

pub async fn probe_remote_cli_models(
    transport: &dyn RemoteTransport,
    kind: Kind,
    explicit_path: &str,
) -> Result<Vec<String>, String> {
    let custom = validate_remote_cli_path(explicit_path)?;
    let check_cmd = match (&custom, kind) {
        (Some(path), _) => format!("test -x {}", q(path)?),
        (None, Kind::CodexCli) => "command -v codex >/dev/null 2>&1".into(),
        (None, Kind::ClaudeCli) => "command -v claude >/dev/null 2>&1".into(),
        (None, Kind::Api) => return Err("此连接不是 CLI".into()),
    };
    let out = transport
        .exec_bounded(&check_cmd, None, 4096, 4096, Duration::from_secs(10))
        .await
        .map_err(|e| format!("检查远端 CLI 可用性失败：{e}"))?;
    if out.exit_code != 0 {
        let name = if kind == Kind::CodexCli {
            "codex"
        } else {
            "claude"
        };
        return Err(format!(
            "远端服务器未找到 {name} CLI，请在远端安装并登录后重试"
        ));
    }
    Ok(vec!["cli-default".to_owned()])
}

pub async fn run_remote_cli(
    transport: &dyn RemoteTransport,
    kind: Kind,
    explicit_path: &str,
    reasoning_effort: Option<ReasoningEffort>,
    request: Value,
    cancelled: watch::Receiver<bool>,
    channel: &Channel<Vec<u8>>,
) -> Result<(), String> {
    if *cancelled.borrow() {
        return Err("已停止生成".into());
    }
    let custom = validate_remote_cli_path(explicit_path)?;
    assistant_cli::send_progress(channel, "starting")?;

    let prompt = assistant_cli::build_prompt(&request);
    let schema_bytes =
        serde_json::to_vec(&assistant_cli::schema_json()).map_err(|e| e.to_string())?;
    let model = request["model"].as_str().ok_or("请选择模型")?;

    let run_id = uuid::Uuid::new_v4();
    let schema_file = format!("/tmp/tano-cli-schema-{run_id}.json");
    transport
        .write_atomic_replace(&schema_file, &schema_bytes)
        .await
        .map_err(|e| format!("无法写入远端 CLI Schema 文件：{e}"))?;

    let cmd = build_remote_cli_command(
        kind,
        custom.as_deref(),
        model,
        reasoning_effort,
        &schema_file,
    )?;

    let stream_res = tokio::time::timeout(
        REMOTE_CLI_TIMEOUT,
        transport.exec_stream_lines(
            &cmd,
            prompt.into_bytes(),
            MAX_REMOTE_CLI_OUTPUT,
            cancelled.clone(),
            Box::new(move |line: Vec<u8>| {
                if kind == Kind::ClaudeCli {
                    if let Ok(event) = serde_json::from_slice::<Value>(&line) {
                        if event["type"] == "system" && event["subtype"] == "api_retry" {
                            match event["error_status"].as_u64() {
                                Some(401) => {
                                    return Err(
                                        "远端 Claude CLI 返回 HTTP 401，请在远端终端检查登录"
                                            .into(),
                                    );
                                }
                                Some(403) => {
                                    return Err(
                                        "远端 Claude CLI 返回 HTTP 403，当前账户无权访问".into()
                                    );
                                }
                                Some(404) => {
                                    return Err(
                                        "远端 Claude CLI 返回 HTTP 404，请检查模型与配置".into()
                                    );
                                }
                                _ => {}
                            }
                        }
                    }
                }
                Ok(())
            }),
        ),
    )
    .await;

    // Best-effort remote cleanup even if shell trap did not fire on disconnect.
    let _ = transport.remove_file(&schema_file).await;

    if *cancelled.borrow() {
        return Err("已停止生成".into());
    }
    let (exit_code, output_bytes, _stderr_bytes) = match stream_res {
        Ok(Ok(result)) => result,
        Ok(Err(e)) => return Err(format!("远端 CLI 执行失败：{e}")),
        Err(_) => return Err("远端 CLI 生成超时，请减少上下文或重试".into()),
    };
    if exit_code != 0 && output_bytes.is_empty() {
        return Err("远端 CLI 调用失败，请在远端终端检查 CLI 安装、登录与模型配置".into());
    }

    let (reply, usage) = assistant_cli::parse_output_for_remote(kind, &output_bytes, &request)?;
    if *cancelled.borrow() {
        return Err("已停止生成".into());
    }
    assistant_cli::finish_reply_for_remote(reply, usage, channel)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_sandboxed_remote_codex_and_claude_commands() {
        let codex_cmd = build_remote_cli_command(
            Kind::CodexCli,
            None,
            "o3",
            Some(ReasoningEffort::High),
            "/tmp/s.json",
        )
        .unwrap();
        assert!(codex_cmd.contains("codex exec --json --ephemeral"));
        assert!(codex_cmd.contains("--sandbox read-only"));
        assert!(codex_cmd.contains("approval_policy=\"never\""));
        assert!(codex_cmd.contains("model_reasoning_effort=\"high\""));
        assert!(codex_cmd.contains("trap 'rm -f"));

        let claude_cmd = build_remote_cli_command(
            Kind::ClaudeCli,
            Some("/opt/bin/claude"),
            "cli-default",
            None,
            "/tmp/s.json",
        )
        .unwrap();
        assert!(claude_cmd.contains("'/opt/bin/claude' --print --output-format stream-json"));
        assert!(claude_cmd.contains("--strict-mcp-config"));
        assert!(claude_cmd.contains("disableAllHooks"));
    }

    #[test]
    fn rejects_invalid_remote_cli_paths() {
        assert!(validate_remote_cli_path("codex").is_err());
        assert!(validate_remote_cli_path("/usr/bin/codex\nrm -rf /").is_err());
        assert_eq!(
            validate_remote_cli_path("/usr/local/bin/codex").unwrap(),
            Some("/usr/local/bin/codex".into())
        );
    }
}
