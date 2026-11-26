// SPDX-License-Identifier: MIT
//! Active SSH remote workspace session lifecycle, watcher bridge, and reconnect handling.

use super::{
    config::{self, ResolvedSshTarget},
    storage::{self as remote_storage, AssetCache},
    transport::{RemoteTransport, RemoteWatchEvent, RemoteWatchHandle},
    types::{RemoteConnectionPhase, RemoteTrashMode, SshConnectionStatusEvent},
    uri::{format_remote_workspace_uri, parse_remote_workspace_uri},
    SshState,
};
use crate::{
    app_data, cache_path, session_storage, storage, workspace_lock, ActiveSession, AppState,
};
use std::{
    sync::{atomic::AtomicU64, Arc, Mutex},
    time::Duration,
};
use tauri::{Emitter, Manager};
use tokio::sync::mpsc;

pub struct RemoteSession {
    pub id: String,
    pub uri: String,
    pub host_id: String,
    pub host_label: String,
    pub target: ResolvedSshTarget,
    pub remote_root: String,
    pub transport: Arc<dyn RemoteTransport>,
    pub asset_cache: Arc<Mutex<AssetCache>>,
    pub latency_ms: Arc<AtomicU64>,
    pub trash_mode: RemoteTrashMode,
    pub(crate) _lock: std::fs::File,
    watch_handle: Mutex<Option<RemoteWatchHandle>>,
}

impl RemoteSession {
    pub fn stop_watch(&self) {
        if let Ok(mut guard) = self.watch_handle.lock() {
            if let Some(handle) = guard.take() {
                handle.stop();
            }
        }
    }

    pub fn clear_asset_cache(&self) {
        if let Ok(mut guard) = self.asset_cache.lock() {
            guard.clear();
        }
    }
}

impl Drop for RemoteSession {
    fn drop(&mut self) {
        self.stop_watch();
    }
}

pub async fn open_remote_workspace(
    uri_str: String,
    app: tauri::AppHandle,
) -> Result<storage::Workspace, String> {
    let parsed = parse_remote_workspace_uri(&uri_str).map_err(|e| e.to_string())?;
    let ssh_state = app.state::<SshState>();
    let live = ssh_state
        .get_or_connect(&app, &parsed.host_id, false)
        .await?;
    let transport: Arc<dyn RemoteTransport> = live.transport.clone();

    let canonical_root = transport
        .canonicalize_dir(&parsed.remote_path)
        .await
        .map_err(|e| e.to_string())?;
    let canonical_uri = format_remote_workspace_uri(&live.target.host_id, &canonical_root)
        .map_err(|e| e.to_string())?;

    let (id, newly_created) =
        remote_storage::ensure_workspace_identity(transport.as_ref(), &canonical_root).await?;

    // Check window switch guard & reuse lock if reopening the exact same remote workspace.
    let app_state = app.state::<AppState>();
    let already_same = {
        let guard = app_state.session.lock().map_err(|e| e.to_string())?;
        match guard.as_ref() {
            Some(ActiveSession::Remote(existing))
                if existing.id == id && existing.uri == canonical_uri =>
            {
                true
            }
            Some(_) => {
                if crate::ipc::workspace::workspace_switch_blocked(&app) {
                    return Err("请先关闭此工作区的独立窗口，再切换工作区".into());
                }
                false
            }
            None => false,
        }
    };

    let data = app_data(&app)?;
    let cache = cache_path(&app)?;
    let settings = config::load_settings(&data).unwrap_or_default();

    let mut workspace = remote_storage::remote_scan(
        transport.as_ref(),
        &canonical_root,
        &canonical_uri,
        &live.target.host_id,
        &live.target.label,
        &id,
        &cache,
        Some(live.latency_ms),
    )
    .await?;
    workspace.newly_created = newly_created.then_some(true);

    if already_same {
        session_storage::record(&cache, &workspace)?;
        let _ = config::record_host_connected(&data, &live.target.host_id, Some(&canonical_root));
        return Ok(workspace);
    }

    let lock_dir = crate::ipc::workspace::workspace_lock_directory(&app)?;
    let lock = workspace_lock::acquire(&lock_dir, &id)?;

    let (watch_tx, mut watch_rx) = mpsc::channel::<RemoteWatchEvent>(16);
    let watch_handle = transport
        .start_watch(
            &canonical_root,
            Duration::from_secs(settings.poll_interval_secs.clamp(2, 60)),
            watch_tx,
        )
        .await
        .ok();

    let asset_cache = Arc::new(Mutex::new(AssetCache::default()));
    let watch_cache = asset_cache.clone();
    let emit_app = app.clone();
    let emit_host_id = live.target.host_id.clone();
    let emit_host_label = live.target.label.clone();
    tokio::spawn(async move {
        let mut consecutive_errors = 0u32;
        while let Some(event) = watch_rx.recv().await {
            match event {
                RemoteWatchEvent::Changed => {
                    consecutive_errors = 0;
                    if let Ok(mut guard) = watch_cache.lock() {
                        guard.clear();
                    }
                    let _ = emit_app.emit("workspace-changed", ());
                }
                RemoteWatchEvent::Error(err) => {
                    consecutive_errors = consecutive_errors.saturating_add(1);
                    if consecutive_errors >= 2 {
                        let ssh = emit_app.state::<SshState>();
                        ssh.emit_status(
                            &emit_app,
                            SshConnectionStatusEvent {
                                host_id: emit_host_id.clone(),
                                host_label: emit_host_label.clone(),
                                status: RemoteConnectionPhase::Disconnected,
                                latency_ms: None,
                                error: Some(err.clone()),
                                capabilities: None,
                            },
                        );
                        let _ = emit_app.emit("workspace-watch-error", err);
                    }
                }
            }
        }
    });

    session_storage::record(&cache, &workspace)?;
    let _ = config::record_host_connected(&data, &live.target.host_id, Some(&canonical_root));

    let session = Arc::new(RemoteSession {
        id,
        uri: canonical_uri,
        host_id: live.target.host_id.clone(),
        host_label: live.target.label.clone(),
        target: live.target.clone(),
        remote_root: canonical_root,
        transport,
        asset_cache,
        latency_ms: Arc::new(AtomicU64::new(live.latency_ms)),
        trash_mode: settings.trash_mode,
        _lock: lock,
        watch_handle: Mutex::new(watch_handle),
    });

    crate::ipc::workspace::stop_workspace_plugin_calls(&app);
    let mut guard = app_state.session.lock().map_err(|e| e.to_string())?;
    *guard = Some(ActiveSession::Remote(session));

    Ok(workspace)
}
