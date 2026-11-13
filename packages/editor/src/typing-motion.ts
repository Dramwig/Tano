import { Plugin, PluginKey, type EditorState, type Transaction } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import type { Node } from '@milkdown/kit/prose/model';
import { EASE_PRESS, canAnimate, reducedMotion, spring } from './motion';

/* Character-level motion for the editor: typed text fades in, deleted text
 * leaves as an inert ghost, and the caret glides between positions instead of
 * jumping. Every effect is interruptible: a repeat of the same gesture (key
 * repeat, fast typing) shortens or hands over the running animation instead
 * of stacking new ones on top of it.
 *
 * Nothing here changes the document. Typed text is marked with short-lived
 * inline decorations that are dropped in one pass once typing pauses. Their
 * fade is driven by WAAPI with an absolute start time, so when ProseMirror
 * redraws a span (it does, on the next keystroke) the fade resumes where it
 * was instead of restarting. Deleted
 * text and the caret live in an overlay layer next to (never inside) the
 * ProseMirror DOM. IME composition is left untouched: only the committed text
 * gets a lighter settle, after the browser has finished composing. */

type TypingState = { decorations: DecorationSet; count: number };
export const typingMotionKey = new PluginKey<TypingState>('tano-typing-motion');

const MAX_TYPED = 64;
const MAX_LIVE_DECORATIONS = 160;
const SETTLE_AFTER = 460;
const MAX_GHOST_TEXT = 120;
const TYPED_FADE = 190;
const TYPED_FADE_IME = 240;
/** Two edits closer than this are one continuous gesture (key repeat). */
const RAPID = 150;

type StepLike = { from?: number; to?: number; gapFrom?: number; slice?: { size: number; openStart: number; openEnd: number; content: { forEach: (f: (node: Node) => void) => void } } };
function singleReplace(tr: Transaction) {
  if (tr.steps.length !== 1) return null;
  // Duck-typed so a duplicated prosemirror-transform copy cannot hide steps.
  const step = tr.steps[0] as unknown as StepLike;
  if (step.gapFrom !== undefined || !step.slice || step.from === undefined || step.to === undefined) return null;
  return step as Required<Pick<StepLike, 'from' | 'to' | 'slice'>>;
}
function textOnly(slice: NonNullable<StepLike['slice']>) {
  if (slice.openStart || slice.openEnd) return false;
  let text = true;
  slice.content.forEach(node => { if (!node.isText) text = false; });
  return text;
}
const UI_EVENTS = new Set(['paste', 'drop', 'cut']);

/** The range of text the user just typed (or committed from an IME), if `tr`
 * is exactly that. Pastes, drops, structural edits and programmatic
 * replacements away from the caret are not typing. */
export function typedRange(tr: Transaction): { from: number; to: number } | null {
  if (!tr.docChanged || UI_EVENTS.has(tr.getMeta('uiEvent') as string) || tr.getMeta(typingMotionKey) === false) return null;
  // IME text is handled once composition has ended (see compositionend).
  if (tr.getMeta('composition') !== undefined) return null;
  const step = singleReplace(tr);
  if (!step || !step.slice.size || step.slice.size > MAX_TYPED || !textOnly(step.slice)) return null;
  const doc = tr.docs[0]!;
  const $from = doc.resolve(step.from);
  if (!$from.parent.isTextblock || $from.parent.type.spec.code || !$from.sameParent(doc.resolve(step.to))) return null;
  const end = step.from + step.slice.size;
  if (!tr.selection.empty || tr.selection.head !== end) return null;
  return { from: step.from, to: end };
}

/** A pure in-line deletion (or the replaced part of typing over a selection). */
function deletedRange(tr: Transaction, state: EditorState) {
  if (!tr.docChanged || UI_EVENTS.has(tr.getMeta('uiEvent') as string) || tr.getMeta('composition') !== undefined) return null;
  const step = singleReplace(tr);
  if (!step || step.to <= step.from || step.to - step.from > MAX_GHOST_TEXT || (step.slice.size && !textOnly(step.slice))) return null;
  const $from = state.doc.resolve(step.from);
  if (!$from.parent.isTextblock || !$from.sameParent(state.doc.resolve(step.to))) return null;
  return { from: step.from, to: step.to, text: state.doc.textBetween(step.from, step.to) };
}

/* ------------------------------------------------------------------------ */
/* Overlay layer                                                             */
/* ------------------------------------------------------------------------ */

function overlay(view: EditorView, existing?: HTMLElement): HTMLElement | undefined {
  const parent = view.dom.parentElement;
  if (!parent) return undefined;
  if (existing && existing.parentElement === parent) return existing;
  existing?.remove();
  const layer = document.createElement('div');
  // Same prose classes, so ghosts keep their typography; never ProseMirror.
  layer.className = [...view.dom.classList].filter(name => !/^ProseMirror|^tano-smooth-caret$/.test(name)).join(' ');
  layer.classList.add('tano-type-layer');
  layer.setAttribute('aria-hidden', 'true');
  layer.inert = true;
  parent.append(layer);
  return layer;
}

function lineRect(range: Range): DOMRect | null {
  const rects = [...range.getClientRects()].filter(rect => rect.width > 0.5 && rect.height > 0);
  if (!rects.length) return null;
  const first = rects[0]!;
  let left = first.left, right = first.right, top = first.top, bottom = first.bottom;
  for (const rect of rects.slice(1)) {
    // Text that wraps over two lines would be redrawn on one; skip it.
    if (Math.abs(rect.top - first.top) > first.height / 2) return null;
    left = Math.min(left, rect.left); right = Math.max(right, rect.right);
    top = Math.min(top, rect.top); bottom = Math.max(bottom, rect.bottom);
  }
  return new DOMRect(left, top, right - left, bottom - top);
}

type DeletionGhost = { rect: DOMRect; content: DocumentFragment; style: CSSStyleDeclaration; collapse: 'start' | 'center' };

/** Read what a DOM range looks like now, before the browser removes it. */
function captureGhost(view: EditorView, range: Range, collapse: DeletionGhost['collapse']): DeletionGhost | null {
  if (range.collapsed || !view.dom.contains(range.commonAncestorContainer)) return null;
  const text = range.toString();
  if (!text.trim() || text.length > MAX_GHOST_TEXT || text.includes('\n')) return null;
  const rect = lineRect(range);
  if (!rect) return null;
  const anchor = range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer as Element;
  if (!anchor || anchor.closest('[contenteditable="false"]')) return null;
  const content = range.cloneContents();
  for (const node of content.querySelectorAll('.tano-typed')) node.classList.remove('tano-typed', 'tano-typed-ime');
  return { rect, content, style: getComputedStyle(anchor), collapse };
}

const liveGhosts = new WeakMap<HTMLElement, { animations: Set<Animation>; last: number }>();

function playGhost(layer: HTMLElement, ghost: DeletionGhost) {
  let live = liveGhosts.get(layer);
  if (!live) liveGhosts.set(layer, live = { animations: new Set(), last: -Infinity });
  const now = performance.now();
  const rapid = now - live.last < RAPID;
  live.last = now;
  // Hand over: earlier ghosts hurry out so a held key never leaves a trail
  // of letters to the right of the caret.
  for (const running of live.animations) running.playbackRate = rapid ? 6 : 2.5;
  const { rect, style } = ghost;
  const element = document.createElement('span');
  element.className = 'tano-type-ghost';
  element.append(ghost.content);
  Object.assign(element.style, {
    left: '0px', top: '0px', height: `${rect.height}px`, lineHeight: `${rect.height}px`,
    fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, fontStyle: style.fontStyle,
    fontFeatureSettings: style.fontFeatureSettings, letterSpacing: style.letterSpacing, color: style.color,
    transformOrigin: ghost.collapse === 'start' ? '0% 60%' : '50% 60%',
  });
  layer.append(element);
  const placed = element.getBoundingClientRect();
  element.style.left = `${rect.left - placed.left}px`;
  element.style.top = `${rect.top - placed.top}px`;
  const animation = element.animate([
    { opacity: 1, scale: '1', translate: '0 0', filter: 'blur(0px)' },
    { opacity: 0, scale: ghost.collapse === 'start' ? '0.55' : '0.85', translate: '0 -0.12em', filter: 'blur(2px)' },
  ], { duration: rapid ? 110 : 190, easing: EASE_PRESS, fill: 'forwards' });
  live.animations.add(animation);
  const remove = () => { element.remove(); live!.animations.delete(animation); };
  animation.onfinish = remove;
  animation.oncancel = remove;
  window.setTimeout(remove, 600);
}

function domRange(view: EditorView, from: number, to: number): Range | null {
  try {
    const start = view.domAtPos(from, 1), end = view.domAtPos(to, -1);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
  } catch { return null; }
}

/* ------------------------------------------------------------------------ */
/* Smooth caret                                                              */
/* ------------------------------------------------------------------------ */

type CaretMode = 'glide' | 'snap' | 'follow';
const MODE_RANK: Record<CaretMode, number> = { follow: 0, glide: 1, snap: 2 };

class SmoothCaret {
  readonly element: HTMLElement;
  private x = 0;
  private y = 0;
  private height = 0;
  private shown = false;
  private frame = 0;
  private mode: CaretMode | undefined;
  private idleTimer = 0;
  private tracking = 0;
  private lastMove = -Infinity;

  constructor(private view: EditorView, private layer: () => HTMLElement | undefined, private enabled: () => boolean) {
    this.element = document.createElement('div');
    this.element.className = 'tano-caret';
    this.element.hidden = true;
  }

  schedule(mode: CaretMode = 'glide') {
    if (!this.mode || MODE_RANK[mode] > MODE_RANK[this.mode]) this.mode = mode;
    if (!this.frame) this.frame = requestAnimationFrame(() => this.measure());
  }

  setView(view: EditorView) { this.view = view; }

  hide() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.mode = undefined;
    this.view.dom.classList.remove('tano-smooth-caret');
    if (!this.shown) return;
    this.shown = false;
    this.element.hidden = true;
    this.element.classList.remove('is-idle');
  }

  destroy() {
    this.hide();
    window.clearTimeout(this.idleTimer);
    this.element.remove();
  }

  private target() {
    const view = this.view;
    if (!this.enabled() || !view.editable || reducedMotion() || !view.dom.isConnected) return null;
    const root = view.root as Document | ShadowRoot;
    if (root.activeElement !== view.dom) return null;
    const selection = view.state.selection;
    if (!selection.empty || !selection.$head.parent.inlineContent) return null;
    const dom = (root as Document).getSelection?.() ?? document.getSelection();
    if (!dom || !dom.rangeCount || !dom.isCollapsed || !dom.anchorNode || !view.dom.contains(dom.anchorNode)) return null;
    const anchor = dom.anchorNode.nodeType === 3 ? dom.anchorNode.parentElement : dom.anchorNode as Element;
    if (!anchor || anchor.closest('[contenteditable="false"]')) return null;
    let rect: { left: number; top: number; bottom: number } | undefined;
    const range = dom.getRangeAt(0);
    const rects = range.getClientRects();
    if (rects.length && rects[0]!.height > 0) rect = rects[0]!;
    else {
      try { rect = view.coordsAtPos(selection.head, 1); } catch { rect = undefined; }
    }
    if (!rect || rect.bottom - rect.top <= 0) return null;
    // Ride along with a block that is still gliding (typed-text fades only
    // change opacity and do not count).
    let moving = false;
    for (let node: Element | null = anchor; node && node !== view.dom.parentElement && !moving; node = node.parentElement) {
      if (!node.classList.contains('tano-typed') && typeof node.getAnimations === 'function' && node.getAnimations().some(animation => animation.playState === 'running')) moving = true;
    }
    return { left: rect.left, top: rect.top, height: rect.bottom - rect.top, color: getComputedStyle(anchor).color, moving };
  }

  private measure() {
    this.frame = 0;
    const mode = this.mode ?? 'glide';
    this.mode = undefined;
    const target = this.target();
    const layer = target && this.layer();
    if (!target || !layer) { this.hide(); return; }
    if (this.element.parentElement !== layer) layer.append(this.element);
    const origin = layer.getBoundingClientRect();
    const x = Math.round((target.left - origin.left) * 2) / 2 - 1;
    const y = target.top - origin.top;
    const height = target.height;
    const dx = x - this.x, dy = y - this.y;
    const jump = mode === 'snap' || !this.shown || Math.abs(dy) > Math.max(this.height, height) * 3.2 || Math.hypot(dx, dy) > 720;
    const style = this.element.style;
    style.backgroundColor = target.color;
    if (jump) {
      style.transition = 'none';
      style.translate = `${x}px ${y}px`;
      style.height = `${height}px`;
      if (!this.shown) {
        this.shown = true;
        this.element.hidden = false;
      }
      void this.element.offsetWidth;
      style.transition = '';
      this.element.animate([{ scale: '1 0.4', opacity: 0 }, { scale: '1 1', opacity: 1 }], { duration: 300, easing: spring('bouncy') });
    } else if (Math.abs(dx) >= 0.25 || Math.abs(dy) >= 0.25 || Math.abs(height - this.height) >= 0.25) {
      const distance = Math.hypot(dx, dy);
      const now = performance.now();
      // Key repeat and fast typing retarget a glide that is still running:
      // track tightly without overshoot so the caret never runs ahead.
      const rapid = mode !== 'follow' && now - this.lastMove < RAPID;
      if (mode !== 'follow') this.lastMove = now;
      // A typed character is a short hop; a new line or word jump is a glide.
      const duration = mode === 'follow' ? 140 : rapid ? Math.min(90, 50 + distance) : Math.abs(dy) > 1 ? 300 : Math.min(240, 100 + distance * 0.9);
      const easing = spring(mode === 'follow' || rapid ? 'smooth' : 'snappy');
      style.transition = `translate ${duration}ms ${easing}, height ${duration}ms ${easing}, background-color 160ms ease`;
      style.translate = `${x}px ${y}px`;
      style.height = `${height}px`;
    }
    this.x = x; this.y = y; this.height = height;
    this.view.dom.classList.add('tano-smooth-caret');
    // Solid while moving, then breathe.
    if (mode !== 'follow' || jump) {
      this.element.classList.remove('is-idle');
      window.clearTimeout(this.idleTimer);
      this.idleTimer = window.setTimeout(() => this.element.classList.add('is-idle'), 520);
    }
    // Ride along while the surrounding block or text is still animating.
    if (target.moving && this.tracking < 90) { this.tracking++; this.schedule('follow'); }
    else this.tracking = 0;
  }
}

/** Gives every typed span its fade, anchored to when the text was typed. A
 * span ProseMirror re-created keeps its progress; one that already has the
 * animation is left alone. */
const fades = new WeakMap<HTMLElement, { at: number; animation: Animation }>();
function fadeTyped(view: EditorView) {
  const now = performance.now();
  for (const span of view.dom.querySelectorAll<HTMLElement>('.tano-typed[data-typed-at]')) {
    if (typeof span.animate !== 'function') continue;
    const at = Number(span.dataset.typedAt);
    // A reused span may now hold different text typed at another moment.
    const current = fades.get(span);
    if (current?.at === at) continue;
    current?.animation.cancel();
    const ime = span.classList.contains('tano-typed-ime');
    const duration = ime ? TYPED_FADE_IME : TYPED_FADE;
    if (!(now - at < duration)) continue;
    const animation = span.animate(ime
      ? [{ opacity: 0.4, filter: 'blur(0.8px)' }, { opacity: 1, filter: 'blur(0px)' }]
      : [{ opacity: 0, filter: 'blur(1.6px)' }, { opacity: 1, filter: 'blur(0px)' }],
    { duration, easing: 'cubic-bezier(0.25, 0.1, 0.25, 1)' });
    try { animation.startTime = at; } catch { /* timeline without startTime support */ }
    fades.set(span, { at, animation });
  }
}

/* ------------------------------------------------------------------------ */
/* Plugin                                                                    */
/* ------------------------------------------------------------------------ */

type SettleMeta = 'settle' | { from: number; to: number; ime: true };

export type TypingMotionOptions = {
  /** Typed text fades in and deleted text fades out. */
  text?: () => boolean;
  /** The drawn, gliding caret. */
  caret?: () => boolean;
};

export function typingMotion(options: TypingMotionOptions | (() => boolean) = {}) {
  const enabled = typeof options === 'function' ? options : options.text ?? (() => true);
  const caretEnabled = typeof options === 'function' ? options : options.caret ?? (() => true);
  let view: EditorView | undefined;
  let caret: SmoothCaret | undefined;
  /** Where the current IME composition started, mapped through its edits. */
  let composeFrom: number | undefined;
  let layer: HTMLElement | undefined;
  /** Text the browser is about to delete natively (from `beforeinput`). */
  let native: { ghost: DeletionGhost | null; type: string; at: number } | undefined;
  /** Text a command is about to delete, read before the DOM changes. */
  let pendingGhost: { ghost: DeletionGhost; doc: Node } | undefined;

  const active = () => !!view && enabled() && canAnimate(view.dom);
  const getLayer = () => (view ? (layer = overlay(view, layer)) : undefined);

  return new Plugin<TypingState>({
    key: typingMotionKey,
    state: {
      init: () => ({ decorations: DecorationSet.empty, count: 0 }),
      apply(tr, value) {
        const meta = tr.getMeta(typingMotionKey) as SettleMeta | false | undefined;
        if (meta === 'settle') return { decorations: DecorationSet.empty, count: 0 };
        let { decorations, count } = value;
        if (tr.docChanged) {
          if (count) decorations = decorations.map(tr.mapping, tr.doc);
          if (composeFrom !== undefined) composeFrom = tr.mapping.map(composeFrom, -1);
        }
        const typed = meta && typeof meta === 'object' ? meta : active() && view!.hasFocus() ? typedRange(tr) : null;
        if (!typed) return decorations === value.decorations ? value : { decorations, count };
        // Settling resets every span at once; past the cap, settle now (rare).
        if (count >= MAX_LIVE_DECORATIONS) { decorations = DecorationSet.empty; count = 0; }
        const ime = 'ime' in typed;
        const at = String(Math.round(performance.now()));
        const deco = Decoration.inline(typed.from, typed.to, { class: ime ? 'tano-typed tano-typed-ime' : 'tano-typed', 'data-typed-at': at }, { typed: true });
        return { decorations: decorations.add(tr.doc, [deco]), count: count + 1 };
      },
    },
    filterTransaction(tr, state) {
      // Appended transactions extend the chain; anything else starts over.
      if (pendingGhost && tr.before === pendingGhost.doc) { pendingGhost.doc = tr.doc; return true; }
      pendingGhost = undefined;
      if (!view || state.doc !== view.state.doc || view.composing || !tr.docChanged) return true;
      if (native && performance.now() - native.at < 300) return true;
      native = undefined;
      if (!active() || !view.hasFocus()) return true;
      const deleted = deletedRange(tr, state);
      if (!deleted || !deleted.text.trim()) return true;
      // Only a command edit still has the old text in the DOM at this point.
      const range = domRange(view, deleted.from, deleted.to);
      if (!range || range.toString() !== deleted.text) return true;
      const ghost = captureGhost(view, range, deleted.to - deleted.from <= 2 ? 'start' : 'center');
      if (ghost) pendingGhost = { ghost, doc: tr.doc };
      return true;
    },
    props: {
      decorations: state => typingMotionKey.getState(state)?.decorations,
      handleDOMEvents: {
        beforeinput(current, event) {
          const input = event as InputEvent;
          native = undefined;
          if (input.isComposing || !active() || !/^(delete(Content|Word|SoftLine|HardLine)|insertText$|insertReplacementText$)/.test(input.inputType)) return false;
          const [target] = input.getTargetRanges?.() ?? [];
          if (!target || target.collapsed) return false;
          const range = document.createRange();
          try {
            range.setStart(target.startContainer, target.startOffset);
            range.setEnd(target.endContainer, target.endOffset);
          } catch { return false; }
          const backward = /Backward$/.test(input.inputType);
          const short = range.toString().length <= 2;
          native = { ghost: captureGhost(current, range, backward || short ? 'start' : 'center'), type: input.inputType, at: performance.now() };
          return false;
        },
        input(current, event) {
          const input = event as InputEvent;
          const captured = native;
          if (captured && captured.type === input.inputType && captured.ghost) {
            const host = getLayer();
            if (host) playGhost(host, captured.ghost);
            captured.ghost = null;
          }
          caret?.schedule('glide');
          return false;
        },
        compositionstart(current) {
          composeFrom = current.state.selection.from;
          caret?.schedule('glide');
          return false;
        },
        compositionend(current) {
          caret?.schedule('glide');
          const start = composeFrom;
          // Run after ProseMirror's own composition-end flush, before paint.
          queueMicrotask(() => queueMicrotask(() => {
            if (composeFrom !== start) return;
            composeFrom = undefined;
            if (start === undefined || current.isDestroyed || current.composing || !active() || !current.hasFocus()) return;
            const { selection, doc } = current.state;
            const to = selection.head;
            if (!selection.empty || to <= start || to - start > MAX_TYPED) return;
            const $from = doc.resolve(start);
            if (!$from.parent.isTextblock || $from.parent.type.spec.code || !$from.sameParent(selection.$head)) return;
            if (!doc.textBetween(start, to).trim()) return;
            current.dispatch(current.state.tr.setMeta(typingMotionKey, { from: start, to, ime: true }).setMeta('addToHistory', false));
          }));
          return false;
        },
        focus() { caret?.schedule('snap'); return false; },
        blur() { caret?.hide(); return false; },
      },
    },
    view(editorView) {
      view = editorView;
      caret = new SmoothCaret(editorView, getLayer, () => !!view && caretEnabled());
      let settleTimer = 0;
      const settle = () => {
        settleTimer = 0;
        if (!view || view.isDestroyed) return;
        if (view.composing) { settleTimer = window.setTimeout(settle, 240); return; }
        if (!typingMotionKey.getState(view.state)?.count) return;
        view.dispatch(view.state.tr.setMeta(typingMotionKey, 'settle').setMeta('addToHistory', false));
      };
      const onSelectionChange = () => {
        if (view && (view.root as Document).activeElement === view.dom) caret?.schedule('glide');
      };
      const onLayout = () => caret?.schedule('follow');
      document.addEventListener('selectionchange', onSelectionChange);
      window.addEventListener('resize', onLayout);
      window.addEventListener('scroll', onLayout, { capture: true, passive: true });
      const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onLayout);
      observer?.observe(editorView.dom);
      return {
        update(current, previous) {
          view = current;
          caret?.setView(current);
          const ghost = pendingGhost;
          pendingGhost = undefined;
          if (ghost && ghost.doc === current.state.doc) {
            const host = getLayer();
            if (host) playGhost(host, ghost.ghost);
          }
          const before = typingMotionKey.getState(previous);
          const after = typingMotionKey.getState(current.state);
          if (after?.count) fadeTyped(current);
          if (after?.count && after.count !== before?.count) {
            window.clearTimeout(settleTimer);
            settleTimer = window.setTimeout(settle, SETTLE_AFTER);
          }
          if (current.state.doc !== previous.doc || !current.state.selection.eq(previous.selection)) caret?.schedule('glide');
        },
        destroy() {
          window.clearTimeout(settleTimer);
          document.removeEventListener('selectionchange', onSelectionChange);
          window.removeEventListener('resize', onLayout);
          window.removeEventListener('scroll', onLayout, { capture: true });
          observer?.disconnect();
          caret?.destroy();
          caret = undefined;
          layer?.remove();
          layer = undefined;
          view = undefined;
          native = undefined;
          pendingGhost = undefined;
          composeFrom = undefined;
        },
      };
    },
  });
}
