// @vitest-environment jsdom
import { createApp, h } from 'vue';
import { expect, it } from 'vitest';
import MarkdownEditorSkeleton from './MarkdownEditorSkeleton.vue';

it.each([
  ['---\ntitle: Example\n---\n# Heading', true, true, 'h1'],
  ['---\ntitle: Example\n---\n## Heading', false, false, 'h2'],
  ['A paragraph', true, false, 'p'],
])('preserves editor metadata and first-block layout for %s', (modelValue, showDocumentProperties, properties, tag) => {
  const root = document.createElement('div');
  const app = createApp({ render: () => h(MarkdownEditorSkeleton, { modelValue, showDocumentProperties }) });
  app.mount(root);
  try {
    expect(!!root.querySelector('.frontmatter-panel')).toBe(properties);
    const body = root.querySelector('.milkdown-host')!;
    if (properties) expect(body.previousElementSibling?.className).toBe('frontmatter-panel');
    expect(body.querySelector('.tano-prose')?.firstElementChild?.tagName.toLowerCase()).toBe(tag);
    if (tag !== 'p') expect(body.querySelector('.skeleton-heading-mirror')?.textContent).toBe('Heading');
    expect(root.querySelector('.document-title')).toBeNull();
  } finally { app.unmount(); }
});
