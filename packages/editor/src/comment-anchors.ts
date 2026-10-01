import { diffChars, diffLines } from 'diff';
import type { CommentAnchor, CommentSpan } from '@tano/protocol';

export function makeCommentAnchor(
  basis: CommentAnchor['basis'], text: string, spans: readonly CommentSpan[], baseHash: string,
): CommentAnchor {
  if (!spans.length || spans.some(span => span.from < 0 || span.to > text.length ||
      span.from >= span.to || text.slice(span.from, span.to) !== span.text))
    throw new Error('请先选择有效的内容');
  return {
    basis, baseHash, spans: spans.map(span => ({ ...span })),
    prefix: text.slice(Math.max(0, spans[0]!.from - 48), spans[0]!.from),
    suffix: text.slice(spans.at(-1)!.to, spans.at(-1)!.to + 48),
  };
}

/** A missing or ambiguous match is hidden, never attached to a guessed duplicate. */
export function resolveCommentAnchor(anchor: CommentAnchor, text: string): CommentAnchor | null {
  if (anchor.spans.every(span => text.slice(span.from, span.to) === span.text))
    return anchor;
  const spans: CommentSpan[] = [];
  let minimum = 0;
  for (const span of anchor.spans) {
    if (!span.text || span.text.length > text.length) return null;
    const candidates: number[] = [];
    for (let from = text.indexOf(span.text, minimum); from >= 0; from = text.indexOf(span.text, from + 1)) {
      if (spans.length === 0 && anchor.prefix && !text.slice(Math.max(0, from - anchor.prefix.length), from).endsWith(anchor.prefix)) continue;
      if (span === anchor.spans.at(-1) && anchor.suffix && !text.slice(from + span.text.length).startsWith(anchor.suffix)) continue;
      candidates.push(from);
      if (candidates.length > 1) return null;
    }
    if (candidates.length !== 1) return null;
    const from = candidates[0]!;
    spans.push({ from, to: from + span.text.length, text: span.text });
    minimum = from + span.text.length;
  }
  return makeCommentAnchor(anchor.basis, text, spans, anchor.baseHash);
}

/** Keep only original characters that survived an edit. New text at the old offset is not an anchor. */
export function rebaseCommentAnchor(anchor: CommentAnchor, before: string, after: string): CommentAnchor | null {
  const resolved = resolveCommentAnchor(anchor, before);
  if (!resolved) return null;
  if (before === after) return resolved;
  // A diff cannot tell which identical occurrence was removed. Detach rather
  // than let its chosen alignment silently move a comment to a surviving copy.
  for (const span of resolved.spans) {
    if (span.text.length < 2) continue;
    const occurrences = (text: string) => {
      let count = 0;
      for (let at = text.indexOf(span.text); at >= 0; at = text.indexOf(span.text, at + span.text.length)) count++;
      return count;
    };
    if (occurrences(before) > 1 && occurrences(after) < occurrences(before)) return null;
  }
  if (before.length + after.length > 2_000_000) return null;
  const changes = diffLines(before, after, { timeout: 80, maxEditLength: 5000 });
  if (!changes) return null;
  let oldPosition = 0, newPosition = 0;
  const survivors: CommentSpan[] = [];
  const retain = (oldStart: number, newStart: number, length: number) => {
    for (const span of resolved.spans) {
      const from = Math.max(span.from, oldStart);
      const to = Math.min(span.to, oldStart + length);
      if (from >= to) continue;
      const mappedFrom = newStart + from - oldStart;
      const mappedTo = newStart + to - oldStart;
      const previous = survivors.at(-1);
      if (previous && previous.to === mappedFrom) {
        previous.to = mappedTo;
        previous.text += after.slice(mappedFrom, mappedTo);
      } else survivors.push({ from: mappedFrom, to: mappedTo, text: after.slice(mappedFrom, mappedTo) });
    }
  };
  for (let index = 0; index < changes.length; index++) {
    const change = changes[index]!;
    if (!change.added && !change.removed) retain(oldPosition, newPosition, change.value.length);
    else if (change.removed && changes[index + 1]?.added) {
      const replacement = changes[++index]!;
      // A single modified line has clear structural identity. A multi-line
      // replacement may represent a deletion and a new block, so do not guess.
      if (change.value.split('\n').length <= 2 && replacement.value.split('\n').length <= 2) {
        const pieces = diffChars(change.value, replacement.value, { timeout: 30, maxEditLength: 500 });
        let from = oldPosition, to = newPosition;
        for (const piece of pieces ?? []) {
          if (!piece.added && !piece.removed) retain(from, to, piece.value.length);
          if (!piece.added) from += piece.value.length;
          if (!piece.removed) to += piece.value.length;
        }
      }
      oldPosition += change.value.length;
      newPosition += replacement.value.length;
      continue;
    }
    if (!change.added) oldPosition += change.value.length;
    if (!change.removed) newPosition += change.value.length;
  }
  return survivors.length ? makeCommentAnchor(anchor.basis, after, survivors, anchor.baseHash) : null;
}
