import { afterAll, beforeAll, expect, it } from 'vitest';
import { parserCtx, serializerCtx } from '@milkdown/kit/core';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { history, undo } from '@milkdown/kit/prose/history';
import { createHeadlessMarkdown } from './headless';
import {
  blockTree,
  indentBlock,
  moveBlockTo,
  moveBlocksTo,
  moveBlockBeside,
  deleteBlock,
  moveBlockSibling,
  outdentBlock,
  wrapBlockInToggle,
} from './block-tree';
import { blockCommand } from './block-commands';
import { selectedBlocks } from './document-model';
import { unsupportedMarkdown } from './syntax';

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

function paragraph(state: EditorState, text: string) {
  return blockTree(state.doc).find(entry => entry.node.type.name === 'paragraph' && entry.node.textContent === text)!;
}

it.each([0, 5])('moves heterogeneous sibling blocks together to index %s in one undo step', index => {
  let state = stateFor(`Before\n\n## Heading\n\n${toggle('Details', 'Nested')}\n\n- item\n\nAfter`);
  const original = state.doc;
  const sources = blockTree(original).filter(entry => entry.parentPos === -1 && entry.index >= 1 && entry.index <= 3);
  state = state.apply(moveBlocksTo(state, sources.map(entry => entry.pos), -1, index)!);
  const nodes = state.doc.content.content;
  const offset = index === 0 ? 0 : 2;
  sources.forEach((source, i) => expect(nodes[offset + i]!.eq(source.node)).toBe(true));
  expect(nodes.filter(node => node.type.name === 'paragraph').map(node => node.textContent)).toEqual(['Before', 'After']);
  roundtrip(state);
  expect(undo(state, tr => { state = state.apply(tr); })).toBe(true);
  expect(state.doc.eq(original)).toBe(true);
});

it('moves all children between containers while retaining the empty source and rejects invalid groups and self drops', () => {
  let state = stateFor(`${toggle('Source', 'A\n\nB')}\n\n${toggle('Target', 'C')}`);
  const a = paragraph(state, 'A'), b = paragraph(state, 'B'), c = paragraph(state, 'C');
  const source = blockTree(state.doc).find(entry => entry.node.attrs.title === 'Source')!;
  const target = blockTree(state.doc).find(entry => entry.node.attrs.title === 'Target')!;
  expect(moveBlocksTo(state, [source.pos, target.pos], source.pos, 0)).toBeNull();
  expect(moveBlocksTo(state, [source.pos, a.pos], -1, 0)).toBeNull();
  expect(moveBlocksTo(state, [a.pos, a.pos], -1, 0)).toBeNull();
  expect(moveBlocksTo(state, [a.pos, b.pos], source.pos, 1)).toBeNull();
  state = state.apply(moveBlocksTo(state, [a.pos, b.pos], target.pos, 1)!);
  expect(state.doc.firstChild?.firstChild?.textContent).toBe('');
  expect(state.doc.lastChild?.content.content.map(node => node.textContent)).toEqual(['C', 'A', 'B']);
  roundtrip(state);
});

it.each([0, 2, 5])('moves nonadjacent blocks to index %s without moving the gaps and undoes atomically', index => {
  let state = stateFor('Before\n\nA\n\nKeep\n\nC\n\nEnd');
  const original = state.doc;
  state = state.apply(moveBlocksTo(state, [paragraph(state, 'C').pos, paragraph(state, 'A').pos], -1, index)!);
  expect(state.doc.content.content.map(node => node.textContent)).toEqual(index === 0
    ? ['A', 'C', 'Before', 'Keep', 'End'] : index === 2
      ? ['Before', 'A', 'C', 'Keep', 'End'] : ['Before', 'Keep', 'End', 'A', 'C']);
  roundtrip(state);
  undo(state, tr => { state = state.apply(tr); });
  expect(state.doc.eq(original)).toBe(true);
});

it('moves nonadjacent roots across containers and cleans up multiple emptied columns', () => {
  let state = stateFor(':::columns widths=20,30,50\n\n## One\n\nA\n\n## Two\n\nB\n\n## Three\n\nC\n\n:::\n\n> D\n\nOutside');
  const original = state.doc;
  state = state.apply(moveBlocksTo(state, ['A', 'C', 'D'].map(text => paragraph(state, text).pos), -1, 3)!);
  expect(state.doc.content.content.map(node => node.textContent)).toEqual(['B', '', 'Outside', 'A', 'C', 'D']);
  roundtrip(state);
  undo(state, tr => { state = state.apply(tr); });
  expect(state.doc.eq(original)).toBe(true);
});

it('moves an entire column body out as a group and safely collapses the remaining column', () => {
  let state = stateFor(':::columns\n\n## One\n\nA\n\nB\n\n## Two\n\nC\n\n:::\n\nOutside');
  const original = state.doc;
  state = state.apply(moveBlocksTo(state, [paragraph(state, 'A').pos, paragraph(state, 'B').pos], -1, 2)!);
  expect(state.doc.content.content.map(node => node.textContent)).toEqual(['C', 'Outside', 'A', 'B']);
  roundtrip(state);
  undo(state, tr => { state = state.apply(tr); });
  expect(state.doc.eq(original)).toBe(true);
});

it.each(['left', 'right'] as const)('creates columns by moving a complete subtree to the %s of another block', side => {
  let state = stateFor(`Before\n\n${toggle('Moved', 'Nested body')}\n\nTarget\n\nAfter`);
  const before = state.doc;
  const source = blockTree(state.doc).find(entry => entry.node.type.name === 'tano_toggle')!;
  state = state.apply(moveBlockBeside(state, source.pos, paragraph(state, 'Target').pos, side)!);
  const columns = state.doc.child(1);
  expect(columns.type.name).toBe('tano_columns');
  expect(columns.childCount).toBe(2);
  expect(columns.child(side === 'left' ? 0 : 1).firstChild?.eq(source.node)).toBe(true);
  expect(state.doc.firstChild?.textContent).toBe('Before');
  expect(state.doc.lastChild?.textContent).toBe('After');
  roundtrip(state);
  undo(state, tr => { state = state.apply(tr); });
  expect(state.doc.eq(before)).toBe(true);
});

it('adds a column beside an existing slot and splits only that slot’s saved width', () => {
  let state = stateFor(':::columns widths=20,30,50\n\n## One\n\nA\n\n## Two\n\nB\n\n## Three\n\nC\n\n:::\n\nMoved');
  state = state.apply(moveBlockBeside(state, paragraph(state, 'Moved').pos, paragraph(state, 'C').pos, 'left')!);
  expect(state.doc.firstChild?.childCount).toBe(4);
  expect(state.doc.firstChild?.attrs.widths).toBe('20,30,25,25');
  expect(state.doc.firstChild?.child(2).textContent).toBe('Moved');
  roundtrip(state);
});

it('drops beside blocks inside nested containers without flattening their parent or creating cycles', () => {
  let state = stateFor(`${toggle('Parent', 'Target\n\nSibling')}\n\nMoved`);
  expect(moveBlockBeside(state, 0, paragraph(state, 'Target').pos, 'left')).toBeNull();
  expect(moveBlockBeside(state, paragraph(state, 'Target').pos, 0, 'right')).toBeNull();
  state = state.apply(moveBlockBeside(state, paragraph(state, 'Moved').pos, paragraph(state, 'Target').pos, 'right')!);
  expect(state.doc.firstChild?.firstChild?.type.name).toBe('tano_columns');
  expect(state.doc.firstChild?.lastChild?.textContent).toBe('Sibling');
  roundtrip(state);
});

it('removes an emptied column, preserves the other ratios, and restores the whole row on undo', () => {
  let state = stateFor(':::columns widths=20,30,50\n\n## One\n\nA\n\n## Two\n\nB\n\n## Three\n\nC\n\n:::\n\nOutside');
  const before = state.doc;
  state = state.apply(moveBlockTo(state, paragraph(state, 'A').pos, -1, 2)!);
  expect(state.doc.firstChild?.childCount).toBe(2);
  expect(state.doc.firstChild?.attrs.widths).toBe('37.5,62.5');
  expect(state.doc.lastChild?.textContent).toBe('A');
  roundtrip(state);
  undo(state, tr => { state = state.apply(tr); });
  expect(state.doc.eq(before)).toBe(true);
});

it('unwraps a remaining column when its last sibling block leaves, preserving every remaining block', () => {
  let state = stateFor(':::columns\n\n## One\n\nA\n\n## Two\n\nB\n\nC\n\n:::\n\nOutside');
  state = state.apply(moveBlockTo(state, paragraph(state, 'A').pos, -1, 2)!);
  expect(state.doc.content.content.map(node => node.textContent)).toEqual(['B', 'C', 'Outside', 'A']);
  expect(state.doc.lastChild?.type.name).toBe('paragraph');
  roundtrip(state);
});

it('moves a last column block into its sibling and unwraps the row after insertion', () => {
  let state = stateFor(':::columns\n\n## One\n\nA\n\n## Two\n\nB\n\n:::');
  const target = paragraph(state, 'B');
  state = state.apply(moveBlockTo(state, paragraph(state, 'A').pos, target.parentPos, 1)!);
  expect(state.doc.content.content.map(node => node.textContent)).toEqual(['B', 'A']);
  expect(state.selection.from).toBe(paragraph(state, 'A').pos);
  roundtrip(state);
});

it('cleans up editable blank lines left behind when the last content block leaves a column', () => {
  let state = stateFor(':::columns\n\n## One\n\nA\n\n## Two\n\nB\n\n:::\n\nOutside');
  const source = paragraph(state, 'A');
  state = state.apply(state.tr.insert(source.pos + source.node.nodeSize, state.schema.nodes.paragraph!.create()));
  state = state.apply(moveBlockTo(state, paragraph(state, 'A').pos, -1, 2)!);
  expect(state.doc.content.content.map(node => node.textContent)).toEqual(['B', 'Outside', 'A']);
  roundtrip(state);
});

it('reorders column slots by side drop without leaving a placeholder or nested wrapper', () => {
  let state = stateFor(':::columns widths=40,60\n\n## One\n\nA\n\n## Two\n\nB\n\n:::');
  state = state.apply(moveBlockBeside(state, paragraph(state, 'A').pos, paragraph(state, 'B').pos, 'right')!);
  expect(state.doc.childCount).toBe(1);
  expect(state.doc.firstChild?.childCount).toBe(2);
  expect(state.doc.firstChild?.child(0).textContent).toBe('B');
  expect(state.doc.firstChild?.child(1).textContent).toBe('A');
  expect(state.doc.firstChild?.attrs.widths).toBe('50,50');
  roundtrip(state);
});

it('deletes empty column slots and cleans up nested single-column owners', () => {
  let state = stateFor('::::columns\n\n:::panel "One"\n\n:::columns\n\n## Inner\n\nA\n\n:::\n\n:::\n\n:::panel "Two"\n\nB\n\n:::\n\n::::');
  state = state.apply(deleteBlock(state, paragraph(state, 'A').pos)!);
  expect(state.doc.childCount).toBe(1);
  expect(state.doc.firstChild?.type.name).toBe('paragraph');
  expect(state.doc.firstChild?.textContent).toBe('B');
  roundtrip(state);
});

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

const quoted = (body: string) => body.split('\n').map((line) => `> ${line}`).join('\n');

it.each(['', '[!TIP]\n', '[!CUSTOM:🚀]\n'])('exposes heterogeneous quote children without exposing the callout header: %s', (marker) => {
  const state = stateFor(quoted(`${marker}First\n\n## Heading\n\n- item\n\n> Nested\n\n| A |\n| --- |\n| B |\n\n\`\`\`ts\nconst x = 1;\n\`\`\``));
  const entries = blockTree(state.doc);
  expect(entries.map(({ node }) => node.type.name)).toEqual([
    'blockquote', 'paragraph', 'heading', 'bullet_list', 'blockquote', 'paragraph', 'table', 'code_block',
  ]);
  expect(entries.map(({ depth }) => depth)).toEqual([0, 1, 1, 1, 1, 2, 1, 1]);
  const first = entries[1]!;
  const selected = state.apply(state.tr.setSelection(TextSelection.create(state.doc, first.pos + 1)));
  expect(selectedBlocks(selected).map(({ node }) => node.textContent)).toEqual(['First']);
  roundtrip(state);
});

it.each(['', '[!WARNING]\n\n'])('moves a quote child across containers, keeps an editable body, and undoes atomically: %s', (marker) => {
  let state = stateFor(`${quoted(`${marker}Only child`)}\n\n${toggle('Target', 'Other')}`);
  const before = state.doc;
  const entries = blockTree(before);
  const child = entries.find(({ node }) => node.textContent === 'Only child' && node.type.name === 'paragraph')!;
  const target = entries.find(({ node }) => node.type.name === 'tano_toggle')!;
  state = state.apply(moveBlockTo(state, child.pos, target.pos, 1)!);
  expect(state.doc.firstChild?.lastChild?.textContent).toBe('');
  expect(state.doc.lastChild?.lastChild?.textContent).toBe('Only child');
  if (marker) expect(state.doc.firstChild?.firstChild?.textContent).toBe('[!WARNING]');
  roundtrip(state);
  undo(state, tr => { state = state.apply(tr); });
  expect(state.doc.eq(before)).toBe(true);
});

it('keeps callout metadata first when reordering, indenting, and outdenting nested blocks', () => {
  let state = stateFor(`${quoted('[!NOTE]\n\n> Nested\n\nSibling')}\n\nOutside`);
  const child = () => blockTree(state.doc).find(({ node }) => node.type.name === 'paragraph' && node.textContent === 'Sibling')!;
  expect(moveBlockTo(state, child().pos, 0, 0)).toBeNull();
  state = state.apply(moveBlockSibling(state, child().pos, -1)!);
  expect(state.doc.firstChild?.firstChild?.textContent).toBe('[!NOTE]');
  expect(moveBlockSibling(state, child().pos, -1)).toBeNull();
  expect(indentBlock(state, child().pos)).toBeNull();
  state = state.apply(moveBlockSibling(state, child().pos, 1)!);
  state = state.apply(indentBlock(state, child().pos)!);
  expect(child().depth).toBe(2);
  state = state.apply(outdentBlock(state, child().pos)!);
  expect(child().depth).toBe(1);
  state = state.apply(outdentBlock(state, child().pos)!);
  expect(child().depth).toBe(0);
  roundtrip(state);
});

it.each(['quote', 'callout'])('wraps a table without flattening it using %s', (command) => {
  let state = stateFor('| A | B |\n| --- | --- |\n| a | b |');
  const table = state.doc.firstChild!;
  expect(blockCommand(command)(state, tr => { state = state.apply(tr); })).toBe(true);
  expect(state.doc.firstChild?.lastChild?.eq(table)).toBe(true);
  roundtrip(state);
});

it('round-trips enhanced blocks nested in quotes and callouts, including deep nesting and document references', () => {
  const inside = `${toggle('Details', 'Text\n\n[Link][target]')}\n\n:::columns\n\n## One\n\nFirst\n\n## Two\n\nSecond\n\n:::`;
  const source = `${quoted(`[!IMPORTANT]\n\n${quoted(`[!TIP]\n\n${inside}`)}`)}\n\n[target]: https://example.com`;
  expect(unsupportedMarkdown(source)).toEqual([]);
  const state = stateFor(codec.normalize(source));
  expect(blockTree(state.doc).filter(({ node }) => node.type.name === 'tano_toggle')).toHaveLength(1);
  expect(blockTree(state.doc).filter(({ node }) => node.type.name === 'tano_columns')).toHaveLength(1);
  const link = blockTree(state.doc).find(({ node }) => node.type.name === 'paragraph' && node.textContent === 'Link')!.node.firstChild!;
  expect(link.marks[0]?.attrs.href).toBe('https://example.com');
  roundtrip(state);
});

it.each(['quote', 'callout', 'table', 'toggle'])('creates %s at a callout body caret without replacing its container or siblings', (command) => {
  let state = stateFor(quoted('[!TIP]\nBody\n\nSibling'));
  const body = blockTree(state.doc).find(({ node }) => node.textContent === 'Body')!;
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, body.pos + 1)));
  expect(blockCommand(command)(state, tr => { state = state.apply(tr); })).toBe(true);
  expect(state.doc.childCount).toBe(1);
  expect(state.doc.firstChild?.firstChild?.textContent).toBe('[!TIP]');
  expect(state.doc.firstChild?.lastChild?.textContent).toBe('Sibling');
  roundtrip(state);
});
