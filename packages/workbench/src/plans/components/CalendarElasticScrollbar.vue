<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { t } from '../../i18n/i18n';
import { useWindowContext } from '../../windows/context';

const props = defineProps<{
  container: HTMLElement | undefined;
  orientation: 'horizontal' | 'vertical';
  /** Reactive key(s) that trigger a thumb sync when content size changes. */
  syncKey?: number | string;
  minPxPerSec: number;
  maxPxPerSec: number;
  slideWindow: (direction: -1 | 1, stepPx: number) => Promise<void>;
  setDragging: (dragging: boolean) => void;
}>();

const { window } = useWindowContext();
const ResizeObserverCtor = (window as Window & typeof globalThis).ResizeObserver;

const OVERSCROLL_DEADZONE = 6;
const OVERSCROLL_MAX_PULL = 180;
const SQUASH_DECAY_PX = 90;

const REBOUND_MS = 460;
/** Half of the 8px thumb thickness: fully rounded caps. */
const CAP_RADIUS = 4;
/** Cross-axis center of the 14px track lane. */
const LANE_CENTER = 7;

/**
 * Wake streaks trailing behind the pinned thumb. Low speed shows three short,
 * slow, faint dashes on the center lane; higher speeds unlock side lanes and
 * stretch every streak into a long hairline that flows noticeably faster.
 */
const PARTICLE_SPECS = [
  { lane: 0, phase: 0.0, minSpeed: 0.0 },
  { lane: 0, phase: 0.34, minSpeed: 0.0 },
  { lane: 0, phase: 0.67, minSpeed: 0.0 },
  { lane: -1, phase: 0.17, minSpeed: 0.28 },
  { lane: 1, phase: 0.5, minSpeed: 0.28 },
  { lane: -1, phase: 0.84, minSpeed: 0.52 },
  { lane: 1, phase: 0.09, minSpeed: 0.7 },
  { lane: 0, phase: 0.59, minSpeed: 0.82 },
] as const;

interface ElasticShape {
  ratio: number;
  speed: number;
  dir: -1 | 1;
}

const isHorizontal = computed(() => props.orientation === 'horizontal');
const track = ref<HTMLElement>();
const trackSize = ref(0);
const thumbSize = ref(64);
const thumbPos = ref(0);
const scrollable = ref(false);
const dragging = ref(false);
const rebounding = ref(false);
const overscrollPx = ref(0);
const particleClock = ref(0);
/** Shape captured at release so the rebound starts from the squashed state. */
const reboundShape = ref<ElasticShape>();

let resizeObserver: ResizeObserver | undefined;
let dragStartClient = 0;
let dragStartThumbPos = 0;
let activePointerId: number | undefined;
let overscrollEdge: -1 | 0 | 1 = 0;
let rafId: number | undefined;
let lastFrameTime = 0;
let sliding = false;
let reboundTimer: ReturnType<typeof setTimeout> | undefined;

const maxThumbPos = computed(() => Math.max(0, trackSize.value - thumbSize.value));

const overscrollDirection = computed<-1 | 0 | 1>(() =>
  overscrollPx.value < -0.5 ? -1 : overscrollPx.value > 0.5 ? 1 : 0,
);

const elasticRatio = computed(() => {
  const abs = Math.abs(overscrollPx.value);
  if (abs <= 0.5) return 0;
  return 1 - Math.exp(-abs / SQUASH_DECAY_PX);
});

const speedNorm = computed(() => {
  const abs = Math.abs(overscrollPx.value);
  if (abs <= OVERSCROLL_DEADZONE) return 0;
  return Math.min(1, (abs - OVERSCROLL_DEADZONE) / OVERSCROLL_MAX_PULL);
});

const overscrollPxPerSec = computed(() => {
  const norm = speedNorm.value;
  if (norm <= 0) return 0;
  return props.minPxPerSec + (props.maxPxPerSec - props.minPxPerSec) * Math.pow(norm, 1.85);
});

const liveShape = computed<ElasticShape | undefined>(() => {
  const dir = overscrollDirection.value;
  if (dir === 0) return undefined;
  return { ratio: elasticRatio.value, speed: speedNorm.value, dir };
});

/** Main-axis compression and cross-axis bulge, roughly volume preserving. */
function squash(shape: ElasticShape) {
  return {
    main: 1 - shape.ratio * 0.34,
    cross: 1 + shape.ratio * 0.24 + shape.speed * 0.06,
  };
}

/** Gradient angle pointing from the pressed edge toward the thumb's tail. */
function edgeAngle(dir: -1 | 1) {
  if (isHorizontal.value) return dir < 0 ? '90deg' : '270deg';
  return dir < 0 ? '180deg' : '0deg';
}

function edgeOrigin(dir: -1 | 0 | 1) {
  if (isHorizontal.value) return dir < 0 ? 'left center' : dir > 0 ? 'right center' : 'center center';
  return dir < 0 ? 'center top' : dir > 0 ? 'center bottom' : 'center center';
}

/** Flatten the cap that presses against the wall; keep the tail fully rounded. */
function capRadii(shape: ElasticShape) {
  const flat = `${Math.max(1.4, CAP_RADIUS - shape.ratio * 2.6).toFixed(2)}px`;
  const round = `${CAP_RADIUS}px`;
  if (isHorizontal.value) {
    return shape.dir < 0 ? `${flat} ${round} ${round} ${flat}` : `${round} ${flat} ${flat} ${round}`;
  }
  return shape.dir < 0 ? `${flat} ${flat} ${round} ${round}` : `${round} ${round} ${flat} ${flat}`;
}

function scaleFor(main: number, cross: number) {
  return isHorizontal.value
    ? `scale(${main.toFixed(4)}, ${cross.toFixed(4)})`
    : `scale(${cross.toFixed(4)}, ${main.toFixed(4)})`;
}

const thumbStyle = computed(() => {
  const style: Record<string, string> = isHorizontal.value
    ? { width: `${thumbSize.value}px`, left: `${thumbPos.value}px` }
    : { height: `${thumbSize.value}px`, top: `${thumbPos.value}px` };
  const live = liveShape.value;
  const shape = live ?? (rebounding.value ? reboundShape.value : undefined);
  if (!shape) {
    style.transformOrigin = 'center center';
    style.transform = 'scale(1, 1)';
    return style;
  }

  const { ratio, speed, dir } = shape;
  const { main, cross } = squash(shape);
  style.transformOrigin = edgeOrigin(dir);
  style.borderRadius = capRadii(shape);
  style['--elastic-angle'] = edgeAngle(dir);
  // Deeper ink concentrates at the pressed cap and reaches further with speed.
  style['--elastic-head-mix'] = `${Math.round(14 + ratio * 16 + speed * 38)}%`;
  style['--elastic-mid-mix'] = `${Math.round(3 + ratio * 7 + speed * 17)}%`;
  style['--elastic-spread'] = `${Math.round(30 + speed * 36)}%`;

  if (live) {
    style.transform = scaleFor(main, cross);
  } else {
    // Damped rebound: release from the squash, overshoot once, settle.
    style.transform = 'scale(1, 1)';
    const rb = (m: number, c: number) => scaleFor(m, c);
    style['--rebound-from'] = rb(main, cross);
    style['--rebound-over'] = rb(1 + ratio * 0.1, 1 - ratio * 0.07);
    style['--rebound-settle'] = rb(1 - ratio * 0.03, 1 + ratio * 0.02);
  }
  return style;
});

const wallStyle = computed(() => {
  const live = liveShape.value;
  if (!dragging.value || !live) return undefined;
  const length = 6 + live.ratio * 6 + live.speed * 4;
  const opacity = 0.14 + live.ratio * 0.16 + live.speed * 0.36;
  const edge = isHorizontal.value ? (live.dir < 0 ? 'left' : 'right') : (live.dir < 0 ? 'top' : 'bottom');
  return isHorizontal.value
    ? { [edge]: '-3.5px', top: '50%', width: '1.5px', height: `${length.toFixed(1)}px`, opacity: opacity.toFixed(3) }
    : { [edge]: '-3.5px', left: '50%', height: '1.5px', width: `${length.toFixed(1)}px`, opacity: opacity.toFixed(3) };
});

const particles = computed(() => {
  const live = liveShape.value;
  if (!dragging.value || !live || live.speed <= 0) return [];
  const { speed, dir } = live;
  const tail = thumbSize.value * squash(live).main;
  const totalTrack = trackSize.value;
  const clock = particleClock.value;
  const travel = 18 + speed * 64;
  const baseLength = 2.6 + Math.pow(speed, 1.1) * 22;
  const thickness = 2.2 - speed * 0.75;
  const laneGap = 2 + speed * 1.4;
  const angle = edgeAngle(dir);
  const items: Array<{ key: number; style: Record<string, string> }> = [];

  for (let i = 0; i < PARTICLE_SPECS.length; i++) {
    const spec = PARTICLE_SPECS[i]!;
    if (speed < spec.minSpeed) continue;
    const p = (clock + spec.phase) % 1;
    // Launched briskly from the tail, then easing out as it dissipates.
    const eased = 1 - (1 - p) * (1 - p);
    const length = baseLength * (1 - p * 0.4);
    const distance = tail + 5 + eased * travel;
    const mainStart = dir < 0 ? distance : Math.max(0, totalTrack - distance - length);
    const crossStart = LANE_CENTER + spec.lane * laneGap - thickness / 2;
    const envelope = Math.min(1, p / 0.12) * Math.pow(1 - p, 1.2);
    const opacity = envelope * (0.3 + speed * 0.55);
    const [x, y, w, h] = isHorizontal.value
      ? [mainStart, crossStart, length, thickness]
      : [crossStart, mainStart, thickness, length];
    items.push({
      key: i,
      style: {
        width: `${w.toFixed(1)}px`,
        height: `${h.toFixed(1)}px`,
        transform: `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`,
        opacity: opacity.toFixed(3),
        '--streak-angle': angle,
      },
    });
  }
  return items;
});

const ariaValueNow = computed(() => {
  const max = maxThumbPos.value;
  return max > 0 ? Math.round((thumbPos.value / max) * 100) : 0;
});

function readContainerMetrics(container: HTMLElement) {
  if (isHorizontal.value) {
    return {
      client: container.clientWidth,
      scroll: container.scrollWidth,
      offset: container.scrollLeft,
    };
  }
  return {
    client: container.clientHeight,
    scroll: container.scrollHeight,
    offset: container.scrollTop,
  };
}

function writeContainerOffset(container: HTMLElement, value: number) {
  if (isHorizontal.value) container.scrollLeft = value;
  else container.scrollTop = value;
}

function syncFromScroll() {
  const container = props.container;
  const trackEl = track.value;
  if (!container || !trackEl || dragging.value) return;
  const ts = isHorizontal.value ? trackEl.clientWidth : trackEl.clientHeight;
  const { client, scroll, offset } = readContainerMetrics(container);
  const maxScroll = Math.max(0, scroll - client);
  trackSize.value = ts;
  scrollable.value = maxScroll > 1 && ts > 0;
  if (!scrollable.value) {
    thumbSize.value = ts;
    thumbPos.value = 0;
    return;
  }
  const nextThumbSize = Math.max(40, Math.min(ts * 0.6, (client / scroll) * ts));
  thumbSize.value = nextThumbSize;
  const progress = Math.min(1, Math.max(0, offset / maxScroll));
  thumbPos.value = progress * Math.max(0, ts - nextThumbSize);
}

function stopAutoScroll() {
  if (rafId !== undefined) {
    window.cancelAnimationFrame(rafId);
    rafId = undefined;
  }
  lastFrameTime = 0;
}

function stepAutoScroll(timestamp: number) {
  rafId = undefined;
  const container = props.container;
  const direction = overscrollDirection.value;
  const speedPx = overscrollPxPerSec.value;
  if (!dragging.value || !container || direction === 0 || speedPx <= 0) {
    lastFrameTime = 0;
    return;
  }
  const dt = lastFrameTime > 0 ? Math.min(0.05, Math.max(0.001, (timestamp - lastFrameTime) / 1000)) : 1 / 60;
  lastFrameTime = timestamp;

  // Wake streak cycle: an unhurried drift at low speed, a brisk stream at high speed.
  particleClock.value = (particleClock.value + dt * (0.7 + Math.pow(speedNorm.value, 1.2) * 2.6)) % 1;

  if (!sliding) {
    const stepPx = speedPx * dt;
    sliding = true;
    void props.slideWindow(direction, stepPx).finally(() => {
      sliding = false;
    });
  }
  rafId = window.requestAnimationFrame(stepAutoScroll);
}

function ensureAutoScroll() {
  if (overscrollPxPerSec.value > 0) {
    if (rafId === undefined) {
      lastFrameTime = 0;
      rafId = window.requestAnimationFrame(stepAutoScroll);
    }
  } else {
    stopAutoScroll();
  }
}

function startDrag(event: PointerEvent, initialThumbPos: number) {
  const trackEl = track.value;
  if (!trackEl || !scrollable.value) return;
  if (reboundTimer !== undefined) {
    clearTimeout(reboundTimer);
    reboundTimer = undefined;
  }
  rebounding.value = false;
  reboundShape.value = undefined;
  dragging.value = true;
  overscrollEdge = 0;
  overscrollPx.value = 0;
  activePointerId = event.pointerId;
  dragStartClient = isHorizontal.value ? event.clientX : event.clientY;
  dragStartThumbPos = initialThumbPos;
  props.setDragging(true);
  trackEl.setPointerCapture?.(event.pointerId);
}

function onThumbPointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  syncFromScroll();
  startDrag(event, thumbPos.value);
}

function onTrackPointerDown(event: PointerEvent) {
  if (event.button !== 0 || !track.value || !props.container || !scrollable.value) return;
  event.preventDefault();
  const rect = track.value.getBoundingClientRect();
  const pointerAxis = isHorizontal.value ? event.clientX - rect.left : event.clientY - rect.top;
  const targetThumbPos = Math.min(
    maxThumbPos.value,
    Math.max(0, pointerAxis - thumbSize.value / 2),
  );
  const { client, scroll } = readContainerMetrics(props.container);
  const maxScroll = Math.max(0, scroll - client);
  if (maxThumbPos.value > 0) {
    writeContainerOffset(props.container, (targetThumbPos / maxThumbPos.value) * maxScroll);
  }
  thumbPos.value = targetThumbPos;
  startDrag(event, targetThumbPos);
}

function onPointerMove(event: PointerEvent) {
  if (!dragging.value || event.pointerId !== activePointerId) return;
  const container = props.container;
  if (!container) return;
  const maxPos = maxThumbPos.value;
  const { client, scroll } = readContainerMetrics(container);
  const maxScroll = Math.max(0, scroll - client);
  const pointerAxis = isHorizontal.value ? event.clientX : event.clientY;
  const rawThumbPos = dragStartThumbPos + (pointerAxis - dragStartClient);

  if (rawThumbPos < 0) {
    thumbPos.value = 0;
    overscrollPx.value = rawThumbPos;
    if (overscrollEdge !== -1) {
      overscrollEdge = -1;
      writeContainerOffset(container, 0);
    }
    ensureAutoScroll();
    return;
  }
  if (rawThumbPos > maxPos) {
    thumbPos.value = maxPos;
    overscrollPx.value = rawThumbPos - maxPos;
    if (overscrollEdge !== 1) {
      overscrollEdge = 1;
      writeContainerOffset(container, maxScroll);
    }
    ensureAutoScroll();
    return;
  }

  overscrollEdge = 0;
  overscrollPx.value = 0;
  stopAutoScroll();
  thumbPos.value = rawThumbPos;
  if (maxPos > 0) {
    writeContainerOffset(container, (rawThumbPos / maxPos) * maxScroll);
  }
}

function finishDrag(event?: PointerEvent) {
  if (!dragging.value) return;
  if (event && activePointerId !== undefined && event.pointerId !== activePointerId) return;
  const releasedShape = liveShape.value;
  stopAutoScroll();
  if (activePointerId !== undefined) {
    try { track.value?.releasePointerCapture?.(activePointerId); } catch { /* ignore */ }
  }
  activePointerId = undefined;
  dragging.value = false;
  overscrollEdge = 0;
  overscrollPx.value = 0;
  props.setDragging(false);

  if (releasedShape) {
    reboundShape.value = releasedShape;
    rebounding.value = true;
    reboundTimer = setTimeout(() => {
      rebounding.value = false;
      reboundShape.value = undefined;
      reboundTimer = undefined;
    }, REBOUND_MS);
  }
  syncFromScroll();
}

function bindContainer(el: HTMLElement | undefined, prev?: HTMLElement) {
  prev?.removeEventListener('scroll', syncFromScroll);
  if (prev) resizeObserver?.unobserve(prev);
  if (el) {
    el.addEventListener('scroll', syncFromScroll, { passive: true });
    resizeObserver?.observe(el);
    syncFromScroll();
  }
}

watch(() => props.container, (el, prev) => bindContainer(el, prev));
watch([() => props.orientation, () => props.syncKey], () => {
  window.requestAnimationFrame(syncFromScroll);
});

onMounted(() => {
  if (typeof ResizeObserverCtor !== 'undefined') {
    resizeObserver = new ResizeObserverCtor(() => syncFromScroll());
    if (track.value) resizeObserver.observe(track.value);
  }
  bindContainer(props.container);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', finishDrag);
  window.addEventListener('pointercancel', finishDrag);
});

onUnmounted(() => {
  stopAutoScroll();
  if (reboundTimer !== undefined) clearTimeout(reboundTimer);
  props.setDragging(false);
  props.container?.removeEventListener('scroll', syncFromScroll);
  resizeObserver?.disconnect();
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', finishDrag);
  window.removeEventListener('pointercancel', finishDrag);
});
</script>

<template>
  <div
    class="calendar-escroll"
    :class="[
      isHorizontal ? 'is-horizontal' : 'is-vertical',
      { 'is-dragging': dragging, 'is-overscrolling': overscrollDirection !== 0, 'is-hidden': !scrollable },
    ]"
  >
    <div
      ref="track"
      class="calendar-escroll-track"
      role="scrollbar"
      :aria-orientation="orientation"
      :aria-label="isHorizontal ? t('时间轴横向滚动条') : t('日历纵向滚动条')"
      :aria-valuemin="0"
      :aria-valuemax="100"
      :aria-valuenow="ariaValueNow"
      @pointerdown="onTrackPointerDown"
    >
      <div
        class="calendar-escroll-thumb"
        :class="{
          'is-dragging': dragging,
          'is-overscrolling': overscrollDirection !== 0,
          'is-overscroll-start': overscrollDirection < 0,
          'is-overscroll-end': overscrollDirection > 0,
          'is-rebounding': rebounding,
        }"
        :style="thumbStyle"
        @pointerdown="onThumbPointerDown"
      />
      <span v-if="wallStyle" class="calendar-escroll-wall" :style="wallStyle" aria-hidden="true" />
      <div v-if="particles.length" class="calendar-escroll-particles" aria-hidden="true">
        <span
          v-for="particle in particles"
          :key="particle.key"
          class="calendar-escroll-particle"
          :style="particle.style"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.calendar-escroll {
  position: relative;
  display: flex;
  align-items: center;
  background: var(--paper);
  user-select: none;
  touch-action: none;
  overflow: visible;
  z-index: 6;
}
.calendar-escroll.is-horizontal {
  flex: none;
  height: 14px;
  padding: 0 var(--scrollbar-size, 12px) 0 4px;
}
.calendar-escroll.is-vertical {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 14px;
  padding: 4px 0;
  flex-direction: column;
  background: transparent;
}
.calendar-escroll.is-hidden {
  visibility: hidden;
  pointer-events: none;
}
.calendar-escroll-track {
  position: relative;
  flex: 1;
  width: 100%;
  height: 100%;
  overflow: visible;
  cursor: pointer;
}
.calendar-escroll-thumb {
  --thumb-ink: var(--scrollbar-thumb-hover, var(--muted, #787774));
  position: absolute;
  border-radius: 4px;
  background-color: var(--scrollbar-thumb, var(--control-border, #d3d2ce));
  cursor: grab;
  will-change: transform, left, top;
  transition: background-color 180ms var(--ease-standard, ease);
}
.calendar-escroll.is-horizontal .calendar-escroll-thumb {
  top: 3px;
  height: 8px;
}
.calendar-escroll.is-vertical .calendar-escroll-thumb {
  left: 3px;
  width: 8px;
}

/* Hover and the whole drag (even with the pointer outside the track) share one ink. */
.calendar-escroll-track:hover .calendar-escroll-thumb,
.calendar-escroll.is-dragging .calendar-escroll-thumb,
.calendar-escroll-thumb.is-dragging {
  background-color: var(--thumb-ink);
}
.calendar-escroll.is-dragging .calendar-escroll-thumb,
.calendar-escroll-thumb.is-dragging {
  cursor: grabbing;
  transition: background-color 70ms var(--ease-standard, ease-out);
}

/*
 * Pressure ink: an overlay that deepens toward the pressed cap. Its strength and
 * reach follow the pull speed; it fades in fast and lingers briefly on release.
 */
.calendar-escroll-thumb::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(
    var(--elastic-angle, 90deg),
    color-mix(in srgb, var(--text) var(--elastic-head-mix, 30%), var(--thumb-ink)) 0%,
    color-mix(in srgb, var(--text) var(--elastic-mid-mix, 10%), var(--thumb-ink)) var(--elastic-spread, 40%),
    transparent 100%
  );
  opacity: 0;
  pointer-events: none;
  transition: opacity 260ms var(--ease-standard, ease-out);
}
.calendar-escroll-thumb.is-overscrolling::before {
  opacity: 1;
  transition-duration: 90ms;
}

/* Live squash: a short follow-through so the material feels soft, not laggy. */
.calendar-escroll .calendar-escroll-thumb.is-overscrolling {
  transition:
    transform 90ms cubic-bezier(0.2, 0.9, 0.3, 1),
    border-radius 90ms cubic-bezier(0.2, 0.9, 0.3, 1),
    background-color 70ms var(--ease-standard, ease-out);
}

/* Release: spring out of the squash, overshoot once, settle. */
.calendar-escroll .calendar-escroll-thumb.is-rebounding {
  animation: calendar-escroll-rebound 440ms linear both;
  transition:
    left 180ms var(--ease-standard, ease-out),
    top 180ms var(--ease-standard, ease-out),
    border-radius 320ms var(--ease-standard, ease-out),
    background-color 180ms var(--ease-standard, ease);
}
@keyframes calendar-escroll-rebound {
  0% {
    transform: var(--rebound-from, scale(1, 1));
    animation-timing-function: cubic-bezier(0.22, 0.9, 0.35, 1);
  }
  36% {
    transform: var(--rebound-over, scale(1, 1));
    animation-timing-function: cubic-bezier(0.45, 0, 0.4, 1);
  }
  66% {
    transform: var(--rebound-settle, scale(1, 1));
    animation-timing-function: cubic-bezier(0.4, 0, 0.3, 1);
  }
  100% {
    transform: scale(1, 1);
  }
}

/* Hairline "wall" the thumb presses against. */
.calendar-escroll-wall {
  position: absolute;
  border-radius: 999px;
  background: var(--text);
  pointer-events: none;
  transition:
    opacity 120ms var(--ease-standard, ease-out),
    width 120ms var(--ease-standard, ease-out),
    height 120ms var(--ease-standard, ease-out);
}
.calendar-escroll.is-horizontal .calendar-escroll-wall {
  transform: translateY(-50%);
}
.calendar-escroll.is-vertical .calendar-escroll-wall {
  transform: translateX(-50%);
}

/* Wake streaks trailing the pinned thumb: short dashes when slow, long hairlines when fast. */
.calendar-escroll-particles {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: visible;
}
.calendar-escroll-particle {
  position: absolute;
  top: 0;
  left: 0;
  border-radius: 999px;
  background: linear-gradient(
    var(--streak-angle, 90deg),
    var(--text) 0%,
    color-mix(in srgb, var(--text) 55%, transparent) 55%,
    transparent 100%
  );
  will-change: transform, opacity;
}

@media (prefers-reduced-motion: reduce) {
  .calendar-escroll-thumb,
  .calendar-escroll-thumb::before,
  .calendar-escroll-wall {
    transition: none !important;
  }
  .calendar-escroll-thumb {
    transform: none !important;
    animation: none !important;
  }
  .calendar-escroll-particles {
    display: none;
  }
}
</style>
