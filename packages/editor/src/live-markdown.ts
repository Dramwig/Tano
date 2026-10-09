import { Plugin, NodeSelection, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorState } from '@milkdown/kit/prose/state';
import type { Node } from '@milkdown/kit/prose/model';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { refractor } from 'refractor';
import latex from 'refractor/latex';
import { sourceStyleRanges } from './source-highlight';
import { mathHighlightRanges } from './math-highlight';
import { mermaidHighlightRanges } from './mermaid-highlight';

if (!refractor.registered('latex')) refractor.register(latex);

function fencedCodeStyles(
  source: string,
  mark: (from: number, to: number, className: string) => void,
) {
  const opening = /^(`{3,}|~{3,})[ \t]*([^\n]*)\n/.exec(source);
  if (!opening) return false;
  const language = opening[2]!.trim().split(/\s+/)[0]?.toLowerCase();
  if (!language || !refractor.registered(language)) return false;
  const lastNewline = source.lastIndexOf('\n');
  const closer = source.slice(lastNewline + 1).trim();
  const closingFence = new RegExp(`^${opening[1]![0]}{${opening[1]!.length},}$`);
  const bodyEnd = closingFence.test(closer) ? lastNewline : source.length;
  const bodyStart = opening[0].length;
  const body = source.slice(bodyStart, bodyEnd);
  let highlighted: ReturnType<typeof refractor.highlight>;
  try {
    highlighted = refractor.highlight(body, language);
  } catch {
    return false;
  }
  const visit = (
    children: typeof highlighted.children,
    offset: number,
    inherited: string[] = [],
  ): number => {
    for (const child of children) {
      if (child.type === 'text') {
        if (inherited.length) mark(offset, offset + child.value.length, inherited.join(' '));
        offset += child.value.length;
      } else if (child.type === 'element') {
        const classes = Array.isArray(child.properties.className)
          ? child.properties.className.map(String)
          : [];
        offset = visit(child.children, offset, [...inherited, ...classes]);
      }
    }
    return offset;
  };
  visit(highlighted.children, bodyStart);
  return true;
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
]);

interface Span {
  from: number;
  to: number;
}

function activeMarkSpans(state: Pick<EditorState, 'selection'>, preferredMark?: string): Span[] {
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
  // A caret at the start of plain text belongs to that text, even when a
  // formatted field ends at the same position.
  const candidates = children.map((entry, index) => ({ ...entry, index }));
  const active =
    (preferredMark
      ? candidates.find(
          ({ node, from, to }) =>
            node.isText &&
            from <= cursor &&
            cursor <= to &&
            node.marks.some((mark) => mark.type.name === preferredMark),
        )
      : undefined) ??
    candidates.find(({ node, from, to }) => node.isText && from <= cursor && cursor < to) ??
    candidates.find(({ node, from, to }) => node.isText && from < cursor && cursor <= to);
  if (!active || !active.node.marks.some((mark) => visibleMarks.has(mark.type.name))) return [];
  return active.node.marks.flatMap((mark) => {
    if (!visibleMarks.has(mark.type.name)) return [];
    let left = active.index;
    let right = active.index;
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
}

/** Prefer the smallest mark run containing the caret, including any nested marks in its source. */
export function activeInlineSourceRange(state: Pick<EditorState, 'selection'>, preferredMark?: string) {
  const spans = activeMarkSpans(state, preferredMark);
  if (!spans.length) return null;
  const chosen = spans.sort((a, b) => a.to - a.from - (b.to - b.from))[0]!;
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

/** Position between adjacent fences, used when the user starts typing a body line. */
export function emptyFencedCodeBodyOffset(source: string): number | null {
  const opening = /^(`{3,}|~{3,})[^\n]*\n/.exec(source);
  if (!opening || source.indexOf('\n', opening[0].length) >= 0) return null;
  const closing = source.slice(opening[0].length).trim();
  return new RegExp(`^${opening[1]![0]}{${opening[1]!.length},}$`).test(closing)
    ? opening[0].length
    : null;
}

function editableSourceStyles(state: EditorState): Decoration[] {
  const decorations: Decoration[] = [];
  state.doc.descendants((node, pos) => {
    if (!['tano_live_source', 'tano_live_source_inline'].includes(node.type.name)) return;
    const source = node.textContent;
    const mark = (from: number, to: number, className: string) => {
      if (to > from)
        decorations.push(Decoration.inline(pos + 1 + from, pos + 1 + to, { class: className }));
    };
    if (node.attrs.origin === 'code_block') {
      const firstNewline = source.indexOf('\n');
      const lastNewline = source.lastIndexOf('\n');
      if (lastNewline > firstNewline) {
        const body = source.slice(firstNewline + 1, lastNewline);
        mark(firstNewline + 1, lastNewline + (body.endsWith('\n') || !body ? 1 : 0),
          'tano-live-code-body');
      }
    }
    if (
      node.attrs.origin === 'math_block' ||
      (node.type.name === 'tano_live_source_inline' && /^(?:\${1,2}|\\\(|\\\[)/.test(source))
    ) {
      for (const range of mathHighlightRanges(source, true))
        mark(range.from, range.to, `tano-math-token-${range.kind}`);
      return;
    }
    if (node.attrs.origin === 'code_block' && /^(?:`{3,}|~{3,})[ \t]*mermaid\b/i.test(source)) {
      for (const range of mermaidHighlightRanges(source, true))
        mark(range.from, range.to, `tano-mermaid-token-${range.kind}`);
      return;
    }
    if (node.attrs.origin === 'code_block' && fencedCodeStyles(source, mark)) return;
    for (const { from, to, style } of sourceStyleRanges(source)) {
      if (style === 'heading') {
        const prefix = /^#{1,6}[ \t]+/.exec(source.slice(from, to));
        if (prefix) mark(from, from + prefix[0].length, 'tano-live-source-marker');
      }
      const delimiter =
        style === 'strong'
          ? source.slice(from, from + 2) === '**' || source.slice(from, from + 2) === '__'
            ? 2
            : 0
          : style === 'emphasis'
            ? /^[*_]$/.test(source[from] ?? '')
              ? 1
              : 0
            : style === 'delete' && source.slice(from, from + 2) === '~~'
              ? 2
              : 0;
      if (!delimiter || source.slice(to - delimiter, to) !== source.slice(from, from + delimiter))
        continue;
      mark(from, from + delimiter, 'tano-live-source-marker');
      mark(from + delimiter, to - delimiter, `tano-live-source-${style}`);
      mark(to - delimiter, to, 'tano-live-source-marker');
    }
  });
  return decorations;
}

/** Style the actual editable source text and show block prefixes near the caret. */
export function liveMarkdown(enabled: () => boolean, readonly: () => boolean) {
  let focused = false;
  const refresh = (view: import('@milkdown/kit/prose/view').EditorView, value: boolean) => {
    if (focused === value) return;
    focused = value;
    view.dispatch(view.state.tr.setMeta('addToHistory', false));
  };
  return new Plugin({
    props: {
      handleDOMEvents: {
        focus(view) {
          refresh(view, true);
          return false;
        },
        blur(view) {
          refresh(view, false);
          return false;
        },
      },
      decorations(state) {
        if (!focused || !enabled() || readonly()) return null;
        const decorations = editableSourceStyles(state);
        const selection = state.selection;
        if (selection instanceof NodeSelection && selection.node.type.name === 'tano_wiki_link')
          decorations.push(
            Decoration.node(selection.from, selection.to, { class: 'tano-live-wiki' }),
          );
        return decorations.length ? DecorationSet.create(state.doc, decorations) : null;
      },
    },
  });
}
