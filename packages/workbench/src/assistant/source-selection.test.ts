import { expect, it } from 'vitest';
import { assistantSourceRange } from './source-selection';

it('uses saved offsets to identify the correct occurrence of repeated text', () => {
  expect(assistantSourceRange('same / same', { text: 'same', from: 7, to: 11 })).toEqual({ from: 7, to: 11 });
});

it('relocates a unique quote after surrounding content changes', () => {
  expect(assistantSourceRange('new prefix\n原文\nend', { text: '原文', from: 0, to: 2 })).toEqual({ from: 11, to: 13 });
});

it('does not guess when the quote was removed or its new position is ambiguous', () => {
  expect(assistantSourceRange('changed', { text: 'original', from: 0, to: 8 })).toBeNull();
  expect(assistantSourceRange('same / same', { text: 'same', from: 2, to: 6 })).toBeNull();
  expect(assistantSourceRange('content', undefined)).toBeNull();
});
