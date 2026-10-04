import { parserCtx } from '@milkdown/kit/core';
import { describe, expect, it } from 'vitest';
import { createHeadlessMarkdown } from './headless';

describe('quoted paragraph and block boundaries', () => {
  it.each([
    { marker: '[!NOT]', between: '' },
    { marker: '\\[!NOT]', between: '' },
    { marker: '\\[!NOT]', between: '正文。\n\n' },
  ])('keeps blocks after $marker separate (intervening prose: $between)', async ({ marker, between }) => {
    const source = `> ${marker}\n> 普通说明，包含 **强调**。\n>\n> 123\n\n${between}> [!TIP]\n> 操作建议。\n\n> [!IMPORTANT]\n> 重要信息。\n\n> [!WARNING]\n> 警告信息。\n\n> [!CAUTION]\n> 谨慎操作。\n\n最后的正文。\n`;
    const codec = await createHeadlessMarkdown();
    try {
      const parse = (markdown: string) => codec.withContext(ctx => ctx.get(parserCtx)(markdown)!);
      const doc = parse(source);
      const types: string[] = [];
      doc.forEach(node => types.push(node.type.name));
      expect(types).toEqual(['blockquote', ...(between ? ['paragraph'] : []), 'blockquote', 'blockquote', 'blockquote', 'blockquote', 'paragraph']);
      expect(doc.firstChild!.childCount).toBe(2);
      expect(doc.firstChild!.firstChild!.child(1).type.name).toBe('hardbreak');
      expect(doc.firstChild!.firstChild!.child(1).attrs.isInline).toBe(true);
      expect(doc.firstChild!.lastChild!.textContent).toBe('123');
      expect(parse(codec.normalize(source)).eq(doc)).toBe(true);
    } finally {
      await codec.destroy();
    }
  });

  it.each([
    '> \\[\n> 未闭合的公式\n\n正文。\n\n\\[\nx^2\n\\]\n',
    '- \\[!NOT]\n  列表内容。\n\n正文。\n\n\\[\nx^2\n\\]\n',
  ])('does not use a later formula to close escaped brackets in another container', async (source) => {
    const codec = await createHeadlessMarkdown();
    try {
      const doc = codec.withContext(ctx => ctx.get(parserCtx)(source)!);
      expect(doc.childCount).toBe(3);
      expect(doc.child(1).type.name).toBe('paragraph');
      expect(doc.lastChild!.type.name).toBe('math_block');
      expect(doc.lastChild!.attrs.value).toBe('x^2');
    } finally {
      await codec.destroy();
    }
  });
});
