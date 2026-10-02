import { expect, it } from 'vitest';
import type { ReferenceTarget, WorkspaceRelation } from '@tano/protocol';
import { referenceKey } from '@tano/protocol';
import { contentReferences } from '../content-references';
import { parseTaskQuery, possibleDuplicateTasks, queryTasks } from './tasks';

const doc = (id: string, path: string): ReferenceTarget => ({ type: 'document', id, name: path, path, workspace: 'workspace' });
const task = (id: string, name: string, properties = {}): ReferenceTarget => ({ type: 'event', id, name, path: `.tano/objects/${id}.tano.json`, workspace: 'workspace', properties: { checkable: true, ...properties } });
const query = { documentId: null, directory: null, state: 'all' as const, personId: null, query: null };
it('uses both link directions and relations, preserves owners and separates completed, pending and overdue by local day', () => {
  const targets = [doc('a00001', '项目/方案.md'), doc('a00002', '项目/会议.md'), doc('a00003', '项目二/会议.md'),
    task('e00001', '核对清单', { due: '2026-10-02' }), task('e00002', '发布', { due: '2026-10-03', date: '2026-10-09', blockedReason: '等待验收' }),
    task('e00003', '完成事项', { completed: true, due: '2026-10-01' }), task('e00004', '别的目录'),
    { type: 'person', id: 'f00001', name: '小王', path: '', workspace: 'workspace' }];
  targets[4]!.description = '[@方案](object://document/a00001)';
  const contents = new Map([[referenceKey(targets[0]!), '核对 [@清单](object://event/e00001)'],
    [referenceKey(targets[2]!), '[@外部](object://event/e00004)'], [referenceKey(targets[4]!), targets[4]!.description!]]);
  const relations: WorkspaceRelation[] = [{ id: 'b00001', type: 'assigned', source: { type: 'person', id: 'f00001' }, target: { type: 'event', id: 'e00001' } },
    { id: 'b00002', type: 'related', source: { type: 'document', id: 'a00002' }, target: { type: 'event', id: 'e00003' } }];
  const result = queryTasks(targets, relations, contentReferences(targets, contents), { ...query, directory: '项目' }, '2026-10-03');
  expect(result.totals).toEqual({ completed: 1, pending: 1, overdue: 1 });
  expect(result.tasks.map(task => task.id)).toEqual(['e00001', 'e00002', 'e00003']);
  expect(result.tasks[0]).toMatchObject({ url: 'object://event/e00001', status: '逾期', blockedReason: '未知', assignees: [{ name: '小王' }], evidence: [{ document: { id: 'a00001' }, excerpt: '核对 @清单' }] });
  expect(result.tasks[1]).toMatchObject({ status: '待处理', date: '2026-10-09', blockedReason: '等待验收', evidence: [{ kind: '任务引用文档' }] });
  const unfinished = queryTasks(targets, relations, contentReferences(targets, contents), { ...query, documentId: 'a00001', state: 'unfinished', personId: 'f00001' }, '2026-10-03');
  expect(unfinished.tasks.map(task => task.id)).toEqual(['e00001']);
});
it('rejects unavailable documents, invalid paths and contradictory scopes; excludes archived and inaccessible tasks', () => {
  for (const invalid of [{ ...query, directory: '../私密' }, { ...query, directory: '项目', documentId: 'a00001' }, { ...query, state: 'unknown' }, { ...query, personId: 1 }])
    expect(() => parseTaskQuery(invalid)).toThrow();
  expect(() => queryTasks([], [], [], { ...query, documentId: 'a00001' })).toThrow('不可用');
  expect(queryTasks([{ ...task('e00001', '已归档'), archived: true }], [], [], query).tasks).toEqual([]);
});
it('marks title similarity as possible duplicates without collapsing distinct task identities', () => {
  const targets = [task('e00001', '核对 发布清单'), task('e00002', '核对发布清单（上线）'), task('e00003', '发文')];
  expect(possibleDuplicateTasks(targets, '核对发布清单').map(task => task.id)).toEqual(['e00001', 'e00002']);
  expect(possibleDuplicateTasks(targets, '发').map(task => task.id)).toEqual([]);
  expect(targets).toHaveLength(3);
});
