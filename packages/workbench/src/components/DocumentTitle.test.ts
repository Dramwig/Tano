// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive } from 'vue';
import type { App } from 'vue';
import type { FileEntry } from '@tano/protocol';
import DocumentTitle from './DocumentTitle.vue';

let app: App;
let root: HTMLDivElement;
afterEach(() => { app?.unmount(); root?.remove(); });

async function mount() {
  const state = reactive({ path: '资料/笔记.markdown', readonly: false, files: [] as FileEntry[] });
  const rename = vi.fn(async (_workspace: string, _id: string, _from: string, to: string) => {
    state.path = to;
  });
  const enter = vi.fn();
  root = document.createElement('div');
  document.body.append(root);
  app = createApp({ render: () => h(DocumentTitle, {
    workspaceId: 'workspace', documentId: 'note', ...state, rename, onEnter: enter,
  }) });
  app.mount(root);
  await nextTick();
  const input = root.querySelector('input')!;
  async function type(value: string) {
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await nextTick();
  }
  async function key(key: string, isComposing = false) {
    input.dispatchEvent(new KeyboardEvent('keydown', { key, isComposing, bubbles: true }));
    await nextTick();
  }
  return { state, rename, enter, input, type, key };
}

it('continues into a new block on Enter even when the title is unchanged, but not on blur', async () => {
  const { rename, enter, input, key } = await mount();
  input.dispatchEvent(new Event('blur'));
  await nextTick();
  expect(enter).not.toHaveBeenCalled();
  await key('Enter');
  expect(rename).not.toHaveBeenCalled();
  expect(enter).toHaveBeenCalledExactlyOnceWith('workspace', 'note');
});

it('waits for rename before continuing and ignores Enter repeated while saving', async () => {
  const { rename, enter, type, key } = await mount();
  let finish!: () => void;
  rename.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  await type('新名称');
  await key('Enter');
  await key('Enter');
  expect(enter).not.toHaveBeenCalled();
  expect(rename).toHaveBeenCalledTimes(1);
  finish();
  await vi.waitFor(() => expect(enter).toHaveBeenCalledExactlyOnceWith('workspace', 'note'));
});

it('does not insert into another document after a pending rename is unmounted', async () => {
  const { rename, enter, type, key } = await mount();
  let finish!: () => void;
  rename.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  await type('新名称');
  await key('Enter');
  app.unmount();
  finish();
  await nextTick();
  expect(enter).not.toHaveBeenCalled();
});

it('renames in the same folder with the original extension and follows external renames', async () => {
  const { state, rename, input, type, key } = await mount();
  expect(input.value).toBe('笔记');
  await type('新标题');
  await key('Enter');
  expect(rename).toHaveBeenCalledWith('workspace', 'note', '资料/笔记.markdown', '资料/新标题.markdown');
  await nextTick();
  expect(input.value).toBe('新标题');
  state.path = '移动/外部改名.md';
  await nextTick();
  expect(input.value).toBe('外部改名');
});

it('shows an inline conflict without renaming, then allows correction on blur', async () => {
  const { state, rename, input, type } = await mount();
  state.files = [{ id: 'other', path: '资料/TAKEN.markdown', name: 'TAKEN.markdown', kind: 'file', size: 0, modified: 0 }];
  await type('taken');
  expect(root.querySelector('[role="alert"]')?.textContent).toBe('已经存在一个同名文件');
  input.dispatchEvent(new Event('blur'));
  await nextTick();
  expect(rename).not.toHaveBeenCalled();
  expect(input.value).toBe('taken');
  await type('可用名称');
  expect(root.querySelector('[role="alert"]')).toBeNull();
  input.dispatchEvent(new Event('blur'));
  await nextTick();
  expect(state.path).toBe('资料/可用名称.markdown');
});

it('rejects empty titles and path changes; Escape restores the filename', async () => {
  const { rename, enter, input, type, key } = await mount();
  for (const value of ['', '子目录/标题', '../标题', 'bad:name']) {
    await type(value);
    await key('Enter');
    expect(root.querySelector('[role="alert"]')).not.toBeNull();
  }
  expect(rename).not.toHaveBeenCalled();
  expect(enter).not.toHaveBeenCalled();
  await key('Escape');
  expect(input.value).toBe('笔记');
  expect(root.querySelector('[role="alert"]')).toBeNull();
});

it('does not rename on IME confirmation or when read-only', async () => {
  const { state, rename, enter, input, type, key } = await mount();
  await type('中文');
  await key('Enter', true);
  expect(rename).not.toHaveBeenCalled();
  expect(enter).not.toHaveBeenCalled();
  state.readonly = true;
  await nextTick();
  expect(input.readOnly).toBe(true);
  await key('Enter');
  expect(rename).not.toHaveBeenCalled();
  expect(enter).not.toHaveBeenCalled();
});

it('retains a failed draft and reports conflicts discovered during the actual rename', async () => {
  const { rename, enter, input, type, key } = await mount();
  rename.mockRejectedValueOnce(new Error('目标名称已经存在'));
  await type('冲突标题');
  await key('Enter');
  await nextTick();
  expect(input.value).toBe('冲突标题');
  expect(enter).not.toHaveBeenCalled();
  expect(root.querySelector('[role="alert"]')?.textContent).toBe('已经存在一个同名文件');
  await type('重试标题');
  await key('Enter');
  await nextTick();
  expect(input.value).toBe('重试标题');
  expect(root.querySelector('[role="alert"]')).toBeNull();
});
