import { afterAll, beforeAll, expect, it } from 'vitest';
import { parserCtx } from '@milkdown/kit/core';
import { EditorState, NodeSelection, Selection, TextSelection } from '@milkdown/kit/prose/state';
import { createHeadlessMarkdown } from './headless';
import { BlockRangeSelection, expandBlockSelection } from './block-selection';
import { blockTree } from './block-tree';
import { selectedBlocks } from './document-model';
import { blockCommand } from './block-commands';

let codec: Awaited<ReturnType<typeof createHeadlessMarkdown>>;
beforeAll(async () => { codec = await createHeadlessMarkdown(); });
afterAll(async () => { await codec.destroy(); });

it('expands from text through each containing block group and stays at the document roots', () => {
  const doc = codec.withContext(ctx => ctx.get(parserCtx)('Before\n\n> Outer\n>\n> > Inner A\n> >\n> > Inner B\n>\n> Tail\n\nAfter')!);
  const tree = blockTree(doc);
  const inner = tree.find(block => block.node.textContent === 'Inner A')!;
  let selection: Selection = TextSelection.create(doc, inner.pos + 3);
  selection = expandBlockSelection(doc, selection)!;
  expect(selection).toBeInstanceOf(TextSelection);
  expect(doc.textBetween(selection.from, selection.to)).toBe('Inner A');
  for (const texts of [['Inner A', 'Inner B'], ['Outer', 'Inner AInner B', 'Tail'], ['Before', 'OuterInner AInner BTail', 'After']]) {
    selection = expandBlockSelection(doc, selection)!;
    expect((selection as BlockRangeSelection).blocks.map(block => block.node.textContent)).toEqual(texts);
  }
  expect(expandBlockSelection(doc, selection)!.eq(selection)).toBe(true);
  const reset = expandBlockSelection(doc, TextSelection.create(doc, inner.pos + 2))!;
  expect(reset).toBeInstanceOf(TextSelection);
  expect(doc.textBetween(reset.from, reset.to)).toBe('Inner A');
});

it.each(['- A\n- B', '| A |\n| --- |\n| B |', '***'])('selects %s as one block before its siblings', markdown => {
  const doc = codec.withContext(ctx => ctx.get(parserCtx)(`${markdown}\n\nAfter`)!);
  const first = doc.firstChild!;
  const initial = first.isLeaf ? NodeSelection.create(doc, 0) : TextSelection.near(doc.resolve(1));
  const selected = expandBlockSelection(doc, initial)! as BlockRangeSelection;
  expect(selected.blocks).toHaveLength(first.isLeaf ? 2 : 1);
  expect((expandBlockSelection(doc, selected) as BlockRangeSelection).blocks).toHaveLength(2);
});

it('handles empty blocks, single-child containers and backwards text selections without getting stuck', () => {
  const doc = codec.withContext(ctx => ctx.get(parserCtx)('> > Only\n\nAfter')!);
  const inner = blockTree(doc).find(block => block.node.textContent === 'Only' && block.node.isTextblock)!;
  let selection: Selection = TextSelection.create(doc, inner.pos + 5, inner.pos + 1);
  for (let i = 0; i < 3; i++) selection = expandBlockSelection(doc, selection)!;
  expect((selection as BlockRangeSelection).blocks.map(block => block.parentPos)).toEqual([-1, -1]);
  const emptyDoc = doc.type.create(null, [doc.type.schema.nodes.paragraph!.create(), doc.lastChild!]);
  selection = expandBlockSelection(emptyDoc, TextSelection.create(emptyDoc, 1))!;
  expect((selection as BlockRangeSelection).blocks).toHaveLength(1);
  expect((expandBlockSelection(emptyDoc, selection) as BlockRangeSelection).blocks).toHaveLength(2);
});

it.each(['columns', 'tabs'])('skips structural %s panels while growing out of their content', kind => {
  const doc = codec.withContext(ctx => ctx.get(parserCtx)(`:::${kind}\n\n## One\n\nA\n\nB\n\n## Two\n\nC\n\n:::\n\nOutside`)!);
  const a = blockTree(doc).find(block => block.node.textContent === 'A')!;
  let selection: Selection = TextSelection.create(doc, a.pos + 1);
  selection = expandBlockSelection(doc, selection)!;
  selection = expandBlockSelection(doc, selection)!;
  expect((selection as BlockRangeSelection).blocks.map(block => block.node.textContent)).toEqual(['A', 'B']);
  selection = expandBlockSelection(doc, selection)!;
  expect((selection as BlockRangeSelection).blocks.map(block => block.node.type.name)).toEqual([`tano_${kind}`, 'paragraph']);
});

it('fills disjoint sibling selections and excludes callout metadata from body groups', () => {
  const doc = codec.withContext(ctx => ctx.get(parserCtx)('> [!NOTE]\n>\n> A\n>\n> B\n>\n> C\n\nOutside')!);
  const children = blockTree(doc).filter(block => block.parentPos === 0);
  expect(children.map(block => block.node.textContent)).toEqual(['A', 'B', 'C']);
  const selection = BlockRangeSelection.fromBlocks(doc, [children[0]!.pos, children[2]!.pos])!;
  expect((expandBlockSelection(doc, selection) as BlockRangeSelection).blocks.map(block => block.node.textContent)).toEqual(['A', 'B', 'C']);
});

it('selects only sibling roots, round-trips backward selection and maps it through edits', () => {
  const doc = codec.withContext(ctx => ctx.get(parserCtx)('Before\n\n> A\n>\n> B\n\nAfter')!);
  let state = EditorState.create({ doc });
  const entries = blockTree(doc);
  const a = entries.find(entry => entry.node.textContent === 'A')!;
  const after = entries.find(entry => entry.node.textContent === 'After')!;
  const selection = BlockRangeSelection.betweenBlocks(doc, after.pos, a.pos)!;
  expect(selection.blocks.map(entry => entry.node.type.name)).toEqual(['blockquote', 'paragraph']);
  expect(selection.anchor).toBeGreaterThan(selection.head);
  expect(Selection.fromJSON(doc, selection.toJSON()).eq(selection)).toBe(true);
  state = state.apply(state.tr.setSelection(selection));
  const tr = state.tr.insertText('New ', 1);
  state = state.apply(tr);
  expect(state.selection).toBeInstanceOf(BlockRangeSelection);
  expect((state.selection as BlockRangeSelection).blocks.map(entry => entry.node.textContent)).toEqual(['AB', 'After']);
  expect(selection.getBookmark().map(tr.mapping).resolve(state.doc).eq(state.selection)).toBe(true);
  const removed = state.tr.delete(state.selection.from, state.selection.to);
  state = state.apply(removed);
  expect(state.selection).not.toBeInstanceOf(BlockRangeSelection);
  state.doc.check();
});

it('toggles individual blocks without filling gaps, preserves the range anchor, and clears the last block', () => {
  const doc = codec.withContext(ctx => ctx.get(parserCtx)('A\n\nB\n\nC\n\nD')!);
  const [a, b, c, d] = blockTree(doc).map(block => block.pos) as [number, number, number, number];
  const range = BlockRangeSelection.betweenBlocks(doc, a, c)!;
  const holes = BlockRangeSelection.toggleBlock(doc, range.blocks.map(block => block.pos), b, range.anchorBlock)!;
  expect(holes.blocks.map(block => block.pos)).toEqual([a, c]);
  expect(holes.eq(range)).toBe(false);
  expect(holes.anchorBlock).toBe(a);
  expect(Selection.fromJSON(doc, holes.toJSON()).eq(holes)).toBe(true);
  const restored = BlockRangeSelection.toggleBlock(doc, [a, c], b, a)!;
  expect(restored.blocks.map(block => block.pos)).toEqual([a, b, c]);
  expect(BlockRangeSelection.betweenBlocks(doc, restored.anchorBlock, d)!.blocks).toHaveLength(4);
  expect(BlockRangeSelection.toggleBlock(doc, [a], a)).toBeNull();
});

it('copies, deletes, replaces and maps only explicitly selected blocks', () => {
  const doc = codec.withContext(ctx => ctx.get(parserCtx)('A\n\nKeep\n\nC\n\nEnd')!);
  const [a, keep, c] = blockTree(doc);
  const selection = BlockRangeSelection.fromBlocks(doc, [a!.pos, c!.pos])!;
  const state = EditorState.create({ doc, selection });
  expect(selection.content().content.content.map(node => node.textContent)).toEqual(['A', 'C']);
  expect(selectedBlocks(state).map(block => block.node.textContent)).toEqual(['A', 'C']);
  expect(state.tr.deleteSelection().doc.content.content.map(node => node.textContent)).toEqual(['Keep', 'End']);
  const replacement = state.tr.insertText('Replacement');
  expect(replacement.doc.content.content.map(node => node.textContent)).toEqual(['Replacement', 'Keep', 'End']);
  const inserted = state.tr.insertText('new ', keep!.pos + 1);
  const mapped = selection.getBookmark().map(inserted.mapping).resolve(inserted.doc) as BlockRangeSelection;
  expect(mapped.blocks.map(block => block.node.textContent)).toEqual(['A', 'C']);
  const removed = state.tr.delete(a!.pos, a!.pos + a!.node.nodeSize);
  expect((removed.selection as BlockRangeSelection).blocks.map(block => block.node.textContent)).toEqual(['C']);
  replacement.doc.check();
});

it('never selects both an ancestor and its descendant', () => {
  const doc = codec.withContext(ctx => ctx.get(parserCtx)('> A\n>\n> B\n\nC')!);
  const [quote, a, , c] = blockTree(doc);
  expect(BlockRangeSelection.fromBlocks(doc, [quote!.pos, a!.pos, c!.pos])!.blocks.map(block => block.pos)).toEqual([quote!.pos, c!.pos]);
  expect(BlockRangeSelection.toggleBlock(doc, [quote!.pos, c!.pos], a!.pos)!.blocks.map(block => block.pos)).toEqual([a!.pos, c!.pos]);
  expect(BlockRangeSelection.toggleBlock(doc, [a!.pos, c!.pos], quote!.pos)!.blocks.map(block => block.pos)).toEqual([quote!.pos, c!.pos]);
});

it('converts disjoint selected groups without replacing the blocks in between', () => {
  const doc = codec.withContext(ctx => ctx.get(parserCtx)('A\n\nKeep\n\nC')!);
  const [a, , c] = blockTree(doc);
  let state = EditorState.create({ doc, selection: BlockRangeSelection.fromBlocks(doc, [a!.pos, c!.pos])! });
  expect(blockCommand('heading', '2')(state, tr => { state = state.apply(tr); })).toBe(true);
  expect(state.doc.content.content.map(node => [node.type.name, node.textContent])).toEqual([
    ['heading', 'A'], ['paragraph', 'Keep'], ['heading', 'C'],
  ]);
  state.doc.check();
});

it('insertion commands append once after the last selected block', () => {
  const doc = codec.withContext(ctx => ctx.get(parserCtx)('A\n\nKeep\n\nC')!);
  const [a, , c] = blockTree(doc);
  let state = EditorState.create({ doc, selection: BlockRangeSelection.fromBlocks(doc, [a!.pos, c!.pos])! });
  expect(blockCommand('horizontal-rule')(state, tr => { state = state.apply(tr); })).toBe(true);
  expect(state.doc.content.content.map(node => node.type.name)).toEqual(['paragraph', 'paragraph', 'paragraph', 'hr']);
  expect(state.doc.textContent).toBe('AKeepC');
});
