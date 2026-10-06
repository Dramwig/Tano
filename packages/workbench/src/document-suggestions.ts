import type { DocumentSuggestion } from '@tano/protocol';
import { textChanges } from '@tano/markdown';

export interface SuggestionRange { id: string; from: number; to: number; text: string; removed: string; baseFrom: number; baseTo: number }
export interface SuggestionProjection { content: string; ranges: SuggestionRange[]; conflicts: string[] }

/** Preserve source spelling outside the actual rich-editor transaction. */
export function preserveSuggestedSource(raw: string, normalizedBefore: string, normalizedAfter: string): string {
  if (raw === normalizedBefore) return normalizedAfter;
  const edits = textChanges(normalizedBefore, normalizedAfter);
  const spelling = textChanges(normalizedBefore, raw);
  if (!edits || !spelling) throw new Error('无法安全映射此修改，请切换源码模式编辑；正式正文未改变');
  const overlaps = (a: { from: number; to: number }, b: { from: number; to: number }) =>
    a.from === a.to || b.from === b.to ? Math.max(a.from, b.from) <= Math.min(a.to, b.to)
      : Math.max(a.from, b.from) < Math.min(a.to, b.to);
  // If the user edits a formatting token itself, their new spelling wins there.
  const changes = [...edits, ...spelling.filter(style => !edits.some(edit => overlaps(edit, style)))];
  let result = normalizedBefore;
  for (const change of changes.sort((a, b) => b.from - a.from || b.to - a.to))
    result = result.slice(0, change.from) + change.text + result.slice(change.to);
  return result;
}

/** Map only unchanged source. A changed target is a conflict, never a fuzzy replacement. */
export function locateSuggestion(item: DocumentSuggestion, current: string): { from: number; to: number } | null {
  if (item.base === current) return { from: item.from, to: item.to };
  const changes = textChanges(item.base, current);
  if (!changes) return null;
  const original = item.base.slice(item.from, item.to);
  let repeated = false;
  if (original) {
    const count = (text: string) => text.split(original).length - 1;
    repeated = count(item.base) > 1;
    if (repeated && count(item.base) !== count(current)) return null;
  }
  let shift = 0;
  for (const change of changes) {
    // Insertion boundaries are deliberately conservative: order is not inferable.
    if (change.from === change.to ? change.from >= item.from && change.from <= item.to
      : item.from === item.to ? change.from <= item.from && change.to >= item.from
      : Math.max(change.from, item.from) < Math.min(change.to, item.to)) return null;
    if (change.to <= item.from) shift += change.text.length - (change.to - change.from);
  }
  const from = item.from + shift, to = item.to + shift;
  if (repeated) {
    const prefix = item.base.slice(Math.max(0, item.from - 64), item.from);
    const suffix = item.base.slice(item.to, item.to + 64);
    const context = prefix + original + suffix;
    if (current.slice(Math.max(0, from - prefix.length), to + suffix.length) !== context ||
        current.indexOf(context) !== current.lastIndexOf(context)) return null;
  }
  return current.slice(from, to) === original ? { from, to } : null;
}

export function projectSuggestions(current: string, suggestions: readonly DocumentSuggestion[]): SuggestionProjection {
  const conflicts: string[] = [];
  const located = suggestions.filter(item => item.status === 'pending').flatMap(item => {
    const position = locateSuggestion(item, current);
    if (!position) { conflicts.push(item.id); return []; }
    return [{ item, ...position }];
  }).sort((a, b) => a.from - b.from || a.to - b.to);
  for (let i = 0; i < located.length; i++) for (let j = i + 1; j < located.length; j++) {
    const a = located[i]!, b = located[j]!;
    if (b.from > a.to) break;
    if (b.from < a.to || (b.from === a.from && (a.from === a.to || b.from === b.to))) conflicts.push(a.item.id, b.item.id);
  }
  let content = '', cursor = 0;
  const ranges: SuggestionRange[] = [];
  for (const { item, from, to } of located) {
    if (conflicts.includes(item.id)) continue;
    content += current.slice(cursor, from);
    ranges.push({ id: item.id, from: content.length, to: content.length + item.text.length,
      text: item.text, removed: current.slice(from, to), baseFrom: from, baseTo: to });
    content += item.text;
    cursor = to;
  }
  content += current.slice(cursor);
  return { content, ranges, conflicts: [...new Set(conflicts)] };
}

/** A user transaction becomes one suggestion; subsequent adjacent typing updates it. */
export function suggestEdit(current: string, suggestions: readonly DocumentSuggestion[], next: string,
  author: { id: string; name: string }, now = Date.now()): DocumentSuggestion[] {
  const projection = projectSuggestions(current, suggestions);
  const before = projection.content;
  if (before === next) return [...suggestions];
  if (current.length > 2_000_000 || next.length > 2_000_000) throw new Error('建议内容过大，请拆分文档后重试');
  let from = 0, end = before.length, nextEnd = next.length;
  while (from < end && from < nextEnd && before[from] === next[from]) from++;
  while (end > from && nextEnd > from && before[end - 1] === next[nextEnd - 1]) { end--; nextEnd--; }
  // Never split a UTF-16 surrogate pair at a change boundary.
  if (from && /[\uD800-\uDBFF]/.test(before[from - 1]!)) from--;
  if (end < before.length && /[\uDC00-\uDFFF]/.test(before[end]!)) { end++; nextEnd++; }
  const affected = projection.ranges.filter(range => range.from <= end && range.to >= from);
  const affectedIds = new Set(affected.map(range => range.id));
  if (suggestions.some(item => affectedIds.has(item.id) && item.authorId !== author.id))
    throw new Error('这段内容包含他人的待审建议，请先接受或拒绝该建议');
  const start = Math.min(from, ...affected.map(range => range.from));
  const stop = Math.max(end, ...affected.map(range => range.to));
  const map = (position: number, side: 'start' | 'end') => {
    let shift = 0;
    for (const range of projection.ranges) {
      if (position < range.from) break;
      if (position <= range.to) return side === 'start' ? range.baseFrom : range.baseTo;
      shift += (range.to - range.from) - (range.baseTo - range.baseFrom);
    }
    return position - shift;
  };
  const baseFrom = map(start, 'start'), baseTo = map(stop, 'end');
  const text = before.slice(start, from) + next.slice(from, nextEnd) + before.slice(end, stop);
  const existing = suggestions.find(item => affectedIds.has(item.id));
  const replacement: DocumentSuggestion = {
    id: existing?.id ?? crypto.randomUUID(), revision: (existing?.revision ?? 0) + 1,
    authorId: author.id, authorName: author.name, createdAt: existing?.createdAt ?? now, updatedAt: now,
    base: current, from: baseFrom, to: baseTo, text, status: text === current.slice(baseFrom, baseTo) ? 'rejected' : 'pending',
    ...(existing?.replies ? { replies: existing.replies } : {}),
  };
  const result = suggestions.map(item => affectedIds.has(item.id)
    ? item.id === replacement.id ? replacement : { ...item, status: 'rejected' as const, revision: item.revision + 1, updatedAt: now }
    : item);
  if (!existing) result.push(replacement);
  return result;
}

/** Split an agent proposal into source edits; fallback remains one explicit whole-document edit. */
export function proposalSuggestions(base: string, content: string, author: { id: string; name: string }, groupId: string, reason: string): DocumentSuggestion[] {
  if (base === content) return [];
  const raw = textChanges(base, content) ?? [{ from: 0, to: base.length, text: content }];
  // Moving/removing blocks or paired syntax spanning lines is one structural
  // proposal. Partial acceptance must not duplicate a move or break containers.
  const reorderedLines = base.includes('\n') && base.split('\n').sort().join('\n') === content.split('\n').sort().join('\n');
  const structural = reorderedLines || raw.some(change => /\n/.test(change.text + base.slice(change.from, change.to))) ||
    (raw.some(change => /[*`~<>|\[\]{}]/.test(change.text + base.slice(change.from, change.to))) &&
      raw.length > 1 && base.slice(raw[0]!.from, raw.at(-1)!.to).includes('\n'));
  if (structural) {
    const now = Date.now();
    return [{ id: `${groupId}-0`, revision: 1, base, from: 0, to: base.length, text: content,
      authorId: author.id, authorName: author.name, groupId, reason, createdAt: now, updatedAt: now, status: 'pending' }];
  }
  // Keep paired Markdown delimiters and same-line replacements indivisible.
  const changes: { from: number; to: number; text: string }[] = [];
  for (const change of raw) {
    const previous = changes.at(-1);
    if (previous && !base.slice(previous.to, change.from).includes('\n')) {
      previous.text += base.slice(previous.to, change.from) + change.text;
      previous.to = change.to;
    } else changes.push({ ...change });
  }
  const now = Date.now();
  return changes.map((change, index) => ({ ...change, id: `${groupId}-${index}`, revision: 1,
    base, authorId: author.id, authorName: author.name, groupId, reason,
    createdAt: now, updatedAt: now, status: 'pending' }));
}
