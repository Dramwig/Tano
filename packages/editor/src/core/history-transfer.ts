import { closeHistory, redo, undo } from '@milkdown/kit/prose/history';
import { EditorState, Plugin, Selection } from '@milkdown/kit/prose/state';
import type { Transaction } from '@milkdown/kit/prose/state';
import { Step } from '@milkdown/kit/prose/transform';

function seededHistory(plugin: Plugin, value: unknown): Plugin {
  return new Plugin({
    ...plugin.spec,
    state: { ...plugin.spec.state!, init: () => value },
  });
}

/** Detach history from editor plugins that retain DOM, callbacks, or window state. */
export function captureHistory(state: EditorState, plugin: Plugin): EditorState {
  return EditorState.create({
    schema: state.schema, doc: state.doc, selection: state.selection,
    plugins: [seededHistory(plugin, plugin.getState(state))],
  });
}

interface HistoryEvent {
  steps: ReturnType<Step['toJSON']>[];
  before: ReturnType<Selection['toJSON']>;
  after: ReturnType<Selection['toJSON']>;
}

/** Rebuild with public history commands and steps so every node uses the new schema. */
export function restoreHistory(target: EditorState, snapshot: EditorState, plugin: Plugin): EditorState {
  const past: HistoryEvent[] = [];
  const future: HistoryEvent[] = [];
  let cursor = snapshot;
  let transaction: Transaction | undefined;
  while (undo(cursor, value => { transaction = value; })) {
    const change = transaction!;
    past.push({
      steps: change.steps.map((step, index) => step.invert(change.docs[index]!).toJSON()).reverse(),
      before: change.selection.toJSON(), after: cursor.selection.toJSON(),
    });
    cursor = cursor.apply(change);
  }
  const earliest = cursor;
  cursor = snapshot;
  while (redo(cursor, value => { transaction = value; })) {
    const change = transaction!;
    future.push({
      steps: change.steps.map(step => step.toJSON()),
      before: cursor.selection.toJSON(), after: change.selection.toJSON(),
    });
    cursor = cursor.apply(change);
  }
  const schema = target.schema;
  let rebuilt = EditorState.create({
    schema, doc: schema.nodeFromJSON(earliest.doc.toJSON()), plugins: [plugin],
  });
  for (const event of [...past.reverse(), ...future]) {
    rebuilt = rebuilt.apply(rebuilt.tr.setSelection(Selection.fromJSON(rebuilt.doc, event.before)));
    const change = closeHistory(rebuilt.tr);
    for (const step of event.steps) change.step(Step.fromJSON(schema, step));
    change.setSelection(Selection.fromJSON(change.doc, event.after));
    rebuilt = rebuilt.apply(change);
  }
  for (let index = 0; index < future.length; index++) {
    undo(rebuilt, change => { rebuilt = rebuilt.apply(change); });
  }
  const doc = schema.nodeFromJSON(snapshot.doc.toJSON());
  if (!rebuilt.doc.eq(doc)) throw new Error('Transferred editor history does not match the document');
  const change = target.tr.replaceWith(0, target.doc.content.size, doc.content).setMeta('addToHistory', false);
  change.setSelection(Selection.fromJSON(change.doc, snapshot.selection.toJSON()));
  const plugins = target.plugins;
  return target.apply(change)
    .reconfigure({ plugins: plugins.filter(candidate => candidate !== plugin) })
    .reconfigure({ plugins: plugins.map(candidate => candidate === plugin ? seededHistory(plugin, plugin.getState(rebuilt)) : candidate) })
    .reconfigure({ plugins });
}
