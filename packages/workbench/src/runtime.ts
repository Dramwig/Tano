import { getActivePinia } from 'pinia';
import type { Pinia } from 'pinia';
import type { Component } from 'vue';
import type { WorkspaceAdapter, AssistantTransport, WorkspaceObject, Workspace, FileEntry } from '@tano/protocol';
import type { EditorExtension } from '@tano/editor/extension';
import type { ObjectStorage } from './workspace-objects';
import type { CommentAuthor } from './workspace-comments';
import type { AttachmentService } from './attachments';
import type { SettingsPageId } from './settings-window';

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
  flush(): Promise<unknown>;
  suspendAll(): Promise<void>;
  dispose(): Promise<void>;
}
/** Host metadata shared with settings pages; no document content or window-local store. */
export interface SettingsPageContext {
  mode: 'demo' | 'web' | 'local';
  workspace: Pick<Workspace, 'id' | 'name' | 'path' | 'readOnly' | 'canDelete'> | null;
  activeFile: Pick<FileEntry, 'id' | 'path'> | null;
}
/** Components receive SettingsPageContext props, including in a separate settings window. */
export interface SettingsPage {
  id: string; label: string; group: string; terms: string; component: Component;
}
/** Only this metadata enters the tab store; components and business state stay in the overlay. */
export interface WorkbenchViewTab {
  id: string;
  label: string;
  icon: Component;
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
export interface WorkbenchExtensions {
  editing: EditingSession;
  /** workspace-menu-layout can wrap the built-in workspace actions through its default slot. */
  regions: Record<string, Component>;
  views?: readonly WorkbenchView[];
  /** Receives WorkbenchObjectDetailsProps for a saved workspace object. */
  objectDetails?: Component;
  commentAuthor?: () => CommentAuthor;
  settingsPages?: SettingsPage[];
  historyView?: Component;
  readonly historyEnabled?: boolean;
  refresh(): Promise<unknown>;
  disconnect(): Promise<void>;
  showHistory?(): void;
}
export interface WorkbenchRuntime {
  adapter: WorkspaceAdapter;
  attachments?: AttachmentService;
  personalPlans?: ObjectStorage;
  assistant?: AssistantTransport;
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
export function configureWorkbench(pinia: Pinia, runtime: WorkbenchRuntime) {
  if (runtimes.has(pinia)) throw new Error('工作台实例已配置；切换存储请创建新实例');
  runtimes.set(pinia, runtime);
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
export function createLocalExtensions(): WorkbenchExtensions {
  const done = async () => {};
  return { editing: { active: null, activeBusy: false, isManaging: () => false, flush: done, suspendAll: done, dispose: done }, regions: {}, refresh: done, disconnect: done };
}
