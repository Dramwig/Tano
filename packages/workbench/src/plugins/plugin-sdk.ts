/** Public, browser-first SDK. Import types only; the runtime supplies `tano` to activate(). */
import type {
  PluginViewNode,
  PluginJson,
  WorkspaceObject,
  WorkspaceRelation,
  PluginConnectionRequest,
  PluginConnectionResponse,
  PluginPlatform,
  PluginEngines,
  PluginErrorCode,
  PluginStatusBarItem,
  PluginUiPickOptions,
  PluginUiPromptOptions,
  PluginUiConfirmOptions,
  PluginUiTone,
  PluginSlashCommandDefinition,
  PluginActiveEditorSnapshot,
  PluginFrontmatterPatch,
  PluginCodeBlockRendererDefinition,
  PluginEditorDecorationTone,
  PluginEditorDecoration,
  PluginAttachmentWriteRequest,
  WorkspacePersonalPluginPolicy,
  PluginAssistantToolEffect,
  PluginAssistantToolDefinition,
  PluginAssistantContextProviderDefinition,
  PluginAiCompleteRequest,
  PluginAiStructuredRequest,
  PluginAiCompleteResult,
  PluginAiStructuredResult,
  PluginServiceDefinition,
  PluginServiceDependency,
} from '@tano/protocol';
export type {
  PluginManifest,
  ExecutablePluginManifest,
  PluginPackage,
  PluginPackageAssets,
  PluginArchiveV2,
  PluginServiceDefinition,
  PluginServiceDependency,
  PluginPermission,
  PluginViewDefinition,
  PluginViewLocation,
  PluginViewLayout,
  PluginStatusBarAlign,
  PluginStatusBarTone,
  PluginStatusBarItem,
  PluginUiTone,
  PluginUiPickItem,
  PluginUiPickOptions,
  PluginUiPromptOptions,
  PluginUiConfirmOptions,
  PluginUiToastOptions,
  PluginSlashCommandDefinition,
  PluginActiveEditorSnapshot,
  PluginFrontmatterPatch,
  PluginCodeBlockRendererDefinition,
  PluginEditorDecorationTone,
  PluginEditorDecoration,
  PluginAttachmentWriteRequest,
  WorkspacePersonalPluginPolicy,
  PluginAssistantToolEffect,
  PluginAssistantToolDefinition,
  PluginAssistantContextProviderDefinition,
  PluginAiCompleteRequest,
  PluginAiStructuredRequest,
  PluginAiCompleteResult,
  PluginAiStructuredResult,
  PluginFileHandlerMode,
  PluginFileHandlerDefinition,
  PluginSettingFieldType,
  PluginSettingField,
  PluginActivationEvent,
  PluginPlatform,
  PluginEngines,
  PluginErrorCode,
  PluginViewNode,
  PluginJson,
  PluginUiBundle,
} from '@tano/protocol';
export interface PluginAssistantCallContext {
  workspaceId: string;
  activeFileId?: string;
}
export interface PluginAssistantContextResult {
  title?: string;
  content: string;
  metadata?: PluginJson;
}
export interface PluginHostInfo {
  coreVersion: string;
  apiVersion: string;
  platform: PluginPlatform;
  capabilities: string[];
}
export interface TanoPluginError extends Error {
  readonly code: PluginErrorCode;
  readonly retryable: boolean;
}
/** Runs inside the custom UI frame; workspace access stays in the plugin's Worker. */
export interface TanoPluginViewApi {
  /** Read-only host appearance, also applied as CSS variables inside the isolated UI. */
  theme(): import('../appearance/theme').ResolvedTheme;
  onTheme(handler: (theme: import('../appearance/theme').ResolvedTheme) => void): () => void;
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
export interface PluginGitEntry { path: string; index: string; worktree: string; originalPath: string | null }
export interface PluginGitStatus { branch: string | null; detached: boolean; entries: PluginGitEntry[] }
export interface PluginGitDiff { path: string; staged: boolean; patch: string }
export interface PluginGitCommit { id: string; shortId: string; author: string; date: string; subject: string }
export interface PluginGitLog { path: string | null; commits: PluginGitCommit[] }
export type PluginChangeKind = 'created' | 'updated' | 'deleted';
export type PluginEvent = { type: 'workspace.changed'; fileId?: string } | {
  type: 'documents.changed' | 'objects.changed' | 'relations.changed';
  changes: { id: string; kind: PluginChangeKind }[];
  /** Too many changes for a delta: discard cached query results and query again. */
  reset?: boolean;
};
export interface TanoPluginApi {
  /** Read-only binary snapshot in bounded base64 chunks, plus optional bounded attachment write. */
  attachments: {
    read(fileId: string, offset?: number, revision?: string): Promise<{ path: string; revision: string; offset: number; total: number; chunk: string }>;
    write(request: PluginAttachmentWriteRequest): Promise<{ path: string; name: string; image: boolean; url: string }>;
  };
  context(): Promise<{ workspaceId: string; pluginId: string; settings: Record<string, unknown> }>;
  /** Host runtime version, platform mode, and supported capabilities for graceful feature detection. */
  hostInfo(): Promise<PluginHostInfo>;
  /** Register a graceful cleanup handler invoked before the host terminates this plugin instance. */
  lifecycle: { onDeactivate(handler: () => void | Promise<void>): () => void };
  /** Read-only access to binary assets bundled inside this plugin's own v2 ZIP package (`assets/bin/*`). */
  assets: {
    list(): Promise<string[]>;
    read(path: string): Promise<{ path: string; bytes: number; base64: string }>;
  };
  documents: {
    list(): Promise<PluginDocumentEntry[]>;
    query(options?: PluginDocumentQuery): Promise<PluginPage<PluginDocumentEntry>>;
    /** Literal full-text search. An empty page can still carry nextCursor. */
    search(query: string, options?: Omit<PluginDocumentQuery, 'query' | 'sort'>): Promise<PluginPage<PluginSearchHit>>;
    read(fileId: string): Promise<PluginDocument>;
    write(fileId: string, content: string, baseHash: string): Promise<{ id: string; hash: string; status: 'applied' | 'saved' }>;
    edit(fileId: string, edits: PluginTextEdit[], baseHash: string): Promise<{ id: string; hash: string; status: 'applied' | 'saved' }>;
    create(path: string, content: string): Promise<{ id: string; path: string }>;
    move(fileId: string, destination: string, baseHash: string): Promise<{ id: string; path: string }>;
    trash(fileId: string, baseHash: string): Promise<{ id: string; path: string; trashed: true }>;
    open(fileId: string): Promise<void>;
    frontmatter: {
      read(fileId: string): Promise<{ id: string; hasFrontmatter: boolean; data: Record<string, PluginJson>; hash: string }>;
      update(
        fileId: string,
        patch: PluginFrontmatterPatch,
        baseHash: string,
      ): Promise<{ id: string; hash: string; data: Record<string, PluginJson>; status: 'applied' | 'saved' }>;
    };
  };
  /** Active editor selection, single-step undoable cursor transactions, and declarative decorations. */
  editor: {
    active(): Promise<PluginActiveEditorSnapshot | null>;
    insert(text: string): Promise<{ fileId: string; hash: string; status: 'applied' }>;
    replaceSelection(text: string): Promise<{ fileId: string; hash: string; status: 'applied' }>;
    setDecorations(fileId: string, decorations: PluginEditorDecoration[]): Promise<void>;
    clearDecorations(fileId?: string): Promise<void>;
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
    invoke(command: 'git.status', args?: Record<string, never>): Promise<PluginGitStatus>;
    invoke(command: 'git.diff', args: { path: string; staged?: boolean }): Promise<PluginGitDiff>;
    invoke(command: 'git.log', args?: { path?: string; limit?: number }): Promise<PluginGitLog>;
    invoke(command: string, args?: unknown): Promise<unknown>;
  };
  commands: { register(id: string, handler: (context?: { fileId?: string; workspaceId: string; viewAlreadyOpen?: boolean }) => void | Promise<void>): Promise<void> };
  views: {
    /** Host-rendered controls at the right of this view's breadcrumb row. */
    setHeader(id: string, header: import('./view-header').PluginViewHeader): Promise<void>;
    render(id: string, tree: PluginViewNode): Promise<void>;
    renderCustom(id: string, state: PluginJson): Promise<void>;
    open(id: string): Promise<void>;
    onAction(id: string, handler: (event: { action: string; values: Record<string, string> }) => void | Promise<void>): () => void;
    onMessage(id: string, handler: (message: PluginJson) => void | Promise<void>): () => void;
  };
  /** Host-managed lightweight UI primitives and status bar items; no iframe frontend required. */
  ui: {
    pick(options: PluginUiPickOptions): Promise<string | null>;
    prompt(options: PluginUiPromptOptions): Promise<string | null>;
    confirm(options: PluginUiConfirmOptions): Promise<boolean>;
    toast(message: string, tone?: PluginUiTone): Promise<void>;
    setStatusBar(item: PluginStatusBarItem): Promise<void>;
    removeStatusBar(id: string): Promise<void>;
  };
  /** Host-managed model completion using the user's configured connection; API keys never enter the sandbox. */
  ai: {
    complete(request: PluginAiCompleteRequest): Promise<PluginAiCompleteResult>;
    structured<T = PluginJson>(request: PluginAiStructuredRequest): Promise<PluginAiStructuredResult<T>>;
  };
  /** Register handlers for manifest-declared assistantTools and assistantContextProviders. */
  assistant: {
    registerTool(
      name: string,
      handler: (args: Record<string, unknown>, context: PluginAssistantCallContext) => PluginJson | Promise<PluginJson>,
    ): Promise<void>;
    registerContextProvider(
      id: string,
      handler: (
        query: string,
        context: PluginAssistantCallContext,
      ) => PluginAssistantContextResult | string | Promise<PluginAssistantContextResult | string>,
    ): Promise<void>;
  };
  /** Stateless cross-plugin RPC message bus (zero shared memory). */
  services: {
    register(
      name: string,
      handler: (payload: PluginJson, caller: { pluginId: string }) => PluginJson | Promise<PluginJson>,
    ): Promise<void>;
    call<T = PluginJson>(pluginId: string, service: string, payload?: PluginJson): Promise<T>;
    available(pluginId: string, service: string): Promise<boolean>;
  };
  events: { subscribe(handler: (event: PluginEvent) => void | Promise<void>, options?: { types?: PluginEvent['type'][]; ids?: string[] }): () => void };
  notify(message: string): Promise<void>;
}
