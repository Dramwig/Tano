import { getActivePinia } from 'pinia';
import type { Pinia } from 'pinia';
import type { Component } from 'vue';
import type { WorkspaceAdapter, AssistantTransport, WorkspaceObject, Workspace, FileEntry } from '@tano/protocol';
import type { EditorExtension } from '@tano/editor/extension';
import type { ObjectStorage } from './objects/workspace-objects';
import type { CommentAuthor } from './workspace/workspace-comments';
import type { AttachmentService } from './files/attachments';
import type { SettingsPageId } from './settings/settings-window';
import type { PluginRuntimeServices } from './plugins/host';
import type { ImportAccountHost } from './account-import/types';
import type { DocumentSyncStatus } from './documents/document-status';

export interface WorkbenchActions {
  closeMenus(): void;
  createWorkspace(): void;
  openSettings(page?: SettingsPageId): void;
  showDiff(value: {title: string; before: string; after: string}): void;
}
export interface EditingSession {
  readonly active: { key: string; readOnly: boolean; extension?: EditorExtension } | null;
  readonly activeBusy: boolean;
  isManaging(id: string): boolean;
  /** Hosts with automatic sessions can safely hand off file mutations. */
  canMutateFile?(id: string): boolean;
  withFileMutation?<T>(ids: string[], mutation: () => Promise<T>): Promise<T>;
  /** Apply through the live editor transaction when a plugin edits a managed document. */
  applyPluginEdit?(id: string, before: string, after: string): Promise<string | void>;
  flush(): Promise<unknown>;
  suspendAll(): Promise<void>;
  dispose(): Promise<void>;
}
/** Host metadata shared with settings pages; no document content or window-local store. */
export interface SettingsPageContext {
  mode: 'demo' | 'web' | 'local';
  workspace: Pick<Workspace, 'id' | 'name' | 'path' | 'readOnly' | 'canDelete' | 'canManageSettings'> | null;
  activeFile: Pick<FileEntry, 'id' | 'path'> | null;
}
/** Components receive SettingsPageContext props, including in a separate settings window. */
export interface SettingsPage {
  id: string; label: string; group: string; terms: string; component: Component;
  icon?: Component;
  isVisible?: (context: SettingsPageContext) => boolean;
}
/** Only this metadata enters the tab store; components and business state stay in the overlay. */
export interface WorkbenchViewTab {
  id: string;
  label: string;
  icon: Component;
  /** Account views keep their tab identity across workspace switches. */
  scope?: 'account' | 'workspace';
  /** Window-local views cannot be transferred unless the overlay explicitly supports it. */
  detachable?: boolean;
  detachBlockedMessage?: string;
}
export interface WorkbenchViewActions {
  open(): void;
  showSidebar(): void;
}
/** Stable view:* IDs are restored only when registered by the current product. */
export interface WorkbenchView extends WorkbenchViewTab {
  component: Component;
  /** Collapse navigation when this view becomes active; users can reopen it. */
  collapseSidebarOnOpen?: boolean;
  sidebar?: Component;
  /** Optional control rendered in the workspace sidebar header. */
  header?: Component;
  overlay?: Component;
}
export interface WorkbenchObjectDetailsProps {
  workspaceId: string;
  object: WorkspaceObject;
  disabled: boolean;
}
export interface WorkbenchPinnedCommand {
  id: string;
  label: string;
  command: string;
  description?: string;
}
export interface WorkbenchOverlaySnapshot {
  readonly safeMode: boolean;
  readonly hiddenSidebarItems?: readonly string[];
  readonly sidebarOrder?: readonly string[];
  readonly pinnedCommands?: readonly WorkbenchPinnedCommand[];
  readonly homeTabViewKey?: string;
  readonly newTabViewKey?: string;
}
export interface WorkbenchOverlayExtension {
  readonly snapshot: WorkbenchOverlaySnapshot;
  setSafeMode(enabled: boolean): void;
  syncContext?(workspaceId: string, activeDocumentPath?: string): void;
  dispose?(): void;
}
export interface WorkbenchAssistantToolExecutionContext {
  workspaceId: string;
  workspacePath: string;
  runId: string;
  activeDocumentId?: string;
  signal: AbortSignal;
}
export type WorkbenchAssistantToolExecutionResult =
  | { kind: 'result'; data: unknown }
  | { kind: 'proposal'; proposal: import('@tano/protocol').AssistantProposal };
export interface WorkbenchAssistantStarter {
  id: string;
  label: string;
  prompt: string;
  icon?: Component;
  requiresActiveDocument?: boolean;
}
export interface WorkbenchAssistantCapabilityNote {
  id: string;
  label: string;
  detail?: string;
  tone?: 'default' | 'warning';
}
export interface WorkbenchAssistantProposalCardDescriptor {
  component: Component;
  kindLabel?: string;
  applyLabel?: string;
  defaultOpen?: boolean;
  hideDefaultDiff?: boolean;
  hideDefaultActions?: boolean;
}
export interface WorkbenchAssistantExtension {
  listTools(context: {
    workspaceReadOnly: boolean;
    inline: boolean;
    background: boolean;
  }): NonNullable<import('@tano/protocol').AssistantRequest['tools']>;
  toolLabel?(name: string): string | undefined;
  promptHints?(context: { workspaceReadOnly: boolean }): string[];
  executeTool(
    name: string,
    args: Record<string, unknown>,
    context: WorkbenchAssistantToolExecutionContext,
  ): Promise<WorkbenchAssistantToolExecutionResult | undefined>;
  applyProposal?(
    proposal: import('@tano/protocol').AssistantProposal,
    parsedArgs: Record<string, unknown>,
  ): Promise<{ before?: string; after: string; hash: string; fileId: string } | undefined>;
  canUndoProposal?(proposal: import('@tano/protocol').AssistantProposal): boolean;
  undoProposal?(proposal: import('@tano/protocol').AssistantProposal): Promise<boolean>;
  proposalCard?(
    proposal: import('@tano/protocol').AssistantProposal,
  ): WorkbenchAssistantProposalCardDescriptor | undefined;
  starters?(context: { demo: boolean }): readonly WorkbenchAssistantStarter[];
  capabilitySummary?(context: {
    workspaceReadOnly: boolean;
    safeMode: boolean;
  }): readonly WorkbenchAssistantCapabilityNote[];
}
export interface WorkbenchExtensions {
  commands?: import('./shell/command-palette').WorkbenchCommand[];
  editing: EditingSession;
  /** Per-document persistence state, supplied by hosts that synchronize content. */
  documentStatus?(id: string): DocumentSyncStatus | undefined;
  /**
   * workspace-menu-layout can wrap built-in workspace actions through its default slot.
   * plugin-publishing receives WorkbenchActions in the plugin center's My submissions view.
   * plugin-forge receives WorkbenchActions + { canPublish } in the plugin center's Forge & Overlay view.
   */
  regions: Record<string, Component>;
  views?: readonly WorkbenchView[];
  /** Optional product-owned workbench overlay hook (Safe Mode, sidebar overrides, home/new tab views). */
  overlay?: WorkbenchOverlayExtension;
  /** Optional product-owned assistant tools, prompt hints, and proposal appliers. */
  assistant?: WorkbenchAssistantExtension;
  /** Receives WorkbenchObjectDetailsProps for a saved workspace object. */
  objectDetails?: Component;
  commentAuthor?: () => CommentAuthor;
  settingsPages?: SettingsPage[];
  /** Optional cloud backend configuration; system owns the common entry point. */
  sync?: { readonly enabled: boolean; open(): void; disconnect(): Promise<void> };
  historyView?: Component;
  readonly historyEnabled?: boolean;
  refresh(): Promise<unknown>;
  disconnect(): Promise<void>;
  showHistory?(): void;
}
export const DEFAULT_DOCUMENT_COVER_BASE_URL = 'https://assets.tano.page/covers';

export interface WorkbenchRuntime {
  adapter: WorkspaceAdapter;
  /** Absolute, localized documentation root supplied by the product host. */
  documentationBaseUrl?: string;
  /** Optional HTTPS/relative base URL hosting curated document cover WebP files. */
  documentCoverBaseUrl?: string;
  attachments?: AttachmentService;
  personalPlans?: ObjectStorage;
  assistant?: AssistantTransport;
  plugins?: PluginRuntimeServices;
  /** Optional account-import backend; desktop uses its native credential boundary by default. */
  accountImports?: ImportAccountHost;
  native: boolean;
  mobile: boolean;
  extensions?: () => WorkbenchExtensions;
}

// The public workbench owns this contract. Cloud implementations live outside
// the MIT source tree and receive only the adapter and extension surfaces.
export const CLOUD_EXTENSION_API_VERSION = 1 as const;
export interface CloudExtension {
  readonly apiVersion: typeof CLOUD_EXTENSION_API_VERSION;
  createWorkbenchExtensions(pinia: Pinia): WorkbenchExtensions;
}

const runtimes = new WeakMap<Pinia, WorkbenchRuntime>();
let customCoverBaseUrlCount = 0;
export function configureWorkbench(pinia: Pinia, runtime: WorkbenchRuntime) {
  if (runtimes.has(pinia)) throw new Error('工作台实例已配置；切换存储请创建新实例');
  runtimes.set(pinia, runtime);
  if (runtime.documentCoverBaseUrl) customCoverBaseUrlCount++;
  return pinia;
}
export function configureWorkbenchWithCloudExtension(
  pinia: Pinia,
  runtime: Omit<WorkbenchRuntime, 'extensions'>,
  cloud: CloudExtension,
) {
  if (cloud.apiVersion !== CLOUD_EXTENSION_API_VERSION)
    throw new Error(`不支持的云扩展接口版本：${cloud.apiVersion}`);
  return configureWorkbench(pinia, {
    ...runtime,
    extensions: () => cloud.createWorkbenchExtensions(pinia),
  });
}
export function useWorkbenchRuntime(): WorkbenchRuntime {
  const pinia = getActivePinia();
  const runtime = pinia && runtimes.get(pinia);
  if (!runtime) throw new Error('工作台缺少存储配置');
  return runtime;
}
export function resolveDocumentCoverBaseUrl(pinia?: Pinia): string {
  const active = pinia ?? (customCoverBaseUrlCount > 0 ? getActivePinia() : undefined);
  const configured = active ? runtimes.get(active)?.documentCoverBaseUrl : undefined;
  const envUrl = (import.meta as { env?: { VITE_TANO_COVER_BASE_URL?: string } }).env
    ?.VITE_TANO_COVER_BASE_URL;
  const raw = (configured ?? envUrl ?? DEFAULT_DOCUMENT_COVER_BASE_URL).trim();
  return (raw || DEFAULT_DOCUMENT_COVER_BASE_URL).replace(/\/+$/, '');
}
export function createLocalExtensions(): WorkbenchExtensions {
  const done = async () => {};
  return { editing: { active: null, activeBusy: false, isManaging: () => false, flush: done, suspendAll: done, dispose: done }, regions: {}, refresh: done, disconnect: done };
}
