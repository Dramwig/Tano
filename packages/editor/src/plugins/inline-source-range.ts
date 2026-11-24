import { TextSelection } from '@milkdown/kit/prose/state';
import type { EditorState } from '@milkdown/kit/prose/state';
import type { Node } from '@milkdown/kit/prose/model';

/** Closed intervals: the shared boundary belongs to both adjacent fields. */
export function touchingInlineRange(ranges: readonly { from: number; to: number }[], caret: number) {
  const touching = ranges.filter(range => range.from <= caret && caret <= range.to);
  return touching.length
    ? { from: Math.min(...touching.map(range => range.from)), to: Math.max(...touching.map(range => range.to)) }
    : null;
}

const visibleMarks = new Set([
  'strong',
  'emphasis',
  'inlineCode',
  'strike_through',
  'link',
  'underline',
  'superscript',
  'subscript',
  'highlight',
  'text_color',
  'background_color',
  'inline_comment',
]);

interface Span {
  from: number;
  to: number;
}

function activeMarkSpans(state: Pick<EditorState, 'selection'>, editableAtom?: (node: Node, parent: Node) => boolean): Span[] {
  const selection = state.selection;
  if (
    !(selection instanceof TextSelection) ||
    !selection.empty ||
    !selection.$from.parent.inlineContent
  )
    return [];
  const parent = selection.$from.parent;
  const start = selection.$from.start();
  const cursor = selection.from;
  const children: { node: Node; from: number; to: number }[] = [];
  parent.forEach((node, offset) => {
    children.push({ node, from: start + offset, to: start + offset + node.nodeSize });
  });
  // Both sides own a shared caret boundary, regardless of DOM affinity.
  return children.flatMap((active, index) => {
    if (cursor < active.from || cursor > active.to) return [];
    if (editableAtom?.(active.node, parent)) return [{ from: active.from, to: active.to }];
    if (!active.node.isText) return [];
    return active.node.marks.flatMap((mark) => {
      if (!visibleMarks.has(mark.type.name)) return [];
      let left = index;
      let right = index;
      const hasMark = (index: number) =>
        children[index]?.node.isText && children[index].node.marks.some((other) => other.eq(mark));
      while (left > 0 && hasMark(left - 1)) left--;
      while (right + 1 < children.length && hasMark(right + 1)) right++;
      return [
        {
          from: children[left].from,
          to: children[right].to,
        },
      ];
    });
  });
}

/** Reveal every inline field containing or touching the caret, including nested marks. */
export function activeInlineSourceRange(state: Pick<EditorState, 'selection'>,
  editableAtom?: (node: Node, parent: Node) => boolean) {
  const spans = activeMarkSpans(state, editableAtom);
  if (!spans.length) return null;
  const chosen = touchingInlineRange(spans, state.selection.from)!;
  const parent = state.selection.$from.parent;
  const start = state.selection.$from.start();
  const content = parent.cut(chosen.from - start, chosen.to - start);
  let hasAsteriskMark = false;
  content.forEach(node => {
    if (node.marks.some(mark => ['strong', 'emphasis'].includes(mark.type.name) && mark.attrs.marker === '*'))
      hasAsteriskMark = true;
  });
  let { from, to } = chosen;
  if (hasAsteriskMark) parent.forEach((node, offset) => {
    if (!node.isText || node.marks.length) return;
    // Reveal the complete delimiter run so **text* can become **text** with
    // one more keystroke, including after saving and reopening the document.
    if (start + offset + node.nodeSize === chosen.from)
      from -= /\*+$/.exec(node.text!)?.[0].length ?? 0;
    if (start + offset === chosen.to)
      to += /^\*+/.exec(node.text!)?.[0].length ?? 0;
  });
  return { from, to };
}
