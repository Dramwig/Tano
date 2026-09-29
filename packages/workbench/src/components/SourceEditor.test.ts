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
