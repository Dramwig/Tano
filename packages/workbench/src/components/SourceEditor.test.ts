// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import type { App } from 'vue';
import { EditorView } from '@codemirror/view';
import SourceEditor from './SourceEditor.vue';
import { defaultEditorPreferences, defaultSelectionWrapping } from '@tano/editor/runtime';

let app: App | undefined;
let root: HTMLDivElement;

afterEach(() => {
  app?.unmount();
  root?.remove();
  app = undefined;
});

async function mountSource(content: string) {
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  root = document.createElement('div');
  document.body.append(root);
  const value = ref(content);
  const editor = ref<InstanceType<typeof SourceEditor>>();
  const readonly = ref(false);
  const preferences = ref({ ...defaultEditorPreferences, selectionWrapping: { ...defaultSelectionWrapping } });
  const changed = vi.fn((next: string) => (value.value = next));
  app = createApp({
    render: () => h(SourceEditor, {
      ref: editor, preferences: preferences.value, modelValue: value.value, readonly: readonly.value, localNative: false,
      'onUpdate:modelValue': changed,
    }),
  });
  app.mount(root);
  await nextTick();
  return { value, editor, readonly, preferences, changed, view: EditorView.findFromDOM(root.querySelector('.cm-editor')!)! };
}

it('restores a backward mode selection without changing Markdown or undo history', async () => {
  const { editor, view, value, changed } = await mountSource('第一行\r\n第二行 **文字**\r\n');
  editor.value!.restoreModeSelection({ anchor: 12, head: 5 });
  expect(editor.value!.captureModeSelection()).toEqual({ anchor: 12, head: 5 });
  expect(view.hasFocus).toBe(true);
  expect(value.value).toBe('第一行\r\n第二行 **文字**\r\n');
  expect(changed).not.toHaveBeenCalled();
  expect(editor.value!.canUndo()).toBe(false);
});

it('indents and outdents source with Tab without moving focus to page buttons', async () => {
  const { value, editor, view, readonly } = await mountSource('正文');
  view.focus();
  const pressTab = (shiftKey = false) => {
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
    view.contentDOM.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(view.contentDOM);
  };
  pressTab();
  await nextTick();
  expect(value.value).toBe('  正文');
  expect(editor.value!.undoLastChange()).toBe(true);
  await nextTick();
  expect(value.value).toBe('正文');
  expect(editor.value!.redoLastChange()).toBe(true);
  await nextTick();
  expect(value.value).toBe('  正文');
  pressTab(true);
  await nextTick();
  expect(value.value).toBe('正文');
  readonly.value = true;
  await nextTick();
  pressTab();
  pressTab(true);
  expect(value.value).toBe('正文');
});

it.each([
  ['1231 231231 3123\n', '1231 *231231* 3123\n'],
  ['1231*231231*3123\n', '1231**231231**3123\n'],
  ['1231 231231 3123\n', '1231 $231231$ 3123\n'],
])('wraps a selected source field with Markdown delimiters when typing a delimiter: %s', async (source, expected) => {
  const { value, view } = await mountSource(source);
  view.dispatch({ selection: { anchor: 5, head: 11 } });
  const delimiter = expected.includes('$') ? '$' : '*';
  const event = new KeyboardEvent('keydown', { key: delimiter, bubbles: true, cancelable: true });
  view.contentDOM.dispatchEvent(event);
  await nextTick();
  expect(event.defaultPrevented).toBe(true);
  expect(value.value).toBe(expected);
  expect(view.state.selection.main.from).toBe(6);
  expect(view.state.selection.main.to).toBe(12);
});

it('applies a plugin edit as one undo step and rejects stale or read-only edits', async () => {
  const { value, editor, readonly } = await mountSource('# Before\n');
  editor.value!.applyPluginEdit('# Before\n', '# After\n');
  await nextTick();
  expect(value.value).toBe('# After\n');
  expect(() => editor.value!.applyPluginEdit('# Before\n', '# Lost\n')).toThrow('变化');
  expect(editor.value!.undoLastChange()).toBe(true);
  await nextTick();
  expect(value.value).toBe('# Before\n');
  readonly.value = true;
  await nextTick();
  expect(() => editor.value!.applyPluginEdit('# Before\n', '# Lost\n')).toThrow();
});

it('maps a backward selection through external changes without making them undoable', async () => {
  const { value, editor, changed, view } = await mountSource('前文\n选中文字\n后文');
  view.dispatch({ selection: { anchor: 7, head: 3 } });
  value.value = '新前文\n选中文字\n后文';
  await nextTick();
  expect(view.state.selection.main.anchor).toBe(8);
  expect(view.state.selection.main.head).toBe(4);
  expect(changed).not.toHaveBeenCalled();
  expect(editor.value!.canUndo()).toBe(false);
});

it('highlights and navigates literal matches without changing source, caret or history', async () => {
  const { value, editor, changed, view } = await mountSource('同页 **同页**\nA+B a+b');
  view.dispatch({ selection: { anchor: 2 } });
  expect(editor.value!.search('同页', 1, false)).toBe(2);
  expect(root.querySelectorAll('.tano-search-match')).toHaveLength(2);
  expect(root.querySelector('.tano-search-current')?.textContent).toBe('同页');
  expect(view.state.selection.main.head).toBe(2);
  expect(changed).not.toHaveBeenCalled();
  expect(editor.value!.canUndo()).toBe(false);
  expect(editor.value!.search('a+b', 0, false)).toBe(2);
  value.value += '\nA+B';
  await nextTick();
  expect(root.querySelectorAll('.tano-search-match')).toHaveLength(3);
  editor.value!.search('', 0, false);
  expect(root.querySelector('.tano-search-match')).toBeNull();
});

it('replaces all source matches as one undo step while preserving independent external edits', async () => {
  const source = 'A+B **a+b**\n独立正文';
  const { value, editor, readonly } = await mountSource(source);
  expect(editor.value!.replaceSearch('a+b', '同页', 'all').replaced).toBe(2);
  await nextTick();
  expect(value.value).toBe('同页 **同页**\n独立正文');
  value.value = value.value.replace('独立正文', '外部修改');
  await nextTick();
  expect(editor.value!.undoLastChange()).toBe(true);
  await nextTick();
  expect(value.value).toBe(source.replace('独立正文', '外部修改'));
  expect(editor.value!.redoLastChange()).toBe(true);
  await nextTick();
  expect(value.value).toBe('同页 **同页**\n外部修改');
  readonly.value = true;
  await nextTick();
  expect(editor.value!.replaceSearch('同页', '', 'all').replaced).toBe(0);
  expect(value.value).toBe('同页 **同页**\n外部修改');
});

it('skips new matches in the replacement and allows empty replacement in source mode', async () => {
  const { value, editor } = await mountSource('find find');
  expect(editor.value!.replaceSearch('find', 'find find', 0)).toEqual({ replaced: 1, index: 2 });
  await nextTick();
  expect(editor.value!.replaceSearch('find', '', 2).replaced).toBe(1);
  await nextTick();
  expect(value.value).toBe('find find ');
});
it('appends a Todo reference without replacing the selected text and makes the insertion undoable', async () => {
  const { value, editor, view } = await mountSource('before selected after');
  view.dispatch({ selection: { anchor: 7, head: 15 } });
  const captured = editor.value!.captureTodoSelection()!;
  expect(captured.text).toBe('selected');
  expect(captured.insert({ type: 'event', id: 'b00001' }, 'Task')).toBe(true);
  await nextTick();
  expect(value.value).toBe('before selected [@Task](object://event/b00001) after');
  expect(editor.value!.undoLastChange()).toBe(true);
  await nextTick();
  expect(value.value).toBe('before selected after');
  value.value = 'changed selected after';
  await nextTick();
  expect(captured.insert({ type: 'event', id: 'b00001' }, 'Task')).toBe(false);
});
it('keeps a source-mode reference outside selected fenced code', async () => {
  const { value, editor, view } = await mountSource('```ts\nselected code\n```\n\nafter');
  view.dispatch({ selection: { anchor: 6, head: 19 } });
  expect(editor.value!.captureTodoSelection()!.insert({ type: 'event', id: 'b00001' }, 'Task')).toBe(true);
  await nextTick();
  expect(value.value).toContain('```ts\nselected code\n```\n\n[@Task](object://event/b00001)');
});

it('undoes local typing without reverting an independent external edit', async () => {
  const { value, editor, view } = await mountSource('第一段\n\n第二段');
  view.dispatch({ changes: { from: 3, insert: '本地' } });
  await nextTick();
  value.value = value.value.replace('第二段', '第二段外部');
  await nextTick();
  expect(editor.value!.undoLastChange()).toBe(true);
  await nextTick();
  expect(value.value).toBe('第一段\n\n第二段外部');
  expect(editor.value!.canUndo()).toBe(false);
  expect(editor.value!.redoLastChange()).toBe(true);
  await nextTick();
  expect(value.value).toBe('第一段本地\n\n第二段外部');
});

it('keeps imported attachment insertion undoable without undoing external updates', async () => {
  const { value, editor } = await mountSource('正文');
  expect(editor.value!.insertText('\n![图片](assets/image.png)\n', 2)).toBe(true);
  await nextTick();
  value.value += '\n外部修改';
  await nextTick();
  expect(editor.value!.undoLastChange()).toBe(true);
  await nextTick();
  expect(value.value).toBe('正文\n外部修改');
  expect(editor.value!.canUndo()).toBe(false);
  expect(editor.value!.redoLastChange()).toBe(true);
  await nextTick();
  expect(value.value).toContain('![图片](assets/image.png)');
});

it('treats CRLF model echoes as unchanged without moving the selection', async () => {
  const { value, editor, view } = await mountSource('一行\n二行');
  view.dispatch({ selection: { anchor: 4, head: 3 } });
  value.value = '一行\r\n二行';
  await nextTick();
  expect(view.state.selection.main.anchor).toBe(4);
  expect(view.state.selection.main.head).toBe(3);
  expect(editor.value!.canUndo()).toBe(false);
});

it('shows raw Markdown with bold delimiters and keeps edits in source form', async () => {
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  root = document.createElement('div');
  document.body.append(root);
  const value = ref('**123** and `**literal**`');
  const editor = ref<InstanceType<typeof SourceEditor>>();
  app = createApp({
    render: () =>
      h(SourceEditor, {
        ref: editor,
        modelValue: value.value,
        readonly: false,
        localNative: false,
        'onUpdate:modelValue': (next: string) => (value.value = next),
      }),
  });
  app.mount(root);
  await nextTick();

  const view = EditorView.findFromDOM(root.querySelector('.cm-editor')!);
  expect(view).toBeDefined();
  expect(root.querySelector('.cm-source-strong')?.textContent).toBe('**123**');
  expect(root.querySelector('.cm-source-code')?.textContent).toBe('`**literal**`');
  expect(view!.state.doc.toString()).toBe(value.value);

  view!.dispatch({ changes: { from: 2, to: 5, insert: '456' } });
  await vi.waitFor(() => expect(value.value).toBe('**456** and `**literal**`'));
  expect(root.querySelector('.cm-source-strong')?.textContent).toBe('**456**');
  expect(editor.value!.canUndo()).toBe(true);
  expect(editor.value!.undoLastChange()).toBe(true);
  await vi.waitFor(() => expect(value.value).toBe('**123** and `**literal**`'));
  expect(editor.value!.canRedo()).toBe(true);
  expect(editor.value!.redoLastChange()).toBe(true);
  await vi.waitFor(() => expect(value.value).toBe('**456** and `**literal**`'));
  expect(editor.value!.undoLastChange()).toBe(true);
  await vi.waitFor(() => expect(value.value).toBe('**123** and `**literal**`'));

  value.value = '**789**\n# Title';
  await nextTick();
  expect(view!.state.doc.toString()).toBe(value.value);
  expect(root.querySelector('.cm-source-heading')?.textContent).toBe('# Title');
  expect(root.querySelector('.cm-source-heading-1')?.textContent).toBe('# Title');
  expect(root.querySelector('.cm-source-heading-1-line')?.textContent).toBe('# Title');
  editor.value!.jumpToLine(2);
  expect(view!.state.selection.main.head).toBe(8);

  value.value = '---\ntitle: metadata\n---\n\n# 正文';
  await nextTick();
  const original = value.value;
  const bodyStart = original.indexOf('# 正文');
  editor.value!.insertBlockAtStart();
  await nextTick();
  expect(value.value).toBe(`${original.slice(0, bodyStart)}\n\n# 正文`);
  expect(view!.state.selection.main.head).toBe(bodyStart);
  expect(view!.hasFocus).toBe(true);
  expect(editor.value!.canUndo()).toBe(true);
  expect(editor.value!.undoLastChange()).toBe(true);
  await nextTick();
  expect(value.value).toBe(original);
});

function typeSymbol(view: EditorView, key: string, extra: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra });
  view.contentDOM.dispatchEvent(event);
  return event.defaultPrevented;
}

it.each(['keyboard', 'text input'])('maps full-width yuan in source via %s when enabled', async method => {
  const { value, view, preferences, editor } = await mountSource('x_1');
  view.dispatch({ selection: { anchor: 3, head: 0 } });
  const input = () => method === 'keyboard' ? typeSymbol(view, '￥') :
    view.state.facet(EditorView.inputHandler).some(handler => handler(view, 0, 3, '￥', () => view.state.update({ changes: { from: 0, to: 3, insert: '￥' } })));
  expect(input()).toBe(false);
  preferences.value.selectionWrapping.yenToDollar = true;
  await nextTick();
  expect(input()).toBe(true);
  expect(value.value).toBe('$x_1$');
  expect(view.state.selection.main.anchor).toBe(4);
  expect(view.state.selection.main.head).toBe(1);
  expect(editor.value!.undoLastChange()).toBe(true);
  expect(value.value).toBe('x_1');
});

it.each([['_', '_'], ['~', '~~'], ['=', '=='], ['`', '`']])('wraps source with %s and preserves backward selections and undo', async (key, delimiter) => {
  const { value, view, editor } = await mountSource('前 文字 后');
  view.dispatch({ selection: { anchor: 4, head: 2 } });
  expect(typeSymbol(view, key)).toBe(true);
  expect(value.value).toBe('前 ' + delimiter + '文字' + delimiter + ' 后');
  expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('文字');
  expect(view.state.selection.main.anchor).toBeGreaterThan(view.state.selection.main.head);
  expect(editor.value!.undoLastChange()).toBe(true);
  expect(value.value).toBe('前 文字 后');
});

it('upgrades emphasis and does not nest repeated double markers', async () => {
  const { value, view } = await mountSource('文字');
  view.dispatch({ selection: { anchor: 0, head: 2 } });
  expect(typeSymbol(view, '*')).toBe(true);
  expect(typeSymbol(view, '*')).toBe(true);
  expect(value.value).toBe('**文字**');
  expect(typeSymbol(view, '*')).toBe(true);
  expect(value.value).toBe('**文字**');
});

it('applies preference changes immediately, including extensions and the master switch', async () => {
  const { value, view, preferences } = await mountSource('文字');
  view.dispatch({ selection: { anchor: 0, head: 2 } });
  expect(typeSymbol(view, '^')).toBe(false);
  preferences.value.selectionWrapping.superscript = true;
  await nextTick();
  expect(typeSymbol(view, '^')).toBe(true);
  expect(value.value).toBe('^文字^');
  preferences.value.selectionWrapping.enabled = false;
  await nextTick();
  expect(typeSymbol(view, '*')).toBe(false);
  expect(value.value).toBe('^文字^');
});

it.each([
  ['第一行\n第二行', 0, 6], ['`code`', 1, 5], ['$x+1$', 1, 4],
  ['```js\ncode\n```', 6, 10], ['文字', 1, 1],
])('keeps protected source selections unchanged: %s', async (source, anchor, head) => {
  const { value, view } = await mountSource(source);
  view.dispatch({ selection: { anchor, head } });
  expect(typeSymbol(view, '*')).toBe(false);
  expect(value.value).toBe(source);
});

it('does not intercept composing, modified, or read-only input', async () => {
  const { view, readonly } = await mountSource('文字');
  view.dispatch({ selection: { anchor: 0, head: 2 } });
  for (const extra of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }])
    expect(typeSymbol(view, '*', extra)).toBe(false);
  readonly.value = true;
  await nextTick();
  expect(typeSymbol(view, '*')).toBe(false);
});
