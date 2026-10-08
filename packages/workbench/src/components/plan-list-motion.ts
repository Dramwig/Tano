import { animate } from 'motion/mini';

type Point = { x: number; y: number };
type Layout = Point & { motion?: ReturnType<typeof animate> };

// One layout scope for all three lists: changes in one group also move the groups below it.
export function createPlanListMotion(root: HTMLElement) {
  const layouts = new Map<HTMLElement, Layout>();
  const snapshots = new Map<HTMLElement, Point>();
  const resize = new ResizeObserver(() => update());
  const mutations = new MutationObserver(() => update());
  let visible = false;
  let disposed = false;

  function clear(element: HTMLElement, layout: Layout) {
    layout.motion?.stop();
    element.style.removeProperty('translate');
  }

  function capture() {
    snapshots.clear();
    const origin = root.getBoundingClientRect();
    for (const element of layouts.keys()) {
      if (!element.getClientRects().length) continue;
      const bounds = element.getBoundingClientRect();
      snapshots.set(element, { x: bounds.left - origin.left, y: bounds.top - origin.top });
    }
  }

  function update() {
    if (disposed) return;
    const nextVisible = !!root.getClientRects().length;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const origin = root.getBoundingClientRect();
    // Read every position before starting animations to avoid interleaving layout reads/writes.
    const entries = [...root.querySelectorAll<HTMLElement>('[data-plan-layout]')]
      .filter(element => element.getClientRects().length)
      .map(element => {
        const bounds = element.getBoundingClientRect();
        const translate = (getComputedStyle(element).translate || '').split(/\s+/).map(value => parseFloat(value) || 0);
        const offset = { x: translate[0] ?? 0, y: translate[1] ?? 0 };
        return { element, offset, x: bounds.left - origin.left - offset.x, y: bounds.top - origin.top - offset.y };
      });
    const elements = new Set(entries.map(entry => entry.element));
    for (const [element, layout] of layouts) {
      if (elements.has(element)) continue;
      clear(element, layout);
      resize.unobserve(element);
      layouts.delete(element);
    }
    for (const { element, offset, x, y } of entries) {
      const previous = layouts.get(element);
      if (previous && Math.abs(previous.x - x) < 0.5 && Math.abs(previous.y - y) < 0.5) {
        if (reduced) { clear(element, previous); previous.motion = undefined; }
        continue;
      }
      // Cached natural positions also cover DOM removals after a delayed leave finishes.
      // During a quick second change, continue from the current rendered position.
      const from = snapshots.get(element) ?? (previous
        ? { x: previous.x + offset.x, y: previous.y + offset.y }
        : { x, y: y + 6 });
      if (previous) clear(element, previous);
      else resize.observe(element);
      const layout: Layout = { x, y };
      layouts.set(element, layout);
      if (!visible || !nextVisible || reduced || typeof element.animate !== 'function') continue;
      const dx = from.x - x, dy = from.y - y;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      const movement = animate(element, { translate: [`${dx}px ${dy}px`, '0px 0px'] }, {
        duration: 0.22, ease: [0.22, 1, 0.36, 1],
      });
      layout.motion = movement;
      void movement.finished.then(() => {
        if (layouts.get(element) !== layout || layout.motion !== movement) return;
        clear(element, layout);
        layout.motion = undefined;
      });
    }
    visible = nextVisible;
    snapshots.clear();
  }

  // Vue updates, asynchronous transition removals, and text wrapping all share this scope.
  mutations.observe(root, { childList: true, characterData: true, subtree: true });
  resize.observe(root);
  update();
  return {
    capture,
    update,
    dispose() {
      disposed = true;
      mutations.disconnect();
      resize.disconnect();
      for (const [element, layout] of layouts) clear(element, layout);
      layouts.clear();
      snapshots.clear();
    },
  };
}
