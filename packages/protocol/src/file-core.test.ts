import { expect, it } from 'vitest';
import { FileRegistry, fileHandlers } from './file-core';
import { parseFileMetadata, fileMetadataPath } from './file-metadata';
const file = { id: 'abcdef', path: 'a.pdf', name: 'a.pdf', kind: 'file' as const, size: 3, modified: 1, contentHash: 'first' };
it('resolves the same identity at a new path with a changed revision and excludes internal data', () => {
  const before = new FileRegistry('workspace', [file]);
  const after = new FileRegistry('workspace', [{ ...file, path: 'moved/b.pdf', contentHash: 'second' }, { ...file, id: '123456', path: '.tano/files/abcdef.tano.json' }]);
  expect(before.get(file.id)?.revision).toBe('first');
  expect(after.get(file.id)).toMatchObject({ workspaceId: 'workspace', path: 'moved/b.pdf', revision: 'second', handlerId: 'pdf' });
  expect(after.at('a.pdf')).toBeUndefined();
  expect(after.userFiles()).toHaveLength(1);
  expect(new FileRegistry('workspace', []).get(file.id)).toBeUndefined();
  expect(() => new FileRegistry('workspace', [file, file])).toThrow('重复');
});
it.each([['a.TABLE.JSON', 'table', true], ['a.md', 'markdown', true], ['a.csv', 'csv', false], ['a.json', 'json', false], ['a.py', 'code', false], ['a.png', 'image', false], ['a.exe', 'binary', false]])('routes %s to its declared capabilities', (path, preview, canEdit) => {
  expect(fileHandlers.resolve(path)).toMatchObject({ preview, canEdit });
});
it.each(['xls', 'xlsx', 'doc', 'docx', 'ppt', 'pptx'])('routes %s to the built-in read-only Office viewer', extension => {
  expect(fileHandlers.resolve(`attachments/阅读.${extension.toUpperCase()}`)).toMatchObject({ preview: 'office', canEdit: false, permissions: ['read'] });
});
it('validates portable metadata and never accepts paths or executable/nested property values as identity', () => {
  const value = { version: 1, fileId: 'abcdef', tags: ['paper'], properties: { owner: 'Li', done: true } };
  expect(parseFileMetadata(JSON.stringify(value), 'abcdef')).toEqual(value);
  expect(fileMetadataPath('abcdef')).toBe('.tano/files/abcdef.tano.json');
  for (const bad of [{ ...value, fileId: '123456' }, { ...value, tags: ['x', 'x'] }, { ...value, properties: { owner: {} } }])
    expect(() => parseFileMetadata(JSON.stringify(bad), 'abcdef')).toThrow();
  expect(() => fileMetadataPath('../escape')).toThrow();
});
