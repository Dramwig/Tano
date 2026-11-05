import { describe, expect, it } from 'vitest';
import { IncrementalSourceHighlighter, sourceStyleRanges } from './source-highlight';
import { defaultCapabilities } from './runtime';

const paragraphs = Array.from({ length: 2000 }, (_, index) =>
  `## 标题 ${index}\n\n段落 ${index} 的 **粗体**、==高亮==、++下划线++、~下标~和 $x^2$。\n\n`).join('');

it('reparses a small window for typing, wrapping and undo in a long document', () => {
  const parser = new IncrementalSourceHighlighter();
  let text = paragraphs;
  expect(parser.update(text)).toEqual(sourceStyleRanges(text));
  const position = text.indexOf('段落 1000') + 8;
  for (const insert of ['字', '==新高亮==', '**新加粗**', '\n新行', '\n\n新段落']) {
    const next = text.slice(0, position) + insert + text.slice(position);
    expect(parser.update(next, undefined, [{ from: position, to: position, insert }])).toEqual(sourceStyleRanges(next));
    expect(parser.lastParsedCharacters).toBeLessThan(1000);
    expect(parser.update(text, undefined, [{ from: position, to: position + insert.length, insert: '' }])).toEqual(sourceStyleRanges(text));
    expect(parser.lastParsedCharacters).toBeLessThan(1000);
  }
}, 20000);

const examples = [
  '# Title\n\nordinary **bold** and ==highlight==\n\n---\n\nend',
  'before\n\n```md\n**literal**\n\n==literal==\n```\n\nafter\n\nlast',
  'before\n\n$$\nx^2\n\n+y\n$$\n\nafter\n\nlast',
  'before\n\n\\[\nx^2\n\n+y\n\\]\n\nafter\n\nlast',
  'before\n\n> quote\n>\n> - list\n>   continuation\n\nafter\n\nlast',
  'before\n\n- list\n\n  paragraph\n\n  - nested\n\nafter\n\nlast',
  'before\n\n    code\n\n    more code\n\nafter\n\nlast',
  'before\n\n<div>\n**raw html**\n\n</div>\n\nafter\n\nlast',
  'before\n\n<!-- comment\n\ncontent -->\n\nafter\n\nlast',
  'before\n\n| A | B |\n|---|---|\n| ==value== | **value** |\n\nafter\n\nlast',
  '---\ntitle: test\n---\n\n# Title\n\ntext\n\nlast',
  'before\n\n[label] and ![image][label]\n\n[label]: /one "title"\n\nafter\n\nlast',
  'before\n\n> [label]: /one\n\n[label]\n\nafter\n\nlast',
  'before\n\n[label]: /one\n\n[label]: /two\n\n[label]\n\nafter\n\nlast',
  'before\r\n\r\n==high== **bold**\r\n\r\nafter\r\n\r\nlast',
  'before\r\r==high== **bold**\r\rafter\r\rlast',
];

describe('incremental results match full parsing across structural edits', () => {
  it.each(examples)('handles %s', original => {
    const parser = new IncrementalSourceHighlighter();
    // Exercise both explicit change coordinates and coalesced worker snapshots.
    parser.update(original);
    for (const insert of ['x', '\n', '\n\n', '`', '```\n', '**', '==', '\\', '[new]: /target\n\n', '$$', '<!--']) {
      for (let position = 0; position <= original.length; position += 7) {
        const next = original.slice(0, position) + insert + original.slice(position);
        expect(parser.update(next, undefined, [{ from: position, to: position, insert }]), `${position}: ${insert}`)
          .toEqual(sourceStyleRanges(next));
        expect(parser.update(original)).toEqual(sourceStyleRanges(original));
      }
    }
    for (let position = 0; position < original.length; position += 3) {
      const next = original.slice(0, position) + original.slice(position + 5);
      expect(parser.update(next)).toEqual(sourceStyleRanges(next));
      expect(parser.update(original)).toEqual(sourceStyleRanges(original));
    }
  });
});

it('preserves distant references and invalidates them when nested definitions are removed', () => {
  const parser = new IncrementalSourceHighlighter();
  const original = `> [ref]: /target\n\n${paragraphs}\n[ref] and ![image][ref]\n`;
  parser.update(original);
  const next = original.replace('[ref] and', '==高亮== [ref] and');
  expect(parser.update(next)).toEqual(sourceStyleRanges(next));
  expect(parser.lastParsedCharacters).toBeLessThan(1000);
  const removed = next.replace('> [ref]: /target', '> ordinary');
  expect(parser.update(removed)).toEqual(sourceStyleRanges(removed));
});

it('handles multiple edits, capability changes and unchanged snapshots', () => {
  const parser = new IncrementalSourceHighlighter();
  const original = '==one==\n\n**two**\n\n==three==';
  parser.update(original);
  const next = '==ONE==\n\n**two**\n\n==THREE==';
  expect(parser.update(next, undefined, [{ from: 2, to: 5, insert: 'ONE' }, { from: 20, to: 25, insert: 'THREE' }]))
    .toEqual(sourceStyleRanges(next));
  const features = { ...defaultCapabilities.features, highlight: false };
  expect(parser.update(next, features)).toEqual(sourceStyleRanges(next, features));
  expect(parser.update(next, features)).toEqual(sourceStyleRanges(next, features));
  expect(parser.lastParsedCharacters).toBe(0);
});

it.each([
  '一段很长的正文包含连续的文字'.repeat(15000),
  '- 列表项目包含连续文字\n'.repeat(10000),
])('maps ordinary typing inside a large block without reparsing it', original => {
  const parser = new IncrementalSourceHighlighter();
  parser.update(original);
  const from = original.indexOf('连续', Math.floor(original.length / 2)) + 1;
  const text = original.slice(0, from) + '新增' + original.slice(from);
  expect(parser.update(text, undefined, [{ from, to: from, insert: '新增' }])).toEqual(sourceStyleRanges(text));
  expect(parser.lastParsedCharacters).toBe(0);
});

it('matches a full parse through a repeatable sequence of mixed edits', () => {
  const parser = new IncrementalSourceHighlighter();
  let text = examples.join('\n\n');
  parser.update(text);
  let seed = 42;
  const random = (limit: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % limit;
  };
  const inserts = ['', '文字', '\n', '\n\n', '```', '\\[', '\\]', '**', '==', '\n[ref]: /new\n', '>', '<!--', '-->'];
  for (let index = 0; index < 250; index++) {
    const from = random(text.length + 1);
    const to = Math.min(text.length, from + random(12));
    const insert = inserts[random(inserts.length)]!;
    text = text.slice(0, from) + insert + text.slice(to);
    expect(parser.update(text, undefined, [{ from, to, insert }]), `edit ${index} at ${from}`)
      .toEqual(sourceStyleRanges(text));
  }
});
