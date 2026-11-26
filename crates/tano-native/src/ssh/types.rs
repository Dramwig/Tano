// SPDX-License-Identifier: MIT
//! Shared types for SSH host profiles, remote capabilities, directory browsing,
//! interactive authentication challenges, and settings.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SshHostSource {
    #[default]
    Saved,
    SshConfig,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SshAuthMethod {
    #[default]
    Auto,
    Agent,
    Key,
    Password,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RemoteTrashMode {
    #[default]
    RemoteTrash,
    PermanentDelete,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RemoteConnectionPhase {
    Connecting,
    Connected,
    Reconnecting,
    #[default]
    Disconnected,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteServerCapabilities {
    pub shell: bool,
    pub fast_scan: bool,
    pub inotify: bool,
    pub git: bool,
    pub node: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub node_version: Option<String>,
    pub codex_cli: bool,
    pub claude_cli: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub platform: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteWorkspaceInfo {
    pub kind: String,
    pub host_id: String,
    pub host_label: String,
    pub remote_path: String,
    pub transport: String,
    pub status: RemoteConnectionPhase,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<RemoteServerCapabilities>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub git_repo: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshHostProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(default)]
    pub source: SshHostSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config_alias: Option<String>,
    #[serde(default)]
    pub auth_method: SshAuthMethod,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity_file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proxy_jump: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proxy_command: Option<String>,
    #[serde(default)]
    pub forward_agent: bool,
    #[serde(default)]
    pub has_saved_password: bool,
    #[serde(default)]
    pub has_saved_passphrase: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub recent_paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_connected_at: Option<u64>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshHostInput {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub host: String,
    #[serde(default = "default_ssh_port")]
    pub port: u16,
    pub username: String,
    #[serde(default)]
    pub auth_method: SshAuthMethod,
    #[serde(default)]
    pub identity_file: Option<String>,
    #[serde(default)]
    pub proxy_jump: Option<String>,
    #[serde(default)]
    pub proxy_command: Option<String>,
    #[serde(default)]
    pub forward_agent: bool,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub passphrase: Option<String>,
    #[serde(default)]
    pub clear_password: bool,
    #[serde(default)]
    pub clear_passphrase: bool,
}

fn default_ssh_port() -> u16 {
    22
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshHostListResponse {
    pub config_path: Option<String>,
    pub config_error: Option<String>,
    pub config_hosts: Vec<SshHostProfile>,
    pub saved_hosts: Vec<SshHostProfile>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConnectResult {
    pub host_id: String,
    pub host_label: String,
    pub home_dir: String,
    pub latency_ms: u64,
    pub capabilities: RemoteServerCapabilities,
    pub recent_paths: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConnectionStatusEvent {
    pub host_id: String,
    pub host_label: String,
    pub status: RemoteConnectionPhase,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<RemoteServerCapabilities>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDirEntry {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub size: u64,
    pub modified: u64,
    pub is_symlink: bool,
    pub is_hidden: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteListDirResponse {
    pub path: String,
    pub parent: Option<String>,
    pub entries: Vec<RemoteDirEntry>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshHostKeyPromptEvent {
    pub challenge_id: String,
    pub host_id: String,
    pub host_label: String,
    pub hostname: String,
    pub port: u16,
    pub algorithm: String,
    pub fingerprint: String,
    pub mismatch: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_fingerprint: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshAuthPromptItem {
    pub prompt: String,
    pub echo: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshAuthPromptEvent {
    pub challenge_id: String,
    pub host_id: String,
    pub host_label: String,
    pub kind: String, // "password" | "passphrase" | "keyboard-interactive"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instruction: Option<String>,
    pub prompts: Vec<SshAuthPromptItem>,
    pub allow_save: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshChallengeResponse {
    pub challenge_id: String,
    #[serde(default)]
    pub cancelled: bool,
    #[serde(default)]
    pub trust_host_key: bool,
    #[serde(default)]
    pub secrets: Vec<String>,
    #[serde(default)]
    pub save_secret: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownHostRecord {
    pub id: String,
    pub host_pattern: String,
    pub algorithm: String,
    pub fingerprint: String,
    pub source: String, // "tano" | "openssh"
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshSettings {
    #[serde(default)]
    pub trash_mode: RemoteTrashMode,
    #[serde(default = "default_poll_seconds")]
    pub poll_interval_secs: u64,
    #[serde(default = "default_keepalive_seconds")]
    pub keepalive_secs: u64,
    #[serde(default = "default_connect_timeout_seconds")]
    pub connect_timeout_secs: u64,
}

fn default_poll_seconds() -> u64 {
    3
}
fn default_keepalive_seconds() -> u64 {
    15
}
fn default_connect_timeout_seconds() -> u64 {
    15
}

impl Default for SshSettings {
    fn default() -> Self {
        Self {
            trash_mode: RemoteTrashMode::RemoteTrash,
            poll_interval_secs: default_poll_seconds(),
            keepalive_secs: default_keepalive_seconds(),
            connect_timeout_secs: default_connect_timeout_seconds(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshMcpSyncResult {
    pub remote_script_path: String,
    pub remote_data_dir: String,
    pub node_path: String,
    pub node_version: String,
    pub uploaded: bool,
    pub sha256: String,
}
