import { expect, it } from 'vitest';
import { bundledObjectPlugins, parseObjectPlugin } from './plugins';
import { coreRelationTypes, parseRelations, RelationIndex, validateRelation } from './relations';
import type { WorkspaceRelation } from './relations';

it('validates bundled manifests and rejects executable, shadowing, and malformed declarations', () => {
  for (const plugin of bundledObjectPlugins)
    expect(parseObjectPlugin(JSON.stringify(plugin))).toEqual(plugin);
  const base = bundledObjectPlugins[0]!;
  for (const patch of [
    { script: 'evil.js' },
    { manifestVersion: 2 },
    { id: '../outside' },
    { objectTypes: [{ type: 'task', label: '任务' }] },
    {
      objectTypes: [
        {
          type: 'research.paper',
          label: '论文',
          fields: [{ key: '__proto__', label: '字段', type: 'text' }],
        },
      ],
    },
    {
      relationTypes: [
        {
          type: 'research.uses',
          label: '使用',
          sourceTypes: ['person'],
          targetTypes: ['other.secret'],
        },
      ],
    },
  ])
    expect(() => parseObjectPlugin(JSON.stringify({ ...base, ...patch }))).toThrow();
});
const alice = { type: 'person', id: 'a00001' },
  task = { type: 'task', id: 'a00002' },
  project = { type: 'project', id: 'a00003' };
const rows: WorkspaceRelation[] = [
  { id: 'b00001', type: 'assigned', source: alice, target: task },
  { id: 'b00002', type: 'related', source: task, target: project },
  { id: 'b00003', type: 'related', source: project, target: alice },
];
it('queries both directions and traverses cycles using identity, with no title dependencies', () => {
  const index = new RelationIndex(rows);
  expect(index.connections(task, 'incoming')).toEqual([rows[0]]);
  expect(index.connections(task, 'outgoing')).toEqual([rows[1]]);
  expect(index.connections(task)).toHaveLength(2);
  expect(index.traverse(alice, 100)).toEqual([task, project]);
  expect(index.traverse(task, 1, 'incoming')).toEqual([alice]);
  expect(index.traverse(alice, 0)).toEqual([]);
});
it('preserves uninstalled plugin relations and extra fields, but validates new endpoint types', () => {
  const unknown = { ...rows[0], type: 'research.uses', custom: { retained: true } };
  expect(parseRelations(JSON.stringify({ version: 1, relations: [unknown], extra: true }))).toEqual(
    { version: 1, relations: [unknown], extra: true },
  );
  expect(() => validateRelation(rows[0]!, coreRelationTypes)).not.toThrow();
  expect(() => validateRelation({ ...rows[0]!, source: task }, coreRelationTypes)).toThrow();
  expect(() =>
    parseRelations(JSON.stringify({ version: 1, relations: [rows[0], rows[0]] })),
  ).toThrow();
});
it('retains and validates project relations without rewriting their identities', () => {
  const legacy: WorkspaceRelation[] = [
    { id: 'c00001', type: 'member', source: alice, target: project, custom: 'preserved' },
    { id: 'c00002', type: 'contains', source: project, target: task },
  ];
  expect(coreRelationTypes.map((type) => type.type)).toContain('member');
  expect(coreRelationTypes.map((type) => type.type)).toContain('contains');
  expect(parseRelations(JSON.stringify({ version: 1, relations: legacy })).relations).toEqual(legacy);
  expect(new RelationIndex(legacy).traverse(alice, 2)).toEqual([project, task]);
  for (const row of legacy) expect(() => validateRelation(row, coreRelationTypes)).not.toThrow();
  for (const row of rows.slice(1))
    expect(() => validateRelation(row, coreRelationTypes)).not.toThrow();
  const plugin = bundledObjectPlugins[0]!;
  expect(() => parseObjectPlugin(JSON.stringify({ ...plugin, relationTypes: [
    { type: 'research.links', label: '关联项目', sourceTypes: ['research.paper'], targetTypes: ['project'] },
  ] }))).not.toThrow();
});
