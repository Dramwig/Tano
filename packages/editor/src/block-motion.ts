import { Plugin, PluginKey, type Transaction } from '@milkdown/kit/prose/state';
import { Mapping, ReplaceAroundStep, ReplaceStep } from '@milkdown/kit/prose/transform';
import type { Node } from '@milkdown/kit/prose/model';
import type { EditorView } from '@milkdown/kit/prose/view';
import { canAnimate, flipFrom, foldClip, ghostExit, riseIn, spring, FOLD_EXIT_DELAY, MOTION_DURATION, type Edge } from './motion';

/* Paragraph-level motion for the editor.
 *
 * Typing inside a line never touches this plugin: only transactions that
 * create, remove or reorder blocks are measured. Before such a transaction
 * reaches the DOM (filterTransaction), the visible blocks' rects are read and
 * any block that is about to disappear is cloned. After the view has drawn
 * the new document, surviving blocks glide from their old place (FLIP), new
 * blocks rise in and removed blocks fade out as inert ghosts outside the
 * ProseMirror DOM, so the document model and DOM observer are never touched.
 *
 * Edits inside a block (a line wraps, a soft break, a code line) change its
 * height without any structural step. Those are caught by a ResizeObserver on
 * the blocks around the caret: the content that follows glides by the same
 * delta, so in-block growth moves the page exactly like a new block does. */

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
/** `tr.setMeta(blockMotionKey, FOLD_MOTION)`: the transaction folds or unfolds
 * content (decorations only, the document is unchanged). */
export const FOLD_MOTION = 'fold';
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

/* Folding ------------------------------------------------------------------ */
/* Folding hides blocks with a display:none decoration, so no step describes
 * it. Rows are compared by DOM visibility instead: content that disappears
 * fades out in place as a ghost, the blocks after it wait FOLD_EXIT_DELAY and
 * then glide up, and each ghost is clipped to the top edge of the first block
 * below it so the transparent text never overlaps. Unfolding is the reverse:
 * revealed content fades in where it lands while the blocks below move away. */
const FOLDED = '.tano-folded-heading-content, .tano-folded-list-content';
const MAX_FOLD_UNITS = 3000;
type FoldUnit = { dom: HTMLElement; parent: number; rect: DOMRect; shown: boolean };

/** Rows that can fold: blocks from `collect`, plus the children of a list
 * item (the part a folded list item hides). `parent` is -1 for top rows. */
function foldUnits(view: EditorView): FoldUnit[] | undefined {
  const units: FoldUnit[] = [];
  const blocks = collect(view.state.doc);
  if (blocks.length > MAX_FOLD_UNITS) return undefined;
  const measure = (dom: HTMLElement, parent: number) => {
    const rect = dom.getBoundingClientRect();
    units.push({ dom, parent, rect, shown: rect.height > 0 && !dom.closest(FOLDED) });
  };
  for (const block of blocks) {
    const dom = element(view, block);
    if (!dom) continue;
    const index = units.length;
    measure(dom, -1);
    if (block.node.type.name !== 'list_item') continue;
    block.node.forEach((child, offset, childIndex) => {
      if (!childIndex) return;
      const nested = view.nodeDOM(block.pos + 1 + offset);
      if (nested instanceof HTMLElement) measure(nested, index);
    });
  }
  return units;
}

type FoldSnapshot = { doc: Node; units: FoldUnit[]; ghosts: Map<number, HTMLElement> };

function captureFold(view: EditorView): FoldSnapshot | undefined {
  const units = foldUnits(view);
  if (!units) return undefined;
  const ghosts = new Map<number, HTMLElement>();
  const bottom = window.innerHeight + VIEW_MARGIN;
  units.forEach((unit, index) => {
    if (unit.shown && ghosts.size < 40 && unit.rect.bottom > -VIEW_MARGIN && unit.rect.top < bottom)
      ghosts.set(index, unit.dom.cloneNode(true) as HTMLElement);
  });
  return { doc: view.state.doc, units, ghosts };
}

function playFold(view: EditorView, snapshot: FoldSnapshot) {
  const after = foldUnits(view);
  const before = snapshot.units;
  if (!after || after.length !== before.length || after.some((unit, index) => unit.dom !== before[index]!.dom)) return;
  const leaving = (index: number) => before[index]!.shown && !after[index]!.shown;
  const stays = (index: number) => before[index]!.shown && after[index]!.shown;
  const delay = before.some((_, index) => leaving(index)) ? FOLD_EXIT_DELAY : 0;
  // A nested row only animates on its own when its list item stays put;
  // otherwise it travels inside its parent's ghost or reveal.
  const own = (index: number) => { const parent = before[index]!.parent; return parent < 0 || stays(parent); };
  const viewBottom = window.innerHeight + VIEW_MARGIN;
  const near = (rect: DOMRect) => rect.bottom > -VIEW_MARGIN && rect.top < viewBottom;
  let layer: HTMLElement | undefined;
  let below: Edge | undefined;
  for (let index = after.length - 1; index >= 0; index--) {
    const was = before[index]!, now = after[index]!;
    if (stays(index)) {
      if (was.parent >= 0) continue;
      below = { from: was.rect.top, to: now.rect.top };
      if (near(now.rect) || near(was.rect)) flipFrom(now.dom, was.rect, now.rect, delay);
      continue;
    }
    if (!own(index)) continue;
    if (leaving(index)) {
      const ghost = snapshot.ghosts.get(index);
      if (!ghost) continue;
      layer ??= ghostLayer(view);
      if (layer) ghostExit(ghost, was.rect, layer, { scale: 0.97, y: -3, cover: below && { edge: below, delay } });
    } else if (now.shown && !was.shown && near(now.rect)) {
      if (below) { const clip = foldClip(now.dom, now.rect.top, below, delay); clip.onfinish = () => clip.cancel(); }
      now.dom.animate([{ opacity: 0 }, { opacity: 1 }],
        { duration: MOTION_DURATION.smooth, easing: spring('smooth'), delay, fill: 'backwards' });
    }
  }
}

/** True when an element's following siblings sit below it, not beside it. */
function stacksVertically(element: HTMLElement) {
  const parent = element.parentElement;
  if (!parent) return false;
  const own = getComputedStyle(element);
  if (own.float !== 'none' || own.position === 'absolute' || own.position === 'fixed') return false;
  const style = getComputedStyle(parent);
  if (style.display.includes('flex')) return style.flexDirection.startsWith('column');
  if (style.display.includes('grid')) return style.gridTemplateColumns === 'none' || !style.gridTemplateColumns.trim().includes(' ');
  // Cells of a row sit side by side; inline parents do not stack at all.
  return style.display !== 'table-row' && !style.display.startsWith('inline') && style.display !== 'contents';
}

/** Glides the content after a block that changed height by `delta`. */
function glideFollowers(element: HTMLElement, delta: number) {
  if (!stacksVertically(element)) return;
  const bottom = window.innerHeight + 80;
  let count = 0;
  for (let sibling = element.nextElementSibling; sibling && count < 60; sibling = sibling.nextElementSibling) {
    if (!(sibling instanceof HTMLElement) || sibling.dataset.motionGhost !== undefined) continue;
    const rect = sibling.getBoundingClientRect();
    if (!rect.height && !rect.width) continue;
    if (rect.top > bottom) break;
    count++;
    sibling.animate([{ translate: `0 ${-delta}px` }, { translate: '0 0' }],
      { duration: MOTION_DURATION.snappy, easing: spring('snappy'), composite: 'add' });
  }
}

/** Watches the blocks that contain the caret, from the textblock up to the
 * top level. Only height changes caused by an edit are animated, so window
 * resizes, image loads and folding keep their own behaviour. */
class GrowthWatcher {
  private observer: ResizeObserver;
  private heights = new Map<Element, number>();
  private watched: HTMLElement[] = [];
  private armed = false;
  private token = 0;

  constructor(private view: EditorView) {
    this.observer = new ResizeObserver(entries => this.resized(entries));
  }

  /** Called after every view update. `edited` is a non-structural doc change. */
  sync(view: EditorView, edited: boolean, structural: boolean) {
    this.view = view;
    const chain = this.chain();
    const same = chain.length === this.watched.length && chain.every((element, index) => element === this.watched[index]);
    if (!same) {
      for (const element of this.watched) if (!chain.includes(element)) { this.observer.unobserve(element); this.heights.delete(element); }
      for (const element of chain) if (!this.watched.includes(element)) this.observer.observe(element);
      this.watched = chain;
    }
    if (structural) {
      // Block motion already moved everything; the next observation only
      // refreshes the recorded heights.
      this.armed = false;
      ++this.token;
    } else if (edited) {
      this.armed = true;
      // Resize observations run after this frame's rAF callbacks, so expire
      // the arm one frame later: unrelated resizes must not glide anything.
      const token = ++this.token;
      requestAnimationFrame(() => requestAnimationFrame(() => { if (token === this.token) this.armed = false; }));
    }
  }

  private chain(): HTMLElement[] {
    const { selection } = this.view.state;
    const $head = selection.$head;
    const chain: HTMLElement[] = [];
    for (let depth = $head.depth; depth >= 1; depth--) {
      const dom = this.view.nodeDOM($head.before(depth));
      if (dom instanceof HTMLElement && this.view.dom.contains(dom)) chain.push(dom);
    }
    return chain;
  }

  private resized(entries: ResizeObserverEntry[]) {
    const armed = this.armed;
    this.armed = false;
    for (const entry of entries) {
      const element = entry.target as HTMLElement;
      const height = entry.borderBoxSize?.[0]?.blockSize ?? element.getBoundingClientRect().height;
      const previous = this.heights.get(element);
      this.heights.set(element, height);
      if (previous === undefined || !armed || !element.isConnected) continue;
      const delta = height - previous;
      if (Math.abs(delta) < 1 || Math.abs(delta) > 600 || !canAnimate(element)) continue;
      glideFollowers(element, delta);
    }
  }

  destroy() {
    this.observer.disconnect();
    this.heights.clear();
    this.watched = [];
  }
}

export type BlockMotionOptions = {
  /** Blocks that are added, removed or reordered. */
  structure?: () => boolean;
  /** Content below a block that grows or shrinks while editing. */
  resize?: () => boolean;
};

export function blockMotion(options: BlockMotionOptions | (() => boolean) = {}) {
  const enabled = typeof options === 'function' ? options : options.structure ?? (() => true);
  const resizing = typeof options === 'function' ? options : options.resize ?? (() => true);
  let view: EditorView | undefined;
  let pending: Snapshot | undefined;
  let folding: FoldSnapshot | undefined;
  let growth: GrowthWatcher | undefined;
  /** Whether any transaction since the last draw rewrapped blocks. */
  let reshaped = false;
  return new Plugin({
    key: blockMotionKey,
    filterTransaction(tr, state) {
      if (!tr.docChanged) {
        if (tr.getMeta(blockMotionKey) === FOLD_MOTION && view && state.doc === view.state.doc && enabled() &&
          view.dom.isConnected && canAnimate(view.dom)) folding = captureFold(view);
        return true;
      }
      if (!reshaped && structural(tr)) reshaped = true;
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
      if (typeof ResizeObserver !== 'undefined') growth = new GrowthWatcher(editorView);
      return {
        update(current, previous) {
          const fold = folding;
          folding = undefined;
          if (fold && fold.doc === current.state.doc && current.dom.isConnected) playFold(current, fold);
          const snapshot = pending;
          pending = undefined;
          const played = !!snapshot && snapshot.doc === current.state.doc && current.dom.isConnected;
          if (played) play(current, snapshot!);
          const changed = current.state.doc !== previous.doc;
          // A structural change that was too big (or off) to animate is still
          // not an in-block edit: never glide followers for it.
          const blocky = played || (changed && reshaped);
          reshaped = false;
          growth?.sync(current, changed && !blocky && resizing(), blocky);
        },
        destroy() { view = undefined; pending = undefined; folding = undefined; growth?.destroy(); growth = undefined; },
      };
    },
  });
}
