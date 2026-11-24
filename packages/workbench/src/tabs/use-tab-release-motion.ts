import { computed, onScopeDispose, ref, type CSSProperties } from 'vue';
import { settlingTab } from './tab-settle';

export interface TabDragPreview {
  id: string;
  path: string;
  dirty: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ReleaseMotion {
  id: string;
  mode: 'return' | 'reference';
  progress: number;
  returnSlot: boolean;
}

/** Owns release rendering and cancellation in the window displaying the tab. */
export function useTabReleaseMotion({ window, document }: { window: Window; document: Document }) {
  const preview = ref<TabDragPreview>();
  const previewStyle = ref<CSSProperties>();
  const release = ref<ReleaseMotion>();
  const settling = computed(() => !!release.value);
  const returningSlot = computed(() => release.value?.returnSlot ?? false);
  const referenceReveal = computed(() => release.value?.mode === 'reference'
    ? { id: release.value.id, opacity: release.value.progress } : undefined);
  const previewOpacity = computed(() => {
    if (referenceReveal.value) return 1 - referenceReveal.value.opacity;
    return release.value?.id === settlingTab.value?.id ? 1 - (settlingTab.value?.opacity ?? 0) : 1;
  });
  let frame = 0;

  function targetTab(id: string) {
    return [...document.querySelectorAll<HTMLElement>('.desktop-tab')]
      .find(tab => tab.dataset.id === id);
  }

  function contentMetrics(element: Element | null) {
    if (!element) return;
    const style = window.getComputedStyle(element);
    return {
      paddingLeft: parseFloat(style.paddingLeft) || 0,
      paddingRight: parseFloat(style.paddingRight) || 0,
      paddingTop: parseFloat(style.paddingTop) || 0,
      paddingBottom: parseFloat(style.paddingBottom) || 0,
      columnGap: parseFloat(style.columnGap) || 0,
      lineHeight: parseFloat(style.lineHeight) || (parseFloat(style.fontSize) || 13) * 1.5,
    };
  }

  function colors(element: Element | null) {
    if (!element) return;
    const style = window.getComputedStyle(element);
    return { backgroundColor: style.backgroundColor, color: style.color };
  }

  function blendColor(from: string, to: string, progress: number) {
    if (from === to || progress === 1) return to;
    return `color-mix(in srgb, ${from} ${(1 - progress) * 100}%, ${to})`;
  }

  function cancel() {
    window.cancelAnimationFrame(frame);
    frame = 0;
    const current = release.value;
    release.value = undefined;
    previewStyle.value = undefined;
    if (!current) return;
    if (settlingTab.value?.id === current.id) settlingTab.value = undefined;
    if (preview.value?.id === current.id) preview.value = undefined;
  }

  function settle(from: TabDragPreview, options: { mode?: ReleaseMotion['mode']; returnSlot?: boolean } = {}) {
    cancel();
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      || document.documentElement.dataset.motion === 'reduced';
    const home = targetTab(from.id)?.getBoundingClientRect();
    if (reduced || !home || typeof document.documentElement.animate !== 'function') return;
    let contentFrom = contentMetrics(document.querySelector('.desktop-tab-drag-preview'));
    let colorsFrom = colors(document.querySelector('.desktop-tab-drag-preview'));
    preview.value = { ...from };
    release.value = { id: from.id, mode: options.mode ?? 'return', progress: 0, returnSlot: options.returnSlot ?? false };
    const current = release.value;
    if (current.mode === 'return') settlingTab.value = { id: from.id, opacity: 0 };
    // The animation clock and frame timestamps must belong to the same window.
    const startedAt = window.performance.now();
    const distance = Math.hypot(home.left - from.left, home.top - from.top);
    const duration = Math.min(460, 260 + distance * 0.18);
    let landed = false;
    const step = (now: number) => {
      // A queued frame from a cancelled release cannot update its successor.
      if (release.value !== current) return;
      if (landed) { cancel(); return; }
      const tab = targetTab(from.id);
      const box = tab?.getBoundingClientRect();
      const drawing = preview.value;
      if (!box || !drawing) { cancel(); return; }
      const elapsed = Math.max(0, Math.min(1, (now - startedAt) / duration));
      const progress = 1 - (1 - elapsed) ** 3;
      current.progress = progress;
      if (current.mode === 'return') {
        // An incoming native drop can mount its DOM preview only after settle().
        const contentStart = contentFrom ??= contentMetrics(document.querySelector('.desktop-tab-drag-preview'));
        const colorStart = colorsFrom ??= colors(document.querySelector('.desktop-tab-drag-preview'));
        // Re-measure each frame while panes resize or the strip scrolls.
        drawing.left = from.left + (box.left - from.left) * progress;
        drawing.top = from.top + (box.top - from.top) * progress;
        drawing.width = from.width + (box.width - from.width) * progress;
        drawing.height = from.height + (box.height - from.height) * progress;
        const contentTo = contentMetrics(tab!.querySelector('.desktop-tab-switch'));
        const colorTo = colors(tab!);
        const style: CSSProperties = {};
        if (contentStart && contentTo) {
          Object.assign(style, Object.fromEntries(Object.entries(contentTo).map(([key, value]) => {
            const start = contentStart[key as keyof typeof contentStart];
            return [key, `${start + (value - start) * progress}px`];
          })));
        }
        // Read the destination's resolved colors so selection, hover and themes
        // share the same appearance as the tab that will take over rendering.
        if (colorStart && colorTo) {
          style.backgroundColor = blendColor(colorStart.backgroundColor, colorTo.backgroundColor, progress);
          style.color = blendColor(colorStart.color, colorTo.color, progress);
        }
        // The lifted card sets back down: ring and shadows fade with the flight.
        const rest = 1 - progress;
        style.boxShadow = `0 0 0 1px color-mix(in srgb, var(--line) ${rest * 100}%, transparent), `
          + `0 8px 22px rgb(0 0 0 / ${12 * rest}%), 0 2px 6px rgb(0 0 0 / ${6 * rest}%)`;
        previewStyle.value = style;
        // Reveal the aligned tab and hide the preview in the same Vue update.
        // Two half-opacity layers compose to only 75% coverage and cause a flash.
        // Keep the final styles until the next frame before disposing the preview.
        const targetMoving = tab!.getAnimations?.().some(animation => animation.playState === 'running');
        if (elapsed >= 1 && !targetMoving) {
          if (settlingTab.value?.id === from.id) settlingTab.value.opacity = 1;
          landed = true;
        }
      } else if (elapsed >= 1) {
        cancel();
        return;
      }
      frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
  }

  onScopeDispose(cancel);
  return { preview, previewStyle, previewOpacity, settling, returningSlot, referenceReveal, settle, cancel };
}
