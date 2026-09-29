// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  currentLabel: 'main',
  windows: [] as Array<{
    label: string; options: Record<string, unknown>; focusCount: number; showCount: number; destroyed: boolean;
  }>,
  listeners: new Map<string, (event: { payload: { label: string } }) => void>(),
  emitTo: vi.fn(async (_target: string, _event: string, _payload: unknown) => {}),
  main: {
    outerPosition: vi.fn(async () => ({ x: 300, y: 150 })),
    outerSize: vi.fn(async () => ({ width: 2160, height: 1410 })),
    scaleFactor: vi.fn(async () => 1.5),
  },
  monitorFromPoint: vi.fn(async (_x: number, _y: number) => ({
    workArea: { position: { x: 0, y: 0 }, size: { width: 2880, height: 1620 } },
  })),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: native.currentLabel, ...native.main }),
  Window: { getByLabel: async (label: string) => label === 'main' ? native.main : null },
  monitorFromPoint: native.monitorFromPoint,
}));
vi.mock('@tauri-apps/api/event', () => ({
  emitTo: native.emitTo,
  listen: async (name: string, callback: (event: { payload: { label: string } }) => void) => {
    native.listeners.set(name, callback);
    return () => native.listeners.delete(name);
  },
}));
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: class {
    label: string;
    options: Record<string, unknown>;
    focusCount = 0;
    showCount = 0;
    destroyed = false;
    private onDestroyed?: () => void;
    constructor(label: string, options: Record<string, unknown>) {
      this.label = label;
      this.options = options;
      native.windows.push(this);
    }
    async once(event: string, callback: () => void) {
      if (event === 'tauri://created') queueMicrotask(() => {
        callback();
        queueMicrotask(() => native.listeners.get('tano-settings-rendered')?.({ payload: { label: this.label } }));
      });
      if (event === 'tauri://destroyed') this.onDestroyed = callback;
      return () => {};
    }
    async setFocus() { this.focusCount++; }
    async show() { this.showCount++; }
    async destroy() { this.destroyed = true; this.onDestroyed?.(); }
  },
}));

import {
  SETTINGS_NAVIGATE, centeredSettingsPosition, closeSettingsWindow, openSettingsWindow,
  prewarmSettingsWindow, settingsWindowRequest,
} from './settings-window';

it('prewarms a hidden settings window, then shows and reuses it', async () => {
  await prewarmSettingsWindow();
  expect(native.windows[0]?.options.visible).toBe(false);
  expect(native.windows[0]?.showCount).toBe(0);
  const first = await openSettingsWindow('appearance');
  expect(native.windows).toHaveLength(1);
  expect(native.windows[0]?.options).toMatchObject({
    url: 'index.html?settingsOpener=main&settingsPage=appearance',
    decorations: false,
    x: 380,
    y: 180,
  });
  expect(native.monitorFromPoint).toHaveBeenCalledWith(1380, 855);
  expect(native.windows[0]?.showCount).toBe(1);
  const second = await openSettingsWindow('editing');
  expect(second).toBe(first);
  expect(native.windows).toHaveLength(1);
  expect(native.windows[0]?.showCount).toBe(2);
  expect(native.emitTo).toHaveBeenCalledWith('settings-main', SETTINGS_NAVIGATE, 'editing');
  await closeSettingsWindow();
  expect(native.windows[0]?.destroyed).toBe(true);
});

it('keeps the centered window inside the monitor work area near an edge', () => {
  expect(centeredSettingsPosition(
    { position: { x: 1900, y: 600 }, size: { width: 1000, height: 800 } },
    1,
    { position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } },
  )).toEqual({ x: 840, y: 300 });
});

it('accepts a settings route only inside its matching native window', () => {
  window.history.replaceState({}, '', '?settingsOpener=main&settingsPage=about');
  native.currentLabel = 'main';
  expect(settingsWindowRequest()).toBeNull();
  native.currentLabel = 'settings-main';
  expect(settingsWindowRequest()).toEqual({ opener: 'main', page: 'about' });
  window.history.replaceState({}, '', '/');
  native.currentLabel = 'main';
});
