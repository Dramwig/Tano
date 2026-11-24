export type MathHighlightKind = 'delimiter' | 'command' | 'number' | 'operator';

export interface MathHighlightRange {
  from: number;
  to: number;
  kind: MathHighlightKind;
}

const delimiters = [
  ['$$', '$$'],
  ['\\[', '\\]'],
  ['\\(', '\\)'],
  ['$', '$'],
] as const;

/** Color LaTeX source without changing its characters or requiring valid syntax. */
export function mathHighlightRanges(source: string, withDelimiters = false): MathHighlightRange[] {
  const ranges: MathHighlightRange[] = [];
  let from = 0;
  let to = source.length;
  if (withDelimiters) {
    const pair = delimiters.find(([open]) => source.startsWith(open));
    if (pair) {
      ranges.push({ from: 0, to: pair[0].length, kind: 'delimiter' });
      from = pair[0].length;
      if (source.length >= pair[0].length + pair[1].length && source.endsWith(pair[1])) {
        to -= pair[1].length;
        ranges.push({ from: to, to: source.length, kind: 'delimiter' });
      }
    }
  }
  for (const match of source.slice(from, to).matchAll(/\\[a-zA-Z]+|\\.|\d+(?:\.\d+)?|[{}_^=+\-]/g)) {
    const start = from + match.index;
    const token = match[0];
    ranges.push({
      from: start,
      to: start + token.length,
      kind: token.startsWith('\\') ? 'command' : /^\d/.test(token) ? 'number' : 'operator',
    });
  }
  return ranges.sort((a, b) => a.from - b.from);
}
