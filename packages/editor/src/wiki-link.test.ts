import { describe, expect, it } from 'vitest';
import { createHeadlessMarkdown } from './headless';
import { unsupportedMarkdown } from './syntax';

describe('wiki links', () => {
  it('keeps forward-link syntax through rich-editor normalization', async () => {
    const markdown =
      '---\ntype: reference\n---\n\nSee [[Note]], [[Notes/Plan|计划]], and [[Note#标题]].\n';
    expect(unsupportedMarkdown(markdown)).toEqual([]);
    const codec = await createHeadlessMarkdown();
    try {
      expect(codec.normalize(markdown)).toBe(markdown);
    } finally {
      await codec.destroy();
    }
  });

  it('keeps unsupported embeds in source mode and ignores code examples', () => {
    expect(unsupportedMarkdown('![[picture.png]]')).toContain('尚不支持的双向链接写法');
    expect(unsupportedMarkdown('`[[Example]]`\n\n```md\n[[Example]]\n```')).toEqual([]);
  });
});
