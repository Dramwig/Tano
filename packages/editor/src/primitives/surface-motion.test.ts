// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref, vShow, withDirectives, type App } from 'vue';
import { setSurfaceVisible, vSurfaceMotion } from './surface-motion';

type FakeAnimation = {
  frames: Keyframe[]; options: KeyframeAnimationOptions; progress: number;
  onfinish: (() => void) | null; cancel: ReturnType<typeof vi.fn>;
  effect: { getComputedTiming: () => { progress: number } };
};
const flights = new Map<Element, FakeAnimation[]>();
const media = { matches: false, addEventListener: vi.fn() };
let app: App | undefined;
let host: HTMLElement;
beforeEach(() => {
  vi.useFakeTimers(); media.matches = false; flights.clear();
  vi.stubGlobal('matchMedia', () => media);
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => window.setTimeout(() => fn(16), 16));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 100, y: 100, top: 100, left: 100, right: 300, bottom: 260, width: 200, height: 160, toJSON() {} });
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: function(this: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) {
    const flight: FakeAnimation = { frames, options, progress: 0, onfinish: null, cancel: vi.fn(), effect: { getComputedTiming: () => ({progress: flight.progress}) } };
    const all = flights.get(this) ?? []; all.push(flight); flights.set(this, all);
    return flight;
  }});
  host = document.createElement('div'); document.body.append(host);
});
afterEach(() => {
  media.matches = true;
  for (const call of media.addEventListener.mock.calls) if (call[0] === 'change') call[1]();
  app?.unmount(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
});
const last = (element: Element) => flights.get(element)!.at(-1)!;
const complete = (animation: FakeAnimation) => { animation.progress = 1; animation.onfinish?.(); };
async function mount(persisted = false, component = false) {
  const open = ref(true);
  const renderSurface = () => withDirectives(h('div', { class: 'test-surface', role: 'menu' }, [h('button', 'Item')]), [[vSurfaceMotion, 'test'], ...(persisted ? [[vShow, open.value] as [typeof vShow, boolean]] : [])]);
  const Child = defineComponent({ setup: () => renderSurface });
  app = createApp({ setup: () => () => persisted || open.value ? component ? h(Child) : renderSurface() : null });
  app.mount(host); await nextTick(); await vi.advanceTimersByTimeAsync(16);
  return { open, element: host.querySelector<HTMLElement>('.test-surface')! };
}
it('retains only inert closing paint until exit completes', async () => {
  const {open, element} = await mount(); complete(last(element));
  open.value = false; await nextTick();
  expect(element.isConnected).toBe(true);
  expect(element.inert).toBe(true);
  expect(element.getAttribute('aria-hidden')).toBe('true');
  complete(last(element)); expect(element.isConnected).toBe(false);
});
it('reverses an interrupted entrance from its current eased opacity', async () => {
  const {open, element} = await mount(); const entering = last(element); entering.progress = 0.4;
  open.value = false; await nextTick();
  expect(entering.cancel).toHaveBeenCalled();
  expect(last(element).frames[0]!.opacity).toBeCloseTo(0.4);
  expect(last(element).options.duration).toBeCloseTo(52);
});
it('hands a partially closed v-if surface to its replacement without stale removal', async () => {
  const {open, element} = await mount(); complete(last(element));
  open.value = false; await nextTick(); const leaving = last(element); leaving.progress = 0.5;
  open.value = true; await nextTick(); await vi.advanceTimersByTimeAsync(16);
  const replacement = host.querySelector<HTMLElement>('.test-surface')!;
  expect(replacement).not.toBe(element);
  expect(host.querySelectorAll('.test-surface')).toHaveLength(1);
  expect(last(replacement).frames[0]!.opacity).toBeCloseTo(0.5);
  expect(replacement.inert).toBe(false);
  complete(leaving); expect(replacement.isConnected).toBe(true);
});
it('reverses v-show on the same DOM node and never runs its cancelled hide callback', async () => {
  const {open, element} = await mount(true); complete(last(element));
  open.value = false; await nextTick(); const leaving = last(element); leaving.progress = 0.6;
  open.value = true; await nextTick(); await vi.advanceTimersByTimeAsync(16);
  expect(last(element).frames[0]!.opacity).toBeCloseTo(0.4);
  complete(leaving); complete(last(element));
  expect(element.style.display).not.toBe('none'); expect(element.inert).toBe(false);
});
it('finishes an exit even after the surface component has unmounted', async () => {
  const {open, element} = await mount(false, true); complete(last(element));
  open.value = false; await nextTick();
  expect(element.isConnected).toBe(true);
  complete(last(element)); expect(element.isConnected).toBe(false);
});
it('handles closing before the first animation frame without flashing a full menu', async () => {
  const {open, element} = await mount(); complete(last(element));
  open.value = false; await nextTick(); complete(last(element));
  open.value = true; await nextTick();
  const replacement = host.querySelector<HTMLElement>('.test-surface')!;
  open.value = false; await nextTick();
  expect(replacement.isConnected).toBe(false);
});
it('keeps imperative hidden state synchronous and reverses before display is restored', async () => {
  const element = document.createElement('div'); element.hidden = true; host.append(element);
  setSurfaceVisible(element, true); await vi.advanceTimersByTimeAsync(16); complete(last(element));
  setSurfaceVisible(element, false); const leaving = last(element); leaving.progress = 0.25;
  expect(element.hidden).toBe(true); expect(element.inert).toBe(true);
  setSurfaceVisible(element, true); await vi.advanceTimersByTimeAsync(16);
  expect(last(element).frames[0]!.opacity).toBeCloseTo(0.75);
  complete(last(element)); expect(element.hidden).toBe(false); expect(element.style.display).toBe('');
});
it('immediately completes an in-flight exit when reduced motion is enabled', async () => {
  const {open, element} = await mount(); complete(last(element));
  open.value = false; await nextTick(); media.matches = true;
  for (const call of media.addEventListener.mock.calls) if (call[0] === 'change') call[1]();
  expect(element.isConnected).toBe(false);
});
