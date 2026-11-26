// SPDX-License-Identifier: MIT
//! Real loopback SSH + SFTP integration test suite.
//! Runs an in-process `russh::server` + `russh_sftp::server` bound to `127.0.0.1:0`
//! backed by a local `TempDir`, verifying the real SSH/SFTP wire protocol offline.

use super::{
    challenges::SshChallengePrompter,
    config::ResolvedSshTarget,
    credentials::SshSecrets,
    sftp_transport::{ConnectOptions, SshSftpTransport},
    transport::{RemoteTransport, RemoteWriteCheckOutcome},
    types::{SshAuthMethod, SshAuthPromptEvent, SshHostKeyPromptEvent},
};
use crate::storage;
use async_trait::async_trait;
use russh::{
    keys::ssh_key::{private::Ed25519Keypair, PrivateKey, PublicKey},
    server::{self, Auth, ChannelOpenHandle, Msg, Server as _, Session, VerifiedPublicKey},
    Channel, ChannelId, MethodSet,
};
use russh_sftp::{
    protocol::{
        Attrs, Data, File, FileAttributes, Handle as SftpHandle, Name, OpenFlags, Status,
        StatusCode, Version,
    },
    server::Handler as SftpHandler,
};
use std::{
    collections::HashMap,
    fs,
    io::{Read, Seek, SeekFrom, Write},
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
};
use tokio::net::TcpListener;

struct LoopbackConfig {
    root: PathBuf,
    allowed_user: String,
    allowed_password: Option<String>,
    allowed_key: Option<PublicKey>,
    require_kb_code: Option<String>,
}

#[derive(Clone)]
struct LoopbackServer {
    cfg: Arc<LoopbackConfig>,
}

struct LoopbackConnHandler {
    cfg: Arc<LoopbackConfig>,
    channels: HashMap<ChannelId, Channel<Msg>>,
    kb_pending: bool,
}

impl server::Server for LoopbackServer {
    type Handler = LoopbackConnHandler;

    fn new_client(&mut self, _: Option<SocketAddr>) -> Self::Handler {
        LoopbackConnHandler {
            cfg: self.cfg.clone(),
            channels: HashMap::new(),
            kb_pending: false,
        }
    }
}

impl server::Handler for LoopbackConnHandler {
    type Error = russh::Error;

    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        if user == self.cfg.allowed_user && self.cfg.allowed_password.as_deref() == Some(password) {
            Ok(Auth::Accept)
        } else {
            Ok(Auth::reject())
        }
    }

    async fn auth_publickey(
        &mut self,
        user: &str,
        key: VerifiedPublicKey<'_>,
    ) -> Result<Auth, Self::Error> {
        if user == self.cfg.allowed_user
            && self
                .cfg
                .allowed_key
                .as_ref()
                .is_some_and(|allowed| allowed == key.public_key)
        {
            Ok(Auth::Accept)
        } else {
            Ok(Auth::reject())
        }
    }

    async fn auth_keyboard_interactive<'a>(
        &'a mut self,
        user: &str,
        _submethods: &str,
        response: Option<server::Response<'a>>,
    ) -> Result<Auth, Self::Error> {
        let Some(expected) = self.cfg.require_kb_code.as_deref() else {
            return Ok(Auth::Reject {
                proceed_with_methods: Some(MethodSet::server_supported()),
                partial_success: false,
            });
        };
        if user != self.cfg.allowed_user {
            return Ok(Auth::reject());
        }
        if !self.kb_pending {
            self.kb_pending = true;
            return Ok(Auth::Partial {
                name: "2FA".into(),
                instructions: "Enter OTP".into(),
                prompts: vec![("OTP: ".into(), false)].into(),
            });
        }
        self.kb_pending = false;
        let answer = response
            .and_then(|mut iter| iter.next())
            .map(|b| String::from_utf8_lossy(&b).into_owned())
            .unwrap_or_default();
        if answer == expected {
            Ok(Auth::Accept)
        } else {
            Ok(Auth::reject())
        }
    }

    async fn channel_open_session(
        &mut self,
        channel: Channel<Msg>,
        reply: ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.channels.insert(channel.id(), channel);
        reply.accept().await;
        Ok(())
    }

    async fn subsystem_request(
        &mut self,
        channel_id: ChannelId,
        name: &str,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        if name == "sftp" {
            if let Some(channel) = self.channels.remove(&channel_id) {
                session.channel_success(channel_id)?;
                let handler = LocalSftpBackend::new(self.cfg.root.clone());
                russh_sftp::server::run(channel.into_stream(), handler).await;
                return Ok(());
            }
        }
        session.channel_failure(channel_id)?;
        Ok(())
    }

    async fn exec_request(
        &mut self,
        channel_id: ChannelId,
        _data: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        // Simulates an SFTP-only server where POSIX shell is unavailable (exit 127),
        // ensuring our pure-SFTP path is thoroughly exercised on all platforms including Windows.
        session.channel_success(channel_id)?;
        session.exit_status_request(channel_id, 127)?;
        session.eof(channel_id)?;
        session.close(channel_id)?;
        self.channels.remove(&channel_id);
        Ok(())
    }
}

struct LocalSftpBackend {
    root: PathBuf,
    next_id: u64,
    files: HashMap<String, fs::File>,
    dirs: HashMap<String, Option<Vec<(String, FileAttributes)>>>,
}

impl LocalSftpBackend {
    fn new(root: PathBuf) -> Self {
        Self {
            root,
            next_id: 1,
            files: HashMap::new(),
            dirs: HashMap::new(),
        }
    }

    fn alloc_handle(&mut self) -> String {
        let id = self.next_id;
        self.next_id += 1;
        format!("h{id}")
    }

    fn resolve_local(&self, virtual_path: &str) -> PathBuf {
        let trimmed = virtual_path.trim();
        if trimmed.is_empty() || trimmed == "." || trimmed == "/" {
            return self.root.clone();
        }
        let rel = trimmed.trim_start_matches('/');
        self.root.join(rel)
    }

    fn to_virtual(&self, local: &Path) -> String {
        match local.strip_prefix(&self.root) {
            Ok(rel) if rel.as_os_str().is_empty() => "/".into(),
            Ok(rel) => format!("/{}", rel.to_string_lossy().replace('\\', "/")),
            Err(_) => "/".into(),
        }
    }

    fn metadata_to_attrs(meta: &fs::Metadata) -> FileAttributes {
        let mut attrs = FileAttributes::from(meta);
        if meta.file_type().is_symlink() {
            attrs.permissions = Some(0o120777);
        } else if meta.is_dir() {
            attrs.permissions = Some(0o040755);
        } else {
            attrs.permissions = Some(0o100644);
        }
        attrs
    }

    fn map_io(err: std::io::Error) -> StatusCode {
        match err.kind() {
            std::io::ErrorKind::NotFound => StatusCode::NoSuchFile,
            std::io::ErrorKind::PermissionDenied => StatusCode::PermissionDenied,
            _ => StatusCode::Failure,
        }
    }
}

impl SftpHandler for LocalSftpBackend {
    type Error = StatusCode;

    fn unimplemented(&self) -> Self::Error {
        StatusCode::OpUnsupported
    }

    async fn init(
        &mut self,
        _version: u32,
        _extensions: HashMap<String, String>,
    ) -> Result<Version, Self::Error> {
        Ok(Version::new())
    }

    async fn open(
        &mut self,
        id: u32,
        filename: String,
        pflags: OpenFlags,
        _attrs: FileAttributes,
    ) -> Result<SftpHandle, Self::Error> {
        let path = self.resolve_local(&filename);
        let mut opts = fs::OpenOptions::new();
        opts.read(pflags.contains(OpenFlags::READ));
        opts.write(pflags.contains(OpenFlags::WRITE));
        opts.truncate(pflags.contains(OpenFlags::TRUNCATE));
        if pflags.contains(OpenFlags::CREATE) && pflags.contains(OpenFlags::EXCLUDE) {
            opts.create_new(true);
        } else if pflags.contains(OpenFlags::CREATE) {
            opts.create(true);
        }
        let file = opts.open(&path).map_err(Self::map_io)?;
        let handle = self.alloc_handle();
        self.files.insert(handle.clone(), file);
        Ok(SftpHandle { id, handle })
    }

    async fn close(&mut self, id: u32, handle: String) -> Result<Status, Self::Error> {
        self.files.remove(&handle);
        self.dirs.remove(&handle);
        Ok(Status {
            id,
            status_code: StatusCode::Ok,
            error_message: String::new(),
            language_tag: "en".into(),
        })
    }

    async fn read(
        &mut self,
        id: u32,
        handle: String,
        offset: u64,
        len: u32,
    ) -> Result<Data, Self::Error> {
        let file = self.files.get_mut(&handle).ok_or(StatusCode::NoSuchFile)?;
        file.seek(SeekFrom::Start(offset)).map_err(Self::map_io)?;
        let mut buf = vec![0u8; (len as usize).min(256 * 1024)];
        let n = file.read(&mut buf).map_err(Self::map_io)?;
        if n == 0 {
            return Err(StatusCode::Eof);
        }
        buf.truncate(n);
        Ok(Data { id, data: buf })
    }

    async fn write(
        &mut self,
        id: u32,
        handle: String,
        offset: u64,
        data: Vec<u8>,
    ) -> Result<Status, Self::Error> {
        let file = self.files.get_mut(&handle).ok_or(StatusCode::NoSuchFile)?;
        file.seek(SeekFrom::Start(offset)).map_err(Self::map_io)?;
        file.write_all(&data).map_err(Self::map_io)?;
        Ok(Status {
            id,
            status_code: StatusCode::Ok,
            error_message: String::new(),
            language_tag: "en".into(),
        })
    }

    async fn lstat(&mut self, id: u32, path: String) -> Result<Attrs, Self::Error> {
        let local = self.resolve_local(&path);
        let meta = fs::symlink_metadata(&local).map_err(Self::map_io)?;
        Ok(Attrs {
            id,
            attrs: Self::metadata_to_attrs(&meta),
        })
    }

    async fn stat(&mut self, id: u32, path: String) -> Result<Attrs, Self::Error> {
        let local = self.resolve_local(&path);
        let meta = fs::metadata(&local).map_err(Self::map_io)?;
        Ok(Attrs {
            id,
            attrs: Self::metadata_to_attrs(&meta),
        })
    }

    async fn fstat(&mut self, id: u32, handle: String) -> Result<Attrs, Self::Error> {
        let file = self.files.get(&handle).ok_or(StatusCode::NoSuchFile)?;
        let meta = file.metadata().map_err(Self::map_io)?;
        Ok(Attrs {
            id,
            attrs: Self::metadata_to_attrs(&meta),
        })
    }

    async fn opendir(&mut self, id: u32, path: String) -> Result<SftpHandle, Self::Error> {
        let local = self.resolve_local(&path);
        let mut entries = Vec::new();
        for item in fs::read_dir(&local).map_err(Self::map_io)? {
            let item = item.map_err(Self::map_io)?;
            let name = item.file_name().to_string_lossy().into_owned();
            let meta = fs::symlink_metadata(item.path()).map_err(Self::map_io)?;
            entries.push((name, Self::metadata_to_attrs(&meta)));
        }
        let handle = self.alloc_handle();
        self.dirs.insert(handle.clone(), Some(entries));
        Ok(SftpHandle { id, handle })
    }

    async fn readdir(&mut self, id: u32, handle: String) -> Result<Name, Self::Error> {
        let slot = self.dirs.get_mut(&handle).ok_or(StatusCode::NoSuchFile)?;
        let Some(entries) = slot.take() else {
            return Err(StatusCode::Eof);
        };
        let files = entries
            .into_iter()
            .map(|(name, attrs)| File::new(name, attrs))
            .collect();
        Ok(Name { id, files })
    }

    async fn realpath(&mut self, id: u32, path: String) -> Result<Name, Self::Error> {
        let local = self.resolve_local(&path);
        let canonical = fs::canonicalize(&local).map_err(Self::map_io)?;
        let virt = self.to_virtual(&canonical);
        Ok(Name {
            id,
            files: vec![File::dummy(virt)],
        })
    }

    async fn mkdir(
        &mut self,
        id: u32,
        path: String,
        _attrs: FileAttributes,
    ) -> Result<Status, Self::Error> {
        fs::create_dir(self.resolve_local(&path)).map_err(Self::map_io)?;
        Ok(Status {
            id,
            status_code: StatusCode::Ok,
            error_message: String::new(),
            language_tag: "en".into(),
        })
    }

    async fn rmdir(&mut self, id: u32, path: String) -> Result<Status, Self::Error> {
        fs::remove_dir(self.resolve_local(&path)).map_err(Self::map_io)?;
        Ok(Status {
            id,
            status_code: StatusCode::Ok,
            error_message: String::new(),
            language_tag: "en".into(),
        })
    }

    async fn remove(&mut self, id: u32, filename: String) -> Result<Status, Self::Error> {
        fs::remove_file(self.resolve_local(&filename)).map_err(Self::map_io)?;
        Ok(Status {
            id,
            status_code: StatusCode::Ok,
            error_message: String::new(),
            language_tag: "en".into(),
        })
    }

    async fn rename(
        &mut self,
        id: u32,
        oldpath: String,
        newpath: String,
    ) -> Result<Status, Self::Error> {
        let old = self.resolve_local(&oldpath);
        let new = self.resolve_local(&newpath);
        if new.exists() {
            return Err(StatusCode::Failure);
        }
        fs::rename(old, new).map_err(Self::map_io)?;
        Ok(Status {
            id,
            status_code: StatusCode::Ok,
            error_message: String::new(),
            language_tag: "en".into(),
        })
    }
}

struct TestPrompter {
    trust_unknown: AtomicBool,
    seen_mismatch: AtomicBool,
    host_prompts: AtomicUsize,
    password_reply: Mutex<Option<String>>,
    kb_reply: Mutex<Option<String>>,
}

impl TestPrompter {
    fn trusting(password: Option<&str>, kb: Option<&str>) -> Arc<Self> {
        Arc::new(Self {
            trust_unknown: AtomicBool::new(true),
            seen_mismatch: AtomicBool::new(false),
            host_prompts: AtomicUsize::new(0),
            password_reply: Mutex::new(password.map(str::to_owned)),
            kb_reply: Mutex::new(kb.map(str::to_owned)),
        })
    }
}

#[async_trait]
impl SshChallengePrompter for TestPrompter {
    async fn prompt_host_key(&self, event: SshHostKeyPromptEvent) -> Result<bool, String> {
        self.host_prompts.fetch_add(1, Ordering::SeqCst);
        if event.mismatch {
            self.seen_mismatch.store(true, Ordering::SeqCst);
            return Ok(false);
        }
        Ok(self.trust_unknown.load(Ordering::SeqCst))
    }

    async fn prompt_auth(
        &self,
        event: SshAuthPromptEvent,
    ) -> Result<Option<(Vec<String>, bool)>, String> {
        if event.kind == "keyboard-interactive" {
            let reply = self.kb_reply.lock().unwrap().clone();
            return Ok(reply.map(|v| (vec![v], false)));
        }
        let reply = self.password_reply.lock().unwrap().clone();
        Ok(reply.map(|v| (vec![v], false)))
    }
}

async fn spawn_loopback_server(
    host_seed: [u8; 32],
    cfg: LoopbackConfig,
) -> (u16, tokio::task::JoinHandle<()>) {
    let host_key = PrivateKey::from(Ed25519Keypair::from_seed(&host_seed));
    let mut server_cfg = server::Config::default();
    server_cfg.keys.push(host_key);
    server_cfg.auth_rejection_time = std::time::Duration::from_millis(10);
    server_cfg.auth_rejection_time_initial = Some(std::time::Duration::from_millis(0));
    let server_cfg = Arc::new(server_cfg);

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let mut ssh_server = LoopbackServer { cfg: Arc::new(cfg) };
    let task = tokio::spawn(async move {
        let _ = ssh_server.run_on_socket(server_cfg, &listener).await;
    });
    (port, task)
}

fn target_for_port(
    port: u16,
    auth_method: SshAuthMethod,
    key: Option<PathBuf>,
) -> ResolvedSshTarget {
    ResolvedSshTarget {
        host_id: "test-loopback".into(),
        label: "Loopback".into(),
        host: "127.0.0.1".into(),
        port,
        username: "tester".into(),
        config_alias: None,
        auth_method,
        identity_files: key.into_iter().collect(),
        identities_only: true,
        proxy_jump: Vec::new(),
        proxy_command: None,
        forward_agent: false,
        connect_timeout_secs: 10,
        keepalive_secs: 15,
    }
}

#[tokio::test]
async fn loopback_ssh_verifies_tofu_mitm_auth_sftp_scan_and_base_hash_writes() {
    let remote_root = tempfile::tempdir().unwrap();
    let canonical_root = fs::canonicalize(remote_root.path()).unwrap();
    fs::create_dir(canonical_root.join("project")).unwrap();
    fs::write(canonical_root.join("project/note.md"), "# Hello\n").unwrap();
    fs::create_dir(canonical_root.join("project/node_modules")).unwrap();
    fs::write(
        canonical_root.join("project/node_modules/ignored.md"),
        "skip",
    )
    .unwrap();

    let app_data = tempfile::tempdir().unwrap();
    let (port, server_task) = spawn_loopback_server(
        [7u8; 32],
        LoopbackConfig {
            root: canonical_root.clone(),
            allowed_user: "tester".into(),
            allowed_password: Some("s3cr3t!".into()),
            allowed_key: None,
            require_kb_code: None,
        },
    )
    .await;

    // 1. First connection prompts for TOFU host key and authenticates with password.
    let prompter = TestPrompter::trusting(Some("s3cr3t!"), None);
    let (transport, _) = SshSftpTransport::connect(
        target_for_port(port, SshAuthMethod::Password, None),
        ConnectOptions {
            app_data: app_data.path().to_path_buf(),
            prompter: prompter.clone(),
            secrets_override: Some(SshSecrets::default()),
            use_keyring: false,
            use_os_agent: false,
        },
    )
    .await
    .unwrap();
    assert_eq!(prompter.host_prompts.load(Ordering::SeqCst), 1);

    // 2. Directory listing & scan respect ignored directories.
    let listed = transport.list_dir("/project", false).await.unwrap();
    assert!(listed.iter().any(|e| e.name == "note.md"));
    let scanned = transport.scan_tree("/project", 1000).await.unwrap();
    assert!(scanned.iter().any(|e| e.path == "note.md"));
    assert!(!scanned.iter().any(|e| e.path.contains("node_modules")));

    // 3. Atomic compare-and-swap write & conflict detection.
    let (initial_bytes, _) = transport
        .read_bytes("/project/note.md", 1024 * 1024)
        .await
        .unwrap();
    let initial_hash = storage::hash(&initial_bytes);
    let saved = transport
        .write_atomic_checked("/project", "note.md", b"# Updated\n", Some(&initial_hash))
        .await
        .unwrap();
    assert!(matches!(saved, RemoteWriteCheckOutcome::Saved { .. }));

    // Stale hash must return Conflict without overwriting!
    let conflict = transport
        .write_atomic_checked("/project", "note.md", b"# Stale\n", Some(&initial_hash))
        .await
        .unwrap();
    match conflict {
        RemoteWriteCheckOutcome::Conflict { current_bytes, .. } => {
            assert_eq!(current_bytes, b"# Updated\n");
        }
        _ => panic!("expected Conflict on stale hash"),
    }
    assert_eq!(
        fs::read(canonical_root.join("project/note.md")).unwrap(),
        b"# Updated\n"
    );

    // 4. Exclusive create rejects existing target.
    assert!(transport
        .write_atomic_checked("/project", "note.md", b"dup", None)
        .await
        .is_err());
    assert!(matches!(
        transport
            .write_atomic_checked("/project", "new.ts", b"export const x = 1;\n", None)
            .await
            .unwrap(),
        RemoteWriteCheckOutcome::Saved { .. }
    ));

    transport.close().await;
    server_task.abort();

    // 5. MITM defense: different server key on same host:port MUST hard-block.
    let (port2, server_task2) = spawn_loopback_server(
        [99u8; 32],
        LoopbackConfig {
            root: canonical_root.clone(),
            allowed_user: "tester".into(),
            allowed_password: Some("s3cr3t!".into()),
            allowed_key: None,
            require_kb_code: None,
        },
    )
    .await;
    // Reuse trusted key from port under port2 first, then swap server key!
    let prompter_ok = TestPrompter::trusting(Some("s3cr3t!"), None);
    let (t2, _) = SshSftpTransport::connect(
        target_for_port(port2, SshAuthMethod::Password, None),
        ConnectOptions {
            app_data: app_data.path().to_path_buf(),
            prompter: prompter_ok,
            secrets_override: Some(SshSecrets {
                password: Some("s3cr3t!".into()),
                passphrase: None,
            }),
            use_keyring: false,
            use_os_agent: false,
        },
    )
    .await
    .unwrap();
    t2.close().await;
    server_task2.abort();

    // Replace known_hosts fingerprint for port2 with a different key to simulate host-key change.
    let other_key = PrivateKey::from(Ed25519Keypair::from_seed(&[42u8; 32]));
    let kh_path = super::known_hosts::tano_known_hosts_path(app_data.path());
    fs::write(&kh_path, "").unwrap();
    super::known_hosts::trust_host_key(app_data.path(), "127.0.0.1", port2, other_key.public_key())
        .unwrap();

    let (port3, server_task3) = spawn_loopback_server(
        [99u8; 32],
        LoopbackConfig {
            root: canonical_root,
            allowed_user: "tester".into(),
            allowed_password: Some("s3cr3t!".into()),
            allowed_key: None,
            require_kb_code: None,
        },
    )
    .await;
    // Record mismatched key for port3
    super::known_hosts::trust_host_key(app_data.path(), "127.0.0.1", port3, other_key.public_key())
        .unwrap();
    let prompter_mitm = TestPrompter::trusting(Some("s3cr3t!"), None);
    let err = SshSftpTransport::connect(
        target_for_port(port3, SshAuthMethod::Password, None),
        ConnectOptions {
            app_data: app_data.path().to_path_buf(),
            prompter: prompter_mitm.clone(),
            secrets_override: Some(SshSecrets {
                password: Some("s3cr3t!".into()),
                passphrase: None,
            }),
            use_keyring: false,
            use_os_agent: false,
        },
    )
    .await
    .err()
    .expect("MITM key mismatch must be rejected");
    assert!(err.contains("指纹已发生变化"), "{err}");
    assert!(prompter_mitm.seen_mismatch.load(Ordering::SeqCst));
    server_task3.abort();
}

#[tokio::test]
async fn loopback_ssh_authenticates_with_private_key_and_keyboard_interactive() {
    let remote_root = tempfile::tempdir().unwrap();
    let canonical_root = fs::canonicalize(remote_root.path()).unwrap();
    let app_data = tempfile::tempdir().unwrap();

    let client_key = PrivateKey::from(Ed25519Keypair::from_seed(&[11u8; 32]));
    let key_path = app_data.path().join("id_test");
    fs::write(
        &key_path,
        client_key
            .to_openssh(russh::keys::ssh_key::LineEnding::LF)
            .unwrap()
            .as_str(),
    )
    .unwrap();

    let (port, server_task) = spawn_loopback_server(
        [15u8; 32],
        LoopbackConfig {
            root: canonical_root.clone(),
            allowed_user: "tester".into(),
            allowed_password: None,
            allowed_key: Some(client_key.public_key().clone()),
            require_kb_code: None,
        },
    )
    .await;

    let (t_key, _) = SshSftpTransport::connect(
        target_for_port(port, SshAuthMethod::Key, Some(key_path)),
        ConnectOptions {
            app_data: app_data.path().to_path_buf(),
            prompter: TestPrompter::trusting(None, None),
            secrets_override: Some(SshSecrets::default()),
            use_keyring: false,
            use_os_agent: false,
        },
    )
    .await
    .unwrap();
    assert_eq!(t_key.home_dir().await.unwrap(), "/");
    t_key.close().await;
    server_task.abort();

    // Keyboard-interactive 2FA auth test
    let (port_kb, server_task_kb) = spawn_loopback_server(
        [16u8; 32],
        LoopbackConfig {
            root: canonical_root,
            allowed_user: "tester".into(),
            allowed_password: None,
            allowed_key: None,
            require_kb_code: Some("654321".into()),
        },
    )
    .await;
    let (t_kb, _) = SshSftpTransport::connect(
        target_for_port(port_kb, SshAuthMethod::Password, None),
        ConnectOptions {
            app_data: app_data.path().to_path_buf(),
            prompter: TestPrompter::trusting(None, Some("654321")),
            secrets_override: Some(SshSecrets::default()),
            use_keyring: false,
            use_os_agent: false,
        },
    )
    .await
    .unwrap();
    t_kb.close().await;
    server_task_kb.abort();
}

#[tokio::test]
async fn remote_workspace_storage_preserves_identities_dotfile_boundary_code_editing_trash_and_assets(
) {
    use super::storage as remote_storage;
    use super::types::RemoteTrashMode;

    let remote_root = tempfile::tempdir().unwrap();
    let canonical_root = fs::canonicalize(remote_root.path()).unwrap();
    fs::create_dir_all(canonical_root.join("project/sub")).unwrap();
    fs::write(
        canonical_root.join("project/guide.md"),
        "# Remote Guide\n\nSearchableNeedle42\n",
    )
    .unwrap();
    fs::write(
        canonical_root.join("project/app.ts"),
        "export const version = 1;\n",
    )
    .unwrap();
    fs::write(
        canonical_root.join("project/.env"),
        "SECRET_TOKEN=do-not-expose\n",
    )
    .unwrap();
    fs::write(
        canonical_root.join("project/sub/readme.md"),
        "# Nested Doc\n",
    )
    .unwrap();

    let app_data = tempfile::tempdir().unwrap();
    let cache = app_data.path().join("index.sqlite");
    let backups = app_data.path().join("backups");

    let (port, server_task) = spawn_loopback_server(
        [23u8; 32],
        LoopbackConfig {
            root: canonical_root.clone(),
            allowed_user: "tester".into(),
            allowed_password: Some("pw".into()),
            allowed_key: None,
            require_kb_code: None,
        },
    )
    .await;

    let (transport, _) = SshSftpTransport::connect(
        target_for_port(port, SshAuthMethod::Password, None),
        ConnectOptions {
            app_data: app_data.path().to_path_buf(),
            prompter: TestPrompter::trusting(Some("pw"), None),
            secrets_override: Some(SshSecrets::default()),
            use_keyring: false,
            use_os_agent: false,
        },
    )
    .await
    .unwrap();

    // 1. Initialize .tano/config.json on remote server and scan workspace.
    let (ws_id, created) = remote_storage::ensure_workspace_identity(&transport, "/project")
        .await
        .unwrap();
    assert!(created);
    assert!(canonical_root.join("project/.tano/config.json").exists());

    let uri = "ssh://test-loopback/project";
    let ws = remote_storage::remote_scan(
        &transport,
        "/project",
        uri,
        "test-loopback",
        "Loopback",
        &ws_id,
        &cache,
        Some(12),
    )
    .await
    .unwrap();
    assert_eq!(ws.id, ws_id);
    assert_eq!(ws.path, uri);
    assert!(ws.remote.is_some());
    assert!(ws.files.iter().any(|e| e.path == "guide.md"));
    assert!(ws.files.iter().any(|e| e.path == "app.ts"));
    assert!(ws.files.iter().any(|e| e.path == "sub/readme.md"));
    // Dotfile boundary: .env MUST NOT be exposed!
    assert!(!ws.files.iter().any(|e| e.path == ".env"));
    assert!(canonical_root
        .join("project/.tano/identities.json")
        .exists());

    let guide_id = ws
        .files
        .iter()
        .find(|e| e.path == "guide.md")
        .unwrap()
        .id
        .clone();
    assert!(!guide_id.is_empty());

    // FTS5 search indexes remote markdown content into local cache.
    let hits = storage::search::query(&cache, &ws_id, "SearchableNeedle42").unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].path, "guide.md");

    // 2. Delete local index.sqlite and re-scan -> short ID MUST survive from remote .tano/identities.json!
    fs::remove_file(&cache).unwrap();
    let ws_rebuilt = remote_storage::remote_scan(
        &transport,
        "/project",
        uri,
        "test-loopback",
        "Loopback",
        &ws_id,
        &cache,
        Some(10),
    )
    .await
    .unwrap();
    let rebuilt_guide_id = ws_rebuilt
        .files
        .iter()
        .find(|e| e.path == "guide.md")
        .unwrap()
        .id
        .clone();
    assert_eq!(rebuilt_guide_id, guide_id);

    // 3. Dotfiles rejected on read/write; code files support base-hash CAS & reject NUL bytes.
    assert!(
        remote_storage::remote_read_document(&transport, "/project", &ws_id, ".env")
            .await
            .is_err()
    );
    let code_snap = remote_storage::remote_read_document(&transport, "/project", &ws_id, "app.ts")
        .await
        .unwrap();
    assert_eq!(code_snap.content, "export const version = 1;\n");

    let saved_code = remote_storage::remote_write_document(
        &transport,
        "/project",
        &ws_id,
        "app.ts",
        "export const version = 2;\n",
        &code_snap.hash,
    )
    .await
    .unwrap();
    assert!(matches!(saved_code, storage::WriteResult::Saved { .. }));

    // Stale base hash returns Conflict with remote's latest content!
    let conflict_code = remote_storage::remote_write_document(
        &transport,
        "/project",
        &ws_id,
        "app.ts",
        "export const version = 999;\n",
        &code_snap.hash,
    )
    .await
    .unwrap();
    match conflict_code {
        storage::WriteResult::Conflict { snapshot } => {
            assert_eq!(snapshot.content, "export const version = 2;\n");
        }
        other => panic!("expected Conflict, got {other:?}"),
    }

    // NUL bytes rejected for code file writes.
    assert!(remote_storage::remote_write_document(
        &transport,
        "/project",
        &ws_id,
        "app.ts",
        "bad\0content",
        &storage::hash(b"export const version = 2;\n"),
    )
    .await
    .is_err());

    // 4. Create, rename/move (preserving short ID), duplicate, folder create/remove, and remote trash.
    remote_storage::remote_create_document(&transport, "/project", &ws_id, "notes.md", "# Notes\n")
        .await
        .unwrap();
    remote_storage::remote_create_folder(&transport, "/project", &ws_id, "empty_dir")
        .await
        .unwrap();
    remote_storage::remote_remove_empty_folder(&transport, "/project", &ws_id, "empty_dir")
        .await
        .unwrap();
    remote_storage::remote_move_entry(
        &transport,
        "/project",
        &ws_id,
        &cache,
        "guide.md",
        "guide-renamed.md",
    )
    .await
    .unwrap();
    let ws_after_move = remote_storage::remote_scan(
        &transport,
        "/project",
        uri,
        "test-loopback",
        "Loopback",
        &ws_id,
        &cache,
        None,
    )
    .await
    .unwrap();
    let moved_id = ws_after_move
        .files
        .iter()
        .find(|e| e.path == "guide-renamed.md")
        .unwrap()
        .id
        .clone();
    assert_eq!(moved_id, guide_id);

    let duplicated =
        remote_storage::remote_duplicate_entry(&transport, "/project", &ws_id, "notes.md")
            .await
            .unwrap();
    assert!(canonical_root.join("project").join(&duplicated).exists());

    // Remote trash moves file under ~/.tano/trash/<ws_id>/ instead of permanent unlink.
    remote_storage::remote_remove_entry(
        &transport,
        "/project",
        &ws_id,
        &duplicated,
        RemoteTrashMode::RemoteTrash,
    )
    .await
    .unwrap();
    assert!(!canonical_root.join("project").join(&duplicated).exists());
    let trash_dir = canonical_root.join(".tano/trash").join(&ws_id);
    assert!(trash_dir.exists());
    assert!(fs::read_dir(&trash_dir).unwrap().next().is_some());

    // 5. Attachment import, read, and tano-asset:// response with LRU cache & security headers.
    let tiny_png: &[u8] = &[
        0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, b'I', b'H', b'D',
        b'R', 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90,
        0x77, 0x53, 0xDE,
    ];
    let imported = remote_storage::remote_import_attachment(
        &transport, "/project", &ws_id, "shot.png", tiny_png, true,
    )
    .await
    .unwrap();
    let imported_json = serde_json::to_value(&imported).unwrap();
    assert_eq!(imported_json["image"], serde_json::json!(true));
    let imported_path = imported_json["path"].as_str().unwrap().to_owned();
    assert!(imported_path.starts_with("assets/"));
    let read_back =
        remote_storage::remote_read_attachment(&transport, "/project", &ws_id, &imported_path)
            .await
            .unwrap();
    assert_eq!(read_back, tiny_png);

    let asset_cache = Mutex::new(remote_storage::AssetCache::default());
    let asset_req = tauri::http::Request::builder()
        .method("GET")
        .uri(format!("tano-asset://localhost/{ws_id}/{imported_path}"))
        .header("Origin", "http://localhost:5173")
        .body(Vec::new())
        .unwrap();
    let resp = remote_storage::remote_respond_asset(
        &transport,
        "/project",
        &ws_id,
        &asset_cache,
        &asset_req,
    )
    .await;
    assert_eq!(resp.status(), tauri::http::StatusCode::OK);
    assert_eq!(resp.headers().get("Content-Type").unwrap(), "image/png");
    assert_eq!(
        resp.headers().get("X-Content-Type-Options").unwrap(),
        "nosniff"
    );
    assert_eq!(resp.body(), tiny_png);

    // 6. Excel spreadsheet backup + base-hash CAS save.
    let initial_xlsx = b"PK\x03\x04initial-workbook";
    let updated_xlsx = b"PK\x03\x04updated-workbook";
    fs::write(canonical_root.join("project/data.xlsx"), initial_xlsx).unwrap();
    let backup_path = remote_storage::remote_write_spreadsheet(
        &transport,
        "/project",
        &ws_id,
        "data.xlsx",
        updated_xlsx,
        &storage::hash(initial_xlsx),
        &backups,
    )
    .await
    .unwrap();
    assert!(Path::new(&backup_path).exists());
    assert_eq!(fs::read(&backup_path).unwrap(), initial_xlsx);
    assert_eq!(
        fs::read(canonical_root.join("project/data.xlsx")).unwrap(),
        updated_xlsx
    );

    transport.close().await;
    server_task.abort();
}

#[test]
fn recent_workspaces_preserves_ssh_entries_without_local_fs_pruning() {
    use super::types::{RemoteConnectionPhase, RemoteServerCapabilities, RemoteWorkspaceInfo};
    use crate::session_storage;

    let dir = tempfile::tempdir().unwrap();
    let cache = dir.path().join("index.sqlite");
    let ws = storage::Workspace {
        id: uuid::Uuid::new_v4().to_string(),
        name: "prod-docs".into(),
        path: "ssh://prod/srv/docs".into(),
        files: Vec::new(),
        newly_created: None,
        reinitialized: None,
        remote: Some(RemoteWorkspaceInfo {
            kind: "ssh".into(),
            host_id: "prod".into(),
            host_label: "Production".into(),
            remote_path: "/srv/docs".into(),
            status: RemoteConnectionPhase::Connected,
            latency_ms: Some(18),
            transport: "sftp".into(),
            capabilities: Some(RemoteServerCapabilities::default()),
            git_repo: None,
        }),
    };
    session_storage::record(&cache, &ws).unwrap();

    let recents = session_storage::recent(&cache).unwrap();
    assert_eq!(recents.len(), 1);
    assert_eq!(recents[0].path, "ssh://prod/srv/docs");
    assert_eq!(
        recents[0].remote.as_ref().map(|r| r.host_id.as_str()),
        Some("prod")
    );

    session_storage::unregister_remote(&cache, &ws.id, &ws.path).unwrap();
    assert!(session_storage::recent(&cache).unwrap().is_empty());
}
