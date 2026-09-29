import { configureWorkbench } from '../runtime';
// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { registerObjectType } from '@tano/protocol';
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
  for (const type of ['dataset', 'database', 'asset', 'document'])
    await expect(store.createObject({ ...draft, type })).rejects.toThrow();
  expect(store.objects).toHaveLength(1);
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
