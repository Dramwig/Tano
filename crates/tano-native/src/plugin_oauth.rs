use super::{
    plugin_connection_http as http, plugin_connection_types as types,
    plugin_connection_vault::{Record, Store, STATE_LOCK},
    plugin_connections::{policy, scope},
    plugin_native::{PluginCall, PluginNativeState},
    plugin_oauth_loopback as loopback,
    plugin_oauth_types::{self as oauth, Grant, Provider, Providers},
};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicU8, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{Manager, WebviewWindow};

const PENDING: u8 = 0;
const EXCHANGING: u8 = 1;
const COMPLETED: u8 = 2;
const CANCELLED: u8 = 3;
const FAILED: u8 = 4;
const EXPIRED: u8 = 5;
#[derive(Default)]
pub struct PluginOAuthState {
    flows: Mutex<HashMap<String, Flow>>,
}
struct Flow {
    window: String,
    workspace: String,
    expires: u64,
    status: Arc<AtomicU8>,
    stopped: Arc<AtomicBool>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Started {
    id: String,
    authorization_url: String,
    expires_at: String,
}
#[derive(Serialize)]
pub struct Status {
    status: &'static str,
}
fn status(value: u8) -> &'static str {
    match value {
        PENDING => "pending",
        EXCHANGING => "exchanging",
        COMPLETED => "completed",
        CANCELLED => "cancelled",
        EXPIRED => "expired",
        _ => "failed",
    }
}
fn valid_flow_id(id: &str) -> Result<(), String> {
    if id.len() == 43
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        Ok(())
    } else {
        Err("账号授权标识无效".into())
    }
}
pub fn providers(app: &tauri::AppHandle) -> Result<Vec<Provider>, String> {
    let path = crate::app_data(app)?.join("plugin-oauth-clients.tano.json");
    if !path.try_exists().map_err(|_| "无法读取本机 OAuth 配置")? {
        return Ok(vec![]);
    }
    Ok(Providers::parse(&crate::plugin_git::read_bounded(&path, 64 * 1024)?)?.providers)
}
fn provider(
    app: &tauri::AppHandle,
    id: &str,
    fingerprint: Option<&str>,
) -> Result<Provider, String> {
    let provider = providers(app)?
        .into_iter()
        .find(|value| value.id == id)
        .ok_or("此设备未登记该 OAuth 客户端")?;
    if fingerprint.is_some_and(|expected| provider.fingerprint() != expected) {
        return Err("本机 OAuth 客户端配置已变化，请重新登录授权".into());
    }
    Ok(provider)
}
fn begin(
    app: &tauri::AppHandle,
    window: &WebviewWindow,
    workspace: &str,
    request: &str,
) -> Result<PluginCall, String> {
    uuid::Uuid::parse_str(workspace).map_err(|_| "工作区标识无效")?;
    app.state::<PluginNativeState>()
        .begin_control(window.label(), request)
}
#[tauri::command]
pub async fn plugin_connections_oauth_providers(
    app: tauri::AppHandle,
    window: WebviewWindow,
    workspace_id: String,
    request_id: String,
) -> Result<Vec<Value>, String> {
    let call = begin(&app, &window, &workspace_id, &request_id)?;
    crate::with_workspace_session(&workspace_id, app.state(), |_| {
        call.check()?;
        Ok(providers(&app)?.iter().map(Provider::metadata).collect())
    })
}
#[tauri::command]
pub async fn plugin_connections_oauth_status(
    app: tauri::AppHandle,
    window: WebviewWindow,
    workspace_id: String,
    flow_id: String,
    request_id: String,
) -> Result<Status, String> {
    valid_flow_id(&flow_id)?;
    let call = begin(&app, &window, &workspace_id, &request_id)?;
    call.check()?;
    let state = app.state::<PluginOAuthState>();
    let flows = state.flows.lock().map_err(|_| "账号连接正忙")?;
    let flow = flows
        .get(&flow_id)
        .filter(|flow| flow.window == window.label() && flow.workspace == workspace_id)
        .ok_or("授权已过期或不可用")?;
    let value = flow.status.load(Ordering::SeqCst);
    Ok(Status {
        status: status(if value <= EXCHANGING && flow.expires <= oauth::now()? {
            EXPIRED
        } else {
            value
        }),
    })
}
#[tauri::command]
pub async fn plugin_connections_oauth_cancel(
    app: tauri::AppHandle,
    window: WebviewWindow,
    workspace_id: String,
    flow_id: String,
    request_id: String,
) -> Result<(), String> {
    valid_flow_id(&flow_id)?;
    let call = begin(&app, &window, &workspace_id, &request_id)?;
    call.check()?;
    let state = app.state::<PluginOAuthState>();
    let flows = state.flows.lock().map_err(|_| "账号连接正忙")?;
    // Cancellation remains possible after switching away from the original workspace.
    if let Some(flow) = flows
        .get(&flow_id)
        .filter(|flow| flow.window == window.label() && flow.workspace == workspace_id)
    {
        if flow.status.load(Ordering::SeqCst) <= EXCHANGING {
            flow.stopped.store(true, Ordering::SeqCst);
            flow.status.store(CANCELLED, Ordering::SeqCst);
        }
    }
    Ok(())
}
#[derive(Clone)]
struct Binding {
    workspace: String,
    expires: u64,
    root: String,
    policy: String,
    config: types::Config,
    version: Option<String>,
    provider: Provider,
}
impl Binding {
    fn check_session(
        &self,
        app: &tauri::AppHandle,
        session: &crate::Session,
    ) -> Result<(), String> {
        if oauth::now()? >= self.expires {
            return Err("账号授权已过期，请重新连接".into());
        }
        if session.root_key != self.root || crate::storage::native_key(&session.root) != self.root {
            return Err("工作区已切换或被替换".into());
        }
        crate::identity_manifest::require(&session.root, &session.id)?;
        if policy(session, &self.config)? != self.policy {
            return Err("插件规则已变化，请重新连接".into());
        }
        provider(app, &self.provider.id, Some(&self.provider.fingerprint()))?;
        let (path, _) = scope(app, session)?;
        if Store::open(&path)?
            .find(&self.config.plugin_id, &self.config.origin)
            .as_ref()
            .map(|record| &record.connection.version)
            != self.version.as_ref()
        {
            return Err("服务连接已变化，请重新连接".into());
        }
        Ok(())
    }
    fn check(&self, app: &tauri::AppHandle, call: &PluginCall) -> Result<(), String> {
        call.check()?;
        crate::with_workspace_session(&self.workspace, app.state(), |session| {
            let _guard = STATE_LOCK.lock().map_err(|_| "连接服务正忙")?;
            self.check_session(app, session)
        })
    }
}
#[tauri::command]
pub async fn plugin_connections_oauth_start(
    app: tauri::AppHandle,
    window: WebviewWindow,
    workspace_id: String,
    request_id: String,
    mut input: Value,
) -> Result<Started, String> {
    let call = begin(&app, &window, &workspace_id, &request_id)?;
    let object = input.as_object_mut().ok_or("账号连接设置无效")?;
    if object.contains_key("secret") || object.contains_key("authentication") {
        return Err("账号连接设置无效".into());
    }
    let id = object
        .remove("providerId")
        .and_then(|id| id.as_str().map(str::to_owned))
        .ok_or("OAuth 服务标识无效")?;
    object.insert("authentication".into(), Value::String("bearer".into()));
    let input = types::input(input)?;
    let provider = provider(&app, &id, None)?;
    if provider.origin != input.config.origin {
        return Err("此登录服务不能用于所选来源".into());
    }
    Box::pin(async move {
        let expires = oauth::now()? + 600_000;
        let binding = crate::with_workspace_session(&workspace_id, app.state(), |session| {
            let _guard = STATE_LOCK.lock().map_err(|_| "连接服务正忙")?;
            call.check()?;
            let binding = Binding {
                workspace: workspace_id.clone(),
                expires,
                root: session.root_key.clone(),
                policy: policy(session, &input.config)?,
                config: input.config,
                version: input.version,
                provider,
            };
            binding.check_session(&app, session)?;
            Ok(binding)
        })?;
        let receiver = loopback::Loopback::bind(&binding.provider.id).await?;
        call.check()?;
        let id = oauth::random_token();
        let state = oauth::random_token();
        let verifier = oauth::random_token();
        let authorization_url =
            binding
                .provider
                .authorization_url(&receiver.redirect, &state, &verifier)?;
        let expires_at = time::OffsetDateTime::from_unix_timestamp((expires / 1000) as i64)
            .map_err(|_| "系统时间无效")?
            .format(&time::format_description::well_known::Rfc3339)
            .map_err(|_| "系统时间无效")?;
        let flow_status = Arc::new(AtomicU8::new(PENDING));
        {
            let managed = app.state::<PluginOAuthState>();
            let mut flows = managed.flows.lock().map_err(|_| "账号连接正忙")?;
            flows.retain(|_, flow| flow.expires > oauth::now().unwrap_or(u64::MAX));
            if flows.len() >= 32
                || flows
                    .values()
                    .filter(|flow| {
                        flow.workspace == workspace_id
                            && flow.status.load(Ordering::SeqCst) <= EXCHANGING
                    })
                    .count()
                    >= 3
            {
                return Err("待完成的账号连接过多，请先取消旧授权".into());
            }
            flows.insert(
                id.clone(),
                Flow {
                    window: window.label().into(),
                    workspace: workspace_id,
                    expires,
                    status: flow_status.clone(),
                    stopped: call.stopped.clone(),
                },
            );
        }
        tauri::async_runtime::spawn(Box::pin(run(
            app,
            binding,
            call,
            receiver,
            state,
            verifier,
            flow_status,
        )));
        Ok(Started {
            id,
            authorization_url,
            expires_at,
        })
    })
    .await
}
async fn run(
    app: tauri::AppHandle,
    binding: Binding,
    call: PluginCall,
    receiver: loopback::Loopback,
    state: String,
    verifier: String,
    status: Arc<AtomicU8>,
) {
    let operation = async {
        let (stream, code) = receiver.receive(&state).await?;
        let redirect = receiver.redirect.clone();
        drop(receiver);
        let Some(code) = code else {
            loopback::reply(stream, false).await;
            return Ok::<u8, String>(CANCELLED);
        };
        status.store(EXCHANGING, Ordering::SeqCst);
        let result = async {
            binding.check(&app, &call)?;
            let endpoint = tauri::Url::parse(&binding.provider.token_endpoint)
                .map_err(|_| "OAuth 端点无效")?;
            let tokens = tokio::time::timeout(Duration::from_secs(15), async {
                let client = http::prepare_origin(&endpoint.origin().ascii_serialization()).await?;
                binding.check(&app, &call)?;
                http::exchange_oauth(
                    client,
                    &binding.provider,
                    vec![
                        ("grant_type", "authorization_code".into()),
                        ("code", code),
                        ("code_verifier", verifier),
                        ("redirect_uri", redirect),
                    ],
                )
                .await
            })
            .await
            .map_err(|_| "账号令牌交换超时，请重新连接")??;
            binding.check(&app, &call)?;
            let app_save = app.clone();
            let bound = binding.clone();
            let stopped = call.stopped.clone();
            let committed_status = status.clone();
            tauri::async_runtime::spawn_blocking(move || {
                crate::with_workspace_session(&bound.workspace, app_save.state(), |session| {
                    let _guard = STATE_LOCK.lock().map_err(|_| "连接服务正忙")?;
                    bound.check_session(&app_save, session)?;
                    let (path, vault) = scope(&app_save, session)?;
                    let grant = Grant::new(&bound.provider, &bound.config, tokens);
                    Store::open(&path)?.save_oauth(
                        bound.config.clone(),
                        bound.version.as_deref(),
                        grant,
                        None,
                        &vault,
                        || {
                            if stopped.load(Ordering::SeqCst) {
                                return Err("账号连接已取消".into());
                            }
                            bound.check_session(&app_save, session)
                        },
                    )?;
                    committed_status.store(COMPLETED, Ordering::SeqCst);
                    Ok::<(), String>(())
                })
            })
            .await
            .map_err(|_| "保存系统账号凭据失败")??;
            Ok::<(), String>(())
        }
        .await;
        loopback::reply(stream, result.is_ok()).await;
        result?;
        Ok(COMPLETED)
    };
    let mut operation = Box::pin(operation);
    let mut ticker = tokio::time::interval(Duration::from_millis(200));
    let timeout = tokio::time::sleep(Duration::from_secs(600));
    tokio::pin!(timeout);
    let outcome = loop {
        tokio::select! {
            result = &mut operation => break result.unwrap_or(FAILED),
            _ = ticker.tick() => {
                if status.load(Ordering::SeqCst) == COMPLETED { continue; }
                if oauth::now().unwrap_or(u64::MAX) >= binding.expires { break EXPIRED; }
                if call.check().is_err() { if status.load(Ordering::SeqCst) != COMPLETED { break CANCELLED; } continue; }
                if binding.check(&app, &call).is_err() && status.load(Ordering::SeqCst) != COMPLETED { break FAILED; }
            },
            _ = &mut timeout => break if status.load(Ordering::SeqCst) == COMPLETED { COMPLETED } else { EXPIRED },
        }
    };
    status.store(outcome, Ordering::SeqCst);
}

pub async fn access_token(
    app: &tauri::AppHandle,
    workspace: &str,
    record: &Record,
    mut grant: Grant,
    stopped: Arc<AtomicBool>,
    check: impl Fn() -> Result<(), String>,
) -> Result<String, String> {
    let provider = provider(app, &grant.provider_id, Some(&grant.fingerprint))?;
    if provider.origin != record.connection.config.origin {
        return Err("账号连接来源已变化".into());
    }
    if grant
        .tokens
        .expires_at
        .is_none_or(|expires| expires > oauth::now().unwrap_or(u64::MAX).saturating_add(30_000))
    {
        return Ok(grant.tokens.access_token);
    }
    let refresh = grant
        .tokens
        .refresh_token
        .clone()
        .ok_or("账号连接已到期，请重新登录授权")?;
    check()?;
    let (root, policy_hash, claim) =
        crate::with_workspace_session(workspace, app.state(), |session| {
            let _guard = STATE_LOCK.lock().map_err(|_| "连接服务正忙")?;
            let (path, _) = scope(app, session)?;
            let policy_hash = policy(session, &record.connection.config)?;
            let claim = Store::open(&path)?.claim_refresh(record)?;
            Ok((session.root_key.clone(), policy_hash, claim))
        })?;
    let endpoint = tauri::Url::parse(&provider.token_endpoint).map_err(|_| "OAuth 端点无效")?;
    let client = http::prepare_origin(&endpoint.origin().ascii_serialization()).await?;
    check()?;
    let mut tokens = http::exchange_oauth(
        client,
        &provider,
        vec![
            ("grant_type", "refresh_token".into()),
            ("refresh_token", refresh),
        ],
    )
    .await?;
    if tokens.expires_at.is_none() {
        return Err("刷新结果缺少有效期，请重新登录授权".into());
    }
    if tokens.refresh_token.is_none() {
        tokens.refresh_token = grant.tokens.refresh_token;
    }
    let access = tokens.access_token.clone();
    grant.tokens = tokens;
    check()?;
    let app_save = app.clone();
    let workspace = workspace.to_owned();
    let record = record.clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::with_workspace_session(&workspace, app_save.state(), |session| {
            let _guard = STATE_LOCK.lock().map_err(|_| "连接服务正忙")?;
            let (path, vault) = scope(&app_save, session)?;
            let config = record.connection.config.clone();
            Store::open(&path)?.save_oauth(
                config.clone(),
                Some(&record.connection.version),
                grant,
                Some(&claim.id),
                &vault,
                || {
                    if stopped.load(Ordering::SeqCst)
                        || session.root_key != root
                        || crate::storage::native_key(&session.root) != root
                    {
                        return Err("账号刷新已取消或工作区已切换".into());
                    }
                    crate::identity_manifest::require(&session.root, &session.id)?;
                    if policy(session, &config)? != policy_hash {
                        return Err("插件规则已变化，请重新连接".into());
                    }
                    self::provider(&app_save, &provider.id, Some(&provider.fingerprint()))?;
                    Ok(())
                },
            )?;
            Ok::<(), String>(())
        })
    })
    .await
    .map_err(|_| "保存刷新后的系统凭据失败")??;
    check()?;
    Ok(access)
}
