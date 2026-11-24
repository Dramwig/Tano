import { expect, it } from 'vitest';
import { defaultCapabilities } from './runtime';
import { sourceSpacingPositions } from './source-spacing';

function complete(source: string, inserted: string, policy = defaultCapabilities) {
  const from = source.lastIndexOf(inserted);
  const positions = sourceSpacingPositions(source, from, from + inserted.length, policy);
  for (const at of positions.reverse()) source = source.slice(0, at) + ' ' + source.slice(at);
  return source;
}

it('adds spaces only beside the edited text and preserves Markdown spelling', () => {
  expect(complete('既有A1文\n\n中Tano2026年', 'Tano2026')).toBe('既有A1文\n\n中 Tano2026 年');
  expect(complete('中 **Word**文', '文')).toBe('中 **Word** 文');
  expect(complete('𠀀e\u0301文', 'e\u0301')).toBe('𠀀 e\u0301 文');
  expect(complete('中\u3000A B。年', 'A B')).toBe('中\u3000A B。年');
});

it.each(['$x+1$', '\\(x+1\\)', '[[页面A|标题B]]', '[[object://person/a82f91]]'])('spaces the outside of %s after completion', token => {
  const source = `中${token}文`;
  expect(complete(source, token.slice(-1))).toBe(`中 ${token} 文`);
});

it('keeps a workspace mention ID attached to its reference', () => {
  const token = '[[object://person/a82f91]]<!--tano:mention:abcd1234-->';
  expect(complete(`中${token}文`, '文')).toBe(`中${token} 文`);
});

it('skips code, frontmatter, URLs, unfinished syntax and disabled formulas', () => {
  const protectedText = [
    '---\nkey: 中A文\n---\n', '---\nkey: 中A文', '`中A文`',
    '> ```\n> 中A文\n> ```', '    中A文', '[链接](https://example.test/中A文)',
    '正文 [[中A文', '正文 $中A文', '正文 [链接](https://example.test/中A文',
  ];
  for (const source of protectedText) expect(complete(source, 'A')).toBe(source);
  const policy = { ...defaultCapabilities, features: { ...defaultCapabilities.features, math: false } };
  expect(complete('中$x$文', '$', policy)).toBe('中$x$文');
});
