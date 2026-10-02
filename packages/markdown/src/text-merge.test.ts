import { expect, it } from 'vitest';
import { mergeText, textChanges } from './text-merge';

it('merges independent edits within the same line, including a new internal reference', () => {
  const base = 'First task. Second task.';
  expect(mergeText(base, 'First task [@note](object://document/a00001). Second task.', 'First task. Second task updated.'))
    .toBe('First task [@note](object://document/a00001). Second task updated.');
});
it('rejects concurrent replacements and insertions while accepting identical edits', () => {
  expect(mergeText('text', 'ours', 'theirs')).toBeNull();
  expect(mergeText('ab', 'a1b', 'a2b')).toBeNull();
  expect(mergeText('ab', 'a1b', 'a1b')).toBe('a1b');
  expect(textChanges('a\r\nb', 'a\r\nb!')).toEqual([{ from: 4, to: 4, text: '!' }]);
  expect(textChanges('a'.repeat(80_001), '')).toBeNull();
});
it('treats a protected reference as one value instead of fabricating a combined ID', () => {
  const base = '[@Note](object://document/a00001)';
  expect(mergeText(base, base.replace('a00001', 'b00001'), base.replace('a00001', 'a00002'), [{ from: 0, to: base.length }])).toBeNull();
});
