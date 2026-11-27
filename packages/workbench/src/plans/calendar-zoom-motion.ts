import { localDayKey, visibleCalendarDays, weekDays, type CalendarViewMode } from './calendar';

/**
 * Anchored zoom transition between calendar scales.
 *
 * Switching scale (day → week → month → year) re-lays out the whole calendar, so the
 * period the user was looking at jumps to an unrelated spot. This keeps it in sight:
 * zooming out shrinks the old view into the region that period occupies in the new
 * layout (and briefly tints it); zooming in fades back everything around the period being
 * opened and grows the new view out of it. Both views are animated in the scroll viewport's
 * coordinates.
 *
 * Transitions can be interrupted: a new scale change copies the view exactly as it is on
 * screen at that moment (mid-transform and mid-fade included) and continues from there.
 */

const SCALE: Record<CalendarViewMode, number> = {
  day: 0, 'four-days': 1, week: 2, month: 3, agenda: 3, year: 4,
};
const DURATION = 380;
/** Zooming in runs a little longer so the period being opened stays readable. */
const EXPAND_DURATION = 460;
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

interface Box { x: number; y: number; w: number; h: number }
interface Point { x: number; y: number }

export interface CalendarZoomSnapshot {
  from: CalendarViewMode;
  to: CalendarViewMode;
  ghost?: HTMLElement;
  /** Transform the copy starts from, so an interrupted transition continues from its current frame. */
  carried: string;
  /** Clip the copy starts from (an interrupted zoom may be mid-reveal). */
  carriedClip: string;
  /** Inline opacity of the live viewport before it was hidden behind the copy. */
  hiddenOpacity: string;
  /** Focus region in the old view as it appeared on screen (zoom in only), relative to the viewport. */
  source?: Box;
  /** The same region in the copy's own, untransformed coordinates. */
  sourceLocal?: Box;
}

const VEIL = '--calendar-zoom-veil';
let veilRegistered: boolean | undefined;

/** The surroundings fade through a registered custom property; without it, skip that step. */
function canAnimateVeil(view: Window) {
  if (veilRegistered !== undefined) return veilRegistered;
  const css = (view as Window & typeof globalThis).CSS;
  try {
    css?.registerProperty?.({ name: VEIL, syntax: '<number>', inherits: false, initialValue: '1' });
    veilRegistered = typeof css?.registerProperty === 'function';
  } catch {
    // Already registered (for example after a hot reload).
    veilRegistered = true;
  }
  return veilRegistered;
}

function reducedMotion(view: Window) {
  return view.document.documentElement.dataset.motion === 'reduced'
    || Boolean(view.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

/** The days the finer of two scales shows, which is what both views must agree on. */
function focusDays(date: Date, from: CalendarViewMode, to: CalendarViewMode): Date[] {
  const finer = SCALE[from] <= SCALE[to] ? from : to;
  if (finer === 'day' || finer === 'four-days' || finer === 'week') return visibleCalendarDays(date, finer);
  if (finer === 'month' || finer === 'agenda') {
    return [new Date(date.getFullYear(), date.getMonth(), 1)];
  }
  return weekDays(date);
}

/** `YYYY-MM`, matching the prefix of a day key and the year view's `data-month`. */
export function calendarMonthKey(day: Date) {
  return localDayKey(day).slice(0, 7);
}

/** Elements that represent `days` in the view currently rendered in `container`. */
function focusElements(container: HTMLElement, mode: CalendarViewMode, days: Date[], finer: CalendarViewMode) {
  const keys = new Set(days.map(localDayKey));
  if (mode === 'year') {
    const month = calendarMonthKey(days[0]!);
    return [...container.querySelectorAll<HTMLElement>('.calendar-year-month')]
      .filter(element => element.dataset.month === month);
  }
  if (mode === 'month') {
    // A month focus (from the year scale) is every cell of that month.
    if (finer === 'month') {
      const month = calendarMonthKey(days[0]!);
      return [...container.querySelectorAll<HTMLElement>('.calendar-month-cell')]
        .filter(cell => cell.dataset.day?.startsWith(month));
    }
    return [...container.querySelectorAll<HTMLElement>('.calendar-month-cell')]
      .filter(cell => keys.has(cell.dataset.day ?? ''));
  }
  if (mode === 'day' || mode === 'four-days' || mode === 'week') {
    return [...container.querySelectorAll<HTMLElement>('.calendar-view-day-column, .calendar-view-date-events')]
      .filter(element => keys.has(element.dataset.day ?? ''));
  }
  return [];
}

/** Union of the elements' boxes, clipped to the viewport and relative to it. */
function focusBox(container: HTMLElement, elements: HTMLElement[]): Box | undefined {
  if (!elements.length) return undefined;
  const view = container.getBoundingClientRect();
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const element of elements) {
    const rect = element.getBoundingClientRect();
    left = Math.min(left, rect.left); top = Math.min(top, rect.top);
    right = Math.max(right, rect.right); bottom = Math.max(bottom, rect.bottom);
  }
  left = Math.max(left, view.left); top = Math.max(top, view.top);
  right = Math.min(right, view.left + container.clientWidth);
  bottom = Math.min(bottom, view.top + container.clientHeight);
  if (right - left < 8 || bottom - top < 8) return undefined;
  return { x: left - view.left, y: top - view.top, w: right - left, h: bottom - top };
}

/**
 * Uniform (aspect-preserving) placement, origin top-left: `x' = s * x + tx`. Scaling both
 * axes by the same factor keeps text and grid proportions intact; the change in shape
 * between a period and the viewport is carried by a clip instead of by stretching.
 */
interface Fit { s: number; tx: number; ty: number }

function fitTransform({ s, tx, ty }: Fit) {
  return `translate(${tx}px, ${ty}px) scale(${s})`;
}

/** Shrinks (or grows) the whole viewport so it just covers `box`, centred on it. */
function coverBox(box: Box, viewport: Box): Fit {
  const s = Math.max(box.w / viewport.w, box.h / viewport.h);
  return { s, tx: box.x + box.w / 2 - (s * viewport.w) / 2, ty: box.y + box.h / 2 - (s * viewport.h) / 2 };
}

/** Moves `box` to the viewport's centre, scaled uniformly until it meets the viewport's edge. */
function bringOut(box: Box, viewport: Box): Fit {
  const s = Math.min(viewport.w / box.w, viewport.h / box.h);
  return { s, tx: viewport.w / 2 - s * (box.x + box.w / 2), ty: viewport.h / 2 - s * (box.y + box.h / 2) };
}

/** Rounded corners of the reveal window, in screen pixels. */
const CLIP_RADIUS = 6;
const FULL_CLIP = 'inset(0px 0px 0px 0px round 0px)';

/**
 * Clip, in the element's own coordinates, that shows exactly `box` on screen once `fit`
 * (and, for a copy, the transform it was captured with) is applied.
 */
function clipToBox(box: Box, fit: Fit, viewport: Box, carried: string, view: Window) {
  let x = (box.x - fit.tx) / fit.s;
  let y = (box.y - fit.ty) / fit.s;
  let w = box.w / fit.s;
  let h = box.h / fit.s;
  let scale = fit.s;
  const Matrix = (view as Window & typeof globalThis).DOMMatrixReadOnly;
  if (carried && typeof Matrix === 'function') {
    const { a, d, e, f } = new Matrix(carried);
    x = (x - e) / a; y = (y - f) / d; w /= a; h /= d; scale *= a;
  }
  const top = Math.max(0, y);
  const left = Math.max(0, x);
  const right = Math.max(0, viewport.w - (x + w));
  const bottom = Math.max(0, viewport.h - (y + h));
  return `inset(${top}px ${right}px ${bottom}px ${left}px round ${CLIP_RADIUS / scale}px)`;
}

/** Applies a translate/scale matrix (no rotation or skew) to a box. */
function transformBox(box: Box, transform: string, view: Window): Box {
  const Matrix = (view as Window & typeof globalThis).DOMMatrixReadOnly;
  if (!transform || typeof Matrix !== 'function') return box;
  const { a, d, e, f } = new Matrix(transform);
  return { x: box.x * a + e, y: box.y * d + f, w: box.w * a, h: box.h * d };
}

/** The viewport's offset inside the stage, from layout (unaffected by transforms). */
function stageOffset(container: HTMLElement, stage: HTMLElement): Point {
  return container.offsetParent === stage ? { x: container.offsetLeft, y: container.offsetTop } : { x: 0, y: 0 };
}

/**
 * Called before the new scale renders: freezes a copy of the current view as it looks
 * right now and, when zooming in, records where the focused period sits in it.
 */
export function captureCalendarZoom(
  container: HTMLElement | undefined,
  stage: HTMLElement | undefined,
  date: Date,
  from: CalendarViewMode,
  to: CalendarViewMode,
): CalendarZoomSnapshot | undefined {
  const view = container?.ownerDocument.defaultView;
  if (!container || !stage || !view || from === to || reducedMotion(view)) return undefined;
  if (typeof container.animate !== 'function' || !container.clientWidth || !container.clientHeight) return undefined;
  // Read the in-flight frame before settling it, so the copy picks up exactly where it is.
  const computed = view.getComputedStyle(container);
  const carried = computed.transform && computed.transform !== 'none' ? computed.transform : '';
  const carriedClip = computed.clipPath && computed.clipPath !== 'none' ? computed.clipPath : '';
  const opacity = Number.parseFloat(computed.opacity);
  container.getAnimations?.().forEach(animation => animation.cancel());
  // Copies from earlier transitions keep fading out on their own; outlines are stale now.
  stage.querySelectorAll('.calendar-zoom-focus').forEach(element => element.remove());
  const snapshot: CalendarZoomSnapshot = { from, to, carried, carriedClip, hiddenOpacity: container.style.opacity };
  if (SCALE[to] < SCALE[from]) {
    const finer = SCALE[from] <= SCALE[to] ? from : to;
    const source = focusBox(container, focusElements(container, from, focusDays(date, from, to), finer));
    snapshot.sourceLocal = source;
    snapshot.source = source && transformBox(source, carried, view);
  }
  const ghost = container.cloneNode(true) as HTMLElement;
  ghost.removeAttribute('aria-label');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  ghost.classList.add('calendar-zoom-ghost');
  const offset = stageOffset(container, stage);
  Object.assign(ghost.style, {
    position: 'absolute',
    left: `${offset.x}px`,
    top: `${offset.y}px`,
    width: `${container.offsetWidth}px`,
    height: `${container.offsetHeight}px`,
    pointerEvents: 'none',
    transformOrigin: '0 0',
    transform: carried || 'none',
    clipPath: carriedClip || 'none',
    opacity: String(Number.isFinite(opacity) ? opacity : 1),
    zIndex: '2',
  });
  // The live view was painted below earlier copies, so its copy goes there too.
  container.after(ghost);
  ghost.scrollTop = container.scrollTop;
  ghost.scrollLeft = container.scrollLeft;
  // The live view re-renders underneath; keep it hidden until its own animation starts.
  container.style.opacity = '0';
  snapshot.ghost = ghost;
  return snapshot;
}

/** Drops a snapshot that will never play (the scale changed again before it was positioned). */
export function discardCalendarZoom(snapshot: CalendarZoomSnapshot | undefined, container: HTMLElement | undefined) {
  if (!snapshot) return;
  snapshot.ghost?.remove();
  if (container) container.style.opacity = snapshot.hiddenOpacity;
}

/** Called once the new scale is rendered and scrolled into place. */
export function playCalendarZoom(
  snapshot: CalendarZoomSnapshot,
  container: HTMLElement | undefined,
  stage: HTMLElement | undefined,
  date: Date,
): Promise<void> {
  const { from, to, ghost, carried } = snapshot;
  if (!container || !stage || typeof container.animate !== 'function') {
    discardCalendarZoom(snapshot, container);
    return Promise.resolve();
  }
  const finer = SCALE[from] <= SCALE[to] ? from : to;
  const days = focusDays(date, from, to);
  const viewport: Box = { x: 0, y: 0, w: container.clientWidth, h: container.clientHeight };
  const zoomingOut = SCALE[to] > SCALE[from];
  let focus: Box | undefined;
  if (zoomingOut) {
    let elements = focusElements(container, to, days, finer);
    focus = focusBox(container, elements);
    // Keep the period being zoomed out of fully in view in the vertically scrolling layouts.
    const first = elements[0];
    if (first && (to === 'month' || to === 'year') && (!focus || focus.h < Math.min(first.getBoundingClientRect().height, viewport.h) - 1)) {
      const rect = first.getBoundingClientRect();
      const top = container.getBoundingClientRect().top;
      container.scrollTop += rect.top - top - Math.max(24, (viewport.h - rect.height) / 2);
      elements = focusElements(container, to, days, finer);
      focus = focusBox(container, elements);
    }
  } else {
    focus = snapshot.source;
  }

  const origin = stageOffset(container, stage);
  // The copy's motion is applied on top of the frame it was captured in.
  const onCopy = (transform: string) =>
    !carried ? transform : transform === 'none' ? carried : `${transform} ${carried}`;
  const startOpacity = ghost?.style.opacity ?? '1';
  const animations: Animation[] = [];
  const view = container.ownerDocument.defaultView!;
  // Motion and opacity run on separate timelines: on the shared spring curve the fades would
  // finish in the first few frames, before the eye has found the period being moved.
  type Frame = { transform: string; clipPath?: string };
  const move = (element: HTMLElement, from: Frame, to: Frame, duration: number, delay = 0) =>
    animations.push(element.animate(
      [{ ...from, transformOrigin: '0 0' }, { ...to, transformOrigin: '0 0' }],
      { duration, delay, easing: EASE, fill: 'both' },
    ));
  // `at` gives the [start, end] of the fade as fractions of `duration`, in real time.
  const fade = (element: HTMLElement, from: string, to: string, duration: number, at: [number, number]) =>
    animations.push(element.animate(
      [{ opacity: from }, { opacity: from, offset: at[0] }, { opacity: to, offset: at[1] }, { opacity: to }],
      { duration, easing: 'linear', fill: 'both' },
    ));
  const copyClip = snapshot.carriedClip || FULL_CLIP;
  if (focus && zoomingOut) {
    // The coarser view arrives from the period's spot, scaled evenly (no stretching).
    move(container, { transform: fitTransform(bringOut(focus, viewport)) }, { transform: 'none' }, DURATION);
    fade(container, '0', '1', DURATION, [0, 0.55]);
    if (ghost) {
      // The old view shrinks evenly onto the period while its window closes to the period's shape.
      const cover = coverBox(focus, viewport);
      move(
        ghost,
        { transform: onCopy('none'), clipPath: copyClip },
        { transform: onCopy(fitTransform(cover)), clipPath: clipToBox(focus, cover, viewport, carried, view) },
        DURATION,
      );
      fade(ghost, startOpacity, '0', DURATION, [0.3, 0.85]);
    }
    outlineFocus(stage, origin, focus);
  } else if (focus) {
    // Zooming in: first let everything around the period fade back so it stands alone, then
    // open it: the finer view starts as a window the size of the period and widens evenly.
    const hold = 110;
    const total = hold + EXPAND_DURATION;
    const cover = coverBox(focus, viewport);
    move(
      container,
      { transform: fitTransform(cover), clipPath: clipToBox(focus, cover, viewport, '', view) },
      { transform: 'none', clipPath: FULL_CLIP },
      EXPAND_DURATION,
      hold,
    );
    fade(container, '0', '1', total, [0.2, 0.5]);
    if (ghost) {
      move(
        ghost,
        { transform: onCopy('none'), clipPath: copyClip },
        { transform: onCopy(fitTransform(bringOut(focus, viewport))), clipPath: copyClip },
        EXPAND_DURATION,
        hold,
      );
      fade(ghost, startOpacity, '0', total, [0.3, 0.7]);
    }
    const local = snapshot.sourceLocal;
    if (ghost && local && canAnimateVeil(container.ownerDocument.defaultView!)) {
      // Two mask layers: the period at full strength, the rest of the copy at the veil level.
      Object.assign(ghost.style, {
        maskImage: `linear-gradient(#000, #000), linear-gradient(rgb(0 0 0 / var(${VEIL})), rgb(0 0 0 / var(${VEIL})))`,
        maskSize: `${local.w}px ${local.h}px, 100% 100%`,
        maskPosition: `${local.x}px ${local.y}px, 0 0`,
        maskRepeat: 'no-repeat',
      });
      animations.push(ghost.animate(
        [{ [VEIL]: '1' }, { [VEIL]: '0.12', offset: 0.3 }, { [VEIL]: '0.12' }],
        { duration: total, easing: 'ease-out', fill: 'both' },
      ));
    }
  } else {
    move(container, { transform: `scale(${zoomingOut ? 1.04 : 0.96})` }, { transform: 'none' }, DURATION);
    fade(container, '0', '1', DURATION, [0, 0.6]);
    if (ghost) fade(ghost, startOpacity, '0', DURATION, [0, 0.5]);
  }
  // The running animation now controls the live view's opacity.
  container.style.opacity = snapshot.hiddenOpacity;
  const settled = (element?: HTMLElement) => Promise.all(animations
    .filter(animation => (animation.effect as KeyframeEffect | null)?.target === element)
    .map(animation => animation.finished.catch(() => undefined)));
  // Remove the copy as soon as its own animations end (they hold their faded end state).
  if (ghost) void settled(ghost).then(() => ghost.remove());
  // The live view's animations must not hold their end state, or they would pin its styles.
  void settled(container).then(() => {
    for (const animation of container.getAnimations?.() ?? []) {
      if (animation.playState === 'finished') animation.cancel();
    }
  });
  return Promise.all(animations.map(animation => animation.finished.catch(() => undefined)))
    .then(() => { ghost?.remove(); });
}

function boxStyle(origin: Point, box: Box) {
  return {
    left: `${origin.x + box.x}px`,
    top: `${origin.y + box.y}px`,
    width: `${box.w}px`,
    height: `${box.h}px`,
  };
}

function placeOverlay(stage: HTMLElement, origin: Point, box: Box) {
  const ring = stage.ownerDocument.createElement('div');
  ring.className = 'calendar-zoom-focus';
  ring.setAttribute('aria-hidden', 'true');
  Object.assign(ring.style, boxStyle(origin, box));
  stage.append(ring);
  return ring;
}

/** Briefly tint where the previous period landed so the eye can follow it. */
function outlineFocus(stage: HTMLElement, origin: Point, focus: Box) {
  const ring = placeOverlay(stage, origin, focus);
  const animation = ring.animate(
    [{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }],
    { duration: 1400, delay: DURATION * 0.6, easing: 'ease-out', fill: 'backwards' },
  );
  void animation.finished.catch(() => undefined).then(() => ring.remove());
}
