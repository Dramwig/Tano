import type { ObjectDirective } from 'vue';

const disposers = new WeakMap<HTMLElement, () => void>();

/** Keep a scroll mask at the viewport edges, fading only overflowing content. */
export const vScrollFade: ObjectDirective<HTMLElement> = {
  mounted(element) {
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = Math.max(0, element.scrollTop);
      const bottom = Math.max(0, element.scrollHeight - element.clientHeight - top - 1);
      element.style.setProperty('--scroll-fade-top', `${Math.min(18, top)}px`);
      element.style.setProperty('--scroll-fade-bottom', `${Math.min(18, bottom)}px`);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    // The viewport and its content can resize independently (drawer, folders,
    // newly loaded files, or a window resize).
    const resize = new ResizeObserver(schedule);
    const observeSizes = () => {
      resize.disconnect();
      resize.observe(element);
      for (const child of element.children) resize.observe(child);
      schedule();
    };
    const mutations = new MutationObserver(observeSizes);
    mutations.observe(element, { childList: true, subtree: true, characterData: true });
    element.addEventListener('scroll', schedule, { passive: true });
    observeSizes();
    disposers.set(element, () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      element.removeEventListener('scroll', schedule);
    });
  },
  beforeUnmount(element) {
    disposers.get(element)?.();
    disposers.delete(element);
  },
};
