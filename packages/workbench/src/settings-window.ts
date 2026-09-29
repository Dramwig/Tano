import { emitTo, listen } from '@tauri-apps/api/event';
import { Window, getCurrentWindow, monitorFromPoint } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { Workspace } from '@tano/protocol';
import type { EditorPreferences, WorkspaceCapabilities } from '@tano/editor/runtime';
import type { CapabilityPatch } from './workspace-capabilities';
import type { ThemePreference } from './theme';
import type { VisualFontChoice } from './editor-font';
import type { UpdateCandidate, UpdatePhase, UpdateProgress, UpdateStatus } from './updates/controller';

export type SettingsPageId = 'preferences' | 'appearance' | 'editing' | 'workspace' | 'about';
export type SettingsAction =
  'open-folder' | 'switch-mode' | 'reveal' | 'agent' | 'history' | 'recycle' |
  'backup' | 'export' | 'import' | 'sign-out';

export interface SettingsValues {
  defaultSource: boolean;
  theme: ThemePreference;
  visualFontChoice: VisualFontChoice;
  customFontName: string;
  revealMarkdown: boolean;
  showPageTitle: boolean;
  visualFontSize: number;
  sourceFontSize: number;
  editorPreferences: EditorPreferences;
}

export interface SettingsSnapshot extends SettingsValues {
  workspace: Pick<Workspace, 'name' | 'path' | 'readOnly'> | null;
  mode: 'demo' | 'web' | 'local';
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
  | { type: 'capability'; value: CapabilityPatch }
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
  scale: number,
  workArea?: { position: { x: number; y: number }; size: { width: number; height: number } },
) {
  const x = (parent.position.x + (parent.size.width - SETTINGS_WIDTH * scale) / 2) / scale;
  const y = (parent.position.y + (parent.size.height - SETTINGS_HEIGHT * scale) / 2) / scale;
  if (!workArea) return { x: Math.round(x), y: Math.round(y) };
  const left = workArea.position.x / scale;
  const top = workArea.position.y / scale;
  const right = left + workArea.size.width / scale - SETTINGS_WIDTH;
  const bottom = top + workArea.size.height / scale - SETTINGS_HEIGHT;
  return {
    x: Math.round(Math.max(left, Math.min(x, Math.max(left, right)))),
    y: Math.round(Math.max(top, Math.min(y, Math.max(top, bottom)))),
  };
}

async function initialSettingsPosition() {
  const parent = await Window.getByLabel('main').catch(() => null) ?? getCurrentWindow();
  const [position, size, scale] = await Promise.all([
    parent.outerPosition(), parent.outerSize(), parent.scaleFactor(),
  ]);
  const monitor = await monitorFromPoint(
    Math.round(position.x + size.width / 2),
    Math.round(position.y + size.height / 2),
  ).catch(() => null);
  return centeredSettingsPosition({ position, size }, scale, monitor?.workArea);
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
    // A missing monitor or unavailable geometry must not prevent settings from opening.
    const position = await initialSettingsPosition().catch(() => null);
    const window = new WebviewWindow(label, {
      url: `index.html?${query.toString()}`,
      title: '设置 — Tano / 同页',
      width: SETTINGS_WIDTH,
      height: SETTINGS_HEIGHT,
      ...(position ?? { center: true }),
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

export async function openSettingsWindow(page: SettingsPageId): Promise<WebviewWindow> {
  let window = await ensureSettingsWindow(page);
  try {
    await emitTo(window.label, SETTINGS_NAVIGATE, page);
    await window.show();
    await window.setFocus();
    return window;
  } catch {
    // An externally destroyed window can leave a stale handle until its event arrives.
    if (opened === window) opened = null;
    window = await ensureSettingsWindow(page);
    await emitTo(window.label, SETTINGS_NAVIGATE, page);
    await window.show();
    await window.setFocus();
    return window;
  }
}

export async function closeSettingsWindow() {
  await opening?.catch(() => {});
  const window = opened;
  opened = null;
  await window?.destroy().catch(() => {});
}
