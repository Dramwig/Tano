//! Desktop provider for the shared service-connection API. No secret-read IPC exists.
use super::{
    plugin_connection_types as types,
    plugin_connection_vault::{Store, SystemVault, STATE_LOCK},
    plugin_native::{PluginCall, PluginNativeState},
};
use serde_json::Value;
use std::{path::PathBuf, time::Duration};
use tauri::{Manager, WebviewWindow};

pub(crate) fn scope(
    app: &tauri::AppHandle,
    session: &crate::Session,
) -> Result<(PathBuf, SystemVault), String> {
    let directory = crate::app_data(app)?;
    let key = crate::storage::hash(format!("{}\n{}", session.id, session.root_key).as_bytes());
    let service = format!(
        "Tano.Plugins.{}",
        crate::storage::hash(directory.to_string_lossy().as_bytes())
    );
    Ok((
        directory
            .join("plugin-connections")
            .join(format!("{key}.tano.json")),
        SystemVault { service },
    ))
}
fn call(
    app: &tauri::AppHandle,
    window: &WebviewWindow,
    request_id: &str,
    workspace: &str,
) -> Result<PluginCall, String> {
    uuid::Uuid::parse_str(workspace).map_err(|_| "工作区标识无效")?;
    app.state::<PluginNativeState>()
        .begin_control(window.label(), request_id)
}
pub(crate) fn policy(session: &crate::Session, config: &types::Config) -> Result<String, String> {
    super::plugin_native::policy_for(
        &session.root,
        &config.plugin_id,
        &config.integrity,
        "connections",
        "networkOrigins",
        &config.origin,
    )
}
#[tauri::command]
pub async fn plugin_connections_list(
    app: tauri::AppHandle,
    window: WebviewWindow,
    request_id: String,
    workspace_id: String,
) -> Result<Vec<types::Connection>, String> {
    let call = call(&app, &window, &request_id, &workspace_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::with_workspace_session(&workspace_id, app.state(), |session| {
            let _guard = STATE_LOCK.lock().map_err(|_| "连接服务正忙")?;
            call.check()?;
            let (path, vault) = scope(&app, session)?;
            let mut store = Store::open(&path)?;
            store.cleanup(&vault)?;
            call.check()?;
            Ok(store.list())
        })
    })
    .await
    .map_err(|_| "读取连接失败")?
}
#[tauri::command]
pub async fn plugin_connections_save(
    app: tauri::AppHandle,
    window: WebviewWindow,
    request_id: String,
    workspace_id: String,
    input: Value,
) -> Result<types::Connection, String> {
    let input = types::input(input)?;
    let call = call(&app, &window, &request_id, &workspace_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::with_workspace_session(&workspace_id, app.state(), |session| {
            let _guard = STATE_LOCK.lock().map_err(|_| "连接服务正忙")?;
            call.check()?;
            let initial = policy(session, &input.config)?;
            let config = input.config.clone();
            let (path, vault) = scope(&app, session)?;
            Store::open(&path)?.save(input, &vault, || {
                call.check()?;
                if crate::storage::native_key(&session.root) != session.root_key {
                    return Err("工作区根目录已替换，请重新打开".into());
                }
                crate::identity_manifest::require(&session.root, &session.id)?;
                if policy(session, &config)? != initial {
                    return Err("插件规则已变化，请重新授权连接".into());
                }
                Ok(())
            })
        })
    })
    .await
    .map_err(|_| "保存连接失败")?
}
#[tauri::command]
pub async fn plugin_connections_remove(
    app: tauri::AppHandle,
    window: WebviewWindow,
    request_id: String,
    workspace_id: String,
    plugin_id: String,
    origin: String,
    version: String,
) -> Result<(), String> {
    if !types::valid_id(&plugin_id) || uuid::Uuid::parse_str(&version).is_err() {
        return Err("连接标识无效".into());
    }
    types::origin(&origin)?;
    let call = call(&app, &window, &request_id, &workspace_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::with_workspace_session(&workspace_id, app.state(), |session| {
            let _guard = STATE_LOCK.lock().map_err(|_| "连接服务正忙")?;
            call.check()?;
            let (path, vault) = scope(&app, session)?;
            Store::open(&path)?.remove(&plugin_id, &origin, &version, &vault)
        })
    })
    .await
    .map_err(|_| "撤销连接失败")?
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProxyInput {
    request_id: String,
    workspace_id: String,
    plugin_id: String,
    integrity: String,
    origin: String,
    request: types::Request,
}
enum SavedCredential {
    Key(String),
    OAuth(super::plugin_oauth_types::Grant),
}
#[tauri::command]
pub async fn plugin_connections_request(
    app: tauri::AppHandle,
    window: WebviewWindow,
    mut input: ProxyInput,
) -> Result<super::plugin_connection_http::Response, String> {
    if !types::valid_id(&input.plugin_id) || !types::valid_hash(&input.integrity) {
        return Err("插件连接请求无效".into());
    }
    types::origin(&input.origin)?;
    uuid::Uuid::parse_str(&input.workspace_id).map_err(|_| "工作区标识无效")?;
    let call = app
        .state::<PluginNativeState>()
        .begin(window.label(), &input.request_id)?;
    Box::pin(async {
        let app_read = app.clone(); let workspace = input.workspace_id.clone();
        let plugin = input.plugin_id.clone(); let origin = input.origin.clone(); let integrity = input.integrity.clone();
        let stopped = call.stopped.clone();
        let initial = tauri::async_runtime::spawn_blocking(move || crate::with_workspace_session(&workspace, app_read.state(), |session| {
            let _guard = STATE_LOCK.lock().map_err(|_| "连接服务正忙")?;
            if stopped.load(std::sync::atomic::Ordering::SeqCst) { return Err("插件请求已取消".into()); }
            let (path, vault) = scope(&app_read, session)?;
            let record = Store::open(&path)?.find(&plugin, &origin).ok_or("请先在插件中心配置服务连接")?;
            if record.connection.config.integrity != integrity { return Err("插件版本已变化，请重新授权服务连接".into()); }
            let policy_hash = policy(session, &record.connection.config)?;
            let secret = if record.connection.oauth.is_some() { SavedCredential::OAuth(Store::grant(&record, &vault)?) }
                else { SavedCredential::Key(Store::secret(&record, &vault)?) };
            Ok((session.root_key.clone(), policy_hash, record.connection.clone(), secret, record))
        })).await.map_err(|_| "读取系统凭据失败")??;
        input.request.validate(&initial.2.config)?;
        let check = || -> Result<(), String> {
            call.check()?;
            crate::with_workspace_session(&input.workspace_id, app.state(), |session| {
                let _guard = STATE_LOCK.lock().map_err(|_| "连接服务正忙")?;
                if session.root_key != initial.0 || policy(session, &initial.2.config)? != initial.1 { return Err("工作区或插件规则已变化，请重新请求".into()); }
                let (path, _) = scope(&app, session)?;
                if Store::open(&path)?.find(&input.plugin_id, &input.origin).is_none_or(|record| record.connection.version != initial.2.version) { return Err("连接已撤销或更新，请重新请求".into()); }
                Ok(())
            })
        };
        let operation = async {
            let secret = match &initial.3 {
                SavedCredential::Key(secret) => secret.clone(),
                SavedCredential::OAuth(grant) => super::plugin_oauth::access_token(&app, &input.workspace_id, &initial.4, grant.clone(), call.stopped.clone(), &check).await?,
            };
            let client = super::plugin_connection_http::prepare(&initial.2.config).await?;
            check()?;
            super::plugin_connection_http::send(client, &initial.2.config, &secret, &input.request).await
        };
        let mut operation = Box::pin(operation);
        let mut ticker = tokio::time::interval(Duration::from_millis(200));
        let timeout = tokio::time::sleep(Duration::from_secs(15)); tokio::pin!(timeout);
        loop {
            tokio::select! {
                result = &mut operation => { let result = result?; check()?; return Ok(result); },
                _ = ticker.tick() => check()?,
                _ = &mut timeout => return Err("插件服务请求超时；已发送的写入可能已生效，请先核对结果".into()),
            }
        }
    }).await
}
