import { diffArrays } from 'diff';
export * from './diff';
export * from './text-merge';

type Edit = { start: number; end: number; lines: string[] };
const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

export interface MarkdownMergeLimits { timeout: number; maxEditLength: number }
function edits(base: string[], next: string[], limits?: MarkdownMergeLimits): Edit[] | null {
  const result: Edit[] = [];
  let position = 0;
  let pending: Edit | undefined;
  const parts = limits ? diffArrays(base, next, limits) : diffArrays(base, next);
  if (!parts) return null;
  for (const part of parts) {
    if (!part.added && !part.removed) {
      if (pending) result.push(pending);
      pending = undefined;
      position += part.value.length;
    } else {
      pending ??= { start: position, end: position, lines: [] };
      if (part.removed) {
        position += part.value.length;
        pending.end = position;
      } else pending.lines.push(...part.value);
    }
  }
  if (pending) result.push(pending);
  return result;
}

/** Conservative, line-based three-way merge. Conflicting text is never discarded. */
export function mergeMarkdown(
  base: string,
  ours: string,
  theirs: string,
  limits?: MarkdownMergeLimits,
): { clean: boolean; content: string } {
  if (ours === theirs || theirs === base) return { clean: true, content: ours };
  if (ours === base) return { clean: true, content: theirs };
  const original = lines(base);
  const left = edits(original, lines(ours), limits);
  const right = edits(original, lines(theirs), limits);
  if (!left || !right) return { clean: false, content: ours };
  const combined = [...left];
  for (const b of right) {
    let duplicate = false;
    for (const a of left) {
      if (a.start === b.start && a.end === b.end && a.lines.join('') === b.lines.join('')) {
        duplicate = true;
        continue;
      }
      const aInsert = a.start === a.end;
      const bInsert = b.start === b.end;
      const overlaps =
        aInsert && bInsert
          ? a.start === b.start
          : aInsert
            ? a.start >= b.start && a.start < b.end
            : bInsert
              ? b.start >= a.start && b.start < a.end
              : Math.max(a.start, b.start) < Math.min(a.end, b.end);
      if (overlaps) return { clean: false, content: ours };
    }
    if (!duplicate) combined.push(b);
  }
  combined.sort((a, b) => b.start - a.start || b.end - a.end);
  for (const edit of combined) original.splice(edit.start, edit.end - edit.start, ...edit.lines);
  return { clean: true, content: original.join('') };
}

export function documentStats(content: string) {
  const chinese = content.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const words =
    content.replace(/[\u3400-\u9fff]/g, ' ').match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)
      ?.length ?? 0;
  return {
    words: chinese + words,
    lines: content.split('\n').length,
    readingMinutes: Math.max(1, Math.ceil((chinese + words) / 350)),
  };
}

export function headings(content: string) {
  let fence = '';
  return content.split('\n').flatMap((line, index) => {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = '';
      return [];
    }
    if (fence) return [];
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    return match
      ? [
          {
            level: match[1].length,
            text: match[2].replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*`_]/g, ''),
            line: index + 1,
          },
        ]
      : [];
  });
}
