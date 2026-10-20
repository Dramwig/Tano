//! Named, workspace-bound native capabilities. Community code never receives a shell or IPC handle.
use serde::Deserialize;
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{Manager, State, WebviewWindow};

#[derive(Default)]
pub struct PluginNativeState {
    calls: Arc<Mutex<Calls>>,
}
#[derive(Default)]
struct Calls {
    active: HashMap<String, Arc<AtomicBool>>,
    control: HashSet<String>,
    stopped: HashMap<String, Instant>,
}
impl Calls {
    fn start(&mut self, key: &str) -> Result<Arc<AtomicBool>, String> {
        self.start_limit(key, 4)
    }
    fn start_limit(&mut self, key: &str, limit: usize) -> Result<Arc<AtomicBool>, String> {
        self.stopped
            .retain(|_, time| time.elapsed() < Duration::from_secs(30));
        if self.stopped.remove(key).is_some() {
            return Err("插件请求已取消".into());
        }
        if self.active.len() >= 32
            || limit == 4 && self.active.len().saturating_sub(self.control.len()) >= 4
            || self.active.contains_key(key)
        {
            return Err("本机插件请求过多，请稍后重试".into());
        }
        let stopped = Arc::new(AtomicBool::new(false));
        self.active.insert(key.to_owned(), stopped.clone());
        if limit != 4 {
            self.control.insert(key.to_owned());
        }
        Ok(stopped)
    }
    fn cancel(&mut self, key: String) -> Result<(), String> {
        if let Some(stopped) = self.active.get(&key) {
            stopped.store(true, Ordering::SeqCst);
        } else {
            self.stopped
                .retain(|_, time| time.elapsed() < Duration::from_secs(30));
            if self.stopped.len() >= 128 {
                return Err("取消请求过多，请稍后重试".into());
            }
            self.stopped.insert(key, Instant::now());
        }
        Ok(())
    }
}
impl PluginNativeState {
    pub(crate) fn begin_control(&self, label: &str, id: &str) -> Result<PluginCall, String> {
        uuid::Uuid::parse_str(id).map_err(|_| "请求标识无效")?;
        let key = format!("{label}:{id}");
        // Keep revocation available even when all four network/Git slots are occupied.
        let stopped = self
            .calls
            .lock()
            .map_err(|_| "插件服务正忙")?
            .start_limit(&key, 32)?;
        Ok(PluginCall {
            key,
            calls: self.calls.clone(),
            stopped,
        })
    }
    pub(crate) fn begin(&self, label: &str, id: &str) -> Result<PluginCall, String> {
        uuid::Uuid::parse_str(id).map_err(|_| "请求标识无效")?;
        let key = format!("{label}:{id}");
        let stopped = self.calls.lock().map_err(|_| "插件服务正忙")?.start(&key)?;
        Ok(PluginCall {
            key,
            calls: self.calls.clone(),
            stopped,
        })
    }
    pub fn stop_window(&self, label: &str) {
        if let Ok(calls) = self.calls.lock() {
            for (key, stopped) in &calls.active {
                if key
                    .rsplit_once(':')
                    .is_some_and(|(window, _)| window == label)
                {
                    stopped.store(true, Ordering::SeqCst);
                }
            }
        }
    }
    pub fn stop_workspace(&self) {
        if let Ok(calls) = self.calls.lock() {
            for stopped in calls.active.values() {
                stopped.store(true, Ordering::SeqCst);
            }
        }
    }
}
pub(crate) struct PluginCall {
    key: String,
    calls: Arc<Mutex<Calls>>,
    pub stopped: Arc<AtomicBool>,
}
impl PluginCall {
    pub fn check(&self) -> Result<(), String> {
        if self.stopped.load(Ordering::SeqCst) {
            Err("插件请求已取消；已发送到服务的请求可能已生效".into())
        } else {
            Ok(())
        }
    }
}
impl Drop for PluginCall {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::SeqCst);
        if let Ok(mut calls) = self.calls.lock() {
            calls.active.remove(&self.key);
            calls.control.remove(&self.key);
        }
    }
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeRequest {
    pub request_id: String,
    pub workspace_id: String,
    pub plugin_id: String,
    pub integrity: String,
    pub command: String,
    pub args: Value,
}
fn valid_request(request: &NativeRequest) -> Result<(), String> {
    if uuid::Uuid::parse_str(&request.request_id).is_err()
        || uuid::Uuid::parse_str(&request.workspace_id).is_err()
        || request.plugin_id.is_empty()
        || request.plugin_id.len() > 40
        || !request
            .plugin_id
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
        || request.integrity.len() != 64
        || !request
            .integrity
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        || !matches!(
            request.command.as_str(),
            "git.status" | "git.diff" | "git.log"
        )
    {
        return Err("插件本机请求无效".into());
    }
    Ok(())
}
fn policy(root: &Path, request: &NativeRequest) -> Result<String, String> {
    policy_for(
        root,
        &request.plugin_id,
        &request.integrity,
        "native",
        "nativeCommands",
        &request.command,
    )
}
pub(crate) fn policy_for(
    root: &Path,
    plugin: &str,
    integrity: &str,
    permission: &str,
    declaration: &str,
    capability: &str,
) -> Result<String, String> {
    let path = crate::storage::resolve_storage(root, ".tano/plugins.tano.json", true)?;
    let content = crate::workspace_git::read_bounded(&path, 2 * 1024 * 1024)?;
    let value: Value = serde_json::from_slice(&content).map_err(|_| "插件规则损坏")?;
    let plugins = value
        .get("plugins")
        .and_then(Value::as_array)
        .ok_or("插件规则无效")?;
    if value.get("version").and_then(Value::as_u64) != Some(1) || plugins.len() > 100 {
        return Err("插件规则无效".into());
    }
    let matching: Vec<_> = plugins
        .iter()
        .filter(|row| row["manifest"]["id"].as_str() == Some(plugin))
        .collect();
    if matching.len() != 1 {
        return Err("插件已卸载或规则无效".into());
    }
    let row = matching[0];
    let manifest = &row["manifest"];
    let contains = |key: &str, expected: &str| {
        manifest[key]
            .as_array()
            .is_some_and(|items| items.iter().any(|item| item.as_str() == Some(expected)))
    };
    if !matches!(
        row["mode"].as_str(),
        Some("required" | "recommended" | "optional")
    ) || row["integrity"].as_str() != Some(integrity)
        || manifest["manifestVersion"].as_u64() != Some(2)
        || manifest["apiVersion"].as_u64() != Some(1)
        || !contains("permissions", permission)
        || !contains(declaration, capability)
    {
        return Err("此插件版本没有当前能力授权".into());
    }
    Ok(crate::storage::hash(&content))
}
fn authorize(
    app: &tauri::AppHandle,
    request: &NativeRequest,
) -> Result<(PathBuf, String, String), String> {
    crate::with_workspace_session(&request.workspace_id, app.state(), |session| {
        Ok((
            session.root.clone(),
            session.root_key.clone(),
            policy(&session.root, request)?,
        ))
    })
}
#[tauri::command]
pub async fn plugin_native_request(
    app: tauri::AppHandle,
    window: WebviewWindow,
    request: NativeRequest,
) -> Result<Value, String> {
    valid_request(&request)?;
    let args = crate::workspace_git::parse_args(&request.command, request.args.clone())?;
    let initial = authorize(&app, &request)?;
    let key = format!("{}:{}", window.label(), request.request_id);
    let state = app.state::<PluginNativeState>();
    let stopped = state
        .calls
        .lock()
        .map_err(|_| "本机插件服务正忙")?
        .start(&key)?;
    // Keep the IPC entry future small; Tauri constructs it on the Windows UI thread.
    let result = Box::pin(async {
        let root = initial.0.clone();
        let directory = crate::app_data(&app)?.join("plugin-native");
        let stop = stopped.clone();
        let mut prepare = tauri::async_runtime::spawn_blocking(move || {
            crate::workspace_git::prepare(&root, &directory, &stop)
        });
        let mut ticker = tokio::time::interval(Duration::from_millis(250));
        let timeout = tokio::time::sleep(Duration::from_secs(15));
        tokio::pin!(timeout);
        let check = || -> Result<(), String> {
            if stopped.load(Ordering::SeqCst) {
                return Err("插件请求已取消".into());
            }
            if authorize(&app, &request)? != initial {
                return Err("工作区或插件规则已变化，请重新查询".into());
            }
            Ok(())
        };
        let prepared = loop {
            tokio::select! {
                result = &mut prepare => break result.map_err(|_| "准备 Git 查询失败")??,
                _ = ticker.tick() => check()?,
                _ = &mut timeout => return Err("Git 查询超时".into()),
            }
        };
        check()?;
        let mut run = Box::pin(crate::workspace_git::query(&prepared, &request.command, args, &stopped));
        loop {
            tokio::select! {
                result = &mut run => { let result = result?; check()?; return Ok(result); },
                _ = ticker.tick() => if let Err(error) = check() {
                    stopped.store(true, Ordering::SeqCst); let _ = (&mut run).await; return Err(error);
                },
                _ = &mut timeout => {
                    stopped.store(true, Ordering::SeqCst); let _ = (&mut run).await; return Err("Git 查询超时".into());
                },
            }
        }
    })
    .await;
    stopped.store(true, Ordering::SeqCst);
    state
        .calls
        .lock()
        .map_err(|_| "本机插件服务正忙")?
        .active
        .remove(&key);
    result
}
#[tauri::command]
pub fn plugin_native_cancel(
    window: WebviewWindow,
    state: State<PluginNativeState>,
    request_id: String,
) -> Result<(), String> {
    if uuid::Uuid::parse_str(&request_id).is_err() {
        return Err("请求标识无效".into());
    }
    state
        .calls
        .lock()
        .map_err(|_| "本机插件服务正忙")?
        .cancel(format!("{}:{request_id}", window.label()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn policy_checks_exact_version_permission_mode_and_unique_identity() {
        let dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        std::fs::create_dir(dir.path().join(".tano")).unwrap();
        let request = NativeRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            workspace_id: uuid::Uuid::new_v4().to_string(),
            plugin_id: "git".into(),
            integrity: "a".repeat(64),
            command: "git.status".into(),
            args: json!({}),
        };
        valid_request(&request).unwrap();
        let row = json!({"manifest": {"manifestVersion":2,"apiVersion":1,"id":"git","permissions":["native"],"nativeCommands":["git.status"]}, "integrity":request.integrity,"mode":"required"});
        let write = |rows: Value| {
            std::fs::write(
                dir.path().join(".tano/plugins.tano.json"),
                json!({"version":1,"plugins":rows}).to_string(),
            )
            .unwrap()
        };
        write(json!([row.clone()]));
        policy(&root, &request).unwrap();
        for (field, value) in [
            ("mode", json!("disabled")),
            ("integrity", json!("b".repeat(64))),
        ] {
            let mut changed = row.clone();
            changed[field] = value;
            write(json!([changed]));
            assert!(policy(&root, &request).is_err());
        }
        write(json!([row.clone(), row.clone()]));
        assert!(policy(&root, &request).is_err());
        let mut changed = row.clone();
        changed["manifest"]["nativeCommands"] = json!(["git.diff"]);
        write(json!([changed]));
        assert!(policy(&root, &request).is_err());
        let mut changed = row;
        changed["manifest"]["permissions"] = json!([]);
        write(json!([changed]));
        assert!(policy(&root, &request).is_err());
    }
    #[test]
    fn cancellation_is_window_scoped_and_covers_cancel_before_start() {
        let state = PluginNativeState::default();
        let other = state.calls.lock().unwrap().start("other:one").unwrap();
        let own = state.calls.lock().unwrap().start("main:one").unwrap();
        state.stop_window("main");
        assert!(own.load(Ordering::SeqCst));
        assert!(!other.load(Ordering::SeqCst));
        let mut calls = state.calls.lock().unwrap();
        calls.cancel("main:two".into()).unwrap();
        assert!(calls.start("main:two").is_err());
        calls.start("third:one").unwrap();
        calls.start("fourth:one").unwrap();
        assert!(calls.start("fifth:one").is_err());
    }
    #[test]
    fn service_connections_require_their_own_permission_origin_and_hash() {
        let dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        std::fs::create_dir(root.join(".tano")).unwrap();
        let mut row = json!({"manifest":{"manifestVersion":2,"apiVersion":1,"id":"importer","permissions":["connections"],"networkOrigins":["https://api.example.test"]},"mode":"required","integrity":"a".repeat(64)});
        let write = |row: &Value| {
            std::fs::write(
                root.join(".tano/plugins.tano.json"),
                json!({"version":1,"plugins":[row]}).to_string(),
            )
            .unwrap()
        };
        write(&row);
        assert!(policy_for(
            &root,
            "importer",
            &"a".repeat(64),
            "connections",
            "networkOrigins",
            "https://api.example.test"
        )
        .is_ok());
        for (hash, host) in [
            ("b".repeat(64), "https://api.example.test"),
            ("a".repeat(64), "https://other.example.test"),
        ] {
            assert!(policy_for(
                &root,
                "importer",
                &hash,
                "connections",
                "networkOrigins",
                host
            )
            .is_err());
        }
        row["manifest"]["permissions"] = json!(["network", "native"]);
        write(&row);
        assert!(policy_for(
            &root,
            "importer",
            &"a".repeat(64),
            "connections",
            "networkOrigins",
            "https://api.example.test"
        )
        .is_err());
    }
    #[test]
    fn credential_revocation_remains_available_when_request_slots_are_full() {
        let state = PluginNativeState::default();
        let calls: Vec<_> = (0..4)
            .map(|_| {
                state
                    .begin("main", &uuid::Uuid::new_v4().to_string())
                    .unwrap()
            })
            .collect();
        assert!(state
            .begin("main", &uuid::Uuid::new_v4().to_string())
            .is_err());
        let control = state
            .begin_control("main", &uuid::Uuid::new_v4().to_string())
            .unwrap();
        state.stop_window("main");
        assert!(calls.iter().all(|call| call.check().is_err()));
        assert!(control.check().is_err());
        drop((calls, control));
        assert!(state.calls.lock().unwrap().active.is_empty());
    }
    #[test]
    fn pending_account_logins_do_not_consume_network_slots_and_all_cancel_on_close() {
        let state = PluginNativeState::default();
        let pending: Vec<_> = (0..3)
            .map(|_| {
                state
                    .begin_control("main", &uuid::Uuid::new_v4().to_string())
                    .unwrap()
            })
            .collect();
        let requests: Vec<_> = (0..4)
            .map(|_| {
                state
                    .begin("main", &uuid::Uuid::new_v4().to_string())
                    .unwrap()
            })
            .collect();
        assert!(state
            .begin("main", &uuid::Uuid::new_v4().to_string())
            .is_err());
        state.stop_window("main");
        assert!(pending
            .iter()
            .chain(&requests)
            .all(|call| call.check().is_err()));
        drop((pending, requests));
        let calls = state.calls.lock().unwrap();
        assert!(calls.active.is_empty());
        assert!(calls.control.is_empty());
    }
    #[test]
    fn switching_workspace_permanently_cancels_prior_calls_in_every_window() {
        let state = PluginNativeState::default();
        let login = state
            .begin_control("main", &uuid::Uuid::new_v4().to_string())
            .unwrap();
        let request = state
            .begin("settings-main", &uuid::Uuid::new_v4().to_string())
            .unwrap();
        state.stop_workspace();
        let current = state
            .begin("main", &uuid::Uuid::new_v4().to_string())
            .unwrap();
        assert!(login.check().is_err());
        assert!(request.check().is_err());
        assert!(current.check().is_ok());
        drop((login, request, current));
        assert!(state.calls.lock().unwrap().active.is_empty());
    }
}
