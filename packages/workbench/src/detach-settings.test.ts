// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createDetachedTabWindow, detachedTabRequest } from './detach-tab';

const native = vi.hoisted(() => ({
  label: 'main',
  options: {} as Record<string, unknown>,
  autoReady: true,
  createdLabel: '',
  show: vi.fn(async () => {}),
  focus: vi.fn(async () => {}),
  destroy: vi.fn(async () => {}),
  ready: undefined as undefined | ((event: { payload: { label: string } }) => void),
}));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: native.label }) }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_name, handler) => { native.ready = handler; return () => {}; }),
  emitTo: vi.fn(),
}));
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: class {
    constructor(public label: string, options: Record<string, unknown>) { native.options = options; native.createdLabel = label; }
    async once(event: string, handler: () => void) {
      if (event === 'tauri://created') {
        handler();
        if (native.autoReady) native.ready?.({ payload: { label: this.label } });
      }
    }
    show = native.show;
    setFocus = native.focus;
    destroy = native.destroy;
  },
}));
afterEach(() => {
  vi.useRealTimers();
  native.label = 'main';
  native.autoReady = true;
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});

it('carries the settings category into a normal detached tab window', async () => {
  vi.useFakeTimers();
  const detached = await createDetachedTabWindow('C:/工作区', 'view:settings', '设置', undefined, 'shortcuts');
  const url = new URL(native.options.url as string, window.location.origin);
  expect(native.options.title).toBe('设置 — Tano / 同页');
  expect(native.options.visible).toBe(false);
  window.history.replaceState(null, '', url.pathname + url.search);
  expect(detachedTabRequest()).toBeNull();
  native.label = detached.label;
  expect(detachedTabRequest()).toEqual({
    workspacePath: 'C:/工作区', tabId: 'view:settings', opener: 'main', settingsPage: 'shortcuts',
  });
});

it('keeps the window hidden until its target view is ready', async () => {
  vi.useFakeTimers();
  native.autoReady = false;
  const opening = createDetachedTabWindow('C:/工作区', 'view:settings', '设置');
  await vi.advanceTimersByTimeAsync(0);
  expect(native.show).not.toHaveBeenCalled();
  native.ready?.({ payload: { label: 'unrelated-window' } });
  await vi.advanceTimersByTimeAsync(0);
  expect(native.show).not.toHaveBeenCalled();
  native.ready?.({ payload: { label: native.createdLabel } });
  await opening;
  expect(native.show).toHaveBeenCalledOnce();
  expect(native.focus).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('destroys a stalled hidden window without revealing the startup screen', async () => {
  vi.useFakeTimers();
  native.autoReady = false;
  const opening = createDetachedTabWindow('C:/工作区', 'view:settings', '设置');
  const rejected = expect(opening).rejects.toThrow('独立窗口启动超时');
  await vi.advanceTimersByTimeAsync(15_000);
  await rejected;
  expect(native.show).not.toHaveBeenCalled();
  expect(native.destroy).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
