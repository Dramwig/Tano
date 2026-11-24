import { expect, it } from 'vitest';
import { mathHighlightRanges } from './math-highlight';

it('colors delimiters, commands, numbers and operators without changing LaTeX source', () => {
  const source = '$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$';
  const tokens = mathHighlightRanges(source, true).map(({ from, to, kind }) => [
    source.slice(from, to),
    kind,
  ]);
  expect(tokens).toContainEqual(['$$', 'delimiter']);
  expect(tokens).toContainEqual(['\\int', 'command']);
  expect(tokens).toContainEqual(['\\frac', 'command']);
  expect(tokens).toContainEqual(['^', 'operator']);
  expect(tokens).toContainEqual(['2', 'number']);
  expect(tokens.at(-1)).toEqual(['$$', 'delimiter']);
});

it('keeps incomplete formulas colored while they are being typed', () => {
  const source = '$$\n\\int_0^';
  const tokens = mathHighlightRanges(source, true).map(({ from, to, kind }) => [
    source.slice(from, to),
    kind,
  ]);
  expect(tokens).toEqual([
    ['$$', 'delimiter'],
    ['\\int', 'command'],
    ['_', 'operator'],
    ['0', 'number'],
    ['^', 'operator'],
  ]);
});
