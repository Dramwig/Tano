import { expect, it } from 'vitest';
import { FileRegistry } from './file-core';
import { emptyFileMetadata } from './file-metadata';
import { defaultFileDatabaseQuery, queryFileDatabase, groupFileDatabase, validateFileDatabaseQuery } from './file-database';
import { parseWorkspaceView } from './workspace-contract';
const files = new FileRegistry('ws', ['docs/a.pdf', 'docs/sub/b.csv', 'docs2/c.json', '.tano/files/aaaaaa.tano.json'].map((path, i) => ({ id: `aaaaa${i}`, path, name: path.split('/').at(-1)!, kind: 'file', size: [100, 20, 3, 1][i]!, modified: i })));
const rows = files.files.map(file => ({ file, metadata: { ...emptyFileMetadata(file.id), tags: ['paper', 'review'], properties: { owner: '李', status: '进行中', score: file.size } } }));
it('queries directory boundaries, recursion and newly discovered files without copying content', () => {
  const query = defaultFileDatabaseQuery('docs');
  expect(queryFileDatabase(rows, query).map(r => r.file.path)).toEqual(['docs/a.pdf', 'docs/sub/b.csv']);
  expect(queryFileDatabase(rows, { ...query, recursive: false }).map(r => r.file.path)).toEqual(['docs/a.pdf']);
  expect(queryFileDatabase(rows, defaultFileDatabaseQuery())).toHaveLength(3);
});
it('combines typed property and tag filters, sorts numbers numerically, and groups multi-value tags', () => {
  const query = defaultFileDatabaseQuery();
  query.filters = [{ field: 'tags', operator: 'equals', value: 'PAPER' }, { field: 'property:owner', operator: 'equals', value: '李' }];
  query.sort = { field: 'property:score', direction: 'asc' };
  const result = queryFileDatabase(rows, query);
  expect(result.map(r => r.file.size)).toEqual([3, 20, 100]);
  expect(groupFileDatabase(result, 'tags').map(g => [g.name, g.rows.length])).toEqual([['paper', 3], ['review', 3]]);
  query.filters = [{ field: 'property:absent', operator: 'empty', value: '' }];
  expect(queryFileDatabase(rows, query)).toHaveLength(3);
});
it('rejects unsafe scope and malformed saved queries instead of silently ignoring them', () => {
  for (const directory of ['../outside', '/root', '.tano', 'docs/../x', 'C:/outside', 'docs\\x']) {
    expect(() => validateFileDatabaseQuery(defaultFileDatabaseQuery(directory))).toThrow();
  }
  const view = { version: 1, layer: 'view', workspaceId: 'ws', id: 'files', name: 'Files', kind: 'files', sources: [], database: defaultFileDatabaseQuery() };
  expect(parseWorkspaceView(JSON.stringify(view)).database).toEqual(defaultFileDatabaseQuery());
  expect(() => parseWorkspaceView(JSON.stringify({ ...view, database: { ...view.database, filters: [{}] } }))).toThrow();
  expect(() => parseWorkspaceView(JSON.stringify({ ...view, kind: 'graph' }))).toThrow();
});
