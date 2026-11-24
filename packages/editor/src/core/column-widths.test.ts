import { describe, expect, it } from 'vitest';
import { columnWidths, formatColumnWidths, parseColumnWidths, resizeColumnWidths } from './column-widths';

describe('column widths', () => {
  it('normalizes portable ratios and falls back to equal widths for stale attributes', () => {
    expect(parseColumnWidths('1,3', 2)).toEqual([25, 75]);
    expect(columnWidths('60,40', 3)).toEqual([100 / 3, 100 / 3, 100 / 3]);
  });
  it.each(['0,100', '-1,2', 'NaN,2', '1e999,1', '2,,1', '1,Infinity', '2,', '0.0,1'])('rejects invalid portable ratios: %s', value => {
    expect(parseColumnWidths(value, 2)).toBeNull();
  });
  it('resizes only adjacent columns and clamps both neighbors to a usable width', () => {
    expect(resizeColumnWidths([20, 30, 50], 1, 10, 12)).toEqual([20, 40, 40]);
    expect(resizeColumnWidths([20, 30, 50], 1, 100, 12)).toEqual([20, 68, 12]);
    expect(resizeColumnWidths([20, 30, 50], 1, -100, 12)).toEqual([20, 12, 68]);
    expect(resizeColumnWidths([5, 5, 90], 0, 20, 12)).toEqual([5, 5, 90]);
  });
  it('keeps tiny positive source ratios valid when rounding a layout edit', () => {
    expect(parseColumnWidths(formatColumnWidths([0.0001, 99.9999]), 2)).not.toBeNull();
  });
});
