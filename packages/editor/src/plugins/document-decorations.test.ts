import { expect, it, vi } from 'vitest';
import { Schema, type Node } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { cacheDecorationChildren, createDocumentDecorations } from './document-decorations';

const schema = new Schema({ nodes: { doc: { content: 'block+' },
  paragraph: { content: 'text*', group: 'block', attrs: { layout: { default: null } } },
  quote: { content: 'block+', group: 'block' }, text: { group: 'inline' } } });
const p = (text: string) => schema.node('paragraph', null, schema.text(text));
function builder(state: EditorState, revision = 'a') {
  return (node: Node, pos: number) => {
    const result: Decoration[] = [];
    const visit = (child: Node, at: number) => {
      if (child.isText) return;
      const selected = state.selection.empty && state.selection.from >= at && state.selection.from <= at + child.nodeSize;
      result.push(Decoration.node(at, at + child.nodeSize, { class: selected ? 'selected' : '' },
        { kind: child.type.name, text: child.textContent, selected, revision }));
    };
    visit(node, pos); node.descendants((child, at) => visit(child, pos + at + 1));
    return result;
  };
}
const values = (decorations: Decoration[]) => decorations.map(item => ({ from: item.from, to: item.to, ...item.spec }))
  .sort((a, b) => a.from - b.from || a.to - b.to);

it('caches child lookup without changing persistent decoration mapping or additions', () => {
  const doc = schema.node('doc', null, [p('first'), p('second')]);
  const state = EditorState.create({ doc });
  const set = DecorationSet.create(doc, [Decoration.inline(2, 4, { class: 'mark' })]);
  const lookup = vi.spyOn(set, 'forChild');
  const cached = cacheDecorationChildren(set);
  const child = cached.forChild(0, doc.firstChild!);
  expect(cached.forChild(0, doc.firstChild!)).toBe(child);
  expect(lookup).toHaveBeenCalledOnce();
  expect(cacheDecorationChildren(cached)).toBe(cached);
  expect(values(cached.find())).toEqual(values(set.find()));
  const tr = state.tr.insertText('new', 1);
  expect(values(cached.map(tr.mapping, tr.doc).find())).toEqual(values(set.map(tr.mapping, tr.doc).find()));
  expect(values(cached.add(doc, [Decoration.inline(8, 10, { class: 'second' })]).find()))
    .toEqual(values(set.add(doc, [Decoration.inline(8, 10, { class: 'second' })]).find()));
  expect(values(cached.remove(cached.find()).find())).toEqual([]);
  expect(values(set.find())).toHaveLength(1);
});

it('reuses unchanged subtrees and the same snapshot across repeated view queries', () => {
  const cache = createDocumentDecorations();
  let state = EditorState.create({ doc: schema.node('doc', null, Array.from({ length: 300 }, (_, i) => p(`Text ${i}`))) });
  const first = cache(state, 'a', builder(state));
  const build = vi.fn(builder(state));
  expect(cache(state, 'a', build)).toBe(first); expect(build).not.toHaveBeenCalled();
  state = state.apply(state.tr.insertText('added ', 2));
  const changed = vi.fn(builder(state));
  const next = cache(state, 'a', changed);
  expect(changed.mock.calls.length).toBeLessThanOrEqual(2);
  expect(values(next.find())).toEqual(values(createDocumentDecorations()(state, 'a', builder(state)).find()));
});

it('matches a full rebuild across split, join, deletion, replacement, selection and policy changes', () => {
  const cache = createDocumentDecorations();
  let state = EditorState.create({ doc: schema.node('doc', null, [p('First'),
    schema.node('quote', null, [p('Nested'), p('Second')]), p('Last')]) });
  const check = (revision = 'a') => {
    const result = cache(state, revision, builder(state, revision));
    expect(values(result.find())).toEqual(values(createDocumentDecorations()(state, revision, builder(state, revision)).find()));
  };
  check();
  state = state.apply(state.tr.insertText('First', 1)); check();
  state = state.apply(state.tr.split(4)); check();
  state = state.apply(state.tr.join(state.doc.child(0).nodeSize)); check();
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, state.doc.content.size - 2))); check();
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1))); check();
  state = state.apply(state.tr.delete(0, state.doc.child(0).nodeSize)); check();
  state = state.apply(state.tr.replaceWith(0, state.doc.content.size, [p('Replacement'), p('End')])); check();
  check('b');
});

it('retains decorations between distant presentation changes and same-length edits', () => {
  const cache = createDocumentDecorations();
  let state = EditorState.create({ doc: schema.node('doc', null, Array.from({ length: 1000 }, () => p('Text'))) });
  cache(state, 'a', builder(state));
  const end = state.doc.content.size - state.doc.lastChild!.nodeSize;
  state = state.apply(state.tr.setNodeMarkup(0, undefined, { layout: 'wide' })
    .setNodeMarkup(end, undefined, { layout: 'wide' }));
  const changed = vi.fn(builder(state));
  const result = cache(state, 'a', changed);
  expect(changed).toHaveBeenCalledTimes(2);
  expect(values(result.find())).toEqual(values(createDocumentDecorations()(state, 'a', builder(state)).find()));
  state = state.apply(state.tr.insertText('Next', end + 1, end + 5));
  expect(values(cache(state, 'a', builder(state)).find()))
    .toEqual(values(createDocumentDecorations()(state, 'a', builder(state)).find()));
});
