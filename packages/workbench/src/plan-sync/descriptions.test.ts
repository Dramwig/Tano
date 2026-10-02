import { expect, it } from 'vitest';
import { projectDescription, restoreDescription } from './descriptions';

const base = 'Read [@Plan](object://document/a00001).\nThen act.';
it('projects internal references as names and rebases them through independent remote edits', () => {
  expect(projectDescription(base)).toBe('Read @Plan.\nThen act.');
  expect(restoreDescription(base, 'Please read @Plan.\nThen act now.')).toBe('Please read [@Plan](object://document/a00001).\nThen act now.');
  expect(restoreDescription(base, projectDescription(base))).toBe(base);
});
it('does not resurrect removed references or guess relabelled and ambiguous positions', () => {
  expect(restoreDescription(base, 'Read.\nThen act.')).toBeNull();
  expect(restoreDescription(base, 'Read @Other.\nThen act.')).toBeNull();
  const duplicated = `${base}\n@Plan`;
  expect(restoreDescription(duplicated, projectDescription(duplicated) + '!')).toBeNull();
  expect(restoreDescription(base, 'Read `@Plan`.\nThen act.')).toBeNull();
  expect(restoreDescription(base, '```\nRead @Plan.\nThen act.\n```')).toBeNull();
  expect(restoreDescription(base, 'Read **@Plan**.\nThen act.')).toBe('Read **[@Plan](object://document/a00001)**.\nThen act.');
});
it('round trips reference-style links and ignores code, metadata and ordinary external links', () => {
  const referenceStyle = '[Plan][p]\n\n[p]: object://document/a00001\n';
  expect(projectDescription(referenceStyle)).toBe('Plan\n\n\n');
  expect(restoreDescription(referenceStyle, 'Read Plan\n\n\n')).toBe('Read [Plan][p]\n\n[p]: object://document/a00001\n');
  const code = '`[Plan](object://document/a00001)` [web](https://example.com)';
  expect(projectDescription(code)).toBe(code);
});
