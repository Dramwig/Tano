// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installInteractionMotion, springEasing } from './motion';

type Call = { element: HTMLElement; frames: Keyframe[]; options: KeyframeAnimationOptions | number };
let calls: Call[] = [];
let dispose: () => void = () => {};
beforeEach(() => {
  calls = [];
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value(this: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) {
    calls.push({ element: this, frames, options });
    return { cancel() {}, onfinish: null } as unknown as Animation;
  } });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 120, bottom: 36, width: 120, height: 36, toJSON() {} } as DOMRect);
  dispose = installInteractionMotion();
});
afterEach(() => {
  dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
  document.body.innerHTML = '';
});
const pointer = (type: string, target: Element) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
const scales = (element: Element) => calls.filter(call => call.element === element).map(call => call.frames.at(-1)!.scale);

it('sinks a button by a fixed pixel depth and springs it back on release', () => {
  document.body.innerHTML = '<button type="button"><span>保存</span></button>';
  const button = document.querySelector('button')!;
  pointer('pointerdown', button.firstElementChild!);
  pointer('pointerup', button);
  const [down, up] = scales(button);
  expect(Number(down)).toBeCloseTo(1 - 5 / 120);
  expect(up).toBe('1');
  // A quick tap still dips to the pressed depth before springing back.
  const tap = calls.at(-1)!.frames;
  expect(tap).toHaveLength(3);
  expect(Number(tap[1]!.scale)).toBeCloseTo(1 - 5 / 120);
});
it('lifts and presses a full-width form button visibly', () => {
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 480, bottom: 48, width: 480, height: 48, toJSON() {} } as DOMRect);
  document.body.innerHTML = '<button type="submit" style="background: black">继续</button>';
  const button = document.querySelector('button')!;
  button.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
  Object.defineProperty(window.PointerEvent?.prototype ?? {}, 'pointerType', { configurable: true, get: () => 'mouse' });
  pointer('pointerdown', button);
  expect(Number(scales(button).at(-1))).toBeCloseTo(0.975);
});
it('leaves rows, menu items, switches, drag sources and disabled buttons flat', () => {
  document.body.innerHTML = `<div role="treeitem" tabindex="0">a</div><button role="menuitem">b</button>
    <button role="switch">c</button><button draggable="true">d</button><button disabled>e</button>`;
  for (const element of document.body.children) { pointer('pointerdown', element); pointer('pointerup', element); }
  expect(calls).toEqual([]);
});
it('settles popup triggers quickly so anchored menus measure the real box', () => {
  document.body.innerHTML = '<button aria-haspopup="menu">更多</button>';
  const button = document.querySelector('button')!;
  pointer('pointerdown', button); pointer('pointerup', button);
  const release = calls.at(-1)!;
  expect((release.options as KeyframeAnimationOptions).duration).toBeLessThanOrEqual(120);
});
it('samples springs that start at rest and land exactly on target', () => {
  for (const kind of ['smooth', 'snappy', 'bouncy'] as const) {
    const ease = springEasing(kind);
    expect(ease(0)).toBe(0); expect(ease(1)).toBe(1);
  }
  const peak = Math.max(...Array.from({ length: 100 }, (_, index) => springEasing('bouncy')(index / 100)));
  expect(peak).toBeGreaterThan(1.08);
  expect(Math.max(...Array.from({ length: 100 }, (_, index) => springEasing('smooth')(index / 100)))).toBeLessThanOrEqual(1);
});
