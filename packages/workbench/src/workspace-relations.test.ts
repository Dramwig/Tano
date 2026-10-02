// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { relationPath, parseRelations } from '@tano/protocol';
import type { WorkspaceRelation } from '@tano/protocol';
import { DemoAdapter } from './adapter';
import { loadRelations, saveRelationChange } from './workspace-relations';
let adapter: DemoAdapter;
const edge = (id: string, target = 'a00002'): WorkspaceRelation => ({
  id,
  type: 'related',
  source: { type: 'person', id: 'a00001' },
  target: { type: 'task', id: target },
});
beforeEach(async () => {
  localStorage.clear();
  adapter = new DemoAdapter();
  await adapter.open();
});
it('merges concurrent creation and independent addition without losing external fields', async () => {
  await adapter.create(
    relationPath,
    JSON.stringify({ version: 1, relations: [edge('b00001')], external: 'preserved' }),
  );
  const saved = await saveRelationChange(adapter, null, { add: edge('b00002', 'a00003') });
  expect(saved.file.relations).toHaveLength(2);
  expect(saved.file.external).toBe('preserved');
  expect((await loadRelations(adapter, await adapter.refresh())).file).toEqual(saved.file);
});
it('makes repeated additions idempotent and preserves concurrent unrelated edits when removing', async () => {
  const first = await saveRelationChange(adapter, null, { add: edge('b00001') });
  await saveRelationChange(adapter, first.snapshot, { add: edge('b00002', 'a00003') });
  const repeated = await saveRelationChange(adapter, first.snapshot, { add: edge('b00003') });
  expect(repeated.file.relations).toHaveLength(2);
  expect(repeated.file.relations[0]?.id).toBe('b00001');
  const removed = await saveRelationChange(adapter, first.snapshot, { remove: edge('b00001') });
  expect(removed.file.relations).toEqual([edge('b00002', 'a00003')]);
});
it('rejects removal of an externally changed edge and preserves invalid files', async () => {
  const first = await saveRelationChange(adapter, null, { add: edge('b00001') });
  await adapter.write(
    relationPath,
    JSON.stringify({ version: 1, relations: [edge('b00001', 'a00004')] }),
    first.snapshot!.hash,
  );
  await expect(
    saveRelationChange(adapter, first.snapshot, { remove: edge('b00001') }),
  ).rejects.toThrow('外部修改');
  expect(parseRelations((await adapter.read(relationPath)).content).relations[0]?.target.id).toBe(
    'a00004',
  );
  const latest = await adapter.read(relationPath);
  await adapter.write(relationPath, '{broken', latest.hash);
  await expect(
    saveRelationChange(adapter, first.snapshot, { add: edge('b00002', 'a00003') }),
  ).rejects.toThrow();
  expect((await adapter.read(relationPath)).content).toBe('{broken');
});

it('replaces a target atomically, merges unrelated edits and rejects concurrent reassignment', async () => {
  const original = { ...edge('b00001'), type: 'assigned', target: { type: 'event', id: 'a00002' } };
  const next = { ...original, id: 'b00003', source: { type: 'person', id: 'a00005' } };
  const first = await saveRelationChange(adapter, null, { add: original });
  await saveRelationChange(adapter, first.snapshot, { add: edge('b00002', 'a00003') });
  const replacement = { type: 'assigned', target: original.target, previous: [original], next: [next] };
  const saved = await saveRelationChange(adapter, first.snapshot, { replace: replacement });
  expect(saved.file.relations).toEqual([edge('b00002', 'a00003'), next]);
  await expect(saveRelationChange(adapter, first.snapshot, { replace: { ...replacement, next: [] } })).rejects.toThrow('外部修改');
  expect(parseRelations((await adapter.read(relationPath)).content).relations).toEqual(saved.file.relations);
});
