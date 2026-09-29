// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, nextTick, reactive } from 'vue';
import type { App } from 'vue';
import NewTabPicker from './NewTabPicker.vue';

const fixture = vi.hoisted(() => ({ store: null as any }));
vi.mock('../stores/workspace', () => ({ useWorkspaceStore: () => fixture.store }));
let app: App, root: HTMLDivElement, trigger: HTMLButtonElement;
const close = vi.fn(),
  create = vi.fn();
const files = [
  { id: 'one', path: '项目/计划.md', kind: 'file', modified: 1 },
  { id: 'two', path: '归档/计划.md', kind: 'file', modified: 3 },
  { id: 'three', path: '说明.markdown', kind: 'file', modified: 2 },
  { id: 'image', path: '图片.png', kind: 'file', modified: 4 },
  { id: 'folder', path: '文件夹.md', kind: 'directory', modified: 5 },
];
const options = () => [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')];
const input = () => document.querySelector<HTMLInputElement>('[role="combobox"]')!;
async function search(text: string) {
  input().value = text;
  input().dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
}
async function mount(readOnly = false) {
  fixture.store.workspace.readOnly = readOnly;
  app = createApp(NewTabPicker, { onClose: close, onNewDocument: create });
  app.mount(root);
  await nextTick();
  for (const option of options()) option.scrollIntoView = vi.fn();
}
beforeEach(() => {
  vi.clearAllMocks();
  fixture.store = reactive({
    workspace: { id: 'workspace', name: '同页', files, readOnly: false },
    documents: [{ id: 'one' }],
    activeId: 'one',
    busy: false,
    fatal: '',
    openFile: vi.fn(async (file) => {
      fixture.store.activeId = file.id;
    }),
  });
  root = document.createElement('div');
  trigger = document.createElement('button');
  document.body.append(root, trigger);
  trigger.focus();
});
afterEach(() => {
  app?.unmount();
  root.remove();
  trigger.remove();
  vi.restoreAllMocks();
});

it('focuses search and groups open Markdown documents before recently modified files', async () => {
  await mount();
  expect(document.activeElement).toBe(input());
  expect(options().map((row) => row.title)).toEqual([
    '',
    '项目/计划.md',
    '归档/计划.md',
    '说明.markdown',
  ]);
  expect(document.querySelectorAll('.new-tab-group')).toHaveLength(2);
  options()[0].click();
  expect(create).toHaveBeenCalledOnce();
  expect(fixture.store.openFile).not.toHaveBeenCalled();
});
it('finds a document by title and folder, then opens the selected result with Enter', async () => {
  await mount();
  await search('归档 计划');
  expect(options()).toHaveLength(2);
  expect(options()[1].getAttribute('aria-selected')).toBe('true');
  input().dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }),
  );
  expect(fixture.store.openFile).not.toHaveBeenCalled();
  input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await nextTick();
  expect(fixture.store.openFile).toHaveBeenCalledWith(expect.objectContaining({ id: 'two' }));
  expect(close).toHaveBeenCalledOnce();
});
it('allows opening existing tabs in a read-only workspace without offering creation', async () => {
  await mount(true);
  expect(options()).toHaveLength(3);
  options()[0].click();
  await nextTick();
  expect(fixture.store.openFile).toHaveBeenCalledWith(expect.objectContaining({ id: 'one' }));
  expect(create).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
});
it('supports keyboard selection and leaves the picker open after an open failure', async () => {
  fixture.store.openFile.mockImplementation(async () => {
    fixture.store.fatal = '文件已移走';
  });
  await mount();
  await search('归档');
  input().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
  await nextTick();
  expect(options()[0].getAttribute('aria-selected')).toBe('true');
  options()[1].click();
  await vi.waitFor(() =>
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('文件已移走'),
  );
  expect(close).not.toHaveBeenCalled();
});
it('shows an empty result and restores focus when dismissed', async () => {
  await mount(true);
  await search('不存在');
  expect(options()).toHaveLength(0);
  expect(document.querySelector('.new-tab-empty')?.textContent).toContain('没有找到匹配的文档');
  input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(close).toHaveBeenCalledOnce();
  const restoreFocus = vi.spyOn(trigger, 'focus');
  // The host removes the picker in response to close.
  app.unmount();
  expect(restoreFocus).toHaveBeenCalled();
  expect(document.activeElement).toBe(trigger);
});
