import { describe, expect, it } from 'vitest';
import { createHeadlessMarkdown } from './headless';
import { unsupportedMarkdown } from './syntax';

const example =
  '**粗体**、*斜体*、~~删除线~~、`代码`、<u>下划线</u>、x<sup>2</sup>、H<sub>2</sub>O、<mark>高亮</mark>、<span style="color: #db2777">粉色</span>。\n';

describe('portable Markdown text styles', () => {
  it('keeps editor-generated empty paragraphs in rich text mode', async () => {
    const input = '# 新建文档 8\n\n<br />\n\n<br />\n\n正文\n';
    expect(unsupportedMarkdown(input)).toEqual([]);
    expect(unsupportedMarkdown('# 新建文档 8\n\n<br />\n')).toEqual([]);
    expect(unsupportedMarkdown('> 引用\n>\n> <br />\n>\n> 正文\n')).toEqual([]);
    expect(unsupportedMarkdown('- 第一行\n  \n  <br />\n  \n  下一行\n')).toEqual([]);
    expect(unsupportedMarkdown('文字<br />下一行\n')).toContain('内嵌 HTML / MDX');
    expect(unsupportedMarkdown('文字\n<br />\n')).toContain('内嵌 HTML / MDX');
    expect(unsupportedMarkdown('<br onclick="alert(1)" />\n')).toContain('内嵌 HTML / MDX');

    const codec = await createHeadlessMarkdown();
    try {
      const normalized = codec.normalize(input);
      expect(normalized).toBe(input);
    } finally {
      await codec.destroy();
    }
  });

  it('round trips every style and combined Markdown through the shared Markdown codec', async () => {
    const codec = await createHeadlessMarkdown();
    const input =
      example +
      '\n<u>普通 **加粗** 和 *斜体*</u>、<mark><span style="color: #2563eb">蓝色高亮</span></mark>。\n';
    try {
      expect(unsupportedMarkdown(input)).toEqual([]);
      const normalized = codec.normalize(input);
      expect(normalized).toContain('<u>普通 **加粗** 和 *斜体*</u>');
      expect(normalized).toContain('<mark><span style="color: #2563eb">蓝色高亮</span></mark>');
      expect(normalized).toContain('<sup>2</sup>');
      expect(normalized).toContain('<sub>2</sub>');
      expect(normalized).toContain('~~删除线~~');
      expect(codec.normalize(normalized)).toBe(normalized);
    } finally {
      await codec.destroy();
    }
  });

  it('supports styles in headings, links, lists and GFM table cells', async () => {
    const codec = await createHeadlessMarkdown();
    const input =
      '# <u>标题</u>\n\n- <mark>[链接](https://example.test)</mark>\n\n| 列 |\n| - |\n| <span style="color: #abc">单元格</span> |\n';
    try {
      const normalized = codec.normalize(input);
      expect(normalized).toContain('# <u>标题</u>');
      expect(normalized).toContain('[<mark>链接</mark>](https://example.test)');
      expect(normalized).toContain('<span style="color: #aabbcc">单元格</span>');
      expect(codec.normalize(normalized)).toBe(normalized);
    } finally {
      await codec.destroy();
    }
  });

  it.each([
    '<script>alert(1)</script>',
    '<Widget {...props} />',
    '<u onclick="alert(1)">文字</u>',
    '<span style="color: red; background:url(https://example.test)">文字</span>',
    '<span style="color: #abc" onmouseover="alert(1)">文字</span>',
    '<mark id="custom">文字</mark>',
    '<u>未闭合',
    '<u><mark>错误嵌套</u></mark>',
    '<u>**交叉标签</u>**',
    '<u>\n\n跨段落\n\n</u>',
  ])('detects HTML that cannot enter collaboration: %s', (input) => {
    expect(unsupportedMarkdown(input)).toContain('内嵌 HTML / MDX');
  });

  it('keeps literal examples and LaTeX outside HTML style parsing', async () => {
    const input =
      '`<u>示例</u>`\n\n```html\n<script>code</script>\n```\n\n$\\text{<tag>}$\n\n\\<mark>字面量\\</mark>\n';
    expect(unsupportedMarkdown(input)).toEqual([]);
    const codec = await createHeadlessMarkdown();
    try {
      const normalized = codec.normalize(input);
      expect(normalized).toContain('`<u>示例</u>`');
      expect(normalized).toContain('<script>code</script>');
      expect(normalized).toContain('$\\text{<tag>}$');
    } finally {
      await codec.destroy();
    }
  });
});
