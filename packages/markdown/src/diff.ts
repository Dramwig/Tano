import { diffLines } from 'diff';
export interface DiffRow {
  kind: 'same' | 'added' | 'removed' | 'omitted';
  text: string;
  before?: number;
  after?: number;
}
/** Bound both memory and diff work; pathological/large inputs stay reviewable as source. */
export function markdownDiff(
  before: string,
  after: string,
): { rows: DiffRow[]; limited: boolean; added: number; removed: number } {
  const empty = { rows: [], limited: true, added: 0, removed: 0 };
  if (before.length + after.length > 1024 * 1024) return empty;
  const parts = diffLines(before, after, { timeout: 80, maxEditLength: 3000 });
  if (!parts) return empty;
  let left = 1,
    right = 1,
    added = 0,
    removed = 0;
  const rows: DiffRow[] = [];
  for (const part of parts) {
    const lines = part.value.match(/[^\n]*\n|[^\n]+$/g) ?? [];
    const kind = part.added ? 'added' : part.removed ? 'removed' : 'same';
    if (part.added) added += lines.length;
    if (part.removed) removed += lines.length;
    lines.forEach((line, index) => {
      const row = {
        kind,
        text: line.replace(/\r?\n$/, '') + (!line.endsWith('\n') ? ' ⏎ 无结尾换行' : ''),
        ...(part.added ? {} : { before: left++ }),
        ...(part.removed ? {} : { after: right++ }),
      } as DiffRow;
      if (kind !== 'same' || lines.length <= 8 || index < 3 || index >= lines.length - 3)
        rows.push(row);
      else if (index === 3)
        rows.push({ kind: 'omitted', text: `省略 ${lines.length - 6} 行未变内容` });
    });
    if (rows.length > 10_000) return empty;
  }
  return { rows, limited: false, added, removed };
}
