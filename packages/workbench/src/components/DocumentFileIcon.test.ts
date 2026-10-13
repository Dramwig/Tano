// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive } from 'vue';
import type { App } from 'vue';
import type { FileEntry } from '@tano/protocol';
import DocumentFileIcon from './DocumentFileIcon.vue';

let app: App;
let root: HTMLDivElement;
afterEach(() => { app?.unmount(); root?.remove(); vi.unstubAllGlobals(); });
async function mount(load = vi.fn(async (_file: FileEntry, _signal: AbortSignal) => '🌿')) {
  let intersect!: (entries: { isIntersecting: boolean }[]) => void;
  const disconnect = vi.fn();
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: typeof intersect) { intersect = callback; }
    observe() {}
    disconnect = disconnect;
  });
  const state = reactive({
    file: { id: 'note', name: '笔记.md', path: '笔记.md', kind: 'file', size: 30, modified: 1 } as FileEntry,
    icon: undefined as string | undefined,
  });
  root = document.createElement('div'); document.body.append(root);
  app = createApp({ render: () => h(DocumentFileIcon, { ...state, load }) });
  app.mount(root); await nextTick();
  async function visible(value = true) { intersect([{ isIntersecting: value }]); await nextTick(); }
  return { state, load, visible, disconnect };
}

it('loads unopened documents only when visible and does not reread an unchanged file listing', async () => {
  const { state, load, visible } = await mount();
  expect(load).not.toHaveBeenCalled();
  expect(root.querySelector('[class*="lucide-file-text"]')).not.toBeNull();
  await visible();
  await vi.waitFor(() => expect(root.querySelector('.workspace-emoji-icon')?.getAttribute('data-emoji')).toBe('🌿'));
  state.file = { ...state.file }; await nextTick();
  expect(load).toHaveBeenCalledOnce();
  load.mockResolvedValue('icon:book'); state.file.modified++;
  await vi.waitFor(() => expect(root.querySelector('[class*="lucide-book"]')).not.toBeNull());
  expect(load).toHaveBeenCalledTimes(2);
});

it('prefers live drafts including icon removal, then reloads the saved icon after closing the document', async () => {
  let resolve!: (value: string) => void;
  const load = vi.fn((_file: FileEntry, _signal: AbortSignal) => new Promise<string>(done => { resolve = done; }));
  const { state, visible } = await mount(load);
  await visible();
  state.icon = '🚀'; await nextTick();
  resolve('🌿'); await nextTick();
  expect(root.querySelector('.workspace-emoji-icon')?.getAttribute('data-emoji')).toBe('🚀');
  state.icon = ''; await nextTick();
  expect(root.querySelector('[class*="lucide-file-text"]')).not.toBeNull();
  state.icon = undefined; await nextTick();
  expect(load).toHaveBeenCalledTimes(2);
  resolve('icon:book');
  await vi.waitFor(() => expect(root.querySelector('[class*="lucide-book"]')).not.toBeNull());
});

it('discards outdated reads after moving a file, leaving the viewport, and unmounting', async () => {
  const pending: { signal: AbortSignal; resolve: (value: string) => void }[] = [];
  const load = vi.fn((_file: FileEntry, signal: AbortSignal) => new Promise<string>(resolve => pending.push({ signal, resolve })));
  const { state, visible, disconnect } = await mount(load);
  await visible();
  state.file.path = '归档/笔记.md'; await nextTick();
  expect(pending[0]!.signal.aborted).toBe(true);
  pending[1]!.resolve('🌿'); await nextTick(); await nextTick();
  pending[0]!.resolve('🚀'); await nextTick(); await nextTick();
  expect(root.querySelector('.workspace-emoji-icon')?.getAttribute('data-emoji')).toBe('🌿');
  state.file.modified++; await nextTick();
  await visible(false);
  expect(pending[2]!.signal.aborted).toBe(true);
  await visible(); app.unmount();
  expect(pending[3]!.signal.aborted).toBe(true);
  expect(disconnect).toHaveBeenCalledOnce();
});

it('renders uploaded icons and safely restores the default icon when a background read fails', async () => {
  const { state, load, visible } = await mount();
  state.icon = 'data:image/png;base64,aGVsbG8='; await nextTick();
  expect(root.querySelector('img')?.getAttribute('src')).toBe(state.icon);
  await visible(); expect(load).not.toHaveBeenCalled();
  load.mockRejectedValue(new Error('unreadable'));
  state.file.name = 'AGENTS.md'; state.icon = undefined;
  await vi.waitFor(() => expect(root.querySelector('[class*="lucide-bot"]')).not.toBeNull());
  expect(root.querySelector('img')).toBeNull();
});
