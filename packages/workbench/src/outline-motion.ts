import { animate } from 'motion/mini';
import type { ObjectDirective } from 'vue';

const disposers = new WeakMap<HTMLElement, () => void>();

/** Animate the outline's actual dimensions so text and scroll masks stay sharp. */
export const vOutlineMotion: ObjectDirective<HTMLElement> = {
  mounted(root) {
    const element = root.querySelector<HTMLElement>('.inspector-surface');
    if (!element) return;
    const surface: HTMLElement = element;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let previous = surface.getBoundingClientRect();
    let motion: ReturnType<typeof animate> | undefined;
    let frame = 0;
    let disposed = false;
    let lockedContent: { element: HTMLElement; width: string; alignSelf: string }[] = [];

    function clear() {
      motion?.cancel();
      motion = undefined;
      surface.style.removeProperty('width');
      surface.style.removeProperty('height');
      surface.style.removeProperty('opacity');
      root.removeAttribute('data-outline-closing');
      for (const { element, width, alignSelf } of lockedContent) {
        element.style.width = width;
        element.style.alignSelf = alignSelf;
      }
      lockedContent = [];
    }

    function update() {
      frame = 0;
      if (disposed) return;
      // A second interaction starts at the in-flight size, not the old endpoint.
      const from = motion ? surface.getBoundingClientRect() : previous;
      const fromOpacity = motion ? Number(getComputedStyle(surface).opacity) : 1;
      clear();
      const to = surface.getBoundingClientRect();
      previous = to;
      if (!root.classList.contains('inspector-outline') || reduced.matches ||
          typeof surface.animate !== 'function' || !from.width || !from.height ||
          !to.width || !to.height ||
          (Math.abs(to.width - from.width) < 0.5 && Math.abs(to.height - from.height) < 0.5)) return;

      const closing = root.classList.contains('inspector-hover-outline') && !root.matches(':hover, :focus-within') &&
        from.width > to.width + 0.5;
      // Keep the expanded card painted until the exit finishes. The compact
      // rail's display:none/background rules would otherwise erase the motion.
      if (closing) root.setAttribute('data-outline-closing', '');
      if (closing || Math.abs(to.width - from.width) >= 0.5) {
        // Reveal a fully laid-out column through the card's overflow clip.
        // Animating its available text width would rewrap every heading per frame.
        const children = [...surface.children]
          .filter((child): child is HTMLElement => child instanceof HTMLElement && !!child.getClientRects().length)
          .map(element => ({ element, width: element.getBoundingClientRect().width }));
        for (const { element, width } of children) {
          lockedContent.push({ element, width: element.style.width, alignSelf: element.style.alignSelf });
          element.style.width = `${width}px`;
          element.style.alignSelf = root.classList.contains('inspector-outline-left') ? 'flex-start' : 'flex-end';
        }
      }
      const animation = animate(surface, {
        width: [from.width, to.width],
        height: [from.height, to.height],
        opacity: [fromOpacity, closing ? 0 : 1],
      }, { duration: 0.24, ease: closing ? [0.4, 0, 0.2, 1] : [0.22, 1, 0.36, 1] });
      motion = animation;
      void animation.finished.then(() => {
        if (disposed || motion !== animation) return;
        clear();
        previous = surface.getBoundingClientRect();
      });
    }

    function schedule() {
      if (!disposed && !frame) frame = requestAnimationFrame(update);
    }

    // CSS hover/focus changes do not cause Vue updates. Observe their events as
    // well as content changes (search, auto-collapse, and document switching).
    const events = ['pointerenter', 'pointerleave', 'focusin', 'focusout'] as const;
    for (const event of events) root.addEventListener(event, schedule);
    const mutations = new MutationObserver(records => {
      if (records.some(record => record.type !== 'attributes' || record.target === root)) schedule();
    });
    mutations.observe(root, {
      childList: true, characterData: true, subtree: true,
      attributes: true, attributeFilter: ['class', 'style'],
    });
    const resize = new ResizeObserver(() => {
      // Ignore the animation's own layout frames to avoid a resize feedback loop.
      if (!motion) schedule();
    });
    resize.observe(surface);
    window.addEventListener('resize', schedule);
    reduced.addEventListener('change', schedule);

    disposers.set(root, () => {
      disposed = true;
      cancelAnimationFrame(frame);
      mutations.disconnect();
      resize.disconnect();
      for (const event of events) root.removeEventListener(event, schedule);
      window.removeEventListener('resize', schedule);
      reduced.removeEventListener('change', schedule);
      clear();
    });
  },
  beforeUnmount(root) {
    disposers.get(root)?.();
    disposers.delete(root);
  },
};
