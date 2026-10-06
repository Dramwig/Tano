// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, markRaw, nextTick, reactive, ref } from 'vue';
import type { App } from 'vue';
import DesktopTabs from './DesktopTabs.vue';
import { TAB_DOCK_PROBE, TAB_DRAG_FINISHED, tabDragMetaType } from '../tab-docking';

const fixture = vi.hoisted(() => ({ store: null as any }));
const platform = vi.hoisted(() => ({ nativeOs: 'windows', mobile: false }));
const nativeWindow = vi.hoisted(() => ({
  label: 'main',
  cursorPosition: vi.fn(async () => ({ x: 1200, y: 800 })),
  innerPosition: vi.fn(async () => ({ x: 0, y: 0 })),
  scaleFactor: vi.fn(async () => 1),
}));
const nativeCore = vi.hoisted(() => ({ invoke: vi.fn((): Promise<{ x: number; y: number }> => new Promise(() => {})) }));
const nativeEvents = vi.hoisted(() => ({
  listeners: new Map<string, Set<(event: { payload: any }) => void>>(),
  emitTo: vi.fn(async (_label: string, _event: string, _payload: unknown) => {}),
}));
vi.mock('../stores/workspace', () => ({ useWorkspaceStore: () => fixture.store }));
vi.mock('../platform', () => platform);
vi.mock('@tauri-apps/api/core', () => ({ invoke: nativeCore.invoke }));
vi.mock('@tauri-apps/api/event', () => ({
  emitTo: nativeEvents.emitTo,
  emit: vi.fn(async () => {}),
  listen: vi.fn(async (name: string, handler: (event: { payload: any }) => void) => {
    const handlers = nativeEvents.listeners.get(name) ?? new Set();
    handlers.add(handler);
    nativeEvents.listeners.set(name, handlers);
    return () => handlers.delete(handler);
  }),
}));
vi.mock('@tauri-apps/api/window', () => ({
  cursorPosition: nativeWindow.cursorPosition,
  getCurrentWindow: () => nativeWindow,
}));
let app: App;
let root: HTMLDivElement;
let buttons: HTMLButtonElement[];

function pointer(target: HTMLElement, type: string, x: number, y = 18) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  });
  Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true } });
  target.dispatchEvent(event);
}

beforeEach(() => {
  platform.nativeOs = 'windows';
  platform.mobile = false;
  nativeCore.invoke.mockReset().mockImplementation(() => new Promise(() => {}));
  nativeEvents.listeners.clear();
  nativeEvents.emitTo.mockClear();
  fixture.store = reactive({
    documents: ['a', 'b', 'c'].map((id) => ({ id, path: `${id}.md` })),
    tabs: ['a', 'b', 'c'].map((id) => ({
      id,
      path: `${id}.md`,
      blank: false,
      document: { id, path: `${id}.md` },
    })),
    activeId: 'b',
    workspace: { id: 'workspace-1' },
    dirty: () => false,
    canNavigateHistory: vi.fn(() => false),
    navigateHistory: vi.fn(),
    moveDocument: vi.fn(),
    close: vi.fn(),
    report: vi.fn(),
  });
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  root = document.createElement('div');
  root.innerHTML =
    '<header class="desktop-window-titlebar"><div class="desktop-window-tab-slot"></div><div class="desktop-window-drag"></div></header>';
  document.body.append(root);
  app = createApp(DesktopTabs);
  app.mount(root.querySelector('.desktop-window-tab-slot')!);
  const list = root.querySelector<HTMLElement>('.desktop-tab-list')!;
  list.getBoundingClientRect = () => ({ left: 0, right: 600, top: 0, bottom: 36 }) as DOMRect;
  root.querySelectorAll<HTMLElement>('.desktop-tab').forEach((tab, index) => {
    tab.getBoundingClientRect = () =>
      ({
        left: index * 200,
        right: (index + 1) * 200,
        top: 0,
        bottom: 36,
        width: 200,
        height: 36,
      }) as DOMRect;
  });
  buttons = [...root.querySelectorAll<HTMLButtonElement>('.desktop-tab-switch')];
  for (const button of buttons) {
    button.setPointerCapture = vi.fn();
    button.hasPointerCapture = () => true;
    button.releasePointerCapture = vi.fn();
  }
});

it('labels the fullscreen assistant tab and restores the document label when its mode changes', async () => {
  app.unmount();
  const assistantTab = ref<{ id: string; title: string } | undefined>({ id: 'b', title: 'Tano 助手' });
  app = createApp(() => h(DesktopTabs, { assistantTab: assistantTab.value }));
  app.mount(root.querySelector('.desktop-window-tab-slot')!);
  const tab = root.querySelector<HTMLButtonElement>('[data-id="b"] [role="tab"]')!;
  expect(tab.title).toBe('Tano 助手');
  expect(tab.querySelector('.lucide-bot-icon')).not.toBeNull();
  expect(root.querySelector('[aria-label="关闭 Tano 助手"]')).not.toBeNull();
  assistantTab.value = undefined; await nextTick();
  expect(tab.title).toBe('b.md');
  expect(tab.querySelector('.desktop-tab-label')!.textContent).toBe('b');
  expect(tab.querySelector('.lucide-file-text-icon')).not.toBeNull();
});

it('renders extension labels and icons and prevents detaching window-local views', async () => {
  app.unmount();
  fixture.store.tabs.push({
    id: 'view:sample', path: '', blank: false,
    view: { id: 'view:sample', label: '扩展页面', icon: markRaw({ render: () => h('svg', { 'data-extension-icon': '' }) }) },
  });
  fixture.store.activeId = 'view:sample';
  app = createApp(DesktopTabs, { detachable: true });
  app.mount(root.querySelector('.desktop-window-tab-slot')!);
  const tab = root.querySelector<HTMLElement>('[role="tab"][title="扩展页面"]')!;
  expect(tab.getAttribute('aria-selected')).toBe('true');
  expect(tab.querySelector('[data-extension-icon]')).not.toBeNull();
  tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  await nextTick();
  const detach = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(button => button.textContent?.includes('在新窗口中打开'))!;
  expect(detach.disabled).toBe(true);
  root.querySelector<HTMLButtonElement>('[aria-label="关闭 扩展页面"]')!.click();
  expect(fixture.store.close).toHaveBeenCalledWith('view:sample');
});

it('marks an incoming tab position with a line without reserving space and answers a cross-window drop probe', async () => {
  app.unmount();
  app = createApp(DesktopTabs, { detachable: true });
  app.mount(root.querySelector('.desktop-window-tab-slot')!);
  const list = root.querySelector<HTMLElement>('.desktop-tab-list')!;
  list.getBoundingClientRect = () => ({ left: 0, right: 600, top: 0, bottom: 36 }) as DOMRect;
  root.querySelectorAll<HTMLElement>('.desktop-tab').forEach((tab, index) => {
    tab.getBoundingClientRect = () => ({
      left: index * 200, right: (index + 1) * 200, top: 0, bottom: 36,
      width: 200, height: 36,
    }) as DOMRect;
  });
  const type = tabDragMetaType({
    sourceLabel: 'detached-source', workspaceId: 'workspace-1', tabId: 'incoming',
    width: 180, centerOffset: 0,
  });
  const over = new MouseEvent('dragover', { bubbles: true, cancelable: true, clientX: 250, clientY: 18 });
  Object.defineProperty(over, 'dataTransfer', { value: { types: [type], dropEffect: '' } });
  list.dispatchEvent(over);
  await nextTick();
  expect(over.defaultPrevented).toBe(true);
  expect(list.querySelector('.desktop-tab-incoming-slot')).toBeNull();
  expect(list.querySelectorAll('.desktop-tab')).toHaveLength(3);
  expect(list.querySelector('.desktop-tab-dock-before')?.getAttribute('data-id')).toBe('b');
  expect(root.querySelector<HTMLElement>('.desktop-tab-strip')?.style.getPropertyValue('--desktop-tab-count')).toBe('3');
  await vi.waitFor(() => expect(nativeEvents.listeners.get(TAB_DOCK_PROBE)?.size).toBe(1));
  for (const handler of nativeEvents.listeners.get(TAB_DOCK_PROBE) ?? []) handler({ payload: {
    requestId: 'probe-1', sourceLabel: 'detached-source', workspaceId: 'workspace-1',
    tabId: 'incoming', x: 250, y: 18, centerOffset: 0,
  } });
  await vi.waitFor(() => expect(nativeEvents.emitTo).toHaveBeenCalledWith('detached-source',
    'tano-tab-dock-reply', expect.objectContaining({ requestId: 'probe-1', targetLabel: 'main', index: 1 })));
  for (const handler of nativeEvents.listeners.get(TAB_DOCK_PROBE) ?? []) handler({ payload: {
    requestId: 'probe-near-top', sourceLabel: 'detached-source', workspaceId: 'workspace-1',
    tabId: 'incoming', x: 250, y: -10, centerOffset: 0,
  } });
  await vi.waitFor(() => expect(nativeEvents.emitTo).toHaveBeenCalledWith('detached-source',
    'tano-tab-dock-reply', expect.objectContaining({ requestId: 'probe-near-top', insideWindow: false, index: 1 })));
  window.dispatchEvent(new CustomEvent('tano-tab-transfer-settled', {
    detail: { sourceLabel: 'detached-source', tabId: 'incoming' },
  }));
  await nextTick();
  expect(list.querySelector('.desktop-tab-dock-before, .desktop-tab-dock-after')).toBeNull();

  const after = new MouseEvent('dragover', { bubbles: true, cancelable: true, clientX: 550, clientY: 18 });
  Object.defineProperty(after, 'dataTransfer', { value: { types: [type], dropEffect: '' } });
  list.dispatchEvent(after);
  await nextTick();
  expect(list.querySelector('.desktop-tab-dock-after')?.getAttribute('data-id')).toBe('c');
  fixture.store.tabs.splice(0);
  await nextTick();
  const empty = new MouseEvent('dragover', { bubbles: true, cancelable: true, clientX: 20, clientY: 18 });
  Object.defineProperty(empty, 'dataTransfer', { value: { types: [type], dropEffect: '' } });
  list.dispatchEvent(empty);
  await nextTick();
  expect(list.querySelector('.desktop-tab-dock-empty')).not.toBeNull();
});

afterEach(() => {
  app.unmount();
  root.remove();
  document.body.querySelectorAll('.desktop-tab-native-drag-image').forEach((image) => image.remove());
  vi.unstubAllGlobals();
  delete (document as Partial<Document>).elementFromPoint;
});

it('previews foreign tabs in the hovered pane only and retains the released destination while saving', async () => {
  app.unmount();
  fixture.store.panes = [
    { id: 'left', tabs: ['a', 'b'], activeId: 'a' },
    { id: 'right', tabs: ['c'], activeId: 'c' },
  ];
  fixture.store.focusPane = vi.fn();
  app = createApp({ render: () => h('div', fixture.store.panes.map((pane: { id: string }) =>
    h('section', { class: 'workspace-pane', 'data-pane-id': pane.id }, [h(DesktopTabs, { paneId: pane.id, detachable: true })]))) });
  app.mount(root.querySelector('.desktop-window-tab-slot')!);
  const left = root.querySelector<HTMLElement>('[data-pane-id="left"]')!;
  const right = root.querySelector<HTMLElement>('[data-pane-id="right"]')!;
  for (const [i, pane] of [left, right].entries()) pane.getBoundingClientRect = () =>
    ({ left: i * 500, top: 0, right: (i + 1) * 500, bottom: 600, width: 500, height: 600 }) as DOMRect;
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: (x: number, y: number) => {
    const pane = x < 500 ? left : right;
    return y < 36 ? pane.querySelector('.desktop-tab-strip') : pane;
  } });
  const meta = { sourceLabel: 'other-window', workspaceId: 'workspace-1', tabId: 'foreign', width: 200, centerOffset: 0 };
  const drag = (type: string, x: number, y: number, workspaceId = meta.workspaceId) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
    Object.defineProperty(event, 'dataTransfer', { value: { types: [tabDragMetaType({ ...meta, workspaceId })], dropEffect: '' } });
    window.dispatchEvent(event);
    return event;
  };
  await vi.waitFor(() => expect(nativeEvents.listeners.get(TAB_DOCK_PROBE)?.size).toBe(2));
  expect(drag('dragover', 490, 300).defaultPrevented).toBe(true);
  expect(fixture.store.paneDrop).toEqual({ paneId: 'left', side: 'right' });
  drag('dragover', 980, 300);
  expect(fixture.store.paneDrop).toEqual({ paneId: 'right', side: 'right' });
  drag('dragover', 750, 300);
  expect(fixture.store.paneDrop).toBeUndefined();
  drag('dragover', 980, 300, 'different-workspace');
  expect(fixture.store.paneDrop).toBeUndefined();
  drag('dragover', 750, 590);
  expect(fixture.store.paneDrop).toEqual({ paneId: 'right', side: 'bottom' });
  drag('drop', 750, 590);
  const date = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1200);
  for (const handler of nativeEvents.listeners.get(TAB_DOCK_PROBE) ?? []) handler({ payload: {
    ...meta, requestId: 'nested', x: 750, y: 300,
  } });
  await vi.waitFor(() => expect(nativeEvents.emitTo).toHaveBeenCalledWith('other-window', 'tano-tab-dock-reply',
    expect.objectContaining({ requestId: 'nested', hovered: true, index: 3, drop: { paneId: 'right', side: 'bottom' } })));
  date.mockRestore();
  for (const handler of nativeEvents.listeners.get(TAB_DRAG_FINISHED) ?? []) handler({ payload: meta });
  expect(fixture.store.paneDrop).toBeUndefined();
  drag('dragover', 750, 18);
  expect(fixture.store.paneDrop).toEqual({ paneId: 'right', side: 'center', index: 1 });
  drag('dragleave', -1, -1);
  await vi.waitFor(() => expect(fixture.store.paneDrop).toBeUndefined());
});

function mountFileDrag(detachable = false) {
  app.unmount();
  fixture.store.workspace.files = [
    { id: 'file-1', path: '项目/拖入文档.md', kind: 'file' },
    { id: 'folder', path: '项目', kind: 'directory' },
    { id: 'image', path: 'image.png', kind: 'file' },
  ];
  fixture.store.openFilesInNewTabsAt = vi.fn(async () => {});
  const state = reactive({ fileDrag: { workspaceId: 'workspace-1', ids: ['file-1'] } });
  const dropped = vi.fn();
  app = createApp({ render: () => h(DesktopTabs, { detachable, fileDrag: state.fileDrag, onFilesDropped: dropped }) });
  app.mount(root.querySelector('.desktop-window-tab-slot')!);
  const list = root.querySelector<HTMLElement>('.desktop-tab-list')!;
  list.getBoundingClientRect = () => ({ left: 0, right: 600, top: 0, bottom: 36 }) as DOMRect;
  root.querySelectorAll<HTMLElement>('.desktop-tab').forEach((tab, index) => {
    tab.getBoundingClientRect = () => ({ left: index * 200, right: (index + 1) * 200, width: 200 }) as DOMRect;
  });
  return { state, dropped, list };
}

function fileDragEvent(target: Element | Window, type: string, x = 250, types = ['application/x-tano-entry'], relatedTarget?: Element) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 18, relatedTarget });
  const dataTransfer = { types, dropEffect: '' };
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  target.dispatchEvent(event);
  return { event, dataTransfer };
}

it.each([false, true])('accepts file-tree drops between tabs (native=%s)', async (native) => {
  const { dropped, list } = mountFileDrag(native);
  const { event, dataTransfer } = fileDragEvent(list, 'dragover');
  await nextTick();
  expect(event.defaultPrevented).toBe(true);
  expect(dataTransfer.dropEffect).toBe('copy');
  expect(list.querySelector('.desktop-tab-dock-before')?.getAttribute('data-id')).toBe('b');
  expect(document.querySelector('.desktop-tab-file-drop-hint')?.textContent).toContain('拖入文档');
  expect(list.querySelectorAll('.desktop-tab')).toHaveLength(3);
  expect(fixture.store.openFilesInNewTabsAt).not.toHaveBeenCalled();
  fileDragEvent(list, 'drop');
  await nextTick();
  expect(fixture.store.openFilesInNewTabsAt).toHaveBeenCalledExactlyOnceWith(['file-1'], 1, 'workspace-1');
  expect(dropped).toHaveBeenCalledOnce();
  expect(document.querySelector('.desktop-tab-file-drop-hint')).toBeNull();
  expect(list.querySelector('.desktop-tab-dock-before')).toBeNull();
});

it('accepts the first slot, add button, blank titlebar and empty strip', async () => {
  const { list } = mountFileDrag();
  fileDragEvent(list, 'drop', 20);
  expect(fixture.store.openFilesInNewTabsAt).toHaveBeenLastCalledWith(['file-1'], 0, 'workspace-1');
  fileDragEvent(root.querySelector('.desktop-tab-add')!, 'drop', 610);
  expect(fixture.store.openFilesInNewTabsAt).toHaveBeenLastCalledWith(['file-1'], 3, 'workspace-1');
  const blank = root.querySelector('.desktop-window-drag')!;
  fileDragEvent(blank, 'dragover', 750);
  await nextTick();
  expect(list.querySelector('.desktop-tab-dock-after')?.getAttribute('data-id')).toBe('c');
  fileDragEvent(blank, 'drop', 750);
  expect(fixture.store.openFilesInNewTabsAt).toHaveBeenLastCalledWith(['file-1'], 3, 'workspace-1');
  fixture.store.tabs = [];
  await nextTick();
  fileDragEvent(root.querySelector('.desktop-tab-add')!, 'dragover', 10);
  await nextTick();
  expect(list.querySelector('.desktop-tab-dock-empty')).not.toBeNull();
  fileDragEvent(root.querySelector('.desktop-tab-add')!, 'drop', 10);
  expect(fixture.store.openFilesInNewTabsAt).toHaveBeenLastCalledWith(['file-1'], 0, 'workspace-1');
});

it('clears the file insertion hint on leave, escape, dragend and workspace changes', async () => {
  const { state, list } = mountFileDrag();
  for (const cancel of [
    () => fileDragEvent(list, 'dragleave'),
    () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })),
    () => fileDragEvent(window, 'dragend'),
    () => { state.fileDrag.workspaceId = 'other'; },
  ]) {
    fileDragEvent(list, 'dragover');
    await nextTick();
    expect(document.querySelector('.desktop-tab-file-drop-hint')).not.toBeNull();
    cancel();
    await nextTick();
    expect(document.querySelector('.desktop-tab-file-drop-hint')).toBeNull();
  }
  expect(fixture.store.openFilesInNewTabsAt).not.toHaveBeenCalled();
});

it('scrolls at the strip edge and appends from the add button even when tabs overflow', async () => {
  const { list } = mountFileDrag();
  list.getBoundingClientRect = () => ({ left: 0, right: 320, top: 0, bottom: 36 }) as DOMRect;
  fileDragEvent(list, 'dragover', 315);
  const frame = vi.mocked(requestAnimationFrame).mock.calls.at(-1)![0];
  frame(0);
  expect(list.scrollLeft).toBe(10);
  fileDragEvent(root.querySelector('.desktop-tab-add')!, 'drop', 340);
  expect(fixture.store.openFilesInNewTabsAt).toHaveBeenCalledExactlyOnceWith(['file-1'], 3, 'workspace-1');
});

it('keeps the slot across tab child transitions and ignores invalid drops', async () => {
  const { state, list } = mountFileDrag();
  fileDragEvent(list, 'dragover');
  fileDragEvent(list, 'dragleave', 250, undefined, list.querySelector('.desktop-tab-switch')!);
  await nextTick();
  expect(list.querySelector('.desktop-tab-dock-before')).not.toBeNull();
  for (const ids of [['folder'], ['image'], ['file-1', 'folder'], ['missing'], []]) {
    state.fileDrag.ids = ids;
    await nextTick();
    expect(fileDragEvent(list, 'dragover').event.defaultPrevented).toBe(false);
    fileDragEvent(list, 'drop');
  }
  state.fileDrag.ids = ['file-1'];
  await nextTick();
  fileDragEvent(list, 'drop', 250, ['Files']);
  fileDragEvent(document.body, 'drop');
  expect(fixture.store.openFilesInNewTabsAt).not.toHaveBeenCalled();
});

it('shows the insertion side and commits only on release, suppressing the trailing click', async () => {
  pointer(buttons[0], 'pointerdown', 80);
  pointer(buttons[0], 'pointermove', 570);
  await nextTick();
  expect(root.querySelector('.desktop-tab-drop-after')?.getAttribute('data-id')).toBe('c');
  expect(fixture.store.moveDocument).not.toHaveBeenCalled();
  pointer(buttons[0], 'pointerup', 570);
  buttons[0].click();
  expect(fixture.store.moveDocument).toHaveBeenCalledExactlyOnceWith('a', 'c', 'after');
  expect(fixture.store.activeId).toBe('b');
  await nextTick();
  expect(root.querySelector('.desktop-tab-dragging')).toBeNull();
});

it.each([390, 410])('shows one pane insertion marker on either side of the same boundary at x=%s', async x => {
  app.unmount();
  fixture.store.panes = [{ id: 'pane', tabs: ['a', 'b', 'c'], activeId: 'b' }];
  fixture.store.focusPane = vi.fn();
  fixture.store.dockTab = vi.fn();
  app = createApp(DesktopTabs, { paneId: 'pane' });
  app.mount(root.querySelector('.desktop-window-tab-slot')!);
  const list = root.querySelector<HTMLElement>('.desktop-tab-list')!;
  list.getBoundingClientRect = () => ({ left: 0, right: 600, top: 0, bottom: 36 }) as DOMRect;
  root.querySelectorAll<HTMLElement>('.desktop-tab').forEach((tab, index) => {
    tab.getBoundingClientRect = () => ({ left: index * 200, right: (index + 1) * 200, top: 0, bottom: 36, width: 200, height: 36 }) as DOMRect;
  });
  const button = root.querySelector<HTMLButtonElement>('.desktop-tab-switch')!;
  button.setPointerCapture = vi.fn();
  button.hasPointerCapture = () => true;
  button.releasePointerCapture = vi.fn();
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => list) });
  try {
    pointer(button, 'pointerdown', 80);
    pointer(button, 'pointermove', x);
    await nextTick();
    const markers = root.querySelectorAll('.desktop-tab-drop-before, .desktop-tab-drop-after, .desktop-tab-dock-before, .desktop-tab-dock-after');
    expect(markers).toHaveLength(1);
    expect(markers[0]?.getAttribute('data-id')).toBe('c');
    expect(root.querySelector('.desktop-tab-drop-before, .desktop-tab-drop-after')).toBeNull();
    pointer(button, 'pointerup', x);
    expect(fixture.store.dockTab).toHaveBeenCalledExactlyOnceWith('a', { paneId: 'pane', side: 'center', index: 2 });
    expect(fixture.store.moveDocument).not.toHaveBeenCalled();
  } finally {
    delete (document as Partial<Document>).elementFromPoint;
  }
});

it('shows the dragged tab under the pointer, including outside the strip, and removes it on cancel', async () => {
  pointer(buttons[0], 'pointerdown', 80);
  pointer(buttons[0], 'pointermove', 82);
  await nextTick();
  expect(document.body.querySelector('.desktop-tab-drag-preview')).toBeNull();

  pointer(buttons[0], 'pointermove', 260, 20);
  await nextTick();
  const preview = document.body.querySelector<HTMLElement>('.desktop-tab-drag-preview')!;
  expect(preview.textContent).toContain('a');
  expect(preview.style.left).toBe('180px');
  expect(preview.style.top).toBe('2px');
  expect(preview.style.width).toBe('200px');

  pointer(buttons[0], 'pointermove', 300, 80);
  await nextTick();
  expect(preview.style.left).toBe('220px');
  expect(preview.style.top).toBe('62px');
  expect(root.querySelector('.desktop-tab-drop-before, .desktop-tab-drop-after')).toBeNull();

  pointer(buttons[0], 'pointercancel', 300, 80);
  await nextTick();
  expect(document.body.querySelector('.desktop-tab-drag-preview')).toBeNull();
  expect(fixture.store.moveDocument).not.toHaveBeenCalled();
});

it('supports dragging to the start and ignores small pointer movements', () => {
  pointer(buttons[2], 'pointerdown', 460);
  pointer(buttons[2], 'pointermove', 20);
  pointer(buttons[2], 'pointerup', 20);
  expect(fixture.store.moveDocument).toHaveBeenCalledWith('c', 'a', 'before');
  fixture.store.moveDocument.mockClear();
  pointer(buttons[1], 'pointerdown', 280);
  pointer(buttons[1], 'pointermove', 282);
  pointer(buttons[1], 'pointerup', 282);
  expect(fixture.store.moveDocument).not.toHaveBeenCalled();
});

it.each(['escape', 'pointercancel', 'lostpointercapture', 'outside'])(
  'cancels a drag on %s without reordering',
  async (reason) => {
    pointer(buttons[0], 'pointerdown', 80);
    pointer(buttons[0], 'pointermove', 570);
    if (reason === 'escape') {
      buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    } else if (reason !== 'outside') {
      pointer(buttons[0], reason, 570);
    }
    pointer(buttons[0], 'pointerup', 570, reason === 'outside' ? 80 : 18);
    await nextTick();
    expect(fixture.store.moveDocument).not.toHaveBeenCalled();
    expect(root.querySelector('.desktop-tab-list-dragging')).toBeNull();
  },
);

it('scrolls overflow tabs when the pointer stays near the edge and stops on cancellation', () => {
  pointer(buttons[0], 'pointerdown', 80);
  pointer(buttons[0], 'pointermove', 590);
  const frame = vi.mocked(requestAnimationFrame).mock.calls[0][0];
  frame(0);
  expect(root.querySelector('.desktop-tab-list')!.scrollLeft).toBe(10);
  pointer(buttons[0], 'pointercancel', 590);
  expect(cancelAnimationFrame).toHaveBeenCalled();
});

it('uses a native drag image and reorders a tab at the release point', async () => {
  const onDetachTab = vi.fn();
  app.unmount();
  app = createApp(DesktopTabs, { detachable: true, onDetachTab });
  app.mount(root.querySelector('.desktop-window-tab-slot')!);
  const list = root.querySelector<HTMLElement>('.desktop-tab-list')!;
  list.getBoundingClientRect = () => ({ left: 0, right: 600, top: 0, bottom: 36 }) as DOMRect;
  root.querySelectorAll<HTMLElement>('.desktop-tab').forEach((tab, index) => {
    tab.getBoundingClientRect = () => ({
      left: index * 200, right: (index + 1) * 200, top: 0, bottom: 36,
      width: 200, height: 36,
    }) as DOMRect;
  });
  const button = root.querySelector<HTMLButtonElement>('.desktop-tab-switch')!;
  expect(button.draggable).toBe(true);
  const transfer = {
    effectAllowed: '', dropEffect: '', setData: vi.fn(), setDragImage: vi.fn(),
  };
  const start = new MouseEvent('dragstart', { bubbles: true, cancelable: true, clientX: 80, clientY: 18 });
  Object.defineProperty(start, 'dataTransfer', { value: transfer });
  button.dispatchEvent(start);
  expect(start.defaultPrevented).toBe(false);
  expect(transfer.setData).toHaveBeenCalledWith('application/x-tano-tab', 'a');
  expect(transfer.setDragImage).toHaveBeenCalledWith(expect.any(HTMLElement), 80, 18);
  expect(nativeCore.invoke).toHaveBeenCalledWith('tab_drag_release');
  expect(document.body.querySelector('.desktop-tab-drag-preview')).toBeNull();
  pointer(button, 'pointercancel', 80);
  pointer(button, 'lostpointercapture', 80);
  await nextTick();
  expect(root.querySelector('.desktop-tab-list-dragging')).not.toBeNull();
  nativeWindow.cursorPosition.mockResolvedValueOnce({ x: 440, y: 18 });
  window.dispatchEvent(new MouseEvent('dragend', { bubbles: true }));
  await vi.waitFor(() => expect(fixture.store.moveDocument).toHaveBeenCalledWith('a', 'c', 'before'));
  expect(fixture.store.moveDocument).toHaveBeenCalledWith('a', 'c', 'before');
  expect(onDetachTab).not.toHaveBeenCalled();

  fixture.store.moveDocument.mockClear();
  const second = new MouseEvent('dragstart', { bubbles: true, cancelable: true, clientX: 80, clientY: 18 });
  Object.defineProperty(second, 'dataTransfer', { value: transfer });
  nativeCore.invoke.mockResolvedValueOnce({ x: 300, y: -2 });
  button.dispatchEvent(second);
  pointer(button, 'pointercancel', 80);
  await nextTick();
  expect(root.querySelector('.desktop-tab-list-dragging')).not.toBeNull();
  // The source strip extends above y=0; a system point above the window still detaches.
  await vi.waitFor(() => expect(onDetachTab).toHaveBeenCalledWith('a', {
    x: 300, y: -2, grabX: 80, grabY: 18, width: 200, insideSourceWindow: false,
  }, expect.any(Function)));
  expect(root.querySelector('.desktop-tab-outgoing')).not.toBeNull();
  onDetachTab.mock.calls[0][2]();
  await nextTick();
  expect(root.querySelector('.desktop-tab-outgoing')).toBeNull();
  expect(fixture.store.moveDocument).not.toHaveBeenCalled();
});

it('reserves a default width for each open tab', async () => {
  const strip = root.querySelector<HTMLElement>('.desktop-tab-strip')!;
  expect(strip.style.getPropertyValue('--desktop-tab-count')).toBe('3');
  fixture.store.tabs.push({
    id: 'd',
    path: 'd.md',
    blank: false,
    document: { id: 'd', path: 'd.md' },
  });
  await nextTick();
  expect(strip.style.getPropertyValue('--desktop-tab-count')).toBe('4');
});

it('renders and closes an empty tab without treating it as a document', async () => {
  fixture.store.tabs.push({ id: 'blank:test', path: '', blank: true });
  await nextTick();
  const tab = root.querySelector<HTMLElement>('[data-id="blank:test"]')!;
  tab.scrollIntoView = vi.fn();
  expect(tab.textContent).toContain('新标签页');
  expect(tab.querySelector('.desktop-tab-icon')).toBeNull();
  // Vue ignores synthetic events stamped in the same tick as a new listener.
  await new Promise(resolve => setTimeout(resolve, 1));
  tab.querySelector<HTMLButtonElement>('.desktop-tab-switch')!.click();
  expect(fixture.store.activeId).toBe('blank:test');
  tab.querySelector<HTMLButtonElement>('.desktop-tab-close')!.click();
  expect(fixture.store.close).toHaveBeenCalledWith('blank:test');
});

it('uses the wheel to scroll only when tabs overflow', () => {
  const strip = root.querySelector<HTMLElement>('.desktop-tab-strip')!;
  const list = root.querySelector<HTMLElement>('.desktop-tab-list')!;
  let scrollWidth = 300;
  let scrollLeft = 0;
  Object.defineProperties(list, {
    clientWidth: { get: () => 300 },
    scrollWidth: { get: () => scrollWidth },
    scrollLeft: {
      get: () => scrollLeft,
      set: (value: number) => {
        scrollLeft = Math.max(0, Math.min(value, scrollWidth - 300));
      },
    },
  });

  const noOverflow = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 80 });
  strip.dispatchEvent(noOverflow);
  expect(scrollLeft).toBe(0);
  expect(noOverflow.defaultPrevented).toBe(false);

  scrollWidth = 480;
  const forward = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 80 });
  strip.dispatchEvent(forward);
  expect(scrollLeft).toBe(80);
  expect(forward.defaultPrevented).toBe(true);

  const backward = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -40 });
  strip.dispatchEvent(backward);
  expect(scrollLeft).toBe(40);
  expect(backward.defaultPrevented).toBe(true);
});

it('opens tab actions by mouse or keyboard and closes other tabs in order', async () => {
  fixture.store.close = vi.fn(async (id: string) => {
    fixture.store.tabs = fixture.store.tabs.filter((tab: { id: string }) => tab.id !== id);
  });
  const tab = root.querySelector<HTMLElement>('[data-id="b"]')!;
  const rightClick = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: 245,
    clientY: 20,
  });
  tab.dispatchEvent(rightClick);
  await nextTick();
  expect(rightClick.defaultPrevented).toBe(true);
  const menu = document.body.querySelector<HTMLElement>('.desktop-tab-context-menu')!;
  expect(menu.getAttribute('aria-label')).toBe('标签页操作');
  expect(menu.textContent).toContain('关闭其他标签页');
  [...menu.querySelectorAll('button')]
    .find((button) => button.textContent?.includes('关闭其他标签页'))!
    .click();
  await vi.waitFor(() => expect(fixture.store.close).toHaveBeenCalledTimes(2));
  expect(vi.mocked(fixture.store.close).mock.calls.map((call: [string]) => call[0])).toEqual([
    'a',
    'c',
  ]);
  expect(fixture.store.activeId).toBe('b');

  buttons[1].dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true, cancelable: true }),
  );
  await nextTick();
  expect(document.body.querySelector('.desktop-tab-context-menu')?.textContent).toContain(
    '关闭标签页',
  );
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
  await nextTick();
  expect(document.body.querySelector('.desktop-tab-context-menu')).toBeNull();
});

it('opens blank-track actions without starting window drag', async () => {
  const newTab = vi.fn();
  const newDocument = vi.fn();
  app.unmount();
  app = createApp(DesktopTabs, { onNewTab: newTab, onNewDocument: newDocument });
  app.mount(root.querySelector('.desktop-window-tab-slot')!);
  const track = root.querySelector<HTMLElement>('.desktop-window-drag')!;
  const rightClick = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: 640,
    clientY: 20,
  });
  track.dispatchEvent(rightClick);
  await nextTick();
  expect(rightClick.defaultPrevented).toBe(true);
  const menu = document.body.querySelector<HTMLElement>('.desktop-tab-context-menu')!;
  expect(menu.getAttribute('aria-label')).toBe('标签栏操作');
  [...menu.querySelectorAll('button')]
    .find((button) => button.textContent?.includes('新建文档'))!
    .click();
  expect(newDocument).toHaveBeenCalledOnce();
  expect(newTab).not.toHaveBeenCalled();

  track.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  await nextTick();
  [...document.body.querySelectorAll<HTMLButtonElement>('.desktop-tab-context-menu button')]
    .find((button) => button.textContent?.includes('新建标签页'))!
    .click();
  expect(newTab).toHaveBeenCalledOnce();
});

it('opens devtools from the blank track without changing tabs and dismisses the menu', async () => {
  root.querySelector<HTMLElement>('.desktop-window-drag')!
    .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  await nextTick();
  const menu = document.body.querySelector<HTMLElement>('.desktop-tab-context-menu')!;
  [...menu.querySelectorAll('button')].find(button => button.textContent?.includes('打开调试窗口'))!.click();
  expect(nativeCore.invoke).toHaveBeenCalledExactlyOnceWith('open_devtools');
  await nextTick();
  expect(document.body.querySelector('.desktop-tab-context-menu')).toBeNull();
  expect(fixture.store.tabs.map((tab: { id: string }) => tab.id)).toEqual(['a', 'b', 'c']);
  expect(fixture.store.activeId).toBe('b');
  expect(fixture.store.close).not.toHaveBeenCalled();
});

it('reports a devtools invocation failure', async () => {
  nativeCore.invoke.mockRejectedValueOnce(new Error('调试窗口无法打开'));
  root.querySelector<HTMLElement>('.desktop-window-drag')!
    .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  await nextTick();
  [...document.body.querySelectorAll<HTMLButtonElement>('.desktop-tab-context-menu button')]
    .find(button => button.textContent?.includes('打开调试窗口'))!.click();
  await vi.waitFor(() => expect(fixture.store.report).toHaveBeenCalledWith(new Error('调试窗口无法打开')));
});

it.each([
  { nativeOs: '', mobile: false },
  { nativeOs: 'android', mobile: true },
  { nativeOs: 'ios', mobile: true },
])('hides devtools outside desktop ($nativeOs)', async values => {
  Object.assign(platform, values);
  root.querySelector<HTMLElement>('.desktop-window-drag')!
    .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  await nextTick();
  const menu = document.body.querySelector<HTMLElement>('.desktop-tab-context-menu')!;
  expect(menu.textContent).toContain('新建标签页');
  expect(menu.textContent).not.toContain('打开调试窗口');
  expect(nativeCore.invoke).not.toHaveBeenCalled();
});

it('keeps devtools out of individual tab menus', async () => {
  root.querySelector<HTMLElement>('[data-id="a"]')!
    .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  await nextTick();
  const menu = document.body.querySelector<HTMLElement>('.desktop-tab-context-menu')!;
  expect(menu.textContent).toContain('关闭标签页');
  expect(menu.textContent).not.toContain('打开调试窗口');
});

it('closes only tabs to the right of the clicked tab', async () => {
  fixture.store.close = vi.fn(async (id: string) => {
    fixture.store.tabs = fixture.store.tabs.filter((tab: { id: string }) => tab.id !== id);
  });
  root
    .querySelector<HTMLElement>('[data-id="a"]')!
    .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  await nextTick();
  [...document.body.querySelectorAll<HTMLButtonElement>('.desktop-tab-context-menu button')]
    .find((button) => button.textContent?.includes('关闭右侧标签页'))!
    .click();
  await vi.waitFor(() => expect(fixture.store.close).toHaveBeenCalledTimes(2));
  expect(vi.mocked(fixture.store.close).mock.calls.map((call: [string]) => call[0])).toEqual([
    'b',
    'c',
  ]);
});

it('stops closing tabs when one tab remains open', async () => {
  fixture.store.close = vi.fn(async () => {});
  root
    .querySelector<HTMLElement>('.desktop-window-drag')!
    .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  await nextTick();
  [...document.body.querySelectorAll<HTMLButtonElement>('.desktop-tab-context-menu button')]
    .find((button) => button.textContent?.includes('关闭全部标签页'))!
    .click();
  await vi.waitFor(() => expect(fixture.store.close).toHaveBeenCalledOnce());
  expect(fixture.store.close).toHaveBeenCalledWith('a');
});

it.each([false, true])('previews a pane edge and docks on release without detaching (native=%s)', async native => {
  app.unmount();
  fixture.store.panes = [{ id: 'pane', tabs: ['a', 'b', 'c'], activeId: 'b' }];
  fixture.store.focusPane = vi.fn();
  fixture.store.dockTab = vi.fn();
  const onDetachTab = vi.fn();
  app = createApp(DesktopTabs, { paneId: 'pane', detachable: native, onDetachTab });
  app.mount(root.querySelector('.desktop-window-tab-slot')!);
  const pane = document.createElement('section');
  pane.className = 'workspace-pane';
  pane.dataset.paneId = 'pane';
  root.append(pane);
  pane.getBoundingClientRect = () => ({ left: 0, top: 36, width: 600, height: 500, right: 600, bottom: 536 }) as DOMRect;
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => pane) });
  const button = root.querySelector<HTMLButtonElement>('.desktop-tab-switch')!;
  const tab = button.closest<HTMLElement>('.desktop-tab')!;
  tab.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 36, right: 200, bottom: 36 }) as DOMRect;
  button.setPointerCapture = vi.fn();
  button.hasPointerCapture = () => true;
  button.releasePointerCapture = vi.fn();
  if (native) {
    const start = new MouseEvent('dragstart', { bubbles: true, cancelable: true, clientX: 80, clientY: 18 });
    Object.defineProperty(start, 'dataTransfer', { value: { setData: vi.fn(), setDragImage: vi.fn() } });
    button.dispatchEvent(start);
    window.dispatchEvent(new MouseEvent('dragover', { bubbles: true, cancelable: true, clientX: 590, clientY: 250 }));
  } else {
    pointer(button, 'pointerdown', 80);
    pointer(button, 'pointermove', 590, 250);
  }
  expect(fixture.store.paneDrop).toEqual({ paneId: 'pane', side: 'right' });
  expect(fixture.store.dockTab).not.toHaveBeenCalled();
  if (native) {
    window.dispatchEvent(new MouseEvent('dragleave', { bubbles: true, clientX: -1, clientY: 250 }));
    expect(fixture.store.paneDrop).toBeUndefined();
    window.dispatchEvent(new MouseEvent('dragover', { bubbles: true, cancelable: true, clientX: 590, clientY: 250 }));
    expect(fixture.store.paneDrop).toEqual({ paneId: 'pane', side: 'right' });
    nativeWindow.cursorPosition.mockResolvedValueOnce({ x: 590, y: 250 });
    window.dispatchEvent(new MouseEvent('dragend', { bubbles: true }));
    await vi.waitFor(() => expect(fixture.store.dockTab).toHaveBeenCalledOnce());
  } else pointer(button, 'pointerup', 590, 250);
  expect(fixture.store.dockTab).toHaveBeenCalledExactlyOnceWith('a', { paneId: 'pane', side: 'right' });
  expect(fixture.store.paneDrop).toBeUndefined();
  expect(onDetachTab).not.toHaveBeenCalled();
  if (native) {
    // The foreground destination can overlap the source's docking edge. After
    // leaving the native WebView, do not commit a hit in the background source.
    fixture.store.dockTab.mockClear();
    const start = new MouseEvent('dragstart', { bubbles: true, cancelable: true, clientX: 80, clientY: 18 });
    Object.defineProperty(start, 'dataTransfer', { value: { setData: vi.fn(), setDragImage: vi.fn() } });
    button.dispatchEvent(start);
    window.dispatchEvent(new MouseEvent('dragleave', { bubbles: true, clientX: 590, clientY: 250 }));
    nativeWindow.cursorPosition.mockResolvedValueOnce({ x: 590, y: 250 });
    window.dispatchEvent(new MouseEvent('dragend', { bubbles: true }));
    await vi.waitFor(() => expect(onDetachTab).toHaveBeenCalledOnce());
    expect(fixture.store.dockTab).not.toHaveBeenCalled();
    expect(onDetachTab.mock.calls[0].slice(0, 2)).toEqual(['a', expect.objectContaining({ x: 590, y: 250, insideSourceWindow: true })]);
    onDetachTab.mock.calls[0][2]();
  }
  delete (document as Partial<Document>).elementFromPoint;
});
