// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openDocumentPrintWindow, printWindowRequest, PRINT_CONTENT, PRINT_LOADED, PRINT_READY } from './print-window';

const state = vi.hoisted(() => ({ label: 'main', failure: false, closed: false,
  listeners: new Map<string, (event: { payload: any }) => void>(),
  payload: undefined as any, windowOptions: undefined as any, printLabel: '', destroy: vi.fn<() => Promise<void>>(),
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: state.label }) }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name, handler) => { state.listeners.set(name, handler); return () => state.listeners.delete(name); }),
  emitTo: vi.fn(async (label, name, payload) => {
    state.payload = payload;
    if (name === 'tano-print-content') state.listeners.get('tano-print-loaded')?.({ payload: { label, ...(state.failure ? { error: '样式加载失败' } : {}) } });
  }),
}));
vi.mock('@tauri-apps/api/webviewWindow', () => ({ WebviewWindow: class {
  destroy = state.destroy;
  constructor(label: string, options: unknown) {
    state.printLabel = label; state.windowOptions = options;
    queueMicrotask(() => state.listeners.get('tano-print-ready')?.({ payload: { label } }));
  }
  async once(name: string, handler: (event: unknown) => void) {
    if (state.closed && name === 'tauri://destroyed') handler({});
    return () => {};
  }
} }));

beforeEach(() => {
  state.label = 'main'; state.failure = false; state.closed = false; state.payload = undefined;
  state.destroy.mockResolvedValue(undefined);
  document.title = '编辑中的文档'; history.replaceState(null, '', '/');
});
afterEach(() => { state.listeners.clear(); vi.clearAllMocks(); document.head.querySelectorAll('[data-print-test]').forEach(node => node.remove()); });

it('opens a frameless independent window and transfers the static document without changing the editor', async () => {
  const style = document.createElement('style'); style.dataset.printTest = ''; style.textContent = '.document-export-content{color:#123456}'; document.head.append(style);
  const snapshot = document.createElement('main'); snapshot.innerHTML = '<h1>标题</h1><p>点击时的完整正文</p>';
  await openDocumentPrintWindow(snapshot, '打印标题');
  expect(state.windowOptions).toMatchObject({ visible: true, decorations: false, resizable: true, width: 1100, height: 800 });
  expect(state.windowOptions.parent).toBeUndefined();
  expect(state.windowOptions.url).toContain('tanoPrint=print-');
  expect(state.payload.html).toContain('点击时的完整正文');
  expect(state.payload.css).toContain(style.textContent);
  expect(document.title).toBe('编辑中的文档');
  expect(document.documentElement.classList.contains('document-printing')).toBe(false);
  expect(state.listeners.size).toBe(0);
});

it('destroys a failed print window and removes its handshake subscriptions', async () => {
  state.failure = true;
  await expect(openDocumentPrintWindow(document.createElement('main'), '标题')).rejects.toThrow('样式加载失败');
  expect(state.destroy).toHaveBeenCalledOnce();
  expect(state.listeners.size).toBe(0);
});

it('treats closing the window while it starts as cancellation', async () => {
  state.closed = true;
  await expect(openDocumentPrintWindow(document.createElement('main'), '标题')).resolves.toBeUndefined();
  expect(state.listeners.size).toBe(0);
});

it('accepts print requests only in their matching native window', () => {
  history.replaceState(null, '', '/?tanoPrint=print-test&printOpener=main');
  expect(printWindowRequest()).toBeNull();
  state.label = 'print-test';
  expect(printWindowRequest()).toEqual({ label: 'print-test', opener: 'main' });
  expect([PRINT_CONTENT, PRINT_READY, PRINT_LOADED]).toHaveLength(3);
});
