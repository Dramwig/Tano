// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { Editor, rootCtx, defaultValueCtx, editorViewCtx, serializerCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import type { EditorView } from '@milkdown/kit/prose/view';
import { wikiLink, wikiLinkInput, wikiLinkRemark } from './wiki-link';

let editor: Editor | undefined;
let root: HTMLDivElement;
afterEach(async () => {
  await editor?.destroy();
  editor = undefined;
  root?.remove();
});

function type(view: EditorView, text: string) {
  for (const character of text) {
    const { from, to } = view.state.selection;
    const handled = view.someProp('handleTextInput', (handler) =>
      handler(view, from, to, character, () => view.state.tr.insertText(character, from, to)),
    );
    if (!handled) view.dispatch(view.state.tr.insertText(character, from, to));
  }
}

it('turns a typed forward wiki link into a link without changing its Markdown', async () => {
  root = document.createElement('div');
  document.body.append(root);
  editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, '');
    })
    .use(commonmark)
    .use(wikiLinkRemark)
    .use(wikiLink)
    .use(wikiLinkInput)
    .create();
  const view = editor.action((ctx) => ctx.get(editorViewCtx));
  type(view, 'See [[Notes/Plan|计划]]');
  expect(root.querySelector('a[data-tano-wiki-target="Notes/Plan"]')?.textContent).toBe('计划');
  expect(editor.action((ctx) => ctx.get(serializerCtx)(view.state.doc))).toBe(
    'See [[Notes/Plan|计划]]\n',
  );
});
