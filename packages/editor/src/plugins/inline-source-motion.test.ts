// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { EditorView } from '@milkdown/kit/prose/view';
import { alignText, inlineSourceMotion, inlineSourceMotionKey } from './inline-source-motion';

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'inline*', toDOM: () => ['p', 0] },
    tano_live_source_inline: { group: 'inline', inline: true, content: 'text*', marks: '', toDOM: () => ['span', { class: 'src' }, 0] },
    wiki: { group: 'inline', inline: true, atom: true, toDOM: () => ['span', { class: 'chip' }, 'target-document'] },
    tano_wiki_link: { group: 'inline', inline: true, atom: true, attrs: { label: { default: '' }, target: { default: '' } }, toDOM: node => ['a', { class: 'tano-wiki-link' }, node.attrs.label] },
    text: { group: 'inline' },
  },
  marks: { link: { toDOM: () => ['a', 0] } },
});
const SOURCE = '[Guide](00-getting-started.md)';
const rendered = () => [schema.text('a '), schema.text('Guide', [schema.marks.link!.create()]), schema.text(' b')];
const revealed = () => [schema.text('a '), schema.node('tano_live_source_inline', null, [schema.text(SOURCE)]), schema.text(' b')];

let now = 1000;
beforeEach(() => {
  now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value() {
    return { cancel() {}, currentTime: 0 } as unknown as Animation;
  } });
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
  document.body.innerHTML = '';
});

function editor(content = rendered(), enabled = () => true) {
  const root = document.createElement('div'); document.body.append(root);
  const doc = schema.node('doc', null, [schema.node('paragraph', null, content)]);
  return new EditorView(root, { state: EditorState.create({ doc, plugins: [inlineSourceMotion({ enabled })] }) });
}
const swap = (view: EditorView, content: ReturnType<typeof rendered>) => {
  const paragraph = view.state.doc.firstChild!;
  const tr = view.state.tr.replaceWith(1, 1 + paragraph.content.size, content);
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, 4)));
};
const decorations = (view: EditorView) => inlineSourceMotionKey.getState(view.state)!.decorations.find();

it('aligns rendered text with the earliest matching source letters', () => {
  const ops = alignText('Guide', SOURCE);
  const added = ops.filter(op => op.type === 'add').map(op => SOURCE[op.b]).join('');
  expect(added).toBe('[](00-getting-started.md)');
  expect(ops.filter(op => op.type === 'keep').map(op => op.b)).toEqual([1, 2, 3, 4, 5]);
});

it('opens the markers of a field the caret enters', () => {
  const view = editor();
  swap(view, revealed());
  const grown = [...view.dom.querySelectorAll<HTMLElement>('.tano-source-morph')].map(node => node.textContent);
  expect(grown).toEqual(['[', '](00-getting-started.md)']);
  expect(view.state.doc.textContent).toBe(`a ${SOURCE} b`);
  view.destroy();
});

it('closes the markers of a field the caret leaves, outside the document', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const view = editor();
  swap(view, revealed());
  now += 1000;
  vi.runOnlyPendingTimers();
  expect(decorations(view)).toHaveLength(0);
  swap(view, rendered());
  const exits = [...view.dom.querySelectorAll<HTMLElement>('.tano-source-exit')];
  expect(exits.map(node => node.textContent)).toEqual(['[', '](00-getting-started.md)']);
  expect(exits.every(node => node.contentEditable === 'false')).toBe(true);
  expect(view.state.doc.textContent).toBe('a Guide b');
  now += 1000;
  vi.runOnlyPendingTimers();
  expect(view.dom.querySelector('.tano-source-morph')).toBeNull();
  vi.useRealTimers();
  view.destroy();
});

it('reverses a field that is still opening instead of jumping', () => {
  const view = editor();
  swap(view, revealed());
  now += 1; // barely opened: nothing worth closing
  swap(view, rendered());
  expect(view.dom.querySelector('.tano-source-exit')).toBeNull();
  swap(view, revealed());
  now += 120; // half open
  swap(view, rendered());
  expect(view.dom.querySelectorAll('.tano-source-exit')).toHaveLength(2);
  view.destroy();
});

it('cross-fades atoms (wiki links, references, math) with their source both ways', () => {
  const atom = () => [schema.text('a '), schema.node('wiki'), schema.text(' b')];
  const source = () => [schema.text('a '), schema.node('tano_live_source_inline', null, [schema.text('[[nested-folder/target-document]]')]), schema.text(' b')];
  const view = editor(atom());
  swap(view, source());
  expect([...view.dom.querySelectorAll('[data-morph]')].map(node => node.textContent)).toEqual(['[[nested-folder/target-document]]']);
  now += 1000;
  swap(view, atom());
  const swapped = [...view.dom.querySelectorAll<HTMLElement>('[data-morph]')];
  expect(swapped.map(node => node.className)).toEqual(['chip tano-source-morph']);
  expect(view.state.doc.textContent).toBe('a  b');
  view.destroy();
});

it('opens a wiki link around its label instead of cross-fading it', () => {
  const wiki = () => [schema.text('a '), schema.node('tano_wiki_link', { label: 'nested-folder/target-document', target: 'nested-folder/target-document' }), schema.text(' b')];
  const source = () => [schema.text('a '), schema.node('tano_live_source_inline', null, [schema.text('[[nested-folder/target-document]]')]), schema.text(' b')];
  const view = editor(wiki());
  swap(view, source());
  expect([...view.dom.querySelectorAll('[data-morph]')].map(node => node.textContent)).toEqual(['[[', ']]']);
  now += 1000;
  swap(view, wiki());
  expect([...view.dom.querySelectorAll('.tano-source-exit')].map(node => node.textContent)).toEqual(['[[', ']]']);
  // The atom itself is marked so its icon can fold back in.
  expect(view.dom.querySelector('a.tano-wiki-link')?.hasAttribute('data-morph')).toBe(true);
  view.destroy();
});

it('stays still when the setting is off', () => {
  const view = editor(rendered(), () => false);
  swap(view, revealed());
  expect(decorations(view)).toHaveLength(0);
  view.destroy();
});

it('ignores ordinary typing and edits without a source field', () => {
  const view = editor();
  view.dispatch(view.state.tr.insertText('x', 2));
  expect(decorations(view)).toHaveLength(0);
  swap(view, revealed());
  now += 1000;
  const count = decorations(view).length;
  view.dispatch(view.state.tr.insertText('y', 6)); // inside the source
  expect(decorations(view)).toHaveLength(count);
  view.destroy();
});
