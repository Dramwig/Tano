import { describe, expect, it } from 'vitest';
import { parseAssistantSession } from '@tano/protocol';
import type { AssistantMessage, AssistantProposal, AssistantToolResult } from '@tano/protocol';
import { assistantHistory, assistantResultNotice } from './results';

const message = (extra: Partial<AssistantMessage> = {}): AssistantMessage => ({
  id: 'reply', role: 'assistant', content: '我已经提出了创建 test.md 的建议，请采纳。', createdAt: 1, state: 'completed', ...extra,
});
const proposal = (status: AssistantProposal['status']): AssistantProposal => ({
  id: status, runId: 'reply', workspaceId: 'workspace', kind: 'create', path: `${status}.md`,
  base: '', content: '# Test', reason: 'test', status,
});

describe('application-recorded assistant results', () => {
  it('corrects legacy claims with an empty proposal list and distinguishes missing receipts', () => {
    const previous = message();
    const [wire] = assistantHistory([previous]);
    expect(wire.role).toBe('assistant');
    expect(JSON.parse(wire.content!)).toEqual({ answer: previous.content,
      execution: { state: 'completed', tools: null, proposals: [] } });
    expect(assistantResultNotice(previous)).toBe('本轮未生成修改建议，未写入文件。');
    expect(assistantResultNotice(message({ state: 'running' }))).toBe('');
    expect(assistantResultNotice(message({ role: 'user' }))).toBe('');
  });

  it('preserves failed and interrupted turns and live review states without resending document contents', () => {
    const proposals = ['ready', 'applied', 'rejected', 'unknown', 'applying', 'conflicted'].map(status => proposal(status as AssistantProposal['status']));
    proposals.push({ ...proposal('ready'), id: 'per-edit', suggestionGroupId: 'group' });
    const user = message({ id: 'user', role: 'user', content: '创建文档' });
    const failed = message({ state: 'failed', error: '连接中断', toolResults: [{ name: 'propose_create', status: 'failed', error: '路径无效' }] });
    const history = assistantHistory([user, failed, message({ id: 'latest', state: 'interrupted', proposals })]);
    expect(history[0]).toEqual({ role: 'user', content: '创建文档' });
    expect(JSON.parse(history[1].content!).execution).toMatchObject({ state: 'failed', error: '连接中断', tools: failed.toolResults, proposals: [] });
    const execution = JSON.parse(history[2].content!).execution;
    expect(execution.state).toBe('interrupted');
    expect(execution.proposals.map((item: { written: unknown }) => item.written)).toEqual([false, true, false, null, null, false, null]);
    expect(execution.proposals.at(-1).review).toBe('document');
    expect(history[2].content).not.toContain('# Test');
    expect(assistantResultNotice(message({ proposals }))).toBe('');
    proposals[0].status = 'rejected';
    expect(JSON.parse(assistantHistory([message({ proposals })])[0].content!).execution.proposals[0].status).toBe('rejected');
  });

  it('validates receipts and keeps legacy sessions readable', () => {
    const parse = (reply: AssistantMessage) => parseAssistantSession({ version: 1, id: 'session-test', workspaceId: 'workspace',
      title: 'test', createdAt: 1, updatedAt: 1, revision: 0, messages: [reply] });
    expect(parse(message()).messages[0].toolResults).toBeUndefined();
    const valid: AssistantToolResult[] = [{ name: 'read_document', status: 'succeeded' },
      { name: 'propose_create', status: 'failed', error: '路径无效' },
      { name: 'propose_create', status: 'succeeded', proposalId: 'ready' }];
    expect(parse(message({ proposals: [proposal('ready')], toolResults: valid })).messages[0].toolResults).toEqual(valid);
    for (const toolResults of [[{ name: 'propose_create', status: 'succeeded', proposalId: 'missing' }],
      [{ name: 'propose_create', status: 'failed' }], [{ name: 'read_document', status: 'invalid' }],
      [{ name: '', status: 'succeeded' }], [{ name: 'read_document', status: 'succeeded', error: 'error' }],
      Array.from({ length: 161 }, () => valid[0])]) {
      expect(() => parse(message({ toolResults: toolResults as AssistantToolResult[] }))).toThrow('工具回执');
    }
  });
});
