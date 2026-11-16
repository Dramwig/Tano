// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, nextTick, reactive } from 'vue';
import { useAuxiliaryWindows } from './manager';
import type { useWorkspaceStore } from '../stores/workspace';
import { newWindowLayout } from './layout';

const fixture = vi.hoisted(() => ({
  windows: new Map<string, any>(),
  popups: [] as any[],
  stylesReady: Promise.resolve(),
}));
vi.mock('@tauri-apps/api/window', () => ({
  Window: { getByLabel: async () => ({
    outerPosition: async () => ({ x: 100, y: 100 }),
    outerSize: async () => ({ width: 1400, height: 900 }),
  }) },
  monitorFromPoint: async () => null,
}));
vi.mock('./context', () => ({ createWindowContext: async (id: string, label: string, window: Window) => {
  const native = {
    destroy: vi.fn(async () => {}), setFocus: vi.fn(async () => {}), unminimize: vi.fn(async () => {}),
    show: vi.fn(async () => {}), setTitle: vi.fn(async () => {}),
    setPosition: vi.fn(async () => {}), outerSize: async () => ({ width: 1080, height: 780 }),
    onCloseRequested: vi.fn(async (callback: unknown) => { native.closeRequested = callback; return vi.fn(); }),
    closeRequested: undefined as any,
  };
  fixture.windows.set(id, native);
  return { id, label, window, document: window.document, overlays: window.document.body, native };
} }));
vi.mock('./aux-window', () => ({ openAuxWindow: vi.fn((options: unknown) => {
  let finish!: () => void;
  const popup = { options, window, document, mount: document.createElement('div'),
    stylesReady: fixture.stylesReady,
    closed: new Promise<void>(resolve => { finish = resolve; }),
    close: vi.fn(() => finish()), externalClose: () => finish(),
  };
  fixture.popups.push(popup);
  return popup;
}) }));

let app: ReturnType<typeof createApp>;
let manager: ReturnType<typeof useAuxiliaryWindows>;
let store: ReturnType<typeof useWorkspaceStore>;
let prepare: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
beforeEach(() => {
  fixture.windows.clear(); fixture.popups.length = 0;
  fixture.stylesReady = Promise.resolve();
  prepare = vi.fn(async () => true);
  store = reactive({ windowLayouts: { main: {}, one: {} },
    closeAuxiliaryWindow: vi.fn(async () => true), report: vi.fn(),
  }) as unknown as ReturnType<typeof useWorkspaceStore>;
  app = createApp({ setup() { manager = useAuxiliaryWindows(store, prepare); return () => null; } });
  app.mount(document.createElement('div'));
});
afterEach(() => app.unmount());

it('destroys native popup hosts when the owning component unmounts', async () => {
  await manager.open('settings', 'settings', 'Settings');
  app.unmount();
  expect(fixture.popups[0].close).toHaveBeenCalledOnce();
  expect(fixture.windows.get('settings').destroy).toHaveBeenCalledOnce();
  expect(manager.entries.size).toBe(0);
});

it('shares concurrent settings opens and focuses the existing window', async () => {
  const [first, second] = await Promise.all([
    manager.open('settings', 'settings', 'Settings'), manager.open('settings', 'settings', 'Settings'),
  ]);
  expect(second).toBe(first);
  expect(fixture.popups).toHaveLength(1);
  await manager.open('settings', 'settings', 'Settings');
  expect(fixture.windows.get('settings').setFocus).toHaveBeenCalledTimes(2);
  expect(fixture.popups[0].options).toMatchObject({ width: 1080, height: 780, kind: 'settings' });
});

it('retains every window when saving fails before closing all', async () => {
  await manager.open('one', 'tab', 'Document');
  await manager.open('settings', 'settings', 'Settings');
  prepare.mockResolvedValue(false);
  expect(await manager.closeAll()).toBe(false);
  expect(manager.entries.size).toBe(2);
  expect(store.closeAuxiliaryWindow).not.toHaveBeenCalled();
  expect(fixture.popups.every(popup => popup.close.mock.calls.length === 0)).toBe(true);
});

it('prepares content and waits for styles before showing the native window', async () => {
  let finishStyles!: () => void;
  fixture.stylesReady = new Promise<void>(resolve => { finishStyles = resolve; });
  const prepareContent = vi.fn(entry => {
    expect(entry.context.native.show).not.toHaveBeenCalled();
    expect(manager.entries.has(entry.id)).toBe(true);
    entry.aux.mount.textContent = 'Ready';
  });
  const pending = manager.open('two', 'tab', 'Document', undefined, prepareContent);
  await vi.waitFor(() => expect(prepareContent).toHaveBeenCalledOnce());
  expect(fixture.windows.get('two').show).not.toHaveBeenCalled();
  finishStyles();
  const entry = await pending;
  expect(prepareContent).toHaveBeenCalledOnce();
  expect(entry.aux.mount.textContent).toBe('Ready');
  expect(entry.context.native!.show).toHaveBeenCalledOnce();
});

it('returns moved documents to the main window if native presentation fails', async () => {
  store.windowLayouts.main = newWindowLayout();
  store.moveTabToWindow = vi.fn();
  await expect(manager.open('two', 'tab', 'Document', undefined, entry => {
    store.windowLayouts.two = newWindowLayout(['document']);
    vi.mocked(entry.context.native!.show).mockRejectedValueOnce(new Error('show failed'));
  })).rejects.toThrow('show failed');
  expect(store.moveTabToWindow).toHaveBeenCalledWith('document', 'main', {
    paneId: store.windowLayouts.main.activePaneId, side: 'center',
  });
  expect(manager.entries.has('two')).toBe(false);
  expect(fixture.popups[0].close).toHaveBeenCalledOnce();
});

it('settles an opening popup that disappears before its styles load and retains its documents', async () => {
  fixture.stylesReady = new Promise(() => {});
  store.windowLayouts.main = newWindowLayout();
  store.windowLayouts.two = newWindowLayout(['document']);
  store.moveTabToWindow = vi.fn();
  const opening = manager.open('two', 'tab', 'Document');
  const outcome = expect(opening).rejects.toThrow('closed before presentation');
  await vi.waitFor(() => expect(manager.entries.has('two')).toBe(true));
  fixture.popups[0].externalClose();
  await outcome;
  expect(store.moveTabToWindow).toHaveBeenCalledWith('document', 'main', {
    paneId: store.windowLayouts.main.activePaneId, side: 'center',
  });
  expect(manager.entries.size).toBe(0);
  expect(await manager.closeAll()).toBe(true);
});

it('does not present a popup closed while waiting for its styles', async () => {
  fixture.stylesReady = new Promise(() => {});
  const opening = manager.open('settings', 'settings', 'Settings');
  const outcome = expect(opening).rejects.toThrow('closed before presentation');
  await vi.waitFor(() => expect(manager.entries.has('settings')).toBe(true));
  expect(await manager.close('settings')).toBe(true);
  await outcome;
  expect(fixture.windows.get('settings').show).not.toHaveBeenCalled();
  expect(fixture.windows.get('settings').destroy).toHaveBeenCalledOnce();
  expect(manager.entries.size).toBe(0);
});

it('intercepts native close and retains the UI until its tabs close successfully', async () => {
  await manager.open('one', 'tab', 'Document');
  vi.mocked(store.closeAuxiliaryWindow).mockResolvedValueOnce(false);
  const preventDefault = vi.fn();
  fixture.windows.get('one').closeRequested({ preventDefault });
  await vi.waitFor(() => expect(store.closeAuxiliaryWindow).toHaveBeenCalledWith('one'));
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(manager.entries.has('one')).toBe(true);
  expect(await manager.close('one')).toBe(true);
  expect(manager.entries.has('one')).toBe(false);
});

it('destroys an empty auxiliary layout after its final tab moves away', async () => {
  await manager.open('one', 'tab', 'Document');
  delete store.windowLayouts.one;
  await nextTick();
  await vi.waitFor(() => expect(manager.entries.has('one')).toBe(false));
  expect(fixture.windows.get('one').destroy).toHaveBeenCalledOnce();
});

it('recreates an externally destroyed UI when its document cannot be saved', async () => {
  await manager.open('one', 'tab', 'Document');
  vi.mocked(store.closeAuxiliaryWindow).mockResolvedValue(false);
  fixture.popups[0].externalClose();
  await vi.waitFor(() => expect(fixture.popups).toHaveLength(2));
  expect(manager.entries.has('one')).toBe(true);
});
