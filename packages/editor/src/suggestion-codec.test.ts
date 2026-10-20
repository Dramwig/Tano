import { describe, expect, it, vi } from 'vitest';
import { parserCtx, serializerCtx } from '@milkdown/kit/core';
import type { Node } from '@milkdown/kit/prose/model';
import { createHeadlessMarkdown } from './headless';
import { SuggestionChangeCodec } from './suggestion-codec';

describe('SuggestionChangeCodec', () => {
  it('preserves real Markdown equivalence while reusing the preceding mapped revision', async () => {
    const editor = await createHeadlessMarkdown();
    try {
      editor.withContext(ctx => {
        const parse = vi.fn(ctx.get(parserCtx)), serialize = ctx.get(serializerCtx);
        const cache = new SuggestionChangeCodec<Node>();
        const map = (previous: string, current: string, mapped: string) => cache.map({
          previous, current, prefix: '', parse, serialize, stableSerialize: serialize, transform: () => mapped,
        });
        expect(map('old\n', 'new\n', 'new')).toBe('new');
        expect(parse).toHaveBeenCalledTimes(3);
        parse.mockClear();
        expect(map('new', 'newer\n', 'newer')).toBe('newer');
        expect(parse).toHaveBeenCalledTimes(2);
        expect(() => map('newer', '**safe**\n', 'different text\n')).toThrow('无法精确映射');
        cache.clear();
        parse.mockClear();
        expect(map('before\n', 'after\n', 'after\n')).toBe('after\n');
        expect(parse).toHaveBeenCalledTimes(1);
      });
    } finally { await editor.destroy(); }
  });

  it('bounds retained revisions and does not cache invalid parses', () => {
    const parse = vi.fn((body: string) => body === 'invalid' ? null : { body });
    const serialize = (node: { body: string }) => node.body;
    const cache = new SuggestionChangeCodec<{ body: string }>(1, 10);
    const map = (previous: string) => cache.map({
      previous, current: 'next', prefix: '', parse, serialize, stableSerialize: serialize, transform: () => 'next',
    });
    map('one'); map('two'); map('one');
    expect(parse).toHaveBeenCalledTimes(3);
    map('long document beyond budget'); map('long document beyond budget');
    expect(parse).toHaveBeenCalledTimes(5);
    expect(() => map('invalid')).toThrow('无法解析建议基线');
    expect(() => map('invalid')).toThrow('无法解析建议基线');
    expect(parse).toHaveBeenCalledTimes(7);
  });
});
