import type { Node } from '@milkdown/kit/prose/model';
import type { EditorState } from '@milkdown/kit/prose/state';
import { Mapping, StepMap } from '@milkdown/kit/prose/transform';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';

/** Map unchanged decorations and rebuild only affected top-level subtrees. */
export function createDocumentDecorations() {
  let previous: EditorState | undefined;
  let policy: string | undefined;
  let decorations = DecorationSet.empty;
  return (state: EditorState, revision: string, build: (node: Node, pos: number) => Decoration[]) => {
    if (previous?.doc === state.doc && previous.selection.eq(state.selection) && policy === revision) return decorations;
    const reset = !previous || policy !== revision;
    const mapping = new Mapping();
    let changedFrom: number | null = null, changedTo = -1;
    if (!reset && previous!.doc !== state.doc) {
      changedFrom = previous!.doc.content.findDiffStart(state.doc.content);
      if (changedFrom !== null) {
        const end = previous!.doc.content.findDiffEnd(state.doc.content)!;
        const overlap = Math.max(0, changedFrom - Math.min(end.a, end.b));
        changedTo = end.b + overlap;
        mapping.appendMap(new StepMap([changedFrom, end.a + overlap - changedFrom, changedTo - changedFrom]));
      }
    }
    let next = reset ? DecorationSet.empty : decorations.map(mapping, state.doc);
    const oldSelection = previous?.selection.empty ? mapping.map(previous.selection.from) : -1;
    const newSelection = state.selection.empty ? state.selection.from : -1;
    const added: Decoration[] = [], removed: Decoration[] = [];
    state.doc.forEach((node, pos) => {
      const end = pos + node.nodeSize;
      if (!reset && !(changedFrom !== null && pos <= changedTo && end >= changedFrom) &&
          !(oldSelection >= pos && oldSelection <= end) && !(newSelection >= pos && newSelection <= end)) return;
      if (!reset) removed.push(...next.find(pos, end).filter(item => item.from >= pos && item.to <= end));
      added.push(...build(node, pos));
    });
    next = next.remove(removed).add(state.doc, added);
    previous = state; policy = revision; decorations = next;
    return next;
  };
}
