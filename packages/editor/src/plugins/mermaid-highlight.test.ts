import { expect, it } from 'vitest';
import { mermaidHighlightRanges } from './mermaid-highlight';

function tokens(source: string, fenced = false) {
  return mermaidHighlightRanges(source, fenced).map(({ from, to, kind }) => [
    source.slice(from, to),
    kind,
  ]);
}

it('colors Mermaid fences, flow direction, nodes, labels and arrows', () => {
  const source = '```mermaid\nflowchart LR\n  A[输入 Markdown] --> B[解析]\n```';
  const result = tokens(source, true);
  expect(result).toContainEqual(['```', 'fence']);
  expect(result).toContainEqual(['mermaid', 'keyword']);
  expect(result).toContainEqual(['flowchart', 'keyword']);
  expect(result).toContainEqual(['LR', 'direction']);
  expect(result).toContainEqual(['A', 'node']);
  expect(result).toContainEqual(['输入 Markdown', 'label']);
  expect(result).toContainEqual(['-->', 'arrow']);
  expect(result).toContainEqual(['B', 'node']);
  expect(result.at(-1)).toEqual(['```', 'fence']);
});

it('keeps incomplete diagrams and comments colored without changing text', () => {
  const source = 'flowchart TD\n  A[Start] -.-> B[Next]\n  %% unfinished';
  const ranges = mermaidHighlightRanges(source);
  expect(ranges.map(({ from, to, kind }) => [source.slice(from, to), kind])).toContainEqual([
    '%% unfinished',
    'comment',
  ]);
  expect(ranges.map(({ from, to, kind }) => [source.slice(from, to), kind])).toContainEqual([
    '-.->',
    'arrow',
  ]);
  expect(ranges.every(({ from, to }) => from >= 0 && to <= source.length && to > from)).toBe(true);
  expect(ranges.every((range, index) => !index || ranges[index - 1]!.to <= range.from)).toBe(true);
});
