import { describe, expect, it } from 'vitest';
import { createHeadlessMarkdown } from './headless';
import { defaultCapabilities } from './runtime';
import { sourceStyleRanges } from './source-highlight';

async function normalize(source: string, syntax: 'preserve' | 'dollar' | 'latex' = 'preserve') {
  const codec = await createHeadlessMarkdown({ ...defaultCapabilities, mathSyntax: syntax });
  try {
    return codec.normalize(source);
  } finally {
    await codec.destroy();
  }
}
describe('math syntax adapters', () => {
  it.each([
    '公式 $x^2$ 和 \\(y_1 + y_2\\)。\n',
    '$$\nx^2\n$$\n',
    '\\[\nx^2\n\\]\n',
    '\\[\n\nx^2\n\n\\]\n',
    '\\[x^2\\]\n',
    '公式 $$ x + y $$。\n',
    '**公式 \\(a_b * c\\)**\n',
    '公式 \\(\\text{[[note]]} <span>\\)。\n',
  ])('preserves the original math spelling: %s', async (source) => {
    expect(await normalize(source)).toBe(source);
  });
  it('converts both directions only under explicit serialization policy', async () => {
    expect(await normalize('公式 \\(x^2\\)。\n\n\\[\ny\n\\]\n', 'dollar')).toBe(
      '公式 $x^2$。\n\n$$\ny\n$$\n',
    );
    expect(await normalize('公式 $x^2$。\n\n$$\ny\n$$\n', 'latex')).toBe(
      '公式 \\(x^2\\)。\n\n\\[\ny\n\\]\n',
    );
  });
  it('leaves code and escaped delimiters alone', async () => {
    const source = '`\\(x\\)`\n\n```latex\n\\[\nx\n\\]\n```\n\n\\\\(x\\\\)\n';
    const result = await normalize(source);
    expect(result).toContain('`\\(x\\)`');
    expect(result).toContain('```latex\n\\[\nx\n\\]\n```');
    expect(result).toContain('\\\\(x\\\\)');
  });
  it('keeps math inside nested containers stable across repeated saves', async () => {
    const source = '> \\[\n> x^2\n> \\]\n\n- 公式 \\(x\\)\n';
    const first = await normalize(source);
    expect(await normalize(first)).toBe(first);
    expect(first).toContain('> x^2');
  });
  it('highlights both kinds of delimiters without treating LaTeX as Markdown', () => {
    const source = '\\(x_a * y\\)\n\n\\[\nx\n\\]';
    expect(sourceStyleRanges(source).filter((range) => range.style === 'math')).toHaveLength(2);
  });
  it('keeps disabled features in the server codec and preserves wiki syntax', async () => {
    const codec = await createHeadlessMarkdown({
      ...defaultCapabilities,
      features: { ...defaultCapabilities.features, math: false, wikiLink: false },
    });
    try {
      expect(codec.normalize('公式 \\(x\\) 和 [[目录/文档|标题]]\n')).toBe(
        '公式 \\(x\\) 和 [[目录/文档|标题]]\n',
      );
    } finally {
      await codec.destroy();
    }
  });
});
