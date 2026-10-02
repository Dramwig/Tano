import { afterAll, beforeAll, expect, it } from 'vitest';
import { parserCtx, serializerCtx } from '@milkdown/kit/core';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { history, undo } from '@milkdown/kit/prose/history';
import { createHeadlessMarkdown } from './headless';
import {
  blockTree,
  indentBlock,
  moveBlockTo,
  moveBlockSibling,
  outdentBlock,
  wrapBlockInToggle,
} from './block-tree';
import { blockCommand } from './block-commands';

let codec: Awaited<ReturnType<typeof createHeadlessMarkdown>>;
beforeAll(async () => {
  codec = await createHeadlessMarkdown();
});
afterAll(async () => {
  await codec.destroy();
});
const toggle = (title: string, body: string) =>
  `<details>\n<summary>${title}</summary>\n\n${body}\n\n</details>`;
function stateFor(source: string) {
  return codec.withContext((ctx) =>
    EditorState.create({ doc: ctx.get(parserCtx)(source)!, plugins: [history()] }),
  );
}
function roundtrip(state: EditorState) {
  codec.withContext((ctx) => {
    state.doc.check();
    const saved = ctx.get(serializerCtx)(state.doc);
    expect(ctx.get(parserCtx)(saved)!.toJSON()).toEqual(state.doc.toJSON());
  });
}

it('round-trips a recursive toggle tree with heterogeneous children through the shared headless codec', () => {
  let body = 'text\n\n## Heading\n\n- item\n\n```ts\nconst x = 1;\n```';
  for (let i = 0; i < 12; i++) body = toggle(`level ${i}`, body);
  const state = stateFor(body);
  expect(blockTree(state.doc).filter(({ node }) => node.type.name === 'tano_toggle')).toHaveLength(
    12,
  );
  roundtrip(state);
});

it('moves a subtree between parents in one undo step and rejects cycles', () => {
  let state = stateFor(`${toggle('one', toggle('nested', 'child'))}\n\n${toggle('two', 'other')}`);
  const before = state.doc;
  const entries = blockTree(before);
  const nested = entries.find(({ node }) => node.attrs.title === 'nested')!;
  const two = entries.find(({ node }) => node.attrs.title === 'two')!;
  expect(moveBlockTo(state, 0, nested.pos, 0)).toBeNull();
  state = state.apply(moveBlockTo(state, nested.pos, two.pos, 1)!);
  expect(state.doc.child(0).firstChild?.type.name).toBe('paragraph');
  expect(state.doc.child(1).lastChild?.attrs.title).toBe('nested');
  roundtrip(state);
  undo(state, (tr) => {
    state = state.apply(tr);
  });
  expect(state.doc.eq(before)).toBe(true);
});

it('reorders nested siblings and indents/outdents without moving their parent', () => {
  let state = stateFor(toggle('outer', `${toggle('inner', 'a')}\n\nb\n\nc`));
  const b = blockTree(state.doc).find(({ node }) => node.textContent === 'b')!;
  state = state.apply(indentBlock(state, b.pos)!);
  expect(state.doc.firstChild?.firstChild?.childCount).toBe(2);
  let moved = blockTree(state.doc).find(({ node }) => node.textContent === 'b')!;
  state = state.apply(moveBlockSibling(state, moved.pos, -1)!);
  expect(state.doc.firstChild?.firstChild?.firstChild?.textContent).toBe('b');
  moved = blockTree(state.doc).find(({ node }) => node.textContent === 'b')!;
  state = state.apply(outdentBlock(state, moved.pos)!);
  expect(state.doc.firstChild?.child(1).textContent).toBe('b');
  roundtrip(state);
});

it('inserts another toggle at the nested caret and preserves unrelated siblings', () => {
  let state = stateFor(toggle('outer', 'first\n\nsecond'));
  const first = blockTree(state.doc).find(({ node }) => node.textContent === 'first')!;
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, first.pos + 1)));
  expect(
    blockCommand('toggle')(state, (tr) => {
      state = state.apply(tr);
    }),
  ).toBe(true);
  expect(state.doc.childCount).toBe(1);
  expect(state.doc.firstChild?.child(1).type.name).toBe('tano_toggle');
  expect(state.doc.firstChild?.lastChild?.textContent).toBe('second');
  roundtrip(state);
});

it('lifts a panel child after its owning tabs and keeps the panel valid', () => {
  let state = stateFor(toggle('outer', ':::tabs\n\n## One\n\nfirst\n\n## Two\n\nsecond\n\n:::'));
  const first = blockTree(state.doc).find(
    ({ node }) => node.type.name === 'paragraph' && node.textContent === 'first',
  )!;
  state = state.apply(outdentBlock(state, first.pos)!);
  expect(state.doc.firstChild?.child(1).textContent).toBe('first');
  expect(state.doc.firstChild?.firstChild?.firstChild?.firstChild?.textContent).toBe('');
  roundtrip(state);
});

it('wraps a complete subtree in a toggle without flattening it', () => {
  let state = stateFor(toggle('original', 'text\n\n| A | B |\n| --- | --- |\n| a | b |'));
  const original = state.doc.firstChild!;
  state = state.apply(wrapBlockInToggle(state, 0)!);
  expect(state.doc.firstChild?.firstChild?.eq(original)).toBe(true);
  roundtrip(state);
});
