import { expect, it } from 'vitest';
import { defaultSelectionWrapping, normalizeSelectionWrapping, selectionWrap } from './selection-wrapping';

it('upgrades single markers, consumes repeated double markers, and honors disabled settings', () => {
  expect(selectionWrap('文字', '*', undefined, '*', '*')?.prefix).toBe('*');
  expect(selectionWrap('文字', '*', undefined, '**', '**')?.prefix).toBe('');
  expect(selectionWrap('文字', '~')?.prefix).toBe('~~');
  expect(selectionWrap('文字', '~', { subscript: true })?.prefix).toBe('~');
  expect(selectionWrap('文字', '~', { subscript: true }, '~', '~')?.prefix).toBe('~');
  expect(selectionWrap('文字', '=', { highlight: true }, '==', '==')?.prefix).toBe('');
  expect(selectionWrap('文字', '=')).toBeNull();
  expect(selectionWrap('文字', '*', { enabled: false })).toBeNull();
  expect(selectionWrap('文字', '=', { highlight: false })).toBeNull();
  expect(selectionWrap('文字', '^')).toBeNull();
  expect(selectionWrap('文字', '^', { superscript: true })?.prefix).toBe('^');
  expect(selectionWrap('多\n行', '*')).toBeNull();
  expect(selectionWrap('   ', '*')).toBeNull();
});

it('uses longer code delimiters and padding to preserve literal backticks and spaces', () => {
  expect(selectionWrap('a`b', '`')).toMatchObject({ prefix: '``', suffix: '``', literal: true });
  expect(selectionWrap('`text`', '`')).toMatchObject({ prefix: '`` ', suffix: ' ``' });
  expect(selectionWrap(' text ', '`')).toMatchObject({ prefix: '` ', suffix: ' `' });
});

it('normalizes old, partial, and corrupt preferences without enabling extensions', () => {
  expect(normalizeSelectionWrapping(null)).toEqual(defaultSelectionWrapping);
  expect(normalizeSelectionWrapping({ enabled: 'false', math: false })).toEqual({ ...defaultSelectionWrapping, math: false });
});

it('leaves Chinese punctuation mapping to the input policy', () => {
  expect(selectionWrap('x_1', '￥')).toBeNull();
  expect(selectionWrap('x_1', '$')).toEqual({ prefix: '$', suffix: '$', literal: true });
  expect(selectionWrap('x_1', '$', { math: false })).toBeNull();
  expect(selectionWrap('x_1', '$', { enabled: false })).toBeNull();
});
