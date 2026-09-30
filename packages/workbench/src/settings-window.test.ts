// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PhysicalPosition } from '@tauri-apps/api/dpi';
import capabilities from '../../../apps/client/src-tauri/capabilities/default.json';

const native = vi.hoisted(() => ({
  currentLabel: 'main',
  windows: [] as Array<{
    label: string; options: Record<string, unknown>; focusCount: number; showCount: number; destroyed: boolean;
    visible: boolean; position: { x: number; y: number }; size: { width: number; height: number };
    positionsAtShow: Array<{ x: number; y: number }>;
    outerSize: ReturnType<typeof vi.fn>; setPosition: ReturnType<typeof vi.fn>;
  }>,
  listeners: new Map<string, (event: { payload: { label: string } }) => void>(),
  emitTo: vi.fn(async (_target: string, _event: string, _payload: unknown) => {}),
  main: {
    label: 'main',
    outerPosition: vi.fn(async () => ({ x: 300, y: 150 })),
    outerSize: vi.fn(async () => ({ width: 2160, height: 1410 })),
    scaleFactor: vi.fn(async () => 1.5),
  },
  monitorFromPoint: vi.fn(async (_x: number, _y: number) => ({
    workArea: { position: { x: 0, y: 0 }, size: { width: 2880, height: 1620 } },
  })),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ ...native.main, label: native.currentLabel }),
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
    visible = false;
    position = { x: 0, y: 0 };
    size = { width: 1620, height: 1170 };
    positionsAtShow: Array<{ x: number; y: number }> = [];
    outerSize = vi.fn(async () => ({ ...this.size }));
    setPosition = vi.fn(async (position: { x: number; y: number }) => {
      this.position = { x: position.x, y: position.y };
    });
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
    async isVisible() {
      if (this.destroyed) throw new Error('Window not found');
      return this.visible;
    }
    async show() {
      this.showCount++;
      this.visible = true;
      this.positionsAtShow.push({ ...this.position });
    }
    async destroy() { this.destroyed = true; this.onDestroyed?.(); }
  },
}));

import {
  SETTINGS_NAVIGATE, centeredSettingsPosition, closeSettingsWindow, openSettingsWindow,
  prewarmSettingsWindow, settingsWindowRequest,
} from './settings-window';

beforeEach(() => {
  vi.resetAllMocks();
  native.currentLabel = 'main';
  native.windows.length = 0;
  native.main.outerPosition.mockResolvedValue({ x: 300, y: 150 });
  native.main.outerSize.mockResolvedValue({ width: 2160, height: 1410 });
  native.main.scaleFactor.mockResolvedValue(1.5);
  native.monitorFromPoint.mockResolvedValue({
    workArea: { position: { x: 0, y: 0 }, size: { width: 2880, height: 1620 } },
  });
});

afterEach(async () => { await closeSettingsWindow(); });

it('prewarms a hidden settings window, then shows and reuses it', async () => {
  await prewarmSettingsWindow();
  expect(native.windows[0]?.options.visible).toBe(false);
  expect(native.windows[0]?.showCount).toBe(0);
  const first = await openSettingsWindow('appearance');
  expect(native.windows).toHaveLength(1);
  expect(native.windows[0]?.options).toMatchObject({
    url: 'index.html?settingsOpener=main&settingsPage=appearance',
    decorations: false,
    parent: 'main',
  });
  expect(native.windows[0]?.positionsAtShow).toEqual([{ x: 570, y: 270 }]);
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

it('uses the current main window position when first shown after prewarming', async () => {
  await prewarmSettingsWindow();
  native.main.outerPosition.mockResolvedValue({ x: 600, y: 300 });
  await openSettingsWindow('appearance');
  expect(native.windows[0]?.positionsAtShow).toEqual([{ x: 870, y: 420 }]);
  expect(native.windows[0]?.setPosition).toHaveBeenCalledWith(new PhysicalPosition(870, 420));
});

it('recenters on the resized main window when hidden settings are reopened', async () => {
  await openSettingsWindow('appearance');
  const settings = native.windows[0]!;
  settings.visible = false;
  settings.position = { x: 20, y: 20 };
  settings.size = { width: 1500, height: 1050 };
  native.main.outerPosition.mockResolvedValue({ x: 0, y: 0 });
  native.main.outerSize.mockResolvedValue({ width: 2880, height: 1620 });
  await openSettingsWindow('editing');
  expect(native.windows).toHaveLength(1);
  expect(settings.positionsAtShow.at(-1)).toEqual({ x: 690, y: 285 });
});

it('keeps the user position when focusing settings that are already visible', async () => {
  await openSettingsWindow('appearance');
  const settings = native.windows[0]!;
  settings.position = { x: 70, y: 40 };
  settings.setPosition.mockClear();
  await openSettingsWindow('editing');
  expect(settings.setPosition).not.toHaveBeenCalled();
  expect(settings.positionsAtShow.at(-1)).toEqual({ x: 70, y: 40 });
  expect(settings.focusCount).toBe(2);
});

it('corrects for the native size change when moving to a monitor with different DPI', async () => {
  await prewarmSettingsWindow();
  const settings = native.windows[0]!;
  native.main.outerPosition.mockResolvedValue({ x: -3500, y: 150 });
  native.main.outerSize.mockResolvedValue({ width: 2880, height: 1880 });
  native.monitorFromPoint.mockResolvedValue({
    workArea: { position: { x: -3840, y: 0 }, size: { width: 3840, height: 2160 } },
  });
  settings.setPosition.mockImplementation(async (position: { x: number; y: number }) => {
    settings.position = { x: position.x, y: position.y };
    settings.size = { width: 2160, height: 1560 };
  });
  await openSettingsWindow('appearance');
  expect(settings.positionsAtShow).toEqual([{ x: -3140, y: 310 }]);
  expect(native.monitorFromPoint).toHaveBeenCalledWith(-2060, 1090);
});

it('positions a replacement window when a cached handle has been destroyed externally', async () => {
  await prewarmSettingsWindow();
  native.windows[0]!.destroyed = true;
  native.main.outerPosition.mockResolvedValue({ x: 600, y: 300 });
  await openSettingsWindow('editing');
  expect(native.windows).toHaveLength(2);
  expect(native.windows[1]?.positionsAtShow).toEqual([{ x: 870, y: 420 }]);
});

it('can still center on the main window when monitor lookup is unavailable', async () => {
  native.monitorFromPoint.mockRejectedValue(new Error('No monitor'));
  await openSettingsWindow('appearance');
  expect(native.windows[0]?.positionsAtShow).toEqual([{ x: 570, y: 270 }]);
});

it('still opens settings when native geometry cannot be read', async () => {
  native.main.outerPosition.mockRejectedValue(new Error('Geometry unavailable'));
  await openSettingsWindow('appearance');
  expect(native.windows[0]?.showCount).toBe(1);
  expect(native.windows[0]?.focusCount).toBe(1);
});

it('grants native window positioning permission', () => {
  expect(capabilities.permissions).toContain('core:window:allow-set-position');
});

it('keeps the centered window inside the monitor work area near an edge', () => {
  expect(centeredSettingsPosition(
    { position: { x: 1900, y: 600 }, size: { width: 1000, height: 800 } },
    { width: 1080, height: 780 },
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
