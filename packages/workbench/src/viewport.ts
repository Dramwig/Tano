import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

/** A tablet in split view and a landscape phone both need an overlay drawer. */
export function compactViewport(width: number, touch: boolean): boolean {
  return width <= 700 || (touch && width < 1024);
}

export interface ViewportMetrics {
  height: number;
  offsetTop: number;
  scale: number;
}

// Do not reflow the document while the user pinch-zooms it. Keep the last
// unscaled geometry until the visual viewport returns to its normal scale.
export function visibleViewport(height: number, visual?: ViewportMetrics | null) {
  if (visual && Math.abs(visual.scale - 1) > 0.01) return null;
  return {
    height: Math.max(1, Math.round(Math.min(height, visual?.height ?? height))),
    top: Math.max(0, Math.round(visual?.offsetTop ?? 0)),
  };
}

export function useViewport(nativeMobile: boolean) {
  // A secondary touchscreen must not enlarge a mouse-first desktop layout.
  const coarse = window.matchMedia('(pointer: coarse)');
  const width = ref(window.innerWidth);
  const touch = ref(nativeMobile || coarse.matches);
  const compact = computed(() => compactViewport(width.value, touch.value));
  const root = document.documentElement;
  let frame = 0;
  function update() {
    width.value = window.innerWidth;
    touch.value = nativeMobile || coarse.matches;
    root.classList.toggle('touch-layout', touch.value);
    root.classList.toggle('compact-layout', compact.value);
    const viewport = touch.value ? visibleViewport(window.innerHeight, window.visualViewport) : null;
    if (viewport) {
      root.style.setProperty('--app-viewport-height', `${viewport.height}px`);
      root.style.setProperty('--app-viewport-top', `${viewport.top}px`);
    } else if (!touch.value) clearGeometry();
  }
  function clearGeometry() {
    root.style.removeProperty('--app-viewport-height');
    root.style.removeProperty('--app-viewport-top');
  }
  function schedule() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(update);
  }
  update();
  onMounted(() => {
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    document.addEventListener('visibilitychange', schedule);
    coarse.addEventListener('change', schedule);
  });
  onBeforeUnmount(() => {
    cancelAnimationFrame(frame);
    window.removeEventListener('resize', schedule);
    window.visualViewport?.removeEventListener('resize', schedule);
    window.visualViewport?.removeEventListener('scroll', schedule);
    document.removeEventListener('visibilitychange', schedule);
    coarse.removeEventListener('change', schedule);
    root.classList.remove('touch-layout', 'compact-layout');
    clearGeometry();
  });
  return { width, touch, compact };
}
