import { expect, it } from 'vitest';
import {
  parseObject,
  parseReferenceUrl,
  referenceCandidates,
  referenceUrl,
  resolveReference,
  assetTargets,
  documentTargets,
} from './objects';
import {
  coreObjectTypes,
  ObjectTypeRegistry,
  registerObjectType,
  objectTypeRegistry,
  validateObjectProperties,
} from './object-types';
import type { ReferenceTarget } from './objects';
const targets: ReferenceTarget[] = [
  { workspace: 'ws', type: 'person', id: 'a82f91', name: 'Alice', path: 'objects/a.tano.json' },
  { workspace: 'ws', type: 'project', id: 'b91af2', name: 'Alice', path: 'objects/b.tano.json' },
  { workspace: 'ws', type: 'document', id: 'c72bb3', name: 'Alice', path: 'Alice.md' },
];
it('disambiguates names by type and binds identity independently of name or path', () => {
  expect(referenceCandidates(targets, '@Alice')).toHaveLength(3);
  expect(referenceCandidates(targets, '@person/Alice')).toEqual([targets[0]]);
  expect(referenceCandidates(targets, 'project:Alice')).toEqual([targets[1]]);
  const identity = parseReferenceUrl(referenceUrl(targets[0]!))!;
  expect(referenceUrl(targets[0]!)).toBe('object://person/a82f91');
  expect(identity).toEqual({ type: 'person', id: 'a82f91' });
  const renamed = { ...targets[0]!, name: 'Alice Zhang', path: 'moved/person.tano.json' };
  expect(resolveReference([renamed, targets[1]!], identity).target).toEqual(renamed);
  expect(resolveReference([targets[1]!], identity).error).toBe('missing');
  expect(resolveReference([{ ...renamed, workspace: 'other' }], identity).target?.name).toBe(
    'Alice Zhang',
  );
  expect(resolveReference([renamed, renamed], identity).error).toBe('ambiguous');
  expect(referenceCandidates([{ ...renamed, archived: true }], '')).toEqual([]);
});
it('accepts only six-digit local reference IDs, without legacy URL compatibility', () => {
  for (const type of [
    'person',
    'task',
    'project',
    'event',
    'asset',
    'document',
    'dataset',
    'database',
    'ai.paper',
  ] as const) {
    expect(parseReferenceUrl(`object://old_workspace/${type}/d00001`)).toBeNull();
    expect(parseReferenceUrl(`object://${type}/17247764-43d1-4fb4-8816-2a57a03beaa5`)).toBeNull();
    expect(parseReferenceUrl(`object://${type}/d00001`)).toEqual({ type, id: 'd00001' });
  }
});
it('ships only six core types and preserves unregistered domain data without enabling it', () => {
  expect(coreObjectTypes.map((type) => type.type)).toEqual([
    'task',
    'project',
    'person',
    'document',
    'event',
    'asset',
  ]);
  for (const type of ['dataset', 'database', 'paper', 'ai.paper']) {
    const object = {
      version: 1,
      id: 'a00001',
      type,
      name: 'Domain',
      description: '',
      archived: false,
      properties: { future: 'preserve' },
    };
    expect(parseObject(JSON.stringify(object))).toEqual(object);
    expect(() => validateObjectProperties(type, object.properties)).toThrow('未启用');
    const target = {
      workspace: 'ws',
      type,
      id: object.id,
      name: object.name,
      path: 'objects/a.tano.json',
    };
    expect(referenceCandidates([target], '')).toEqual([]);
    expect(resolveReference([target], target).error).toBe('unregistered');
    expect(parseReferenceUrl(referenceUrl(target))).toEqual({ type, id: object.id });
  }
});
it('registers namespaced plugin fields and unregisters without losing stored references', () => {
  const unregister = registerObjectType({
    plugin: 'ai',
    type: 'ai.paper',
    label: '论文',
    fields: [{ key: 'year', label: '年份', type: 'number', required: true }],
  });
  const target = {
    workspace: 'ws',
    type: 'ai.paper',
    id: 'abc123',
    name: 'SWAT',
    path: 'objects/paper.tano.json',
  };
  try {
    expect(objectTypeRegistry.get('ai.paper')).toMatchObject({
      category: 'plugin',
      storage: 'record',
      level: 2,
    });
    expect(referenceCandidates([target], '@ai.paper:SWAT')).toEqual([target]);
    expect(resolveReference([target], target).target).toEqual(target);
    expect(() => validateObjectProperties('ai.paper', { year: 2026 })).not.toThrow();
    expect(() => validateObjectProperties('ai.paper', { year: '2026' })).toThrow('年份');
    expect(() => validateObjectProperties('ai.paper', {})).toThrow('年份');
  } finally {
    unregister();
  }
  expect(resolveReference([target], target).error).toBe('unregistered');
  expect(parseReferenceUrl(referenceUrl(target))).toEqual({ type: 'ai.paper', id: 'abc123' });
});
it('rejects plugin collisions, core overrides and unsafe field definitions', () => {
  const registry = new ObjectTypeRegistry();
  expect(() =>
    registry.registerObjectType({ plugin: 'ai', type: 'task', label: 'Override' }),
  ).toThrow();
  const unregister = registry.registerObjectType({
    plugin: 'ai',
    type: 'ai.paper',
    label: 'Paper',
  });
  expect(() =>
    registry.registerObjectType({ plugin: 'ai', type: 'ai.paper', label: 'Duplicate' }),
  ).toThrow();
  expect(() =>
    registry.registerObjectType({ plugin: 'other', type: 'ai.paper', label: 'Wrong namespace' }),
  ).toThrow();
  expect(() =>
    registry.registerObjectType({
      plugin: 'ai',
      type: 'ai.data',
      label: 'Unsafe',
      fields: [{ key: '__proto__', label: 'Bad', type: 'text' }],
    }),
  ).toThrow();
  unregister();
  expect(registry.get('ai.paper')).toBeUndefined();
});
it('validates event time zones, calendar dates, required times and order', () => {
  const properties = { start: '2026-10-01T10:00:00+08:00', end: '2026-10-01T03:00:00Z' };
  expect(() => validateObjectProperties('event', properties)).not.toThrow();
  for (const patch of [
    { start: undefined },
    { end: undefined },
    { start: '2026-10-01T10:00' },
    { start: '2026-02-30T10:00:00Z' },
    { end: '2026-10-01T01:00:00Z' },
  ])
    expect(() => validateObjectProperties('event', { ...properties, ...patch })).toThrow();
  for (const type of ['document', 'asset'])
    expect(() => validateObjectProperties(type, {})).toThrow('工作区文件');
});
it('derives Document and Asset metadata from file identity without storing content or following paths', () => {
  const files = [
    {
      id: 'a00001',
      path: 'notes/SWAT.md',
      name: 'SWAT.md',
      kind: 'file' as const,
      size: 100,
      modified: 12,
    },
    {
      id: 'a00002',
      path: 'assets/figure.png',
      name: 'figure.png',
      kind: 'file' as const,
      size: 1024,
      modified: 13,
    },
    {
      id: 'a00003',
      path: 'objects/a00004.tano.json',
      name: 'a00004.tano.json',
      kind: 'file' as const,
      size: 200,
      modified: 14,
    },
    {
      id: 'a00004',
      path: 'capabilities.json',
      name: 'capabilities.json',
      kind: 'file' as const,
      size: 200,
      modified: 14,
    },
    {
      id: 'a00005',
      path: '.tano/config.json',
      name: 'config.json',
      kind: 'file' as const,
      size: 200,
      modified: 14,
    },
  ];
  expect(documentTargets('ws', files)).toEqual([
    expect.objectContaining({
      type: 'document',
      id: 'a00001',
      name: 'SWAT',
      mime: 'text/markdown',
      size: 100,
    }),
  ]);
  const assets = assetTargets('ws', files);
  expect(assets).toEqual([
    expect.objectContaining({ type: 'asset', id: 'a00002', mime: 'image/png', size: 1024 }),
  ]);
  const renamed = assetTargets('ws', [{ ...files[1]!, path: 'moved/figure.png' }]);
  expect(resolveReference(renamed, assets[0]!).target?.path).toBe('moved/figure.png');
  expect(resolveReference([], assets[0]!).error).toBe('missing');
  expect(assets[0]).not.toHaveProperty('content');
});
it('rejects malformed identities and object schemas while retaining future fields', () => {
  for (const url of [
    'object://ws/person/a?name=Alice',
    'object://ws/person/../b',
    'https://ws/person/a00001',
    'object://ws/unknown/a',
    'object://document/a?name=Alice',
    'object://document/../a',
    'object://document/',
    'object://workspace/extra/document/a',
  ])
    expect(parseReferenceUrl(url)).toBeNull();
  const value = {
    version: 1,
    id: 'a00001',
    type: 'task',
    name: '任务',
    description: '',
    archived: false,
    properties: { status: 'todo' },
    future: { x: 1 },
  };
  expect(parseObject(JSON.stringify(value))).toEqual(value);
  for (const patch of [{ id: '../a' }, { name: '' }, { properties: [] }, { type: '../invalid' }])
    expect(() => parseObject(JSON.stringify({ ...value, ...patch }))).toThrow();
});
