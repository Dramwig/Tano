import { $inputRule, $nodeSchema, $remark } from '@milkdown/kit/utils';
import { markdownPolicy } from './runtime';
import { InputRule } from '@milkdown/kit/prose/inputrules';
import type { EditorState } from '@milkdown/kit/prose/state';
import { parseWikiLink, remarkWikiLinks } from './wiki-link-markdown';

export const wikiLinkRemark = $remark('tano-wiki-links', () => remarkWikiLinks);

export const wikiLink = $nodeSchema('tano_wiki_link', () => ({
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  attrs: {
    target: { default: '', validate: 'string' },
    label: { default: '', validate: 'string' },
    explicitLabel: { default: false, validate: 'boolean' },
  },
  parseDOM: [
    {
      tag: 'a[data-tano-wiki-target]',
      getAttrs: (dom) => {
        const link = dom as HTMLElement;
        return {
          target: link.dataset.tanoWikiTarget ?? '',
          label: link.textContent ?? '',
          explicitLabel: link.dataset.tanoWikiExplicitLabel === 'true',
        };
      },
    },
  ],
  toDOM: (node) => [
    'a',
    {
      href: '#',
      class: 'tano-wiki-link',
      'data-tano-wiki-target': node.attrs.target,
      'data-tano-wiki-explicit-label': String(node.attrs.explicitLabel),
      'data-markdown-source': `[[${node.attrs.target}${node.attrs.explicitLabel ? `|${node.attrs.label}` : ''}]]`,
    },
    node.attrs.label,
  ],
  parseMarkdown: {
    match: (node) => node.type === 'tanoWikiLink',
    runner: (state, node, type) => {
      state.addNode(type, {
        target: node.target,
        label: node.label,
        explicitLabel: node.explicitLabel,
      });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'tano_wiki_link',
    runner: (state, node) => {
      state.addNode('tanoWikiLink', undefined, undefined, {
        target: node.attrs.target,
        label: node.attrs.label,
        explicitLabel: node.attrs.explicitLabel,
      });
    },
  },
}));

function insideCode(state: EditorState, start: number, end: number) {
  let found = (state.storedMarks ?? state.doc.resolve(end).marks()).some(
    (mark) => mark.type.spec.code,
  );
  state.doc.nodesBetween(start, end, (node) => {
    if (node.marks.some((mark) => mark.type.spec.code)) found = true;
  });
  return found;
}

export const wikiLinkInput = $inputRule(
  (ctx) =>
    new InputRule(
      /\[\[([^\[\]\r\n]+)\]\]$/,
      (state, match, start, end) => {
        if (!markdownPolicy(ctx).features.wikiLink || insideCode(state, start, end)) return null;
        const preceding = state.doc.textBetween(Math.max(0, start - 2), start);
        if (preceding.endsWith('!') || preceding.endsWith('\\')) return null;
        const parsed = parseWikiLink(match[1]);
        if (!parsed) return null;
        return state.tr.replaceWith(start, end, wikiLink.type(ctx).create(parsed));
      },
      { inCodeMark: false },
    ),
);
