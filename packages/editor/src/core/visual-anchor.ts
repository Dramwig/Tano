import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import type { EditorView } from '@milkdown/kit/prose/view';

interface TrackedRange { from: number; to: number; highlight?: true }
type AnchorRequest = { add: { id: number; range: TrackedRange } } | { remove: number };
export const visualAnchorKey = new PluginKey<ReadonlyMap<number, TrackedRange>>('tano-visual-anchor');
let nextAnchor = 0;
export function visualAnchorPlugin() {
  return new Plugin<ReadonlyMap<number, TrackedRange>>({
    key: visualAnchorKey,
    state: {
      init: () => new Map(),
      apply(tr, previous) {
        const request = tr.getMeta(visualAnchorKey) as AnchorRequest | undefined;
        if (!tr.docChanged && !request) return previous;
        const next = new Map<number, TrackedRange>();
        for (const [id, range] of previous) {
          const from = tr.mapping.mapResult(range.from, 1), to = tr.mapping.mapResult(range.to, -1);
          if (!from.deletedAcross && !to.deletedAcross && from.pos < to.pos && tr.doc.textBetween(from.pos, to.pos).length)
            next.set(id, { from: from.pos, to: to.pos, ...(range.highlight ? { highlight: true } : {}) });
        }
        if (request && 'add' in request) next.set(request.add.id, request.add.range);
        if (request && 'remove' in request) next.delete(request.remove);
        return next;
      },
    },
    props: {
      decorations(state) {
        const decorations: Decoration[] = [];
        for (const range of visualAnchorKey.getState(state)?.values() ?? []) {
          if (range.highlight) decorations.push(Decoration.inline(range.from, range.to, { class: 'tano-assistant-selection' }));
        }
        return decorations.length ? DecorationSet.create(state.doc, decorations) : DecorationSet.empty;
      },
    },
  });
}

/** Read only: a live, focused text selection eligible for an idle visual interaction. */
export function visualSelection(view: EditorView) {
  if (view.isDestroyed || !view.dom.isConnected || !view.hasFocus()) return null;
  const selection = view.state.selection;
  const domSelection = view.dom.ownerDocument.getSelection();
  if (!(selection instanceof TextSelection) || selection.empty || !domSelection || domSelection.isCollapsed ||
    !view.dom.contains(domSelection.anchorNode) || !view.dom.contains(domSelection.focusNode) ||
    !view.state.doc.textBetween(selection.from, selection.to).trim()) return null;
  return { from: selection.from, to: selection.to, document: view.state.doc };
}

/** Ephemeral position tracking; plugin metadata never enters Markdown or undo history. */
export function captureVisualAnchor(view: EditorView, options: { highlight?: boolean } = {}) {
  const selection = view.state.selection;
  if (!(selection instanceof TextSelection) || selection.empty || !visualAnchorKey.getState(view.state)) return null;
  const id = ++nextAnchor;
  const range = { from: selection.from, to: selection.to, ...(options.highlight ? { highlight: true as const } : {}) };
  view.dispatch(view.state.tr.setMeta(visualAnchorKey, { add: { id, range } } satisfies AnchorRequest)
    .setMeta('addToHistory', false));
  let released = false;
  return {
    element: view.dom,
    getRects(): DOMRect[] {
      if (released || view.isDestroyed || !view.dom.isConnected) return [];
      const range = visualAnchorKey.getState(view.state)?.get(id);
      if (!range) return [];
      try {
        const start = view.domAtPos(range.from, 1), end = view.domAtPos(range.to, -1);
        const domRange = view.dom.ownerDocument.createRange();
        domRange.setStart(start.node, start.offset); domRange.setEnd(end.node, end.offset);
        return Array.from(domRange.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0);
      } catch { return []; }
    },
    dispose() {
      if (released) return;
      released = true;
      if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(visualAnchorKey, { remove: id } satisfies AnchorRequest).setMeta('addToHistory', false));
    },
  };
}

/** Capture a caret anchor for lightweight actions attached to an empty block. */
export function captureCaretAnchor(view: EditorView) {
  const selection = view.state.selection;
  if (!(selection instanceof TextSelection) || !selection.empty || !visualAnchorKey.getState(view.state)) return null;
  const id = ++nextAnchor;
  view.dispatch(view.state.tr.setMeta(visualAnchorKey, { add: { id, range: { from: selection.from, to: selection.to } } } satisfies AnchorRequest)
    .setMeta('addToHistory', false));
  let released = false;
  return {
    element: view.dom,
    getRects(): DOMRect[] {
      if (released || view.isDestroyed || !view.dom.isConnected) return [];
      const range = visualAnchorKey.getState(view.state)?.get(id);
      if (!range) return [];
      try {
        const coords = view.coordsAtPos(range.from);
        return [new DOMRect(coords.left, coords.top, 1, Math.max(1, coords.bottom - coords.top))];
      } catch { return []; }
    },
    dispose() {
      if (released) return;
      released = true;
      if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(visualAnchorKey, { remove: id } satisfies AnchorRequest).setMeta('addToHistory', false));
    },
  };
}
