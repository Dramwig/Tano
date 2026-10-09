import { expect, it } from 'vitest';
import { mergeMarkdown } from './index';

it('preserves the proposal when a bounded merge exhausts its diff budget', () => {
  const base = Array.from({ length: 1000 }, (_, i) => `base ${i}\n`).join('');
  const ours = base.replaceAll('base', 'plugin'), theirs = base.replace('base 999', 'external 999');
  expect(mergeMarkdown(base, ours, theirs, { timeout: 80, maxEditLength: 20 })).toEqual({ clean: false, content: ours });
  expect(mergeMarkdown(base, ours, base, { timeout: 80, maxEditLength: 20 })).toEqual({ clean: true, content: ours });
  expect(mergeMarkdown('one\ntwo\n', 'ONE\ntwo\n', 'one\nTWO\n', { timeout: 80, maxEditLength: 20 })).toEqual({ clean: true, content: 'ONE\nTWO\n' });
});
