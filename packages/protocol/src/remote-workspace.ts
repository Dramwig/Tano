// SPDX-License-Identifier: MIT

export const REMOTE_WORKSPACE_SCHEME = 'ssh://' as const;

export type RemoteConnectionPhase = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface RemoteServerCapabilities {
  shell: boolean;
  fastScan: boolean;
  inotify: boolean;
  git: boolean;
  node: boolean;
  nodeVersion?: string;
  codexCli: boolean;
  claudeCli: boolean;
  platform?: string;
}

export interface RemoteWorkspaceInfo {
  kind: 'ssh';
  hostId: string;
  hostLabel: string;
  remotePath: string;
  transport: 'sftp' | 'helper';
  status: RemoteConnectionPhase;
  latencyMs?: number;
  capabilities?: RemoteServerCapabilities;
  /** True when the remote workspace root contains a `.git` directory. */
  gitRepo?: boolean;
}

export interface ParsedRemoteWorkspaceUri {
  scheme: 'ssh';
  hostId: string;
  remotePath: string;
}

const HOST_ID_RE = /^[a-zA-Z0-9._-]{1,64}$/;

export function isValidRemoteHostId(hostId: string): boolean {
  return HOST_ID_RE.test(hostId) && hostId !== '.' && hostId !== '..';
}

export function isRemoteWorkspacePath(path: string | null | undefined): path is string {
  return typeof path === 'string' && path.startsWith(REMOTE_WORKSPACE_SCHEME);
}

/**
 * Normalize an absolute POSIX path for SSH remote workspaces.
 * Rejects relative paths, backslashes, NUL/control characters, and `.` / `..` segments.
 */
export function normalizeRemotePosixPath(path: string): string {
  if (!path || !path.startsWith('/')) throw new Error('远端路径必须是绝对 POSIX 路径');
  if (path.length > 2048 || path.includes('\\')) throw new Error('远端路径包含不支持的字符或超过长度限制');
  for (let i = 0; i < path.length; i++) {
    const code = path.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) throw new Error('远端路径包含非法控制字符');
  }
  const rawSegments = path.split('/').filter((segment, index, all) => {
    if (segment === '') return false;
    // Allow trailing slash normalization while keeping segment validation strict.
    return index >= 0 && all.length > 0;
  });
  for (const segment of rawSegments) {
    if (segment === '.' || segment === '..') {
      throw new Error('远端路径不能包含 . 或 ..');
    }
  }
  return rawSegments.length ? `/${rawSegments.join('/')}` : '/';
}

export function formatRemoteWorkspaceUri(hostId: string, remotePath: string): string {
  if (!isValidRemoteHostId(hostId)) throw new Error('远端主机标识无效');
  const normalized = normalizeRemotePosixPath(remotePath);
  return `${REMOTE_WORKSPACE_SCHEME}${hostId}${normalized}`;
}

export function parseRemoteWorkspaceUri(uri: string): ParsedRemoteWorkspaceUri | null {
  if (!isRemoteWorkspacePath(uri)) return null;
  const rest = uri.slice(REMOTE_WORKSPACE_SCHEME.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  const hostId = rest.slice(0, slash);
  const rawPath = rest.slice(slash);
  if (!isValidRemoteHostId(hostId)) return null;
  try {
    const remotePath = normalizeRemotePosixPath(rawPath);
    return { scheme: 'ssh', hostId, remotePath };
  } catch {
    return null;
  }
}

export function remoteWorkspaceDisplayName(remotePath: string): string {
  const normalized = normalizeRemotePosixPath(remotePath);
  if (normalized === '/') return '/';
  const parts = normalized.split('/');
  return parts[parts.length - 1] || '/';
}
