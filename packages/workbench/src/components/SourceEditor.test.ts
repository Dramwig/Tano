// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import type { App } from 'vue';
import { EditorView } from '@codemirror/view';
import SourceEditor from './SourceEditor.vue';

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
  const changed = vi.fn((next: string) => (value.value = next));
  app = createApp({
    render: () => h(SourceEditor, {
      ref: editor, modelValue: value.value, readonly: false, localNative: false,
      'onUpdate:modelValue': changed,
    }),
  });
  app.mount(root);
  await nextTick();
  return { value, editor, changed, view: EditorView.findFromDOM(root.querySelector('.cm-editor')!)! };
}

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
