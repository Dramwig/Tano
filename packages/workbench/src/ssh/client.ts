// SPDX-License-Identifier: MIT
import {
  isNativeRuntime,
  nativeInvoke,
  nativeListen,
} from '../platform/native-bridge';
export type SshUnlisten = () => void;
import type { SearchHit } from '@tano/protocol';
import type {
  KnownHostRecord,
  RemoteListDirResponse,
  SshAuthPromptEvent,
  SshChallengeResponse,
  SshConnectionStatusEvent,
  SshConnectResult,
  SshHostInput,
  SshHostKeyPromptEvent,
  SshHostListResponse,
  SshHostProfile,
  SshMcpSyncResult,
  SshSettings,
} from './types';

function ensureNative() {
  if (!isNativeRuntime()) {
    throw new Error('SSH 远端工作区仅在桌面客户端中可用');
  }
}

export const sshClient = {
  available: () => isNativeRuntime(),

  async listHosts(): Promise<SshHostListResponse> {
    ensureNative();
    return nativeInvoke<SshHostListResponse>('ssh_hosts_list');
  },

  async saveHost(input: SshHostInput): Promise<SshHostProfile> {
    ensureNative();
    return nativeInvoke<SshHostProfile>('ssh_host_save', { input });
  },

  async parseQuickConnect(raw: string): Promise<[SshHostProfile, string | null]> {
    ensureNative();
    return nativeInvoke<[SshHostProfile, string | null]>('ssh_quick_connect_parse', { raw });
  },

  async removeHost(hostId: string): Promise<void> {
    ensureNative();
    return nativeInvoke<void>('ssh_host_remove', { hostId });
  },

  async connect(hostId: string): Promise<SshConnectResult> {
    ensureNative();
    return nativeInvoke<SshConnectResult>('ssh_connect', { hostId });
  },

  async testHost(hostId: string): Promise<SshConnectResult> {
    ensureNative();
    return nativeInvoke<SshConnectResult>('ssh_host_test', { hostId });
  },

  async disconnect(hostId: string): Promise<void> {
    ensureNative();
    return nativeInvoke<void>('ssh_disconnect', { hostId });
  },

  async reconnect(hostId: string): Promise<SshConnectResult> {
    ensureNative();
    return nativeInvoke<SshConnectResult>('ssh_reconnect', { hostId });
  },

  async status(hostId: string): Promise<SshConnectionStatusEvent | null> {
    ensureNative();
    return nativeInvoke<SshConnectionStatusEvent | null>('ssh_connection_status', { hostId });
  },

  async respondChallenge(response: SshChallengeResponse): Promise<void> {
    ensureNative();
    return nativeInvoke<void>('ssh_challenge_respond', { response });
  },

  async listDir(
    hostId: string,
    path?: string | null,
    includeHidden = false,
  ): Promise<RemoteListDirResponse> {
    ensureNative();
    return nativeInvoke<RemoteListDirResponse>('ssh_list_dir', {
      hostId,
      path: path ?? null,
      includeHidden,
    });
  },

  async mkdir(hostId: string, path: string): Promise<string> {
    ensureNative();
    return nativeInvoke<string>('ssh_mkdir', { hostId, path });
  },

  async listKnownHosts(): Promise<KnownHostRecord[]> {
    ensureNative();
    return nativeInvoke<KnownHostRecord[]>('ssh_known_hosts_list');
  },

  async removeKnownHost(id: string): Promise<void> {
    ensureNative();
    return nativeInvoke<void>('ssh_known_hosts_remove', { id });
  },

  async loadSettings(): Promise<SshSettings> {
    ensureNative();
    return nativeInvoke<SshSettings>('ssh_settings_load');
  },

  async saveSettings(settings: SshSettings): Promise<SshSettings> {
    ensureNative();
    return nativeInvoke<SshSettings>('ssh_settings_save', { settings });
  },

  async syncMcp(hostId: string): Promise<SshMcpSyncResult> {
    ensureNative();
    return nativeInvoke<SshMcpSyncResult>('ssh_mcp_sync', { hostId });
  },

  async openTerminal(hostId: string, remotePath?: string | null): Promise<void> {
    ensureNative();
    return nativeInvoke<void>('ssh_open_terminal', { hostId, remotePath: remotePath ?? null });
  },

  async remoteSearch(workspaceId: string, query: string): Promise<SearchHit[]> {
    ensureNative();
    return nativeInvoke<SearchHit[]>('ssh_remote_search', { workspaceId, query });
  },

  async onHostKeyPrompt(
    handler: (event: SshHostKeyPromptEvent) => void,
  ): Promise<SshUnlisten> {
    return nativeListen<SshHostKeyPromptEvent>('ssh-host-key-prompt', (ev) =>
      handler(ev.payload),
    );
  },

  async onAuthPrompt(handler: (event: SshAuthPromptEvent) => void): Promise<SshUnlisten> {
    return nativeListen<SshAuthPromptEvent>('ssh-auth-prompt', (ev) => handler(ev.payload));
  },

  async onConnectionStatus(
    handler: (event: SshConnectionStatusEvent) => void,
  ): Promise<SshUnlisten> {
    return nativeListen<SshConnectionStatusEvent>('ssh-connection-status', (ev) =>
      handler(ev.payload),
    );
  },
};
