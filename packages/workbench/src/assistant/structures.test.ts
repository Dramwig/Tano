import { describe, expect, it } from 'vitest';
import { coreRelationTypes } from '@tano/protocol';
import type { AssistantToolCall } from '@tano/protocol';
import { structureProposal } from './structures';

const context = { workspaceId: 'workspace', runId: 'run', id: 'e00001', relationContent: '', relationTypes: coreRelationTypes,
  targets: [{ type: 'document', id: 'a00001', path: 'a.md', workspace: 'workspace', name: 'A' },
    { type: 'document', id: 'b00001', path: 'b.md', workspace: 'workspace', name: 'B' }] };
const call = (name: string, args: unknown): AssistantToolCall => ({ id: 'tool', type: 'function', function: { name, arguments: JSON.stringify(args) } });
describe('workspace structural suggestions', () => {
  it('uses the event model for workspace tasks and validates calendar properties', () => {
    const args = { name: '审阅论文', description: '核对引用', properties: { checkable: true, completed: false, due: '2026-10-03' }, reason: '安排后续工作' };
    const proposed = structureProposal(call('propose_event', args), context);
    expect(proposed.kind).toBe('object');
    expect(proposed.path).toBe('.tano/objects/e00001.tano.json');
    expect(JSON.parse(proposed.content)).toMatchObject({ type: 'event', properties: { checkable: true }, archived: false });
    expect(() => structureProposal(call('propose_event', { ...args, properties: { start: 'tomorrow' } }), context)).toThrow();
    expect(() => structureProposal(call('propose_event', { ...args, scope: 'personal' }), context)).toThrow('参数');
  });
  it('only proposes relations between actual available workspace identities', () => {
    const args = { type: 'related', source: { type: 'document', id: 'a00001' }, target: { type: 'document', id: 'b00001' }, reason: '资料关联' };
    const proposed = structureProposal(call('propose_relation', args), context);
    expect(proposed.kind).toBe('relation');
    expect(JSON.parse(proposed.content).relations).toHaveLength(1);
    expect(() => structureProposal(call('propose_relation', { ...args, target: { type: 'document', id: 'c00001' } }), context)).toThrow('不属于');
    expect(() => structureProposal(call('propose_relation', args), { ...context, relationContent: proposed.content, id: 'e00002' })).toThrow('已经存在');
    expect(() => structureProposal(call('propose_relation', { ...args, type: 'assigned' }), context)).toThrow('不支持');
  });
});
