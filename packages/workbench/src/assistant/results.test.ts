import { describe, expect, it } from 'vitest';
import { parseAssistantSession, parseAssistantQuestions, parseAssistantAnswers } from '@tano/protocol';
import type { AssistantMessage, AssistantProposal, AssistantToolResult } from '@tano/protocol';
import { assistantHistory, assistantMessageParts, assistantDisplayParts, assistantAnswerText } from './results';

const message = (extra: Partial<AssistantMessage> = {}): AssistantMessage => ({
  id: 'reply', role: 'assistant', content: '我已经提出了创建 test.md 的建议，请采纳。', createdAt: 1, state: 'completed', ...extra,
});
const proposal = (status: AssistantProposal['status']): AssistantProposal => ({
  id: status, runId: 'reply', workspaceId: 'workspace', kind: 'create', path: `${status}.md`,
  base: '', content: '# Test', reason: 'test', status,
});

describe('application-recorded assistant results', () => {
  it('validates termination separately from text phases and retains multiple final text spans', () => {
    const parse = (value: AssistantMessage) => parseAssistantSession({ version: 1, id: 'session-test', workspaceId: 'workspace',
      title: 'test', createdAt: 1, updatedAt: 1, revision: 0, messages: [value] });
    const reply = message({ content: 'workpart1part2', termination: { reason: 'completed' }, activity: [
      { kind: 'text', start: 0, end: 4, phase: 'working' },
      { kind: 'text', start: 4, end: 9, phase: 'answer' },
      { kind: 'text', start: 9, end: 14, phase: 'answer' },
    ] });
    expect(assistantAnswerText(parse(reply).messages[0])).toBe('part1\n\npart2');
    for (const extra of [{ state: 'running' }, { state: 'waiting' }, { state: 'failed' }, { role: 'user' },
      { termination: { reason: 'bogus' } }, { termination: { reason: 'round_limit' } }])
      expect(() => parse({ ...reply, ...extra } as AssistantMessage)).toThrow('消息格式');
    expect(parse(message({ state: 'waiting' })).messages[0].state).toBe('waiting');
  });
  it.each(['failed', 'cancelled', 'interrupted'] as const)('never exposes incomplete %s prose as a final answer, including legacy records', state => {
    for (const activity of [undefined, [{ kind: 'text' as const, start: 0, end: 4, phase: 'answer' as const }]]) {
      const reply = message({ state, content: 'part', activity });
      expect(assistantAnswerText(reply)).toBe('');
      expect(assistantDisplayParts(reply).answer).toEqual([]);
      expect(assistantDisplayParts(reply).process).toHaveLength(1);
    }
  });
  it('separates intermediate work from the final answer and validates persisted activity references', () => {
    const reply = message({ content: '先查资料。\n\n最终总结。', toolResults: [{ name: 'search_documents', status: 'succeeded' }], activity: [
      { kind: 'text', start: 0, end: 5, phase: 'working' },
      { kind: 'tool', name: 'search_documents', status: 'succeeded', resultIndex: 0 },
      { kind: 'text', start: 7, end: 12, phase: 'answer' },
    ] });
    const parse = (value: AssistantMessage) => parseAssistantSession({ version: 1, id: 'session-test', workspaceId: 'workspace',
      title: 'test', createdAt: 1, updatedAt: 1, revision: 0, messages: [value] });
    const restored = parse(JSON.parse(JSON.stringify(reply))).messages[0];
    expect(assistantDisplayParts(restored).process.map(part => part.kind)).toEqual(['text', 'tool']);
    expect(assistantAnswerText(restored)).toBe('最终总结。');
    expect(assistantAnswerText(message())).toBe(message().content);
    expect(assistantDisplayParts(message()).process).toEqual([]);
    for (const activity of [
      [{ kind: 'text', start: 0, end: 99, phase: 'working' }],
      [{ kind: 'tool', name: 'search_documents', status: 'succeeded', resultIndex: 1 }],
      [{ kind: 'tool', name: 'read_document', status: 'succeeded', resultIndex: 0 }],
      [{ kind: 'tool', name: 'search_documents', status: 'failed', resultIndex: 0 }],
      [{ kind: 'input', inputId: 'missing' }],
      [reply.activity![2], reply.activity![0]],
      [{ kind: 'text', start: 0, end: 4, phase: 'answer' }, { kind: 'text', start: 4, end: 9, phase: 'working' }],
    ]) expect(() => parse({ ...reply, activity } as AssistantMessage)).toThrow('执行过程');
  });
  it('keeps question answers between the preceding explanation and the continued response', () => {
    const input = { id: 'ask', contentOffset: 3, questions: [{ id: 'topic', question: '主题？' }, { id: 'reader', question: '读者？' }],
      answers: [{ questionId: 'topic', answer: '上线计划' }, { questionId: 'reader', answer: null }], status: 'answered' as const };
    const reply = message({ content: '先问。再写。', userInputs: [input] });
    expect(assistantMessageParts(reply)).toEqual([{ kind: 'text', content: '先问。' }, { kind: 'input', input }, { kind: 'text', content: '再写。' }]);
    const history = assistantHistory([reply]);
    expect(history.map(item => item.role)).toEqual(['assistant', 'user', 'assistant']);
    expect(JSON.parse(history[1].content!)).toEqual({ questions: input.questions, answers: input.answers });
    expect(JSON.parse(history[2].content!).answer).toBe('再写。');
  });
  it('validates question batches, answer identities and stored transcript offsets', () => {
    const questions = [{ id: 'topic', question: '主题？', options: ['计划', '报告'] }];
    expect(parseAssistantQuestions(questions)).toEqual(questions);
    expect(parseAssistantAnswers([{ questionId: 'topic', answer: null }], questions)[0].answer).toBeNull();
    for (const invalid of [[], [...questions, ...questions], [{ id: 'bad id', question: '主题？' }], [{ id: 'topic', question: '' }],
      [{ ...questions[0], options: ['重复', '重复'] }], Array.from({ length: 9 }, (_, i) => ({ id: String(i), question: '问题' }))])
      expect(() => parseAssistantQuestions(invalid)).toThrow();
    expect(() => parseAssistantAnswers([{ questionId: 'wrong', answer: 'test' }], questions)).toThrow();
    const session = { version: 1, id: 'test-session', workspaceId: 'workspace', title: 'test', createdAt: 1, updatedAt: 1, revision: 0,
      messages: [message({ userInputs: [{ id: 'ask', contentOffset: 0, questions, status: 'pending' }] })] };
    expect(parseAssistantSession(session).messages[0].userInputs![0].status).toBe('pending');
    session.messages[0].userInputs![0].contentOffset = 10000;
    expect(() => parseAssistantSession(session)).toThrow('提问记录');
  });
  it('corrects legacy claims with an empty proposal list and distinguishes missing receipts', () => {
    const previous = message();
    const [wire] = assistantHistory([previous]);
    expect(wire.role).toBe('assistant');
    expect(JSON.parse(wire.content!)).toEqual({ answer: previous.content,
      execution: { state: 'completed', tools: null, proposals: [] } });
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
