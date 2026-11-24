// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { HeadingViewport } from './heading-viewport';

afterEach(() => vi.restoreAllMocks());

it('reuses heading geometry during scroll and refreshes after layout changes', () => {
  const root = document.createElement('div'), scroll = document.createElement('div');
  root.innerHTML = '<div class="tano-prose">'+ '<h2>Heading</h2>'.repeat(1000) + '</div>';
  let scrollTop = 0, extraHeight = 0;
  vi.spyOn(root, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, -scrollTop, 500, 100000));
  const viewportRead = vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 500, 800));
  const reads = [...root.querySelectorAll('h2')].map((heading, i) => {
    vi.spyOn(heading, 'getClientRects').mockReturnValue([new DOMRect()] as unknown as DOMRectList);
    return vi.spyOn(heading, 'getBoundingClientRect').mockImplementation(() =>
      new DOMRect(0, i * 100 + extraHeight - scrollTop, 500, 30));
  });
  const tracker = new HeadingViewport();
  expect(tracker.active(root, scroll)).toBe(1);
  scrollTop = 50000;
  scroll.scrollTop = scrollTop;
  expect(tracker.active(root, scroll)).toBe(501);
  expect(reads.every(read => read.mock.calls.length === 1)).toBe(true);
  expect(viewportRead).toHaveBeenCalledTimes(1);
  extraHeight = 200; tracker.invalidate();
  expect(tracker.active(root, scroll)).toBe(499);
  expect(reads.every(read => read.mock.calls.length === 2)).toBe(true);
});

it('handles columns whose document order differs from vertical order', () => {
  const root = document.createElement('div'), scroll = document.createElement('div');
  root.innerHTML = '<div class="tano-prose"><h2>A</h2><h2>B</h2><h2>C</h2></div>';
  [...root.querySelectorAll('h2')].forEach((heading, i) => {
    vi.spyOn(heading, 'getClientRects').mockReturnValue([new DOMRect()] as unknown as DOMRectList);
    vi.spyOn(heading, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, [0, 500, 50][i], 100, 30));
  });
  expect(new HeadingViewport().active(root, scroll)).toBe(2);
});

it('uses a scroll-event snapshot without reading layout during the animation callback', () => {
  const root = document.createElement('div'), scroll = document.createElement('div');
  root.innerHTML = '<div class="tano-prose"><h2>A</h2><h2>B</h2></div>';
  [...root.querySelectorAll('h2')].forEach((heading, i) => {
    vi.spyOn(heading, 'getClientRects').mockReturnValue([new DOMRect()] as unknown as DOMRectList);
    vi.spyOn(heading, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, i * 500, 100, 30));
  });
  const tracker = new HeadingViewport();
  expect(tracker.active(root, scroll, 100, 0)).toBe(0);
  vi.spyOn(scroll, 'scrollTop', 'get').mockImplementation(() => { throw new Error('Late layout read'); });
  expect(tracker.active(root, scroll, 100, 450)).toBe(1);
});

it('keeps the index relative to a scrolled, offset container and rebuilds for another pane', () => {
  const root = document.createElement('div'), scroll = document.createElement('div');
  root.innerHTML = '<div class="tano-prose"><h2>A</h2><h2>B</h2></div>';
  let origin = 200;
  scroll.scrollTop = 300;
  const containerRead = vi.spyOn(scroll, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, origin, 500, 800));
  [...root.querySelectorAll('h2')].forEach((heading, i) => {
    vi.spyOn(heading, 'getClientRects').mockReturnValue([new DOMRect()] as unknown as DOMRectList);
    vi.spyOn(heading, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, origin + i * 500 - scroll.scrollTop, 100, 30));
  });
  const tracker = new HeadingViewport();
  expect(tracker.active(root, scroll)).toBe(0);
  origin = 50; scroll.scrollTop = 450;
  expect(tracker.active(root, scroll)).toBe(1);
  expect(containerRead).toHaveBeenCalledOnce();
  const other = document.createElement('div');
  vi.spyOn(other, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, -500, 500, 800));
  expect(tracker.active(root, other)).toBe(0);
});
