import { expect, it } from 'vitest';
import { documentLinks } from './document-links';

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
