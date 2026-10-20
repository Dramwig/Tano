/** Public, browser-first SDK. Import types only; the runtime supplies `tano` to activate(). */
import type { PluginViewNode, PluginJson, WorkspaceObject, WorkspaceRelation, PluginConnectionRequest, PluginConnectionResponse } from '@tano/protocol';
export type { PluginManifest, ExecutablePluginManifest, PluginPackage, PluginPermission, PluginViewNode, PluginJson, PluginUiBundle } from '@tano/protocol';
/** Runs inside the custom UI frame; workspace access stays in the plugin's Worker. */
export interface TanoPluginViewApi {
  postMessage(message: PluginJson): Promise<void>;
  onState(handler: (state: PluginJson) => void): () => void;
}
export interface PluginDocument { id: string; path: string; content: string; hash: string }
export interface PluginObjectSnapshot { id: string; object: WorkspaceObject; hash: string }
export interface PluginPage<T> { items: T[]; nextCursor?: string; total?: number; skipped?: string[] }
export interface PluginPageOptions { limit?: number; cursor?: string; direction?: 'asc' | 'desc' }
export interface PluginDocumentQuery extends PluginPageOptions { query?: string; pathPrefix?: string; readOnly?: boolean; sort?: 'path' | 'name' | 'modified' }
export interface PluginObjectQuery extends PluginPageOptions { query?: string; type?: string; archived?: boolean; properties?: Record<string, string | number | boolean | null>; sort?: 'name' | 'type' | 'id' }
export interface PluginRelationQuery extends PluginPageOptions { type?: string; sourceId?: string; targetId?: string }
export interface PluginDocumentEntry { id: string; name: string; path: string; readOnly: boolean }
export interface PluginSearchHit extends PluginDocumentEntry { snippet: string; offset: number; hash: string }
/** Offsets are UTF-16 indices into the exact content returned by read(). Edits must not overlap. */
export interface PluginTextEdit { from: number; to: number; insert: string }
export interface PluginAutomationExecution {
  runId: string;
  automationId: string;
  trigger: 'manual' | 'schedule' | 'webhook';
  scheduledAt: string;
  /** Owner-configured task parameters, unchanged by external delivery. */
  payload: PluginJson;
  /** Untrusted external JSON, present only for a Webhook trigger. */
  webhook?: PluginJson;
}
/** A server run has no editor UI, device storage, native commands or foreground event subscriptions. */
export type TanoAutomationApi = Pick<TanoPluginApi, 'context' | 'objects' | 'relations' | 'network' | 'connections'> & {
  documents: Omit<TanoPluginApi['documents'], 'open'>;
};
export type { GitEntry as PluginGitEntry, GitStatus as PluginGitStatus, GitDiff as PluginGitDiff, GitCommit as PluginGitCommit, GitLog as PluginGitLog } from './workspace-git';
import type { GitStatus as PluginGitStatus, GitDiff as PluginGitDiff, GitLog as PluginGitLog } from './workspace-git';
export type PluginChangeKind = 'created' | 'updated' | 'deleted';
export type PluginEvent = { type: 'workspace.changed'; fileId?: string } | {
  type: 'documents.changed' | 'objects.changed' | 'relations.changed';
  changes: { id: string; kind: PluginChangeKind }[];
  /** Too many changes for a delta: discard cached query results and query again. */
  reset?: boolean;
};
export interface TanoPluginApi {
  context(): Promise<{ workspaceId: string; pluginId: string; settings: Record<string, unknown> }>;
  documents: {
    list(): Promise<PluginDocumentEntry[]>;
    query(options?: PluginDocumentQuery): Promise<PluginPage<PluginDocumentEntry>>;
    /** Literal full-text search. An empty page can still carry nextCursor. */
    search(query: string, options?: Omit<PluginDocumentQuery, 'query' | 'sort'>): Promise<PluginPage<PluginSearchHit>>;
    read(fileId: string): Promise<PluginDocument>;
    write(fileId: string, content: string, baseHash: string): Promise<{ id: string; hash: string; status: 'applied' | 'saved' }>;
    edit(fileId: string, edits: PluginTextEdit[], baseHash: string): Promise<{ id: string; hash: string; status: 'applied' | 'saved' }>;
    create(path: string, content: string): Promise<{ id: string; path: string }>;
    open(fileId: string): Promise<void>;
  };
  objects: {
    list(): Promise<PluginObjectSnapshot[]>;
    query(options?: PluginObjectQuery): Promise<PluginPage<PluginObjectSnapshot>>;
    read(objectId: string): Promise<PluginObjectSnapshot>;
    create(object: Pick<WorkspaceObject, 'type' | 'name' | 'description' | 'properties' | 'archived'>): Promise<WorkspaceObject>;
    update(object: WorkspaceObject, baseHash: string): Promise<WorkspaceObject>;
  };
  relations: { list(): Promise<WorkspaceRelation[]>; query(options?: PluginRelationQuery): Promise<PluginPage<WorkspaceRelation>>; add(relation: WorkspaceRelation): Promise<void>; remove(relation: WorkspaceRelation): Promise<void> };
  /** Device-local application state. User content belongs in documents and objects. */
  storage: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void>; remove(key: string): Promise<void>; usage(): Promise<{ used: number; limit: number }> };
  network: { get(url: string): Promise<string> };
  /** Host injects the current user's separately granted credential; keys never enter the SDK. */
  connections: { request(origin: string, request: PluginConnectionRequest): Promise<PluginConnectionResponse> };
  native: {
    /** Opens the system UI; does not grant commit or network authority. */
    invoke(command: 'sync.open', args?: Record<string, never>): Promise<{ opened: boolean }>;
    invoke(command: 'git.status', args?: Record<string, never>): Promise<PluginGitStatus>;
    invoke(command: 'git.diff', args: { path: string; staged?: boolean }): Promise<PluginGitDiff>;
    invoke(command: 'git.log', args?: { path?: string; limit?: number }): Promise<PluginGitLog>;
    invoke(command: string, args?: unknown): Promise<unknown>;
  };
  commands: { register(id: string, handler: (context?: { fileId?: string; workspaceId: string }) => void | Promise<void>): Promise<void> };
  views: {
    render(id: string, tree: PluginViewNode): Promise<void>;
    renderCustom(id: string, state: PluginJson): Promise<void>;
    open(id: string): Promise<void>;
    onAction(id: string, handler: (event: { action: string; values: Record<string, string> }) => void | Promise<void>): () => void;
    onMessage(id: string, handler: (message: PluginJson) => void | Promise<void>): () => void;
  };
  events: { subscribe(handler: (event: PluginEvent) => void | Promise<void>, options?: { types?: PluginEvent['type'][]; ids?: string[] }): () => void };
  notify(message: string): Promise<void>;
}
