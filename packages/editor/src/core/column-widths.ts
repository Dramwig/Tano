/** Relative column widths are portable layout attributes in the Markdown fence. */
export function parseColumnWidths(value: unknown, count: number): number[] | null {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?(?:,\d+(?:\.\d+)?)*$/.test(value)) return null;
  const widths = value.split(',').map(Number);
  const sum = widths.reduce((total, width) => total + width, 0);
  if (widths.length !== count || !Number.isFinite(sum) || widths.some(width => width <= 0)) return null;
  return widths.map(width => width / sum * 100);
}

export function columnWidths(value: unknown, count: number): number[] {
  return parseColumnWidths(value, count) ?? Array.from({ length: count }, () => 100 / count);
}

/** Move a boundary without changing other columns or the combined width of its neighbors. */
export function resizeColumnWidths(widths: readonly number[], index: number, delta: number, minimum: number): number[] {
  const next = [...widths];
  if (index < 0 || index >= next.length - 1 || !Number.isFinite(delta)) return next;
  const total = next[index]! + next[index + 1]!;
  const min = Math.min(minimum, total / 2);
  next[index] = Math.max(min, Math.min(total - min, next[index]! + delta));
  next[index + 1] = total - next[index]!;
  return next;
}

export function formatColumnWidths(widths: readonly number[]): string {
  return widths.map(width => Math.max(0.001, Number(width.toFixed(3)))).join(',');
}
