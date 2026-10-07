import { emitTo, listen } from '@tauri-apps/api/event';
import { PhysicalPosition } from '@tauri-apps/api/dpi';
import { Window, getCurrentWindow, monitorFromPoint } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { SettingsPageContext } from './runtime';
import type { EditorPreferences, WorkspaceCapabilities } from '@tano/editor/runtime';
import type { CapabilityPatch } from './workspace-capabilities';
import type { WorkspaceSettings, WorkspaceSettingsPatch } from './workspace-settings';
import type { ThemePreference } from './theme';
import type { VisualFontChoice } from './editor-font';
import type { ToolbarMode } from './toolbar-preference';
import type { PageTitleSource } from './page-title-source';
import type { UpdateCandidate, UpdatePhase, UpdateProgress, UpdateStatus } from './updates/controller';

/** Built-in pages and IDs registered by a product's settings extension. */
export type SettingsPageId = 'preferences' | 'appearance' | 'editing' | 'assistant' | 'workspace' | 'about' | (string & {});
export type SettingsAction =
  'open-folder' | 'switch-mode' | 'reveal' | 'agent' | 'history' | 'recycle' |
  'sign-out';

export interface SettingsValues {
  defaultSource: boolean;
  theme: ThemePreference;
  visualFontChoice: VisualFontChoice;
  customFontName: string;
  revealMarkdown: boolean;
  toolbarMode: ToolbarMode;
  showPageTitle: boolean;
  showOutline: boolean;
  outlineOnLeft: boolean;
  pageTitleSource: PageTitleSource;
  visualFontSize: number;
  sourceFontSize: number;
  editorPreferences: EditorPreferences;
}

export interface SettingsSnapshot extends SettingsValues, SettingsPageContext {
  workspaceSettings: WorkspaceSettings;
  workspacePages: { id: string; path: string }[];
  workspaceSettingsError: string;
  workspaceSettingsSaving: boolean;
  workspaceExporting: boolean;
  workspaceExportError: string;
  workspaceDeletionSupported?: boolean;
  workspaceDeleting?: boolean;
  workspaceDeletionError?: string;
  historyEnabled: boolean;
  capabilities: WorkspaceCapabilities;
  capabilityError: string;
  capabilitySaving: boolean;
  version: string;
  updates: {
    phase: UpdatePhase;
    status?: UpdateStatus;
    candidate?: UpdateCandidate;
    progress: UpdateProgress;
    error: string;
    busy: boolean;
  };
}

export type SettingsCommand =
  | { type: 'ready' }
  | { type: 'change'; key: keyof SettingsValues; value: SettingsValues[keyof SettingsValues] }
  | { type: 'assistant-refresh' }
  | { type: 'capability'; value: CapabilityPatch }
  | { type: 'workspace-setting'; workspaceId: string; patch: WorkspaceSettingsPatch }
  | { type: 'workspace-settings-reload' }
  | { type: 'workspace-export'; workspaceId: string }
  | { type: 'workspace-delete'; workspaceId: string }
  | { type: 'action'; value: SettingsAction }
  | { type: 'update' };

export const SETTINGS_COMMAND = 'tano-settings-command';
export const SETTINGS_STATE = 'tano-settings-state';
export const SETTINGS_NAVIGATE = 'tano-settings-navigate';
export const SETTINGS_RENDERED = 'tano-settings-rendered';

export function settingsWindowLabel() {
  return `settings-${getCurrentWindow().label}`;
}

export function settingsWindowRequest() {
  const query = new URLSearchParams(window.location.search);
  const opener = query.get('settingsOpener');
  const page = query.get('settingsPage') as SettingsPageId | null;
  return opener && getCurrentWindow().label === `settings-${opener}`
    ? { opener, page: page ?? 'appearance' }
    : null;
}

let opened: WebviewWindow | null = null;
let opening: Promise<WebviewWindow> | null = null;

const SETTINGS_WIDTH = 1080;
const SETTINGS_HEIGHT = 780;

export function centeredSettingsPosition(
  parent: { position: { x: number; y: number }; size: { width: number; height: number } },
  settingsSize: { width: number; height: number },
  workArea?: { position: { x: number; y: number }; size: { width: number; height: number } },
) {
  // Native geometry and setPosition use physical pixels, including on mixed-DPI monitors.
  const x = parent.position.x + (parent.size.width - settingsSize.width) / 2;
  const y = parent.position.y + (parent.size.height - settingsSize.height) / 2;
  if (!workArea) return { x: Math.round(x), y: Math.round(y) };
  const left = workArea.position.x;
  const top = workArea.position.y;
  const right = left + workArea.size.width - settingsSize.width;
  const bottom = top + workArea.size.height - settingsSize.height;
  return {
    x: Math.round(Math.max(left, Math.min(x, Math.max(left, right)))),
    y: Math.round(Math.max(top, Math.min(y, Math.max(top, bottom)))),
  };
}

async function settingsParentWindow() {
  return await Window.getByLabel('main').catch(() => null) ?? getCurrentWindow();
}

async function positionSettingsWindow(window: WebviewWindow) {
  const parent = await settingsParentWindow();
  const [position, size, settingsSize] = await Promise.all([
    parent.outerPosition(), parent.outerSize(), window.outerSize(),
  ]);
  const monitor = await monitorFromPoint(
    Math.round(position.x + size.width / 2),
    Math.round(position.y + size.height / 2),
  ).catch(() => null);
  const center = (childSize: typeof settingsSize) => window.setPosition(new PhysicalPosition(
    centeredSettingsPosition({ position, size }, childSize, monitor?.workArea),
  ));
  await center(settingsSize);
  // Moving to another monitor can change the native size before the window is shown.
  const movedSize = await window.outerSize();
  if (movedSize.width !== settingsSize.width || movedSize.height !== settingsSize.height) {
    await center(movedSize);
  }
}

async function createSettingsWindow(page: SettingsPageId): Promise<WebviewWindow> {
  const label = settingsWindowLabel();
  const query = new URLSearchParams({ settingsOpener: getCurrentWindow().label, settingsPage: page });
  let rendered!: () => void;
  const ready = new Promise<void>(resolve => { rendered = resolve; });
  const unlisten = await listen<{ label: string }>(SETTINGS_RENDERED, event => {
    if (event.payload.label === label) rendered();
  });
  try {
    const parent = await settingsParentWindow();
    const window = new WebviewWindow(label, {
      url: `index.html?${query.toString()}`,
      title: '设置 — Tano / 同页',
      width: SETTINGS_WIDTH,
      height: SETTINGS_HEIGHT,
      parent: parent.label,
      center: true,
      visible: false,
      minWidth: 700,
      minHeight: 500,
      decorations: false,
      dragDropEnabled: false,
      backgroundColor: '#f7f7f2',
    });
    const created = new Promise<void>((resolve, reject) => {
      void window.once('tauri://created', () => resolve());
      void window.once<string>('tauri://error', event => reject(new Error(String(event.payload))));
    });
    try {
      await created;
      opened = window;
      void window.once('tauri://destroyed', () => {
        if (opened === window) opened = null;
      });
      // Hidden WebView startup happens in the background. Show it after the first settings render.
      await Promise.race([ready, new Promise<void>(resolve => setTimeout(resolve, 1500))]);
      return window;
    } catch (error) {
      await window.destroy().catch(() => {});
      throw error;
    }
  } finally {
    unlisten();
  }
}

async function ensureSettingsWindow(page: SettingsPageId) {
  if (opened && !opening) return opened;
  if (!opening) opening = createSettingsWindow(page);
  try {
    return await opening;
  } finally {
    opening = null;
  }
}

export async function prewarmSettingsWindow() {
  await ensureSettingsWindow('appearance');
}

async function showSettingsWindow(window: WebviewWindow, page: SettingsPageId) {
  await emitTo(window.label, SETTINGS_NAVIGATE, page);
  if (!await window.isVisible()) {
    // Prewarming and hiding preserve an old position. Refresh it before each reveal.
    // Unavailable native geometry must not prevent settings from opening.
    await positionSettingsWindow(window).catch(() => {});
  }
  await window.show();
  await window.setFocus();
  return window;
}

export async function openSettingsWindow(page: SettingsPageId): Promise<WebviewWindow> {
  let window = await ensureSettingsWindow(page);
  try {
    return await showSettingsWindow(window, page);
  } catch {
    // An externally destroyed window can leave a stale handle until its event arrives.
    if (opened === window) opened = null;
    window = await ensureSettingsWindow(page);
    return showSettingsWindow(window, page);
  }
}

export async function closeSettingsWindow() {
  await opening?.catch(() => {});
  const window = opened;
  opened = null;
  await window?.destroy().catch(() => {});
}
