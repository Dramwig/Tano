// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { editorViewCtx, parserCtx, serializerCtx } from '@milkdown/kit/core';
import MarkdownEditor from '@tano/editor';
import { createHeadlessMarkdown } from '@tano/editor/headless';
import DocumentSuggestions from './DocumentSuggestions.vue';
import { DemoAdapter } from '../adapter';
import { configureWorkbench } from '../runtime';
import { useWorkspaceStore } from '../stores/workspace';
import { useSuggestionStore } from '../stores/suggestions';
import { demoFiles } from '../demo';
import SourceEditor from './SourceEditor.vue';
import { updateReviewRail, removeReviewRail } from './review-rail';

let app: ReturnType<typeof createApp> | undefined;
let root: HTMLDivElement;
let workspace: ReturnType<typeof useWorkspaceStore>;
afterEach(async () => { app?.unmount(); root?.remove(); workspace?.dispose(); vi.restoreAllMocks(); localStorage.clear(); await nextTick(); });

async function mount(content = 'Hello world\n', source = false) {
  localStorage.clear();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, action: () => unknown) => action() } });
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const adapter = new DemoAdapter();
  const pinia = configureWorkbench(createPinia(), { adapter, native: false, mobile: false });
  setActivePinia(pinia);
  workspace = useWorkspaceStore(); await workspace.openWorkspace();
  await adapter.create('建议测试.md', content);
  await workspace.refresh();
  const file = workspace.workspace!.files.find(file => file.path === '建议测试.md')!;
  await workspace.openFileInNewTab(file);
  const suggestions = useSuggestionStore();
  const editor = ref<InstanceType<typeof MarkdownEditor>>();
  const sourceEditor = ref<InstanceType<typeof SourceEditor>>();
  root = document.createElement('div'); root.className = 'editor-scroll'; document.body.append(root);
  app = createApp(() => h(DocumentSuggestions, { document: workspace.active!, readonly: false, author: { id: 'local', name: '本机用户' } }, {
    default: (slot: any) => source ? h(SourceEditor, { ref: sourceEditor, key: slot.viewKey, modelValue: slot.content,
      readonly: slot.readonly, localNative: false, suggestionMarks: slot.sourceMarks, 'onUpdate:modelValue': slot.edit }) : h(MarkdownEditor, { ref: editor, key: slot.viewKey, documentId: file.id,
      modelValue: slot.content, readonly: slot.readonly, revealMarkdown: !slot.suggesting, suggestionMarks: slot.richMarks, transformChange: slot.transformChange, 'onUpdate:modelValue': slot.edit }),
  })).use(pinia);
  app.mount(root);
  await vi.waitFor(() => expect(source ? root.querySelector('.cm-editor') : editor.value?.withContext(ctx => ctx.get(editorViewCtx))).toBeTruthy());
  await vi.waitFor(() => expect(suggestions.get(file.id)?.state).toBeTruthy());
  await suggestions.toggle(file.id);
  await vi.waitFor(() => expect(suggestions.get(file.id)?.mode).toBe(true));
  await vi.waitFor(() => expect(source ? root.querySelector('.cm-editor') : editor.value?.withContext(ctx => ctx.get(editorViewCtx))).toBeTruthy());
  return { adapter, file, editor, sourceEditor, suggestions };
}

it('typing in the rich editor creates an inline suggestion and accepting writes exactly that change', async () => {
  const { adapter, file, editor, suggestions } = await mount();
  editor.value!.withContext(ctx => { const view = ctx.get(editorViewCtx); view.dispatch(view.state.tr.insertText('beautiful ', 7)); });
  await vi.waitFor(() => expect(root.querySelector('.tano-suggestion-insert')?.textContent).toBe('beautiful '));
  await suggestions.flush();
  expect((await adapter.read(file.path)).content).toBe('Hello world\n');
  expect(workspace.active!.content).toBe('Hello world\n');
  expect(root.querySelector('.suggestion-card')?.textContent).toContain('本机用户');
  const card = root.querySelector<HTMLElement>('.suggestion-card')!;
  card.click();
  await nextTick();
  expect(card.classList.contains('is-expanded')).toBe(true);
  expect(card.getAttribute('aria-expanded')).toBe('true');
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  await nextTick();
  expect(card.classList.contains('is-expanded')).toBe(false);
  const scrollToSuggestion = vi.fn();
  root.querySelector<HTMLElement>('[data-suggestion-id]')!.scrollIntoView = scrollToSuggestion;
  card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await nextTick();
  expect(card.classList.contains('is-expanded')).toBe(true);
  expect(scrollToSuggestion).toHaveBeenCalled();
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  await nextTick();
  expect(card.classList.contains('is-expanded')).toBe(false);
  root.querySelector<HTMLButtonElement>('[aria-label="接受建议"]')!.click();
  await vi.waitFor(() => expect(suggestions.get(file.id)!.records[0]!.status).toBe('accepted'));
  expect((await adapter.read(file.path)).content).toBe('Hello beautiful world\n');
  expect(root.querySelector('.tano-suggestion-insert')).toBeNull();
});

it.each(['insert', 'delete'])('reserves only the suggested table gutter and restores it after rejection (%s)', async change => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('editor-scroll')) return new DOMRect(0, 0, 1600, 1000);
    if (this.tagName === 'TABLE') return new DOMRect(240, 100, 1800, 140);
    return new DOMRect(240, 0, 780, 1000);
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('editor-scroll') ? 1600 : 780;
  });
  const source = 'Before\n\n| A | B |\n| --- | --- |\n| alpha | beta |\n\nBetween\n\n| C | D |\n| --- | --- |\n| gamma | delta |\n';
  const { adapter, file, editor, suggestions } = await mount(source);
  root.classList.add('document-main');
  const widths = () => [...root.querySelectorAll<HTMLElement>('.tano-table-viewport')].map(table => table.style.width);
  await vi.waitFor(() => expect(widths()).toEqual(['1600px', '1600px']));
  editor.value!.withContext(ctx => {
    const view = ctx.get(editorViewCtx);
    let position = -1;
    view.state.doc.descendants((node, pos) => { if (node.isText && node.text === 'alpha') position = pos; });
    expect(position).toBeGreaterThan(0);
    view.dispatch(change === 'insert' ? view.state.tr.insertText('new ', position) : view.state.tr.delete(position, position + 5));
  });
  await nextTick(); await suggestions.flush();
  await vi.waitFor(() => expect(root.querySelector('.suggestion-rail.is-inline')).not.toBeNull());
  await vi.waitFor(() => expect(widths()).toEqual(['780px', '1600px']));
  // Reviewing the same proposal in the official text keeps the same per-table layout.
  await suggestions.toggle(file.id);
  await vi.waitFor(() => expect(widths()).toEqual(['780px', '1600px']));
  await suggestions.reject(file.id, suggestions.get(file.id)!.records[0]!.id);
  await vi.waitFor(() => expect(widths()).toEqual(['1600px', '1600px']));
  expect((await adapter.read(file.path)).content).toBe(source);
});

it('shows deleted text without serializing it and rejecting restores the original view', async () => {
  const { adapter, file, editor, suggestions } = await mount();
  editor.value!.withContext(ctx => { const view = ctx.get(editorViewCtx); view.dispatch(view.state.tr.delete(7, 12)); });
  await vi.waitFor(() => expect(root.querySelector('.tano-suggestion-delete')?.textContent).toContain('world'));
  await suggestions.flush();
  expect((await adapter.read(file.path)).content).toBe('Hello world\n');
  root.querySelector<HTMLButtonElement>('[aria-label="拒绝建议"]')!.click();
  await vi.waitFor(() => expect(suggestions.get(file.id)!.records[0]!.status).toBe('rejected'));
  await vi.waitFor(() => expect(root.querySelector('.ProseMirror')?.textContent).toBe('Hello world'));
  expect((await adapter.read(file.path)).content).toBe('Hello world\n');
});

it('undo and redo stay inside the proposal view and never save pending text to Markdown', async () => {
  const { adapter, file, editor, suggestions } = await mount();
  editor.value!.withContext(ctx => { const view = ctx.get(editorViewCtx); view.dispatch(view.state.tr.insertText('新', 1)); });
  await suggestions.flush(); await nextTick();
  editor.value!.undoLastChange(); await nextTick(); await suggestions.flush();
  expect(suggestions.projection(file.id).content).toBe('Hello world\n');
  editor.value!.redoLastChange(); await nextTick(); await suggestions.flush();
  expect(suggestions.projection(file.id).content).toBe('新Hello world\n');
  expect((await adapter.read(file.path)).content).toBe('Hello world\n');
});

it('does not include unrelated list, rule or table normalization in a text suggestion', async () => {
  const source = '# Hello\n\n- [ ] Task\n\n| A | B |\n| --- | --- |\n| C | D |\n\n---\n';
  const { adapter, file, editor, suggestions } = await mount(source);
  editor.value!.withContext(ctx => { const view = ctx.get(editorViewCtx); view.dispatch(view.state.tr.insertText('New ', 1)); });
  await nextTick(); await suggestions.flush();
  expect(suggestions.get(file.id)!.records).toHaveLength(1);
  expect(suggestions.get(file.id)!.records[0]).toMatchObject({ from: 2, to: 2, text: 'New ' });
  await suggestions.accept(file.id, suggestions.get(file.id)!.records[0]!.id);
  expect((await adapter.read(file.path)).content).toBe(source.replace('# Hello', '# New Hello'));
});

it('keeps rapid typing coherent before Vue rerenders the host slot', async () => {
  const source = demoFiles['开始使用.md']!;
  const { file, editor, suggestions } = await mount(source);
  editor.value!.withContext(ctx => {
    const view = ctx.get(editorViewCtx);
    for (const [index, char] of [...'建议模式验收：'].entries()) view.dispatch(view.state.tr.insertText(char, 1 + index));
  });
  await nextTick(); await suggestions.flush();
  expect(suggestions.get(file.id)!.records).toHaveLength(1);
  expect(suggestions.get(file.id)!.records[0]!.text).toBe('建议模式验收：');
  expect(suggestions.projection(file.id).content).toBe(source.replace('# ', '# 建议模式验收：'));
});

it.each([false, true])('keeps typing in the widest table cell limited to the inserted text (padded source: %s)', async padded => {
  let source = '| 文件 | 说明 | 备注 |\n| :--- | ---: | :---: |\n' +
    '| [02 YAML 属性字段.md](02 YAML 属性字段.md) | YAML 顶部属性的值类型、日期字段与原文保留 | <br /> |\n' +
    '| [03 公式图表与脚注.md](03 公式图表与脚注.md) | 美元与 LaTeX 公式、Mermaid、脚注 | <br /> |\n' +
    '| [子目录/目标文档.markdown](子目录/目标文档.markdown) | 子目录、`.markdown` 扩展名、跨文件跳转 | |\n';
  if (padded) {
    const codec = await createHeadlessMarkdown();
    try { source = codec.withContext(ctx => ctx.get(serializerCtx)(ctx.get(parserCtx)(source)!)); }
    finally { await codec.destroy(); }
  }
  const { adapter, file, editor, suggestions } = await mount(source);
  editor.value!.withContext(ctx => {
    const view = ctx.get(editorViewCtx);
    let position = -1;
    view.state.doc.descendants((node, pos) => {
      if (node.isText && node.text?.includes('跨文件跳转')) position = pos + node.text.indexOf('跨文件跳转') + 2;
    });
    expect(position).toBeGreaterThan(0);
    for (const [offset, char] of [...'123123'].entries()) view.dispatch(view.state.tr.insertText(char, position + offset));
  });
  await nextTick(); await suggestions.flush();
  const pending = suggestions.get(file.id)!.records.filter(item => item.status === 'pending');
  expect(pending).toHaveLength(1);
  const from = source.indexOf('跨文件跳转') + 2;
  expect(pending[0]).toMatchObject({ from, to: from, text: '123123' });
  expect(root.querySelector('.suggestion-change')?.textContent).toBe('123123');
  await suggestions.accept(file.id, pending[0]!.id);
  expect((await adapter.read(file.path)).content).toBe(source.replace('跨文件跳转', '跨文123123件跳转'));
});

it.each([
  { replacement: 'short', removed: 'longest value', inserted: 'short' },
  { replacement: 'value', removed: 'longest ', inserted: '' },
])('keeps shrinking the widest cell limited to its replacement ($replacement)', async ({ replacement, removed, inserted }) => {
  const source = '| A | B |\n| --- | --- |\n| keep | longest value |\n| `a\\|b` | end |\n';
  const { adapter, file, editor, suggestions } = await mount(source);
  editor.value!.withContext(ctx => {
    const view = ctx.get(editorViewCtx);
    let position = -1;
    view.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'longest value') position = pos;
    });
    expect(position).toBeGreaterThan(0);
    view.dispatch(view.state.tr.insertText(replacement, position, position + 'longest value'.length));
  });
  await nextTick(); await suggestions.flush();
  const pending = suggestions.get(file.id)!.records.filter(item => item.status === 'pending');
  expect(pending).toHaveLength(1);
  const from = source.indexOf('longest value');
  expect(pending[0]).toMatchObject({ from, to: from + removed.length, text: inserted });
  expect(root.querySelector('.suggestion-change del')?.textContent).toBe(removed);
  await suggestions.accept(file.id, pending[0]!.id);
  expect((await adapter.read(file.path)).content).toBe(source.replace('longest value', replacement));
});

it('source-mode replacement displays insertions and deletions and saves only on acceptance', async () => {
  const { adapter, file, sourceEditor, suggestions } = await mount('Hello world\n', true);
  sourceEditor.value!.replaceSearch('world', 'everyone', 0);
  await nextTick(); await suggestions.flush();
  expect(root.querySelector('.tano-suggestion-insert')?.textContent).toBe('everyone');
  expect(root.querySelector('.tano-suggestion-delete')?.textContent).toBe('world');
  expect((await adapter.read(file.path)).content).toBe('Hello world\n');
  root.querySelector<HTMLButtonElement>('[aria-label="接受建议"]')!.click();
  await vi.waitFor(() => expect(suggestions.get(file.id)!.records[0]!.status).toBe('accepted'));
  expect((await adapter.read(file.path)).content).toBe('Hello everyone\n');
});

it.each([false, true])('keeps review marks and cards outside suggestion mode without saving proposed text (source: %s)', async source => {
  const { file, editor, sourceEditor, suggestions } = await mount('Hello world\n', source);
  if (source) sourceEditor.value!.replaceSearch('world', 'everyone', 0);
  else editor.value!.withContext(ctx => {
    const view = ctx.get(editorViewCtx);
    view.dispatch(view.state.tr.insertText('everyone', 7, 12));
  });
  await nextTick();
  await suggestions.flush();
  await suggestions.toggle(file.id);
  await vi.waitFor(() => expect(root.querySelector('.tano-suggestion-insert')?.textContent).toBe('everyone'));
  expect(root.querySelector('.tano-suggestion-delete')?.textContent).toBe('world');
  expect(root.querySelectorAll('.suggestion-card')).toHaveLength(1);
  expect(workspace.active!.content).toBe('Hello world\n');
  if (source) sourceEditor.value!.replaceSearch('Hello', 'Hi', 0);
  else editor.value!.withContext(ctx => {
    const view = ctx.get(editorViewCtx);
    view.dispatch(view.state.tr.insertText('Hi', 1, 6));
  });
  await vi.waitFor(() => expect(workspace.active!.content).toContain('Hi world'));
  expect(workspace.active!.content).not.toContain('everyone');
  await vi.waitFor(() => expect(root.querySelector('.tano-suggestion-insert')?.textContent).toBe('everyone'));
  expect(root.querySelector('.suggestion-card')).toBeTruthy();
  await suggestions.accept(file.id, suggestions.get(file.id)!.records[0]!.id);
  await vi.waitFor(() => expect(root.querySelector('.tano-suggestion-insert')).toBeNull());
  expect(workspace.active!.content).toContain('Hi everyone');
});

it.each([false, true])('opens the shared reply composer from a suggestion mark and persists replies (source: %s)', async source => {
  const { adapter, file, editor, sourceEditor, suggestions } = await mount('Hello world\n', source);
  if (source) sourceEditor.value!.replaceSearch('world', 'everyone', 0);
  else editor.value!.withContext(ctx => {
    const view = ctx.get(editorViewCtx);
    view.dispatch(view.state.tr.insertText('everyone', 7, 12));
  });
  await nextTick(); await suggestions.flush();
  for (const normalMode of [false, true]) {
    if (normalMode) await suggestions.toggle(file.id);
    await vi.waitFor(() => expect(root.querySelector('.tano-suggestion-insert')).toBeTruthy());
    root.querySelector<HTMLElement>('.tano-suggestion-insert')!.click();
    await nextTick(); await nextTick();
    const input = root.querySelector<HTMLTextAreaElement>('[aria-label="添加回复"]')!;
    expect(document.activeElement).toBe(input);
    expect(root.querySelector('.suggestion-card')?.classList.contains('is-expanded')).toBe(true);
    input.value = normalMode ? '普通模式回复' : '建议模式回复';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(input.value).toBe(''));
    expect(suggestions.get(file.id)!.records[0]!.replies?.at(-1)?.body).toBe(normalMode ? '普通模式回复' : '建议模式回复');
    await suggestions.load(file.id, true);
    expect(suggestions.get(file.id)!.records[0]!.replies?.at(-1)?.body).toBe(normalMode ? '普通模式回复' : '建议模式回复');
    expect(root.querySelector('.comment-message.is-reply')).toBeTruthy();
    expect((await adapter.read(file.path)).content).toBe('Hello world\n');
  }
  expect(root.querySelectorAll('.comment-message.is-reply')).toHaveLength(2);
  const lastReply = root.querySelectorAll<HTMLElement>('.comment-message.is-reply')[1]!;
  lastReply.querySelector<HTMLButtonElement>('[aria-label="更多评论操作"]')!.click();
  await nextTick();
  const edit = document.querySelector<HTMLButtonElement>('.comment-more-menu [role="menuitem"]')!;
  edit.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  edit.click();
  await nextTick(); await nextTick();
  const editInput = root.querySelector<HTMLTextAreaElement>('[aria-label="编辑评论"]')!;
  expect(document.activeElement).toBe(editInput);
  expect(root.querySelector('.suggestion-card')?.classList.contains('is-expanded')).toBe(true);
  editInput.value = '修改后的回复';
  editInput.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  root.querySelector<HTMLButtonElement>('[aria-label="确认编辑"]')!.click();
  await vi.waitFor(() => expect(suggestions.get(file.id)!.records[0]!.replies?.[1]?.body).toBe('修改后的回复'));
  await suggestions.flush();
  await suggestions.load(file.id, true);
  expect(suggestions.get(file.id)!.records[0]!.replies?.[1]?.body).toBe('修改后的回复');
});

it('Chinese composition remains one suggestion and persists committed text', async () => {
  const { adapter, file, editor, suggestions } = await mount();
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx))!;
  view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  view.dispatch(view.state.tr.insertText('ni', 1));
  view.dispatch(view.state.tr.insertText('你', 1, 3));
  view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '你' }));
  await nextTick(); await suggestions.flush();
  expect(suggestions.get(file.id)!.records.filter(item => item.status === 'pending')).toHaveLength(1);
  expect(suggestions.projection(file.id).content).toBe('你Hello world\n');
  expect((await adapter.read(file.path)).content).toBe('Hello world\n');
});

it('places suggestions in the annotation gutter, avoids comments, and falls back below narrow prose', async () => {
  let width = 1600;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('document-main')) return new DOMRect(0, 0, width, 1000);
    if (this.classList.contains('ProseMirror')) return new DOMRect(250, 100, 780, 800);
    if (this.hasAttribute('data-suggestion-id')) return new DOMRect(250, 300, 80, 20);
    if (this.classList.contains('annotation-card')) return new DOMRect(1054, 300, 320, 100);
    if (this.classList.contains('suggestion-card')) return new DOMRect(1054, 0, 320, 120);
    return new DOMRect();
  });
  const { editor, suggestions } = await mount();
  root.classList.add('document-main');
  const comments = document.createElement('div');
  comments.className = 'annotation-rail';
  comments.innerHTML = '<div class="annotation-card">批注</div>';
  root.querySelector('.suggestion-content')!.append(comments);
  const commentOwner = {};
  const commentCard = comments.firstElementChild as HTMLElement;
  Object.defineProperty(commentCard, 'offsetHeight', { value: 100 });
  updateReviewRail(commentOwner, root, [{ id: 'comment:test', element: commentCard, anchor: 300 }]);
  editor.value!.withContext(ctx => { const view = ctx.get(editorViewCtx); view.dispatch(view.state.tr.insertText('new ', 7)); });
  await suggestions.flush();
  await vi.waitFor(() => expect(root.querySelector<HTMLElement>('.suggestion-rail.is-inline')?.style.left).toBe('1054px'));
  await vi.waitFor(() => expect(root.querySelector<HTMLElement>('.suggestion-card')?.style.top).toBe('412px'));
  const suggestionCard = root.querySelector<HTMLElement>('.suggestion-card')!;
  suggestionCard.click();
  await vi.waitFor(() => expect(suggestionCard.style.top).toBe('300px'));
  expect(commentCard.style.top).toBe('188px');
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  await vi.waitFor(() => expect(suggestionCard.style.top).toBe('412px'));
  expect(commentCard.style.top).toBe('300px');
  removeReviewRail(commentOwner);
  comments.remove();
  await vi.waitFor(() => expect(root.querySelector<HTMLElement>('.suggestion-card')?.style.top).toBe('300px'));
  width = 1100;
  window.dispatchEvent(new Event('resize'));
  await vi.waitFor(() => expect(root.querySelector('.suggestion-rail.is-inline')).toBeNull());
  expect(root.querySelector<HTMLElement>('.suggestion-card')!.style.top).toBe('');
});
