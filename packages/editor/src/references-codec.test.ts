import { expect, it } from 'vitest';
import { createHeadlessMarkdown } from './headless';
it('leaves unsupported legacy links and code examples as ordinary Markdown', async () => {
  const codec = await createHeadlessMarkdown();
  try {
    const legacy =
      '[@_INDEX](object://old/document/c72bb3)\n\n[Alice](object://old/person/a82f91 "tano:object-card")\n\n`object://old/document/c72bb3`\n';
    const normalized = codec.normalize(legacy);
    expect(normalized).toContain('(object://old/document/c72bb3)');
    expect(normalized).toContain('(object://old/person/a82f91 "tano:object-card")');
    expect(normalized).toContain('`object://old/document/c72bb3`');
    expect(codec.normalize(normalized)).toBe(normalized);
  } finally {
    await codec.destroy();
  }
});
it('round trips inline and card references through Markdown and containers', async () => {
  const codec = await createHeadlessMarkdown();
  const source =
    'Meeting [@Alice](object://person/a82f91).\n\n[Alice](object://database/b91af2 "tano:object-card")\n\n<details>\n<summary>More</summary>\n\n[@SWAT](object://document/c72bb3)\n\n</details>\n';
  try {
    const normalized = codec.normalize(source);
    expect(normalized).toContain('[@Alice](object://person/a82f91)');
    expect(normalized).toContain('[Alice](object://database/b91af2 "tano:object-card")');
    expect(normalized).toContain('[@SWAT](object://document/c72bb3)');
    expect(codec.normalize(normalized)).toBe(normalized);
  } finally {
    await codec.destroy();
  }
});
it('preserves event, asset and unavailable plugin references through the shared codec', async () => {
  const codec = await createHeadlessMarkdown();
  const source =
    '[@会议](object://event/a00001) [@figure.png](object://asset/a00002)\n\n[论文](object://ai.paper/a00003 "tano:object-card")\n\n[@旧数据集](object://dataset/a00004)\n';
  try {
    const normalized = codec.normalize(source);
    for (const url of [
      'object://event/a00001',
      'object://asset/a00002',
      'object://ai.paper/a00003',
      'object://dataset/a00004',
    ])
      expect(normalized).toContain(url);
    expect(codec.normalize(normalized)).toBe(normalized);
  } finally {
    await codec.destroy();
  }
});
