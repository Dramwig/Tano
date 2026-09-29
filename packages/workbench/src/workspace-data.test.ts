// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { DemoAdapter } from './adapter';
import { loadCapabilities } from './workspace-capabilities';
import { loadRelations } from './workspace-relations';
import { loadObjects } from './workspace-objects';

beforeEach(() => localStorage.clear());

it.each([false, true])('ignores old data locations without reading or moving them (readOnly=%s)', async (readOnly) => {
  const adapter = new DemoAdapter();
  // Simulate a cached/remote manifest that still includes unsupported paths.
  const paths = [
    '.workspace/objects/a00001.tano.json',
    '.workspace/capabilities.json',
    '.workspace/relations.tano-relations.json',
    '.workspace/conflicts/copy.json',
    'objects/a00001.tano.json',
    'capabilities.json',
    'relations.tano-relations.json',
  ];
  const workspace = { ...(await adapter.refresh()), readOnly,
    files: paths.map((path) => ({ id: path, path, name: path, kind: 'file' as const, size: 1, modified: 1 })),
  };
  const read = vi.spyOn(adapter, 'read');
  const move = vi.spyOn(adapter, 'move');
  const create = vi.spyOn(adapter, 'create');
  expect((await loadCapabilities(adapter, workspace)).snapshot).toBeNull();
  expect((await loadRelations(adapter, workspace)).file.relations).toEqual([]);
  expect(await loadObjects(adapter, workspace)).toEqual({ records: [], errors: [] });
  expect(read).not.toHaveBeenCalled();
  expect(move).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});

it('loads canonical data even when root records coexist, and preserves the root files', async () => {
  const adapter = new DemoAdapter();
  await adapter.createFolder('objects');
  await adapter.create('objects/a00001.tano.json', '{broken old object');
  await adapter.create('capabilities.json', '{broken old rules');
  await adapter.create('relations.tano-relations.json', '{broken old relations');
  await adapter.create('.tano/capabilities.json', '{"mathSyntax":"latex"}');
  await adapter.create('.tano/relations.tano-relations.json', '{"version":1,"relations":[]}');
  await adapter.create('.tano/objects/a00001.tano.json', JSON.stringify({
    version: 1, id: 'a00001', type: 'person', name: 'Alice', description: '', archived: false, properties: {},
  }));
  const before = await adapter.refresh();
  expect((await loadCapabilities(adapter, before)).capabilities.mathSyntax).toBe('latex');
  expect((await loadRelations(adapter, before)).file.relations).toEqual([]);
  const objects = await loadObjects(adapter, before);
  expect(objects.errors).toEqual([]);
  expect(objects.records.map(({ object }) => object.name)).toEqual(['Alice']);
  expect((await adapter.read('objects/a00001.tano.json')).content).toBe('{broken old object');
  expect((await adapter.read('capabilities.json')).content).toBe('{broken old rules');
  expect((await adapter.read('relations.tano-relations.json')).content).toBe('{broken old relations');
  expect(await adapter.refresh()).toEqual(before);
});

it('rejects reads, creates and moves using old hidden paths', async () => {
  const adapter = new DemoAdapter();
  await adapter.create('.tano/capabilities.json', '{}');
  await expect(adapter.read('.workspace/capabilities.json')).rejects.toThrow();
  await expect(adapter.create('.workspace/capabilities.json', '{}')).rejects.toThrow();
  await expect(adapter.move('.tano/capabilities.json', '.workspace/capabilities.json', 'file')).rejects.toThrow();
  expect((await adapter.read('.tano/capabilities.json')).content).toBe('{}');
});
