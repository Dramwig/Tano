import { describe, expect, it } from 'vitest';
import { enhancedRegions, safeResourceUrl, splitPanels } from './enhanced-markdown';
import { unsupportedMarkdown } from './syntax';

describe('enhanced Markdown boundaries', () => {
  it.each([
    ':::tabs\n\n## One\n\ncontent',
    '::::tabs\n\n## One\n\ncontent\n\n:::',
    ':::tabs type=warning\n\n## One\n\ncontent\n\n:::',
    ':::tabs\n\ncontent before a heading\n\n## One\n\ncontent\n\n:::',
    ':::unknown\n\ncontent\n\n:::',
  ])('keeps malformed or unknown syntax in the compatibility guard: %s', (source) => {
    expect(enhancedRegions(source)).toEqual([]);
    expect(unsupportedMarkdown(source)).toContain('自定义指令块');
  });
  it('never treats fenced examples as containers or tab boundaries', () => {
    expect(enhancedRegions('```md\n:::tabs\n## One\ncontent\n:::\n```')).toEqual([]);
    expect(
      splitPanels('## One\n\n~~~md\n## Example\n~~~\n\n## Two\n\ntext')?.map(
        (panel) => panel.title,
      ),
    ).toEqual(['One', 'Two']);
  });
  it('recognizes nested toggles and protects headings inside nested containers', () => {
    const body =
      '## One\n\n<details>\n<summary>Details</summary>\n\n## Nested heading\n\n</details>\n\n## Two\n\ntext';
    expect(splitPanels(body)?.map((panel) => panel.title)).toEqual(['One', 'Two']);
    expect(unsupportedMarkdown(`:::tabs\n\n${body}\n\n:::`)).toEqual([]);
  });
  it.each([
    'javascript:alert(1)',
    'data:text/html,bad',
    'file:///C:/private',
    '//example.com/a',
    'https://user:password@example.com/a',
    'https://',
    'assets/a\nb.png',
  ])('rejects unsafe resource URLs: %s', (url) => {
    expect(safeResourceUrl(url)).toBe(false);
  });
  it.each([
    'assets/论文%20笔记.pdf',
    '../assets/a.png',
    'https://example.com/a.png',
    'http://localhost:1421/a.mp4',
  ])('allows portable resource references: %s', (url) => {
    expect(safeResourceUrl(url)).toBe(true);
  });
});
