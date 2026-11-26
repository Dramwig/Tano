import type { Directive } from 'vue';
import { staggerIn, type StaggerOptions } from '@tano/editor/motion';

/* v-enter-stagger — the mail welcome page entrance for any page.
 *
 *   <section v-enter-stagger="'.heading, .row'">
 *   <article v-enter-stagger="{ items: '.heading, .section', key: plugin.id }">
 *
 * Plays when the element mounts. If it mounts hidden (v-show behind a loading
 * skeleton, an inactive tab) it plays the first time it gets a size, within
 * WAIT_FOR_SIZE. A changed `key` replays it (the same page showing another
 * folder or plugin); other re-renders never do, so typing in a filter or a
 * list updating does not animate.
 */
export type EnterStaggerValue = string | (Omit<StaggerOptions, 'viewport'> & {
  items: string;
  key?: unknown;
  /** false: skip the mount, play only when `key` changes (the container
   * already has its own opening motion, e.g. a dialog). */
  initial?: boolean;
});

const WAIT_FOR_SIZE = 3000;
type State = { key: unknown; stop?: () => void };
const states = new WeakMap<HTMLElement, State>();

function normalize(value: EnterStaggerValue) {
  return typeof value === 'string' ? { items: value } : value;
}

function play(element: HTMLElement, value: EnterStaggerValue) {
  const state = states.get(element);
  state?.stop?.();
  if (state) state.stop = undefined;
  const { items, key: _key, initial: _initial, ...options } = normalize(value);
  const run = () => { staggerIn(element, items, options); };
  if (element.getClientRects().length) { run(); return; }
  const ResizeObserver = element.ownerDocument.defaultView?.ResizeObserver;
  if (!ResizeObserver || !state) return;
  const observer = new ResizeObserver(() => {
    if (!element.getClientRects().length) return;
    stop();
    run();
  });
  const timer = setTimeout(() => stop(), WAIT_FOR_SIZE);
  function stop() {
    clearTimeout(timer);
    observer.disconnect();
    if (state && state.stop === stop) state.stop = undefined;
  }
  observer.observe(element);
  state.stop = stop;
}

export const vEnterStagger: Directive<HTMLElement, EnterStaggerValue> = {
  mounted(element, binding) {
    const value = normalize(binding.value);
    states.set(element, { key: value.key });
    if (value.initial !== false) play(element, binding.value);
  },
  updated(element, binding) {
    const state = states.get(element);
    const key = normalize(binding.value).key;
    if (!state || Object.is(state.key, key)) return;
    state.key = key;
    play(element, binding.value);
  },
  unmounted(element) {
    states.get(element)?.stop?.();
    states.delete(element);
  },
};
