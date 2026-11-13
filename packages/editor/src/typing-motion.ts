import { Plugin, PluginKey, type EditorState, type Transaction } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import type { Node } from '@milkdown/kit/prose/model';
import { canAnimate } from './motion';
import { FrameLoop } from './typing/spring';
import { SmoothCaret } from './typing/caret';
import { TypedReveal } from './typing/typed-reveal';
import { EraseGhosts, captureGhost, type GhostCapture } from './typing/erase-ghosts';

/* Character-level motion for the editor, as one small system:
 *
 *   typing/spring.ts       retargetable springs + one shared frame loop
 *   typing/caret.ts        the drawn caret (x/y/height springs)
 *   typing/typed-reveal.ts typed text fades in, one short clock per keystroke
 *   typing/erase-ghosts.ts erased text shrinks toward the caret and fades
 *
 * This plugin only decides *what* happened (typing, IME commit, deletion,
 * key repeat) and hands it over. Each keystroke is animated on its own;
 * a new one interrupts or hands over the previous one instead of stacking.
 * A held key (keydown.repeat) is not animated at all: the text and the caret
 * behave exactly like the native ones until the key is released.
 *
 * Nothing here changes the document. Typed text is marked with short-lived
 * inline decorations (pruned as soon as they are revealed, cleared when
 * typing pauses); the caret and ghosts live in an overlay next to, never
 * inside, the ProseMirror DOM. IME composition is left alone: only committed
 * text is revealed, after the browser has finished composing. */

type TypingState = { decorations: DecorationSet; count: number };
export const typingMotionKey = new PluginKey<TypingState>('tano-typing-motion');

const MAX_TYPED = 64;
const MAX_LIVE_DECORATIONS = 160;
const SETTLE_AFTER = 460;
const MAX_GHOST_TEXT = 120;
/** Decorations older than this are fully revealed and can be dropped. */
const REVEALED_AFTER = 480;

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

/** A pure in-line deletion (or the replaced part of typing over a selection).
 * Only plain text next to the caret counts: replacing an inline node (e.g.
 * live Markdown source collapsing back into a link once the caret leaves)
 * is a re-render, not something the user erased. */
function deletedRange(tr: Transaction, state: EditorState) {
  if (!tr.docChanged || UI_EVENTS.has(tr.getMeta('uiEvent') as string) || tr.getMeta('composition') !== undefined || tr.getMeta(typingMotionKey) === false) return null;
  const step = singleReplace(tr);
  if (!step || step.to <= step.from || step.to - step.from > MAX_GHOST_TEXT || (step.slice.size && !textOnly(step.slice))) return null;
  const $from = state.doc.resolve(step.from);
  if (!$from.parent.isTextblock || !$from.sameParent(state.doc.resolve(step.to))) return null;
  let plain = true;
  state.doc.nodesBetween(step.from, step.to, node => {
    if (node.isInline && !node.isText) plain = false;
    return plain;
  });
  if (!plain) return null;
  const { selection } = state;
  const atCaret = selection.empty
    ? selection.head === step.from || selection.head === step.to
    : selection.from === step.from && selection.to === step.to;
  if (!atCaret) return null;
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
/* Plugin                                                                    */
/* ------------------------------------------------------------------------ */

type SettleMeta = 'settle' | { from: number; to: number; ime: true };

export type TypingMotionOptions = {
  /** Typed text appears and deleted text leaves with motion. */
  text?: () => boolean;
  /** The drawn, gliding caret. */
  caret?: () => boolean;
};

const NATIVE_DELETE = /^(delete(Content|Word|SoftLine|HardLine)|insertText$|insertReplacementText$)/;

export function typingMotion(options: TypingMotionOptions | (() => boolean) = {}) {
  const enabled = typeof options === 'function' ? options : options.text ?? (() => true);
  const caretEnabled = typeof options === 'function' ? options : options.caret ?? (() => true);
  let view: EditorView | undefined;
  let layer: HTMLElement | undefined;
  /** The last keydown was an auto-repeat (a held Backspace, arrow, letter). */
  let held = false;
  /** Where the current IME composition started, mapped through its edits. */
  let composeFrom: number | undefined;
  /** Text the browser is about to delete natively (from `beforeinput`). */
  let native: { ghost: GhostCapture | null; type: string; at: number } | undefined;
  /** Text a command is about to delete, read before the DOM changes. */
  let pendingGhost: { ghost: GhostCapture; doc: Node } | undefined;

  const loop = new FrameLoop();
  const reveal = new TypedReveal();
  const ghosts = new EraseGhosts();
  let caret: SmoothCaret | undefined;

  const active = () => !!view && enabled() && canAnimate(view.dom);
  const getLayer = () => (view ? (layer = overlay(view, layer)) : undefined);
  const erase = (ghost: GhostCapture) => {
    const host = getLayer();
    if (host && !held) ghosts.play(host, ghost);
  };

  // Order matters: the caret steps first, the rest read where it is now.
  loop.add(dt => caret?.frame(dt) ?? false);
  loop.add((_dt, now) => reveal.frame(now));

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
        // A held key types faster than any fade can finish: no animation.
        const typed = meta && typeof meta === 'object' ? meta : !held && active() && view!.hasFocus() ? typedRange(tr) : null;
        if (!typed) return decorations === value.decorations ? value : { decorations, count };
        const now = performance.now();
        // Revealed text needs no span any more: keep the set (and the DOM
        // ProseMirror redraws per keystroke) small during long typing runs.
        if (count) {
          const stale = decorations.find(undefined, undefined, spec => now - (spec.at as number) > REVEALED_AFTER);
          if (stale.length) { decorations = decorations.remove(stale); count -= stale.length; }
        }
        const ime = 'ime' in typed;
        const at = Math.round(now);
        const deco = Decoration.inline(typed.from, typed.to,
          { class: ime ? 'tano-typed tano-typed-ime' : 'tano-typed', 'data-typed-at': String(at) },
          { typed: true, at });
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
      const ghost = captureGhost(view.dom, range, deleted.to - deleted.from <= 2 ? 'start' : 'center', MAX_GHOST_TEXT);
      if (ghost) pendingGhost = { ghost, doc: tr.doc };
      return true;
    },
    props: {
      decorations: state => typingMotionKey.getState(state)?.decorations,
      handleDOMEvents: {
        keydown(_current, event) {
          held = event.repeat;
          caret?.setHeld(held);
          if (held) ghosts.finish();
          return false;
        },
        keyup() {
          held = false;
          caret?.setHeld(false);
          caret?.invalidate('move');
          return false;
        },
        beforeinput(current, event) {
          const input = event as InputEvent;
          native = undefined;
          if (input.isComposing || !active() || !NATIVE_DELETE.test(input.inputType)) return false;
          const [target] = input.getTargetRanges?.() ?? [];
          if (!target || target.collapsed) return false;
          const range = document.createRange();
          try {
            range.setStart(target.startContainer, target.startOffset);
            range.setEnd(target.endContainer, target.endOffset);
          } catch { return false; }
          const collapse = /Backward$/.test(input.inputType) || range.toString().length <= 2 ? 'start' : 'center';
          native = { ghost: captureGhost(current.dom, range, collapse, MAX_GHOST_TEXT), type: input.inputType, at: performance.now() };
          return false;
        },
        input(_current, event) {
          const captured = native;
          if (captured && captured.type === (event as InputEvent).inputType && captured.ghost) {
            erase(captured.ghost);
            captured.ghost = null;
          }
          caret?.invalidate('move');
          return false;
        },
        compositionstart(current) {
          composeFrom = current.state.selection.from;
          caret?.invalidate('move');
          return false;
        },
        compositionend(current) {
          caret?.invalidate('move');
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
        focus() { caret?.invalidate('snap'); return false; },
        blur() {
          held = false;
          caret?.setHeld(false);
          caret?.hide();
          return false;
        },
      },
    },
    view(editorView) {
      view = editorView;
      caret = new SmoothCaret(editorView, getLayer, () => !!view && caretEnabled(), () => loop.wake());
      let settleTimer = 0;
      const settle = () => {
        settleTimer = 0;
        if (!view || view.isDestroyed) return;
        if (view.composing) { settleTimer = window.setTimeout(settle, 240); return; }
        if (!typingMotionKey.getState(view.state)?.count) return;
        view.dispatch(view.state.tr.setMeta(typingMotionKey, 'settle').setMeta('addToHistory', false));
      };
      const onSelectionChange = () => {
        if (view && (view.root as Document).activeElement === view.dom) caret?.invalidate('move');
      };
      const onLayout = () => caret?.invalidate('follow');
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
          if (ghost && ghost.doc === current.state.doc) erase(ghost.ghost);
          const before = typingMotionKey.getState(previous);
          const after = typingMotionKey.getState(current.state);
          if (after?.count) {
            reveal.sync(current.dom);
            loop.wake();
          }
          if (after?.count && after.decorations !== before?.decorations) {
            window.clearTimeout(settleTimer);
            settleTimer = window.setTimeout(settle, SETTLE_AFTER);
          }
          if (current.state.doc !== previous.doc || !current.state.selection.eq(previous.selection)) caret?.invalidate('move');
        },
        destroy() {
          window.clearTimeout(settleTimer);
          document.removeEventListener('selectionchange', onSelectionChange);
          window.removeEventListener('resize', onLayout);
          window.removeEventListener('scroll', onLayout, { capture: true });
          observer?.disconnect();
          loop.stop();
          reveal.clear();
          ghosts.clear();
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
