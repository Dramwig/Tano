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
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    id: String,
    version: String,
    notes: String,
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
    Status {
        current_version: app.package_info().version.to_string(),
        configured: reason.is_none(),
        reason,
    }
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
