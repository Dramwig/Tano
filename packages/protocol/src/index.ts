export * from './references';
export * from './agent';
export * from './assistant';
export * from './objects';
export * from './object-types';
export * from './short-id';
export * from './relations';
export * from './plugins';
export * from './extensions';
export * from './workspace-paths';
export * from './comments';
export * from './suggestions';
export * from './document-layout';
export * from './data-tables';
export * from './workspace-contract';
export * from './file-core';
export * from './file-metadata';

export interface FileEntry {
  id: string;
  path: string;
  name: string;
  kind: 'file' | 'directory';
  size: number;
  modified: number;
  /** Content hash supplied by the authority when available, never inferred from mtime. */
  contentHash?: string;
  readOnly?: boolean;
  /** Local draft; the authority has not yet confirmed creation. */
  pendingCreation?: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  path: string;
  files: FileEntry[];
  readOnly?: boolean;
  /** Transient creation result; omitted on subsequent opens and refreshes. */
  newlyCreated?: boolean;
  /** Local metadata was deleted; this open initialized a new workspace identity. */
  reinitialized?: boolean;
  /** True only when the current user may delete this workspace. */
  canDelete?: boolean;
  /** Supplied by the authority owning workspace membership, never by portable files. */
  canManagePlugins?: boolean;
  /** Supplied by the authority; content editing alone does not grant settings access. */
  canManageSettings?: boolean;
}

export class WorkspaceAccessRevokedError extends Error {
  constructor() {
    super('你已失去此工作区的访问权限');
    this.name = 'WorkspaceAccessRevokedError';
  }
}

export interface FileSnapshot {
  content: string;
  hash: string;
  modified: number;
}

export type WriteResult =
  | { status: 'saved'; snapshot: FileSnapshot }
  | { status: 'conflict'; snapshot: FileSnapshot }
  | { status: 'missing' };

/** Compare identity and content at the filesystem boundary before moving/deleting a document. */
export interface FileChangeRequest {
  workspaceId: string;
  fileId: string;
  path: string;
  expectedHash: string;
  /** Omitted for deletion. Saved returns the source snapshot, including for deletion. */
  destination?: string;
}

export interface WorkspaceAdapter {
  readonly mode: 'desktop' | 'demo' | 'web';
  reserveObjectId?(occupied: string[]): Promise<string>;
  /** Reserve an externally proposed, never-used object or table ID before exclusive creation. */
  createAgentRecord?(path: string, content: string): Promise<void>;
  /** Select a folder without opening it or changing the active workspace; null cancels. */
  selectWorkspacePath?(): Promise<string | null>;
  open(path?: string): Promise<Workspace | null>;
  close?(workspaceId: string): Promise<void>;
  createWorkspace?(name: string): Promise<Workspace>;
  deleteWorkspace?(workspaceId: string): Promise<void>;
  recent?(): Promise<RecentWorkspace[]>;
  loadSession?(workspaceId: string): Promise<WorkspaceSession | null>;
  saveSession?(workspaceId: string, session: WorkspaceSession): Promise<void>;
  refresh(): Promise<Workspace>;
  search?(workspaceId: string, query: string, signal?: AbortSignal): Promise<SearchHit[]>;
  read(path: string): Promise<FileSnapshot>;
  /** Optional version-checked, synchronous cache. Never returns speculative content. */
  readCached?(path: string): FileSnapshot | undefined;
  /** Best-effort read ahead; implementations bound speculative network work. */
  prefetch?(path: string): Promise<void>;
  write(path: string, content: string, expectedHash: string): Promise<WriteResult>;
  /** May return the workspace including the confirmed creation to avoid a redundant refresh. */
  create(path: string, content: string): Promise<void | Workspace>;
  /** Persist a recoverable local draft without waiting for the remote authority. */
  stageCreate?(path: string, content: string): Promise<{ workspace: Workspace; file: FileEntry }>;
  /** Confirm the staged request, reusing its durable identity and idempotency key on retry. */
  commitCreate?(id: string): Promise<{ file: FileEntry; snapshot: FileSnapshot }>;
  createFolder(path: string): Promise<void>;
  /** Must reject nonempty directories, including hidden/unindexed entries; never recurse. */
  removeEmptyFolder?(workspaceId: string, path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  move(from: string, to: string, kind: FileEntry['kind']): Promise<void>;
  duplicate?(workspaceId: string, path: string): Promise<string>;
  remove(path: string): Promise<void>;
  changeFile?(request: FileChangeRequest): Promise<WriteResult>;
  /** Object-only compare-and-delete. Keeps the assistant file boundary unchanged. */
  removeObjectFile?(request: FileChangeRequest): Promise<WriteResult>;
  reveal(): Promise<void>;
  watch(callback: () => void): Promise<() => void>;
}

export interface SearchHit {
  id: string;
  path: string;
  excerpt: string;
}

export interface RecentWorkspace {
  id: string;
  name: string;
  path: string;
  openedAt: number;
  /** Owner display label supplied by the storage adapter, when available. */
  owner?: string;
  /** Stable owner identity used by workspace dashboard filters. */
  ownerUserId?: string;
  /** Display identity for a cloud workspace owner, when the server provides it. */
  ownerProfile?: { userId: string; name: string; avatar?: string };
  /** Workspace creation time in milliseconds; absent for legacy workspaces. */
  createdAt?: number | null;
  /** Optional user selection state supplied by a storage adapter. */
  favorite?: boolean;
  /** Whether this workspace was explicitly shared with the current user. */
  shared?: boolean;
  icon?: string;
}
export interface SessionDocument {
  id: string;
  path: string;
  draft?: { content: string; base: FileSnapshot };
}
export interface WorkspaceSession {
  version: 1;
  activeId: string;
  documents: SessionDocument[];
  tabs?: string[];
  layout?: WorkspaceLayout;
  dataTables?: {
    id: string;
    fileId?: string;
    path?: string;
    content: string;
    base: FileSnapshot;
  }[];
}

export interface WorkspacePane {
  kind: 'pane';
  id: string;
  tabs: string[];
  activeId: string;
}
export interface WorkspaceSplit {
  kind: 'split';
  id: string;
  axis: 'horizontal' | 'vertical';
  ratio: number;
  first: WorkspaceLayout;
  second: WorkspaceLayout;
}
export type WorkspaceLayout = WorkspacePane | WorkspaceSplit;

export * from './paths';
export * from './plugin-catalog';
export * from './plugin-connections';
export * from './plugin-automations';
export * from './task-review';
export * from './task-repeat';
export * from './file-database';
export * from './view-engine';
export * from './agent-gateway';

export * from './data-table-query';

export * from './structured-merge';
