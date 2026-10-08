import { expect, it } from 'vitest';
import { parserCtx } from '@milkdown/kit/core';
import { createHeadlessMarkdown } from './headless';
import { defaultCapabilities, parseCapabilities } from './runtime';
import type { BulletListMarker } from './runtime';

it.each<BulletListMarker>(['-', '+', '*'])('writes %s for nested lists and tasks while keeping ordered lists and code', async marker => {
  const codec = await createHeadlessMarkdown({ ...defaultCapabilities, bulletListMarker: marker });
  const source = '- Parent\n  - Child\n- [ ] Todo\n- [x] Done\n\n3. Third\n4. Fourth\n\n```md\n- Literal\n+ Literal\n* Literal\n```\n';
  try {
    const saved = codec.normalize(source);
    expect(saved).toContain(`${marker} Parent\n  ${marker} Child\n${marker} [ ] Todo\n${marker} [x] Done\n`);
    expect(saved).toContain('3. Third\n4. Fourth\n');
    expect(saved).toContain('```md\n- Literal\n+ Literal\n* Literal\n```\n');
    expect(codec.normalize(saved)).toBe(saved);
    codec.withContext(ctx => {
      expect(ctx.get(parserCtx)(saved)!.eq(ctx.get(parserCtx)(source)!)).toBe(true);
    });
  } finally {
    await codec.destroy();
  }
});

it('retains separate adjacent lists when the preferred marker would join them', async () => {
  const codec = await createHeadlessMarkdown({ ...defaultCapabilities, bulletListMarker: '-' });
  const source = '- First\n\n+ Second\n';
  try {
    const saved = codec.normalize(source);
    codec.withContext(ctx => {
      expect(ctx.get(parserCtx)(saved)!.childCount).toBe(2);
      expect(ctx.get(parserCtx)(saved)!.eq(ctx.get(parserCtx)(source)!)).toBe(true);
    });
    expect(codec.normalize(saved)).toBe(saved);
  } finally {
    await codec.destroy();
  }
});

it('reads changed policy on the next serialization and isolates different workspace codecs', async () => {
  const policy = { ...defaultCapabilities };
  const first = await createHeadlessMarkdown(policy);
  const second = await createHeadlessMarkdown({ ...defaultCapabilities, bulletListMarker: '+' });
  try {
    expect(first.normalize('- Item\n')).toBe('* Item\n');
    policy.bulletListMarker = '-';
    expect(first.normalize('* Item\n')).toBe('- Item\n');
    expect(second.normalize('* Item\n')).toBe('+ Item\n');
  } finally {
    await second.destroy();
    await first.destroy();
  }
});

it('loads older workspace rules with the existing output default and rejects invalid markers', () => {
  expect(parseCapabilities('{"mathSyntax":"latex"}').bulletListMarker).toBe('*');
  for (const marker of ['x', true, ['-'], {}]) {
    expect(() => parseCapabilities(JSON.stringify({ bulletListMarker: marker })))
      .toThrow('未知的无序列表标记');
  }
});
