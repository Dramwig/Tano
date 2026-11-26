// SPDX-License-Identifier: MIT
//! Cross-platform OS SSH Agent authentication helper.
//! Supports Windows OpenSSH Authentication Agent named pipe (`\\.\pipe\openssh-ssh-agent`),
//! Pageant on Windows, and `SSH_AUTH_SOCK` Unix domain sockets on macOS/Linux.

use russh::client::{AuthResult, Handle, Handler};
use russh::keys::agent::{
    client::{AgentClient, AgentStream},
    AgentIdentity,
};
use russh::keys::{Algorithm, HashAlg};

type DynAgentClient = AgentClient<Box<dyn AgentStream + Send + Unpin>>;

async fn connect_os_agent() -> Option<DynAgentClient> {
    #[cfg(windows)]
    {
        if let Ok(pipe) = std::env::var("SSH_AUTH_SOCK") {
            if !pipe.trim().is_empty() {
                if let Ok(client) = AgentClient::connect_named_pipe(pipe).await {
                    return Some(client.dynamic());
                }
            }
        }
        if let Ok(client) = AgentClient::connect_named_pipe(r"\\.\pipe\openssh-ssh-agent").await {
            return Some(client.dynamic());
        }
        if let Ok(client) = AgentClient::connect_pageant().await {
            return Some(client.dynamic());
        }
        None
    }
    #[cfg(unix)]
    {
        if let Ok(client) = AgentClient::connect_env().await {
            return Some(client.dynamic());
        }
        None
    }
}

pub async fn try_authenticate_with_agent<H: Handler>(
    handle: &mut Handle<H>,
    username: &str,
    best_rsa_hash: Option<HashAlg>,
) -> bool {
    let Some(mut agent) = connect_os_agent().await else {
        return false;
    };
    let Ok(identities) = agent.request_identities().await else {
        return false;
    };
    for identity in identities {
        let AgentIdentity::PublicKey { key, .. } = identity else {
            continue;
        };
        let hash_alg = match key.algorithm() {
            Algorithm::Rsa { .. } => best_rsa_hash,
            _ => None,
        };
        if let Ok(AuthResult::Success) = handle
            .authenticate_publickey_with(username, key, hash_alg, &mut agent)
            .await
        {
            return true;
        }
    }
    false
}
