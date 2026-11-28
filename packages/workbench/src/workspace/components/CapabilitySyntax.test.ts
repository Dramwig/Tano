// @vitest-environment jsdom
import { createApp, h } from 'vue';
import { expect, it } from 'vitest';
import { featureDefinitions } from '@tano/editor/runtime';
import CapabilitySyntax from './CapabilitySyntax.vue';

it('renders multiline syntax examples with SVG break icons instead of fallback-triggering Unicode arrows', () => {
  for (const feature of featureDefinitions) {
    const host = document.createElement('div');
    document.body.append(host);
    const app = createApp({ render: () => h(CapabilitySyntax, { feature: feature.key }) });
    try {
      app.mount(host);
      const code = host.querySelector('code.capability-syntax')!;
      expect(code.textContent?.trim()).not.toBe('');
      expect(code.textContent).not.toMatch(/[↵⏎↩]/);
      if (['mermaid', 'callout', 'footnotes', 'embed', 'enhanced'].includes(feature.key)) {
        expect(code.querySelectorAll('svg.capability-syntax-break').length).toBeGreaterThan(0);
      }
    } finally {
      app.unmount();
      host.remove();
    }
  }
});
