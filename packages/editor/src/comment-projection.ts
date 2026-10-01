import type { Node } from '@milkdown/kit/prose/model';
import type { Selection } from '@milkdown/kit/prose/state';
import type { CommentSpan } from '@tano/protocol';

export interface ProjectionSegment {
  from: number;
  to: number;
  proseFrom: number;
  proseTo: number;
}

export interface CommentBlockGeometry {
  key: string;
  ids: string[];
  top: number;
  bottom: number;
}

/** Viewport coordinates. The workbench owns the overlay and its positioning. */
export interface CommentGeometry {
  left: number;
  right: number;
  blocks: CommentBlockGeometry[];
}

/** One projection for comment coordinates in rich editing and reopened Markdown. */
export function projectCommentText(doc: Node) {
  let text = '';
  let lastBlock = -1;
  const segments: ProjectionSegment[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText && !(node.isAtom && node.childCount === 0)) return true;
    const value = node.isText ? node.text ?? '' : '\ufffc';
    if (!value) return false;
    const $pos = doc.resolve(pos);
    let depth = $pos.depth;
    while (depth > 0 && !$pos.node(depth).isTextblock) depth--;
    const block = depth ? $pos.before(depth) : pos;
    if (lastBlock !== -1 && block !== lastBlock) text += '\n';
    lastBlock = block;
    const from = text.length;
    text += value;
    segments.push({ from, to: text.length, proseFrom: pos, proseTo: pos + node.nodeSize });
    return false;
  });
  return { text, segments };
}

export function commentSpansForSelection(doc: Node, selection: Selection): CommentSpan[] {
  if (selection.empty) return [];
  const projection = projectCommentText(doc);
  const spans: CommentSpan[] = [];
  for (const part of projection.segments) {
    const from = Math.max(selection.from, part.proseFrom);
    const to = Math.min(selection.to, part.proseTo);
    if (from >= to) continue;
    const start = part.from + from - part.proseFrom;
    const end = part.from + to - part.proseFrom;
    const text = projection.text.slice(start, end);
    if (!text) continue;
    const previous = spans.at(-1);
    if (previous && previous.to === start) {
      previous.to = end;
      previous.text += text;
    } else spans.push({ from: start, to: end, text });
  }
  return spans;
}

export function proseRangesForCommentSpans(doc: Node, spans: readonly CommentSpan[]) {
  const projection = projectCommentText(doc);
  return spans.flatMap(span => projection.segments.flatMap(part => {
    const from = Math.max(span.from, part.from);
    const to = Math.min(span.to, part.to);
    if (from >= to) return [];
    return [{ from: part.proseFrom + from - part.from, to: part.proseFrom + to - part.from }];
  }));
}
