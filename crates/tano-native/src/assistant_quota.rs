use super::*;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub mode: String,
    pub base_url: Option<String>,
    pub user_id: Option<String>,
    pub timeout_seconds: Option<u64>,
    pub interval_minutes: Option<u64>,
    pub path: Option<String>,
    pub method: Option<String>,
    pub auth: Option<String>,
    pub body: Option<String>,
    pub remaining_path: Option<String>,
    pub used_path: Option<String>,
    pub total_path: Option<String>,
    pub unit: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Quota {
    checked_at: u128,
    items: Vec<Item>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Item {
    label: String,
    remaining: Option<f64>,
    used: Option<f64>,
    total: Option<f64>,
    unit: String,
    resets_at: Option<String>,
}

pub fn validate(c: &Config) -> Result<(), String> {
    if c.timeout_seconds.is_some_and(|n| !(1..=120).contains(&n))
        || c.interval_minutes.is_some_and(|n| n > 1440)
    {
        return Err("超时应为 1–120 秒，自动查询间隔应为 0–1440 分钟".into());
    }
    if let Some(url) = c.base_url.as_ref().filter(|s| !s.is_empty()) {
        endpoint(url)?;
    }
    if c.mode == "newapi"
        && !c.user_id.as_ref().is_some_and(|s| {
            !s.is_empty() && s.len() <= 30 && s.bytes().all(|b| b.is_ascii_digit())
        })
    {
        return Err("NewAPI 需要填写数字用户 ID".into());
    }
    if ![
        "disabled",
        "official",
        "generic",
        "newapi",
        "deepseek",
        "siliconflow",
        "openrouter",
        "sub2api",
        "custom",
    ]
    .contains(&c.mode.as_str())
        || !["GET", "POST"].contains(&c.method.as_deref().unwrap_or("GET"))
        || !["bearer", "x-api-key", "none"].contains(&c.auth.as_deref().unwrap_or("bearer"))
        || c.body.as_ref().is_some_and(|v| v.len() > 8192)
        || [&c.remaining_path, &c.used_path, &c.total_path, &c.unit]
            .iter()
            .any(|v| v.as_ref().is_some_and(|s| s.len() > 200))
    {
        return Err("额度查询配置无效".into());
    }
    if c.mode == "custom" {
        let path = c.path.as_deref().unwrap_or("");
        if !path.starts_with('/')
            || path.starts_with("//")
            || path.contains('\\')
            || path.len() > 2000
            || path.chars().any(char::is_control)
        {
            return Err("查询路径必须是当前服务地址下以 / 开头的路径".into());
        }
        if [&c.remaining_path, &c.used_path, &c.total_path]
            .iter()
            .all(|v| v.as_deref().unwrap_or("").is_empty())
        {
            return Err("请配置至少一个额度字段的 JSON Pointer".into());
        }
        if let Some(body) = c.body.as_ref().filter(|b| !b.is_empty()) {
            serde_json::from_str::<Value>(body).map_err(|_| "请求体必须是 JSON")?;
        }
    }
    Ok(())
}
fn number(v: &Value, path: &str) -> Option<f64> {
    let value = v.pointer(path)?;
    value
        .as_f64()
        .or_else(|| value.as_str()?.parse().ok())
        .filter(|n| n.is_finite())
}
fn item(
    label: &str,
    remaining: Option<f64>,
    used: Option<f64>,
    total: Option<f64>,
    unit: &str,
    reset: Option<String>,
) -> Option<Item> {
    if remaining.is_none() && used.is_none() && total.is_none() {
        return None;
    }
    Some(Item {
        label: label.into(),
        remaining,
        used,
        total,
        unit: unit.into(),
        resets_at: reset,
    })
}
fn parse(mode: &str, v: &Value, config: Option<&Config>) -> Result<Vec<Item>, String> {
    let mut items = vec![];
    if v.get("success").and_then(Value::as_bool) == Some(false)
        || v.get("isValid").and_then(Value::as_bool) == Some(false)
    {
        return Err("服务商拒绝额度查询，请检查账号和密钥".into());
    }
    if mode == "codex" || mode == "claude" {
        let windows = if mode == "codex" {
            vec![
                ("主额度窗口", "/rate_limit/primary_window"),
                ("次额度窗口", "/rate_limit/secondary_window"),
            ]
        } else {
            vec![
                ("5 小时", "/five_hour"),
                ("7 天", "/seven_day"),
                ("Sonnet 7 天", "/seven_day_sonnet"),
                ("Opus 7 天", "/seven_day_opus"),
            ]
        };
        for (label, path) in windows {
            if let Some(w) = v.pointer(path) {
                let used = number(
                    w,
                    if mode == "codex" {
                        "/used_percent"
                    } else {
                        "/utilization"
                    },
                );
                let reset = w
                    .get("resets_at")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                    .or_else(|| {
                        w.get("reset_at")
                            .and_then(Value::as_i64)
                            .map(|n| n.to_string())
                    });
                if let Some(i) = item(
                    label,
                    used.map(|n| (100.0 - n).max(0.0)),
                    used,
                    used.map(|_| 100.0),
                    "%",
                    reset,
                ) {
                    items.push(i);
                }
            }
        }
    } else {
        let (path, unit) = match mode {
            "deepseek" => (
                "/balance_infos/0/total_balance",
                v.pointer("/balance_infos/0/currency")
                    .and_then(Value::as_str)
                    .unwrap_or("CNY"),
            ),
            "siliconflow" => ("/data/totalBalance", "CNY"),
            "openrouter" => ("/data/limit_remaining", "USD"),
            "sub2api" | "generic" => ("/remaining", "USD"),
            "newapi" => ("/data/quota", "USD"),
            _ => (
                config
                    .and_then(|c| c.remaining_path.as_deref())
                    .unwrap_or(""),
                config.and_then(|c| c.unit.as_deref()).unwrap_or(""),
            ),
        };
        let remaining = number(v, path).or_else(|| {
            if mode == "generic" {
                number(v, "/quota/remaining").or_else(|| number(v, "/balance"))
            } else {
                None
            }
        });
        let used = if mode == "openrouter" {
            number(v, "/data/usage")
        } else {
            config
                .and_then(|c| c.used_path.as_deref())
                .and_then(|p| number(v, p))
        };
        let total = if mode == "openrouter" {
            number(v, "/data/limit")
        } else {
            config
                .and_then(|c| c.total_path.as_deref())
                .and_then(|p| number(v, p))
        };
        let (remaining, used, total) = if mode == "newapi" {
            let used = number(v, "/data/used_quota");
            (
                remaining.map(|n| n / 500000.0),
                used.map(|n| n / 500000.0),
                remaining.zip(used).map(|(r, u)| (r + u) / 500000.0),
            )
        } else {
            (remaining, used, total)
        };
        if let Some(i) = item("账户额度", remaining, used, total, unit, None) {
            items.push(i);
        }
    }
    if mode == "sub2api" {
        for (label, key) in [
            ("每日额度", "daily"),
            ("每周额度", "weekly"),
            ("每月额度", "monthly"),
        ] {
            let used = number(v, &format!("/subscription/{key}_usage_usd"));
            let total = number(v, &format!("/subscription/{key}_limit_usd"));
            if let Some(i) = item(
                label,
                used.zip(total).map(|(u, t)| (t - u).max(0.0)),
                used,
                total,
                "USD",
                None,
            ) {
                items.push(i);
            }
        }
    }
    if mode == "codex" {
        if let Some(i) = item(
            "额外积分",
            number(v, "/credits/balance"),
            None,
            None,
            "credits",
            None,
        ) {
            items.push(i);
        }
    }
    if items.is_empty() {
        return Err("接口未返回可识别的额度；请检查查询方式和字段映射".into());
    }
    Ok(items)
}
fn read_login(codex: bool) -> Result<Value, String> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .ok_or("无法定位 CLI 登录目录")?;
    let dir = std::env::var_os(if codex {
        "CODEX_HOME"
    } else {
        "CLAUDE_CONFIG_DIR"
    })
    .map(PathBuf::from)
    .unwrap_or_else(|| PathBuf::from(home).join(if codex { ".codex" } else { ".claude" }));
    let path = dir.join(if codex {
        "auth.json"
    } else {
        ".credentials.json"
    });
    let bytes = std::fs::read(path)
        .map_err(|_| "无法读取 CLI 登录凭据，请先在 CLI 中登录；当前支持文件凭据存储")?;
    if bytes.len() > 1024 * 1024 {
        return Err("CLI 凭据文件过大".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "CLI 登录凭据格式无效".into())
}

#[tauri::command]
pub async fn assistant_quota(
    app: tauri::AppHandle,
    connection_id: String,
) -> Result<Quota, String> {
    let stored = load_connection(&app, &connection_id)?;
    let config = stored.config.quota.as_ref();
    if config.is_some_and(|c| c.mode == "disabled") {
        return Err("未启用额度查询".into());
    }
    let codex = stored.config.kind == crate::assistant_cli::Kind::CodexCli;
    let claude = stored.config.kind == crate::assistant_cli::Kind::ClaudeCli;
    let mode = if codex {
        "codex"
    } else if claude {
        "claude"
    } else {
        config
            .map(|c| c.mode.as_str())
            .ok_or("请先配置额度查询方式")?
    };
    let client = http_client(Duration::from_secs(
        config.and_then(|c| c.timeout_seconds).unwrap_or(20),
    ))?;
    let mut request;
    if codex || claude {
        let login = read_login(codex)?;
        if codex
            && login
                .get("auth_mode")
                .and_then(Value::as_str)
                .is_some_and(|mode| mode != "chatgpt")
        {
            return Err("Codex 当前未使用 ChatGPT 订阅登录，不能查询官方订阅额度".into());
        }
        let token = login
            .pointer(if codex {
                "/tokens/access_token"
            } else {
                "/claudeAiOauth/accessToken"
            })
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .ok_or("未找到官方订阅登录凭据，请在 CLI 中重新登录")?;
        request = client
            .get(if codex {
                "https://chatgpt.com/backend-api/wham/usage"
            } else {
                "https://api.anthropic.com/api/oauth/usage"
            })
            .bearer_auth(token);
        if codex {
            request = request.header("User-Agent", "codex-cli");
            if let Some(id) = login.pointer("/tokens/account_id").and_then(Value::as_str) {
                request = request.header("ChatGPT-Account-Id", id);
            }
        } else {
            request = request.header("anthropic-beta", "oauth-2025-04-20");
        }
    } else {
        let c = config.ok_or("请先配置额度查询")?;
        validate(c)?;
        let path = match mode {
            "deepseek" => "/user/balance",
            "siliconflow" => "/v1/user/info",
            "openrouter" => "/api/v1/key",
            "sub2api" | "generic" => "/v1/usage",
            "newapi" => "/api/user/self",
            _ => c.path.as_deref().unwrap_or(""),
        };
        let base = endpoint(
            c.base_url
                .as_deref()
                .filter(|s| !s.is_empty())
                .unwrap_or(&stored.config.endpoint),
        )?;
        let url = base.join(path).map_err(|_| "查询路径无效")?;
        if url.origin() != base.origin() {
            return Err("查询接口必须与模型服务同源".into());
        }
        request = if c.method.as_deref() == Some("POST") {
            client.post(url)
        } else {
            client.get(url)
        };
        if let Some(body) = c.body.as_ref().filter(|s| !s.is_empty()) {
            request = request.json(&serde_json::from_str::<Value>(body).map_err(|_| "请求体无效")?);
        }
        let auth = c.auth.as_deref().unwrap_or("bearer");
        if auth != "none" {
            if stored.quota_credential.is_none()
                && base.origin() != endpoint(&stored.config.endpoint)?.origin()
            {
                return Err("查询地址与模型服务不同，请为查询单独填写密钥".into());
            }
            let secret = credential(
                stored
                    .quota_credential
                    .as_deref()
                    .or(stored.credential.as_deref())
                    .ok_or("请先保存查询密钥或连接密钥")?,
            )?
            .get_password()
            .map_err(|_| "无法读取 API 密钥")?;
            request = if auth == "x-api-key" {
                request.header("x-api-key", secret)
            } else {
                request.bearer_auth(secret)
            };
        }
        if mode == "newapi" {
            request = request.header("New-Api-User", c.user_id.as_deref().unwrap_or(""));
        }
    }
    let mut response = request
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|_| "额度查询网络失败或超时")?;
    if !response.status().is_success() {
        return Err(format!(
            "额度查询失败（HTTP {}）；401/403 请重新登录或检查密钥，429 请稍后重试",
            response.status().as_u16()
        ));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "额度响应读取失败")? {
        if bytes.len() + chunk.len() > 1024 * 1024 {
            return Err("额度响应过大".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| "额度接口未返回有效 JSON")?;
    let items = parse(mode, &value, config)?;
    Ok(Quota {
        checked_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
        items,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn quota_windows_and_balances() {
        let newapi = parse(
            "newapi",
            &json!({"success":true,"data":{"quota":1000000,"used_quota":500000}}),
            None,
        )
        .unwrap();
        assert_eq!(newapi[0].remaining, Some(2.0));
        assert_eq!(newapi[0].total, Some(3.0));
        assert_eq!(
            parse("generic", &json!({"quota":{"remaining":12}}), None).unwrap()[0].remaining,
            Some(12.0)
        );
        let windows = parse(
            "codex",
            &json!({"rate_limit":{"primary_window":{"used_percent":25,"reset_at":1234}}}),
            None,
        )
        .unwrap();
        assert_eq!(windows[0].remaining, Some(75.0));
        assert_eq!(windows[0].resets_at.as_deref(), Some("1234"));
        assert_eq!(
            parse("claude", &json!({"five_hour":{"utilization":0}}), None).unwrap()[0].remaining,
            Some(100.0)
        );
        assert_eq!(
            parse(
                "siliconflow",
                &json!({"data":{"totalBalance":"12.5"}}),
                None
            )
            .unwrap()[0]
                .remaining,
            Some(12.5)
        );
        assert!(parse("sub2api", &json!({"error":"unauthorized"}), None).is_err());
    }
    #[test]
    fn custom_quota_validates_paths_and_maps_values() {
        let mut c: Config = serde_json::from_value(
            json!({"mode":"custom","path":"/balance","remainingPath":"/data/balance"}),
        )
        .unwrap();
        assert!(validate(&c).is_ok());
        assert_eq!(
            parse("custom", &json!({"data":{"balance":0}}), Some(&c)).unwrap()[0].remaining,
            Some(0.0)
        );
        c.path = Some("//evil.test".into());
        assert!(validate(&c).is_err());
        c.path = Some("/balance".into());
        c.body = Some("not json".into());
        assert!(validate(&c).is_err());
    }
}

#[tauri::command]
pub fn assistant_quota_save(
    app: tauri::AppHandle,
    connection_id: String,
    config: Config,
    key: Option<String>,
) -> Result<(), String> {
    valid_id(&connection_id)?;
    validate(&config)?;
    let _guard = CONNECTION_LOCK.lock().map_err(|_| "连接配置正忙")?;
    let directory = assistant_dir(&app)?;
    let mut connections = read_connections(&directory)?;
    let stored = connections
        .iter_mut()
        .find(|s| s.config.id == connection_id)
        .ok_or("连接已移除")?;
    if config.mode == "official" && stored.config.kind == crate::assistant_cli::Kind::Api {
        return Err("官方订阅模板仅用于 CLI 连接".into());
    }
    let previous = stored.quota_credential.clone();
    let old_url = stored
        .config
        .quota
        .as_ref()
        .and_then(|c| c.base_url.as_deref())
        .filter(|s| !s.is_empty())
        .unwrap_or(&stored.config.endpoint);
    let new_url = config
        .base_url
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(&stored.config.endpoint);
    if previous.is_some() && key.is_none() && old_url != new_url {
        return Err("查询地址已变化，请重新填写查询密钥或清除原密钥".into());
    }
    if key
        .as_ref()
        .is_some_and(|s| s.len() > 2000 || s.contains(['\r', '\n']))
    {
        return Err("查询密钥格式无效".into());
    }
    let new_id = key
        .as_ref()
        .filter(|s| !s.is_empty())
        .map(|_| uuid::Uuid::new_v4().to_string());
    if let (Some(id), Some(secret)) = (&new_id, &key) {
        credential(id)?
            .set_password(secret)
            .map_err(|_| "无法保存查询密钥")?;
    }
    if key.is_some() {
        stored.quota_credential = new_id.clone();
    }
    stored.config.quota = Some(config);
    if let Err(error) = atomic_json(&directory.join("connections.json"), &connections) {
        if let Some(id) = &new_id {
            let _ = credential(id)?.delete_credential();
        }
        return Err(error);
    }
    if key.is_some() {
        if let Some(id) = previous {
            let _ = credential(&id)?.delete_credential();
        }
    }
    Ok(())
}
