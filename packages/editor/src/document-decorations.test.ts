import { expect, it, vi } from 'vitest';
import { Schema, type Node } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { Decoration } from '@milkdown/kit/prose/view';
import { createDocumentDecorations } from './document-decorations';

const schema = new Schema({ nodes: { doc: { content: 'block+' },
  paragraph: { content: 'text*', group: 'block' },
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
