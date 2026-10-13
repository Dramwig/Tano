// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp } from 'vue';
import { compactViewport, useViewport, visibleViewport } from './viewport';

it('uses available width for phones, tablet split view and large tablets', () => {
  for (const width of [320, 390, 700, 768, 844, 1023]) expect(compactViewport(width, true)).toBe(true);
  for (const width of [1024, 1180, 1366]) expect(compactViewport(width, true)).toBe(false);
  expect(compactViewport(700, false)).toBe(true);
  expect(compactViewport(768, false)).toBe(false);
});

it('fits the keyboard viewport, accounts for Safari panning and preserves pinch zoom', () => {
  expect(visibleViewport(844, { height: 390, offsetTop: 44, scale: 1 })).toEqual({ height: 390, top: 44 });
  expect(visibleViewport(390, { height: 844, offsetTop: 0, scale: 1 })).toEqual({ height: 390, top: 0 });
  expect(visibleViewport(844, { height: 422, offsetTop: 100, scale: 2 })).toBeNull();
  expect(visibleViewport(844)).toEqual({ height: 844, top: 0 });
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('keeps mouse-first hybrid desktops dense until the primary pointer becomes touch', () => {
  const primary = Object.assign(new EventTarget(), { matches: false });
  const any = Object.assign(new EventTarget(), { matches: true });
  vi.stubGlobal('matchMedia', (query: string) => query === '(pointer: coarse)' ? primary : any);
  vi.stubGlobal('innerWidth', 900);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const app = createApp({ setup: () => { useViewport(false); return () => null; } });
  app.mount(document.createElement('div'));
  const root = document.documentElement;
  try {
    expect(root.classList.contains('touch-layout')).toBe(false);
    expect(root.classList.contains('compact-layout')).toBe(false);
    primary.matches = true;
    primary.dispatchEvent(new Event('change'));
    expect(root.classList.contains('touch-layout')).toBe(true);
    expect(root.classList.contains('compact-layout')).toBe(true);
    primary.matches = false;
    primary.dispatchEvent(new Event('change'));
    expect(root.classList.contains('touch-layout')).toBe(false);
    expect(root.classList.contains('compact-layout')).toBe(false);
    expect(root.style.getPropertyValue('--app-viewport-height')).toBe('');
  } finally {
    app.unmount();
  }
});

it('retains touch controls in the native mobile app with a connected mouse', () => {
  vi.stubGlobal('matchMedia', () => Object.assign(new EventTarget(), { matches: false }));
  vi.stubGlobal('innerWidth', 1180);
  const app = createApp({ setup: () => { useViewport(true); return () => null; } });
  app.mount(document.createElement('div'));
  try {
    expect(document.documentElement.classList.contains('touch-layout')).toBe(true);
    expect(document.documentElement.classList.contains('compact-layout')).toBe(false);
  } finally {
    app.unmount();
  }
});

it('updates layout after rotation and removes viewport listeners on unmount', () => {
  const coarse = Object.assign(new EventTarget(), { matches: true });
  const visual = Object.assign(new EventTarget(), { height: 600, offsetTop: 0, scale: 1 });
  vi.stubGlobal('matchMedia', () => coarse);
  vi.stubGlobal('visualViewport', visual);
  vi.stubGlobal('innerWidth', 820);
  vi.stubGlobal('innerHeight', 1180);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const root = document.createElement('div');
  const app = createApp({ setup: () => { useViewport(false); return () => null; } });
  app.mount(root);
  expect(document.documentElement.classList.contains('compact-layout')).toBe(true);
  expect(document.documentElement.style.getPropertyValue('--app-viewport-height')).toBe('600px');
  vi.stubGlobal('innerWidth', 1180);
  window.dispatchEvent(new Event('resize'));
  expect(document.documentElement.classList.contains('compact-layout')).toBe(false);
  visual.offsetTop = 40;
  visual.dispatchEvent(new Event('scroll'));
  expect(document.documentElement.style.getPropertyValue('--app-viewport-top')).toBe('40px');
  app.unmount();
  visual.dispatchEvent(new Event('resize'));
  window.dispatchEvent(new Event('resize'));
  expect(document.documentElement.classList.contains('touch-layout')).toBe(false);
  expect(document.documentElement.style.getPropertyValue('--app-viewport-height')).toBe('');
});
