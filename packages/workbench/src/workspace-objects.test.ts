// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { DemoAdapter } from './adapter';
import { loadObjects, mergeObject, saveObject } from './workspace-objects';
import type { WorkspaceObject } from '@tano/protocol';
const object: WorkspaceObject = {
  version: 1,
  id: 'a00001',
  type: 'task',
  name: '任务',
  description: '说明',
  archived: false,
  properties: { status: 'todo', owner: 'alice' },
  future: 42,
};
const path = '.tano/objects/a00001.tano.json';
beforeEach(() => localStorage.clear());
async function setup() {
  const adapter = new DemoAdapter();
  await adapter.open();
  await adapter.create(path, JSON.stringify(object));
  const record = { object, path, snapshot: await adapter.read(path) };
  return { adapter, record };
}
it('merges independent edits using base hashes, preserving future fields', async () => {
  const { adapter, record } = await setup();
  await saveObject(adapter, record, {
    ...object,
    description: 'External',
    properties: { ...object.properties, status: 'done' },
  });
  const saved = await saveObject(adapter, record, {
    ...object,
    name: 'Renamed',
    properties: { ...object.properties, owner: 'bob' },
  });
  expect(saved.object).toMatchObject({
    name: 'Renamed',
    description: 'External',
    properties: { status: 'done', owner: 'bob' },
    future: 42,
  });
  expect((await loadObjects(adapter, await adapter.refresh())).records[0]!.object.id).toBe(
    object.id,
  );
});
it('leaves conflicting external changes intact and never changes identity', async () => {
  const { adapter, record } = await setup();
  const theirs = await saveObject(adapter, record, { ...object, name: 'External' });
  await expect(saveObject(adapter, record, { ...object, name: 'Mine' })).rejects.toThrow('冲突');
  expect(await adapter.read(path)).toEqual(theirs.snapshot);
  expect(mergeObject(object, { ...object, id: 'new' }, object)).toBeNull();
  expect(mergeObject(object, { ...object, type: 'person' }, object)).toBeNull();
});
it('does not recreate deleted objects or overwrite malformed JSON', async () => {
  const { adapter, record } = await setup();
  await adapter.write(path, '{broken', record.snapshot.hash);
  await expect(saveObject(adapter, record, { ...object, name: 'Mine' })).rejects.toThrow();
  expect((await adapter.read(path)).content).toBe('{broken');
  await adapter.remove(path);
  await expect(saveObject(adapter, record, object)).rejects.toThrow('移除');
});
it('excludes duplicate IDs and reports invalid objects instead of binding by name', async () => {
  const { adapter } = await setup();
  await adapter.create('.tano/objects/copy.tano.json', JSON.stringify({ ...object, type: 'person' }));
  await adapter.create('.tano/objects/invalid.tano.json', '{}');
  const loaded = await loadObjects(adapter, await adapter.refresh());
  expect(loaded.records).toEqual([]);
  expect(loaded.errors.some((error) => error.includes('重复'))).toBe(true);
  expect(loaded.errors.some((error) => error.includes('invalid.tano.json'))).toBe(true);
});
it('retains retired domain files unchanged and refuses to edit them without a plugin', async () => {
  const { adapter } = await setup();
  for (const [id, type] of [
    ['b00001', 'dataset'],
    ['b00002', 'database'],
  ]) {
    const content = JSON.stringify({ ...object, id, type, properties: { custom: [1, 2] } });
    await adapter.create(`.tano/objects/${id}.tano.json`, content);
    const loaded = await loadObjects(adapter, await adapter.refresh());
    const legacy = loaded.records.find((record) => record.object.id === id)!;
    expect(legacy.object.properties).toEqual({ custom: [1, 2] });
    await expect(saveObject(adapter, legacy, { ...legacy.object, name: 'New' })).rejects.toThrow(
      '未启用',
    );
    expect((await adapter.read(legacy.path)).content).toBe(content);
  }
});
it('validates merged event times before writing independent external changes', async () => {
  const { adapter } = await setup();
  const event = {
    ...object,
    id: 'b00001',
    type: 'event',
    properties: { start: '2026-10-01T10:00:00Z', end: '2026-10-01T11:00:00Z' },
  };
  const eventPath = '.tano/objects/b00001.tano.json';
  await adapter.create(eventPath, JSON.stringify(event));
  const record = { object: event, path: eventPath, snapshot: await adapter.read(eventPath) };
  const theirs = await saveObject(adapter, record, {
    ...event,
    properties: { ...event.properties, start: '2026-10-01T10:45:00Z' },
  });
  await expect(
    saveObject(adapter, record, {
      ...event,
      properties: { ...event.properties, end: '2026-10-01T10:30:00Z' },
    }),
  ).rejects.toThrow('早于');
  expect(await adapter.read(eventPath)).toEqual(theirs.snapshot);
});
