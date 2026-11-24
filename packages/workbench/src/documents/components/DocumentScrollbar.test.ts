// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, shallowRef } from 'vue';
import type { App } from 'vue';
import DocumentScrollbar from './DocumentScrollbar.vue';

let app: App | undefined;
let root: HTMLElement;
afterEach(() => { app?.unmount(); app = undefined; root?.remove(); vi.unstubAllGlobals(); });

async function mountScrollbar() {
  root = document.createElement('div');
  document.body.append(root);
  const scroll = document.createElement('div');
  scroll.id = 'document-scroll-test';
  const main = document.createElement('main');
  scroll.append(main);
  const host = document.createElement('div');
  root.append(scroll, host);
  let viewport = 400, extent = 2000, position = 300;
  Object.defineProperties(scroll, {
    clientHeight: { get: () => viewport },
    scrollHeight: { get: () => extent },
    scrollTop: { get: () => position, set: value => { position = Math.max(0, Math.min(value, extent - viewport)); } },
  });
  let resize!: () => void;
  const observed = new Set<Element>();
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe(element: Element) { observed.add(element); }
    disconnect = disconnect;
  });
  const element = shallowRef<HTMLElement | undefined>(scroll);
  app = createApp({ render: () => h(DocumentScrollbar, { scrollElement: element.value }) });
  app.mount(host);
  await nextTick();
  const track = root.querySelector<HTMLElement>('[role="scrollbar"]')!;
  const thumb = root.querySelector<HTMLElement>('.document-scrollbar-thumb')!;
  track.getBoundingClientRect = () => new DOMRect(788, 44, 12, viewport);
  const captured = new Set<number>();
  track.setPointerCapture = vi.fn(id => { captured.add(id); });
  track.hasPointerCapture = id => captured.has(id);
  track.releasePointerCapture = vi.fn(id => { captured.delete(id); });
  return { scroll, main, track, thumb, element, observed, disconnect, resize: (height: number, total: number) => {
    viewport = height; extent = total; resize();
  } };
}
function pointer(target: HTMLElement, type: string, x: number, y: number, pointerId = 1, buttons = 1) {
  const event = new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId, buttons, button: 0, isPrimary: true });
  target.dispatchEvent(event);
  return event;
}

it('keeps dragging vertically far outside the scrollbar without snapping back', async () => {
  const { scroll, track, thumb } = await mountScrollbar();
  expect(pointer(thumb, 'pointerdown', 794, 114).defaultPrevented).toBe(true);
  expect(track.setPointerCapture).toHaveBeenCalledWith(1);
  pointer(track, 'pointermove', 794, 194);
  expect(scroll.scrollTop).toBe(700);
  pointer(track, 'pointermove', -1200, 194);
  expect(scroll.scrollTop).toBe(700);
  pointer(track, 'pointermove', -1200, 234);
  expect(scroll.scrollTop).toBe(900);
  pointer(track, 'pointermove', 2000, 254);
  expect(scroll.scrollTop).toBe(1000);
  pointer(track, 'pointermove', 794, 254);
  expect(scroll.scrollTop).toBe(1000);
  pointer(track, 'pointerup', 794, 254, 1, 0);
  pointer(track, 'pointermove', 794, 114);
  expect(scroll.scrollTop).toBe(1000);
  expect(track.releasePointerCapture).toHaveBeenCalledWith(1);
});

it.each(['pointercancel', 'lostpointercapture', 'blur'])('ends on %s without restoring the drag origin', async type => {
  const { scroll, track, thumb } = await mountScrollbar();
  pointer(thumb, 'pointerdown', 794, 114);
  pointer(track, 'pointermove', -800, 194);
  if (type === 'blur') window.dispatchEvent(new Event('blur'));
  else pointer(track, type, -800, 194);
  pointer(track, 'pointermove', 794, 114);
  expect(scroll.scrollTop).toBe(700);
  await nextTick();
  expect(root.querySelector('.is-dragging')).toBeNull();
});

it('ignores other pointers and clamps at both document ends', async () => {
  const { scroll, track, thumb } = await mountScrollbar();
  pointer(thumb, 'pointerdown', 794, 114);
  pointer(track, 'pointermove', 794, 300, 2);
  pointer(track, 'pointerup', 794, 300, 2);
  expect(scroll.scrollTop).toBe(300);
  pointer(track, 'pointermove', -800, 1000);
  expect(scroll.scrollTop).toBe(1600);
  pointer(track, 'pointermove', -800, -1000);
  expect(scroll.scrollTop).toBe(0);
});

it('supports track clicks, keyboard navigation and wheel scrolling over the track', async () => {
  const { scroll, track } = await mountScrollbar();
  pointer(track, 'pointerdown', 794, 284);
  expect(scroll.scrollTop).toBe(1000);
  pointer(track, 'pointerup', 794, 284, 1, 0);
  for (const [key, expected] of [['Home', 0], ['ArrowDown', 40], ['PageDown', 440], ['PageUp', 40], ['End', 1600], ['ArrowUp', 1560]] as const) {
    track.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    expect(scroll.scrollTop).toBe(expected);
  }
  const wheel = new WheelEvent('wheel', { deltaY: -3, deltaMode: 1, cancelable: true });
  track.dispatchEvent(wheel);
  expect(wheel.defaultPrevented).toBe(true);
  expect(scroll.scrollTop).toBe(1512);
  const zoom = new WheelEvent('wheel', { deltaY: 100, ctrlKey: true, cancelable: true });
  track.dispatchEvent(zoom);
  expect(zoom.defaultPrevented).toBe(false);
});

it('follows content scrolling and resizes when the viewport or document changes', async () => {
  const { scroll, main, track, thumb, observed, resize } = await mountScrollbar();
  expect(observed.has(scroll) && observed.has(main)).toBe(true);
  expect(track.getAttribute('aria-controls')).toBe(scroll.id);
  expect(thumb.style.height).toBe('80px');
  scroll.scrollTop = 800;
  scroll.dispatchEvent(new Event('scroll'));
  await nextTick();
  expect(thumb.style.transform).toBe('translateY(160px)');
  expect(track.getAttribute('aria-valuenow')).toBe('800');
  resize(200, 4200);
  await nextTick();
  expect(thumb.style.height).toBe('24px');
  expect(track.getAttribute('aria-valuemax')).toBe('4000');
  resize(400, 400);
  await nextTick();
  expect(track.style.display).toBe('none');
});

it('releases capture and observers when the document is replaced or unmounted', async () => {
  const { scroll, track, thumb, element, disconnect } = await mountScrollbar();
  pointer(thumb, 'pointerdown', 794, 114);
  pointer(track, 'pointermove', 100, 194);
  element.value = undefined;
  await nextTick();
  expect(disconnect).toHaveBeenCalledTimes(1);
  expect(track.releasePointerCapture).toHaveBeenCalledWith(1);
  expect(scroll.classList.contains('document-layout-managed-scrollbar')).toBe(false);
  element.value = scroll;
  await nextTick();
  app!.unmount(); app = undefined;
  expect(disconnect).toHaveBeenCalledTimes(2);
  expect(scroll.classList.contains('document-layout-managed-scrollbar')).toBe(false);
});
