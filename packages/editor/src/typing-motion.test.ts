// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { EditorView } from '@milkdown/kit/prose/view';
import { typedRange, typingMotion, typingMotionKey } from './typing-motion';

const schema = new Schema({ nodes: {
  doc: { content: 'block+' },
  paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0] },
  source: { group: 'inline', inline: true, content: 'text*', toDOM: () => ['code', 0] },
  code_block: { group: 'block', content: 'text*', code: true, toDOM: () => ['pre', ['code', 0]] },
  text: { group: 'inline' },
} });
let reduced = false;
beforeEach(() => {
  reduced = false;
  vi.stubGlobal('matchMedia', () => ({ get matches() { return reduced; }, addEventListener() {} }));
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value() {
    return { cancel() {}, pause() {}, finish() {}, currentTime: 0, playbackRate: 1, onfinish: null, oncancel: null } as unknown as Animation;
  } });
  const rect = () => ({ x: 10, y: 20, left: 10, top: 20, right: 30, bottom: 40, width: 20, height: 20, toJSON() {} }) as DOMRect;
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [rect()] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: rect });
  vi.spyOn(EditorView.prototype, 'hasFocus').mockReturnValue(true);
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
  delete (Range.prototype as Partial<Range>).getClientRects;
  delete (Range.prototype as Partial<Range>).getBoundingClientRect;
  document.body.innerHTML = '';
});
function editor(...texts: string[]) {
  const root = document.createElement('div'); document.body.append(root);
  const doc = schema.node('doc', null, texts.map(text => schema.node('paragraph', null, text ? [schema.text(text)] : [])));
  return new EditorView(root, { state: EditorState.create({ doc, plugins: [typingMotion()] }) });
}
function type(view: EditorView, text: string, at = view.state.selection.from) {
  const tr = view.state.tr.insertText(text, at);
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, at + text.length)));
}

it('recognises plain typing at the caret, not pastes, IME steps or block edits', () => {
  const base = EditorState.create({ doc: schema.node('doc', null, [schema.node('paragraph', null, [schema.text('ab')])]) });
  const state = base.apply(base.tr.setSelection(TextSelection.create(base.doc, 3)));
  const typed = state.tr.insertText('c', 3);
  expect(typedRange(typed)).toEqual({ from: 3, to: 4 });
  expect(typedRange(state.tr.insertText('c', 3).setMeta('uiEvent', 'paste'))).toBeNull();
  expect(typedRange(state.tr.insertText('c', 3).setMeta('composition', 1))).toBeNull();
  expect(typedRange(state.tr.split(2))).toBeNull();
  // Inserted away from the caret: a programmatic edit, not typing.
  const away = state.tr.insertText('c', 1);
  expect(typedRange(away.setSelection(TextSelection.create(away.doc, 4)))).toBeNull();
});

it('marks typed text with a short-lived span and settles it in one pass', () => {
  vi.useFakeTimers();
  const view = editor('hello');
  type(view, '!', 6);
  const span = view.dom.querySelector('.tano-typed');
  expect(span?.textContent).toBe('!');
  expect(span?.classList.contains('tano-typed-ime')).toBe(false);
  type(view, '?');
  expect(view.dom.querySelectorAll('.tano-typed')).toHaveLength(2);
  vi.advanceTimersByTime(600);
  expect(view.dom.querySelector('.tano-typed')).toBeNull();
  expect(typingMotionKey.getState(view.state)?.count).toBe(0);
  expect(view.state.doc.textContent).toBe('hello!?');
  view.destroy();
  vi.useRealTimers();
});

it('leaves code blocks, pastes and reduced motion alone', () => {
  const root = document.createElement('div'); document.body.append(root);
  const doc = schema.node('doc', null, [schema.node('code_block', null, [schema.text('x')])]);
  const code = new EditorView(root, { state: EditorState.create({ doc, plugins: [typingMotion()] }) });
  type(code, 'y', 2);
  expect(code.dom.querySelector('.tano-typed')).toBeNull();
  code.destroy();

  const view = editor('hello');
  view.dispatch(view.state.tr.insertText('!', 6).setMeta('uiEvent', 'paste'));
  expect(view.dom.querySelector('.tano-typed')).toBeNull();
  reduced = true;
  type(view, '?', 7);
  expect(view.dom.querySelector('.tano-typed')).toBeNull();
  view.destroy();
});

it('ghosts text deleted by a command outside the ProseMirror DOM', () => {
  const view = editor('hello world');
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 12)));
  view.dispatch(view.state.tr.delete(7, 12));
  const ghost = document.querySelector<HTMLElement>('.tano-type-ghost');
  expect(ghost?.textContent).toBe('world');
  expect(view.dom.contains(ghost)).toBe(false);
  expect(ghost!.closest('.tano-type-layer')?.getAttribute('aria-hidden')).toBe('true');
  expect(view.state.doc.textContent).toBe('hello ');
  view.destroy();
});

it('does not ghost whitespace or text deleted while unfocused', () => {
  const view = editor('hello world');
  view.dispatch(view.state.tr.delete(6, 7));
  expect(document.querySelector('.tano-type-ghost')).toBeNull();
  vi.mocked(EditorView.prototype.hasFocus).mockReturnValue(false);
  view.dispatch(view.state.tr.delete(1, 3));
  expect(document.querySelector('.tano-type-ghost')).toBeNull();
  view.destroy();
});

it('does not ghost edits away from the caret or inline nodes being re-rendered', () => {
  const view = editor('hello world');
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 12)));
  view.dispatch(view.state.tr.delete(1, 6));
  expect(document.querySelector('.tano-type-ghost')).toBeNull();
  view.destroy();

  // Live Markdown source collapsing back into rendered text once the caret
  // leaves it: the source node is replaced, nothing was erased.
  const root = document.createElement('div'); document.body.append(root);
  const doc = schema.node('doc', null, [schema.node('paragraph', null,
    [schema.text('a '), schema.node('source', null, [schema.text('[Guide](00-getting-started.md)')])])]);
  const live = new EditorView(root, { state: EditorState.create({ doc, plugins: [typingMotion()] }) });
  const end = live.state.doc.content.size - 1;
  live.dispatch(live.state.tr.setSelection(TextSelection.create(live.state.doc, end)));
  live.dispatch(live.state.tr.replaceWith(3, end, schema.text('Guide')));
  expect(document.querySelector('.tano-type-ghost')).toBeNull();
  live.destroy();
});

it('settles committed IME text after composition ends', async () => {
  const view = editor('');
  view.dom.dispatchEvent(new Event('compositionstart'));
  view.dispatch(view.state.tr.insertText('你好', 1).setMeta('composition', 1));
  expect(view.dom.querySelector('.tano-typed')).toBeNull();
  view.dom.dispatchEvent(new Event('compositionend'));
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  const span = view.dom.querySelector('.tano-typed');
  expect(span?.textContent).toBe('你好');
  expect(span?.classList.contains('tano-typed-ime')).toBe(true);
  view.destroy();
});


it('drops spans of text that has already been revealed while typing continues', () => {
  const view = editor('hello');
  let now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  type(view, 'a', 6);
  now += 600;
  type(view, 'b');
  expect([...view.dom.querySelectorAll('.tano-typed')].map(span => span.textContent)).toEqual(['b']);
  expect(typingMotionKey.getState(view.state)?.count).toBe(1);
  view.destroy();
});

it('does not animate a held key: no spans while typing, no ghosts while deleting', () => {
  const view = editor('hello world');
  view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', repeat: true, bubbles: true }));
  type(view, 'x', 12);
  expect(view.dom.querySelector('.tano-typed')).toBeNull();
  view.dispatch(view.state.tr.delete(7, 13));
  expect(document.querySelector('.tano-type-ghost')).toBeNull();
  view.dom.dispatchEvent(new KeyboardEvent('keyup', { key: 'x', bubbles: true }));
  type(view, 'y', 7);
  expect(view.dom.querySelector('.tano-typed')?.textContent).toBe('y');
  view.destroy();
});
