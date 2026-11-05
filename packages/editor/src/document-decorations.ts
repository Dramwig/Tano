import type { Node } from '@milkdown/kit/prose/model';
import type { EditorState } from '@milkdown/kit/prose/state';
import { Mapping, StepMap } from '@milkdown/kit/prose/transform';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
const cachedSets = new WeakSet<DecorationSet>();

/** The set is immutable, so child results remain valid for its lifetime. A
 * viewport-only update otherwise rescans all top-level decorations for every
 * child, even though none of these document decorations changed. Keep the
 * original set untouched and delegate all other operations to it. */
export function cacheDecorationChildren(set: DecorationSet): DecorationSet {
  if (set === DecorationSet.empty || cachedSets.has(set)) return set;
  const cached: DecorationSet = Object.create(set);
  const children = new Map<number, { node: Node; decorations: ReturnType<DecorationSet['forChild']> }>();
  cached.forChild = (offset, node) => {
    const previous = children.get(offset);
    if (previous?.node === node) return previous.decorations;
    const decorations = set.forChild(offset, node);
    children.set(offset, { node, decorations });
    return decorations;
  };
  cachedSets.add(cached);
  return cached;
}

/** Map unchanged decorations and rebuild only affected top-level subtrees. */
export function createDocumentDecorations() {
  let previous: EditorState | undefined;
  let policy: string | undefined;
  let decorations = DecorationSet.empty;
  return (state: EditorState, revision: string, build: (node: Node, pos: number) => Decoration[]) => {
    if (previous?.doc === state.doc && previous.selection.eq(state.selection) && policy === revision) return decorations;
    const reset = !previous || policy !== revision;
    // Attribute updates such as fitting several tables keep block boundaries
    // stable. An identity mapping preserves the unchanged blocks between them.
    const sameBlockPositions = !reset && previous!.doc.childCount === state.doc.childCount &&
      state.doc.content.content.every((node, index) => node.nodeSize === previous!.doc.child(index).nodeSize);
    const mapping = new Mapping();
    let changedFrom: number | null = null, changedTo = -1;
    if (!reset && !sameBlockPositions && previous!.doc !== state.doc) {
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
    state.doc.forEach((node, pos, index) => {
      const end = pos + node.nodeSize;
      const changed = sameBlockPositions ? previous!.doc.child(index) !== node
        : changedFrom !== null && pos <= changedTo && end >= changedFrom;
      if (!reset && !changed &&
          !(oldSelection >= pos && oldSelection <= end) && !(newSelection >= pos && newSelection <= end)) return;
      if (!reset) removed.push(...next.find(pos, end).filter(item => item.from >= pos && item.to <= end));
      added.push(...build(node, pos));
    });
    next = next.remove(removed).add(state.doc, added);
    previous = state; policy = revision; decorations = cacheDecorationChildren(next);
    return decorations;
  };
}
