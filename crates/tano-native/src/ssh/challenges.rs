// SPDX-License-Identifier: MIT
//! Interactive SSH host-key verification and authentication prompt bridge.
//! Decouples `SshSftpTransport` from Tauri UI events so tests can drive prompts
//! deterministically without a WebView.

use super::types::{SshAuthPromptEvent, SshChallengeResponse, SshHostKeyPromptEvent};
use async_trait::async_trait;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::Emitter;
use tokio::sync::oneshot;

const CHALLENGE_TIMEOUT: Duration = Duration::from_secs(180);

#[async_trait]
pub trait SshChallengePrompter: Send + Sync {
    async fn prompt_host_key(&self, event: SshHostKeyPromptEvent) -> Result<bool, String>;
    async fn prompt_auth(
        &self,
        event: SshAuthPromptEvent,
    ) -> Result<Option<(Vec<String>, bool)>, String>;
}

#[derive(Default)]
pub struct SshChallengeRegistry {
    pending: Mutex<HashMap<String, oneshot::Sender<SshChallengeResponse>>>,
}

impl SshChallengeRegistry {
    pub fn register(&self) -> Result<(String, oneshot::Receiver<SshChallengeResponse>), String> {
        let mut guard = self.pending.lock().map_err(|_| "SSH 认证队列不可用")?;
        if guard.len() >= 16 {
            return Err("待处理的 SSH 认证请求过多，请先完成或取消现有弹窗".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();
        guard.insert(id.clone(), tx);
        Ok((id, rx))
    }

    pub fn respond(&self, response: SshChallengeResponse) -> Result<(), String> {
        let sender = {
            let mut guard = self.pending.lock().map_err(|_| "SSH 认证队列不可用")?;
            guard.remove(&response.challenge_id)
        };
        let Some(sender) = sender else {
            return Err("该 SSH 认证请求已过期或取消".into());
        };
        let _ = sender.send(response);
        Ok(())
    }

    pub fn cancel(&self, challenge_id: &str) {
        if let Ok(mut guard) = self.pending.lock() {
            guard.remove(challenge_id);
        }
    }

    pub fn cancel_all(&self) {
        if let Ok(mut guard) = self.pending.lock() {
            guard.clear();
        }
    }
}

pub struct TauriChallengePrompter {
    app: tauri::AppHandle,
    registry: Arc<SshChallengeRegistry>,
}

impl TauriChallengePrompter {
    pub fn new(app: tauri::AppHandle, registry: Arc<SshChallengeRegistry>) -> Self {
        Self { app, registry }
    }
}

#[async_trait]
impl SshChallengePrompter for TauriChallengePrompter {
    async fn prompt_host_key(&self, mut event: SshHostKeyPromptEvent) -> Result<bool, String> {
        let (id, rx) = self.registry.register()?;
        event.challenge_id = id.clone();
        self.app
            .emit("ssh-host-key-prompt", &event)
            .map_err(|e| format!("无法弹出主机指纹确认窗口：{e}"))?;
        let outcome = tokio::time::timeout(CHALLENGE_TIMEOUT, rx).await;
        self.registry.cancel(&id);
        match outcome {
            Ok(Ok(resp)) if !resp.cancelled => Ok(resp.trust_host_key),
            Ok(Ok(_)) => Err("已取消连接（未信任主机指纹）".into()),
            Ok(Err(_)) => Err("主机指纹确认已取消".into()),
            Err(_) => Err("等待主机指纹确认超时".into()),
        }
    }

    async fn prompt_auth(
        &self,
        mut event: SshAuthPromptEvent,
    ) -> Result<Option<(Vec<String>, bool)>, String> {
        let (id, rx) = self.registry.register()?;
        event.challenge_id = id.clone();
        self.app
            .emit("ssh-auth-prompt", &event)
            .map_err(|e| format!("无法弹出 SSH 认证窗口：{e}"))?;
        let outcome = tokio::time::timeout(CHALLENGE_TIMEOUT, rx).await;
        self.registry.cancel(&id);
        match outcome {
            Ok(Ok(resp)) if !resp.cancelled => Ok(Some((resp.secrets, resp.save_secret))),
            Ok(Ok(_)) => Ok(None),
            Ok(Err(_)) => Ok(None),
            Err(_) => Err("等待 SSH 认证输入超时".into()),
        }
    }
}
