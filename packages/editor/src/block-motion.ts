import { Plugin, PluginKey, type Transaction } from '@milkdown/kit/prose/state';
import { Mapping, ReplaceAroundStep, ReplaceStep } from '@milkdown/kit/prose/transform';
import type { Node } from '@milkdown/kit/prose/model';
import type { EditorView } from '@milkdown/kit/prose/view';
import { canAnimate, flipFrom, ghostExit, riseIn } from './motion';

/* Paragraph-level motion for the editor.
 *
 * Typing inside a line never touches this plugin: only transactions that
 * create, remove or reorder blocks are measured. Before such a transaction
 * reaches the DOM (filterTransaction), the visible blocks' rects are read and
 * any block that is about to disappear is cloned. After the view has drawn
 * the new document, surviving blocks glide from their old place (FLIP), new
 * blocks rise in and removed blocks fade out as inert ghosts outside the
 * ProseMirror DOM, so the document model and DOM observer are never touched. */

type Block = { pos: number; node: Node };
type Snapshot = {
  mapping: Mapping;
  /** The document the mapping currently leads to. */
  doc: Node;
  before: Block[];
  rects: Map<number, DOMRect>;
  ghosts: { element: HTMLElement; rect: DOMRect }[];
};

export const blockMotionKey = new PluginKey('tano-block-motion');
const MAX_CHANGED_BLOCKS = 40;
const MAX_ENTERING = 12;
const VIEW_MARGIN = 120;

/** Top-level blocks, with list items as their own rows so a new bullet or
 * a removed task animates on its own instead of moving the whole list. */
function collect(doc: Node): Block[] {
  const blocks: Block[] = [];
  doc.forEach((node, offset) => {
    if (!node.isTextblock && node.childCount && /(^|_)list$/.test(node.type.name)) {
      node.forEach((child, childOffset) => blocks.push({ pos: offset + 1 + childOffset, node: child }));
    } else blocks.push({ pos: offset, node });
  });
  return blocks;
}

/** True when any step may create, remove or rewrap blocks. Plain typing,
 * IME composition and mark changes stay on the fast path. */
function structural(tr: Transaction): boolean {
  for (let index = 0; index < tr.steps.length; index++) {
    // Duck-typed so a duplicated prosemirror-transform copy cannot hide steps.
    const step = tr.steps[index] as unknown as { from?: number; to?: number; gapFrom?: number; slice?: { content: { forEach: (f: (node: Node) => void) => void } } };
    if (step instanceof ReplaceAroundStep || step.gapFrom !== undefined) return true;
    if (!(step instanceof ReplaceStep) && !(step.slice && step.from !== undefined && step.to !== undefined)) continue;
    const { from, to, slice } = step as Required<Pick<typeof step, 'from' | 'to' | 'slice'>>;
    const doc = tr.docs[index]!;
    const $from = doc.resolve(from), $to = doc.resolve(to);
    if (!$from.sameParent($to) || !$from.parent.isTextblock) return true;
    let block = false;
    slice.content.forEach(node => { if (!node.isInline) block = true; });
    if (block) return true;
  }
  return false;
}

function indexAt(blocks: Block[], pos: number): number {
  let low = 0, high = blocks.length - 1, found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (blocks[middle]!.pos <= pos) { found = middle; low = middle + 1; } else high = middle - 1;
  }
  return found;
}

function element(view: EditorView, block: Block): HTMLElement | null {
  const dom = view.nodeDOM(block.pos);
  return dom instanceof HTMLElement ? dom : null;
}

/** Indices of blocks whose DOM is on screen (plus a margin). Starts from the
 * block under the top of the viewport, so cost is proportional to what is
 * visible, not to the document length. */
function visible(view: EditorView, blocks: Block[]): number[] {
  if (!blocks.length) return [];
  const bounds = view.dom.getBoundingClientRect();
  const top = Math.max(bounds.top, 0) + 1;
  const bottom = Math.min(bounds.bottom, window.innerHeight);
  if (bottom <= top) return [];
  let probe: { pos: number } | null = null;
  try { probe = view.posAtCoords({ left: bounds.left + Math.min(bounds.width / 2, 40), top }); } catch { probe = null; }
  let start = probe ? Math.max(0, indexAt(blocks, probe.pos) - 2) : 0;
  const result: number[] = [];
  for (let index = start; index < blocks.length && result.length < 160; index++) {
    const dom = element(view, blocks[index]!);
    if (!dom) continue;
    const rect = dom.getBoundingClientRect();
    if (rect.bottom < top - VIEW_MARGIN) { start = index; continue; }
    if (rect.top > bottom + VIEW_MARGIN) break;
    result.push(index);
  }
  return result;
}

function hasContent(node: Node) {
  return !(node.isTextblock && node.content.size === 0);
}

function removed(mapping: Mapping, block: Block) {
  return mapping.map(block.pos, 1) >= mapping.map(block.pos + block.node.nodeSize, -1);
}

function ghostLayer(view: EditorView): HTMLElement | undefined {
  const parent = view.dom.parentElement;
  if (!parent) return undefined;
  const layer = document.createElement('div');
  // Same prose classes, so ghosts keep their typography; never ProseMirror.
  layer.className = [...view.dom.classList].filter(name => name !== 'ProseMirror' && name !== 'ProseMirror-focused').join(' ');
  layer.classList.add('tano-block-ghost-layer');
  layer.setAttribute('aria-hidden', 'true');
  layer.inert = true;
  parent.append(layer);
  window.setTimeout(() => layer.remove(), 400);
  return layer;
}

function play(view: EditorView, snapshot: Snapshot) {
  const { mapping, before, rects, ghosts } = snapshot;
  const after = collect(view.state.doc);
  const claimed = new Set<number>();
  const moves = new Map<number, DOMRect>();
  let survivors = 0;
  for (const [index, block] of before.entries()) {
    if (removed(mapping, block)) continue;
    const target = indexAt(after, mapping.map(block.pos, 1));
    if (target < 0 || claimed.has(target)) continue;
    survivors++;
    claimed.add(target);
    const rect = rects.get(index);
    if (rect) moves.set(target, rect);
  }
  // A whole-document replacement (opening another file) is not an edit.
  if (!survivors && before.length > 3) return;
  let entering = 0;
  for (const index of visible(view, after)) {
    const dom = element(view, after[index]!);
    if (!dom) continue;
    const from = moves.get(index);
    if (from) flipFrom(dom, from);
    else if (!claimed.has(index) && entering < MAX_ENTERING) riseIn(dom, Math.min(entering++, 6) * 18);
  }
  if (ghosts.length) {
    const layer = ghostLayer(view);
    if (layer) for (const ghost of ghosts) ghostExit(ghost.element, ghost.rect, layer, { scale: 0.97, y: -3 });
  }
}

export function blockMotion(enabled: () => boolean = () => true) {
  let view: EditorView | undefined;
  let pending: Snapshot | undefined;
  return new Plugin({
    key: blockMotionKey,
    filterTransaction(tr, state) {
      if (!tr.docChanged) return true;
      if (pending && tr.before === pending.doc) {
        pending.mapping.appendMapping(tr.mapping);
        pending.doc = tr.doc;
        return true;
      }
      // A transaction that was filtered but never drawn leaves a stale chain.
      pending = undefined;
      if (!view || state.doc !== view.state.doc || view.composing || tr.getMeta(blockMotionKey) === false || !enabled()) return true;
      if (!view.dom.isConnected || !canAnimate(view.dom) || !structural(tr)) return true;
      const before = collect(state.doc);
      const after = collect(tr.doc);
      if (Math.abs(after.length - before.length) > MAX_CHANGED_BLOCKS) return true;
      const rects = new Map<number, DOMRect>();
      const ghosts: Snapshot['ghosts'] = [];
      for (const index of visible(view, before)) {
        const block = before[index]!;
        const dom = element(view, block);
        if (!dom) continue;
        const rect = dom.getBoundingClientRect();
        rects.set(index, rect);
        if (removed(tr.mapping, block) && hasContent(block.node) && ghosts.length < 8)
          ghosts.push({ element: dom.cloneNode(true) as HTMLElement, rect });
      }
      if (!rects.size) return true;
      const mapping = new Mapping();
      mapping.appendMapping(tr.mapping);
      pending = { mapping, doc: tr.doc, before, rects, ghosts };
      return true;
    },
    view(editorView) {
      view = editorView;
      return {
        update(current) {
          const snapshot = pending;
          pending = undefined;
          if (snapshot && snapshot.doc === current.state.doc && current.dom.isConnected) play(current, snapshot);
        },
        destroy() { view = undefined; pending = undefined; },
      };
    },
  });
}
