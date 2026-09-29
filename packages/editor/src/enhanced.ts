import { $nodeSchema, $remark } from '@milkdown/kit/utils';
import { remarkEnhanced } from './enhanced-markdown';
import type { EnhancedKind } from './enhanced-markdown';

export const enhancedRemark = $remark('tano-enhanced', () => remarkEnhanced);
const kinds: EnhancedKind[] = ['toggle', 'tabs', 'columns', 'panel', 'file', 'embed'];
export const enhancedNodes = kinds
  .map((kind) =>
    $nodeSchema(`tano_${kind}`, () => ({
      group: kind === 'panel' ? 'tano_panel' : 'block',
      content:
        kind === 'tabs' || kind === 'columns'
          ? 'tano_panel+'
          : kind === 'toggle' || kind === 'panel'
            ? 'block+'
            : '',
      atom: kind === 'file' || kind === 'embed',
      isolating: true,
      defining: true,
      attrs: {
        title: { default: '', validate: 'string' },
        url: { default: '', validate: 'string' },
      },
      parseDOM: [
        {
          tag: `[data-tano-enhanced="${kind}"]`,
          getAttrs: (dom) => ({
            title: dom.getAttribute('data-title') ?? '',
            url: dom.getAttribute('data-url') ?? '',
          }),
          contentElement: '.tano-enhanced-content',
        },
      ],
      toDOM: (node) =>
        [
          'section',
          {
            'data-tano-enhanced': kind,
            'data-feature-level': '1',
            'data-title': node.attrs.title,
            'data-url': node.attrs.url,
          },
          ...(kind === 'file' || kind === 'embed'
            ? [['span', node.attrs.title]]
            : [['div', { class: 'tano-enhanced-content' }, 0]]),
        ] as import('@milkdown/kit/prose/model').DOMOutputSpec,
      parseMarkdown: {
        match: (node) => node.type === 'tanoEnhanced' && node.kind === kind,
        runner: (state, node, type) => {
          state.openNode(type, { title: node.title, url: node.url });
          if (node.children?.length) state.next(node.children);
          state.closeNode();
        },
      },
      toMarkdown: {
        match: (node) => node.type.name === `tano_${kind}`,
        runner: (state, node) => {
          state.openNode('tanoEnhanced', undefined, {
            kind,
            title: node.attrs.title,
            url: node.attrs.url,
          });
          if (kind === 'file' || kind === 'embed') {
            state.openNode('paragraph');
            state.openNode('link', undefined, { url: node.attrs.url });
            state.addNode('text', undefined, node.attrs.title || node.attrs.url);
            state.closeNode();
            state.closeNode();
          } else state.next(node.content);
          state.closeNode();
        },
      },
    })),
  )
  .flat();
export const enhanced = [enhancedRemark, ...enhancedNodes].flat();
