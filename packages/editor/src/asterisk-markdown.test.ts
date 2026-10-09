import { afterAll, beforeAll, expect, it } from 'vitest';
import { parserCtx, serializerCtx } from '@milkdown/kit/core';
import { createHeadlessMarkdown } from './headless';

let codec: Awaited<ReturnType<typeof createHeadlessMarkdown>>;
beforeAll(async () => { codec = await createHeadlessMarkdown(); });
afterAll(async () => { await codec.destroy(); });

it.each(['正文*', '正文**', '2 * 3', '*.md', '**123123*', '***123123**', '*123123**'])(
  'keeps literal asterisks stable across Markdown saves: %s', source => {
    const saved = codec.normalize(`${source}\n`);
    expect(saved).toBe(`${source}\n`);
    expect(codec.normalize(saved)).toBe(saved);
  },
);

it.each([
  '****test****', '*****test*****', '******test******', '****test***',
  '____test____', '**outer **inner** outer**', '*outer *inner* outer*',
  '前文 ****test**** 后文 **normal**', '[****test****](https://example.test)',
])('preserves nested emphasis delimiters across repeated saves: %s', source => {
  let saved = `${source}\n`;
  for (let cycle = 0; cycle < 3; cycle++) {
    saved = codec.normalize(saved);
    expect(saved).toBe(`${source}\n`);
  }
});

it('preserves formatting, lists, code, math and link destinations', () => {
  const source = '*斜体* 和 **粗体**\n\n* 项目\n\n`\\*` 和 $a * b$\n\n```text\n\\* ** [x]\n```\n\n[链接](https://example.test/*.md)\n';
  const saved = codec.normalize(source);
  expect(saved).toBe(source);
  expect(codec.normalize(saved)).toBe(saved);
});

it('still escapes other Markdown syntax and literal backslashes', () => {
  codec.withContext(ctx => {
    const parsed = ctx.get(parserCtx)('正文')!;
    const source = '[链接] _文字_ `代码` \\*';
    const doc = parsed.type.create(null, parsed.firstChild!.type.create(null, parsed.type.schema.text(source)));
    const saved = ctx.get(serializerCtx)(doc);
    expect(saved).toContain('\\[链接]');
    expect(saved).toContain('\\_文字\\_');
    expect(saved).toContain('\\`代码\\`');
    expect(saved).toContain('\\\\*');
    expect(ctx.get(parserCtx)(saved)!.eq(doc)).toBe(true);
  });
});

it.each(['\\**文字*', '*文字*\\*', '**\\*文字**', '**文字\\***'])(
  'keeps literal stars distinct from adjacent formatting: %s', source => {
    const saved = codec.normalize(`${source}\n`);
    codec.withContext(ctx => {
      expect(ctx.get(parserCtx)(saved)!.eq(ctx.get(parserCtx)(source)!)).toBe(true);
    });
  },
);
