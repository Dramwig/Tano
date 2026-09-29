import { expect, it } from 'vitest';
import { markdownDiff } from './diff';
it('shows additions and removals with source line numbers and preserves final-newline differences', () => {
  const diff = markdownDiff('heading\nold\n', 'heading\nnew');
  expect(diff.limited).toBe(false);
  expect(diff.rows.find((row) => row.kind === 'removed')).toMatchObject({ before: 2, text: 'old' });
  expect(diff.rows.find((row) => row.kind === 'added')).toMatchObject({
    after: 2,
    text: 'new ⏎ 无结尾换行',
  });
  expect(diff.added).toBe(1);
  expect(diff.removed).toBe(1);
});
it('collapses unchanged context and bounds oversized input', () => {
  const original = Array.from({ length: 100 }, (_, i) => `${i}\n`).join('');
  const diff = markdownDiff(original, original.replace('50\n', 'changed\n'));
  expect(diff.rows.length).toBeLessThan(25);
  expect(diff.rows.some((row) => row.kind === 'omitted')).toBe(true);
  expect(markdownDiff('x'.repeat(1024 * 1024), 'x').limited).toBe(true);
});
