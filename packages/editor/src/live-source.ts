import { $nodeSchema } from '@milkdown/kit/utils';

/** A temporary text block whose characters are the Markdown being edited. */
export const liveSource = $nodeSchema('tano_live_source', () => ({
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,
  attrs: {
    id: { default: '', validate: 'string' },
    origin: { default: '', validate: 'string' },
    level: { default: 0, validate: 'number' },
  },
  parseDOM: [{ tag: 'pre[data-tano-live-source]' }],
  toDOM: (node) => [
    'pre',
    {
      'data-tano-live-source': '',
      'data-source-kind': node.attrs.origin,
      'data-source-level': String(node.attrs.level),
      class: 'tano-live-source-block',
    },
    ['code', 0],
  ],
  parseMarkdown: {
    match: () => false,
    runner: () => undefined,
  },
  toMarkdown: {
    match: (node) => node.type.name === 'tano_live_source',
    runner: (state, node) => state.addNode('html', undefined, node.textContent),
  },
}));

/** An editable Markdown fragment that occupies only one formatted inline field. */
export const liveInlineSource = $nodeSchema('tano_live_source_inline', () => ({
  inline: true,
  group: 'inline',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,
  attrs: {
    id: { default: '', validate: 'string' },
    origin: { default: '', validate: 'string' },
  },
  parseDOM: [{ tag: 'span[data-tano-live-inline-source]' }],
  toDOM: () => [
    'span',
    { 'data-tano-live-inline-source': '', class: 'tano-live-source-inline' },
    0,
  ],
  parseMarkdown: {
    match: () => false,
    runner: () => undefined,
  },
  toMarkdown: {
    match: (node) => node.type.name === 'tano_live_source_inline',
    runner: (state, node) => state.addNode('html', undefined, node.textContent),
  },
}));
