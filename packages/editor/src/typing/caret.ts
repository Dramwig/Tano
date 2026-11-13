import type { EditorView } from '@milkdown/kit/prose/view';
import { reducedMotion, spring } from '../motion';
import { CARET_FOLLOW_SPRING, CARET_SPRING, Spring, type SpringConfig } from './spring';

/* The drawn caret. Its position is three springs (x, y, height) stepped by
 * the shared frame loop; a new target only moves the goal, so the caret is
 * never stopped and relaunched. The native caret is hidden (via a class on
 * the editor) only while this one is actually on screen. */

export type CaretRequest = 'move' | 'snap' | 'follow';
const RANK: Record<CaretRequest, number> = { follow: 0, move: 1, snap: 2 };

type Target = { x: number; y: number; height: number; color: string; moving: boolean };

export class SmoothCaret {
  readonly element: HTMLElement;
  private x = new Spring();
  private y = new Spring();
  private height = new Spring();
  private shown = false;
  private request: CaretRequest | undefined;
  private target: Target | undefined;
  private idleTimer = 0;
  private following = 0;
  private held = false;

  constructor(
    private view: EditorView,
    private layer: () => HTMLElement | undefined,
    private enabled: () => boolean,
    private wake: () => void,
  ) {
    this.element = document.createElement('div');
    this.element.className = 'tano-caret';
    this.element.hidden = true;
  }

  setView(view: EditorView) { this.view = view; }

  /** Ask for a new measurement on the next frame. */
  invalidate(request: CaretRequest = 'move') {
    if (!this.request || RANK[request] > RANK[this.request]) this.request = request;
    this.wake();
  }

  /** A key is auto-repeating: the caret simply sits on the text, like the
   * native one, until the key is released. */
  setHeld(held: boolean) { this.held = held; }

  hide() {
    this.request = undefined;
    this.target = undefined;
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

  /** Frame task: measure if asked, then step the springs and draw. */
  frame(dt: number): boolean {
    if (this.request) {
      const request = this.request;
      this.request = undefined;
      if (!this.measure(request)) return false;
    }
    if (!this.shown) return false;
    const moving = [this.x.step(dt), this.y.step(dt), this.height.step(dt)].some(Boolean);
    this.draw();
    // Keep re-measuring while the block under the caret is still gliding.
    if (this.target?.moving && this.following < 90) {
      this.following++;
      this.request = 'follow';
      return true;
    }
    this.following = 0;
    return moving;
  }

  private configure(config: SpringConfig) {
    this.x.config = config;
    this.y.config = config;
    this.height.config = config;
  }

  private read(): Target | undefined {
    const view = this.view;
    if (!this.enabled() || !view.editable || reducedMotion() || !view.dom.isConnected) return undefined;
    const root = view.root as Document | ShadowRoot;
    if (root.activeElement !== view.dom) return undefined;
    const selection = view.state.selection;
    if (!selection.empty || !selection.$head.parent.inlineContent) return undefined;
    const dom = (root as Document).getSelection?.() ?? document.getSelection();
    if (!dom || !dom.rangeCount || !dom.isCollapsed || !dom.anchorNode || !view.dom.contains(dom.anchorNode)) return undefined;
    const anchor = dom.anchorNode.nodeType === 3 ? dom.anchorNode.parentElement : dom.anchorNode as Element;
    if (!anchor || anchor.closest('[contenteditable="false"]')) return undefined;
    let rect: { left: number; top: number; bottom: number } | undefined;
    const rects = dom.getRangeAt(0).getClientRects();
    if (rects.length && rects[0]!.height > 0) rect = rects[0]!;
    else {
      try { rect = view.coordsAtPos(selection.head, 1); } catch { rect = undefined; }
    }
    if (!rect || rect.bottom - rect.top <= 0) return undefined;
    const layer = this.layer();
    if (!layer) return undefined;
    if (this.element.parentElement !== layer) layer.append(this.element);
    const origin = layer.getBoundingClientRect();
    // Typed-text fades only change opacity; anything else animating around
    // the caret (a block gliding into place) moves it.
    let moving = false;
    for (let node: Element | null = anchor; node && node !== view.dom.parentElement && !moving; node = node.parentElement) {
      if (!node.classList.contains('tano-typed') && typeof node.getAnimations === 'function' &&
        node.getAnimations().some(animation => animation.playState === 'running')) moving = true;
    }
    // A Markdown field opening or closing on this line pushes the caret along.
    if (!moving) for (const node of view.dom.querySelectorAll('.tano-source-morph')) {
      if (typeof node.getAnimations === 'function' && node.getAnimations().some(animation => animation.playState === 'running')) { moving = true; break; }
    }
    return {
      x: Math.round((rect.left - origin.left) * 2) / 2 - 1,
      y: rect.top - origin.top,
      height: rect.bottom - rect.top,
      color: getComputedStyle(anchor).color,
      moving,
    };
  }

  /** Read the target and decide how to get there. False hides the caret. */
  private measure(request: CaretRequest): boolean {
    const target = this.read();
    if (!target) { this.hide(); return false; }
    this.target = target;
    const dx = target.x - this.x.target, dy = target.y - this.y.target;
    const far = Math.abs(dy) > Math.max(this.height.target, target.height) * 3.2 || Math.hypot(dx, dy) > 720;
    const appear = request === 'snap' || !this.shown || far;
    if (appear || this.held) {
      this.x.snap(target.x);
      this.y.snap(target.y);
      this.height.snap(target.height);
      if (appear && !this.held) this.element.animate([{ scale: '1 0.4', opacity: 0 }, { scale: '1 1', opacity: 1 }], { duration: 300, easing: spring('bouncy') });
    } else {
      this.configure(request === 'follow' ? CARET_FOLLOW_SPRING : CARET_SPRING);
      this.x.retarget(target.x);
      this.y.retarget(target.y);
      this.height.retarget(target.height);
    }
    if (!this.shown) {
      this.shown = true;
      this.element.hidden = false;
    }
    this.element.style.backgroundColor = target.color;
    this.view.dom.classList.add('tano-smooth-caret');
    // Solid while it moves, then breathe.
    if (request !== 'follow') {
      this.element.classList.remove('is-idle');
      window.clearTimeout(this.idleTimer);
      this.idleTimer = window.setTimeout(() => this.element.classList.add('is-idle'), 520);
    }
    return true;
  }

  private draw() {
    const style = this.element.style;
    style.translate = `${this.x.value}px ${this.y.value}px`;
    style.height = `${Math.max(1, this.height.value)}px`;
  }
}
