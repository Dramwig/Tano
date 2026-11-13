import { Plugin, PluginKey, type EditorState, type Transaction } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import type { Node } from '@milkdown/kit/prose/model';
import { canAnimate, spring, springEasing } from './motion';

/* Live Markdown fields (links, inline code, emphasis, …) open and close with
 * motion instead of jumping.
 *
 * When the caret enters a field, its rendered text is swapped for the source
 * (`Guide` → `[Guide](guide.md)`); when it leaves, the source is swapped back.
 * Whatever the path that made the swap, the result is the same kind of
 * document change, so this plugin only compares the text before and after:
 * characters present on both sides stay put, characters that appear (the
 * Markdown markers) open up in place, characters that disappear close up.
 *
 *   opening  the marker's advance grows from 0 (a negative inline end margin)
 *            while a clip wipes it in from the left: following text slides
 *            out of the way exactly as fast as the marker is revealed.
 *   closing  the removed markers are drawn once more as a widget at the spot
 *            they occupied and close the same way in reverse.
 *   swapping inline math, wiki links and references render as atoms that
 *            share no letters with their source: the new look fades in while
 *            its width tweens from the old width, and the old look is drawn
 *            once more on top, fading out and clipped to the shrinking width.
 *
 * Both are one value `open` (0…1) on one spring, so an animation that is
 * interrupted by the opposite one (leave a field right after entering it)
 * continues from where it was instead of jumping. Nothing here touches the
 * document; decorations are dropped in one quiet transaction when done. */

export const inlineSourceMotionKey = new PluginKey<MorphState>('tano-inline-source-motion');

const SOURCE = 'tano_live_source_inline';
const OPEN_DURATION = 300;
const CLOSE_DURATION = 230;
const SWAP_DURATION = 300;
/** The rendered look leaves faster than the new one settles. */
const SWAP_GHOST_DURATION = 170;
/** Popups drawn inside a field that are not part of its line. */
const FLOATING = '.tano-live-math-preview, .tano-live-mermaid-preview';
/** Longer edits are not a field opening or closing. */
const MAX_TEXT = 400;
const ease = springEasing('smooth');

type Kind = 'grow' | 'exit' | 'swap' | 'lead';
/** What a swapped range looked like just before the swap. */
type SwapGhost = { rect: DOMRect | null; content: DocumentFragment | null; element?: HTMLElement; animation?: Animation };
type Morph = {
  ghost?: SwapGhost | null;
  /** Swap: old width minus new width, fixed once measured. */
  delta?: number;
  id: string;
  kind: Kind;
  /** `open` at the start and end of the animation. */
  from: number;
  to: number;
  start: number;
  duration: number;
  text: string;
  live: Map<HTMLElement, Animation>;
};
type MorphState = { decorations: DecorationSet };
type Change = { decorations: Decoration[]; morphs: Morph[]; drop: string[] };

let serial = 0;

/** The text an inline atom shows that also appears, unchanged, in its source:
 * a wiki link's label sits inside `[[…]]`. Atoms that draw something else
 * (math, references, images) have none. */
function atomLabel(node: Node): string | null {
  if (node.type.name !== 'tano_wiki_link') return null;
  const label: unknown = node.attrs.label || node.attrs.target;
  return typeof label === 'string' && label ? label : null;
  return null;
}

type Char = { ch: string; pos: number; end: number; atom: boolean };
/** Characters of the inline content between `from` and `to`, with their
 * document positions (an atom's label characters all point at the atom).
 * Null when an atom without a shared label is in the way. */
function characters(doc: Node, from: number, to: number) {
  const out: Char[] = [];
  let ok = true;
  doc.nodesBetween(from, to, (node, pos) => {
    if (!ok) return false;
    if (node.isText) {
      const text = node.text!;
      for (let at = Math.max(from, pos); at < Math.min(to, pos + text.length); at++) out.push({ ch: text[at - pos]!, pos: at, end: at + 1, atom: false });
      return false;
    }
    if (node.isInline && node.isLeaf) {
      const label = atomLabel(node);
      if (label === null) ok = false;
      else for (let at = 0; at < label.length; at++) out.push({ ch: label[at]!, pos, end: pos + node.nodeSize, atom: true });
      return false;
    }
    return ok;
  });
  return ok ? out : null;
}

/** Width an atom draws besides its label (an icon, padding). */
function leadWidth(element: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(element);
  if (typeof range.getClientRects !== 'function') return 0;
  const label = oneLine(range.getClientRects());
  const box = element.getBoundingClientRect();
  return label ? Math.max(0, box.width - label.width) : 0;
}

function containsSource(doc: Node, from: number, to: number) {
  let found = false;
  doc.nodesBetween(from, to, (node, pos) => {
    if (found) return false;
    if (node.type.name === SOURCE && pos >= from && pos + node.nodeSize <= to) found = true;
    return !found;
  });
  return found;
}

/** Widen a position to the outside of the source field it sits in. */
function outside(doc: Node, pos: number, side: -1 | 1) {
  const $pos = doc.resolve(pos);
  return $pos.parent.type.name === SOURCE ? (side < 0 ? $pos.before() : $pos.after()) : pos;
}

type Op = { type: 'keep' | 'add' | 'remove'; a: number; b: number };
/** Character alignment that keeps matches as early (and so as contiguous)
 * as possible: `Guide` inside `[Guide](getting-started.md)` matches the
 * link text, not letters of the address. */
export function alignText(before: string, after: string): Op[] {
  const n = before.length, m = after.length, w = m + 1;
  const table = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      table[i * w + j] = before[i] === after[j] ? table[(i + 1) * w + j + 1]! + 1 : Math.max(table[(i + 1) * w + j]!, table[i * w + j + 1]!);
  const ops: Op[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j] && table[i * w + j] === table[(i + 1) * w + j + 1]! + 1) ops.push({ type: 'keep', a: i++, b: j++ });
    else if (table[(i + 1) * w + j]! >= table[i * w + j + 1]!) ops.push({ type: 'remove', a: i++, b: j });
    else ops.push({ type: 'add', a: i, b: j++ });
  }
  while (i < n) ops.push({ type: 'remove', a: i++, b: j });
  while (j < m) ops.push({ type: 'add', a: i, b: j++ });
  return ops;
}

function openAt(morph: Morph, now: number) {
  const progress = Math.min(1, Math.max(0, (now - morph.start) / morph.duration));
  return morph.from + (morph.to - morph.from) * ease(progress);
}

/** The box of rects that sit on one line, or null when they wrap. */
function oneLine(rects: Iterable<DOMRect>): DOMRect | null {
  let box: DOMRect | null = null;
  for (const rect of rects) {
    if (rect.width < 0.5 || rect.height <= 0) continue;
    if (!box) { box = DOMRect.fromRect(rect); continue; }
    if (Math.abs(rect.top - box.top) > box.height / 2) return null;
    const left = Math.min(box.left, rect.left), right = Math.max(box.right, rect.right);
    const top = Math.min(box.top, rect.top), bottom = Math.max(box.bottom, rect.bottom);
    box = new DOMRect(left, top, right - left, bottom - top);
  }
  return box;
}

/** Read the range as it is drawn now, before ProseMirror redraws it. */
function captureSwap(view: EditorView, from: number, to: number): SwapGhost | null {
  try {
    const start = view.domAtPos(from, 1), end = view.domAtPos(to, -1);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    if (range.collapsed) return null;
    // Floating previews (the rendered formula under math source) are not part
    // of the line: leave them out of the measurement and the copy.
    const host = range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    const floating = [...host?.querySelectorAll<HTMLElement>(FLOATING) ?? []].filter(element => range.intersectsNode(element)).map(element => element.getBoundingClientRect());
    const inside = (rect: DOMRect) => floating.some(box => rect.left >= box.left - 0.5 && rect.right <= box.right + 0.5 && rect.top >= box.top - 0.5 && rect.bottom <= box.bottom + 0.5);
    let rect = oneLine([...range.getClientRects()].filter(rect => !inside(rect)));
    if (rect) {
      // Something still opening or closing here takes up its current advance,
      // not its box: start from what is on screen.
      let extra = 0;
      for (const element of view.dom.querySelectorAll<HTMLElement>('.tano-source-morph'))
        if (range.intersectsNode(element)) extra += parseFloat(getComputedStyle(element).marginInlineEnd) || 0;
      rect = new DOMRect(rect.left, rect.top, Math.max(0, rect.width + extra), rect.height);
    }
    const content = rect ? range.cloneContents() : null;
    content?.querySelectorAll('[data-morph]').forEach(node => node.removeAttribute('data-morph'));
    content?.querySelectorAll(FLOATING).forEach(node => node.remove());
    return { rect, content };
  } catch { return null; }
}

/** Overlay next to (never inside) the ProseMirror DOM, with its typography. */
function overlay(view: EditorView, existing?: HTMLElement) {
  const parent = view.dom.parentElement;
  if (!parent) return undefined;
  if (existing?.parentElement === parent) return existing;
  existing?.remove();
  const layer = document.createElement('div');
  layer.className = [...view.dom.classList].filter(name => !/^ProseMirror|^tano-smooth-caret$/.test(name)).join(' ');
  layer.classList.add('tano-type-layer');
  layer.setAttribute('aria-hidden', 'true');
  layer.inert = true;
  parent.append(layer);
  return layer;
}

export type InlineSourceMotionOptions = { enabled?: () => boolean };

export function inlineSourceMotion(options: InlineSourceMotionOptions = {}) {
  const enabled = options.enabled ?? (() => true);
  const morphs = new Map<string, Morph>();
  let view: EditorView | undefined;
  let layer: HTMLElement | undefined;
  let settleTimer = 0;

  /** Work out which characters a source swap adds and removes. */
  function describe(tr: Transaction, previous: DecorationSet, now: number): Change | null {
    const start0 = tr.before.content.findDiffStart(tr.doc.content);
    const end0 = tr.before.content.findDiffEnd(tr.doc.content);
    if (start0 == null || !end0) return null;
    let start = start0, endA = Math.max(end0.a, start), endB = Math.max(end0.b, start);
    // Typing inside an open field is the typing motion's business.
    const inside = (doc: Node, pos: number) => doc.resolve(pos).parent.type.name === SOURCE;
    if (inside(tr.before, start) && inside(tr.doc, start) && inside(tr.before, endA) && inside(tr.doc, endB)) return null;
    start =Math.min(outside(tr.before, start, -1), outside(tr.doc, start, -1));
    const grow = Math.max(outside(tr.before, endA, 1) - endA, outside(tr.doc, endB, 1) - endB);
    endA += grow; endB += grow;
    if (endA - start > MAX_TEXT * 2 || endB - start > MAX_TEXT * 2) return null;
    const $a = tr.before.resolve(start), $b = tr.doc.resolve(start);
    if (!$a.parent.inlineContent || !$b.parent.inlineContent ||
        !$a.sameParent(tr.before.resolve(endA)) || !$b.sameParent(tr.doc.resolve(endB))) return null;
    if (!containsSource(tr.doc, start, endB) && !containsSource(tr.before, start, endA)) return null;

    const swap = (): Change | null => {
      // Inline math and references render as atoms that share no letters
      // with their source: cross-fade, and tween the width between them.
      if (endB <= start) return null;
      const id = `m${++serial}`;
      const drop = previous.find(start, endA, spec => spec.kind === 'swap').map(deco => deco.spec.morph as string);
      const ghost = view && view.state.doc === tr.before ? captureSwap(view, start, endA) : null;
      const morph: Morph = { id, kind: 'swap', from: 0, to: 1, start: now, duration: SWAP_DURATION, text: '', live: new Map(), ghost };
      const decoration = Decoration.inline(start, endB, { class: 'tano-source-morph', 'data-morph': id }, { morph: id, kind: 'swap' });
      return { decorations: [decoration], morphs: [morph], drop };
    };
    const before = characters(tr.before, start, endA);
    const after = characters(tr.doc, start, endB);
    if (!before || !after) return swap();
    if (before.length > MAX_TEXT || after.length > MAX_TEXT) return null;

    const ops = alignText(before.map(c => c.ch).join(''), after.map(c => c.ch).join(''));
    // A wiki link's label must survive whole, or it is not the same text.
    const keptLabel = (chars: Char[], side: 'a' | 'b') => {
      const kept = new Map<number, number>();
      for (const op of ops) if (op.type === 'keep' && chars[op[side]]!.atom) kept.set(chars[op[side]]!.pos, (kept.get(chars[op[side]]!.pos) ?? 0) + 1);
      return chars.every(char => !char.atom || kept.has(char.pos)) &&
        [...kept].every(([pos, count]) => count === chars.filter(char => char.pos === pos).length);
    };
    if (!keptLabel(before, 'a') || !keptLabel(after, 'b')) return swap();

    const change: Change = { decorations: [], morphs: [], drop: [] };
    const fresh = (kind: Kind, from: number, to: number, duration: number, text = '') => {
      const id = `m${++serial}`;
      change.morphs.push({ id, kind, from, to, start: now, duration, text, live: new Map() });
      return id;
    };
    let index = 0;
    /** Document position (after the change) just past the last character placed. */
    let cursor = start;
    /** Same, but only moved by kept characters: where a label's lead belongs. */
    let keptCursor = start;
    const seenAtoms = new Set<number>();
    while (index < ops.length) {
      const op = ops[index]!;
      if (op.type === 'keep') {
        const old = before[op.a]!, next = after[op.b]!;
        // An atom's icon and padding come and go with the label.
        if (old.atom && !next.atom && !seenAtoms.has(old.pos)) {
          seenAtoms.add(old.pos);
          const dom = view && view.state.doc === tr.before ? view.nodeDOM(old.pos) : null;
          if (dom instanceof HTMLElement && leadWidth(dom) > 0.5) {
            const element = document.createElement('span');
            element.className = 'tano-source-morph tano-source-exit tano-source-lead';
            const lead = dom.cloneNode(false) as HTMLElement;
            lead.removeAttribute('contenteditable');
            lead.removeAttribute('href');
            lead.classList.remove('ProseMirror-selectednode', 'tano-live-wiki', 'tano-source-morph');
            lead.removeAttribute('data-morph');
            element.append(lead);
            // Leaves at the pace the markers arrive, so the label glides evenly.
            const id = fresh('exit', 1, 0, OPEN_DURATION);
            element.dataset.morph = id;
            change.decorations.push(Decoration.widget(keptCursor, element, { side: keptCursor > start ? -1 : 1, key: id, morph: id, kind: 'exit', ignoreSelection: true, marks: [] }));
          }
        }
        if (next.atom && !old.atom && !seenAtoms.has(-1 - next.pos)) {
          seenAtoms.add(-1 - next.pos);
          const id = fresh('lead', 0, 1, CLOSE_DURATION);
          change.decorations.push(Decoration.node(next.pos, next.end, { class: 'tano-source-morph', 'data-morph': id }, { morph: id, kind: 'lead' }));
        }
        cursor = keptCursor = next.end;
        index++;
        continue;
      }
      const type = op.type;
      let end = index + 1;
      // A run: same kind, contiguous in the document.
      while (end < ops.length && ops[end]!.type === type && (type === 'add'
        ? after[ops[end]!.b]!.pos === after[ops[end - 1]!.b]!.end
        : before[ops[end]!.a]!.pos === before[ops[end - 1]!.a]!.end)) end++;
      const run = ops.slice(index, end);
      index = end;
      if (type === 'add') {
        if (run.some(o => after[o.b]!.atom)) return swap();
        const from = after[run[0]!.b]!.pos, to = after[run.at(-1)!.b]!.end;
        const text = run.map(o => after[o.b]!.ch).join('');
        cursor = to;
        // Re-opening something that is still closing continues from there.
        let open = 0;
        for (const widget of previous.find(undefined, undefined, spec => spec.kind === 'exit')) {
          const morph = morphs.get(widget.spec.morph as string);
          if (!morph || morph.text !== text) continue;
          const at = tr.mapping.map(widget.from);
          if (at !== from && at !== to) continue;
          open = Math.max(open, openAt(morph, now));
          change.drop.push(morph.id);
        }
        if (open >= 0.98) continue;
        const id = fresh('grow', open, 1, OPEN_DURATION, text);
        change.decorations.push(Decoration.inline(from, to, { class: 'tano-source-morph', 'data-morph': id }, { morph: id, kind: 'grow' }));
      } else {
        if (run.some(o => before[o.a]!.atom)) return swap();
        const oldFrom = before[run[0]!.a]!.pos, oldTo = before[run.at(-1)!.a]!.end;
        const text = run.map(o => before[o.a]!.ch).join('');
        // Closing something that is still opening continues from there.
        let open = 1;
        const growing = previous.find(oldFrom, oldTo, spec => spec.kind === 'grow');
        if (growing.length) open = Math.min(...growing.map(deco => {
          const morph = morphs.get(deco.spec.morph as string);
          return morph ? openAt(morph, now) : 1;
        }));
        if (open <= 0.04) continue;
        const element = document.createElement('span');
        element.className = 'tano-source-morph tano-source-exit';
        element.textContent = text;
        const id = fresh('exit', open, 0, CLOSE_DURATION, text);
        element.dataset.morph = id;
        // Text closing after kept text stays with it; leading text stays with what follows.
        const side = cursor > start ? -1 : 1;
        change.decorations.push(Decoration.widget(cursor, element, { side, key: id, morph: id, kind: 'exit', ignoreSelection: true, marks: [] }));
      }
    }
    return change.morphs.length || change.drop.length ? change : null;
  }

  function keyframes(morph: Morph, element: HTMLElement): Keyframe[] {
    const frame = (open: number): Keyframe => ({ opacity: open });
    if (morph.kind === 'lead') {
      // The atom's icon/padding opens from its left edge; the label stays put.
      const lead = leadWidth(element);
      if (lead < 0.5) return [];
      return [
        { marginInlineStart: `${-lead}px`, clipPath: `inset(-0.3em 0px -0.3em ${lead}px)` },
        { marginInlineStart: '0px', clipPath: 'inset(-0.3em 0px -0.3em 0px)' },
      ];
    }
    // Wrapped across lines an inline box cannot be narrowed as one piece.
    const rects = element.getClientRects();
    if (rects.length !== 1) return [frame(morph.from), frame(morph.to)];
    const width = rects[0]!.width;
    const shape = (open: number): Keyframe => ({
      opacity: open,
      marginInlineEnd: `${-(1 - open) * width}px`,
      clipPath: `inset(-0.2em ${(1 - open) * 100}% -0.2em 0)`,
    });
    return [shape(morph.from), shape(morph.to)];
  }

  /** A swap: the new look fades in while its width tweens from the old one;
   * the old look is drawn once more on top and fades out, clipped so it never
   * covers text that slides in. */
  function swapFrames(morph: Morph, elements: HTMLElement[]): [HTMLElement, Keyframe[]][] {
    const fade = (element: HTMLElement): [HTMLElement, Keyframe[]] => [element, [{ opacity: 0 }, { opacity: 1 }]];
    const old = morph.ghost?.rect;
    const rect = old ? oneLine(elements.flatMap(element => [...element.getClientRects()])) : null;
    if (!old || !rect) return elements.map(fade);
    const delta = old.width - rect.width;
    morph.delta ??= delta;
    const last = elements.at(-1)!;
    // Growing: reveal the new look only as far as its space has opened up.
    const lastWidth = last.getBoundingClientRect().width;
    const hidden = morph.delta < 0 ? Math.min(100, -morph.delta / Math.max(1, lastWidth) * 100) : 0;
    return elements.map(element => element === last
      ? [element, [
        { opacity: 0, marginInlineEnd: `${morph.delta}px`, clipPath: `inset(-0.3em ${hidden}% -0.3em 0)` },
        { opacity: 1, marginInlineEnd: '0px', clipPath: 'inset(-0.3em 0% -0.3em 0)' },
      ]]
      : fade(element));
  }

  function showGhost(morph: Morph, now: number) {
    const ghost = morph.ghost;
    const host = view && (layer = overlay(view, layer));
    if (!ghost?.rect || !ghost.content || ghost.element || !host || morph.delta === undefined) return;
    const element = document.createElement('span');
    element.className = 'tano-type-ghost tano-source-ghost';
    element.append(ghost.content);
    Object.assign(element.style, { left: '0px', top: '0px', height: `${ghost.rect.height}px`, lineHeight: `${ghost.rect.height}px` });
    host.append(element);
    const placed = element.getBoundingClientRect();
    element.style.left = `${ghost.rect.left - placed.left}px`;
    element.style.top = `${ghost.rect.top - placed.top}px`;
    element.style.width = `${ghost.rect.width}px`;
    element.style.overflow = 'hidden';
    const shrink = Math.max(0, morph.delta) / Math.max(1, ghost.rect.width) * 100;
    const elapsed = Math.max(0, now - morph.start);
    const clip = element.animate([{ clipPath: 'inset(-0.3em 0% -0.3em 0)' }, { clipPath: `inset(-0.3em ${shrink}% -0.3em 0)` }],
      { duration: morph.duration, easing: spring('smooth'), fill: 'both' });
    clip.currentTime = elapsed;
    const fade = element.animate([{ opacity: 1, filter: 'blur(0px)' }, { opacity: 0, filter: 'blur(1.5px)' }],
      { duration: SWAP_GHOST_DURATION, easing: 'cubic-bezier(0.32, 0, 0.24, 1)', fill: 'both' });
    fade.currentTime = elapsed;
    ghost.element = element;
    ghost.animation = fade;
    fade.onfinish = () => { clip.cancel(); element.remove(); };
    window.setTimeout(() => element.remove(), morph.duration + 200);
  }

  /** Start (or pick up, for nodes ProseMirror redrew) every running morph. */
  function sync(root: HTMLElement, now = performance.now()) {
    const pending: [Morph, HTMLElement, Keyframe[]][] = [];
    const swapped: Morph[] = [];
    for (const morph of morphs.values()) {
      for (const [element, animation] of morph.live)
        if (!element.isConnected) { animation.cancel(); morph.live.delete(element); }
      if (now - morph.start >= morph.duration) continue;
      // Outermost elements only: a decorated field can nest decorated text.
      const elements = [...root.querySelectorAll<HTMLElement>(`[data-morph="${morph.id}"]`)]
        .filter(element => !element.parentElement?.closest(`[data-morph="${morph.id}"]`));
      if (morph.kind === 'swap') {
        if (elements.every(element => morph.live.has(element))) continue;
        // A redraw restarts every piece together so the width stays consistent.
        for (const animation of morph.live.values()) animation.cancel();
        morph.live.clear();
        // Measure everything first, at rest, then animate.
        for (const [element, frames] of swapFrames(morph, elements)) pending.push([morph, element, frames]);
        swapped.push(morph);
        continue;
      }
      for (const element of elements) {
        if (morph.live.has(element)) continue;
        pending.push([morph, element, keyframes(morph, element)]);
      }
    }
    for (const [morph, element, frames] of pending) {
      if (!frames.length) continue;
      const animation = element.animate(frames, { duration: morph.duration, easing: spring('smooth'), fill: 'both' });
      animation.currentTime = Math.max(0, now - morph.start);
      morph.live.set(element, animation);
    }
    for (const morph of swapped) showGhost(morph, now);
  }

  function scheduleSettle() {
    window.clearTimeout(settleTimer);
    let last = 0;
    for (const morph of morphs.values()) last = Math.max(last, morph.start + morph.duration);
    if (!morphs.size) return;
    settleTimer = window.setTimeout(settle, Math.max(16, last - performance.now() + 30));
  }

  function settle() {
    settleTimer = 0;
    if (!view || view.isDestroyed) return;
    if (view.composing) { settleTimer = window.setTimeout(settle, 200); return; }
    const now = performance.now();
    const done = [...morphs.values()].filter(morph => now - morph.start >= morph.duration).map(morph => morph.id);
    if (done.length) view.dispatch(view.state.tr.setMeta(inlineSourceMotionKey, { drop: done }).setMeta('addToHistory', false));
    scheduleSettle();
  }

  function forget(ids: string[]) {
    for (const id of ids) {
      const morph = morphs.get(id);
      if (!morph) continue;
      for (const animation of morph.live.values()) animation.cancel();
      morph.ghost?.element?.remove();
      morphs.delete(id);
    }
  }

  return new Plugin<MorphState>({
    key: inlineSourceMotionKey,
    state: {
      init: () => ({ decorations: DecorationSet.empty }),
      apply(tr, value, _old, state: EditorState) {
        let decorations = value.decorations;
        const meta = tr.getMeta(inlineSourceMotionKey) as { drop: string[] } | undefined;
        if (meta?.drop.length) {
          const drop = new Set(meta.drop);
          decorations = decorations.remove(decorations.find(undefined, undefined, spec => drop.has(spec.morph as string)));
          forget(meta.drop);
        }
        if (!tr.docChanged) return decorations === value.decorations ? value : { decorations };
        const previous = decorations;
        decorations = decorations.map(tr.mapping, tr.doc);
        const change = view && enabled() && canAnimate(view.dom) && !view.composing ? describe(tr, previous, performance.now()) : null;
        if (change) {
          if (change.drop.length) {
            const drop = new Set(change.drop);
            decorations = decorations.remove(decorations.find(undefined, undefined, spec => drop.has(spec.morph as string)));
            forget(change.drop);
          }
          for (const morph of change.morphs) morphs.set(morph.id, morph);
          decorations = decorations.add(state.doc, change.decorations);
        }
        return { decorations };
      },
    },
    props: {
      decorations: state => inlineSourceMotionKey.getState(state)?.decorations,
    },
    view(editorView) {
      view = editorView;
      return {
        update(current) {
          view = current;
          if (!morphs.size) return;
          sync(current.dom);
          scheduleSettle();
        },
        destroy() {
          window.clearTimeout(settleTimer);
          forget([...morphs.keys()]);
          layer?.remove();
          layer = undefined;
          view = undefined;
        },
      };
    },
  });
}
