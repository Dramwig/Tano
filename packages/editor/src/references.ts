import { $nodeSchema, $remark } from '@milkdown/kit/utils';
import type { Nodes, Parent, Root } from 'mdast';
import type { Plugin } from 'unified';
import { parseReferenceUrl, referenceUrl } from '@tano/protocol';

interface ReferenceNode extends Parent {
  type: 'tanoReference';
  url: string;
  label: string;
  card: boolean;
  children: [];
}
declare module 'mdast' {
  interface RootContentMap {
    tanoReference: ReferenceNode;
  }
  interface PhrasingContentMap {
    tanoReference: ReferenceNode;
  }
}
const remarkReferences: Plugin<[], Root> = () => (tree) => {
  function visit(node: Nodes) {
    if (!('children' in node) || node.type === 'link') return;
    node.children = node.children.map((child) => {
      const identity = child.type === 'link' ? parseReferenceUrl(child.url) : null;
      if (
        child.type === 'link' &&
        identity &&
        child.children.every((part) => part.type === 'text')
      ) {
        const label = child.children
          .map((part) => ('value' in part ? part.value : ''))
          .join('')
          .replace(/^@/, '');
        return {
          type: 'tanoReference',
          url: referenceUrl(identity),
          label,
          card:
            child.title === 'tano:object-card' &&
            node.type === 'paragraph' &&
            node.children.length === 1,
          children: [],
        } as ReferenceNode;
      }
      visit(child);
      if (
        child.type === 'paragraph' &&
        child.children.length === 1 &&
        child.children[0]?.type === 'tanoReference' &&
        child.children[0].card
      )
        return child.children[0];
      return child;
    }) as typeof node.children;
  }
  visit(tree);
};
export const referenceRemark = $remark('tano-references', () => remarkReferences);
function referenceSchema(block: boolean) {
  const name = block ? 'tano_reference_block' : 'tano_reference';
  return $nodeSchema(name, () => ({
    group: block ? 'block' : 'inline',
    inline: !block,
    atom: true,
    selectable: true,
    attrs: { url: { default: '', validate: 'string' }, label: { default: '', validate: 'string' } },
    parseDOM: [
      {
        tag: `[data-tano-reference="${block ? 'block' : 'inline'}"]`,
        getAttrs: (dom) => {
          const url = dom.getAttribute('data-reference-url') ?? '';
          const identity = parseReferenceUrl(url);
          return identity
            ? { url: referenceUrl(identity), label: dom.getAttribute('data-reference-label') ?? '' }
            : false;
        },
      },
    ],
    toDOM: (node) => [
      block ? 'div' : 'span',
      {
        'data-tano-reference': block ? 'block' : 'inline',
        'data-reference-url': node.attrs.url,
        'data-reference-label': node.attrs.label,
        'data-feature-level': '2',
      },
      `@${node.attrs.label}`,
    ],
    parseMarkdown: {
      match: (node) => node.type === 'tanoReference' && node.card === block,
      runner: (state, node, type) => state.addNode(type, { url: node.url, label: node.label }),
    },
    toMarkdown: {
      match: (node) => node.type.name === name,
      runner: (state, node) => {
        const identity = parseReferenceUrl(node.attrs.url);
        if (block) state.openNode('paragraph');
        state.openNode('link', undefined, {
          url: identity ? referenceUrl(identity) : node.attrs.url,
          ...(block ? { title: 'tano:object-card' } : {}),
        });
        state.addNode('text', undefined, `${block ? '' : '@'}${node.attrs.label}`);
        state.closeNode();
        if (block) state.closeNode();
      },
    },
  }));
}
export const referenceInline = referenceSchema(false);
export const referenceBlock = referenceSchema(true);
export const references = [referenceRemark, referenceInline, referenceBlock].flat();
