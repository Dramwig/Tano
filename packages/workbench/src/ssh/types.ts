// SPDX-License-Identifier: MIT
import type { RemoteConnectionPhase, RemoteServerCapabilities } from '@tano/protocol';

export type SshHostSource = 'saved' | 'ssh-config';
export type SshAuthMethod = 'auto' | 'agent' | 'key' | 'password';
export type RemoteTrashMode = 'remote-trash' | 'permanent-delete';

/** Mirrors `crates/tano-native/src/ssh/types.rs` 1:1 (camelCase). */
export interface SshHostProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  source: SshHostSource;
  configAlias?: string | null;
  authMethod: SshAuthMethod;
  identityFile?: string | null;
  proxyJump?: string | null;
  proxyCommand?: string | null;
  forwardAgent: boolean;
  hasSavedPassword: boolean;
  hasSavedPassphrase: boolean;
  recentPaths?: string[];
  lastConnectedAt?: number | null;
}

export interface SshHostInput {
  id?: string | null;
  name: string;
  host: string;
  port?: number;
  username: string;
  authMethod: SshAuthMethod;
  identityFile?: string | null;
  proxyJump?: string | null;
  proxyCommand?: string | null;
  forwardAgent?: boolean;
  password?: string | null;
  passphrase?: string | null;
  clearPassword?: boolean;
  clearPassphrase?: boolean;
}

export interface SshHostListResponse {
  configPath?: string | null;
  configError?: string | null;
  configHosts: SshHostProfile[];
  savedHosts: SshHostProfile[];
}

export interface SshConnectResult {
  hostId: string;
  hostLabel: string;
  homeDir: string;
  latencyMs: number;
  capabilities: RemoteServerCapabilities;
  recentPaths: string[];
}

export interface SshConnectionStatusEvent {
  hostId: string;
  hostLabel: string;
  status: RemoteConnectionPhase;
  latencyMs?: number | null;
  error?: string | null;
  capabilities?: RemoteServerCapabilities | null;
}

export interface RemoteDirEntry {
  name: string;
  path: string;
  kind: 'dir' | 'file' | string;
  size: number;
  modified: number;
  isSymlink: boolean;
  isHidden: boolean;
}

export interface RemoteListDirResponse {
  path: string;
  parent?: string | null;
  entries: RemoteDirEntry[];
}

export interface SshHostKeyPromptEvent {
  challengeId: string;
  hostId: string;
  hostLabel: string;
  hostname: string;
  port: number;
  algorithm: string;
  fingerprint: string;
  mismatch: boolean;
  previousFingerprint?: string | null;
}

export interface SshAuthPromptItem {
  prompt: string;
  echo: boolean;
}

export interface SshAuthPromptEvent {
  challengeId: string;
  hostId: string;
  hostLabel: string;
  kind: 'password' | 'passphrase' | 'keyboard-interactive' | string;
  instruction?: string | null;
  prompts: SshAuthPromptItem[];
  allowSave: boolean;
}

export interface SshChallengeResponse {
  challengeId: string;
  cancelled?: boolean;
  trustHostKey?: boolean;
  secrets?: string[];
  saveSecret?: boolean;
}

export interface KnownHostRecord {
  id: string;
  hostPattern: string;
  algorithm: string;
  fingerprint: string;
  source: 'tano' | 'openssh' | string;
}

export interface SshSettings {
  trashMode: RemoteTrashMode;
  pollIntervalSecs: number;
  keepaliveSecs: number;
  connectTimeoutSecs: number;
}

export interface SshMcpSyncResult {
  remoteScriptPath: string;
  remoteDataDir: string;
  nodePath: string;
  nodeVersion: string;
  uploaded: boolean;
  sha256: string;
}

export type SshChallenge =
  | { type: 'host-key'; event: SshHostKeyPromptEvent }
  | { type: 'auth'; event: SshAuthPromptEvent };
