// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { editorViewCtx } from '@milkdown/kit/core';
import { TextSelection } from '@milkdown/kit/prose/state';
import type { CommentAnchor } from '@tano/protocol';
import MarkdownEditor from './MarkdownEditor.vue';
import { makeCommentAnchor } from './comment-anchors';

let app: ReturnType<typeof createApp> | undefined;
let root: HTMLDivElement | undefined;
afterEach(async () => {
  app?.unmount();
  root?.remove();
  await nextTick();
});

async function mount(content: string) {
  root = document.createElement('div');
  document.body.append(root);
  const editor = ref<InstanceType<typeof MarkdownEditor>>();
  const anchors = ref<{ id: string; anchor: CommentAnchor }[]>([]);
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  app = createApp(defineComponent(() => () => h(MarkdownEditor, {
    ref: editor, documentId: 'comment-test', modelValue: content, commentAnchors: anchors.value,
  })));
  app.mount(root);
  await vi.waitFor(() => expect(root!.querySelector('.ProseMirror')).not.toBeNull());
  await nextTick();
  return { editor, anchors };
}

it('highlights an entire block, including formatted text, when the composer takes focus', async () => {
  const { editor, anchors } = await mount('普通文字**粗体**和 `/demo`\n换行后的文字\n\n下一段');
  editor.value!.withContext(ctx => {
    const view = ctx.get(editorViewCtx);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
  });
  const selection = editor.value!.commentSelection()!;
  expect(selection.spans.map(span => span.text).join('')).toBe('普通文字粗体和 /demo\ufffc换行后的文字');
  anchors.value = [{ id: '@draft', anchor: makeCommentAnchor('prose', selection.text, selection.spans, 'base') }];
  await nextTick();
  const field = document.createElement('textarea');
  root!.append(field);
  field.focus();
  const paragraph = root!.querySelector('.ProseMirror p')!;
  const marks = [...paragraph.querySelectorAll('.tano-comment-mark')];
  expect(marks.map(mark => mark.textContent).join('')).toBe(paragraph.textContent);
  expect(paragraph.querySelector('strong .tano-comment-mark')).not.toBeNull();
  expect(paragraph.querySelector('code .tano-comment-mark')).not.toBeNull();
  expect(root!.querySelectorAll('.ProseMirror p')[1]!.querySelector('.tano-comment-mark')).toBeNull();
  anchors.value = [{ ...anchors.value[0]!, id: 'saved-thread' }];
  await nextTick();
  expect(paragraph.querySelector('[data-comment-id="saved-thread"]')).not.toBeNull();
  expect(paragraph.querySelector('[data-comment-id="@draft"]')).toBeNull();
});

it('highlights partial selections and inline image atoms without extending to adjacent text', async () => {
  const { editor, anchors } = await mount('Before ![image](test.png) after');
  editor.value!.withContext(ctx => {
    const view = ctx.get(editorViewCtx);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4, 10)));
  });
  const selection = editor.value!.commentSelection()!;
  anchors.value = [{ id: 'partial', anchor: makeCommentAnchor('prose', selection.text, selection.spans, 'base') }];
  await nextTick();
  const marks = [...root!.querySelectorAll('.ProseMirror .tano-comment-mark')];
  expect(marks.filter(mark => !mark.classList.contains('tano-image')).map(mark => mark.textContent).join('')).toBe('ore  ');
  expect(marks.some(mark => mark.querySelector('img'))).toBe(true);
  anchors.value = [];
  await nextTick();
  expect(root!.querySelector('.tano-comment-mark')).toBeNull();
});
