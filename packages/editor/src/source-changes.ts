import { diffChars, diffLines } from 'diff';

export interface SourceChange { from: number; to: number; insert: string }

/** Keep independent remote edits independent so selection and undo mappings
 * retain the unchanged text between them. Bound refinement on replacement files. */
export function sourceChanges(before: string, after: string): SourceChange[] {
  if (before === after) return [];
  const deadline = Date.now() + 50;
  const lines = diffLines(before, after, { timeout: 30, maxEditLength: 5000 });
  if (!lines) return replacement(before, after, 0);
  const result: SourceChange[] = [];
  let offset = 0;
  for (let index = 0; index < lines.length; index++) {
    const part = lines[index]!;
    if (!part.added && !part.removed) { offset += part.value.length; continue; }
    let removed = '', inserted = '';
    while (index < lines.length && (lines[index]!.added || lines[index]!.removed)) {
      const change = lines[index++]!;
      if (change.removed) removed += change.value;
      else inserted += change.value;
    }
    index--;
    const remaining = deadline - Date.now();
    const chars = remaining > 0 ? diffChars(removed, inserted, { timeout: remaining, maxEditLength: 2000 }) : undefined;
    if (!chars) result.push(...replacement(removed, inserted, offset));
    else {
      let position = offset;
      for (const change of chars) {
        if (!change.added && !change.removed) { position += change.value.length; continue; }
        const previous = result.at(-1);
        const edit = previous?.to === position ? previous : { from: position, to: position, insert: '' };
        if (edit !== previous) result.push(edit);
        if (change.removed) { position += change.value.length; edit.to = position; }
        else edit.insert += change.value;
      }
    }
    offset += removed.length;
  }
  return result;
}

function replacement(before: string, after: string, offset: number): SourceChange[] {
  let from = 0, to = before.length, end = after.length;
  while (from < to && from < end && before[from] === after[from]) from++;
  while (to > from && end > from && before[to - 1] === after[end - 1]) { to--; end--; }
  return [{ from: offset + from, to: offset + to, insert: after.slice(from, end) }];
}
