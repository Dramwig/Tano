import type { Node } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';

export interface SearchRange {
  from: number;
  to: number;
}
export interface PageSearchEditor {
  search(query: string, index?: number, scroll?: boolean): number;
  replaceSearch(
    query: string,
    replacement: string,
    index: number | 'all',
  ): { replaced: number; index: number };
  searchSelection(): string;
  focus(): void;
}

/** Literal, case-insensitive matches; regex indices keep original UTF-16 positions. */
export function textSearchRanges(text: string, query: string, offset = 0): SearchRange[] {
  if (!query) return [];
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  return Array.from(text.matchAll(pattern), (match) => ({
    from: offset + match.index,
    to: offset + match.index + match[0].length,
  }));
}

export function proseSearchRanges(doc: Node, query: string): SearchRange[] {
  if (!query) return [];
  const runs: { text: string; from: number }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const previous = runs.at(-1);
    if (previous && previous.from + previous.text.length === pos) previous.text += node.text;
    else runs.push({ text: node.text!, from: pos });
  });
  return runs.flatMap((run) => textSearchRanges(run.text, query, run.from));
}

interface PageSearchState {
  query: string;
  index: number;
  ranges: SearchRange[];
  decorations: DecorationSet;
}
export const pageSearchKey = new PluginKey<PageSearchState>('tano-page-search');

export function pageSearchPlugin(onDocumentChange = () => {}) {
  return new Plugin<PageSearchState>({
    key: pageSearchKey,
    state: {
      init: () => ({ query: '', index: 0, ranges: [], decorations: DecorationSet.empty }),
      apply(tr, previous) {
        const request = tr.getMeta(pageSearchKey) as { query: string; index: number } | undefined;
        if (!request && !tr.docChanged) return previous;
        const { query, index } = request ?? previous;
        const ranges =
          query === previous.query && !tr.docChanged
            ? previous.ranges
            : proseSearchRanges(tr.doc, query);
        return {
          query,
          index,
          ranges,
          decorations: DecorationSet.create(
            tr.doc,
            ranges.map(({ from, to }, i) =>
              Decoration.inline(from, to, {
                class: `tano-search-match${i === index ? ' tano-search-current' : ''}`,
              }),
            ),
          ),
        };
      },
    },
    props: { decorations: (state) => pageSearchKey.getState(state)?.decorations },
    view: () => ({
      update(view, previous) {
        if (!view.state.doc.eq(previous.doc) && pageSearchKey.getState(view.state)?.query)
          onDocumentChange();
      },
    }),
  });
}
