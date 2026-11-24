import { expect, it } from 'vitest';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { closeHistory, history, redo, redoDepth, undo, undoDepth } from '@milkdown/kit/prose/history';
import { captureHistory, restoreHistory } from './history-transfer';

function schema() {
  return new Schema({ nodes: {
    doc: { content: 'paragraph+' }, paragraph: { content: 'text*', group: 'block' }, text: {},
  }, marks: { strong: {} } });
}

it('preserves undo, redo, selections and mark steps across fresh schemas', () => {
  const originalSchema = schema();
  const originalHistory = history();
  let state = EditorState.create({ schema: originalSchema, plugins: [originalHistory] });
  state = state.apply(closeHistory(state.tr.insertText('one')));
  state = state.apply(closeHistory(state.tr.insertText(' two')));
  state = state.apply(closeHistory(state.tr.addMark(1, 4, originalSchema.marks.strong.create())));
  undo(state, change => { state = state.apply(change); });
  const snapshot = captureHistory(state, originalHistory);
  const targetSchema = schema();
  const targetHistory = history();
  const target = EditorState.create({ schema: targetSchema, doc: targetSchema.nodeFromJSON(state.doc.toJSON()), plugins: [targetHistory] });
  let restored = restoreHistory(target, snapshot, targetHistory);
  expect(restored.selection.toJSON()).toEqual(state.selection.toJSON());
  expect(undoDepth(restored)).toBe(2);
  expect(redoDepth(restored)).toBe(1);
  redo(restored, change => { restored = restored.apply(change); });
  expect(restored.doc.firstChild!.firstChild!.marks[0].type).toBe(targetSchema.marks.strong);
  undo(restored, change => { restored = restored.apply(change); });
  undo(restored, change => { restored = restored.apply(change); });
  expect(restored.doc.textContent).toBe('one');
  undo(restored, change => { restored = restored.apply(change); });
  expect(restored.doc.textContent).toBe('');
  expect(snapshot.doc.textContent).toBe('one two');
});

it('keeps independent external edits when transferred history is undone', () => {
  const sourceSchema = schema();
  const sourceHistory = history();
  let state = EditorState.create({ schema: sourceSchema,
    doc: sourceSchema.node('doc', null, sourceSchema.node('paragraph', null, sourceSchema.text('base'))),
    plugins: [sourceHistory],
  });
  state = state.apply(closeHistory(state.tr.insertText(' local', 5)));
  state = state.apply(state.tr.insertText('external ', 1).setMeta('addToHistory', false));
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 10, 14)));
  const targetSchema = schema();
  const targetHistory = history();
  const target = EditorState.create({ schema: targetSchema, plugins: [targetHistory] });
  let restored = restoreHistory(target, captureHistory(state, sourceHistory), targetHistory);
  expect(restored.selection.toJSON()).toEqual(state.selection.toJSON());
  restored = restored.apply(restored.tr.insertText('new ', 1).setMeta('addToHistory', false));
  undo(restored, change => { restored = restored.apply(change); });
  expect(restored.doc.textContent).toBe('new external base');
  redo(restored, change => { restored = restored.apply(change); });
  expect(restored.doc.textContent).toBe('new external base local');
});
