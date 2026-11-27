import { animate } from 'motion/mini';
import { localDayKey } from './calendar';

/**
 * Calendar scale changes, animated with Motion.
 *
 * A day is the same object in every scale: a button in the year view, a cell in the month
 * grid, a column in the timeline, a row in the agenda. Those elements carry
 * `data-zoom-day="YYYY-MM-DD"` (their date number `data-zoom-num`), so a scale change can
 * pair each visible day before and after and morph the real element from where it was to
 * where it lands — every date visibly travels to its new place.
 *
 * - Before the new scale renders, the visible days and numbers are measured (as they are
 *   on screen, so an interrupted change continues from its current frame) and a copy of
 *   the view is frozen on top.
 * - Once the new scale is rendered and scrolled into place, each paired day is animated
 *   with Motion from its old box to its new one. Content that must not stretch (event
 *   chips, marked `data-zoom-scale`) is counter-scaled frame by frame; numbers travel and
 *   resize uniformly from their old size to their new one.
 * - Days that are not paired stay in the copy, which fades out over the new scale.
 */

export const CALENDAR_MORPH_DURATION = 440;
const FADE_DURATION = CALENDAR_MORPH_DURATION * 0.7;
const SAMPLES = 24;

interface Box { x: number; y: number; w: number; h: number }
interface Measure { days: Map<string, Box>; nums: Map<string, Box> }
type Controls = { stop(): void; finished: Promise<unknown> };

export interface CalendarZoomSnapshot {
  ghost: HTMLElement;
  /** Opacity the copy starts from. */
  opacity: string;
  before: Measure;
}

const running = new WeakMap<HTMLElement, { controls: Controls[]; moved: HTMLElement[] }>();

export function calendarReducedMotion(view: Window) {
  return view.document.documentElement.dataset.motion === 'reduced'
    || Boolean(view.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

/** `YYYY-MM`, matching the prefix of a day key and the year view's `data-month`. */
export function calendarMonthKey(day: Date) {
  return localDayKey(day).slice(0, 7);
}

/** cubic-bezier(0.22, 1, 0.36, 1): fast start, long soft landing. */
function ease(t: number) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const [x1, y1, x2, y2] = [0.22, 1, 0.36, 1];
  const bez = (a: number, b: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  let lo = 0, hi = 1, s = t;
  for (let i = 0; i < 24; i++) {
    s = (lo + hi) / 2;
    if (bez(x1, x2, s) < t) lo = s; else hi = s;
  }
  return bez(y1, y2, s);
}

const lerp = (a: number, b: number, e: number) => a + (b - a) * e;

function boxOf(element: Element): Box {
  const rect = element.getBoundingClientRect();
  return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
}

function measure(container: HTMLElement): Measure {
  const view = container.getBoundingClientRect();
  // At least half in view on each axis (or half the viewport, for days taller or wider
  // than it), so slivers peeking in at an edge do not fly across the screen.
  const visible = (box: Box) => {
    const width = Math.min(box.x + box.w, view.right) - Math.max(box.x, view.left);
    const height = Math.min(box.y + box.h, view.bottom) - Math.max(box.y, view.top);
    return box.w > 0 && box.h > 0
      && width >= Math.min(box.w, view.width) / 2 && height >= Math.min(box.h, view.height) / 2;
  };
  const collect = (attribute: string) => {
    const boxes = new Map<string, Box>();
    for (const element of container.querySelectorAll<HTMLElement>(`[${attribute}]`)) {
      const box = boxOf(element);
      const key = element.getAttribute(attribute);
      if (key && visible(box) && !boxes.has(key)) boxes.set(key, box);
    }
    return boxes;
  };
  return { days: collect('data-zoom-day'), nums: collect('data-zoom-num') };
}

/** Ends a change still animating; its elements return to their own layout. */
function settle(container: HTMLElement) {
  const state = running.get(container);
  if (!state) return;
  running.delete(container);
  for (const controls of state.controls) controls.stop();
  for (const element of state.moved) {
    element.style.removeProperty('transform');
    element.style.removeProperty('transform-origin');
    delete element.dataset.zoomMoving;
  }
}

/** Called before the new scale renders: measures the visible days and freezes a copy. */
export function captureCalendarZoom(
  container: HTMLElement | undefined,
  stage: HTMLElement | undefined,
): CalendarZoomSnapshot | undefined {
  const view = container?.ownerDocument.defaultView;
  if (!container || !stage || !view || calendarReducedMotion(view)) return undefined;
  if (typeof container.animate !== 'function' || !container.clientWidth || !container.clientHeight) return undefined;
  // Measured as on screen, mid-change included, before that change is settled.
  const before = measure(container);
  settle(container);
  const opacity = view.getComputedStyle(container).opacity || '1';
  const ghost = container.cloneNode(true) as HTMLElement;
  ghost.removeAttribute('aria-label');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  ghost.classList.add('calendar-zoom-ghost');
  const offset = container.offsetParent === stage
    ? { x: container.offsetLeft, y: container.offsetTop }
    : { x: 0, y: 0 };
  Object.assign(ghost.style, {
    position: 'absolute',
    left: `${offset.x}px`,
    top: `${offset.y}px`,
    width: `${container.offsetWidth}px`,
    height: `${container.offsetHeight}px`,
    pointerEvents: 'none',
    opacity,
    zIndex: '2',
  });
  // Copies of earlier, still-fading changes stay above; this one shows the live view.
  container.after(ghost);
  ghost.scrollTop = container.scrollTop;
  ghost.scrollLeft = container.scrollLeft;
  return { ghost, opacity, before };
}

export function discardCalendarZoom(snapshot: CalendarZoomSnapshot | undefined) {
  snapshot?.ghost.remove();
}

interface Frame { box: Box; sx: number; sy: number }

/** The day's box at each sample, and its scale relative to its new layout. */
function dayFrames(from: Box, to: Box): Frame[] {
  return Array.from({ length: SAMPLES + 1 }, (_, index) => {
    const e = ease(index / SAMPLES);
    const box = { x: lerp(from.x, to.x, e), y: lerp(from.y, to.y, e), w: lerp(from.w, to.w, e), h: lerp(from.h, to.h, e) };
    return { box, sx: box.w / to.w, sy: box.h / to.h };
  });
}

/**
 * Called once the new scale is rendered and scrolled into place: morphs every day visible
 * both before and after, and fades the copy (with the days that have nowhere to go).
 */
export function playCalendarZoom(snapshot: CalendarZoomSnapshot, container: HTMLElement | undefined): Promise<void> {
  const { ghost, before } = snapshot;
  if (!container || typeof ghost.animate !== 'function') {
    ghost.remove();
    return Promise.resolve();
  }
  const after = measure(container);
  const times = Array.from({ length: SAMPLES + 1 }, (_, index) => index / SAMPLES);
  const options = { duration: CALENDAR_MORPH_DURATION / 1000, ease: 'linear' as const, times };
  const controls: Controls[] = [];
  const moved: HTMLElement[] = [];
  const move = (element: HTMLElement, transforms: string[]) => {
    element.style.transformOrigin = '0 0';
    element.style.transform = transforms[0]!;
    controls.push(animate(element, { transform: transforms }, options));
    moved.push(element);
  };
  const landed = new Set<string>();
  const dayFramesByKey = new Map<string, { element: HTMLElement; to: Box; frames: Frame[] }>();

  for (const [key, from] of before.days) {
    const to = after.days.get(key);
    const element = to && container.querySelector<HTMLElement>(`[data-zoom-day="${key}"]`);
    if (!to || !element) continue;
    landed.add(`day:${key}`);
    const frames = dayFrames(from, to);
    dayFramesByKey.set(key, { element, to, frames });
    element.dataset.zoomMoving = '';
    move(element, frames.map(({ box, sx, sy }) => `translate(${box.x - to.x}px, ${box.y - to.y}px) scale(${sx}, ${sy})`));
    // Content that must keep its proportions rides along at its natural size.
    for (const child of element.querySelectorAll<HTMLElement>('[data-zoom-scale]')) {
      move(child, frames.map(({ sx, sy }) => `scale(${1 / sx}, ${1 / sy})`));
    }
  }

  for (const [key, to] of after.nums) {
    // A number only travels with a day that is itself in view (headers can peek out from
    // behind the time gutter while their column is off screen).
    if (!after.days.has(key) || !before.days.has(key)) continue;
    const element = container.querySelector<HTMLElement>(`[data-zoom-num="${key}"]`);
    if (!element) continue;
    const from = before.nums.get(key);
    const day = dayFramesByKey.get(key);
    const nested = day && day.element.contains(element);
    if (!from && !nested) continue;
    if (from) landed.add(`num:${key}`);
    const transforms = times.map((_, index) => {
      const e = ease(index / SAMPLES);
      // Where the number should be on screen, scaled uniformly from its old size.
      const scale = from ? lerp(from.h / to.h, 1, e) : 1;
      if (nested) {
        const { box, sx, sy } = day.frames[index]!;
        const local = { x: to.x - day.to.x, y: to.y - day.to.y };
        const target = from
          ? { x: lerp(from.x, to.x, e), y: lerp(from.y, to.y, e) }
          : { x: box.x + sx * local.x, y: box.y + sy * local.y };
        return `translate(${(target.x - box.x) / sx - local.x}px, ${(target.y - box.y) / sy - local.y}px) scale(${scale / sx}, ${scale / sy})`;
      }
      return `translate(${lerp(from!.x, to.x, e) - to.x}px, ${lerp(from!.y, to.y, e) - to.y}px) scale(${scale})`;
    });
    if (!nested) element.dataset.zoomMoving = '';
    move(element, transforms);
  }

  // In the copy, hide what the new scale now shows moving; the rest fades with the copy.
  for (const element of ghost.querySelectorAll<HTMLElement>('[data-zoom-day], [data-zoom-num]')) {
    const key = element.dataset.zoomDay ? `day:${element.dataset.zoomDay}` : `num:${element.dataset.zoomNum}`;
    if (landed.has(key)) element.dataset.zoomLanded = '';
  }
  const state = { controls, moved };
  running.set(container, state);
  void Promise.all(controls.map(control => control.finished.catch(() => undefined))).then(() => {
    if (running.get(container) === state) settle(container);
  });
  const fade = ghost.animate(
    [{ opacity: snapshot.opacity }, { opacity: 0 }],
    { duration: FADE_DURATION, easing: 'cubic-bezier(0.33, 1, 0.68, 1)', fill: 'forwards' },
  );
  return fade.finished.catch(() => undefined).then(() => { ghost.remove(); });
}
