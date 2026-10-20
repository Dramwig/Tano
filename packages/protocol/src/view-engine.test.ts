import { expect, it } from 'vitest';
import { defaultObjectViewQuery, viewEngine } from './view-engine';
import { schemaRegistry } from './object-types';
import type { WorkspaceObject, WorkspaceRelation } from './index';
const rows: WorkspaceObject[] = ['task', 'project', 'experiment'].map((type, i) => ({ version: 1, id: `aaaaa${i}`, type, name: `Record ${i}`, description: '', archived: false, properties: { status: i ? '进行中' : '待处理', metric: [20, 3, 100][i] } }));
it('shares the same record identities and references across table, board and gallery', () => {
  const query = defaultObjectViewQuery();
  const baseline = viewEngine.query(rows, query);
  for (const layout of ['table', 'board', 'gallery'] as const) {
    const result = viewEngine.query(rows, { ...query, layout });
    expect(result.rows).toEqual(baseline.rows);
    for (const row of result.rows) expect(rows.includes(row)).toBe(true);
    expect(result.groups.flatMap(group => group.rows).sort((a,b) => a.id.localeCompare(b.id))).toEqual(rows);
  }
  expect(rows).toHaveLength(3);
});
it('uses one filter/sort/relationship query for every layout, including numeric sorting and archive visibility', () => {
  const edges: WorkspaceRelation[] = [{ id: 'bbbbbb', type: 'contains', source: rows[1]!, target: rows[0]! }];
  const query = defaultObjectViewQuery(); query.sort.field = 'property:metric';
  expect(viewEngine.query(rows, query).rows.map(r => r.id)).toEqual(['aaaaa1', 'aaaaa0', 'aaaaa2']);
  query.relatedTo = { type: 'project', id: 'aaaaa1' };
  expect(viewEngine.query(rows, query, edges).rows).toEqual([rows[0]]);
  query.filters = [{ field: 'property:status', operator: 'equals', value: '进行中' }];
  expect(viewEngine.query(rows, query, edges).rows).toEqual([]);
  expect(viewEngine.query([{ ...rows[0]!, archived: true }], defaultObjectViewQuery()).rows).toEqual([]);
});
it('validates schemas and rejects duplicate record IDs instead of creating duplicate views', () => {
  for (const type of ['task', 'project', 'experiment']) expect(schemaRegistry.get(type)?.storage).toBe('record');
  expect(() => schemaRegistry.validate('experiment', { metric: 'not a number' })).toThrow();
  expect(() => schemaRegistry.validate('task', { due: '2026-02-30' })).toThrow();
  expect(() => schemaRegistry.validate('project', { custom: { preserved: true } })).not.toThrow();
  expect(() => viewEngine.query([rows[0]!, rows[0]!], defaultObjectViewQuery())).toThrow('重复');
});
