import { expect, it } from 'vitest';
import type { AssistantMessage, AssistantProposal } from '@tano/protocol';
import { inlineAssistantResult } from './inline-result';

const reply = (extra: Partial<AssistantMessage> = {}): AssistantMessage => ({
  id: 'reply', role: 'assistant', content: '请补充具体的修改要求。', createdAt: 1,
  state: 'completed', proposals: [], toolResults: [], ...extra,
});
const proposal = (extra: Partial<AssistantProposal> = {}): AssistantProposal => ({
  id: 'edit', runId: 'reply', workspaceId: 'workspace', kind: 'edit', fileId: 'file',
  path: 'note.md', base: 'old', content: 'new', reason: '改写', status: 'applied', execution: 'direct', ...extra,
});

it('keeps a successful clarification or text answer out of the failure state', () => {
  expect(inlineAssistantResult(reply())).toEqual({ state: 'response', message: '请补充具体的修改要求。' });
  expect(inlineAssistantResult(reply({ content: '  收到，测试正常。\n' }))).toEqual({ state: 'response', message: '收到，测试正常。' });
});
it('distinguishes a pending suggestion from a saved edit', () => {
  expect(inlineAssistantResult(reply({ proposals: [proposal({ execution: undefined, status: 'ready' })] })))
    .toEqual({ state: 'response', message: '已生成修改建议，请在对话中审阅' });
  const edit = proposal();
  expect(inlineAssistantResult(reply({ content: '已将选区改写为主动语态。', proposals: [edit] })))
    .toEqual({ state: 'completed', message: '已将选区改写为主动语态。', proposal: edit });
  expect(inlineAssistantResult(reply({ content: '', proposals: [edit] })))
    .toEqual({ state: 'completed', message: '我已完成更新。', proposal: edit });
});
it('shows actual tool, request and conflict errors and does not hide partial failures', () => {
  expect(inlineAssistantResult(reply({ toolResults: [{ name: 'edit_document', status: 'failed', error: '选区内容已变化' }] })))
    .toEqual({ state: 'error', message: '选区内容已变化' });
  expect(inlineAssistantResult(reply({ state: 'failed', error: '连接超时' })).message).toBe('连接超时');
  expect(inlineAssistantResult(undefined, '请先配置模型连接').message).toBe('请先配置模型连接');
  expect(inlineAssistantResult(reply({ proposals: [proposal(), proposal({ id: 'second', status: 'conflicted', error: '内容冲突' })] })))
    .toEqual({ state: 'error', message: '部分修改已保存；内容冲突' });
});
it('does not report an earlier corrected tool call as a failed saved edit', () => {
  expect(inlineAssistantResult(reply({ proposals: [proposal()], toolResults: [
    { name: 'edit_document', status: 'failed', error: '参数格式无效' },
    { name: 'edit_document', status: 'succeeded', proposalId: 'edit' },
  ] })).state).toBe('completed');
});
it('reports cancellation and an empty response without claiming an update', () => {
  expect(inlineAssistantResult(reply({ state: 'cancelled' }))).toEqual({ state: 'response', message: '已停止，未修改原文' });
  expect(inlineAssistantResult(reply({ state: 'cancelled', proposals: [proposal()] })).message).toBe('已停止，已完成的修改已保留');
  expect(inlineAssistantResult(reply({ content: '' })).state).toBe('response');
});
