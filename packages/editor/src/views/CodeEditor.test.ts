// SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref, type App } from 'vue';
import { EditorView } from '@codemirror/view';
import CodeEditor from './CodeEditor.vue';

let app: App | undefined;
let root: HTMLDivElement;

afterEach(() => {
  app?.unmount();
  root?.remove();
  app = undefined;
});

async function mountCode(content: string, path = 'src/app.ts') {
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  root = document.createElement('div');
  document.body.append(root);
  const value = ref(content);
  const filePath = ref(path);
  const readonly = ref(false);
  const wordWrap = ref(false);
  const editor = ref<InstanceType<typeof CodeEditor>>();
  const changed = vi.fn((next: string) => {
    value.value = next;
  });
  app = createApp({
    render: () =>
      h(CodeEditor, {
        ref: editor,
        modelValue: value.value,
        path: filePath.value,
        readonly: readonly.value,
        wordWrap: wordWrap.value,
        'onUpdate:modelValue': changed,
      }),
  });
  app.mount(root);
  await nextTick();
  const view = EditorView.findFromDOM(root.querySelector('.cm-editor')!)!;
  return { value, filePath, readonly, wordWrap, editor, changed, view };
}

describe('CodeEditor', () => {
  it('renders syntax highlights, emits edits, and supports undo/redo', async () => {
    const { value, editor, changed, view } = await mountCode('export const count = 1;\n', 'src/app.ts');
    expect(root.querySelector('.token.keyword')).not.toBeNull();
    expect(editor.value?.canUndo()).toBe(false);

    view.dispatch({ changes: { from: 21, to: 22, insert: '42' } });
    await nextTick();
    expect(changed).toHaveBeenCalledWith('export const count = 42;\n');
    expect(value.value).toBe('export const count = 42;\n');
    expect(editor.value?.canUndo()).toBe(true);

    expect(editor.value?.undoLastChange()).toBe(true);
    await nextTick();
    expect(value.value).toBe('export const count = 1;\n');
    expect(editor.value?.canRedo()).toBe(true);

    expect(editor.value?.redoLastChange()).toBe(true);
    await nextTick();
    expect(value.value).toBe('export const count = 42;\n');
  });

  it('supports search and replace and respects readonly mode', async () => {
    const { value, readonly, editor } = await mountCode('alpha beta alpha\n', 'notes.txt');
    expect(editor.value?.search('alpha', 0, false)).toBe(2);
    expect(root.querySelectorAll('.tano-search-match').length).toBe(2);

    const replaced = editor.value?.replaceSearch('alpha', 'gamma', 'all');
    await nextTick();
    expect(replaced?.replaced).toBe(2);
    expect(value.value).toBe('gamma beta gamma\n');

    readonly.value = true;
    await nextTick();
    expect(editor.value?.replaceSearch('gamma', 'delta', 'all').replaced).toBe(0);
    expect(value.value).toBe('gamma beta gamma\n');
  });
});
