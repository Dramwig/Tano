export * from './references';
export * from './agent';
export * from './objects';
export * from './object-types';
export * from './short-id';
export * from './relations';
export * from './plugins';
export * from './workspace-paths';

export interface FileEntry {
  id: string;
  path: string;
  name: string;
  kind: 'file' | 'directory';
  size: number;
  modified: number;
}

export interface Workspace {
  id: string;
  name: string;
  path: string;
  files: FileEntry[];
  readOnly?: boolean;
  backupWarning?: string;
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

export interface WorkspaceAdapter {
  readonly mode: 'desktop' | 'demo' | 'web';
  reserveObjectId?(occupied: string[]): Promise<string>;
  open(path?: string): Promise<Workspace | null>;
  close?(workspaceId: string): Promise<void>;
  createWorkspace?(name: string): Promise<Workspace>;
  recent?(): Promise<RecentWorkspace[]>;
  loadSession?(workspaceId: string): Promise<WorkspaceSession | null>;
  saveSession?(workspaceId: string, session: WorkspaceSession): Promise<void>;
  refresh(): Promise<Workspace>;
  search?(workspaceId: string, query: string): Promise<SearchHit[]>;
  read(path: string): Promise<FileSnapshot>;
  write(path: string, content: string, expectedHash: string): Promise<WriteResult>;
  create(path: string, content: string): Promise<void>;
  createFolder(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  move(from: string, to: string, kind: FileEntry['kind']): Promise<void>;
  duplicate?(workspaceId: string, path: string): Promise<string>;
  remove(path: string): Promise<void>;
  reveal(): Promise<void>;
  watch(callback: () => void): Promise<() => void>;
  recoveryPath?(): string | null;
  backupCatalog?(path: string): Promise<WorkspaceBackupCatalog>;
  backupPreview?(path: string, snapshotId: string): Promise<WorkspaceRecoveryPreview>;
  restoreBackup?(path: string, snapshotId: string, currentFingerprint?: string): Promise<Workspace>;
  exportWorkspace?(): Promise<WorkspaceArchiveResult | null>;
  importWorkspace?(): Promise<WorkspaceArchiveResult | null>;
}

export interface WorkspaceArchiveResult {
  path: string;
  workspaceId: string;
  fileCount: number;
  bytes: number;
}

export interface WorkspaceBackupSummary {
  snapshotId: string;
  createdAt: number;
  fileCount: number;
  bytes: number;
  error?: string | null;
}
export interface WorkspaceBackupCatalog {
  path: string;
  workspaceId: string;
  snapshots: WorkspaceBackupSummary[];
  pendingRestore?: string | null;
}
export interface WorkspaceRecoveryPreview {
  workspaceId: string;
  snapshot: WorkspaceBackupSummary;
  currentFingerprint: string;
  changes: { path: string; kind: string }[];
  markdownAndAttachmentsUnchanged: boolean;
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
}

export * from './paths';
