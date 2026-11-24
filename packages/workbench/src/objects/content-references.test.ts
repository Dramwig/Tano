import { expect, it } from 'vitest';
import type { ReferenceTarget } from '@tano/protocol';
import { contentReferences, referenceContext } from './content-references';

const targets: ReferenceTarget[] = [
  { workspace: 'ws', type: 'document', id: 'a00001', name: 'Moved note', path: 'new/note.md' },
  { workspace: 'ws', type: 'document', id: 'a00002', name: 'Source', path: 'source.md' },
  { workspace: 'ws', type: 'event', id: 'b00001', name: 'Todo', path: '.tano/objects/b00001.tano.json' },
];
it('connects Markdown and task descriptions by identity, resolving relative/wiki links and deduplicating', () => {
  const contents = new Map([
    ['document/a00002', '[todo](object://event/b00001) [again](object://event/b00001)\n\n[[new/note]] [note](new/note.md)'],
    ['event/b00001', '[old name](object://document/a00001)'],
  ]);
  const edges = contentReferences(targets, contents);
  expect(edges).toHaveLength(3);
  expect(referenceContext(edges, targets[0]).incoming.map(edge => edge.source.name)).toEqual(['Source', 'Todo']);
  expect(referenceContext(edges, targets[2]).outgoing[0]).toMatchObject({ name: 'Moved note', path: 'new/note.md', missing: false });
  expect(referenceContext(edges, targets[2]).incoming[0].excerpt).toContain('todo');
  expect(referenceContext(edges, targets[2]).incoming[0].excerpt).not.toContain('object://');
});
it('keeps broken and archived identities visible without binding examples or ambiguous IDs', () => {
  const source = '[gone](object://document/c00001) [archived](object://event/b00001)\n`[code](object://event/b00001)`\n\n```md\n[example](object://document/a00001)\n```';
  const edges = contentReferences([...targets.slice(0, 2), { ...targets[2], archived: true }], new Map([['document/a00002', source]]));
  expect(edges).toHaveLength(2);
  expect(edges[0]).toMatchObject({ missing: true, target: { id: 'c00001' } });
  expect(edges[1].archived).toBe(true);
  const duplicates = contentReferences([...targets, { ...targets[0], path: 'duplicate.md' }], new Map([['event/b00001', '[note](object://document/a00001)']]));
  expect(duplicates[0].missing).toBe(true);
});
