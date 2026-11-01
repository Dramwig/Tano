import { expect, it } from 'vitest';
import { droppedEntryReferences } from './entry-drag';
const targets = [{ workspace: 'one', id: 'abcdef', type: 'asset', name: 'slides.pptx', path: 'slides.pptx' }];
it('resolves current identities once and rejects foreign or malformed drags', () => {
  expect(droppedEntryReferences(JSON.stringify({ workspace: 'one', ids: ['abcdef', 'abcdef', 'missing'] }), targets)).toEqual(targets);
  expect(droppedEntryReferences(JSON.stringify({ workspace: 'two', ids: ['abcdef'] }), targets)).toEqual([]);
  for (const data of ['', 'null', '{}', '{']) expect(droppedEntryReferences(data, targets)).toEqual([]);
});
