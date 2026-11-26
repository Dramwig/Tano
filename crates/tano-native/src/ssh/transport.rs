// SPDX-License-Identifier: MIT
//! Two-tier RemoteTransport abstraction.
//! Phase 1 implements `SshSftpTransport` (zero-install SFTP + lightweight exec).
//! Phase 2 can drop in `HelperTransport` (persistent `tano-remote-helper` over stdio JSON-RPC)
//! without changing RemoteSession, IPC handlers, or the frontend.

use super::types::{RemoteDirEntry, RemoteServerCapabilities};
use crate::error::NativeError;
use async_trait::async_trait;
use std::collections::HashMap;
use std::time::Duration;
use tokio::sync::{mpsc, watch};

#[derive(Clone, Debug)]
pub struct RemoteStat {
    pub is_dir: bool,
    pub is_file: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub modified_ms: u64,
    pub permissions: Option<u32>,
    /// Stable filesystem identity (`dev:ino`) when provided by fast scan, else empty.
    pub native_key: String,
    /// Metadata stamp (`dev:ino:size:mtime_ns:ctime_ns` or `size:mtime_ms`) for incremental cache.
    pub stamp: String,
}

#[derive(Clone, Debug)]
pub struct RemoteScannedEntry {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified_ms: u64,
    pub native_key: String,
    pub stamp: String,
}

#[derive(Clone, Debug)]
pub struct RemoteExecOutput {
    pub exit_code: i32,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

#[derive(Clone, Debug)]
pub enum RemoteWatchEvent {
    Changed,
    Error(String),
}

pub struct RemoteWatchHandle {
    cancel_tx: watch::Sender<bool>,
}

impl RemoteWatchHandle {
    pub fn new(cancel_tx: watch::Sender<bool>) -> Self {
        Self { cancel_tx }
    }

    pub fn stop(&self) {
        let _ = self.cancel_tx.send(true);
    }
}

impl Drop for RemoteWatchHandle {
    fn drop(&mut self) {
        self.stop();
    }
}

pub enum RemoteWriteCheckOutcome {
    Saved {
        modified_ms: u64,
    },
    Conflict {
        current_bytes: Vec<u8>,
        current_hash: String,
        modified_ms: u64,
    },
    Missing,
}

#[async_trait]
pub trait RemoteTransport: Send + Sync {
    fn transport_kind(&self) -> &'static str;
    fn capabilities(&self) -> RemoteServerCapabilities;
    async fn health_check(&self) -> Result<Duration, NativeError>;

    async fn canonicalize_dir(&self, remote_path: &str) -> Result<String, NativeError>;
    async fn home_dir(&self) -> Result<String, NativeError>;
    async fn list_dir(
        &self,
        remote_path: &str,
        include_hidden: bool,
    ) -> Result<Vec<RemoteDirEntry>, NativeError>;

    async fn lstat(&self, remote_path: &str) -> Result<Option<RemoteStat>, NativeError>;
    async fn scan_tree(
        &self,
        root: &str,
        limit: usize,
    ) -> Result<Vec<RemoteScannedEntry>, NativeError>;

    /// Compute SHA-256 hex digests for a batch of relative paths under `root`.
    /// Implementations with POSIX shell execute a single batched remote hash command;
    /// SFTP-only implementations stream and hash files locally.
    async fn batch_hash(
        &self,
        root: &str,
        relative_paths: &[String],
    ) -> Result<HashMap<String, String>, NativeError>;

    async fn read_bytes(
        &self,
        remote_path: &str,
        max_bytes: u64,
    ) -> Result<(Vec<u8>, RemoteStat), NativeError>;

    /// Write bytes atomically into `root/relative` via temp file + fsync + rename.
    /// - `expected_hash = Some(h)`: verify existing file SHA-256 equals `h`, returning `Conflict`
    ///   or `Missing` without modifying the target if mismatched.
    /// - `expected_hash = None`: exclusive create (fails with `AlreadyExists` if target exists).
    async fn write_atomic_checked(
        &self,
        root: &str,
        relative: &str,
        bytes: &[u8],
        expected_hash: Option<&str>,
    ) -> Result<RemoteWriteCheckOutcome, NativeError>;

    /// Unconditional atomic write (temp + atomic replace), used for `.tano/identities.json`
    /// after explicit compare/lock checks at a higher layer.
    async fn write_atomic_replace(
        &self,
        remote_path: &str,
        bytes: &[u8],
    ) -> Result<RemoteStat, NativeError>;

    async fn mkdir(&self, remote_path: &str) -> Result<(), NativeError>;
    async fn mkdir_all(&self, remote_path: &str) -> Result<(), NativeError>;
    async fn rmdir(&self, remote_path: &str) -> Result<(), NativeError>;
    async fn rename_noclobber(&self, from: &str, to: &str) -> Result<(), NativeError>;
    async fn remove_file(&self, remote_path: &str) -> Result<(), NativeError>;
    async fn remove_dir_recursive(&self, remote_path: &str) -> Result<(), NativeError>;

    async fn exec_bounded(
        &self,
        command: &str,
        stdin: Option<&[u8]>,
        stdout_limit: usize,
        stderr_limit: usize,
        timeout: Duration,
    ) -> Result<RemoteExecOutput, NativeError>;

    /// Stream an arbitrary command over SSH exec (used for remote Codex/Claude CLI).
    async fn exec_stream_lines(
        &self,
        command: &str,
        stdin_payload: Vec<u8>,
        max_bytes: usize,
        cancel: watch::Receiver<bool>,
        on_line: Box<dyn Fn(Vec<u8>) -> Result<(), String> + Send>,
    ) -> Result<(i32, Vec<u8>, Vec<u8>), NativeError>;

    async fn start_watch(
        &self,
        root: &str,
        poll_interval: Duration,
        tx: mpsc::Sender<RemoteWatchEvent>,
    ) -> Result<RemoteWatchHandle, NativeError>;

    async fn close(&self);
}
