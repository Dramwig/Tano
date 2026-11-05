// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { HeadingViewport } from './heading-viewport';

afterEach(() => vi.restoreAllMocks());

it('reuses heading geometry during scroll and refreshes after layout changes', () => {
  const root = document.createElement('div'), scroll = document.createElement('div');
  root.innerHTML = '<div class="tano-prose">'+ '<h2>Heading</h2>'.repeat(1000) + '</div>';
  let scrollTop = 0, extraHeight = 0;
  vi.spyOn(root, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, -scrollTop, 500, 100000));
  vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 500, 800));
  const reads = [...root.querySelectorAll('h2')].map((heading, i) => {
    vi.spyOn(heading, 'getClientRects').mockReturnValue([new DOMRect()] as unknown as DOMRectList);
    return vi.spyOn(heading, 'getBoundingClientRect').mockImplementation(() =>
      new DOMRect(0, i * 100 + extraHeight - scrollTop, 500, 30));
  });
  const tracker = new HeadingViewport();
  expect(tracker.active(root, scroll)).toBe(1);
  scrollTop = 50000;
  expect(tracker.active(root, scroll)).toBe(501);
  expect(reads.every(read => read.mock.calls.length === 1)).toBe(true);
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
