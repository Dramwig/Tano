// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { parseObject, parseRelations, relationPath } from '@tano/protocol';
import type { AssistantToolCall } from '@tano/protocol';
import { configureWorkbench } from '../runtime';
import { DemoAdapter } from '../adapter';
import { useWorkspaceStore } from '../stores/workspace';

let pinia: ReturnType<typeof createPinia>;
let adapter: DemoAdapter;
let store: ReturnType<typeof useWorkspaceStore>;
const call = (name: string, args: unknown): AssistantToolCall => ({ id: crypto.randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } });
const scope = () => ({ id: store.workspace!.id, path: store.workspace!.path, epoch: store.assistantEpoch });
beforeEach(async () => {
  localStorage.clear(); adapter = new DemoAdapter();
  pinia = configureWorkbench(createPinia(), { adapter, native: false, mobile: false });
  setActivePinia(pinia); store = useWorkspaceStore(); await store.openWorkspace();
});
afterEach(() => { store.dispose(); disposePinia(pinia); vi.restoreAllMocks(); });
async function task(name = '验收') {
  return store.createObject({ type: 'event', name, description: '依据 [@纪要](object://document/a00001)\n待核对',
    archived: false, properties: { checkable: true, completed: false, due: '2026-10-03', custom: '保留' } });
}
async function apply(proposal: Awaited<ReturnType<typeof store.proposeAssistantStructure>>) {
  const preview = await store.reviewAssistantProposal(scope(), proposal);
  expect(preview.status).toBe('preview');
  expect((await store.reviewAssistantProposal(scope(), proposal, preview.preview)).status).toBe('saved');
}
it('proposes three independent postponements from a read snapshot and writes only after review', async () => {
  const tasks = await Promise.all(['一', '二', '三'].map(name => task(name)));
  const snapshot = await store.assistantStructures(scope());
  const proposals = await Promise.all(tasks.map(record => store.proposeAssistantStructure(scope(), 'run', call('propose_task_update', {
    target: { type: 'event', id: record.object.id }, patch: { properties: { due: '2026-10-09' } }, reason: '推迟到下周五',
  }), snapshot)));
  for (let i = 0; i < tasks.length; i++) {
    expect(parseObject((await adapter.read(tasks[i].path)).content).properties.due).toBe('2026-10-03');
    await apply(proposals[i]);
    const current = parseObject((await adapter.read(tasks[i].path)).content);
    expect(current.properties).toMatchObject({ due: '2026-10-09', custom: '保留', completed: false });
    expect(current.description).toBe(tasks[i].object.description);
  }
});
it('preserves independent external description edits and refuses a same-field change made after the model read', async () => {
  const record = await task(); const snapshot = await store.assistantStructures(scope());
  await store.updateObject(record, { ...record.object, description: record.object.description + '\n外部补充' }, scope().id);
  const proposal = await store.proposeAssistantStructure(scope(), 'run', call('propose_task_update', {
    target: { type: record.object.type, id: record.object.id }, patch: { properties: { completed: true } }, reason: '验收记录 [来源:S1] 已确认通过',
  }), snapshot);
  expect(proposal.base).toBe(record.snapshot.content);
  const preview = await store.reviewAssistantProposal(scope(), proposal);
  expect(preview.preview?.after).toContain('外部补充');
  await store.updateObject(store.objects.find(item => item.object.id === record.object.id)!, {
    ...record.object, description: record.object.description + '\n外部补充', properties: { ...record.object.properties, due: '2026-10-08' },
  }, scope().id);
  const stale = await store.reviewAssistantProposal(scope(), proposal, preview.preview);
  expect(stale.status).toBe('stale');
  expect((await store.reviewAssistantProposal(scope(), proposal, stale.preview)).status).toBe('saved');
  const dueProposal = await store.proposeAssistantStructure(scope(), 'run', call('propose_task_update', {
    target: { type: 'event', id: record.object.id }, patch: { properties: { due: '2026-10-09' } }, reason: '改期',
  }), snapshot);
  expect((await store.reviewAssistantProposal(scope(), dueProposal)).status).toBe('conflict');
  expect(parseObject((await adapter.read(record.path)).content).properties.due).toBe('2026-10-08');
});
it('replaces or clears assignees and protects the whole assignment group against concurrent changes', async () => {
  const record = await task();
  const people = await Promise.all(['Alice', 'Bob', 'Carol'].map(name => store.createObject({ type: 'person', name, description: '', archived: false, properties: {} })));
  const target = { type: 'event', id: record.object.id };
  await store.setRelationSource('assigned', target, people[0].object);
  const snapshot = await store.assistantStructures(scope());
  const propose = (personId: string | null) => store.proposeAssistantStructure(scope(), 'run', call('propose_assignment', { target, personId, reason: '调整负责人' }), snapshot);
  const proposal = await propose(people[1].object.id);
  const preview = await store.reviewAssistantProposal(scope(), proposal);
  expect(parseRelations(preview.preview!.after).relations[0].source.id).toBe(people[1].object.id);
  await store.createRelation('assigned', people[2].object, target);
  expect((await store.reviewAssistantProposal(scope(), proposal, preview.preview)).status).toBe('conflict');
  expect(store.relations.filter(row => row.type === 'assigned')).toHaveLength(2);
  const fresh = await store.assistantStructures(scope());
  await apply(await store.proposeAssistantStructure(scope(), 'run', call('propose_assignment', { target, personId: people[1].object.id, reason: '确认替换' }), fresh));
  expect(store.relations).toHaveLength(1);
  const clear = await store.assistantStructures(scope());
  await apply(await store.proposeAssistantStructure(scope(), 'run', call('propose_assignment', { target, personId: null, reason: '清除分配' }), clear));
  expect(parseRelations((await adapter.read(relationPath)).content).relations).toEqual([]);
});
it('maintains a relation identity, merges unrelated edges and conflicts on changed edges', async () => {
  const records = await Promise.all(['A', 'B', 'C'].map(name => task(name)));
  await store.createRelation('related', records[0].object, records[1].object);
  const snapshot = await store.assistantStructures(scope());
  const row = snapshot.relations[0];
  const proposal = await store.proposeAssistantStructure(scope(), 'run', call('propose_relation_change', {
    relationId: row.id, action: 'update', type: 'related', source: row.source,
    target: { type: 'event', id: records[2].object.id }, reason: '更新关联',
  }), snapshot);
  await store.createRelation('related', records[1].object, records[2].object);
  await apply(proposal);
  expect(store.relations.find(edge => edge.id === row.id)?.target.id).toBe(records[2].object.id);
  expect(store.relations).toHaveLength(2);
  const remove = await store.proposeAssistantStructure(scope(), 'run', call('propose_relation_change', {
    relationId: row.id, action: 'remove', type: null, source: null, target: null, reason: '移除过时关联',
  }), snapshot);
  expect((await store.reviewAssistantProposal(scope(), remove)).status).toBe('conflict');
  const fresh = await store.assistantStructures(scope());
  await apply(await store.proposeAssistantStructure(scope(), 'run', call('propose_relation_change', {
    relationId: row.id, action: 'remove', type: null, source: null, target: null, reason: '确认移除',
  }), fresh));
  expect(store.relations).toHaveLength(1);
});
it('requires a read snapshot and rejects protected or malformed task patches', async () => {
  const record = await task(); const target = { type: 'event', id: record.object.id };
  await expect(store.proposeAssistantStructure(scope(), 'run', call('propose_task_update', { target, patch: { name: '新任务' }, reason: '更新' }))).rejects.toThrow('快照');
  const snapshot = await store.assistantStructures(scope());
  for (const patch of [{ type: 'person' }, { properties: { checkable: false } }, { properties: { due: '下周五' } }, { properties: { completed: null } }])
    await expect(store.proposeAssistantStructure(scope(), 'run', call('propose_task_update', { target, patch, reason: '更新' }), snapshot)).rejects.toThrow();
});
it('queries updated meeting drafts, separates progress with sources and requires checking existing tasks before creation', async () => {
  await adapter.create('项目/会议.md', '# 初始会议'); await store.refresh();
  const document = store.workspace!.files.find(file => file.path === '项目/会议.md')!;
  const record = await task('核对发布清单');
  await store.updateObject(record, { ...record.object, description: `[@会议](object://document/${document.id})`, properties: { ...record.object.properties, due: '2000-01-01', syncRemoteId: 'provider-id', syncConnection: 'connection-id' } }, scope().id);
  await store.openFile(document); store.edit(`# 更新会议\n\n[@清单](object://event/${record.object.id})\n新增部署检查。`);
  const snapshot = await store.assistantStructures(scope());
  const result = await store.assistantTaskQuery(scope(), { documentId: document.id, directory: null, state: 'unfinished', personId: null, query: null }, snapshot);
  expect(result.complete).toBe(true); expect(result.tasks).toHaveLength(1);
  expect(result.tasks[0]).toMatchObject({ id: record.object.id, status: '逾期', blockedReason: '未知' });
  expect(result.tasks[0]!.evidence).toHaveLength(2);
  expect(result.tasks[0]!.evidence.every(edge => edge.document.id === document.id)).toBe(true);
  const create = call('propose_event', { name: '部署检查', description: `[@会议](object://document/${document.id})`, properties: { checkable: true }, reason: '会议新增行动项' });
  await expect(store.proposeAssistantStructure(scope(), 'run', create)).rejects.toThrow('检查已有任务');
  await apply(await store.proposeAssistantStructure(scope(), 'run', create, snapshot));
  const modify = await store.proposeAssistantStructure(scope(), 'run', call('propose_task_update', { target: { type: record.object.type, id: record.object.id }, patch: { properties: { due: '2100-01-01' } }, reason: '改期' }), snapshot);
  await apply(modify);
  const updated = parseObject((await adapter.read(record.path)).content);
  expect(updated.properties).toMatchObject({ syncRemoteId: 'provider-id', syncConnection: 'connection-id', due: '2100-01-01' });
  expect(updated.description).toContain(`object://document/${document.id}`);
  const fresh = await store.assistantStructures(scope());
  const progress = await store.assistantTaskQuery(scope(), { documentId: null, directory: '项目', state: 'all', personId: null, query: null }, fresh);
  expect(progress.totals).toEqual({ completed: 0, pending: 2, overdue: 0 });
});
