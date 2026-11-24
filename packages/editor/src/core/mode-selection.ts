import { diffChars } from 'diff';
import { Fragment, Slice } from '@milkdown/kit/prose/model';
import type { Node } from '@milkdown/kit/prose/model';

/** UTF-16 offsets in the Markdown with normalized line endings, as used by CodeMirror. */
export interface ModeSelection { anchor: number; head: number }

/** Translate a serializer position back to the original spelling of the Markdown. */
function originalOffset(before: string, after: string, position: number) {
  if (before === after) return position;
  const changes = diffChars(before, after, { timeout: 50, maxEditLength: 10000 });
  let from = 0, to = 0;
  if (changes) {
    for (const change of changes) {
      if (change.added) { to += change.value.length; continue; }
      const end = from + change.value.length;
      if (position < end || (position === end && !change.removed))
        return to + (change.removed ? 0 : position - from);
      from = end;
      if (!change.removed) to += change.value.length;
    }
    return to;
  }
  // Bound work on unusually large normalization diffs; preserve the nearby line.
  const lines = before.slice(0, position).split('\n');
  const target = after.split('\n');
  const line = Math.min(lines.length - 1, target.length - 1);
  return target.slice(0, line).reduce((offset, text) => offset + text.length + 1, 0)
    + Math.min(lines.at(-1)!.length, target[line]!.length);
}

/**
 * Use the editor's own serializer so nested lists, tables, escaped text and live
 * Markdown fields share one coordinate system. Markers exist only in immutable
 * copies of the document: no edit, history item or saved content is produced.
 */
export function markdownPositionMap(doc: Node, markdown: string, serialize: (doc: Node) => string) {
  const source = markdown.replace(/\r\n?/g, '\n');
  let marker = '\ue000tano-caret\ue001';
  while (source.includes(marker) || doc.textContent.includes(marker)) marker += '\ue002';
  const cache = new Map<number, number>();
  const ranges: { from: number; to: number; index: number }[] = [];
  let count = 0;
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      ranges.push({ from: pos + 1, to: pos + node.nodeSize - 1, index: count });
      count += node.nodeSize - 1;
      return false;
    }
    if (node.isAtom && !node.isText) {
      ranges.push({ from: pos, to: pos, index: count++ });
      return false;
    }
    return true;
  });
  function toSource(position: number): number {
    position = Math.max(0, Math.min(position, doc.content.size));
    const cached = cache.get(position);
    if (cached !== undefined) return cached;
    const $pos = doc.resolve(position);
    let insertion: Node;
    if ($pos.parent.inlineContent) insertion = doc.type.schema.text(marker, $pos.marks());
    else {
      const type = [doc.type.schema.nodes.tano_live_source, doc.type.schema.nodes.paragraph]
        .find(type => type && $pos.parent.canReplaceWith($pos.index(), $pos.index(), type));
      if (!type) return position === 0 ? 0 : source.length;
      insertion = type.create(null, doc.type.schema.text(marker));
    }
    const marked = doc.replace(position, position, new Slice(Fragment.from(insertion), 0, 0));
    const serialized = serialize(marked).replace(/\r\n?/g, '\n');
    const offset = serialized.indexOf(marker);
    if (offset < 0) return 0;
    const clean = serialized.slice(0, offset) + serialized.slice(offset + marker.length);
    const result = originalOffset(clean, source, offset);
    cache.set(position, result);
    return result;
  }
  function at(index: number) {
    let low = 0, high = ranges.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (ranges[middle]!.index <= index) low = middle;
      else high = middle - 1;
    }
    const range = ranges[low]!;
    return Math.min(range.to, range.from + index - range.index);
  }
  function toProse(offset: number) {
    if (!count) return 0;
    let low = 0, high = count - 1;
    let from = toSource(at(low)), to = toSource(at(high));
    if (offset <= from) return at(low);
    if (offset >= to) return at(high);
    // Most rendered characters occupy one source character. Interpolate in
    // source coordinates first, rather than serializing the entire document
    // once per bit of its character count. Keep bracketing the exact position;
    // fall back to bisection for unusually uneven Markdown expansion.
    for (let probe = 0; high - low > 1; probe++) {
      const estimate = probe < 8 && to > from
        ? Math.round(low + (offset - from) * (high - low) / (to - from))
        : Math.floor((low + high) / 2);
      const middle = Math.max(low + 1, Math.min(high - 1, estimate));
      const value = toSource(at(middle));
      if (value === offset) return at(middle);
      if (value < offset) { low = middle; from = value; }
      else { high = middle; to = value; }
    }
    return Math.abs(from - offset) < Math.abs(to - offset) ? at(low) : at(high);
  }
  return { toSource, toProse };
}
