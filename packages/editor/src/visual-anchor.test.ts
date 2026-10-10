// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { EditorView } from '@milkdown/kit/prose/view';
import { captureVisualAnchor, visualAnchorKey, visualAnchorPlugin, visualSelection } from './visual-anchor';

const schema = new Schema({ nodes: {
  doc: { content: 'paragraph+' }, paragraph: { content: 'text*', toDOM: () => ['p', 0] }, text: {},
} });
it('only exposes a live focused text selection and does not create anchor metadata', () => {
  const root = document.createElement('div'); document.body.append(root);
  const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('hello butterfly')])]);
  const view = new EditorView(root, { state: EditorState.create({ doc, selection: TextSelection.create(doc, 7, 16), plugins: [visualAnchorPlugin()] }) });
  try {
    expect(visualSelection(view)).toBeNull();
    view.focus();
    expect(visualSelection(view)).toEqual({ from: 7, to: 16, document: doc });
    expect(visualAnchorKey.getState(view.state)!.size).toBe(0);
    document.getSelection()!.collapseToEnd();
    expect(visualSelection(view)).toBeNull();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, 6, 7))); view.focus();
    expect(visualSelection(view)).toBeNull(); // Whitespace is not a perch target.
    view.destroy(); expect(visualSelection(view)).toBeNull();
  } finally { if (!view.isDestroyed) view.destroy(); root.remove(); }
});
it('maps a text target through edits, invalidates deletion, and never inserts document content', () => {
  const root = document.createElement('div'); document.body.append(root);
  const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('hello butterfly')])]);
  const view = new EditorView(root, { state: EditorState.create({ doc, selection: TextSelection.create(doc, 7, 16), plugins: [visualAnchorPlugin()] }) });
  try {
    const anchor = captureVisualAnchor(view)!;
    expect(view.state.doc.eq(doc)).toBe(true);
    expect([...visualAnchorKey.getState(view.state)!.values()]).toEqual([{ from: 7, to: 16 }]);
    view.dispatch(view.state.tr.insertText('new ', 1));
    expect([...visualAnchorKey.getState(view.state)!.values()]).toEqual([{ from: 11, to: 20 }]);
    view.dispatch(view.state.tr.delete(11, 20));
    expect(anchor.getRects()).toEqual([]); expect(visualAnchorKey.getState(view.state)!.size).toBe(0);
    anchor.dispose(); anchor.dispose(); expect(view.state.doc.textContent).toBe('new hello ');
  } finally { view.destroy(); root.remove(); }
});
it('reads fresh DOM rectangles and safely releases an anchor after editor destruction', () => {
  const root = document.createElement('div'); document.body.append(root);
  const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('hello')])]);
  const view = new EditorView(root, { state: EditorState.create({ doc, selection: TextSelection.create(doc, 1, 6), plugins: [visualAnchorPlugin()] }) });
  let top = 20;
  const original = Range.prototype.getClientRects;
  Range.prototype.getClientRects = vi.fn(() => [new DOMRect(10, top, 40, 18)] as unknown as DOMRectList);
  try {
    const anchor = captureVisualAnchor(view)!;
    expect(anchor.getRects()[0].top).toBe(20); top = 50; expect(anchor.getRects()[0].top).toBe(50);
    view.destroy(); expect(anchor.getRects()).toEqual([]); expect(() => anchor.dispose()).not.toThrow();
  } finally { if (!view.isDestroyed) view.destroy(); root.remove(); Range.prototype.getClientRects = original; }
});
