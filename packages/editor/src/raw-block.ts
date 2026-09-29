import { $nodeSchema, $remark } from '@milkdown/kit/utils';
import type { Plugin } from 'unified';
import type { Literal, Root } from 'mdast';
import { unsupportedMarkdown } from './syntax';

interface RawBlock extends Literal {
  type: 'tanoRawBlock';
  value: string;
}

declare module 'mdast' {
  interface RootContentMap {
    tanoRawBlock: RawBlock;
  }
}

/** Keep syntax the rich editor cannot model as one visible, byte-preserving block. */
const remarkRawBlocks: Plugin<[], Root> = () => (tree, file) => {
  const source = String(file.value);
  const documentIssues = unsupportedMarkdown(source).filter((issue) => issue !== '内嵌 HTML / MDX');
  if (!documentIssues.length) return;
  const covered = new Set<string>();
  tree.children = tree.children.map((node) => {
    if (!('position' in node) || !node.position) return node;
    const value = source.slice(node.position.start.offset, node.position.end.offset);
    const issues = unsupportedMarkdown(value).filter((issue) => issue !== '内嵌 HTML / MDX');
    if (!issues.length) return node;
    for (const issue of issues) covered.add(issue);
    return { type: 'tanoRawBlock', value, position: node.position };
  });
  // Some constructs, such as an unclosed frontmatter delimiter, only make
  // sense at document level. Keep the whole source if no single block owns it.
  if (documentIssues.some((issue) => !covered.has(issue)))
    tree.children = [{ type: 'tanoRawBlock', value: source }];
};

export const rawBlockRemark = $remark('tano-raw-blocks', () => remarkRawBlocks);
export const rawBlock = $nodeSchema('tano_raw_block', () => ({
  group: 'block',
  atom: true,
  attrs: { value: { default: '', validate: 'string' } },
  parseDOM: [
    {
      tag: '[data-type="tano-raw-block"]',
      getAttrs: (dom) => ({ value: dom.querySelector('pre')?.textContent ?? '' }),
    },
  ],
  toDOM: (node) => [
    'div',
    { 'data-type': 'tano-raw-block', class: 'tano-unsupported-block' },
    ['span', { class: 'tano-unsupported-label' }, '此块暂无法渲染，原文已保留'],
    ['pre', {}, node.attrs.value],
  ],
  parseMarkdown: {
    match: (node) => node.type === 'tanoRawBlock',
    runner: (state, node, type) => state.addNode(type, { value: node.value }),
  },
  toMarkdown: {
    match: (node) => node.type.name === 'tano_raw_block',
    runner: (state, node) => state.addNode('html', undefined, node.attrs.value),
  },
}));

export const rawBlocks = [rawBlockRemark, rawBlock].flat();
