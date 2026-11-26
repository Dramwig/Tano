// SPDX-License-Identifier: MIT
//! SSH remote workspace subsystem (desktop-only, MIT core).
//!
//! Architecture:
//! - Phase 1 uses `SshSftpTransport` (`russh` + `russh-sftp` + `ssh2-config`), requiring zero
//!   remote installation while reusing `~/.ssh/config`, OS SSH Agent, keys, keyring secrets,
//!   ProxyJump/ProxyCommand, and strict host-key verification.
//! - All workspace/file/git/MCP/CLI layers talk to `RemoteTransport`, leaving Phase 2
//!   (`HelperTransport` / `tano-remote-helper`) as a drop-in upgrade.

pub mod agent;
pub mod challenges;
pub mod config;
pub mod credentials;
pub mod known_hosts;
pub mod remote_cli;
pub mod remote_git;
pub mod remote_mcp;
pub mod remote_search;
pub mod remote_terminal;
pub mod session;
pub mod sftp_transport;
pub mod storage;
pub mod transport;
pub mod types;
pub mod uri;

#[cfg(test)]
mod tests;

use challenges::{SshChallengeRegistry, TauriChallengePrompter};
use config::ResolvedSshTarget;
use sftp_transport::{ConnectOptions, SshSftpTransport};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tauri::{Emitter, Manager, State};
use transport::RemoteTransport;
use types::{
    KnownHostRecord, RemoteConnectionPhase, RemoteListDirResponse, SshChallengeResponse,
    SshConnectResult, SshConnectionStatusEvent, SshHostInput, SshHostListResponse, SshHostProfile,
    SshSettings,
};
use uri::normalize_remote_posix_path;

pub struct LiveSshConnection {
    pub target: ResolvedSshTarget,
    pub transport: Arc<SshSftpTransport>,
    pub latency_ms: u64,
}

pub struct SshState {
    pub challenges: Arc<SshChallengeRegistry>,
    connections: tokio::sync::Mutex<HashMap<String, Arc<LiveSshConnection>>>,
    statuses: Mutex<HashMap<String, SshConnectionStatusEvent>>,
}

impl Default for SshState {
    fn default() -> Self {
        Self {
            challenges: Arc::new(SshChallengeRegistry::default()),
            connections: tokio::sync::Mutex::new(HashMap::new()),
            statuses: Mutex::new(HashMap::new()),
        }
    }
}

impl SshState {
    pub async fn get_or_connect(
        &self,
        app: &tauri::AppHandle,
        host_id: &str,
        force_reconnect: bool,
    ) -> Result<Arc<LiveSshConnection>, String> {
        let app_data = crate::app_data(app)?;
        let target = config::resolve_target(&app_data, host_id)?;

        if !force_reconnect {
            let existing = { self.connections.lock().await.get(&target.host_id).cloned() };
            if let Some(conn) = existing {
                if let Ok(latency) = conn.transport.health_check().await {
                    let status = SshConnectionStatusEvent {
                        host_id: target.host_id.clone(),
                        host_label: target.label.clone(),
                        status: RemoteConnectionPhase::Connected,
                        latency_ms: Some(latency.as_millis() as u64),
                        error: None,
                        capabilities: Some(conn.transport.capabilities()),
                    };
                    self.emit_status(app, status);
                    return Ok(conn);
                }
                let _ = self.connections.lock().await.remove(&target.host_id);
                conn.transport.close().await;
            }
        } else if let Some(old) = self.connections.lock().await.remove(&target.host_id) {
            old.transport.close().await;
        }

        self.emit_status(
            app,
            SshConnectionStatusEvent {
                host_id: target.host_id.clone(),
                host_label: target.label.clone(),
                status: if force_reconnect {
                    RemoteConnectionPhase::Reconnecting
                } else {
                    RemoteConnectionPhase::Connecting
                },
                latency_ms: None,
                error: None,
                capabilities: None,
            },
        );

        let prompter = Arc::new(TauriChallengePrompter::new(
            app.clone(),
            self.challenges.clone(),
        ));
        let options = ConnectOptions {
            app_data: app_data.clone(),
            prompter,
            secrets_override: None,
            use_keyring: true,
            use_os_agent: true,
        };
        let (transport, elapsed) = match SshSftpTransport::connect(target.clone(), options).await {
            Ok(pair) => pair,
            Err(err) => {
                self.emit_status(
                    app,
                    SshConnectionStatusEvent {
                        host_id: target.host_id.clone(),
                        host_label: target.label.clone(),
                        status: RemoteConnectionPhase::Disconnected,
                        latency_ms: None,
                        error: Some(err.clone()),
                        capabilities: None,
                    },
                );
                return Err(err);
            }
        };

        let latency_ms = elapsed.as_millis() as u64;
        let caps = transport.capabilities();
        let live = Arc::new(LiveSshConnection {
            target: target.clone(),
            transport: Arc::new(transport),
            latency_ms,
        });
        self.connections
            .lock()
            .await
            .insert(target.host_id.clone(), live.clone());
        let _ = config::record_host_connected(&app_data, &target.host_id, None);
        self.emit_status(
            app,
            SshConnectionStatusEvent {
                host_id: target.host_id,
                host_label: target.label,
                status: RemoteConnectionPhase::Connected,
                latency_ms: Some(latency_ms),
                error: None,
                capabilities: Some(caps),
            },
        );
        Ok(live)
    }

    pub async fn get_existing(&self, host_id: &str) -> Option<Arc<LiveSshConnection>> {
        self.connections.lock().await.get(host_id).cloned()
    }

    pub async fn disconnect_host(&self, app: &tauri::AppHandle, host_id: &str) {
        if let Some(conn) = self.connections.lock().await.remove(host_id) {
            let label = conn.target.label.clone();
            conn.transport.close().await;
            self.emit_status(
                app,
                SshConnectionStatusEvent {
                    host_id: host_id.to_owned(),
                    host_label: label,
                    status: RemoteConnectionPhase::Disconnected,
                    latency_ms: None,
                    error: None,
                    capabilities: None,
                },
            );
        }
    }

    pub fn emit_status(&self, app: &tauri::AppHandle, event: SshConnectionStatusEvent) {
        if let Ok(mut guard) = self.statuses.lock() {
            guard.insert(event.host_id.clone(), event.clone());
        }
        let _ = app.emit("ssh-connection-status", &event);
    }

    pub fn status_snapshot(&self, host_id: &str) -> Option<SshConnectionStatusEvent> {
        self.statuses.lock().ok()?.get(host_id).cloned()
    }

    pub fn cancel_all_prompts(&self) {
        self.challenges.cancel_all();
    }
}

#[tauri::command(async)]
pub(crate) fn ssh_hosts_list(app: tauri::AppHandle) -> Result<SshHostListResponse, String> {
    config::list_hosts(&crate::app_data(&app)?)
}

#[tauri::command(async)]
pub(crate) fn ssh_host_save(
    input: SshHostInput,
    app: tauri::AppHandle,
) -> Result<SshHostProfile, String> {
    config::save_host(&crate::app_data(&app)?, input)
}

#[tauri::command(async)]
pub(crate) fn ssh_quick_connect_parse(
    raw: String,
    app: tauri::AppHandle,
) -> Result<(SshHostProfile, Option<String>), String> {
    let (input, remote_path) = config::parse_quick_connect(&raw)?;
    let app_data = crate::app_data(&app)?;
    let existing = config::list_hosts(&app_data)?;
    if let Some(found) = existing
        .saved_hosts
        .into_iter()
        .find(|h| h.host == input.host && h.port == input.port && h.username == input.username)
    {
        return Ok((found, remote_path));
    }
    let saved = config::save_host(&app_data, input)?;
    Ok((saved, remote_path))
}

#[tauri::command]
pub(crate) async fn ssh_host_remove(
    host_id: String,
    app: tauri::AppHandle,
    ssh: State<'_, SshState>,
) -> Result<(), String> {
    ssh.disconnect_host(&app, &host_id).await;
    config::remove_host(&crate::app_data(&app)?, &host_id)
}

#[tauri::command]
pub(crate) async fn ssh_connect(
    host_id: String,
    app: tauri::AppHandle,
    ssh: State<'_, SshState>,
) -> Result<SshConnectResult, String> {
    let conn = ssh.get_or_connect(&app, &host_id, false).await?;
    let home_dir = conn.transport.home_dir().await.map_err(|e| e.to_string())?;
    let recent_paths = config::recent_paths_for_host(&crate::app_data(&app)?, &conn.target.host_id);
    Ok(SshConnectResult {
        host_id: conn.target.host_id.clone(),
        host_label: conn.target.label.clone(),
        home_dir,
        latency_ms: conn.latency_ms,
        capabilities: conn.transport.capabilities(),
        recent_paths,
    })
}

#[tauri::command]
pub(crate) async fn ssh_host_test(
    host_id: String,
    app: tauri::AppHandle,
    ssh: State<'_, SshState>,
) -> Result<SshConnectResult, String> {
    let conn = ssh.get_or_connect(&app, &host_id, true).await?;
    let home_dir = conn.transport.home_dir().await.map_err(|e| e.to_string())?;
    let recent_paths = config::recent_paths_for_host(&crate::app_data(&app)?, &conn.target.host_id);
    Ok(SshConnectResult {
        host_id: conn.target.host_id.clone(),
        host_label: conn.target.label.clone(),
        home_dir,
        latency_ms: conn.latency_ms,
        capabilities: conn.transport.capabilities(),
        recent_paths,
    })
}

#[tauri::command]
pub(crate) async fn ssh_disconnect(
    host_id: String,
    app: tauri::AppHandle,
    ssh: State<'_, SshState>,
) -> Result<(), String> {
    ssh.disconnect_host(&app, &host_id).await;
    Ok(())
}

#[tauri::command]
pub(crate) async fn ssh_reconnect(
    host_id: String,
    app: tauri::AppHandle,
    ssh: State<'_, SshState>,
) -> Result<SshConnectResult, String> {
    let conn = ssh.get_or_connect(&app, &host_id, true).await?;
    let home_dir = conn.transport.home_dir().await.map_err(|e| e.to_string())?;
    let recent_paths = config::recent_paths_for_host(&crate::app_data(&app)?, &conn.target.host_id);
    if let Some(app_state) = app.try_state::<crate::AppState>() {
        let active_uri = crate::remote_session(&app_state)
            .filter(|remote| remote.host_id == conn.target.host_id)
            .map(|remote| remote.uri.clone());
        if let Some(uri) = active_uri {
            let _ = session::open_remote_workspace(uri, app.clone()).await;
            let _ = app.emit("workspace-changed", ());
        }
    }
    Ok(SshConnectResult {
        host_id: conn.target.host_id.clone(),
        host_label: conn.target.label.clone(),
        home_dir,
        latency_ms: conn.latency_ms,
        capabilities: conn.transport.capabilities(),
        recent_paths,
    })
}

#[tauri::command(async)]
pub(crate) fn ssh_connection_status(
    host_id: String,
    ssh: State<'_, SshState>,
) -> Option<SshConnectionStatusEvent> {
    ssh.status_snapshot(&host_id)
}

#[tauri::command(async)]
pub(crate) fn ssh_challenge_respond(
    response: SshChallengeResponse,
    ssh: State<'_, SshState>,
) -> Result<(), String> {
    ssh.challenges.respond(response)
}

#[tauri::command]
pub(crate) async fn ssh_list_dir(
    host_id: String,
    path: Option<String>,
    include_hidden: bool,
    app: tauri::AppHandle,
    ssh: State<'_, SshState>,
) -> Result<RemoteListDirResponse, String> {
    let conn = ssh.get_or_connect(&app, &host_id, false).await?;
    let requested = match path.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
        Some(p) => p.to_owned(),
        None => conn.transport.home_dir().await.map_err(|e| e.to_string())?,
    };
    let canonical = conn
        .transport
        .canonicalize_dir(&requested)
        .await
        .map_err(|e| e.to_string())?;
    let entries = conn
        .transport
        .list_dir(&canonical, include_hidden)
        .await
        .map_err(|e| e.to_string())?;
    let parent = if canonical == "/" {
        None
    } else {
        Some(
            canonical
                .rsplit_once('/')
                .map(|(p, _)| if p.is_empty() { "/" } else { p })
                .unwrap_or("/")
                .to_owned(),
        )
    };
    Ok(RemoteListDirResponse {
        path: canonical,
        parent,
        entries,
    })
}

#[tauri::command]
pub(crate) async fn ssh_mkdir(
    host_id: String,
    path: String,
    app: tauri::AppHandle,
    ssh: State<'_, SshState>,
) -> Result<String, String> {
    let conn = ssh.get_or_connect(&app, &host_id, false).await?;
    let normalized = normalize_remote_posix_path(&path).map_err(|e| e.to_string())?;
    conn.transport
        .mkdir(&normalized)
        .await
        .map_err(|e| e.to_string())?;
    Ok(normalized)
}

#[tauri::command(async)]
pub(crate) fn ssh_known_hosts_list(app: tauri::AppHandle) -> Result<Vec<KnownHostRecord>, String> {
    known_hosts::list_known_hosts(&crate::app_data(&app)?)
}

#[tauri::command(async)]
pub(crate) fn ssh_known_hosts_remove(id: String, app: tauri::AppHandle) -> Result<(), String> {
    known_hosts::remove_known_host(&crate::app_data(&app)?, &id)
}

#[tauri::command(async)]
pub(crate) fn ssh_settings_load(app: tauri::AppHandle) -> Result<SshSettings, String> {
    config::load_settings(&crate::app_data(&app)?)
}

#[tauri::command(async)]
pub(crate) fn ssh_settings_save(
    settings: SshSettings,
    app: tauri::AppHandle,
) -> Result<SshSettings, String> {
    config::save_settings(&crate::app_data(&app)?, settings)
}

#[tauri::command]
pub(crate) async fn ssh_mcp_sync(
    host_id: String,
    app: tauri::AppHandle,
    ssh: State<'_, SshState>,
) -> Result<types::SshMcpSyncResult, String> {
    let (local_script, _) = remote_mcp::locate_local_mcp_script(&app)?;
    let conn = ssh.get_or_connect(&app, &host_id, false).await?;
    remote_mcp::sync_remote_mcp(conn.transport.as_ref(), &local_script).await
}

#[tauri::command]
pub(crate) async fn ssh_open_terminal(
    host_id: String,
    remote_path: Option<String>,
    app: tauri::AppHandle,
    ssh: State<'_, SshState>,
) -> Result<(), String> {
    let app_data = crate::app_data(&app)?;
    let target = config::resolve_target(&app_data, &host_id)?;
    let path = match remote_path
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
    {
        Some(p) => normalize_remote_posix_path(p).map_err(|e| e.to_string())?,
        None => {
            if let Some(conn) = ssh.get_existing(&target.host_id).await {
                conn.transport
                    .home_dir()
                    .await
                    .unwrap_or_else(|_| "/".into())
            } else {
                "/".into()
            }
        }
    };
    remote_terminal::open_remote_terminal(&target, &path)
}

#[tauri::command]
pub(crate) async fn ssh_remote_search(
    workspace_id: String,
    query: String,
    app: tauri::AppHandle,
) -> Result<Vec<crate::search::SearchHit>, String> {
    let remote = crate::remote_workspace_session(&workspace_id, &app.state::<crate::AppState>())?
        .ok_or("当前工作区不是 SSH 远端工作区")?;
    let cache = crate::cache_path(&app)?;
    remote_search::remote_search(
        remote.transport.as_ref(),
        &remote.remote_root,
        &remote.id,
        &cache,
        &query,
    )
    .await
}
