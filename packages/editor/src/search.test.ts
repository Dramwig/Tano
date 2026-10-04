import { expect, it } from 'vitest';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState } from '@milkdown/kit/prose/state';
import { pageSearchKey, pageSearchPlugin, proseSearchRanges, textSearchRanges } from './search';

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'inline*', group: 'block' },
    text: { group: 'inline' },
  },
  marks: { strong: {} },
});
const paragraph = (text: string) => schema.nodes.paragraph!.create(null, schema.text(text));

it('searches literals, Chinese and Unicode without shifting source offsets', () => {
  expect(textSearchRanges('a+b A+B', 'a+b')).toEqual([
    { from: 0, to: 3 },
    { from: 4, to: 7 },
  ]);
  expect(textSearchRanges('同页 同页', '同页', 5)).toEqual([
    { from: 5, to: 7 },
    { from: 8, to: 10 },
  ]);
  expect(textSearchRanges('İ Find 😀find', 'find')).toEqual([
    { from: 2, to: 6 },
    { from: 9, to: 13 },
  ]);
  expect(textSearchRanges('abc', '')).toEqual([]);
  expect(textSearchRanges('abc', 'missing')).toEqual([]);
});

it('finds text spanning formatting without joining unrelated paragraphs', () => {
  const doc = schema.nodes.doc!.create(null, [
    schema.nodes.paragraph!.create(null, [
      schema.text('同'),
      schema.text('页', [schema.marks.strong!.create()]),
    ]),
    paragraph('同'),
    paragraph('页'),
  ]);
  expect(proseSearchRanges(doc, '同页')).toEqual([{ from: 1, to: 3 }]);
});

it('refreshes decorations after document changes without changing the caret', () => {
  let state = EditorState.create({
    schema,
    doc: schema.nodes.doc!.create(null, paragraph('find find')),
    plugins: [pageSearchPlugin()],
  });
  const selection = state.selection;
  state = state.apply(state.tr.setMeta(pageSearchKey, { query: 'find', index: 1 }));
  expect(state.selection.eq(selection)).toBe(true);
  expect(pageSearchKey.getState(state)!.ranges).toHaveLength(2);
  expect(
    pageSearchKey
      .getState(state)!
      .decorations.find()
      .map(({ from, to }) => ({ from, to })),
  ).toEqual([
    { from: 1, to: 5 },
    { from: 6, to: 10 },
  ]);
  state = state.apply(state.tr.insertText(' find', 10));
  expect(pageSearchKey.getState(state)!.ranges).toHaveLength(3);
  state = state.apply(state.tr.setMeta(pageSearchKey, { query: '', index: 0 }));
  expect(pageSearchKey.getState(state)!.decorations.find()).toEqual([]);
});
