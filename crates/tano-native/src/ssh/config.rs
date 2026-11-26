// SPDX-License-Identifier: MIT
//! OpenSSH `~/.ssh/config` parser and Tano-managed SSH host/settings registry.
//! `~/.ssh/config` is strictly read-only; Tano stores user-saved hosts and settings
//! in `app_data_dir/ssh-hosts.json` and `app_data_dir/ssh-settings.json`.

use super::{
    credentials,
    types::{
        SshAuthMethod, SshHostInput, SshHostListResponse, SshHostProfile, SshHostSource,
        SshSettings,
    },
    uri,
};
use crate::storage;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use ssh2_config::{ParseRule, SshConfig};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::BufReader,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

static STORE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug)]
pub struct ResolvedSshTarget {
    pub host_id: String,
    pub label: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub config_alias: Option<String>,
    pub auth_method: SshAuthMethod,
    pub identity_files: Vec<PathBuf>,
    pub identities_only: bool,
    pub proxy_jump: Vec<String>,
    pub proxy_command: Option<String>,
    pub forward_agent: bool,
    pub connect_timeout_secs: u64,
    pub keepalive_secs: u64,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostRegistryFile {
    #[serde(default)]
    hosts: Vec<SshHostProfile>,
    #[serde(default)]
    recent_paths: HashMap<String, Vec<String>>,
    #[serde(default)]
    last_connected: HashMap<String, u64>,
}

pub fn user_home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
}

pub fn default_ssh_config_path() -> Option<PathBuf> {
    user_home_dir().map(|home| home.join(".ssh").join("config"))
}

pub fn default_username() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "root".into())
}

fn hosts_file_path(app_data: &Path) -> PathBuf {
    app_data.join("ssh-hosts.json")
}

fn settings_file_path(app_data: &Path) -> PathBuf {
    app_data.join("ssh-settings.json")
}

fn read_registry(app_data: &Path) -> Result<HostRegistryFile, String> {
    let path = hosts_file_path(app_data);
    if !path.exists() {
        return Ok(HostRegistryFile::default());
    }
    let bytes = fs::read(&path).map_err(|e| format!("无法读取 SSH 主机列表：{e}"))?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("SSH 主机配置文件过大".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "SSH 主机配置文件损坏，原文件已保留".into())
}

fn write_registry(app_data: &Path, file: &HostRegistryFile) -> Result<(), String> {
    let path = hosts_file_path(app_data);
    let bytes = serde_json::to_vec_pretty(file).map_err(|e| e.to_string())?;
    storage::temporary(&path, &bytes)?
        .persist(&path)
        .map_err(|e| format!("无法保存 SSH 主机列表：{e}"))?;
    Ok(())
}

pub fn load_settings(app_data: &Path) -> Result<SshSettings, String> {
    let path = settings_file_path(app_data);
    if !path.exists() {
        return Ok(SshSettings::default());
    }
    let bytes = fs::read(&path).map_err(|e| format!("无法读取 SSH 设置：{e}"))?;
    let mut settings: SshSettings =
        serde_json::from_slice(&bytes).map_err(|_| "SSH 设置文件损坏，已保留原文件")?;
    settings.poll_interval_secs = settings.poll_interval_secs.clamp(2, 60);
    settings.keepalive_secs = settings.keepalive_secs.clamp(5, 120);
    settings.connect_timeout_secs = settings.connect_timeout_secs.clamp(5, 60);
    Ok(settings)
}

pub fn save_settings(app_data: &Path, mut settings: SshSettings) -> Result<SshSettings, String> {
    settings.poll_interval_secs = settings.poll_interval_secs.clamp(2, 60);
    settings.keepalive_secs = settings.keepalive_secs.clamp(5, 120);
    settings.connect_timeout_secs = settings.connect_timeout_secs.clamp(5, 60);
    let path = settings_file_path(app_data);
    let bytes = serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?;
    storage::temporary(&path, &bytes)?
        .persist(&path)
        .map_err(|e| format!("无法保存 SSH 设置：{e}"))?;
    Ok(settings)
}

/// Stable, URI-safe host ID for an `~/.ssh/config` alias.
pub fn config_host_id(alias: &str) -> String {
    let clean: String = alias
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                c
            } else {
                '_'
            }
        })
        .take(40)
        .collect();
    let digest = format!("{:x}", Sha256::digest(alias.as_bytes()));
    if clean == alias && uri::is_valid_host_id(&format!("cfg-{clean}")) {
        format!("cfg-{clean}")
    } else {
        format!("cfg-{}-{}", clean.trim_matches('_'), &digest[..10])
    }
}

fn expand_tilde(path: &str, home: Option<&Path>) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\")) {
        if let Some(home) = home {
            return home.join(rest);
        }
    } else if path == "~" {
        if let Some(home) = home {
            return home.to_path_buf();
        }
    }
    PathBuf::from(path)
}

fn extract_field(map: &HashMap<String, Vec<String>>, key: &str) -> Option<String> {
    map.iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(key))
        .and_then(|(_, v)| (!v.is_empty()).then(|| v.join(" ")))
}

fn parse_ssh_config_at(
    config_path: &Path,
    home: Option<&Path>,
) -> Result<Option<SshConfig>, String> {
    if !config_path.exists() {
        return Ok(None);
    }
    let file = fs::File::open(config_path).map_err(|e| format!("无法打开 SSH 配置文件：{e}"))?;
    let mut reader = BufReader::new(file);
    let mut builder = SshConfig::default();
    if let Some(home) = home {
        builder = builder.home_dir(home);
    }
    let config = builder
        .parse(&mut reader, ParseRule::ALLOW_UNKNOWN_FIELDS)
        .map_err(|e| format!("解析 ~/.ssh/config 失败：{e}"))?;
    Ok(Some(config))
}

pub fn discover_ssh_config_hosts_from(
    config_path: &Path,
    home: Option<&Path>,
    recent_map: &HashMap<String, Vec<String>>,
    last_connected: &HashMap<String, u64>,
) -> Result<Vec<SshHostProfile>, String> {
    let Some(config) = parse_ssh_config_at(config_path, home)? else {
        return Ok(Vec::new());
    };
    let mut seen = HashSet::new();
    let mut profiles = Vec::new();
    let fallback_user = default_username();

    for host in config.get_hosts() {
        for clause in &host.pattern {
            if clause.negated {
                continue;
            }
            let pattern = clause.pattern.trim();
            if pattern.is_empty()
                || pattern.contains('*')
                || pattern.contains('?')
                || pattern.contains('!')
                || !seen.insert(pattern.to_owned())
            {
                continue;
            }
            let params = config.query(pattern);
            let id = config_host_id(pattern);
            let hostname = params
                .host_name
                .clone()
                .unwrap_or_else(|| pattern.to_owned());
            let port = params.port.unwrap_or(22);
            let username = params.user.clone().unwrap_or_else(|| fallback_user.clone());
            let identity_file = params
                .identity_file
                .as_ref()
                .and_then(|list| list.first())
                .map(|p| p.to_string_lossy().into_owned());
            let proxy_jump = params
                .proxy_jump
                .as_ref()
                .filter(|v| !v.is_empty())
                .map(|v| v.join(","));
            let proxy_command = extract_field(&params.unsupported_fields, "proxycommand")
                .or_else(|| extract_field(&params.ignored_fields, "proxycommand"))
                .filter(|v| !v.eq_ignore_ascii_case("none"));
            let secrets = credentials::read_secrets(&id).unwrap_or_default();
            profiles.push(SshHostProfile {
                id: id.clone(),
                name: pattern.to_owned(),
                host: hostname,
                port,
                username,
                source: SshHostSource::SshConfig,
                config_alias: Some(pattern.to_owned()),
                auth_method: SshAuthMethod::Auto,
                identity_file,
                proxy_jump,
                proxy_command,
                forward_agent: params.forward_agent.unwrap_or(false),
                has_saved_password: secrets.password.is_some(),
                has_saved_passphrase: secrets.passphrase.is_some(),
                recent_paths: recent_map.get(&id).cloned().unwrap_or_default(),
                last_connected_at: last_connected.get(&id).copied(),
            });
        }
    }
    Ok(profiles)
}

pub fn list_hosts(app_data: &Path) -> Result<SshHostListResponse, String> {
    let _guard = STORE_LOCK.lock().map_err(|_| "无法访问 SSH 主机列表")?;
    let registry = read_registry(app_data)?;
    let home = user_home_dir();
    let config_path = default_ssh_config_path();
    let (config_hosts, config_error) = match config_path.as_deref() {
        Some(path) => match discover_ssh_config_hosts_from(
            path,
            home.as_deref(),
            &registry.recent_paths,
            &registry.last_connected,
        ) {
            Ok(hosts) => (hosts, None),
            Err(err) => (Vec::new(), Some(err)),
        },
        None => (Vec::new(), None),
    };
    let mut saved_hosts = Vec::with_capacity(registry.hosts.len());
    for mut host in registry.hosts {
        let secrets = credentials::read_secrets(&host.id).unwrap_or_default();
        host.has_saved_password = secrets.password.is_some();
        host.has_saved_passphrase = secrets.passphrase.is_some();
        if let Some(paths) = registry.recent_paths.get(&host.id) {
            host.recent_paths = paths.clone();
        }
        if let Some(ts) = registry.last_connected.get(&host.id) {
            host.last_connected_at = Some(*ts);
        }
        saved_hosts.push(host);
    }
    Ok(SshHostListResponse {
        config_path: config_path.map(|p| p.to_string_lossy().into_owned()),
        config_error,
        config_hosts,
        saved_hosts,
    })
}

fn validate_host_input(input: &SshHostInput) -> Result<(), String> {
    let host = input.host.trim();
    let user = input.username.trim();
    if host.is_empty()
        || host.len() > 255
        || host.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err("请输入有效的服务器主机名或 IP 地址".into());
    }
    if user.is_empty()
        || user.len() > 128
        || user.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err("请输入有效的 SSH 用户名".into());
    }
    if input.port == 0 {
        return Err("SSH 端口必须在 1 到 65535 之间".into());
    }
    if input.name.trim().len() > 120 {
        return Err("主机名称不能超过 120 个字符".into());
    }
    Ok(())
}

pub fn save_host(app_data: &Path, input: SshHostInput) -> Result<SshHostProfile, String> {
    validate_host_input(&input)?;
    let _guard = STORE_LOCK.lock().map_err(|_| "无法保存 SSH 主机")?;
    let mut registry = read_registry(app_data)?;
    let id = match input.id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(existing) if uri::is_valid_host_id(existing) => existing.to_owned(),
        Some(_) => return Err("主机标识格式无效".into()),
        None => format!("host-{}", &uuid::Uuid::new_v4().simple().to_string()[..12]),
    };

    let mut secrets = credentials::read_secrets(&id).unwrap_or_default();
    if input.clear_password {
        secrets.password = None;
    } else if let Some(password) = input.password.filter(|p| !p.is_empty()) {
        secrets.password = Some(password);
    }
    if input.clear_passphrase {
        secrets.passphrase = None;
    } else if let Some(passphrase) = input.passphrase.filter(|p| !p.is_empty()) {
        secrets.passphrase = Some(passphrase);
    }
    credentials::save_secrets(&id, &secrets)?;

    let display_name = if input.name.trim().is_empty() {
        format!("{}@{}", input.username.trim(), input.host.trim())
    } else {
        input.name.trim().to_owned()
    };

    let profile = SshHostProfile {
        id: id.clone(),
        name: display_name,
        host: input.host.trim().to_owned(),
        port: input.port,
        username: input.username.trim().to_owned(),
        source: SshHostSource::Saved,
        config_alias: None,
        auth_method: input.auth_method,
        identity_file: input
            .identity_file
            .map(|s| s.trim().to_owned())
            .filter(|s| !s.is_empty()),
        proxy_jump: input
            .proxy_jump
            .map(|s| s.trim().to_owned())
            .filter(|s| !s.is_empty()),
        proxy_command: input
            .proxy_command
            .map(|s| s.trim().to_owned())
            .filter(|s| !s.is_empty()),
        forward_agent: input.forward_agent,
        has_saved_password: secrets.password.is_some(),
        has_saved_passphrase: secrets.passphrase.is_some(),
        recent_paths: registry.recent_paths.get(&id).cloned().unwrap_or_default(),
        last_connected_at: registry.last_connected.get(&id).copied(),
    };

    if let Some(slot) = registry.hosts.iter_mut().find(|h| h.id == id) {
        *slot = profile.clone();
    } else {
        registry.hosts.push(profile.clone());
    }
    write_registry(app_data, &registry)?;
    Ok(profile)
}

pub fn remove_host(app_data: &Path, host_id: &str) -> Result<(), String> {
    if !uri::is_valid_host_id(host_id) {
        return Err("无效的 SSH 主机标识".into());
    }
    let _guard = STORE_LOCK.lock().map_err(|_| "无法移除 SSH 主机")?;
    let mut registry = read_registry(app_data)?;
    registry.hosts.retain(|h| h.id != host_id);
    registry.recent_paths.remove(host_id);
    registry.last_connected.remove(host_id);
    write_registry(app_data, &registry)?;
    let _ = credentials::delete_secrets(host_id);
    Ok(())
}

pub fn record_host_connected(
    app_data: &Path,
    host_id: &str,
    remote_path: Option<&str>,
) -> Result<(), String> {
    let _guard = STORE_LOCK.lock().map_err(|_| "无法更新 SSH 主机历史")?;
    let mut registry = read_registry(app_data)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as u64;
    registry.last_connected.insert(host_id.to_owned(), now);
    if let Some(path) = remote_path {
        if let Ok(normalized) = uri::normalize_remote_posix_path(path) {
            let list = registry.recent_paths.entry(host_id.to_owned()).or_default();
            list.retain(|entry| entry != &normalized);
            list.insert(0, normalized);
            list.truncate(10);
        }
    }
    write_registry(app_data, &registry)
}

pub fn recent_paths_for_host(app_data: &Path, host_id: &str) -> Vec<String> {
    let Ok(_guard) = STORE_LOCK.lock() else {
        return Vec::new();
    };
    read_registry(app_data)
        .ok()
        .and_then(|reg| reg.recent_paths.get(host_id).cloned())
        .unwrap_or_default()
}

pub fn resolve_target(app_data: &Path, host_id: &str) -> Result<ResolvedSshTarget, String> {
    let list = list_hosts(app_data)?;
    let settings = load_settings(app_data).unwrap_or_default();
    let home = user_home_dir();

    if let Some(saved) = list.saved_hosts.iter().find(|h| h.id == host_id) {
        let mut identity_files = Vec::new();
        if let Some(file) = &saved.identity_file {
            identity_files.push(expand_tilde(file, home.as_deref()));
        }
        let proxy_jump = saved
            .proxy_jump
            .as_deref()
            .map(|s| {
                s.split(',')
                    .map(str::trim)
                    .filter(|p| !p.is_empty())
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default();
        return Ok(ResolvedSshTarget {
            host_id: saved.id.clone(),
            label: saved.name.clone(),
            host: saved.host.clone(),
            port: saved.port,
            username: saved.username.clone(),
            config_alias: None,
            auth_method: saved.auth_method,
            identity_files,
            identities_only: saved.auth_method == SshAuthMethod::Key
                && saved.identity_file.is_some(),
            proxy_jump,
            proxy_command: saved.proxy_command.clone(),
            forward_agent: saved.forward_agent,
            connect_timeout_secs: settings.connect_timeout_secs,
            keepalive_secs: settings.keepalive_secs,
        });
    }

    if let Some(cfg_host) = list.config_hosts.iter().find(|h| h.id == host_id) {
        let alias = cfg_host.config_alias.as_deref().unwrap_or(&cfg_host.name);
        return resolve_ssh_config_alias(
            alias,
            Some(cfg_host.id.clone()),
            &settings,
            home.as_deref(),
        );
    }

    // Also allow resolving by raw ~/.ssh/config alias (useful for ProxyJump hops).
    if let Some(cfg_host) = list
        .config_hosts
        .iter()
        .find(|h| h.config_alias.as_deref() == Some(host_id))
    {
        return resolve_ssh_config_alias(
            host_id,
            Some(cfg_host.id.clone()),
            &settings,
            home.as_deref(),
        );
    }

    Err(format!("未找到 SSH 主机配置：{host_id}"))
}

pub fn resolve_jump_hop(app_data: &Path, spec: &str) -> Result<ResolvedSshTarget, String> {
    let trimmed = spec.trim();
    if trimmed.is_empty() {
        return Err("跳板机地址为空".into());
    }
    // Try matching saved host or ~/.ssh/config alias first.
    if let Ok(resolved) = resolve_target(app_data, trimmed) {
        return Ok(resolved);
    }
    let settings = load_settings(app_data).unwrap_or_default();
    let home = user_home_dir();
    let (user_part, host_port) = match trimmed.split_once('@') {
        Some((u, hp)) => (Some(u.trim()), hp.trim()),
        None => (None, trimmed),
    };
    let (host, port) = parse_host_port(host_port)?;
    // Query ~/.ssh/config defaults for the jump host even if not explicitly listed as a concrete alias.
    if let Ok(mut target) = resolve_ssh_config_alias(host, None, &settings, home.as_deref()) {
        if let Some(user) = user_part.filter(|u| !u.is_empty()) {
            target.username = user.to_owned();
        }
        if let Some(p) = port {
            target.port = p;
        }
        return Ok(target);
    }
    Ok(ResolvedSshTarget {
        host_id: config_host_id(trimmed),
        label: trimmed.to_owned(),
        host: host.to_owned(),
        port: port.unwrap_or(22),
        username: user_part
            .filter(|u| !u.is_empty())
            .map(str::to_owned)
            .unwrap_or_else(default_username),
        config_alias: None,
        auth_method: SshAuthMethod::Auto,
        identity_files: Vec::new(),
        identities_only: false,
        proxy_jump: Vec::new(),
        proxy_command: None,
        forward_agent: false,
        connect_timeout_secs: settings.connect_timeout_secs,
        keepalive_secs: settings.keepalive_secs,
    })
}

fn parse_host_port(value: &str) -> Result<(&str, Option<u16>), String> {
    if let Some(rest) = value.strip_prefix('[') {
        let (host, after) = rest.split_once(']').ok_or("跳板机 IPv6 地址格式无效")?;
        if after.is_empty() {
            return Ok((host, None));
        }
        let port = after
            .strip_prefix(':')
            .ok_or("跳板机端口格式无效")?
            .parse::<u16>()
            .map_err(|_| "跳板机端口无效")?;
        return Ok((host, Some(port)));
    }
    if let Some((host, port_str)) = value.rsplit_once(':') {
        if !host.contains(':') {
            let port = port_str.parse::<u16>().map_err(|_| "跳板机端口无效")?;
            return Ok((host, Some(port)));
        }
    }
    Ok((value, None))
}

fn resolve_ssh_config_alias(
    alias: &str,
    explicit_id: Option<String>,
    settings: &SshSettings,
    home: Option<&Path>,
) -> Result<ResolvedSshTarget, String> {
    let config_path = default_ssh_config_path().ok_or("无法定位用户目录")?;
    let config = parse_ssh_config_at(&config_path, home)?.ok_or("未找到 ~/.ssh/config")?;
    let params = config.query(alias);
    let host = params.host_name.clone().unwrap_or_else(|| alias.to_owned());
    let port = params.port.unwrap_or(22);
    let username = params.user.clone().unwrap_or_else(default_username);
    let identity_files = params
        .identity_file
        .unwrap_or_default()
        .into_iter()
        .map(|p| expand_tilde(&p.to_string_lossy(), home))
        .collect();
    let identities_only = extract_field(&params.unsupported_fields, "identitiesonly")
        .or_else(|| extract_field(&params.ignored_fields, "identitiesonly"))
        .is_some_and(|v| v.eq_ignore_ascii_case("yes"));
    let proxy_command = extract_field(&params.unsupported_fields, "proxycommand")
        .or_else(|| extract_field(&params.ignored_fields, "proxycommand"))
        .filter(|v| !v.eq_ignore_ascii_case("none"));
    let proxy_jump = params
        .proxy_jump
        .unwrap_or_default()
        .into_iter()
        .flat_map(|item| {
            item.split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty() && !s.eq_ignore_ascii_case("none"))
                .map(str::to_owned)
                .collect::<Vec<_>>()
        })
        .collect();
    let connect_timeout_secs = params
        .connect_timeout
        .map(|d| d.as_secs().clamp(5, 60))
        .unwrap_or(settings.connect_timeout_secs);
    let keepalive_secs = params
        .server_alive_interval
        .map(|d| d.as_secs().clamp(5, 120))
        .unwrap_or(settings.keepalive_secs);
    Ok(ResolvedSshTarget {
        host_id: explicit_id.unwrap_or_else(|| config_host_id(alias)),
        label: alias.to_owned(),
        host,
        port,
        username,
        config_alias: Some(alias.to_owned()),
        auth_method: SshAuthMethod::Auto,
        identity_files,
        identities_only,
        proxy_jump,
        proxy_command,
        forward_agent: params.forward_agent.unwrap_or(false),
        connect_timeout_secs,
        keepalive_secs,
    })
}

/// Default OpenSSH identity file candidates under `~/.ssh/`.
pub fn default_identity_files() -> Vec<PathBuf> {
    let Some(home) = user_home_dir() else {
        return Vec::new();
    };
    let dir = home.join(".ssh");
    ["id_ed25519", "id_ecdsa", "id_rsa"]
        .into_iter()
        .map(|name| dir.join(name))
        .filter(|path| path.is_file())
        .collect()
}

/// Parse quick-connect input such as `user@host`, `user@host:2222`, or `ssh://user@host:2222/srv/app`.
pub fn parse_quick_connect(raw: &str) -> Result<(SshHostInput, Option<String>), String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("请输入服务器连接地址".into());
    }
    let without_scheme = trimmed.strip_prefix("ssh://").unwrap_or(trimmed);
    let (authority, remote_path) = match without_scheme.find('/') {
        Some(idx) => {
            let path = uri::normalize_remote_posix_path(&without_scheme[idx..])
                .map_err(|e| e.to_string())?;
            (&without_scheme[..idx], Some(path))
        }
        None => (without_scheme, None),
    };
    let (username, host_port) = match authority.split_once('@') {
        Some((u, hp)) if !u.trim().is_empty() => (u.trim().to_owned(), hp.trim()),
        Some(_) => return Err("用户名不能为空".into()),
        None => (default_username(), authority.trim()),
    };
    let (host, port) = parse_host_port(host_port)?;
    if host.is_empty() {
        return Err("请输入服务器主机名或 IP".into());
    }
    let input = SshHostInput {
        id: None,
        name: format!("{username}@{host}"),
        host: host.to_owned(),
        port: port.unwrap_or(22),
        username,
        auth_method: SshAuthMethod::Auto,
        identity_file: None,
        proxy_jump: None,
        proxy_command: None,
        forward_agent: false,
        password: None,
        passphrase: None,
        clear_password: false,
        clear_passphrase: false,
    };
    validate_host_input(&input)?;
    Ok((input, remote_path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ssh_config_with_includes_aliases_and_proxy_jump() {
        let dir = tempfile::tempdir().unwrap();
        let ssh_dir = dir.path().join(".ssh");
        fs::create_dir_all(ssh_dir.join("conf.d")).unwrap();
        fs::write(
            ssh_dir.join("conf.d/prod.conf"),
            "Host prod-gpu\n  HostName 10.20.30.40\n  User ubuntu\n  Port 2222\n  IdentityFile ~/.ssh/id_prod\n  ProxyJump bastion\n",
        )
        .unwrap();
        fs::write(
            ssh_dir.join("config"),
            "Include conf.d/*.conf\n\nHost bastion\n  HostName jump.example.com\n  User ops\n\nHost *\n  ServerAliveInterval 30\n",
        )
        .unwrap();

        let hosts = discover_ssh_config_hosts_from(
            &ssh_dir.join("config"),
            Some(dir.path()),
            &HashMap::new(),
            &HashMap::new(),
        )
        .unwrap();
        let prod = hosts.iter().find(|h| h.name == "prod-gpu").unwrap();
        assert_eq!(prod.host, "10.20.30.40");
        assert_eq!(prod.port, 2222);
        assert_eq!(prod.username, "ubuntu");
        assert_eq!(prod.proxy_jump.as_deref(), Some("bastion"));
        assert!(prod.identity_file.as_deref().unwrap().ends_with("id_prod"));
        assert!(hosts.iter().all(|h| h.name != "*"));
    }

    #[test]
    fn parses_quick_connect_addresses() {
        let (input, path) = parse_quick_connect("ssh://dev@10.0.0.8:2200/srv/repo").unwrap();
        assert_eq!(input.username, "dev");
        assert_eq!(input.host, "10.0.0.8");
        assert_eq!(input.port, 2200);
        assert_eq!(path.as_deref(), Some("/srv/repo"));

        let (input2, path2) = parse_quick_connect("alice@example.com").unwrap();
        assert_eq!(input2.username, "alice");
        assert_eq!(input2.host, "example.com");
        assert_eq!(input2.port, 22);
        assert!(path2.is_none());
    }
}
