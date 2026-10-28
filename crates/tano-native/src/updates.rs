//! The webview never supplies update URLs, keys, signatures, or installer bytes.
//! Candidates and verified downloads remain in native memory until explicit install.
use serde::Serialize;
use tauri::{ipc::Channel, AppHandle, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    current_version: String,
    configured: bool,
    reason: Option<String>,
    download_url: &'static str,
    manual: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    id: String,
    version: String,
    notes: String,
    manual_url: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    downloaded: u64,
    total: Option<u64>,
}

#[derive(Default)]
pub struct UpdateState {
    #[cfg(desktop)]
    pending: tauri::async_runtime::Mutex<Option<Pending>>,
}

#[cfg(desktop)]
struct Pending {
    id: String,
    update: tauri_plugin_updater::Update,
    verified: Option<Vec<u8>>,
}

#[cfg(desktop)]
fn https_url(value: &str) -> Result<tauri::Url, String> {
    let url: tauri::Url = value.parse().map_err(|_| "更新源地址无效")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("更新源必须使用 HTTPS，且不能包含凭据、查询参数或片段".into());
    }
    Ok(url)
}

#[cfg(desktop)]
struct Configuration {
    endpoint: tauri::Url,
    key: &'static str,
    certificate: Option<reqwest::Certificate>,
}

#[cfg(desktop)]
fn configuration() -> Result<Configuration, String> {
    let endpoint = option_env!("TANO_UPDATER_URL").unwrap_or("").trim();
    let key = option_env!("TANO_UPDATER_PUBLIC_KEY").unwrap_or("").trim();
    if endpoint.is_empty() || key.is_empty() {
        return Err("此安装包未配置更新源，请从发布者获取新版安装包。".into());
    }
    let certificate = option_env!("TANO_UPDATER_CA_PEM")
        .filter(|value| !value.trim().is_empty())
        .map(|value| {
            reqwest::Certificate::from_pem(value.as_bytes())
                .map_err(|_| "安装包中的更新 CA 证书无效".to_string())
        })
        .transpose()?;
    Ok(Configuration {
        endpoint: https_url(endpoint)?,
        key,
        certificate,
    })
}

#[tauri::command]
pub fn update_status(app: AppHandle) -> Status {
    #[cfg(desktop)]
    let reason = configuration().err();
    #[cfg(mobile)]
    let reason = Some("移动端请通过原安装渠道更新。".into());
    let manual = cfg!(desktop) && app.config().identifier == "app.tano.local" && reason.is_some();
    Status {
        current_version: app.package_info().version.to_string(),
        configured: reason.is_none(),
        reason,
        manual,
        download_url: if app.config().identifier == "app.tano.local" {
            "https://tano.page/zh-cn/download/#local"
        } else {
            "https://tano.page/zh-cn/download/"
        },
    }
}

#[cfg(desktop)]
fn local_announcement(
    value: &serde_json::Value,
    current: [u64; 3],
) -> Result<Option<Candidate>, String> {
    let invalid = "Tano Local 版本公告尚未提供或无效，请前往官网查看发布状态";
    let version = value["version"].as_str().ok_or(invalid)?;
    let parts: Vec<_> = version.split('.').collect();
    if parts.len() != 3
        || parts.iter().any(|part| {
            part.is_empty()
                || (part.len() > 1 && part.starts_with('0'))
                || !part.bytes().all(|c| c.is_ascii_digit())
        })
    {
        return Err(invalid.into());
    }
    let numbers = parts
        .iter()
        .map(|part| part.parse::<u64>().map_err(|_| invalid))
        .collect::<Result<Vec<_>, _>>()?;
    let tag = format!("core-v{version}");
    let base = format!("https://github.com/Dramwig/Tano/releases/download/{tag}/");
    let commit = value["sourceCommit"].as_str().unwrap_or("");
    let certificate = value["certificateThumbprint"].as_str().unwrap_or("");
    let unsigned_preview = value["preview"] == true
        && value["authenticode"] == "unsigned"
        && value["certificateThumbprint"].is_null();
    if value["format"] != 1
        || value["edition"] != "local"
        || value["automaticUpdates"] != false
        || value["tag"] != tag
        || value["windowsUrl"] != format!("{base}Tano-Local_{version}_x64-setup.exe")
        || value["checksumsUrl"] != format!("{base}SHA256SUMS.txt")
        || value["provenanceUrl"] != format!("{base}local-provenance.jsonl")
        || value["sourceUrl"] != format!("https://github.com/Dramwig/Tano/tree/{tag}")
        || commit.len() != 40
        || !commit
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        || (!unsigned_preview
            && (certificate.len() != 40
                || !certificate
                    .bytes()
                    .all(|c| c.is_ascii_digit() || (b'A'..=b'F').contains(&c))))
    {
        return Err(invalid.into());
    }
    if numbers.as_slice() <= current.as_slice() {
        return Ok(None);
    }
    Ok(Some(Candidate {
        id: tag.clone(),
        version: version.into(),
        notes: "Tano Local 新版已发布，请查看公开发行版并手动下载安装。".into(),
        manual_url: Some(format!(
            "https://github.com/Dramwig/Tano/releases/tag/{tag}"
        )),
    }))
}

#[cfg(desktop)]
async fn check_local_announcement(app: &AppHandle) -> Result<Option<Candidate>, String> {
    let response = reqwest::Client::builder()
        .https_only(true)
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?
        .get("https://tano.page/releases/local.json")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > 64 * 1024 {
        return Err("Tano Local 版本公告过大".into());
    }
    let value = serde_json::from_slice(&bytes)
        .map_err(|_| "Tano Local 版本公告无效，请前往官网查看发布状态")?;
    let version = &app.package_info().version;
    local_announcement(&value, [version.major, version.minor, version.patch])
}

#[tauri::command]
pub async fn update_check(
    app: AppHandle,
    state: State<'_, UpdateState>,
) -> Result<Option<Candidate>, String> {
    #[cfg(desktop)]
    {
        use std::time::Duration;
        use tauri_plugin_updater::UpdaterExt;
        if app.config().identifier == "app.tano.local" && configuration().is_err() {
            *state.pending.lock().await = None;
            // Announcement only: no updater candidate or installer bytes enter
            // native state, even after a newer Local release is discovered.
            return check_local_announcement(&app).await;
        }
        let Configuration {
            endpoint,
            key,
            certificate,
        } = configuration()?;
        let mut pending = state.pending.lock().await;
        *pending = None;
        let update = app
            .updater_builder()
            .pubkey(key)
            .endpoints(vec![endpoint])
            .map_err(|e| e.to_string())?
            .timeout(Duration::from_secs(120))
            // This also rejects an HTTP redirect from an otherwise HTTPS feed.
            .configure_client(move |client| {
                let client = client.https_only(true);
                // Private self-hosted deployments may pin their own CA at build
                // time. This replaces roots; certificate and hostname checks
                // remain enabled. No user document or IPC can change trust.
                match &certificate {
                    Some(certificate) => client.tls_certs_only([certificate.clone()]),
                    None => client,
                }
            })
            // Ignore allowDowngrades even if a custom build changes plugin config.
            .version_comparator(|current, release| release.version > current)
            .build()
            .map_err(|e| e.to_string())?
            .check()
            .await
            .map_err(|e| e.to_string())?;
        let Some(update) = update else {
            return Ok(None);
        };
        https_url(update.download_url.as_str())?;
        let candidate = Candidate {
            id: uuid::Uuid::new_v4().to_string(),
            version: update.version.clone(),
            notes: update.body.clone().unwrap_or_default(),
            manual_url: None,
        };
        *pending = Some(Pending {
            id: candidate.id.clone(),
            update,
            verified: None,
        });
        Ok(Some(candidate))
    }
    #[cfg(mobile)]
    {
        let _ = (app, state);
        Err("移动端请通过原安装渠道更新。".into())
    }
}

#[tauri::command]
pub async fn update_download(
    id: String,
    progress: Channel<Progress>,
    state: State<'_, UpdateState>,
) -> Result<(), String> {
    #[cfg(desktop)]
    {
        let mut pending = state.pending.lock().await;
        let item = pending
            .as_mut()
            .filter(|item| item.id == id)
            .ok_or("更新预览已失效，请重新检查更新")?;
        item.verified = None;
        let mut downloaded = 0;
        // download() verifies both the Minisign bytes and its signed version.
        let bytes = item
            .update
            .download(
                |size, total| {
                    downloaded += size as u64;
                    let _ = progress.send(Progress { downloaded, total });
                },
                || {},
            )
            .await
            .map_err(|e| e.to_string())?;
        item.verified = Some(bytes);
        Ok(())
    }
    #[cfg(mobile)]
    {
        let _ = (id, progress, state);
        Err("移动端不支持桌面安装包。".into())
    }
}

#[tauri::command]
pub async fn update_install(
    id: String,
    app: AppHandle,
    state: State<'_, UpdateState>,
) -> Result<(), String> {
    #[cfg(desktop)]
    {
        let mut pending = state.pending.lock().await;
        let item = pending
            .as_ref()
            .filter(|item| item.id == id)
            .ok_or("更新预览已失效，请重新检查更新")?;
        if item.verified.is_none() {
            return Err("请先下载并验证更新包".into());
        }
        let item = pending.take().expect("checked candidate");
        // Keep only one candidate and consume its verified bytes once. No IPC
        // accepts caller-supplied paths or bytes for the installer.
        tauri::async_runtime::spawn_blocking(move || item.update.install(item.verified.unwrap()))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
        // Windows' updater exits after starting NSIS. Unix installs return.
        app.restart();
    }
    #[cfg(mobile)]
    {
        let _ = (id, app, state);
        Err("移动端不支持桌面安装包。".into())
    }
}

#[cfg(all(test, desktop))]
mod tests {
    use super::*;
    #[test]
    fn local_announcements_accept_only_stable_core_assets_and_never_install() {
        let base = "https://github.com/Dramwig/Tano/releases/download/core-v1.10.0/";
        let value = serde_json::json!({ "format": 1, "edition": "local", "automaticUpdates": false,
            "version": "1.10.0", "tag": "core-v1.10.0", "sourceCommit": "a".repeat(40), "certificateThumbprint": "A".repeat(40),
            "windowsUrl": format!("{base}Tano-Local_1.10.0_x64-setup.exe"), "checksumsUrl": format!("{base}SHA256SUMS.txt"),
            "provenanceUrl": format!("{base}local-provenance.jsonl"), "sourceUrl": "https://github.com/Dramwig/Tano/tree/core-v1.10.0" });
        let candidate = local_announcement(&value, [1, 9, 0]).unwrap().unwrap();
        assert_eq!(
            candidate.manual_url.unwrap(),
            "https://github.com/Dramwig/Tano/releases/tag/core-v1.10.0"
        );
        assert!(local_announcement(&value, [1, 10, 0]).unwrap().is_none());
        assert!(local_announcement(&value, [2, 0, 0]).unwrap().is_none());
        for (key, replacement) in [
            ("version", serde_json::json!("1.10.0-beta")),
            ("tag", serde_json::json!("v1.10.0")),
            ("edition", serde_json::json!("product")),
            (
                "windowsUrl",
                serde_json::json!("https://example.com/setup.exe"),
            ),
            ("certificateThumbprint", serde_json::Value::Null),
            ("automaticUpdates", serde_json::json!(true)),
        ] {
            let mut invalid = value.clone();
            invalid[key] = replacement;
            assert!(local_announcement(&invalid, [1, 9, 0]).is_err());
        }
        assert!(local_announcement(&serde_json::Value::Null, [1, 9, 0]).is_err());
    }
    #[test]
    fn endpoints_cannot_override_trust_or_use_cleartext() {
        for url in [
            "http://localhost/update.json",
            "https://user:token@example.com/update.json",
            "https://example.com/update.json?token=x",
            "https://example.com/#fragment",
            "file:///tmp/update.json",
        ] {
            assert!(https_url(url).is_err(), "{url}");
        }
        assert!(https_url("https://example.com/releases/latest.json").is_ok());
    }
}
