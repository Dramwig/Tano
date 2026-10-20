import { validateStoragePath, workspaceFolderRegistryPath } from './workspace-paths';
import { expect, it } from 'vitest';
import { mergeWorkspaceObject } from './structured-merge';
import type { WorkspaceObject } from './objects';
const base: WorkspaceObject = { version: 1, type: 'project', id: 'abc123', name: 'Project', description: '', archived: false, properties: { status: 'todo', owner: 'A' } };
it('merges independent properties but rejects overlapping edits, deletion edits and identity changes', () => {
  expect(mergeWorkspaceObject(base, { ...base, properties: { ...base.properties, status: 'done' } }, { ...base, name: 'Renamed', properties: { ...base.properties, owner: 'B' } })).toMatchObject({ name: 'Renamed', properties: { status: 'done', owner: 'B' } });
  expect(mergeWorkspaceObject(base, { ...base, name: 'A' }, { ...base, name: 'B' })).toBeNull();
  expect(mergeWorkspaceObject(base, { ...base, properties: {} }, { ...base, properties: { status: 'done' } })).toBeNull();
  expect(mergeWorkspaceObject(base, { ...base, id: 'abc124' }, base)).toBeNull();
});

it('shares portable directory metadata without allowing workspace identity to sync as content', () => {
 expect(validateStoragePath(workspaceFolderRegistryPath)).toBeNull();
 expect(validateStoragePath('.tano/config.json')).not.toBeNull();
 expect(validateStoragePath('.tano/identities.json')).not.toBeNull();
});
