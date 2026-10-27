// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { createApp, h, nextTick, ref, type App } from 'vue';
import type { FileEntry } from '@tano/protocol';
import { selectTreeEntry } from '../file-selection';
import FileTree from './FileTree.vue';

let app: App;
let scroll: HTMLDivElement;
afterEach(() => { app?.unmount(); scroll?.remove(); });
const files: FileEntry[] = Array.from({ length: 5_000 }, (_, index) => ({
  id: `file-${index}`, path: `笔记${index}.md`, name: `笔记${index}.md`, kind: 'file', size: 10, modified: 0,
}));

async function mount(entries = files) {
  scroll = document.createElement('div'); scroll.className = 'tree-scroll'; document.body.append(scroll);
  Object.defineProperty(scroll, 'clientHeight', { value: 340 });
  const component = ref<InstanceType<typeof FileTree>>();
  const renaming = ref<string>();
  app = createApp({ render: () => h(FileTree, { ref: component, entries, renamingId: renaming.value, renameEntry: async () => {}, onRenameFinished: () => { renaming.value = undefined; } }) });
  app.mount(scroll);
  await nextTick();
  const tree = scroll.querySelector<HTMLElement>('.file-tree')!;
  tree.getBoundingClientRect = () => ({ top: -scroll.scrollTop, left: 0, bottom: 0, right: 0, width: 300, height: 0, x: 0, y: -scroll.scrollTop, toJSON() {} });
  return { component, renaming };
}

it('bounds mounted rows while retaining the complete logical selection order', async () => {
  const { component } = await mount();
  expect(scroll.querySelectorAll('.tree-row').length).toBeLessThan(40);
  expect(component.value!.getVisibleIds()).toEqual(files.map(file => file.id));
  scroll.scrollTop = 4_990 * 34; scroll.dispatchEvent(new Event('scroll'));
  await nextTick();
  expect(scroll.querySelectorAll('.tree-row').length).toBeLessThan(40);
  expect(scroll.querySelector('[data-entry-id="file-4999"]')).not.toBeNull();
  expect(scroll.querySelector('[data-entry-id="file-0"]')).toBeNull();
  const selected = selectTreeEntry({ ids: new Set(['file-0']), anchor: 'file-0' }, 'file-4999', component.value!.getVisibleIds(), { shiftKey: true, ctrlKey: false, metaKey: false });
  expect(selected.ids.size).toBe(5_000);
});

it('flattens expanded folders and supports keyboard navigation beyond the viewport', async () => {
  const folder: FileEntry = { id: 'folder', path: '项目', name: '项目', kind: 'directory', size: 0, modified: 0 };
  const { component } = await mount([folder, ...files.map(file => ({ ...file, path: `项目/${file.path}` }))]);
  expect(component.value!.getVisibleIds()).toEqual(['folder']);
  const row = scroll.querySelector<HTMLButtonElement>('[data-entry-id="folder"]')!;
  row.click(); await nextTick();
  expect(component.value!.getVisibleIds()).toHaveLength(5_001);
  row.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  await nextTick(); await nextTick();
  expect((document.activeElement as HTMLElement).dataset.entryId).toBe('file-4999');
  expect(document.activeElement?.getAttribute('aria-level')).toBe('2');
  expect(scroll.querySelectorAll('.tree-row').length).toBeLessThan(40);
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  await nextTick(); await nextTick();
  expect((document.activeElement as HTMLElement).dataset.entryId).toBe('folder');
  row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  await nextTick();
  expect(component.value!.getVisibleIds()).toEqual(['folder']);
});

it('keeps an offscreen rename mounted while scrolling, then restores row focus', async () => {
  const { renaming } = await mount();
  renaming.value = 'file-4999'; await nextTick(); await nextTick();
  const input = scroll.querySelector<HTMLInputElement>('.tree-rename-input')!;
  expect(input).not.toBeNull();
  scroll.scrollTop = 0; scroll.dispatchEvent(new Event('scroll')); await nextTick();
  expect(scroll.querySelector('.tree-rename-input')).toBe(input);
  expect(scroll.querySelectorAll('.tree-row').length).toBeLessThan(40);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await nextTick(); await nextTick();
  expect(scroll.querySelector('.tree-rename-input')).toBeNull();
  expect((document.activeElement as HTMLElement).dataset.entryId).toBe('file-4999');
});

it('does not steal focus when an offscreen rename finishes on blur', async () => {
  const { renaming } = await mount();
  renaming.value = 'file-4999'; await nextTick(); await nextTick();
  const other = document.createElement('button'); scroll.append(other);
  other.focus(); await nextTick(); await nextTick();
  expect(scroll.querySelector('.tree-rename-input')).toBeNull();
  expect(document.activeElement).toBe(other);
});
