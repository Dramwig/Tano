import { describe, expect, it } from 'vitest';
import { focusedOutlineIndices } from './outline-tree';

describe('focused outline', () => {
  const headings = [1, 2, 3, 4, 3, 2, 3, 1, 2].map(level => ({ level }));
  it('expands the active path and keeps other branches collapsed', () => {
    expect([...focusedOutlineIndices(headings, 2)]).toEqual([0, 1, 2, 3, 4, 5, 7]);
    expect([...focusedOutlineIndices(headings, 5)]).toEqual([0, 1, 5, 6, 7]);
    expect([...focusedOutlineIndices(headings, 7)]).toEqual([0, 7, 8]);
  });
  it('handles skipped levels and multiple roots', () => {
    expect([...focusedOutlineIndices([2, 4, 6, 4, 2].map(level => ({ level })), 1)])
      .toEqual([0, 1, 2, 3, 4]);
  });
  it('handles missing headings and a stale active index', () => {
    expect([...focusedOutlineIndices([], 0)]).toEqual([]);
    expect([...focusedOutlineIndices(headings, 99)]).toEqual([0, 7]);
  });
});
