import { afterAll, beforeAll, expect, it } from 'vitest';
import { parserCtx, serializerCtx } from '@milkdown/kit/core';
import { createHeadlessMarkdown } from './headless';
import { markdownPositionMap } from './mode-selection';
import { splitFrontmatter } from './syntax';

let codec: Awaited<ReturnType<typeof createHeadlessMarkdown>>;
beforeAll(async () => { codec = await createHeadlessMarkdown(); });
afterAll(async () => { await codec.destroy(); });

it.each([
  ['第一段重复\n\n第二段重复\n\n第三段重复\n', '第二段重复', 3],
  ['# 标题\n\n正文 **加粗文字** 和 [链接文字](https://example.com)\n', '加粗文字', 2],
  ['# 标题\n\n正文 **加粗文字** 和 [链接文字](https://example.com)\n', '链接文字', 2],
  ['- 第一项\n  - 嵌套列表文字\n\n> 引用文字\n', '嵌套列表文字', 3],
  ['- 第一项\n  - 嵌套列表文字\n\n> 引用文字\n', '引用文字', 2],
  ['```ts\nconst example = 123;\nsecond line\n```\n', 'second line', 4],
  ['| 第一列 | 第二列 |\n| --- | --- |\n| 重复文字 | 目标文字 |\n', '目标文字', 2],
  ['---\r\ntitle: 属性\r\n---\r\n\r\n第一段\r\n\r\n目标文字😀\r\n', '目标文字😀', 6],
  ['文字 \\[转义\\] &amp; 后续内容\n', '后续内容', 2],
])('maps a caret in %j through both editor representations', (markdown, text, offset) => {
  const { prefix, body } = splitFrontmatter(markdown);
  codec.withContext(ctx => {
    const doc = ctx.get(parserCtx)(body)!;
    const map = markdownPositionMap(doc, markdown, doc => prefix + ctx.get(serializerCtx)(doc));
    const sourceOffset = markdown.replace(/\r\n/g, '\n').indexOf(text) + Number(offset);
    const prose = map.toProse(sourceOffset);
    expect(map.toSource(prose)).toBe(sourceOffset);
    expect(doc.textBetween(Math.max(0, prose - Number(offset)), prose)).toBe(text.slice(0, Number(offset)));
  });
});

it('maps empty paragraphs and active inline Markdown without changing the document', () => {
  codec.withContext(ctx => {
    const parsed = ctx.get(parserCtx)('before\n\nafter\n')!;
    const schema = parsed.type.schema;
    const live = schema.nodes.tano_live_source_inline!.create(null, schema.text('**重复文字**'));
    const doc = schema.topNodeType.create(null, [
      schema.nodes.paragraph!.create(),
      schema.nodes.paragraph!.create(null, [schema.text('before '), live, schema.text(' after')]),
    ]);
    const serialize = ctx.get(serializerCtx);
    const markdown = serialize(doc);
    const before = doc.toJSON();
    const map = markdownPositionMap(doc, markdown, serialize);
    const at = markdown.indexOf('重复文字') + 2;
    expect(map.toSource(map.toProse(at))).toBe(at);
    expect(map.toProse(map.toSource(1))).toBe(1);
    expect(doc.toJSON()).toEqual(before);
  });
});
