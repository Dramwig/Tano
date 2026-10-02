import { diffChars } from 'diff';

export interface TextChange { from: number; to: number; text: string }

/** Bounded character diff for short descriptions and reference span rebasing. */
export function textChanges(before: string, after: string): TextChange[] | null {
  if (before.length + after.length > 80_000) return null;
  const parts = diffChars(before, after, { timeout: 80, maxEditLength: 3000 });
  if (!parts) return null;
  const changes: TextChange[] = [];
  let position = 0;
  let pending: TextChange | undefined;
  for (const part of parts) {
    if (!part.added && !part.removed) {
      if (pending) changes.push(pending);
      pending = undefined;
      position += part.value.length;
    } else {
      pending ??= { from: position, to: position, text: '' };
      if (part.removed) { position += part.value.length; pending.to = position; }
      else pending.text += part.value;
    }
  }
  if (pending) changes.push(pending);
  return changes;
}

export function mergeText(base: string, local: string, remote: string, atomic: readonly { from: number; to: number }[] = []): string | null {
  if (local === remote || remote === base) return local;
  if (local === base) return remote;
  const left = textChanges(base, local), right = textChanges(base, remote);
  if (!left || !right) return null;
  for (const span of atomic) {
    const touches = (change: TextChange) => change.from === change.to
      ? change.from > span.from && change.from < span.to
      : Math.max(change.from, span.from) < Math.min(change.to, span.to);
    const ours = left.filter(touches), theirs = right.filter(touches);
    if (ours.length && theirs.length && JSON.stringify(ours) !== JSON.stringify(theirs)) return null;
  }
  const combined = [...left];
  for (const b of right) {
    let duplicate = false;
    for (const a of left) {
      if (a.from === b.from && a.to === b.to && a.text === b.text) { duplicate = true; continue; }
      const overlaps = a.from === a.to && b.from === b.to ? a.from === b.from
        : a.from === a.to ? a.from >= b.from && a.from < b.to
        : b.from === b.to ? b.from >= a.from && b.from < a.to
        : Math.max(a.from, b.from) < Math.min(a.to, b.to);
      if (overlaps) return null;
    }
    if (!duplicate) combined.push(b);
  }
  let result = base;
  for (const change of combined.sort((a, b) => b.from - a.from || b.to - a.to))
    result = result.slice(0, change.from) + change.text + result.slice(change.to);
  return result;
}
