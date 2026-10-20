// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPinia, disposePinia } from 'pinia';
import { DemoAdapter } from '../adapter';
import { configureWorkbench } from '../runtime';
import { useWorkspaceStore } from './workspace';
import { newDataTable } from '../data-tables';
import { relationPath } from '@tano/protocol';
let adapter: DemoAdapter, store: ReturnType<typeof useWorkspaceStore>, pinia: ReturnType<typeof createPinia>;
beforeEach(async () => {
  localStorage.clear(); adapter = new DemoAdapter({ files: { 'README.md': '# Source' }, storageKey: 'object-db' });
  pinia = configureWorkbench(createPinia(), { adapter, native: false, mobile: false }); store = useWorkspaceStore(pinia); await store.initialize();
});
afterEach(() => { store.dispose(); disposePinia(pinia); vi.unstubAllGlobals(); });
const draft = (type: string) => ({ type, name: type, description: '', archived: false, properties: { status: '待处理' } });
it('reserves external object identities and refuses reusing a deleted ID', async () => {
  vi.stubGlobal('navigator', { locks: { request: async (_name: string, callback: () => unknown) => callback() } });
  const scope = { id: store.workspace!.id, path: store.workspace!.path };
  const object = { ...draft('project'), version: 1, id: 'f12345' };
  const proposal = { id: crypto.randomUUID(), runId: crypto.randomUUID(), workspaceId: scope.id, kind: 'object' as const,
    path: '.tano/objects/f12345.tano.json', base: '', content: JSON.stringify(object), reason: 'External new project', status: 'ready' as const };
  const preview = await store.reviewAssistantProposal(scope, proposal, undefined, false, undefined, true);
  expect((await store.reviewAssistantProposal(scope, proposal, preview.preview, false, undefined, true)).status).toBe('saved');
  const record = store.objects.find(record => record.object.id === object.id)!;
  await store.deleteObject(record, scope.id);
  const reused = { ...proposal, id: crypto.randomUUID() };
  const next = await store.reviewAssistantProposal(scope, reused, undefined, false, undefined, true);
  await expect(store.reviewAssistantProposal(scope, reused, next.preview, false, undefined, true)).rejects.toThrow('已被使用');
});
it('creates each schema without coercion and switches saved layouts without copying records or relations', async () => {
  const task = await store.createObject(draft('task')), project = await store.createObject(draft('project'));
  await store.createObject(draft('experiment'));
  expect(task.object.type).toBe('task');
  await store.createRelation('contains', project.object, task.object);
  await store.createRelation('contains', project.object, task.object);
  expect(store.relations).toHaveLength(1);
  const objects = await Promise.all(store.objects.map(r => adapter.read(r.path)));
  const relations = await adapter.read(relationPath);
  await store.createObjectDatabase();
  for (const layout of ['table', 'board', 'gallery'] as const) {
    const record = store.workspaceViews[0]!;
    const view = JSON.parse(JSON.stringify(record.view)); view.objectDatabase.layout = layout;
    await store.saveFileDatabase(view, record.snapshot);
  }
  expect(await Promise.all(store.objects.map(r => adapter.read(r.path)))).toEqual(objects);
  expect(await adapter.read(relationPath)).toEqual(relations);
  expect(store.objects).toHaveLength(3);
});
it('merges independent updates and preserves both versions when the same property conflicts', async () => {
  const base = await store.createObject(draft('experiment')); const scope = store.workspace!.id;
  await store.updateObject(base, { ...base.object, name: 'external' }, scope);
  const merged = await store.updateObject(base, { ...base.object, properties: { ...base.object.properties, metric: 42 } }, scope);
  expect(merged.object.name).toBe('external'); expect(merged.object.properties.metric).toBe(42);
  await expect(store.updateObject(base, { ...base.object, name: 'local' }, scope)).rejects.toThrow('冲突');
  const copy = (await adapter.refresh()).files.find(f => f.path.startsWith('.tano/conflicts/object-'))!;
  expect(JSON.parse((await adapter.read(copy.path)).content).name).toBe('local');
  expect(JSON.parse((await adapter.read(base.path)).content).name).toBe('external');
});
it('refuses stale deletes and preserves reference provenance after a checked deletion', async () => {
  const task = await store.createObject(draft('task')), project = await store.createObject(draft('project'));
  const scope = store.workspace!.id;
  await store.createRelation('contains', project.object, task.object);
  const updated = await store.updateObject(task, { ...task.object, name: 'changed outside' }, scope);
  await expect(store.deleteObject(task, scope)).rejects.toThrow('外部修改');
  expect(store.objects.some(r => r.object.id === task.object.id)).toBe(true);
  await store.deleteObject(updated, scope);
  expect(store.objects.some(r => r.object.id === task.object.id)).toBe(false);
  expect(store.relations[0]!.target.id).toBe(task.object.id);
  expect((await adapter.read('README.md')).content).toBe('# Source');
  await expect(adapter.removeObjectFile({ workspaceId: scope, fileId: 'aaaaaa', path: 'README.md', expectedHash: 'x' })).rejects.toThrow();
});

it('reserves external table identities after deletion', async () => {
  vi.stubGlobal('navigator', { locks: { request: async (_name: string, callback: () => unknown) => callback() } });
  const scope = { id: store.workspace!.id, path: store.workspace!.path };
  const proposal = { id: crypto.randomUUID(), runId: crypto.randomUUID(), workspaceId: scope.id, kind: 'create' as const,
    path: 'external.table.json', base: '', content: JSON.stringify(newDataTable('f12346')), reason: 'External table', status: 'ready' as const };
  const preview = await store.reviewAssistantProposal(scope, proposal, undefined, false, undefined, true);
  expect((await store.reviewAssistantProposal(scope, proposal, preview.preview, false, undefined, true)).status).toBe('saved');
  await adapter.remove(proposal.path);
  const reused = { ...proposal, id: crypto.randomUUID() };
  const next = await store.reviewAssistantProposal(scope, reused, undefined, false, undefined, true);
  await expect(store.reviewAssistantProposal(scope, reused, next.preview, false, undefined, true)).rejects.toThrow('已被使用');
});
