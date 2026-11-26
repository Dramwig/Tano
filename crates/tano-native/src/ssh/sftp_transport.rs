// SPDX-License-Identifier: MIT
//! Phase 1 RemoteTransport implementation over multiplexed `russh` + `russh-sftp`.
//! Zero remote installation required; supports `~/.ssh/config`, `ProxyJump`,
//! `ProxyCommand`, OS SSH Agent, key/password/keyboard-interactive auth,
//! strict host-key TOFU/MITM checks, single-RTT fast scan/hash, atomic base-hash writes,
//! and adaptive remote watching.

use super::{
    agent,
    challenges::SshChallengePrompter,
    config::{default_identity_files, resolve_jump_hop, ResolvedSshTarget},
    credentials::{self, SshSecrets},
    known_hosts::{self, HostKeyCheck},
    transport::{
        RemoteExecOutput, RemoteScannedEntry, RemoteStat, RemoteTransport, RemoteWatchEvent,
        RemoteWatchHandle, RemoteWriteCheckOutcome,
    },
    types::{
        RemoteDirEntry, RemoteServerCapabilities, SshAuthMethod, SshAuthPromptEvent,
        SshAuthPromptItem, SshHostKeyPromptEvent,
    },
    uri::{join_remote_posix, normalize_remote_posix_path, shell_single_quote},
};
use crate::{
    error::NativeError,
    storage::{self, is_workspace_data_directory, is_workspace_data_path},
};
use async_trait::async_trait;
use russh::{
    client::{self, AuthResult, Handle, KeyboardInteractiveAuthResponse},
    keys::{
        load_secret_key, Algorithm, Error as KeyError, HashAlg, PrivateKeyWithHashAlg,
        PublicKeyOrCertificate,
    },
    ChannelMsg, Disconnect,
};
use russh_sftp::{
    client::SftpSession,
    protocol::{FileAttributes, OpenFlags, StatusCode},
};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    pin::Pin,
    process::Stdio,
    sync::{Arc, Mutex},
    task::{Context, Poll},
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, ReadBuf},
    net::TcpStream,
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::{mpsc, watch},
};

const MAX_READ_BYTES: u64 = 50 * 1024 * 1024;
const MAX_JUMP_DEPTH: usize = 4;

#[derive(Clone)]
pub struct ConnectOptions {
    pub app_data: PathBuf,
    pub prompter: Arc<dyn SshChallengePrompter>,
    /// Optional explicit secrets override (used in isolated tests without touching OS keyring).
    pub secrets_override: Option<SshSecrets>,
    pub use_keyring: bool,
    pub use_os_agent: bool,
}

struct ClientHandler {
    app_data: PathBuf,
    host_id: String,
    host_label: String,
    hostname: String,
    port: u16,
    prompter: Arc<dyn SshChallengePrompter>,
    reject_reason: Arc<Mutex<Option<String>>>,
}

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let pubkey = server_public_key.public_key();
        match known_hosts::verify_host_key(&self.app_data, &self.hostname, self.port, &pubkey) {
            Ok(HostKeyCheck::Trusted) => Ok(true),
            Ok(HostKeyCheck::Unknown {
                algorithm,
                fingerprint,
            }) => {
                let event = SshHostKeyPromptEvent {
                    challenge_id: String::new(),
                    host_id: self.host_id.clone(),
                    host_label: self.host_label.clone(),
                    hostname: self.hostname.clone(),
                    port: self.port,
                    algorithm,
                    fingerprint: fingerprint.clone(),
                    mismatch: false,
                    previous_fingerprint: None,
                };
                match self.prompter.prompt_host_key(event).await {
                    Ok(true) => {
                        if let Err(err) = known_hosts::trust_host_key(
                            &self.app_data,
                            &self.hostname,
                            self.port,
                            &pubkey,
                        ) {
                            *self.reject_reason.lock().unwrap() = Some(err);
                            return Ok(false);
                        }
                        Ok(true)
                    }
                    Ok(false) => {
                        *self.reject_reason.lock().unwrap() =
                            Some("已拒绝未知主机指纹，连接已中止".into());
                        Ok(false)
                    }
                    Err(err) => {
                        *self.reject_reason.lock().unwrap() = Some(err);
                        Ok(false)
                    }
                }
            }
            Ok(HostKeyCheck::Mismatch {
                algorithm,
                fingerprint,
                previous_fingerprint,
                source,
            }) => {
                let event = SshHostKeyPromptEvent {
                    challenge_id: String::new(),
                    host_id: self.host_id.clone(),
                    host_label: self.host_label.clone(),
                    hostname: self.hostname.clone(),
                    port: self.port,
                    algorithm,
                    fingerprint: fingerprint.clone(),
                    mismatch: true,
                    previous_fingerprint: previous_fingerprint.clone(),
                };
                // Notify the UI about the mismatch, but ALWAYS hard-reject to prevent MITM.
                let _ = self.prompter.prompt_host_key(event).await;
                let source_label = if source == "openssh" {
                    "~/.ssh/known_hosts"
                } else {
                    "Tano 已知主机记录"
                };
                *self.reject_reason.lock().unwrap() = Some(format!(
                    "安全警告：服务器 {}:{} 的主机指纹已发生变化（{}）！当前指纹：{}。已阻止连接，如确认服务器已重装，请先在 SSH 设置中移除旧指纹。",
                    self.hostname, self.port, source_label, fingerprint
                ));
                Ok(false)
            }
            Err(err) => {
                *self.reject_reason.lock().unwrap() = Some(err);
                Ok(false)
            }
        }
    }
}

struct ProxyChildStream {
    stdout: ChildStdout,
    stdin: ChildStdin,
    _child: Child,
}

impl AsyncRead for ProxyChildStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.stdout).poll_read(cx, buf)
    }
}

impl AsyncWrite for ProxyChildStream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        Pin::new(&mut self.stdin).poll_write(cx, buf)
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.stdin).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.stdin).poll_shutdown(cx)
    }
}

fn expand_proxy_command(template: &str, target: &ResolvedSshTarget) -> Result<String, String> {
    if target
        .host
        .chars()
        .any(|c| c.is_whitespace() || "`$;|&<>()\"'\\".contains(c))
        || target
            .username
            .chars()
            .any(|c| c.is_whitespace() || "`$;|&<>()\"'\\".contains(c))
    {
        return Err("主机名或用户名包含 ProxyCommand 不允许的字符".into());
    }
    let mut out = String::with_capacity(template.len() + 32);
    let mut chars = template.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '%' {
            match chars.next() {
                Some('h') => out.push_str(&target.host),
                Some('p') => out.push_str(&target.port.to_string()),
                Some('r') => out.push_str(&target.username),
                Some('%') => out.push('%'),
                Some(other) => {
                    out.push('%');
                    out.push(other);
                }
                None => out.push('%'),
            }
        } else {
            out.push(ch);
        }
    }
    Ok(out)
}

fn spawn_proxy_command(command: &str) -> Result<ProxyChildStream, String> {
    #[cfg(windows)]
    let mut cmd = {
        let mut c = Command::new("cmd");
        c.args(["/C", command]);
        c.creation_flags(0x08000000);
        c
    };
    #[cfg(unix)]
    let mut cmd = {
        let mut c = Command::new("/bin/sh");
        c.args(["-c", command]);
        c
    };
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("无法启动 ProxyCommand：{e}"))?;
    let stdout = child.stdout.take().ok_or("ProxyCommand stdout 不可用")?;
    let stdin = child.stdin.take().ok_or("ProxyCommand stdin 不可用")?;
    Ok(ProxyChildStream {
        stdout,
        stdin,
        _child: child,
    })
}

pub struct SshSftpTransport {
    _target: ResolvedSshTarget,
    handle: Arc<Handle<ClientHandler>>,
    _jump_handles: Vec<Handle<ClientHandler>>,
    sftp: Arc<SftpSession>,
    capabilities: RemoteServerCapabilities,
    home: String,
    _sha_tool: Option<String>,
}

impl SshSftpTransport {
    pub async fn connect(
        target: ResolvedSshTarget,
        options: ConnectOptions,
    ) -> Result<(Self, Duration), String> {
        let started = Instant::now();
        let (handle, jump_handles) = connect_target_boxed(target.clone(), options, 0).await?;
        let handle = Arc::new(handle);

        let sftp_channel = handle
            .channel_open_session()
            .await
            .map_err(|e| format!("无法打开 SFTP 通道：{e}"))?;
        sftp_channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|e| format!("远端服务器未启用 SFTP 子系统：{e}"))?;
        let sftp = SftpSession::new(sftp_channel.into_stream())
            .await
            .map_err(|e| format!("SFTP 会话初始化失败：{e}"))?;
        sftp.set_timeout(30);
        let sftp = Arc::new(sftp);

        let (capabilities, probed_home, sha_tool) = probe_remote(&handle).await;
        let home = match probed_home {
            Some(dir) if dir.starts_with('/') => {
                normalize_remote_posix_path(&dir).unwrap_or("/".into())
            }
            _ => sftp
                .canonicalize(".")
                .await
                .ok()
                .and_then(|p| normalize_remote_posix_path(&p).ok())
                .unwrap_or_else(|| "/".into()),
        };

        let elapsed = started.elapsed();
        Ok((
            Self {
                _target: target,
                handle,
                _jump_handles: jump_handles,
                sftp,
                capabilities,
                home,
                _sha_tool: sha_tool,
            },
            elapsed,
        ))
    }

    async fn check_no_symlink_components(
        &self,
        root: &str,
        relative: &str,
    ) -> Result<String, NativeError> {
        let full = join_remote_posix(root, relative)?;
        let mut current = normalize_remote_posix_path(root)?;
        for segment in relative.split('/').filter(|s| !s.is_empty()) {
            current = if current == "/" {
                format!("/{segment}")
            } else {
                format!("{current}/{segment}")
            };
            if let Some(stat) = self.lstat(&current).await? {
                if stat.is_symlink {
                    return Err(NativeError::SymlinkEscape(
                        "为保护工作空间，不跟随远端符号链接",
                    ));
                }
            }
        }
        Ok(full)
    }

    async fn scan_tree_python(
        &self,
        root: &str,
        limit: usize,
    ) -> Result<Vec<RemoteScannedEntry>, NativeError> {
        let script = r#"
import json, os, stat, sys
root = sys.argv[1]
limit = int(sys.argv[2])
IGNORED = {"node_modules", "target", "dist"}
DATA_DIRS = {".tano", ".tano/objects", ".tano/conflicts", ".tano/annotations", ".tano/discussions", ".tano/document-layout", ".tano/suggestions", ".tano/tables", ".tano/rules", ".tano/templates", ".tano/views", ".tano/files"}
def is_data_dir(rel):
    return rel in DATA_DIRS or rel.startswith(".tano/objects/") or rel.startswith(".tano/conflicts/")
def is_data_path(rel):
    if not rel.startswith(".tano/"):
        return False
    sub = rel[6:]
    if sub in ("capabilities.json", "settings.tano.json", "relations.tano-relations.json", "plugins.tano.json"):
        return True
    if sub.startswith(("objects/", "annotations/", "discussions/", "document-layout/", "suggestions/", "tables/", "templates/", "views/", "files/")) and sub.endswith(".tano.json"):
        return True
    if sub.startswith("conflicts/") and (sub.endswith(".md") or sub.endswith(".table.json") or sub.endswith(".tano.json")):
        return True
    if sub == "rules/assistant.md" or (sub.startswith("rules/") and sub.endswith(".md")):
        return True
    return False
visited = 0
def walk(cur, prefix):
    global visited
    try:
        names = sorted(os.listdir(cur))
    except OSError as exc:
        sys.stderr.write(str(exc))
        sys.exit(2)
    for name in names:
        rel = name if not prefix else prefix + "/" + name
        internal = rel == ".tano" or rel.startswith(".tano/")
        if rel != ".tano" and (name.startswith(".") or name in IGNORED):
            continue
        full = os.path.join(cur, name)
        try:
            st = os.lstat(full)
        except OSError:
            continue
        mode = st.st_mode
        if stat.S_ISLNK(mode):
            continue
        is_dir = stat.S_ISDIR(mode)
        is_file = stat.S_ISREG(mode)
        if not is_dir and not is_file:
            continue
        if internal and is_file and not is_data_path(rel):
            continue
        if visited >= limit:
            sys.stderr.write("LIMIT_EXCEEDED")
            sys.exit(3)
        visited += 1
        if internal and is_dir:
            if is_data_dir(rel):
                walk(full, rel)
            continue
        mtime_ns = getattr(st, "st_mtime_ns", int(st.st_mtime * 1_000_000_000))
        ctime_ns = getattr(st, "st_ctime_ns", mtime_ns)
        nkey = f"{st.st_dev}:{st.st_ino}"
        stamp = f"{nkey}:{st.st_size}:{mtime_ns}:{ctime_ns}"
        print(json.dumps({"p": rel, "n": name, "d": is_dir, "s": st.st_size, "m": mtime_ns // 1_000_000, "k": nkey, "t": stamp}, ensure_ascii=False))
        if is_dir:
            walk(full, rel)
walk(root, "")
"#;
        let cmd = format!(
            "python3 -c {} {} {}",
            shell_single_quote(script)?,
            shell_single_quote(root)?,
            limit
        );
        let out = self
            .exec_bounded(
                &cmd,
                None,
                32 * 1024 * 1024,
                32 * 1024,
                Duration::from_secs(45),
            )
            .await?;
        if out.exit_code == 3 {
            return Err(NativeError::SizeLimit(
                "远端工作空间文件数量超过上限，请选择更小的子目录",
            ));
        }
        if out.exit_code != 0 {
            let err = String::from_utf8_lossy(&out.stderr);
            return Err(NativeError::Message(format!(
                "远端目录扫描失败：{}",
                err.trim()
            )));
        }
        #[derive(serde::Deserialize)]
        struct Row {
            p: String,
            n: String,
            d: bool,
            s: u64,
            m: u64,
            k: String,
            t: String,
        }
        let mut entries = Vec::new();
        for line in out.stdout.split(|&b| b == b'\n') {
            if line.is_empty() {
                continue;
            }
            let row: Row = serde_json::from_slice(line)
                .map_err(|_| NativeError::Message("远端扫描输出格式无效".into()))?;
            entries.push(RemoteScannedEntry {
                path: row.p,
                name: row.n,
                is_dir: row.d,
                size: row.s,
                modified_ms: row.m,
                native_key: row.k,
                stamp: row.t,
            });
        }
        Ok(entries)
    }

    async fn scan_tree_sftp(
        &self,
        root: &str,
        limit: usize,
    ) -> Result<Vec<RemoteScannedEntry>, NativeError> {
        let mut entries = Vec::new();
        let mut queue = vec![String::new()];
        let mut visited = 0usize;
        while let Some(prefix) = queue.pop() {
            let dir_path = join_remote_posix(root, &prefix)?;
            let read_dir = self
                .sftp
                .read_dir(&dir_path)
                .await
                .map_err(|e| map_sftp_err("读取远端目录失败", e))?;
            for item in read_dir {
                let name = item.file_name();
                if name == "." || name == ".." {
                    continue;
                }
                let rel = if prefix.is_empty() {
                    name.clone()
                } else {
                    format!("{prefix}/{name}")
                };
                let internal = rel == ".tano" || rel.starts_with(".tano/");
                if rel != ".tano" && storage::ignored_workspace_name(&name) {
                    continue;
                }
                let attrs = item.metadata();
                let stat = attrs_to_stat(&attrs);
                if stat.is_symlink || (!stat.is_dir && !stat.is_file) {
                    continue;
                }
                if internal && stat.is_file && !is_workspace_data_path(&rel) {
                    continue;
                }
                if visited >= limit {
                    return Err(NativeError::SizeLimit(
                        "远端工作空间文件数量超过上限，请选择更小的子目录",
                    ));
                }
                visited += 1;
                if internal && stat.is_dir {
                    if is_workspace_data_directory(&rel) {
                        queue.push(rel);
                    }
                    continue;
                }
                entries.push(RemoteScannedEntry {
                    path: rel.clone(),
                    name,
                    is_dir: stat.is_dir,
                    size: stat.size,
                    modified_ms: stat.modified_ms,
                    native_key: stat.native_key,
                    stamp: stat.stamp,
                });
                if stat.is_dir {
                    queue.push(rel);
                }
            }
        }
        Ok(entries)
    }
}

fn connect_target_boxed(
    target: ResolvedSshTarget,
    options: ConnectOptions,
    depth: usize,
) -> Pin<
    Box<
        dyn std::future::Future<
                Output = Result<(Handle<ClientHandler>, Vec<Handle<ClientHandler>>), String>,
            > + Send,
    >,
> {
    Box::pin(connect_target(target, options, depth))
}

async fn connect_target(
    target: ResolvedSshTarget,
    options: ConnectOptions,
    depth: usize,
) -> Result<(Handle<ClientHandler>, Vec<Handle<ClientHandler>>), String> {
    if depth > MAX_JUMP_DEPTH {
        return Err("SSH ProxyJump 跳板层级超过 4 层限制，请检查是否存在循环配置".into());
    }
    let config = Arc::new(client::Config {
        keepalive_interval: Some(Duration::from_secs(target.keepalive_secs.max(5))),
        keepalive_max: 3,
        inactivity_timeout: None,
        nodelay: true,
        ..Default::default()
    });
    let reject_reason = Arc::new(Mutex::new(None::<String>));
    let handler = ClientHandler {
        app_data: options.app_data.clone(),
        host_id: target.host_id.clone(),
        host_label: target.label.clone(),
        hostname: target.host.clone(),
        port: target.port,
        prompter: options.prompter.clone(),
        reject_reason: reject_reason.clone(),
    };
    let timeout = Duration::from_secs(target.connect_timeout_secs.clamp(5, 60));

    let mut jump_handles = Vec::new();
    let connect_result = if !target.proxy_jump.is_empty() {
        let mut hops = target.proxy_jump.clone();
        let last_hop = hops.pop().unwrap();
        let mut jump_target = resolve_jump_hop(&options.app_data, &last_hop)?;
        jump_target.proxy_jump = hops;
        let (jump_handle, mut nested) =
            connect_target_boxed(jump_target, options.clone(), depth + 1).await?;
        let tunnel = tokio::time::timeout(
            timeout,
            jump_handle.channel_open_direct_tcpip(
                target.host.clone(),
                u32::from(target.port),
                "127.0.0.1",
                0,
            ),
        )
        .await
        .map_err(|_| format!("通过跳板机连接 {}:{} 超时", target.host, target.port))?
        .map_err(|e| format!("无法建立跳板机隧道：{e}"))?;
        let handle = tokio::time::timeout(
            timeout,
            client::connect_stream(config, tunnel.into_stream(), handler),
        )
        .await
        .map_err(|_| format!("SSH 握手超时（{}:{}）", target.host, target.port))?;
        nested.push(jump_handle);
        jump_handles = nested;
        handle
    } else if let Some(proxy_cmd) = target.proxy_command.as_deref() {
        let expanded = expand_proxy_command(proxy_cmd, &target)?;
        let stream = spawn_proxy_command(&expanded)?;
        tokio::time::timeout(timeout, client::connect_stream(config, stream, handler))
            .await
            .map_err(|_| format!("通过 ProxyCommand 建立 SSH 握手超时（{}）", target.host))?
    } else {
        let addr = format!("{}:{}", target.host, target.port);
        let tcp = tokio::time::timeout(timeout, TcpStream::connect(&addr))
            .await
            .map_err(|_| format!("连接服务器 {addr} 超时，请检查网络、防火墙和端口"))?
            .map_err(|e| format!("无法连接到 {addr}：{e}"))?;
        let _ = tcp.set_nodelay(true);
        tokio::time::timeout(timeout, client::connect_stream(config, tcp, handler))
            .await
            .map_err(|_| format!("SSH 握手超时（{addr}）"))?
    };

    let mut handle = match connect_result {
        Ok(h) => h,
        Err(err) => {
            if let Some(reason) = reject_reason.lock().unwrap().take() {
                return Err(reason);
            }
            return Err(format!("SSH 握手失败：{err}"));
        }
    };

    authenticate_session(&mut handle, &target, &options).await?;
    Ok((handle, jump_handles))
}

async fn authenticate_session(
    handle: &mut Handle<ClientHandler>,
    target: &ResolvedSshTarget,
    options: &ConnectOptions,
) -> Result<(), String> {
    let best_rsa_hash = handle
        .best_supported_rsa_hash()
        .await
        .ok()
        .flatten()
        .flatten();
    let mut secrets = match &options.secrets_override {
        Some(override_secrets) => override_secrets.clone(),
        None if options.use_keyring => {
            credentials::read_secrets(&target.host_id).unwrap_or_default()
        }
        None => SshSecrets::default(),
    };

    // 1. OS SSH Agent (Auto / Agent)
    if options.use_os_agent
        && !target.identities_only
        && matches!(
            target.auth_method,
            SshAuthMethod::Auto | SshAuthMethod::Agent
        )
        && agent::try_authenticate_with_agent(handle, &target.username, best_rsa_hash).await
    {
        return Ok(());
    }

    // 2. IdentityFile / default private keys (Auto / Key)
    if matches!(target.auth_method, SshAuthMethod::Auto | SshAuthMethod::Key) {
        let mut candidates = target.identity_files.clone();
        if !target.identities_only {
            for default_key in default_identity_files() {
                if !candidates.contains(&default_key) {
                    candidates.push(default_key);
                }
            }
        }
        for path in candidates {
            if !path.is_file() {
                continue;
            }
            let key = match load_secret_key(&path, None) {
                Ok(key) => Some(key),
                Err(KeyError::KeyIsEncrypted) => {
                    if let Some(pass) = secrets.passphrase.as_deref() {
                        load_secret_key(&path, Some(pass)).ok()
                    } else {
                        None
                    }
                    .or({
                        // Will prompt interactively below if not already unlocked
                        None
                    })
                }
                Err(_) => None,
            };
            let key = if let Some(key) = key {
                Some(key)
            } else if matches!(load_secret_key(&path, None), Err(KeyError::KeyIsEncrypted)) {
                let prompt_res = options
                    .prompter
                    .prompt_auth(SshAuthPromptEvent {
                        challenge_id: String::new(),
                        host_id: target.host_id.clone(),
                        host_label: target.label.clone(),
                        kind: "passphrase".into(),
                        instruction: Some(format!(
                            "请输入私钥 {} 的解锁口令",
                            path.file_name().unwrap_or_default().to_string_lossy()
                        )),
                        prompts: vec![SshAuthPromptItem {
                            prompt: "私钥口令".into(),
                            echo: false,
                        }],
                        allow_save: options.use_keyring,
                    })
                    .await?;
                if let Some((values, save)) = prompt_res {
                    let pass = values.first().map(String::as_str).unwrap_or("");
                    match load_secret_key(&path, Some(pass)) {
                        Ok(k) => {
                            if save && options.use_keyring {
                                secrets.passphrase = Some(pass.to_owned());
                                let _ = credentials::save_secrets(&target.host_id, &secrets);
                            }
                            Some(k)
                        }
                        Err(_) => {
                            if target.auth_method == SshAuthMethod::Key {
                                return Err("私钥口令不正确".into());
                            }
                            None
                        }
                    }
                } else {
                    if target.auth_method == SshAuthMethod::Key {
                        return Err("已取消 SSH 认证".into());
                    }
                    None
                }
            } else {
                None
            };

            if let Some(key) = key {
                let rsa_hash = match key.algorithm() {
                    Algorithm::Rsa { .. } => best_rsa_hash.or(Some(HashAlg::Sha256)),
                    _ => None,
                };
                if let Ok(AuthResult::Success) = handle
                    .authenticate_publickey(
                        &target.username,
                        PrivateKeyWithHashAlg::new(Arc::new(key), rsa_hash),
                    )
                    .await
                {
                    return Ok(());
                }
            }
        }
    }

    // 3. Saved password (Auto / Password)
    if matches!(
        target.auth_method,
        SshAuthMethod::Auto | SshAuthMethod::Password
    ) {
        if let Some(password) = secrets.password.as_deref() {
            if let Ok(AuthResult::Success) = handle
                .authenticate_password(&target.username, password)
                .await
            {
                return Ok(());
            }
            if try_keyboard_interactive_with_secret(handle, &target.username, password).await {
                return Ok(());
            }
        }
    }

    // 4. Interactive keyboard-interactive (2FA/PAM) and/or Password prompt
    if matches!(
        target.auth_method,
        SshAuthMethod::Auto | SshAuthMethod::Password
    ) {
        // First probe keyboard-interactive (supports 2FA / OTP / PAM prompts natively).
        if let Ok(kb_result) =
            try_keyboard_interactive_prompt(handle, target, options.prompter.as_ref()).await
        {
            if kb_result {
                return Ok(());
            }
        }

        // Fallback to standard password prompt (up to 2 attempts).
        for _ in 0..2 {
            let Some((values, save)) = options
                .prompter
                .prompt_auth(SshAuthPromptEvent {
                    challenge_id: String::new(),
                    host_id: target.host_id.clone(),
                    host_label: target.label.clone(),
                    kind: "password".into(),
                    instruction: Some(format!(
                        "请输入 {}@{} 的登录密码",
                        target.username, target.host
                    )),
                    prompts: vec![SshAuthPromptItem {
                        prompt: "密码".into(),
                        echo: false,
                    }],
                    allow_save: options.use_keyring,
                })
                .await?
            else {
                return Err("已取消 SSH 认证".into());
            };
            let password = values.first().map(String::as_str).unwrap_or("");
            let ok = matches!(
                handle
                    .authenticate_password(&target.username, password)
                    .await,
                Ok(AuthResult::Success)
            ) || try_keyboard_interactive_with_secret(handle, &target.username, password)
                .await;
            if ok {
                if save && options.use_keyring {
                    secrets.password = Some(password.to_owned());
                    let _ = credentials::save_secrets(&target.host_id, &secrets);
                }
                return Ok(());
            }
        }
    }

    Err(format!(
        "SSH 身份认证失败（{}@{}），请检查用户名、密钥或密码",
        target.username, target.host
    ))
}

async fn try_keyboard_interactive_with_secret(
    handle: &mut Handle<ClientHandler>,
    username: &str,
    secret: &str,
) -> bool {
    let Ok(mut state) = handle
        .authenticate_keyboard_interactive_start(username, None)
        .await
    else {
        return false;
    };
    for _ in 0..3 {
        match state {
            KeyboardInteractiveAuthResponse::Success => return true,
            KeyboardInteractiveAuthResponse::Failure { .. } => return false,
            KeyboardInteractiveAuthResponse::InfoRequest { prompts, .. } => {
                if prompts.len() > 1 {
                    return false;
                }
                let responses = if prompts.is_empty() {
                    Vec::new()
                } else {
                    vec![secret.to_owned()]
                };
                match handle
                    .authenticate_keyboard_interactive_respond(responses)
                    .await
                {
                    Ok(next) => state = next,
                    Err(_) => return false,
                }
            }
        }
    }
    false
}

async fn try_keyboard_interactive_prompt(
    handle: &mut Handle<ClientHandler>,
    target: &ResolvedSshTarget,
    prompter: &dyn SshChallengePrompter,
) -> Result<bool, String> {
    let Ok(mut state) = handle
        .authenticate_keyboard_interactive_start(&target.username, None)
        .await
    else {
        return Ok(false);
    };
    for _ in 0..4 {
        match state {
            KeyboardInteractiveAuthResponse::Success => return Ok(true),
            KeyboardInteractiveAuthResponse::Failure { .. } => return Ok(false),
            KeyboardInteractiveAuthResponse::InfoRequest {
                instructions,
                prompts,
                ..
            } => {
                if prompts.is_empty() {
                    state = handle
                        .authenticate_keyboard_interactive_respond(Vec::new())
                        .await
                        .map_err(|e| format!("SSH 交互认证失败：{e}"))?;
                    continue;
                }
                let ui_prompts = prompts
                    .iter()
                    .map(|p| SshAuthPromptItem {
                        prompt: p.prompt.clone(),
                        echo: p.echo,
                    })
                    .collect();
                let Some((responses, _)) = prompter
                    .prompt_auth(SshAuthPromptEvent {
                        challenge_id: String::new(),
                        host_id: target.host_id.clone(),
                        host_label: target.label.clone(),
                        kind: "keyboard-interactive".into(),
                        instruction: (!instructions.trim().is_empty()).then_some(instructions),
                        prompts: ui_prompts,
                        allow_save: false,
                    })
                    .await?
                else {
                    return Err("已取消 SSH 认证".into());
                };
                state = handle
                    .authenticate_keyboard_interactive_respond(responses)
                    .await
                    .map_err(|e| format!("SSH 交互认证失败：{e}"))?;
            }
        }
    }
    Ok(false)
}

async fn exec_on_handle(
    handle: &Handle<ClientHandler>,
    command: &str,
    stdin: Option<&[u8]>,
    stdout_limit: usize,
    stderr_limit: usize,
    timeout: Duration,
) -> Result<RemoteExecOutput, NativeError> {
    let work = async {
        let mut channel = handle
            .channel_open_session()
            .await
            .map_err(|e| NativeError::Message(format!("无法打开 SSH 执行通道：{e}")))?;
        channel
            .exec(true, command)
            .await
            .map_err(|e| NativeError::Message(format!("无法执行远端命令：{e}")))?;
        if let Some(input) = stdin {
            if !input.is_empty() {
                channel
                    .data(input)
                    .await
                    .map_err(|e| NativeError::Message(format!("无法发送远端命令输入：{e}")))?;
            }
            channel
                .eof()
                .await
                .map_err(|e| NativeError::Message(format!("无法结束远端命令输入：{e}")))?;
        }
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut exit_code: i32 = -1;
        while let Some(msg) = channel.wait().await {
            match msg {
                ChannelMsg::Data { data } => {
                    if stdout.len() + data.len() > stdout_limit {
                        let _ = channel.close().await;
                        return Err(NativeError::SizeLimit("远端命令输出超过大小限制"));
                    }
                    stdout.extend_from_slice(&data);
                }
                ChannelMsg::ExtendedData { data, ext } if ext == 1 => {
                    if stderr.len() + data.len() <= stderr_limit {
                        stderr.extend_from_slice(&data);
                    }
                }
                ChannelMsg::ExitStatus { exit_status } => {
                    exit_code = exit_status as i32;
                }
                ChannelMsg::Eof | ChannelMsg::Close => {}
                _ => {}
            }
        }
        Ok(RemoteExecOutput {
            exit_code,
            stdout,
            stderr,
        })
    };
    tokio::time::timeout(timeout, work)
        .await
        .map_err(|_| NativeError::Message("远端 SSH 命令执行超时".into()))?
}

async fn probe_remote(
    handle: &Handle<ClientHandler>,
) -> (RemoteServerCapabilities, Option<String>, Option<String>) {
    let script = concat!(
        "sh -c '",
        "printf \"OS:%s\\n\" \"$(uname -sm 2>/dev/null || true)\"; ",
        "printf \"HOME:%s\\n\" \"${HOME:-}\"; ",
        "command -v python3 >/dev/null 2>&1 && printf \"PY3:1\\n\" || printf \"PY3:0\\n\"; ",
        "if command -v sha256sum >/dev/null 2>&1; then printf \"SHA:sha256sum\\n\"; ",
        "elif command -v shasum >/dev/null 2>&1; then printf \"SHA:shasum\\n\"; ",
        "else printf \"SHA:none\\n\"; fi; ",
        "command -v git >/dev/null 2>&1 && printf \"GIT:1\\n\" || printf \"GIT:0\\n\"; ",
        "if command -v node >/dev/null 2>&1; then printf \"NODE:%s\\n\" \"$(node -v 2>/dev/null || true)\"; else printf \"NODE:\\n\"; fi; ",
        "(command -v inotifywait >/dev/null 2>&1 || command -v fswatch >/dev/null 2>&1) && printf \"WATCH:1\\n\" || printf \"WATCH:0\\n\"; ",
        "command -v codex >/dev/null 2>&1 && printf \"CODEX:1\\n\" || printf \"CODEX:0\\n\"; ",
        "command -v claude >/dev/null 2>&1 && printf \"CLAUDE:1\\n\" || printf \"CLAUDE:0\\n\"",
        "'"
    );
    let Ok(out) = exec_on_handle(
        handle,
        script,
        None,
        16 * 1024,
        8 * 1024,
        Duration::from_secs(8),
    )
    .await
    else {
        return (RemoteServerCapabilities::default(), None, None);
    };
    if out.exit_code != 0 {
        return (RemoteServerCapabilities::default(), None, None);
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut caps = RemoteServerCapabilities {
        shell: true,
        ..Default::default()
    };
    let mut home = None;
    let mut sha_tool = None;
    for line in text.lines() {
        if let Some(v) = line.strip_prefix("OS:") {
            let trimmed = v.trim();
            if !trimmed.is_empty() {
                caps.platform = Some(trimmed.to_owned());
            }
        } else if let Some(v) = line.strip_prefix("HOME:") {
            let trimmed = v.trim();
            if !trimmed.is_empty() {
                home = Some(trimmed.to_owned());
            }
        } else if let Some(v) = line.strip_prefix("PY3:") {
            caps.fast_scan = v.trim() == "1";
        } else if let Some(v) = line.strip_prefix("SHA:") {
            let trimmed = v.trim();
            if trimmed != "none" && !trimmed.is_empty() {
                sha_tool = Some(trimmed.to_owned());
            }
        } else if let Some(v) = line.strip_prefix("GIT:") {
            caps.git = v.trim() == "1";
        } else if let Some(v) = line.strip_prefix("NODE:") {
            let trimmed = v.trim();
            if !trimmed.is_empty() {
                caps.node = true;
                caps.node_version = Some(trimmed.to_owned());
            }
        } else if let Some(v) = line.strip_prefix("WATCH:") {
            caps.inotify = v.trim() == "1";
        } else if let Some(v) = line.strip_prefix("CODEX:") {
            caps.codex_cli = v.trim() == "1";
        } else if let Some(v) = line.strip_prefix("CLAUDE:") {
            caps.claude_cli = v.trim() == "1";
        }
    }
    (caps, home, sha_tool)
}

fn attrs_to_stat(attrs: &FileAttributes) -> RemoteStat {
    let ft = attrs.file_type();
    let size = attrs.size.unwrap_or(0);
    let modified_ms = u64::from(attrs.mtime.unwrap_or(0)) * 1000;
    let stamp = format!("sftp:{size}:{modified_ms}");
    RemoteStat {
        is_dir: ft.is_dir(),
        is_file: ft.is_file(),
        is_symlink: ft.is_symlink(),
        size,
        modified_ms,
        permissions: attrs.permissions,
        native_key: String::new(),
        stamp,
    }
}

fn map_sftp_err(context: &str, err: russh_sftp::client::error::Error) -> NativeError {
    match err {
        russh_sftp::client::error::Error::Status(status)
            if status.status_code == StatusCode::NoSuchFile =>
        {
            NativeError::NotFound("远端文件或目录不存在")
        }
        russh_sftp::client::error::Error::Status(status)
            if status.status_code == StatusCode::PermissionDenied =>
        {
            NativeError::Message(format!("{context}：远端服务器拒绝访问（权限不足）"))
        }
        other => NativeError::Message(format!("{context}：{other}")),
    }
}

#[async_trait]
impl RemoteTransport for SshSftpTransport {
    fn transport_kind(&self) -> &'static str {
        "sftp"
    }

    fn capabilities(&self) -> RemoteServerCapabilities {
        self.capabilities.clone()
    }

    async fn health_check(&self) -> Result<Duration, NativeError> {
        let started = Instant::now();
        self.sftp
            .symlink_metadata(&self.home)
            .await
            .map_err(|e| map_sftp_err("SSH 连接健康检查失败", e))?;
        Ok(started.elapsed())
    }

    async fn canonicalize_dir(&self, remote_path: &str) -> Result<String, NativeError> {
        let expanded = if remote_path == "~" {
            self.home.clone()
        } else if let Some(rest) = remote_path.strip_prefix("~/") {
            join_remote_posix(&self.home, rest)?
        } else {
            normalize_remote_posix_path(remote_path)?
        };
        let canonical = self
            .sftp
            .canonicalize(&expanded)
            .await
            .map_err(|e| map_sftp_err("无法访问远端目录，请确认路径存在", e))?;
        let canonical = normalize_remote_posix_path(&canonical)?;
        let meta = self
            .sftp
            .metadata(&canonical)
            .await
            .map_err(|e| map_sftp_err("无法读取远端目录属性", e))?;
        if !meta.file_type().is_dir() {
            return Err(NativeError::InvalidPath("请选择一个远端文件夹"));
        }
        Ok(canonical)
    }

    async fn home_dir(&self) -> Result<String, NativeError> {
        Ok(self.home.clone())
    }

    async fn list_dir(
        &self,
        remote_path: &str,
        include_hidden: bool,
    ) -> Result<Vec<RemoteDirEntry>, NativeError> {
        let dir = self.canonicalize_dir(remote_path).await?;
        let read_dir = self
            .sftp
            .read_dir(&dir)
            .await
            .map_err(|e| map_sftp_err("无法列出远端目录", e))?;
        let mut entries = Vec::new();
        for item in read_dir {
            let name = item.file_name();
            if name == "." || name == ".." {
                continue;
            }
            let is_hidden = name.starts_with('.');
            if is_hidden && !include_hidden {
                continue;
            }
            let attrs = item.metadata();
            let stat = attrs_to_stat(&attrs);
            let full = if dir == "/" {
                format!("/{name}")
            } else {
                format!("{dir}/{name}")
            };
            let kind = if stat.is_dir {
                "directory"
            } else if stat.is_file {
                "file"
            } else {
                "other"
            };
            entries.push(RemoteDirEntry {
                name,
                path: full,
                kind: kind.into(),
                size: stat.size,
                modified: stat.modified_ms,
                is_symlink: stat.is_symlink,
                is_hidden,
            });
        }
        entries.sort_by(|a, b| {
            let a_dir = a.kind == "directory";
            let b_dir = b.kind == "directory";
            b_dir
                .cmp(&a_dir)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(entries)
    }

    async fn lstat(&self, remote_path: &str) -> Result<Option<RemoteStat>, NativeError> {
        match self.sftp.symlink_metadata(remote_path).await {
            Ok(attrs) => Ok(Some(attrs_to_stat(&attrs))),
            Err(russh_sftp::client::error::Error::Status(status))
                if status.status_code == StatusCode::NoSuchFile =>
            {
                Ok(None)
            }
            Err(err) => Err(map_sftp_err("无法获取远端文件属性", err)),
        }
    }

    async fn scan_tree(
        &self,
        root: &str,
        limit: usize,
    ) -> Result<Vec<RemoteScannedEntry>, NativeError> {
        let root = normalize_remote_posix_path(root)?;
        if self.capabilities.fast_scan {
            match self.scan_tree_python(&root, limit).await {
                Ok(entries) => return Ok(entries),
                Err(NativeError::SizeLimit(msg)) => return Err(NativeError::SizeLimit(msg)),
                Err(_) => {
                    // Fall back to pure SFTP walk if python3 fails unexpectedly.
                }
            }
        }
        self.scan_tree_sftp(&root, limit).await
    }

    async fn batch_hash(
        &self,
        root: &str,
        relative_paths: &[String],
    ) -> Result<HashMap<String, String>, NativeError> {
        if relative_paths.is_empty() {
            return Ok(HashMap::new());
        }
        let root = normalize_remote_posix_path(root)?;
        for rel in relative_paths {
            storage::validate_relative_path(rel, is_workspace_data_path(rel))
                .map_err(NativeError::Message)?;
        }

        if self.capabilities.fast_scan {
            let script = r#"
import hashlib, os, stat, sys
root = sys.argv[1]
for line in sys.stdin:
    rel = line.rstrip("\n")
    if not rel:
        continue
    full = os.path.join(root, rel)
    try:
        st = os.lstat(full)
        if stat.S_ISLNK(st.st_mode) or not stat.S_ISREG(st.st_mode):
            continue
        h = hashlib.sha256()
        with open(full, "rb") as f:
            while True:
                chunk = f.read(65536)
                if not chunk:
                    break
                h.update(chunk)
        print(h.hexdigest() + "\t" + rel)
    except OSError:
        continue
"#;
            let cmd = format!(
                "python3 -c {} {}",
                shell_single_quote(script)?,
                shell_single_quote(&root)?
            );
            let stdin = format!("{}\n", relative_paths.join("\n"));
            if let Ok(out) = self
                .exec_bounded(
                    &cmd,
                    Some(stdin.as_bytes()),
                    8 * 1024 * 1024,
                    32 * 1024,
                    Duration::from_secs(60),
                )
                .await
            {
                if out.exit_code == 0 {
                    let mut map = HashMap::new();
                    for line in String::from_utf8_lossy(&out.stdout).lines() {
                        if let Some((digest, rel)) = line.split_once('\t') {
                            if digest.len() == 64 {
                                map.insert(rel.to_owned(), digest.to_owned());
                            }
                        }
                    }
                    return Ok(map);
                }
            }
        }

        // Pure SFTP fallback (bounded sequential/chunked read)
        let mut map = HashMap::with_capacity(relative_paths.len());
        for rel in relative_paths {
            let full = self.check_no_symlink_components(&root, rel).await?;
            if let Ok((bytes, _)) = self.read_bytes(&full, MAX_READ_BYTES).await {
                map.insert(rel.clone(), storage::hash(&bytes));
            }
        }
        Ok(map)
    }

    async fn read_bytes(
        &self,
        remote_path: &str,
        max_bytes: u64,
    ) -> Result<(Vec<u8>, RemoteStat), NativeError> {
        let path = normalize_remote_posix_path(remote_path)?;
        let stat = self
            .lstat(&path)
            .await?
            .ok_or(NativeError::NotFound("远端文件不存在"))?;
        if stat.is_symlink {
            return Err(NativeError::SymlinkEscape(
                "为保护工作空间，不跟随远端符号链接",
            ));
        }
        if !stat.is_file {
            return Err(NativeError::InvalidPath("远端路径不是普通文件"));
        }
        if stat.size > max_bytes {
            return Err(NativeError::SizeLimit("远端文件超过允许的大小限制"));
        }
        let mut file = self
            .sftp
            .open(&path)
            .await
            .map_err(|e| map_sftp_err("无法打开远端文件", e))?;
        let mut bytes = Vec::with_capacity(stat.size.min(1024 * 1024) as usize);
        let mut chunk = vec![0u8; 64 * 1024];
        loop {
            let n = file
                .read(&mut chunk)
                .await
                .map_err(|e| NativeError::Message(format!("读取远端文件失败：{e}")))?;
            if n == 0 {
                break;
            }
            if (bytes.len() + n) as u64 > max_bytes {
                let _ = file.close().await;
                return Err(NativeError::SizeLimit("远端文件超过允许的大小限制"));
            }
            bytes.extend_from_slice(&chunk[..n]);
        }
        let _ = file.close().await;
        Ok((bytes, stat))
    }

    async fn write_atomic_checked(
        &self,
        root: &str,
        relative: &str,
        bytes: &[u8],
        expected_hash: Option<&str>,
    ) -> Result<RemoteWriteCheckOutcome, NativeError> {
        storage::validate_relative_path(relative, is_workspace_data_path(relative))
            .map_err(NativeError::Message)?;
        let target = self.check_no_symlink_components(root, relative).await?;
        let existing = self.lstat(&target).await?;

        let preserve_mode = match (&existing, expected_hash) {
            (None, Some(_)) => return Ok(RemoteWriteCheckOutcome::Missing),
            (Some(_), None) => return Err(NativeError::AlreadyExists("同名文件已存在")),
            (Some(stat), Some(expected)) => {
                if stat.is_symlink || !stat.is_file {
                    return Err(NativeError::SymlinkEscape("目标不是工作区内的普通文件"));
                }
                let (current_bytes, current_stat) =
                    self.read_bytes(&target, MAX_READ_BYTES).await?;
                let current_hash = storage::hash(&current_bytes);
                if current_hash != expected {
                    return Ok(RemoteWriteCheckOutcome::Conflict {
                        current_bytes,
                        current_hash,
                        modified_ms: current_stat.modified_ms,
                    });
                }
                if current_bytes == bytes {
                    return Ok(RemoteWriteCheckOutcome::Saved {
                        modified_ms: current_stat.modified_ms,
                    });
                }
                stat.permissions
            }
            (None, None) => None,
        };

        let parent = target
            .rsplit_once('/')
            .map(|(p, _)| if p.is_empty() { "/" } else { p })
            .unwrap_or("/");
        let tmp_name = format!(".tano-{}.tmp", uuid::Uuid::new_v4());
        let tmp_path = if parent == "/" {
            format!("/{tmp_name}")
        } else {
            format!("{parent}/{tmp_name}")
        };

        let mut attrs = FileAttributes::empty();
        if let Some(mode) = preserve_mode {
            attrs.permissions = Some(mode & 0o777);
        }
        let mut file = self
            .sftp
            .open_with_flags_and_attributes(
                &tmp_path,
                OpenFlags::CREATE | OpenFlags::EXCLUDE | OpenFlags::WRITE,
                attrs,
            )
            .await
            .map_err(|e| map_sftp_err("无法创建远端临时文件", e))?;
        if let Err(err) = file.write_all(bytes).await {
            let _ = file.close().await;
            let _ = self.sftp.remove_file(&tmp_path).await;
            return Err(NativeError::Message(format!("写入远端临时文件失败：{err}")));
        }
        let _ = file.flush().await;
        if let Err(err) = file.close().await {
            let _ = self.sftp.remove_file(&tmp_path).await;
            return Err(NativeError::Message(format!("关闭远端临时文件失败：{err}")));
        }

        // Re-verify base hash right before atomic commit to shrink race window.
        if let Some(expected) = expected_hash {
            match self.lstat(&target).await? {
                None => {
                    let _ = self.sftp.remove_file(&tmp_path).await;
                    return Ok(RemoteWriteCheckOutcome::Missing);
                }
                Some(stat) if stat.is_symlink || !stat.is_file => {
                    let _ = self.sftp.remove_file(&tmp_path).await;
                    return Err(NativeError::SymlinkEscape("目标在写入期间已变为符号链接"));
                }
                Some(_) => {
                    let (latest_bytes, latest_stat) =
                        self.read_bytes(&target, MAX_READ_BYTES).await?;
                    let latest_hash = storage::hash(&latest_bytes);
                    if latest_hash != expected {
                        let _ = self.sftp.remove_file(&tmp_path).await;
                        return Ok(RemoteWriteCheckOutcome::Conflict {
                            current_bytes: latest_bytes,
                            current_hash: latest_hash,
                            modified_ms: latest_stat.modified_ms,
                        });
                    }
                }
            }
        }

        let commit_res = if expected_hash.is_none() {
            // SFTP v3 rename fails if destination exists (atomic noclobber create).
            self.sftp
                .rename(&tmp_path, &target)
                .await
                .map_err(|e| map_sftp_err("原子创建远端文件失败", e))
        } else if self.capabilities.shell {
            // Atomic POSIX rename(2) via `mv -f`.
            let cmd = format!(
                "mv -f -- {} {}",
                shell_single_quote(&tmp_path)?,
                shell_single_quote(&target)?
            );
            let out = self
                .exec_bounded(&cmd, None, 4096, 8192, Duration::from_secs(15))
                .await?;
            if out.exit_code == 0 {
                Ok(())
            } else {
                Err(NativeError::Message(format!(
                    "替换远端文件失败：{}",
                    String::from_utf8_lossy(&out.stderr).trim()
                )))
            }
        } else {
            // SFTP-only server fallback: rename existing to backup, move tmp in place, remove backup.
            let backup_path = if parent == "/" {
                format!("/.tano-bak-{}.tmp", uuid::Uuid::new_v4())
            } else {
                format!("{parent}/.tano-bak-{}.tmp", uuid::Uuid::new_v4())
            };
            self.sftp
                .rename(&target, &backup_path)
                .await
                .map_err(|e| map_sftp_err("无法暂存远端旧文件", e))?;
            match self.sftp.rename(&tmp_path, &target).await {
                Ok(()) => {
                    let _ = self.sftp.remove_file(&backup_path).await;
                    Ok(())
                }
                Err(err) => {
                    let _ = self.sftp.rename(&backup_path, &target).await;
                    Err(map_sftp_err("替换远端文件失败", err))
                }
            }
        };

        if let Err(err) = commit_res {
            let _ = self.sftp.remove_file(&tmp_path).await;
            return Err(err);
        }

        let updated = self
            .lstat(&target)
            .await?
            .map(|s| s.modified_ms)
            .unwrap_or(0);
        Ok(RemoteWriteCheckOutcome::Saved {
            modified_ms: updated,
        })
    }

    async fn write_atomic_replace(
        &self,
        remote_path: &str,
        bytes: &[u8],
    ) -> Result<RemoteStat, NativeError> {
        let target = normalize_remote_posix_path(remote_path)?;
        let parent = target
            .rsplit_once('/')
            .map(|(p, _)| if p.is_empty() { "/" } else { p })
            .unwrap_or("/");
        let tmp_name = format!(".tano-{}.tmp", uuid::Uuid::new_v4());
        let tmp_path = if parent == "/" {
            format!("/{tmp_name}")
        } else {
            format!("{parent}/{tmp_name}")
        };
        let mut file = self
            .sftp
            .open_with_flags(
                &tmp_path,
                OpenFlags::CREATE | OpenFlags::EXCLUDE | OpenFlags::WRITE,
            )
            .await
            .map_err(|e| map_sftp_err("无法创建远端临时文件", e))?;
        if let Err(err) = file.write_all(bytes).await {
            let _ = file.close().await;
            let _ = self.sftp.remove_file(&tmp_path).await;
            return Err(NativeError::Message(format!("写入远端文件失败：{err}")));
        }
        let _ = file.flush().await;
        file.close()
            .await
            .map_err(|e| NativeError::Message(format!("关闭远端文件失败：{e}")))?;

        let replaced = if self.capabilities.shell {
            let cmd = format!(
                "mv -f -- {} {}",
                shell_single_quote(&tmp_path)?,
                shell_single_quote(&target)?
            );
            let out = self
                .exec_bounded(&cmd, None, 4096, 8192, Duration::from_secs(15))
                .await?;
            if out.exit_code == 0 {
                Ok(())
            } else {
                Err(NativeError::Message(format!(
                    "原子替换远端文件失败：{}",
                    String::from_utf8_lossy(&out.stderr).trim()
                )))
            }
        } else {
            match self.sftp.rename(&tmp_path, &target).await {
                Ok(()) => Ok(()),
                Err(_) => {
                    let backup = format!("{tmp_path}.bak");
                    let _ = self.sftp.rename(&target, &backup).await;
                    match self.sftp.rename(&tmp_path, &target).await {
                        Ok(()) => {
                            let _ = self.sftp.remove_file(&backup).await;
                            Ok(())
                        }
                        Err(e) => {
                            let _ = self.sftp.rename(&backup, &target).await;
                            Err(map_sftp_err("替换远端文件失败", e))
                        }
                    }
                }
            }
        };
        if let Err(err) = replaced {
            let _ = self.sftp.remove_file(&tmp_path).await;
            return Err(err);
        }
        self.lstat(&target)
            .await?
            .ok_or(NativeError::NotFound("远端文件写入后无法读取状态"))
    }

    async fn mkdir(&self, remote_path: &str) -> Result<(), NativeError> {
        let path = normalize_remote_posix_path(remote_path)?;
        self.sftp
            .create_dir(&path)
            .await
            .map_err(|e| map_sftp_err("无法创建远端文件夹", e))
    }

    async fn mkdir_all(&self, remote_path: &str) -> Result<(), NativeError> {
        let path = normalize_remote_posix_path(remote_path)?;
        if path == "/" {
            return Ok(());
        }
        let mut current = String::new();
        for segment in path.split('/').filter(|s| !s.is_empty()) {
            current.push('/');
            current.push_str(segment);
            match self.lstat(&current).await? {
                Some(stat) if stat.is_dir && !stat.is_symlink => {}
                Some(stat) if stat.is_symlink => {
                    return Err(NativeError::SymlinkEscape("远端路径包含符号链接目录"));
                }
                Some(_) => {
                    return Err(NativeError::InvalidPath("远端父路径不是文件夹"));
                }
                None => {
                    self.sftp
                        .create_dir(&current)
                        .await
                        .map_err(|e| map_sftp_err("无法创建远端目录", e))?;
                }
            }
        }
        Ok(())
    }

    async fn rmdir(&self, remote_path: &str) -> Result<(), NativeError> {
        let path = normalize_remote_posix_path(remote_path)?;
        self.sftp
            .remove_dir(&path)
            .await
            .map_err(|e| map_sftp_err("远端文件夹不为空或无法移除", e))
    }

    async fn rename_noclobber(&self, from: &str, to: &str) -> Result<(), NativeError> {
        let from = normalize_remote_posix_path(from)?;
        let to = normalize_remote_posix_path(to)?;
        if self.lstat(&to).await?.is_some() {
            return Err(NativeError::AlreadyExists("目标名称已经存在"));
        }
        self.sftp
            .rename(&from, &to)
            .await
            .map_err(|e| map_sftp_err("重命名或移动远端条目失败", e))
    }

    async fn remove_file(&self, remote_path: &str) -> Result<(), NativeError> {
        let path = normalize_remote_posix_path(remote_path)?;
        self.sftp
            .remove_file(&path)
            .await
            .map_err(|e| map_sftp_err("删除远端文件失败", e))
    }

    async fn remove_dir_recursive(&self, remote_path: &str) -> Result<(), NativeError> {
        let root = normalize_remote_posix_path(remote_path)?;
        if root == "/" {
            return Err(NativeError::InvalidPath("拒绝删除根目录"));
        }
        let mut stack = vec![(root, false)];
        let mut visited = HashSet::new();
        while let Some((dir, expanded)) = stack.pop() {
            if expanded {
                self.sftp
                    .remove_dir(&dir)
                    .await
                    .map_err(|e| map_sftp_err("删除远端目录失败", e))?;
                continue;
            }
            if !visited.insert(dir.clone()) {
                continue;
            }
            stack.push((dir.clone(), true));
            let items = self
                .sftp
                .read_dir(&dir)
                .await
                .map_err(|e| map_sftp_err("读取远端目录失败", e))?;
            for item in items {
                let name = item.file_name();
                if name == "." || name == ".." {
                    continue;
                }
                let child = format!("{dir}/{name}");
                let stat = attrs_to_stat(&item.metadata());
                if stat.is_dir && !stat.is_symlink {
                    stack.push((child, false));
                } else {
                    self.sftp
                        .remove_file(&child)
                        .await
                        .map_err(|e| map_sftp_err("删除远端文件失败", e))?;
                }
            }
        }
        Ok(())
    }

    async fn exec_bounded(
        &self,
        command: &str,
        stdin: Option<&[u8]>,
        stdout_limit: usize,
        stderr_limit: usize,
        timeout: Duration,
    ) -> Result<RemoteExecOutput, NativeError> {
        if !self.capabilities.shell {
            return Err(NativeError::PlatformUnavailable(
                "当前远端服务器仅支持 SFTP，不支持远端 Shell 命令",
            ));
        }
        exec_on_handle(
            &self.handle,
            command,
            stdin,
            stdout_limit,
            stderr_limit,
            timeout,
        )
        .await
    }

    async fn exec_stream_lines(
        &self,
        command: &str,
        stdin_payload: Vec<u8>,
        max_bytes: usize,
        mut cancel: watch::Receiver<bool>,
        on_line: Box<dyn Fn(Vec<u8>) -> Result<(), String> + Send>,
    ) -> Result<(i32, Vec<u8>, Vec<u8>), NativeError> {
        if !self.capabilities.shell {
            return Err(NativeError::PlatformUnavailable(
                "当前远端服务器不支持执行远端 CLI",
            ));
        }
        let mut channel = self
            .handle
            .channel_open_session()
            .await
            .map_err(|e| NativeError::Message(format!("无法打开 SSH 流通道：{e}")))?;
        channel
            .exec(true, command)
            .await
            .map_err(|e| NativeError::Message(format!("无法启动远端 CLI：{e}")))?;
        if !stdin_payload.is_empty() {
            channel
                .data(&stdin_payload[..])
                .await
                .map_err(|e| NativeError::Message(format!("发送远端 CLI 输入失败：{e}")))?;
        }
        channel
            .eof()
            .await
            .map_err(|e| NativeError::Message(format!("关闭远端 CLI 输入失败：{e}")))?;

        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut pending_line = Vec::new();
        let mut exit_code = -1;

        loop {
            tokio::select! {
                _ = cancel.changed() => {
                    if *cancel.borrow() {
                        let _ = channel.close().await;
                        return Err(NativeError::Message("已停止远端生成".into()));
                    }
                }
                msg = channel.wait() => {
                    let Some(msg) = msg else { break; };
                    match msg {
                        ChannelMsg::Data { data } => {
                            if stdout.len() + data.len() > max_bytes {
                                let _ = channel.close().await;
                                return Err(NativeError::SizeLimit("远端 CLI 输出超过大小限制"));
                            }
                            stdout.extend_from_slice(&data);
                            pending_line.extend_from_slice(&data);
                            while let Some(pos) = pending_line.iter().position(|&b| b == b'\n') {
                                let line: Vec<u8> = pending_line.drain(..=pos).collect();
                                if let Err(err) = on_line(line) {
                                    let _ = channel.close().await;
                                    return Err(NativeError::Message(err));
                                }
                            }
                        }
                        ChannelMsg::ExtendedData { data, ext } if ext == 1 => {
                            if stderr.len() + data.len() <= 256 * 1024 {
                                stderr.extend_from_slice(&data);
                            }
                        }
                        ChannelMsg::ExitStatus { exit_status } => {
                            exit_code = exit_status as i32;
                        }
                        ChannelMsg::Close => break,
                        _ => {}
                    }
                }
            }
        }
        if !pending_line.is_empty() {
            if let Err(err) = on_line(pending_line) {
                return Err(NativeError::Message(err));
            }
        }
        Ok((exit_code, stdout, stderr))
    }

    async fn start_watch(
        &self,
        root: &str,
        poll_interval: Duration,
        tx: mpsc::Sender<RemoteWatchEvent>,
    ) -> Result<RemoteWatchHandle, NativeError> {
        let root = normalize_remote_posix_path(root)?;
        let (cancel_tx, mut cancel_rx) = watch::channel(false);
        let handle = self.handle.clone();
        let sftp = self.sftp.clone();
        let use_inotify = self.capabilities.inotify && self.capabilities.shell;
        let use_python = self.capabilities.fast_scan && self.capabilities.shell;
        let interval = poll_interval.clamp(Duration::from_secs(2), Duration::from_secs(60));

        tokio::spawn(async move {
            if use_inotify {
                if let Ok(quoted_root) = shell_single_quote(&root) {
                    let cmd = format!(
                        "if command -v inotifywait >/dev/null 2>&1; then \
                         inotifywait -m -r -q -e modify,create,delete,move,attrib \
                         --exclude '/(\\.git|node_modules|target|dist)(/|$)' -- {quoted_root}; \
                         elif command -v fswatch >/dev/null 2>&1; then \
                         fswatch -r --exclude '/(\\.git|node_modules|target|dist)(/|$)' {quoted_root}; fi"
                    );
                    if let Ok(mut channel) = handle.channel_open_session().await {
                        if channel.exec(true, cmd).await.is_ok() {
                            let mut last_emit = Instant::now() - Duration::from_secs(1);
                            loop {
                                tokio::select! {
                                    _ = cancel_rx.changed() => {
                                        if *cancel_rx.borrow() {
                                            let _ = channel.close().await;
                                            return;
                                        }
                                    }
                                    msg = channel.wait() => {
                                        match msg {
                                            Some(ChannelMsg::Data { data }) if !data.is_empty() => {
                                                if last_emit.elapsed() >= Duration::from_millis(250) {
                                                    last_emit = Instant::now();
                                                    if tx.send(RemoteWatchEvent::Changed).await.is_err() {
                                                        let _ = channel.close().await;
                                                        return;
                                                    }
                                                }
                                            }
                                            None | Some(ChannelMsg::Close) => break,
                                            _ => {}
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Adaptive lightweight fingerprint polling fallback.
            let mut last_fingerprint: Option<String> = None;
            loop {
                tokio::select! {
                    _ = cancel_rx.changed() => {
                        if *cancel_rx.borrow() {
                            return;
                        }
                    }
                    _ = tokio::time::sleep(interval) => {
                        let next = compute_light_fingerprint(&handle, &sftp, &root, use_python).await;
                        match next {
                            Ok(fp) => {
                                if let Some(prev) = &last_fingerprint {
                                    if prev != &fp {
                                        let _ = tx.send(RemoteWatchEvent::Changed).await;
                                    }
                                }
                                last_fingerprint = Some(fp);
                            }
                            Err(err) => {
                                let _ = tx.send(RemoteWatchEvent::Error(err)).await;
                            }
                        }
                    }
                }
            }
        });

        Ok(RemoteWatchHandle::new(cancel_tx))
    }

    async fn close(&self) {
        let _ = self.sftp.close().await;
        let _ = self
            .handle
            .disconnect(Disconnect::ByApplication, "Tano disconnected", "en")
            .await;
    }
}

async fn compute_light_fingerprint(
    handle: &Handle<ClientHandler>,
    sftp: &SftpSession,
    root: &str,
    use_python: bool,
) -> Result<String, String> {
    if use_python {
        let script = r#"
import hashlib, os, stat, sys
root = sys.argv[1]
h = hashlib.sha256()
IGNORED = {"node_modules", "target", "dist"}
for dirpath, dirnames, filenames in os.walk(root):
    rel_dir = os.path.relpath(dirpath, root)
    dirnames[:] = sorted(d for d in dirnames if not (d.startswith(".") and not (rel_dir == "." and d == ".tano")) and d not in IGNORED)
    for name in sorted(filenames):
        if name.startswith(".") and not rel_dir.startswith(".tano"):
            continue
        full = os.path.join(dirpath, name)
        try:
            st = os.lstat(full)
            if stat.S_ISLNK(st.st_mode):
                continue
            h.update(f"{rel_dir}/{name}:{st.st_size}:{getattr(st, 'st_mtime_ns', int(st.st_mtime))}\n".encode())
        except OSError:
            pass
print(h.hexdigest())
"#;
        let cmd = format!(
            "python3 -c {} {}",
            shell_single_quote(script).map_err(|e| e.to_string())?,
            shell_single_quote(root).map_err(|e| e.to_string())?
        );
        if let Ok(out) =
            exec_on_handle(handle, &cmd, None, 4096, 4096, Duration::from_secs(10)).await
        {
            if out.exit_code == 0 {
                return Ok(String::from_utf8_lossy(&out.stdout).trim().to_owned());
            }
        }
    }
    // Pure SFTP top-level + .tano mtime summary fallback
    let mut parts = Vec::new();
    for dir in [root.to_owned(), format!("{root}/.tano")] {
        if let Ok(entries) = sftp.read_dir(&dir).await {
            for entry in entries {
                let name = entry.file_name();
                if name == "." || name == ".." {
                    continue;
                }
                let m = entry.metadata();
                parts.push(format!(
                    "{dir}/{name}:{}:{}",
                    m.size.unwrap_or(0),
                    m.mtime.unwrap_or(0)
                ));
            }
        }
    }
    parts.sort();
    Ok(storage::hash(parts.join("\n").as_bytes()))
}
