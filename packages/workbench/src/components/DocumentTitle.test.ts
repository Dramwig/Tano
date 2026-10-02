// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive } from 'vue';
import type { App } from 'vue';
import type { FileEntry } from '@tano/protocol';
import DocumentTitle from './DocumentTitle.vue';
import type { PageTitleSource } from '../page-title-source';

let app: App;
let root: HTMLDivElement;
afterEach(() => { app?.unmount(); root?.remove(); });

async function mount(options: { titleSource?: PageTitleSource; modelValue?: string } = {}) {
  const state = reactive({
    path: '资料/笔记.markdown', readonly: false, files: [] as FileEntry[],
    titleSource: 'filename' as PageTitleSource, modelValue: '', ...options,
  });
  const rename = vi.fn(async (_workspace: string, _id: string, _from: string, to: string) => {
    state.path = to;
  });
  const enter = vi.fn();
  const updateContent = vi.fn((content: string) => { state.modelValue = content; });
  root = document.createElement('div');
  document.body.append(root);
  app = createApp({ render: () => h(DocumentTitle, {
    workspaceId: 'workspace', documentId: 'note', ...state, rename, onEnter: enter,
    'onUpdate:modelValue': updateContent,
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
  return { state, rename, enter, updateContent, input, type, key };
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

it.each<PageTitleSource>(['filename', 'frontmatter-first'])('renames a %s title in the same folder with the original extension and follows external renames', async (titleSource) => {
  const { state, rename, input, type, key } = await mount({ titleSource });
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

it.each<PageTitleSource>(['filename', 'frontmatter-first'])('shows an inline filename conflict for %s, then allows correction on blur', async (titleSource) => {
  const { state, rename, input, type } = await mount({ titleSource });
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

it.each<PageTitleSource>(['filename', 'frontmatter-first'])('rejects empty filenames and path changes for %s; Escape restores the filename', async (titleSource) => {
  const { rename, enter, input, type, key } = await mount({ titleSource });
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

it.each<PageTitleSource>(['filename', 'frontmatter', 'frontmatter-first'])('does not edit a %s title on IME confirmation or when read-only', async (titleSource) => {
  const { state, rename, updateContent, enter, input, type, key } = await mount({ titleSource });
  await type('中文');
  await key('Enter', true);
  expect(rename).not.toHaveBeenCalled();
  expect(updateContent).not.toHaveBeenCalled();
  expect(enter).not.toHaveBeenCalled();
  state.readonly = true;
  await nextTick();
  expect(input.readOnly).toBe(true);
  await key('Enter');
  expect(rename).not.toHaveBeenCalled();
  expect(updateContent).not.toHaveBeenCalled();
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

it('defaults to preferring YAML title and renames the file when the filename is used as fallback', async () => {
  const { state, input, rename, updateContent, type, key } = await mount({
    titleSource: undefined, modelValue: '---\ntitle: 文档标题\n---\n# 正文\n',
  });
  expect(input.value).toBe('文档标题');
  state.modelValue = '# 正文\n';
  await nextTick();
  expect(input.value).toBe('笔记');
  await type('新标题');
  await key('Enter');
  expect(rename).toHaveBeenCalledExactlyOnceWith('workspace', 'note', '资料/笔记.markdown', '资料/新标题.markdown');
  expect(state.path).toBe('资料/新标题.markdown');
  expect(state.modelValue).toBe('# 正文\n');
  expect(updateContent).not.toHaveBeenCalled();
});

it('switches between the filename and a YAML title and follows metadata edits', async () => {
  const { state, input } = await mount({ modelValue: '---\ntitle: "文档标题" # comment\n---\n# 正文\n' });
  expect(input.value).toBe('笔记');
  state.titleSource = 'frontmatter';
  await nextTick();
  expect(input.value).toBe('文档标题');
  state.modelValue = '---\ntitle: 新标题\n---\n# 正文\n';
  await nextTick();
  expect(input.value).toBe('新标题');
  state.titleSource = 'filename';
  await nextTick();
  expect(input.value).toBe('笔记');
});

const documentsWithoutYamlTitle = [
  '# 正文\n', '---\ntags: [note]\n---\n', '---\ntitle: " "\n---\n',
  '---\ntitle: null\n---\n', '---\ntitle: 123\n---\n', '---\ntitle: false\n---\n',
  '---\ntitle: [one, two]\n---\n', '---\ntitle: {nested: value}\n---\n',
  '---\ntitle: [unfinished\n---\n', '---\ntitle: 未闭合\n',
  '正文\n---\ntitle: 不是开头的属性\n---\n',
];

it.each<{ titleSource: PageTitleSource; fallback: string }>([
  { titleSource: 'frontmatter', fallback: '' },
  { titleSource: 'frontmatter-first', fallback: '笔记' },
])('uses the $titleSource policy for missing, empty, non-string, or malformed YAML titles', async ({ titleSource, fallback }) => {
  const { state, input } = await mount({ titleSource });
  for (const markdown of documentsWithoutYamlTitle) {
    state.modelValue = markdown;
    await nextTick();
    expect(input.value).toBe(fallback);
  }
  state.modelValue = '\uFEFF---\r\ntitle: >-\r\n  第一行\r\n  第二行\r\n...\r\n正文';
  await nextTick();
  expect(input.value).toBe('第一行 第二行');
});

it.each(documentsWithoutYamlTitle)('renames the fallback filename without changing YAML or body in %j', async (modelValue) => {
  const { state, rename, updateContent, input, type } = await mount({
    titleSource: 'frontmatter-first', modelValue,
  });
  await type('新标题');
  input.dispatchEvent(new Event('blur'));
  await nextTick();
  expect(rename).toHaveBeenCalledExactlyOnceWith('workspace', 'note', '资料/笔记.markdown', '资料/新标题.markdown');
  expect(state.modelValue).toBe(modelValue);
  expect(updateContent).not.toHaveBeenCalled();
});

it.each([
  ['# 正文\n', '---\ntitle: 外部标题\n---\n# 正文\n', '外部标题'],
  ['---\ntitle: 旧标题\n---\n# 正文\n', '# 正文\n', '笔记'],
])('preserves the draft when adding or removing YAML title changes its source in %j', async (modelValue, externalContent, externalTitle) => {
  const { state, rename, updateContent, input, type, key } = await mount({
    titleSource: 'frontmatter-first', modelValue,
  });
  await type('我的修改');
  state.modelValue = externalContent;
  await nextTick();
  await key('Enter');
  expect(input.value).toBe('我的修改');
  expect(root.querySelector('[role="alert"]')?.textContent).toContain('标题来源已改变');
  expect(rename).not.toHaveBeenCalled();
  expect(updateContent).not.toHaveBeenCalled();
  expect(state.modelValue).toBe(externalContent);
  await key('Escape');
  expect(input.value).toBe(externalTitle);
});

it.each<PageTitleSource>(['frontmatter', 'frontmatter-first'])('edits a %s title without renaming and preserves comments, other properties, and the latest body', async (titleSource) => {
  const markdown = '---\r\ntitle: "旧标题" # keep\r\ntags: [note]\r\n...\r\n\r\n原正文\r\n';
  const { state, rename, updateContent, enter, input, type, key } = await mount({
    titleSource, modelValue: markdown,
  });
  await type('新标题 / 示例: 1');
  state.modelValue = markdown.replace('[note]', '[note, new]').replace('原正文', '外部修改后的正文');
  await nextTick();
  await key('Enter');
  expect(rename).not.toHaveBeenCalled();
  expect(updateContent).toHaveBeenCalledExactlyOnceWith(state.modelValue);
  expect(state.modelValue).toContain('title: "新标题 / 示例: 1" # keep\r\n');
  expect(state.modelValue).toContain('tags: [note, new]\r\n...\r\n\r\n外部修改后的正文\r\n');
  expect(state.path).toBe('资料/笔记.markdown');
  expect(input.value).toBe('新标题 / 示例: 1');
  expect(enter).toHaveBeenCalledExactlyOnceWith('workspace', 'note');
});

it.each([
  ['# 正文\n', '---\ntitle: 新标题\n---\n# 正文\n'],
  ['---\ntags: [note]\n---\n# 正文\n', '---\ntags: [note]\ntitle: 新标题\n---\n# 正文\n'],
  ['---\ntitle: null\n---\n# 正文\n', '---\ntitle: 新标题\n---\n# 正文\n'],
])('sets a YAML title on blur while preserving the document %j', async (modelValue, expected) => {
  const { state, rename, enter, input, type } = await mount({ titleSource: 'frontmatter', modelValue });
  await type('新标题');
  input.dispatchEvent(new Event('blur'));
  await nextTick();
  expect(state.modelValue).toBe(expected);
  expect(rename).not.toHaveBeenCalled();
  expect(enter).not.toHaveBeenCalled();
});

it.each<PageTitleSource>(['frontmatter', 'frontmatter-first'])('preserves a %s title draft when YAML title changes externally until Escape reloads it', async (titleSource) => {
  const { state, updateContent, enter, input, type, key } = await mount({
    titleSource, modelValue: '---\ntitle: 旧标题\n---\n正文\n',
  });
  await type('我的修改');
  state.modelValue = '---\ntitle: 外部标题\n---\n正文\n';
  await nextTick();
  await key('Enter');
  expect(input.value).toBe('我的修改');
  expect(updateContent).not.toHaveBeenCalled();
  expect(enter).not.toHaveBeenCalled();
  expect(root.querySelector('[role="alert"]')?.textContent).toContain('YAML title 已被修改');
  await key('Escape');
  expect(input.value).toBe('外部标题');
  expect(root.querySelector('[role="alert"]')).toBeNull();
});

it('keeps malformed or unsupported frontmatter intact when a YAML-only title cannot be saved', async () => {
  const { state, updateContent, rename, type, key } = await mount({ titleSource: 'frontmatter' });
  for (const markdown of ['---\ntitle: 未闭合\n', '---\ntitle: [unfinished\n---\n正文\n', '+++\ntitle = "TOML"\n+++\n正文\n']) {
    await key('Escape');
    state.modelValue = markdown;
    await nextTick();
    await type('新标题');
    await key('Enter');
    expect(root.querySelector('[role="alert"]')).not.toBeNull();
    expect(state.modelValue).toBe(markdown);
  }
  expect(updateContent).not.toHaveBeenCalled();
  expect(rename).not.toHaveBeenCalled();
});
