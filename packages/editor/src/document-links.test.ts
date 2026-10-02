import { expect, it } from 'vitest';
import { documentLinks, documentLinkDetails, referenceInsertionPoint } from './document-links';

it('extracts Markdown, reference-style, wiki and embedded document links', () => {
  expect(
    documentLinks(
      '[Page](notes/page.md#title) [ref][ID] [[Other#Heading|别名]] ![[Embedded]] ![asset](photo.png)\n\n[id]: <target file.md>',
    ),
  ).toEqual([
    { kind: 'markdown', target: 'notes/page.md#title' },
    { kind: 'markdown', target: 'target file.md' },
    { kind: 'wiki', target: 'Other#Heading' },
    { kind: 'wiki', target: 'Embedded' },
    { kind: 'markdown', target: 'photo.png' },
  ]);
});

it('ignores examples in code, math, comments, escaped brackets and frontmatter', () => {
  const source = [
    '---',
    'example: "[[metadata]]"',
    '---',
    '`[[inline]]`',
    '```md',
    '[[fenced]] [code](hidden.md)',
    '```',
    '    [[indented]]',
    '',
    '$[[math]]$',
    '$$',
    '[[equation]]',
    '$$',
    '<!-- [[comment]] -->',
    '\\[\\[escaped]]',
    '\\[[escaped-again]]',
    '[label [[nested]]](real.md)',
    '[[real]]',
  ].join('\n');
  expect(documentLinks(source)).toEqual([
    { kind: 'markdown', target: 'real.md' },
    { kind: 'wiki', target: 'real' },
  ]);
  expect(documentLinks('+++\ntitle = "[[metadata]]"\n+++\n[[body]]')).toEqual([
    { kind: 'wiki', target: 'body' },
  ]);
});
it('returns source spans and decoded labels after YAML and TOML frontmatter', () => {
  for (const prefix of ['---\ntitle: Example\n---\n', '+++\ntitle = "Example"\n+++\n']) {
    const raw = '[@A \\[B\\]](object://document/a00001)';
    const source = `${prefix}Read ${raw} now.`;
    const [link] = documentLinkDetails(source);
    expect(link.label).toBe('@A [B]');
    expect(source.slice(link.from, link.to)).toBe(raw);
    expect(link.excerpt).toContain('Read');
  }
});
it('places a source-mode reference outside fenced and inline code and frontmatter', () => {
  const source = '```ts\nselected code\n```\n\nafter';
  const point = referenceInsertionPoint(source, source.indexOf('code') + 4);
  expect(source.slice(0, point.at)).toBe('```ts\nselected code\n```');
  expect(point.prefix).toBe('\n\n');
  expect(referenceInsertionPoint('before `selected code` after', 16).at).toBe(22);
  expect(referenceInsertionPoint('---\ntitle: selected\n---\nbody', 12).at).toBe(24);
});
