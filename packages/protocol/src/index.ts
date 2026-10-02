export * from './references';
export * from './agent';
export * from './assistant';
export * from './objects';
export * from './object-types';
export * from './short-id';
export * from './relations';
export * from './plugins';
export * from './workspace-paths';
export * from './comments';
export * from './document-layout';

export interface FileEntry {
  id: string;
  path: string;
  name: string;
  kind: 'file' | 'directory';
  size: number;
  modified: number;
  readOnly?: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  path: string;
  files: FileEntry[];
  readOnly?: boolean;
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
  layout?: WorkspaceLayout;
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
export * from './task-review';
export * from './task-repeat';
