import { Plugin, NodeSelection, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorState } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { refractor } from 'refractor';
import latex from 'refractor/latex';
import { sourceStyleRanges } from './source-highlight';
import { defaultCapabilities } from './runtime';
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

/** Position between adjacent fences, used when the user starts typing a body line. */
export function emptyFencedCodeBodyOffset(source: string): number | null {
  const opening = /^(`{3,}|~{3,})[^\n]*\n/.exec(source);
  if (!opening || source.indexOf('\n', opening[0].length) >= 0) return null;
  const closing = source.slice(opening[0].length).trim();
  return new RegExp(`^${opening[1]![0]}{${opening[1]!.length},}$`).test(closing)
    ? opening[0].length
    : null;
}

function editableSourceStyles(state: EditorState, features = defaultCapabilities.features): Decoration[] {
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
    for (const { from, to, style } of sourceStyleRanges(source, features)) {
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
              : ['highlight', 'underline', 'inline_comment'].includes(style)
                ? 2
                : ['superscript', 'subscript'].includes(style)
                  ? 1
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
export function liveMarkdown(enabled: () => boolean, readonly: () => boolean, features = () => defaultCapabilities.features) {
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
        const decorations = editableSourceStyles(state, features());
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
