/* Shared interaction motion for every Tano surface.
 *
 * Springs are pre-sampled into CSS `linear()` curves so CSS transitions, WAAPI
 * and motion/mini all share one feel. The same strings are published as CSS
 * custom properties in workbench `interaction-motion.css`; keep them in sync.
 *
 *   smooth  critically damped, no overshoot   — layout moves, closing panels
 *   snappy  ~4% overshoot                     — panels, dialogs, selections
 *   bouncy  ~12% overshoot                    — press release, switches, pops
 */
export const SPRING_SMOOTH = 'linear(0, 0.052, 0.165, 0.297, 0.426, 0.541, 0.64, 0.721, 0.786, 0.837, 0.877, 0.908, 0.931, 0.949, 0.962, 0.972, 0.98, 0.985, 0.989, 0.992, 0.994, 0.996, 1)';
export const SPRING_SNAPPY = 'linear(0, 0.023, 0.084, 0.168, 0.266, 0.368, 0.471, 0.567, 0.656, 0.736, 0.804, 0.863, 0.91, 0.949, 0.979, 1.001, 1.017, 1.028, 1.035, 1.038, 1.038, 1.037, 1.034, 1.031, 1.027, 1.023, 1.019, 1.016, 1.012, 1.009, 1.007, 1.005, 1)';
export const SPRING_BOUNCY = 'linear(0, 0.026, 0.094, 0.191, 0.305, 0.428, 0.55, 0.667, 0.773, 0.866, 0.945, 1.008, 1.056, 1.09, 1.112, 1.124, 1.126, 1.122, 1.113, 1.1, 1.086, 1.07, 1.055, 1.04, 1.027, 1.015, 1.006, 0.998, 0.992, 0.988, 0.986, 0.984, 0.984, 0.985, 0.986, 0.988, 0.989, 0.991, 0.993, 0.995, 1)';
/** Fallbacks for engines without `linear()` easing. */
const FALLBACK = {
  smooth: 'cubic-bezier(0.22, 1, 0.36, 1)',
  snappy: 'cubic-bezier(0.34, 1.32, 0.64, 1)',
  bouncy: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
} as const;
/** Quick, decisive exits. Things leave faster than they arrive. */
export const EASE_EXIT = 'cubic-bezier(0.4, 0, 0.7, 0.2)';
export const EASE_PRESS = 'cubic-bezier(0.2, 0, 0, 1)';

export const MOTION_DURATION = {
  press: 110,
  exit: 150,
  smooth: 320,
  snappy: 380,
  bouncy: 520,
} as const;

export type SpringKind = keyof typeof FALLBACK;
let linearSupported: boolean | undefined;
export function spring(kind: SpringKind): string {
  linearSupported ??= typeof CSS !== 'undefined' && typeof CSS.supports === 'function' &&
    CSS.supports('transition-timing-function', 'linear(0, 1)');
  if (!linearSupported) return FALLBACK[kind];
  return kind === 'smooth' ? SPRING_SMOOTH : kind === 'snappy' ? SPRING_SNAPPY : SPRING_BOUNCY;
}

/** The same springs as easing functions, for motion/mini (`ease:`), which
 * converts functions to native `linear()` curves itself. */
const SPRING_PHYSICS: Record<SpringKind, [damping: number, omega: number, settle: number]> = {
  smooth: [1, 26, 0.307],
  snappy: [0.72, 26, 0.282],
  bouncy: [0.55, 28, 0.339],
};
export function springEasing(kind: SpringKind): (progress: number) => number {
  const [zeta, omega, settle] = SPRING_PHYSICS[kind];
  return progress => {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    const t = progress * settle;
    if (zeta >= 1) return 1 - Math.exp(-omega * t) * (1 + omega * t);
    const damped = omega * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * omega * t) * (Math.cos(damped * t) + (zeta * omega / damped) * Math.sin(damped * t));
  };
}

let reducedQuery: MediaQueryList | undefined;
export function reducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  reducedQuery ??= window.matchMedia('(prefers-reduced-motion: reduce)');
  return reducedQuery.matches || document.documentElement.dataset.motion === 'reduced';
}
export function canAnimate(element: Element | null | undefined): element is HTMLElement {
  return !!element && typeof (element as HTMLElement).animate === 'function' && !reducedMotion();
}

/* ------------------------------------------------------------------------ */
/* Press feedback                                                            */
/* ------------------------------------------------------------------------ */

const PRESSABLE = [
  'button', 'summary', '[role="button"]', '[role="tab"]', '[role="radio"]', '[role="checkbox"]',
  'a.primary-button', 'a.secondary-button', 'a.button', '[data-press]',
].join(', ');
/* Rows, menus and draggable chrome keep a flat highlight: scaling a full-width
   row or a drag source reads as jitter, not feedback. */
const NOT_PRESSABLE = [
  '[data-no-press]', '[role="menuitem"]', '[role="menuitemradio"]', '[role="menuitemcheckbox"]',
  '[role="option"]', '[role="treeitem"]', '[role="switch"]', '[draggable="true"]', '.desktop-tab',
  '.tano-table-grip', '.block-handle', '.tano-block-handle', '.sidebar-resize-handle',
  '[contenteditable="true"] *:not([contenteditable="false"] *, [contenteditable="false"])',
].join(', ');
/** Triggers whose geometry anchors a popup: never leave them scaled. */
const ANCHOR = '[aria-haspopup]:not([aria-haspopup="false"]), [aria-expanded], [aria-controls]';

type Pressed = { element: HTMLElement; scale: number; hover: number; at: number; animation?: Animation };
const animations = new WeakMap<HTMLElement, Animation>();

function currentScale(element: HTMLElement): number {
  const value = getComputedStyle(element).scale;
  if (!value || value === 'none') return 1;
  return parseFloat(value) || 1;
}

function scaleTo(element: HTMLElement, to: number, duration: number, easing: string) {
  const from = currentScale(element);
  const running = animations.get(element);
  running?.cancel();
  if (!running && Math.abs(from - to) < 0.0005 && to === 1) return;
  const animation = element.animate([{ scale: String(from) }, { scale: String(to) }], { duration, easing, fill: 'forwards' });
  animations.set(element, animation);
  animation.onfinish = () => {
    if (animations.get(element) !== animation) return;
    if (to === 1) { animation.cancel(); animations.delete(element); }
  };
}

function settle(element: HTMLElement) {
  animations.get(element)?.cancel();
  animations.delete(element);
}

function pressTarget(event: Event): HTMLElement | null {
  const origin = event.target instanceof Element ? event.target : null;
  const element = origin?.closest<HTMLElement>(PRESSABLE);
  if (!element || element.matches(NOT_PRESSABLE)) return null;
  if ((element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true') return null;
  if (element.closest('[data-no-press], [inert]')) return null;
  return element;
}

/** ~5px of depth for every size: icons sink ~10%; wide call-to-action
 * buttons still sink at least 2.5% so the press is clearly visible. */
function depth(rect: DOMRect) {
  const longest = Math.max(rect.width, rect.height);
  if (!longest) return 1;
  return 1 - Math.min(0.1, Math.max(0.025, 5 / longest));
}
/** Only standalone, button-shaped controls lift on hover. */
function hoverLift(element: HTMLElement, rect: DOMRect) {
  if (element.matches(ANCHOR)) return 1;
  // Full-width form buttons (login, checkout) lift too; long list rows don't.
  if (rect.width < 64 || rect.height < 28 || rect.width > 720 || rect.height > 72) return 1;
  if (element.matches('[role="tab"], [role="radio"], summary, [aria-pressed], [aria-selected]')) return 1;
  const style = getComputedStyle(element);
  const filled = style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent';
  const bordered = parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== 'none';
  if (!filled && !bordered) return 1;
  return 1 + Math.min(0.025, Math.max(0.01, 2 / rect.width));
}

let installed: (() => void) | undefined;
/** Installs delegated, compositor-only press and hover springs. Uses the
 * individual `scale` property, so existing `transform`s are preserved. */
export function installInteractionMotion(root: Document = document): () => void {
  if (installed) return installed;
  // Core and the cloud shell may both ship this module; one listener set wins.
  const owner = globalThis as { __tanoInteractionMotion?: () => void };
  if (owner.__tanoInteractionMotion) return owner.__tanoInteractionMotion;
  if (typeof window === 'undefined' || typeof HTMLElement.prototype.animate !== 'function') return () => {};
  let pressed: Pressed | undefined;
  let hovered: HTMLElement | undefined;

  const release = (commit: boolean) => {
    const current = pressed;
    pressed = undefined;
    if (!current) return;
    const { element } = current;
    if (!element.isConnected || reducedMotion()) { settle(element); return; }
    const target = hovered === element ? current.hover : 1;
    if (commit && element.matches(ANCHOR)) {
      // Popups measure their trigger on click. A short settle keeps the
      // anchored menu aligned while still reading as a release.
      scaleTo(element, 1, 120, spring('smooth'));
      return;
    }
    const held = performance.now() - current.at;
    if (held < MOTION_DURATION.press + 30) {
      // A quick click releases before the press has landed. Finish the dip
      // first, then spring back, so every tap reads as a press.
      const from = currentScale(element);
      animations.get(element)?.cancel();
      const animation = element.animate([
        { scale: String(from), easing: EASE_PRESS },
        { scale: String(current.scale), offset: 0.18, easing: spring('bouncy') },
        { scale: String(target) },
      ], { duration: MOTION_DURATION.bouncy + 80, fill: 'forwards' });
      animations.set(element, animation);
      animation.onfinish = () => {
        if (animations.get(element) !== animation || target !== 1) return;
        animation.cancel(); animations.delete(element);
      };
      return;
    }
    scaleTo(element, target, MOTION_DURATION.bouncy, spring('bouncy'));
  };

  const down = (event: PointerEvent) => {
    if (event.button !== 0 || reducedMotion()) return;
    const element = pressTarget(event);
    if (!element) return;
    const rect = element.getBoundingClientRect();
    pressed = { element, scale: depth(rect), hover: hoverLift(element, rect), at: performance.now() };
    scaleTo(element, pressed.scale, MOTION_DURATION.press, EASE_PRESS);
  };
  const up = () => release(true);
  const cancel = () => release(false);
  const over = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse' || reducedMotion()) return;
    const element = pressTarget(event);
    if (element === hovered) return;
    const previous = hovered;
    hovered = element ?? undefined;
    if (previous && previous !== pressed?.element && animations.has(previous))
      scaleTo(previous, 1, MOTION_DURATION.snappy, spring('snappy'));
    if (!element || element === pressed?.element) return;
    const lift = hoverLift(element, element.getBoundingClientRect());
    if (lift !== 1) scaleTo(element, lift, MOTION_DURATION.bouncy, spring('bouncy'));
  };
  const leaveWindow = (event: PointerEvent) => {
    if (event.relatedTarget) return;
    if (hovered && hovered !== pressed?.element && animations.has(hovered)) scaleTo(hovered, 1, MOTION_DURATION.snappy, spring('snappy'));
    hovered = undefined;
  };
  const key = (event: KeyboardEvent) => {
    if (event.repeat || (event.key !== 'Enter' && event.key !== ' ') || reducedMotion()) return;
    const element = pressTarget(event);
    if (!element || element.matches(ANCHOR) || !element.matches('button, summary, [role="button"], [role="tab"], [role="radio"]')) return;
    const rect = element.getBoundingClientRect();
    const scale = depth(rect);
    animations.get(element)?.cancel();
    const animation = element.animate(
      [{ scale: '1' }, { scale: String(scale), offset: 0.22 }, { scale: '1' }],
      { duration: MOTION_DURATION.bouncy, easing: 'ease-out' },
    );
    animations.set(element, animation);
    animation.onfinish = () => { if (animations.get(element) === animation) animations.delete(element); };
  };
  const drag = () => { if (pressed) { settle(pressed.element); pressed = undefined; } };

  const options = { capture: true, passive: true } as const;
  root.addEventListener('pointerdown', down, options);
  root.addEventListener('pointerup', up, options);
  root.addEventListener('pointercancel', cancel, options);
  root.addEventListener('pointerover', over, options);
  root.addEventListener('pointerout', leaveWindow, options);
  root.addEventListener('keydown', key, options);
  root.addEventListener('dragstart', drag, options);
  installed = () => {
    root.removeEventListener('pointerdown', down, options);
    root.removeEventListener('pointerup', up, options);
    root.removeEventListener('pointercancel', cancel, options);
    root.removeEventListener('pointerover', over, options);
    root.removeEventListener('pointerout', leaveWindow, options);
    root.removeEventListener('keydown', key, options);
    root.removeEventListener('dragstart', drag, options);
    installed = undefined;
    if (owner.__tanoInteractionMotion === dispose) delete owner.__tanoInteractionMotion;
  };
  const dispose = installed;
  owner.__tanoInteractionMotion = dispose;
  return installed;
}

/* ------------------------------------------------------------------------ */
/* Reusable list motion: FLIP moves, rise-in entries, ghost exits           */
/* ------------------------------------------------------------------------ */

type Snapshot = { rect: DOMRect; ghost?: HTMLElement };

/** Ghost a departing element above its old place, then fade/shrink it away.
 * The ghost is a detached, inert clone; the real node is already gone. */
export function ghostExit(source: HTMLElement | undefined, rect: DOMRect, host: HTMLElement, options: { scale?: number; y?: number; strip?: string[] } = {}) {
  if (!source || !host.isConnected || !rect.width || !rect.height) return;
  const ghost = source.cloneNode(true) as HTMLElement;
  ghost.removeAttribute('id');
  for (const node of ghost.querySelectorAll('[id]')) node.removeAttribute('id');
  // Identity attributes must not make a ghost look like a live row to queries.
  for (const name of options.strip ?? []) {
    ghost.removeAttribute(name);
    for (const node of ghost.querySelectorAll(`[${name}]`)) node.removeAttribute(name);
  }
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  ghost.dataset.motionGhost = '';
  Object.assign(ghost.style, {
    position: 'absolute', left: '0px', top: '0px', width: `${rect.width}px`, height: `${rect.height}px`,
    margin: '0', pointerEvents: 'none', zIndex: '1', boxSizing: 'border-box', translate: 'none', transform: 'none',
  });
  host.append(ghost);
  const placed = ghost.getBoundingClientRect();
  ghost.style.left = `${rect.left - placed.left}px`;
  ghost.style.top = `${rect.top - placed.top}px`;
  const animation = ghost.animate([
    { opacity: 1, scale: '1', translate: '0 0', filter: 'blur(0px)' },
    { opacity: 0, scale: String(options.scale ?? 0.96), translate: `0 ${options.y ?? -2}px`, filter: 'blur(1.5px)' },
  ], { duration: 200, easing: EASE_EXIT, fill: 'forwards' });
  const remove = () => ghost.remove();
  animation.onfinish = remove;
  animation.oncancel = remove;
}

export function riseIn(element: HTMLElement, delay = 0, distance = 6) {
  element.animate([
    { opacity: 0, translate: `0 ${distance}px`, scale: '0.985' },
    { opacity: 1, translate: '0 0', scale: '1' },
  ], { duration: MOTION_DURATION.snappy, easing: spring('snappy'), delay, fill: 'backwards' });
}

export function flipFrom(element: HTMLElement, from: DOMRect, to: DOMRect = element.getBoundingClientRect()) {
  const dx = from.left - to.left, dy = from.top - to.top;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
  element.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }],
    { duration: MOTION_DURATION.snappy, easing: spring('snappy'), composite: 'add' });
}

/** Snapshot keyed children before a render; call the returned `play()` after
 * the DOM has updated. Unchanged keys move with FLIP, new keys rise in and
 * removed keys leave through a ghost. Read-only between calls. */
export function captureList(root: HTMLElement | null | undefined, selector: string, key: (element: HTMLElement) => string | undefined, options: { enter?: boolean; exit?: boolean; maxEnter?: number; strip?: string[] } = {}) {
  if (!root || !canAnimate(root) || !root.getClientRects().length) return () => {};
  const before = new Map<string, Snapshot>();
  const view = root.getBoundingClientRect();
  for (const element of root.querySelectorAll<HTMLElement>(selector)) {
    if (element.closest('[data-motion-ghost]')) continue;
    const id = key(element);
    if (!id) continue;
    const rect = element.getBoundingClientRect();
    if (!rect.height || rect.bottom < view.top - 80 || rect.top > view.bottom + 80) {
      before.set(id, { rect });
      continue;
    }
    before.set(id, { rect, ghost: options.exit === false ? undefined : element });
  }
  // Clone now: the original node will be detached or reused after the render.
  for (const snapshot of before.values()) if (snapshot.ghost) snapshot.ghost = snapshot.ghost.cloneNode(true) as HTMLElement;
  return () => {
    if (!root.isConnected) return;
    const seen = new Set<string>();
    let entering = 0;
    const host = root;
    const next = root.getBoundingClientRect();
    for (const element of root.querySelectorAll<HTMLElement>(selector)) {
      if (element.closest('[data-motion-ghost]')) continue;
      const id = key(element);
      if (!id) continue;
      seen.add(id);
      const previous = before.get(id);
      const rect = element.getBoundingClientRect();
      if (rect.bottom < next.top - 80 || rect.top > next.bottom + 80) continue;
      if (previous) flipFrom(element, previous.rect, rect);
      else if (options.enter !== false && entering < (options.maxEnter ?? 24)) riseIn(element, Math.min(entering++, 10) * 14, 4);
    }
    if (options.exit === false) return;
    for (const [id, snapshot] of before) {
      if (!seen.has(id) && snapshot.ghost) ghostExit(snapshot.ghost, snapshot.rect, host, { strip: options.strip });
    }
  };
}
