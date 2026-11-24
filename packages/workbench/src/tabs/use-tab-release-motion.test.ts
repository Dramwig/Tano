// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { settlingTab } from './tab-settle';
import { useTabReleaseMotion } from './use-tab-release-motion';

const from = { id: 'tab', path: 'note.md', dirty: false, left: 400, top: 300, width: 200, height: 32 };
let frames: FrameRequestCallback[];
let scope: ReturnType<typeof effectScope>;
let motion: ReturnType<typeof useTabReleaseMotion>;
let target: HTMLElement;
let targetLeft: number;

beforeEach(() => {
  frames = [];
  targetLeft = 0;
  target = document.createElement('div');
  target.className = 'desktop-tab';
  target.dataset.id = from.id;
  target.getBoundingClientRect = () => ({ left: targetLeft, top: 0, width: 180, height: 32 }) as DOMRect;
  document.body.append(target);
  document.documentElement.animate = vi.fn();
  vi.spyOn(window.performance, 'now').mockReturnValue(10_000);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => frames.push(callback));
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  scope = effectScope();
  motion = scope.run(() => useTabReleaseMotion({ window, document }))!;
});

afterEach(() => {
  scope.stop();
  target.remove();
  delete document.documentElement.dataset.motion;
  delete (document.documentElement as Partial<HTMLElement>).animate;
  settlingTab.value = undefined;
  vi.restoreAllMocks();
});

it('uses the owning clock, remeasures the destination and releases its hidden tab', () => {
  motion.settle(from, { returnSlot: true });
  expect(motion.returningSlot.value).toBe(true);
  expect(settlingTab.value).toEqual({ id: 'tab', opacity: 0 });
  frames.shift()!(10_100);
  expect(motion.preview.value!.top).toBeGreaterThan(0);
  expect(motion.preview.value!.top).toBeLessThan(300);
  targetLeft = 450;
  frames.shift()!(10_200);
  expect(motion.preview.value!.left).toBeGreaterThan(400);
  frames.shift()!(11_000);
  frames.shift()!(11_080);
  expect(motion.preview.value).toBeUndefined();
  expect(motion.returningSlot.value).toBe(false);
  expect(settlingTab.value).toBeUndefined();
});

it('fades a reference in place while revealing its original tab', () => {
  motion.settle(from, { mode: 'reference' });
  frames.shift()!(10_100);
  expect(motion.preview.value).toEqual(from);
  expect(motion.referenceReveal.value!.opacity).toBeGreaterThan(0);
  expect(motion.referenceReveal.value!.opacity).toBeLessThan(1);
  expect(motion.previewOpacity.value + motion.referenceReveal.value!.opacity).toBe(1);
  expect(settlingTab.value).toBeUndefined();
});

it('switches opaque layers in one frame and disposes the preview on the next', () => {
  motion.settle(from);
  frames.shift()!(10_349);
  expect(settlingTab.value!.opacity).toBe(0);
  expect(motion.previewOpacity.value).toBe(1);
  frames.shift()!(10_350);
  expect(motion.preview.value).toEqual({ ...from, left: 0, top: 0, width: 180 });
  expect(settlingTab.value!.opacity).toBe(1);
  expect(motion.previewOpacity.value).toBe(0);
  expect(motion.preview.value).toBeDefined();
  frames.shift()!(10_366);
  expect(motion.preview.value).toBeUndefined();
  expect(settlingTab.value).toBeUndefined();
});

it('waits for the destination layout animation before switching layers', () => {
  let playState = 'running';
  target.getAnimations = vi.fn(() => [{ playState }] as Animation[]);
  motion.settle(from);
  frames.shift()!(10_350);
  frames.shift()!(10_450);
  expect(motion.previewOpacity.value).toBe(1);
  expect(settlingTab.value!.opacity).toBe(0);
  playState = 'finished';
  frames.shift()!(10_500);
  expect(motion.previewOpacity.value).toBe(0);
  expect(settlingTab.value!.opacity).toBe(1);
  frames.shift()!(10_516);
  expect(motion.preview.value).toBeUndefined();
});

it.each([false, true])('aligns content and follows a moving destination (late preview %s)', late => {
  const button = document.createElement('button');
  button.className = 'desktop-tab-switch';
  button.style.cssText = 'padding: 0 6px 4px 12px; column-gap: 8px; line-height: 18px';
  target.append(button);
  const floating = document.createElement('div');
  floating.className = 'desktop-tab-drag-preview';
  floating.style.cssText = 'padding: 0 16px; column-gap: 9px; line-height: 20px';
  if (!late) document.body.append(floating);
  try {
    motion.settle(from);
    if (late) document.body.append(floating);
    frames.shift()!(10_100);
    expect(parseFloat(motion.previewStyle.value!.paddingLeft as string)).toBeGreaterThan(12);
    expect(parseFloat(motion.previewStyle.value!.paddingLeft as string)).toBeLessThan(16);
    targetLeft = 40;
    frames.shift()!(10_350);
    expect(motion.previewStyle.value).toMatchObject({ paddingLeft: '12px', paddingRight: '6px',
      paddingTop: '0px', paddingBottom: '4px', columnGap: '8px', lineHeight: '18px' });
    expect(motion.preview.value!.left).toBe(40);
    scope.stop();
    expect(motion.previewStyle.value).toBeUndefined();
  } finally {
    floating.remove();
  }
});

it.each([true, false])('blends toward the destination colors (selected %s)', selected => {
  target.style.backgroundColor = selected ? 'rgb(250, 250, 250)' : 'transparent';
  target.style.color = selected ? 'rgb(30, 30, 30)' : 'rgb(100, 100, 100)';
  const floating = document.createElement('div');
  floating.className = 'desktop-tab-drag-preview';
  floating.style.cssText = 'background-color: rgb(255, 255, 255); color: rgb(10, 10, 10)';
  document.body.append(floating);
  try {
    motion.settle(from);
    frames.shift()!(10_100);
    expect(motion.previewStyle.value!.backgroundColor).toContain('color-mix(in srgb, rgb(255, 255, 255)');
    expect(motion.previewStyle.value!.color).toContain('color-mix(in srgb, rgb(10, 10, 10)');
    expect(motion.previewStyle.value!.backgroundColor).toContain(getComputedStyle(target).backgroundColor);
    expect(motion.previewStyle.value!.color).toContain(getComputedStyle(target).color);
    // Theme/selection changes during the flight use the newly resolved palette.
    target.style.backgroundColor = 'rgb(40, 40, 40)';
    target.style.color = 'rgb(220, 220, 220)';
    frames.shift()!(10_350);
    expect(motion.previewStyle.value!.backgroundColor).toBe('rgb(40, 40, 40)');
    expect(motion.previewStyle.value!.color).toBe('rgb(220, 220, 220)');
  } finally {
    floating.remove();
  }
});

it('ignores a queued frame after another release has taken ownership', () => {
  motion.settle(from);
  const stale = frames.shift()!;
  const next = { ...from, top: 600 };
  motion.settle(next, { mode: 'reference' });
  stale(11_000);
  expect(motion.preview.value).toEqual(next);
  expect(motion.referenceReveal.value!.opacity).toBe(0);
  scope.stop();
  expect(motion.preview.value).toBeUndefined();
  expect(motion.settling.value).toBe(false);
});

it('cleans up when the destination is removed during release', () => {
  motion.settle(from);
  target.remove();
  frames.shift()!(10_100);
  expect(motion.settling.value).toBe(false);
  expect(settlingTab.value).toBeUndefined();
});

it('respects the window motion preference', () => {
  document.documentElement.dataset.motion = 'reduced';
  motion.settle(from);
  expect(frames).toHaveLength(0);
  expect(motion.preview.value).toBeUndefined();
});
