import { configureWorkbench } from '../runtime';
// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { registerObjectType, relationPath, resolveReference } from '@tano/protocol';
import { DemoAdapter } from '../adapter';
const fixture = vi.hoisted(() => ({ adapter: null as unknown }));
import { useWorkspaceStore } from './workspace';
let pinia: ReturnType<typeof createPinia>;
beforeEach(() => {
  localStorage.clear();
  fixture.adapter = new DemoAdapter();
  pinia = createPinia();
  configureWorkbench(pinia, {adapter: fixture.adapter as DemoAdapter, native: false, mobile: false});
  setActivePinia(pinia);
});
afterEach(() => disposePinia(pinia));
it('opens and refreshes without moving root platform records', async () => {
  const adapter = fixture.adapter as DemoAdapter;
  await adapter.createFolder('objects');
  await adapter.create('objects/old.tano.json', '{old bytes');
  await adapter.create('capabilities.json', '{old rules');
  const move = vi.spyOn(adapter, 'move');
  const store = useWorkspaceStore();
  await store.openWorkspace();
  await store.refresh();
  expect(move).not.toHaveBeenCalled();
  expect(store.objects).toEqual([]);
  expect(store.workspace!.files.some((file) => file.path.startsWith('.tano/'))).toBe(false);
  expect((await adapter.read('objects/old.tano.json')).content).toBe('{old bytes');
  expect((await adapter.read('capabilities.json')).content).toBe('{old rules');
});
it('creates events and references resources, but rejects retired and duplicate resource records', async () => {
  const store = useWorkspaceStore();
  await store.openWorkspace();
  const draft = {
    type: 'event',
    name: '会议',
    description: '',
    archived: false,
    properties: { start: '2026-10-01T10:00:00+08:00', end: '2026-10-01T11:00:00+08:00' },
  };
  const record = await store.createObject(draft);
  expect(record.path).toBe(`.tano/objects/${record.object.id}.tano.json`);
  expect(store.workspace!.files.some((file) => file.path === 'objects')).toBe(false);
  expect(store.referenceTargets.find((target) => target.id === record.object.id)).toMatchObject({
    type: 'event',
    properties: draft.properties,
  });
  expect(store.referenceTargets.some((target) => target.type === 'document')).toBe(true);
  const adapter = fixture.adapter as DemoAdapter;
  await adapter.create('test.pdf', 'asset bytes');
  await store.refresh();
  expect(store.referenceTargets.find((target) => target.type === 'asset')).toMatchObject({
    name: 'test.pdf',
    mime: 'application/pdf',
  });
  for (const type of ['project', 'dataset', 'database', 'asset', 'document'])
    await expect(store.createObject({ ...draft, type })).rejects.toThrow();
  expect(store.objects).toHaveLength(1);
});
it('keeps historical projects and relations readable without enabling mutations or new project relations', async () => {
  const adapter = fixture.adapter as DemoAdapter;
  await adapter.open();
  const project = { version: 1, id: 'a00001', type: 'project', name: '历史项目',
    description: '保留原说明', archived: false, properties: { custom: ['保留'] }, future: 42 };
  const path = '.tano/objects/a00001.tano.json';
  const content = JSON.stringify(project);
  const oldRelations = { version: 1, extra: 'preserved', relations: [
    { id: 'b00001', type: 'member', source: { type: 'person', id: 'a00002' },
      target: { type: 'project', id: project.id }, custom: 42 },
    { id: 'b00002', type: 'contains', source: { type: 'project', id: project.id },
      target: { type: 'document', id: 'a00003' } },
  ] };
  await adapter.create(path, content);
  await adapter.create(relationPath, JSON.stringify(oldRelations));
  const store = useWorkspaceStore();
  await store.openWorkspace();
  expect(store.objectErrors).toEqual([]);
  expect(store.objectDefinitions.some((type) => type.type === 'project')).toBe(false);
  expect(store.relationDefinitions.some((type) => ['member', 'contains'].includes(type.type))).toBe(false);
  const record = store.objects[0]!;
  expect(record.object).toEqual(project);
  expect(resolveReference(store.referenceTargets, project).target).toMatchObject({ type: 'project', id: project.id });
  expect(store.relations).toEqual(oldRelations.relations);
  const reserve = vi.spyOn(adapter, 'reserveObjectId');
  await expect(store.createObject(project)).rejects.toThrow('项目对象已停用');
  await expect(store.updateObject(record, { ...record.object, name: '不能修改' }, store.workspace!.id))
    .rejects.toThrow('项目对象已停用');
  expect(reserve).not.toHaveBeenCalled();
  for (const type of ['member', 'contains', 'related'])
    await expect(store.createRelation(type, { type: 'person', id: 'a00002' }, project)).rejects.toThrow();
  const person = await store.createObject({ type: 'person', name: '负责人', description: '', archived: false, properties: {} });
  const event = await store.createObject({ type: 'event', name: '待办', description: '', archived: false,
    properties: { checkable: true, completed: false, due: '2026-10-08' } });
  await store.createRelation('assigned', person.object, event.object);
  expect(store.relations).toEqual([...oldRelations.relations, expect.objectContaining({ type: 'assigned' })]);
  await store.removeRelation(store.relations[0]!);
  expect(store.relations).toHaveLength(2);
  expect(JSON.parse((await adapter.read(relationPath)).content).extra).toBe('preserved');
  await store.refresh();
  expect(resolveReference(store.referenceTargets, project).target?.path).toBe(path);
  expect((await adapter.read(path)).content).toBe(content);
});
it('responds to plugin registration and removal while keeping unregistered records intact', async () => {
  const adapter = fixture.adapter as DemoAdapter;
  await adapter.open();
  await adapter.create(
    '.tano/objects/paper.tano.json',
    JSON.stringify({
      version: 1,
      id: 'd00001',
      type: 'ai.paper',
      name: 'SWAT',
      description: '',
      archived: false,
      properties: { year: 2026 },
    }),
  );
  const store = useWorkspaceStore();
  await store.openWorkspace();
  expect(store.objects).toHaveLength(1);
  expect(store.referenceTargets.some((target) => target.type === 'ai.paper')).toBe(false);
  const unregister = registerObjectType({
    plugin: 'ai',
    type: 'ai.paper',
    label: '论文',
    fields: [{ key: 'year', label: '年份', type: 'number', required: true }],
  });
  try {
    expect(store.objectDefinitions.some((definition) => definition.type === 'ai.paper')).toBe(true);
    expect(store.referenceTargets.some((target) => target.type === 'ai.paper')).toBe(true);
  } finally {
    unregister();
  }
  expect(store.referenceTargets.some((target) => target.type === 'ai.paper')).toBe(false);
  expect(store.objects[0]!.object.properties).toEqual({ year: 2026 });
});
