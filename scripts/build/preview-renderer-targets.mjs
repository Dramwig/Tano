export function blockTarget(command, value) {
  if (command === 'heading') return `.tano-prose h${value}`;
  if (command === 'callout') return `.tano-callout[data-callout-kind="${value === 'CUSTOM' ? 'custom' : 'note'}"]`;
  return {
    paragraph: '.tano-prose > p', 'object-reference': '.tano-reference-card', quote: '.tano-prose blockquote',
    list: '.tano-prose ul', 'ordered-list': '.tano-prose ol', 'todo-list': '.tano-prose li[data-item-type="task"]',
    'code-block': '.tano-code-block code', image: '.tano-prose img', table: '.tano-prose table',
    mermaid: '.tano-mermaid-preview svg', toggle: '.tano-toggle', file: '.tano-file .tano-resource-row',
    embed: '.tano-embed-preview img', tabs: '.tano-tabs .tano-tab-list', columns: '.tano-columns .tano-panel',
    'horizontal-rule': '.tano-prose hr', 'math-block': '.math-preview .katex',
  }[command];
}
export const capabilityTargets = {
  objectReferences: '.tano-reference-card', math: '.math-preview .katex', mermaid: '.tano-mermaid-preview svg',
  wikiLink: '.tano-wiki-link', callout: '.tano-callout', footnotes: 'sup[data-type="footnote_reference"]',
  embed: '.tano-embed-preview img', html: '.tano-prose strong', enhanced: '.tano-toggle',
  superscript: '.tano-prose sup', subscript: '.tano-prose sub', underline: '.tano-prose u',
  highlight: '.tano-prose mark', inlineComment: '[data-tano-comment]',
};
export const settingTargets = {
  mode: '.demo-after .tano-prose h2', copy: '.demo-after .tano-prose h2', reveal: '.demo-before [data-tano-live-source]',
  math: '.demo-after .tano-live-math-preview .katex', mermaid: '.demo-after .tano-live-mermaid-preview svg',
  folding: '.demo-after .tano-folded-heading-content', toolbar: '.demo-after .contextual-toolbar.editor-toolbar',
  wrapping: '.demo-after .cm-editor', spacing: '.demo-after .tano-prose', ai: '.demo-after .inline-assistant-input input',
  title: '.demo-after .document-title-input', properties: '.demo-after .frontmatter-panel[open] .frontmatter-property',
  discussion: '.demo-after .comment-conversation .comment-avatar', outline: '.demo-after .outline-marker',
  'outline-position': '.demo-after .outline-marker', recognition: '.demo-after .math-preview .katex',
  'math-syntax': '.demo-after .math-preview .katex', bullet: '.demo-after .tano-prose ul',
};
