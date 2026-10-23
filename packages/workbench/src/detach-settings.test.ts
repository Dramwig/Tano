// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createDetachedTabWindow, detachedTabRequest } from './detach-tab';

const native = vi.hoisted(() => ({
  label: 'main',
  options: {} as Record<string, unknown>,
  ready: undefined as undefined | ((event: { payload: { label: string } }) => void),
}));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: native.label }) }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_name, handler) => { native.ready = handler; return () => {}; }),
  emitTo: vi.fn(),
}));
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: class {
    constructor(public label: string, options: Record<string, unknown>) { native.options = options; }
    async once(event: string, handler: () => void) {
      if (event === 'tauri://created') {
        handler();
        native.ready?.({ payload: { label: this.label } });
      }
    }
    async destroy() {}
  },
}));
afterEach(() => {
  vi.useRealTimers();
  native.label = 'main';
  window.history.replaceState(null, '', '/');
});

it('carries the settings category into a normal detached tab window', async () => {
  vi.useFakeTimers();
  const detached = await createDetachedTabWindow('C:/工作区', 'view:settings', '设置', undefined, 'shortcuts');
  const url = new URL(native.options.url as string, window.location.origin);
  expect(native.options.title).toBe('设置 — Tano / 同页');
  window.history.replaceState(null, '', url.pathname + url.search);
  expect(detachedTabRequest()).toBeNull();
  native.label = detached.label;
  expect(detachedTabRequest()).toEqual({
    workspacePath: 'C:/工作区', tabId: 'view:settings', opener: 'main', settingsPage: 'shortcuts',
  });
});
