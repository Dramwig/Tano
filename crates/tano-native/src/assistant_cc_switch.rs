//! Read-only CC Switch discovery. Secrets never cross the webview boundary.
use super::*;
use rusqlite::{Connection as Database, OpenFlags};
use sha2::{Digest, Sha256};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    id: String,
    name: String,
    source: String,
    endpoint: String,
    reason: Option<String>,
}

struct Provider {
    summary: Candidate,
    config: Option<Connection>,
    key: Option<String>,
}

fn parse(app: String, id: String, name: String, raw: String) -> Provider {
    // The identity also fingerprints the configuration: changed selections must be rescanned.
    let digest = Sha256::digest(format!("cc-switch\0{app}\0{id}\0{raw}"));
    let id = uuid::Uuid::from_bytes(digest[..16].try_into().unwrap()).to_string();
    let mut result = Provider {
        summary: Candidate {
            id: id.clone(),
            name: name.clone(),
            source: app.clone(),
            endpoint: String::new(),
            reason: None,
        },
        config: None,
        key: None,
    };
    let parsed = (|| -> Result<(String, Protocol, Option<String>), String> {
        let value: Value = serde_json::from_str(&raw).map_err(|_| "提供商配置损坏")?;
        let text = |v: &Value| {
            v.as_str()
                .filter(|s| !s.trim().is_empty())
                .map(str::to_owned)
        };
        if app == "codex" {
            let config: toml::Value = toml::from_str(value["config"].as_str().unwrap_or(""))
                .map_err(|_| "Codex 配置格式无效")?;
            let selected = config
                .get("model_provider")
                .and_then(toml::Value::as_str)
                .unwrap_or("openai");
            let provider = config.get("model_providers").and_then(|v| v.get(selected));
            let endpoint = provider
                .and_then(|v| v.get("base_url"))
                .and_then(toml::Value::as_str)
                .or_else(|| (selected == "openai").then_some("https://api.openai.com/v1"))
                .ok_or("缺少服务地址")?
                .to_string();
            let protocol = match provider
                .and_then(|v| v.get("wire_api"))
                .and_then(toml::Value::as_str)
                .unwrap_or("responses")
            {
                "responses" => Protocol::Responses,
                "chat" => Protocol::ChatCompletions,
                _ => return Err("暂不支持此接口协议".into()),
            };
            Ok((endpoint, protocol, text(&value["auth"]["OPENAI_API_KEY"])))
        } else if matches!(app.as_str(), "opencode" | "openclaw") {
            let npm = value["npm"].as_str().unwrap_or("");
            let api = value["api"].as_str().unwrap_or("");
            if !matches!(npm, "@ai-sdk/openai" | "@ai-sdk/openai-compatible")
                && !matches!(api, "openai-completions" | "openai-responses")
            {
                return Err("暂不支持此接口协议".into());
            }
            Ok((
                text(&value["options"]["baseURL"])
                    .or_else(|| text(&value["baseUrl"]))
                    .ok_or("缺少服务地址")?,
                if api == "openai-responses" {
                    Protocol::Responses
                } else {
                    Protocol::ChatCompletions
                },
                text(&value["options"]["apiKey"]).or_else(|| text(&value["apiKey"])),
            ))
        } else {
            result.summary.endpoint = text(&value["env"]["ANTHROPIC_BASE_URL"])
                .or_else(|| text(&value["env"]["GOOGLE_GEMINI_BASE_URL"]))
                .unwrap_or_default();
            Err("此提供商协议暂不支持直接导入，请使用对应 CLI 连接".into())
        }
    })();
    match parsed {
        Ok((endpoint, protocol, key)) => {
            result.summary.endpoint = endpoint.clone();
            let config = Connection {
                id,
                name,
                icon: None,
                quota: None,
                kind: crate::assistant_cli::Kind::Api,
                cli_path: String::new(),
                reasoning_effort: None,
                endpoint,
                protocol,
                auto_adapt: true,
                _legacy_model: None,
                tools: true,
                max_output_tokens: 4096,
                has_key: key.is_some(),
            };
            result.summary.reason = validate_connection(&config).err().or_else(|| {
                if key.as_ref().is_some_and(|s| {
                    s.len() > 2000
                        || s.contains(['\r', '\n'])
                        || s.starts_with('{')
                        || s.starts_with('$')
                }) {
                    Some("密钥格式无效或使用了变量引用".into())
                } else if key.is_none() && config.endpoint.starts_with("https:") {
                    Some("缺少 API 密钥；登录授权不能作为 API 密钥导入".into())
                } else {
                    None
                }
            });
            result.config = Some(config);
            result.key = key;
        }
        Err(reason) => result.summary.reason = Some(reason),
    }
    // Never display credentials embedded in an invalid URL.
    if !result.summary.endpoint.is_empty() && endpoint(&result.summary.endpoint).is_err() {
        result.summary.endpoint.clear();
    }
    result
}

fn read(path: Option<String>) -> Result<Vec<Provider>, String> {
    let path = match path {
        Some(path) => PathBuf::from(path),
        None => std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
            .map(PathBuf::from)
            .ok_or("无法定位用户目录")?
            .join(".cc-switch/cc-switch.db"),
    };
    if !path.is_file() {
        return Err("未找到 CC Switch 数据库，请选择 cc-switch.db".into());
    }
    let db = Database::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| "无法读取 CC Switch 数据库")?;
    db.busy_timeout(Duration::from_secs(3))
        .map_err(|_| "无法读取 CC Switch 数据库")?;
    let mut statement = db
        .prepare(
            "SELECT app_type, id, name, settings_config FROM providers ORDER BY app_type, name",
        )
        .map_err(|_| "CC Switch 数据库格式不受支持")?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|_| "无法读取 CC Switch 提供商")?;
    rows.map(|row| {
        row.map(|(app, id, name, raw)| parse(app, id, name, raw))
            .map_err(|_| "无法读取 CC Switch 提供商".into())
    })
    .collect()
}

#[tauri::command]
pub fn assistant_cc_switch_scan(
    app: tauri::AppHandle,
    path: Option<String>,
) -> Result<Vec<Candidate>, String> {
    let providers = read(path)?;
    let _guard = CONNECTION_LOCK.lock().map_err(|_| "模型连接正忙")?;
    let existing = read_connections(&assistant_dir(&app)?)?;
    Ok(providers
        .into_iter()
        .map(|mut p| {
            if existing.iter().any(|c| c.config.id == p.summary.id) {
                p.summary.reason = Some("已导入".into());
            }
            p.summary
        })
        .collect())
}

#[tauri::command]
pub fn assistant_cc_switch_import(
    app: tauri::AppHandle,
    path: Option<String>,
    ids: Vec<String>,
) -> Result<(), String> {
    if ids.is_empty() || ids.len() > 20 {
        return Err("请选择 1 至 20 个提供商".into());
    }
    let providers = read(path)?;
    let _guard = CONNECTION_LOCK.lock().map_err(|_| "模型连接正忙")?;
    let directory = assistant_dir(&app)?;
    let mut connections = read_connections(&directory)?;
    let mut selected = Vec::new();
    for id in &ids {
        if selected.iter().any(|p: &&Provider| p.summary.id == *id) {
            continue;
        }
        let provider = providers
            .iter()
            .find(|p| p.summary.id == *id)
            .ok_or("CC Switch 配置已变化，请重新扫描")?;
        if provider.summary.reason.is_some() {
            return Err("所选提供商无法导入，请重新扫描".into());
        }
        if !connections.iter().any(|c| c.config.id == *id) {
            selected.push(provider);
        }
    }
    if connections.len() + selected.len() > 20 {
        return Err("最多保存 20 个模型连接，请减少选择或移除已有连接".into());
    }
    let mut created = Vec::new();
    let result = (|| {
        for provider in selected {
            let credential_id = if let Some(key) = &provider.key {
                let id = uuid::Uuid::new_v4().to_string();
                credential(&id)?
                    .set_password(key)
                    .map_err(|_| "无法将 API 密钥存入系统凭据库")?;
                created.push(id.clone());
                Some(id)
            } else {
                None
            };
            connections.push(StoredConnection {
                config: provider.config.clone().ok_or("提供商配置无效")?,
                credential: credential_id,
                quota_credential: None,
            });
        }
        atomic_json(&directory.join("connections.json"), &connections)
    })();
    if result.is_err() {
        for id in created {
            if let Ok(entry) = credential(&id) {
                let _ = entry.delete_credential();
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_codex_without_exposing_secrets() {
        let raw = json!({"auth":{"OPENAI_API_KEY":"secret"},"config":"model_provider = 'custom'\n[model_providers.custom]\nbase_url = 'https://example.com/v1'\nwire_api = 'responses'"}).to_string();
        let p = parse("codex".into(), "id".into(), "Test".into(), raw.clone());
        assert!(p.summary.reason.is_none(), "{:?}", p.summary.reason);
        assert_eq!(p.config.unwrap().protocol, Protocol::Responses);
        assert!(!serde_json::to_string(&p.summary)
            .unwrap()
            .contains("secret"));
        assert_eq!(
            p.summary.id,
            parse("codex".into(), "id".into(), "Test".into(), raw)
                .summary
                .id
        );
    }
    #[test]
    fn retains_unsupported_missing_key_and_broken_records() {
        for (app, raw) in [
            ("claude", "{}"),
            ("gemini", "{}"),
            ("codex", "{}"),
            ("codex", "bad"),
        ] {
            assert!(parse(app.into(), "id".into(), "Test".into(), raw.into())
                .summary
                .reason
                .is_some());
        }
    }
    #[test]
    fn reads_every_provider_without_modifying_database() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cc-switch.db");
        let db = Database::open(&path).unwrap();
        db.execute_batch("CREATE TABLE providers (app_type TEXT,id TEXT,name TEXT,settings_config TEXT); INSERT INTO providers VALUES ('claude','1','A','{}'),('codex','2','B','broken');").unwrap();
        drop(db);
        let before = std::fs::read(&path).unwrap();
        assert_eq!(read(Some(path.to_string_lossy().into())).unwrap().len(), 2);
        assert_eq!(before, std::fs::read(path).unwrap());
    }
}
