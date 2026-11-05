// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { commentMentionEvents, emptyAgentInbox, parseAgentInbox, parseAssistantSession } from '@tano/protocol';
import type { AssistantSession, AssistantTransport } from '@tano/protocol';
import { DemoAdapter } from '../adapter';
import { configureWorkbench } from '../runtime';
import { useWorkspaceStore } from '../stores/workspace';
import { loadCommentFile, saveCommentChange } from '../workspace-comments';
import { createAgentTaskRunner } from './agent-runner';
import { AgentTaskQueue } from './inbox';

let pinia: ReturnType<typeof createPinia>;
let workspace: ReturnType<typeof useWorkspaceStore>;
afterEach(() => { workspace?.dispose(); if (pinia) disposePinia(pinia); vi.restoreAllMocks(); localStorage.clear(); });

async function fixture(question = false, signal?: AbortSignal) {
  const adapter = new DemoAdapter({ files: { 'note.md': '请审阅这份计划。' } });
  const sessions: AssistantSession[] = [];
  const request = vi.fn(async (_id, _request, _signal, chunk) => {
    const delta = question ? { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: {
      name: 'ask_user', arguments: JSON.stringify({ questions: [{ id: 'scope', question: '请补充目标读者' }] }),
    } }] } : { content: '已经检查，计划内容完整。' };
    chunk(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`));
  });
  const transport: AssistantTransport = { connections: async () => [{ id: 'connection', name: '审阅员', endpoint: '', tools: true, maxOutputTokens: 2048, hasKey: false }],
    models: async () => ['model'], request, saveConnection: vi.fn(), removeConnection: vi.fn(), deleteSession: vi.fn(),
    loadSessions: async () => sessions,
    saveSession: async value => { sessions.push(parseAssistantSession(JSON.parse(JSON.stringify(value)))); return value.revision + 1; } };
  const runtime = { adapter, native: false, mobile: false, assistant: transport };
  pinia = configureWorkbench(createPinia(), runtime); setActivePinia(pinia);
  workspace = useWorkspaceStore(); await workspace.openWorkspace();
  const workspaceId = workspace.workspace!.id;
  const fileId = workspace.workspace!.files.find(file => file.path === 'note.md')!.id;
  let state = emptyAgentInbox(workspaceId);
  state.bindings = [{ personId: 'a00001', connectionId: 'connection', model: 'model', enabled: true }];
  const queue = new AgentTaskQueue({ load: async () => structuredClone(state), compareExchange: async (next, revision) => {
    if (revision !== state.revision) return false;
    state = parseAgentInbox(structuredClone(next), workspaceId); return true;
  } });
  const comments = await saveCommentChange(adapter, 'discussion', fileId, { type: 'start', id: 'thread-0001',
    author: { id: 'human', name: '用户' }, body: '@审阅员 请检查', mentions: [{ personId: 'a00001', text: '@审阅员', id: 'mention-0001' }] });
  await queue.reconcile(workspaceId, { kind: 'discussion', fileId }, commentMentionEvents(workspaceId, comments, 'hash'));
  const task = (await queue.claim(workspaceId, 'runner'))!;
  return { adapter, fileId, sessions, task, request, queue, workspaceId, state: () => state,
    run: createAgentTaskRunner(queue, adapter, { workspace, runtime }, signal) };
}

it('runs the existing engine with a task-owned session and replies to the original comment', async () => {
  const f = await fixture();
  await f.run(f.task, '审阅员');
  expect(f.state().tasks[0].status).toBe('succeeded');
  expect(f.sessions.every(session => session.id === f.task.sessionId)).toBe(true);
  const { file } = await loadCommentFile(f.adapter, 'discussion', f.fileId);
  expect(file.threads[0].messages[1]).toMatchObject({ body: '已经检查，计划内容完整。', authorId: 'a00001',
    replyTo: 'thread-0001', agentTaskId: f.task.id });
  expect(f.request).toHaveBeenCalledTimes(1);
});

it('returns an unstarted task to the queue when the workspace handoff cancels its runner', async () => {
  const abort = new AbortController();
  const f = await fixture(false, abort.signal);
  abort.abort();
  await f.run(f.task, '审阅员');
  expect(f.state().tasks[0].status).toBe('queued');
  expect(f.request).not.toHaveBeenCalled();
  expect(f.sessions).toHaveLength(0);
});

it('persists clarification in the original discussion and releases execution instead of spinning', async () => {
  const f = await fixture(true);
  await f.run(f.task, '审阅员');
  expect(f.state().tasks[0].status).toBe('waiting');
  const { file } = await loadCommentFile(f.adapter, 'discussion', f.fileId);
  expect(file.threads[0].messages[1].body).toBe('请补充目标读者');
  expect(f.sessions.at(-1)?.messages.at(-1)?.state).toBe('waiting');
  expect(f.request).toHaveBeenCalledTimes(1);
  const questionId = f.state().tasks[0].result!.messageId;
  await saveCommentChange(f.adapter, 'discussion', f.fileId, { type: 'reply', threadId: 'thread-0001',
    id: 'answer-00001', body: '面向团队成员', author: { id: 'human', name: '用户' }, replyTo: questionId });
  await f.queue.resume(f.workspaceId, f.task.id, { messageId: 'answer-00001', body: '面向团队成员', threadId: 'thread-0001' }, questionId);
  f.request.mockImplementationOnce(async (_id, request, _signal, chunk) => {
    expect(request.messages.at(-1)?.content).toContain('面向团队成员');
    chunk(new TextEncoder().encode('data: {"choices":[{"index":0,"delta":{"content":"已按团队读者完成检查"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
  });
  const resumed = (await f.queue.claim(f.workspaceId, 'runner'))!;
  await f.run(resumed, '审阅员', f.sessions.at(-1));
  expect(f.state().tasks[0].status).toBe('succeeded');
  const updated = await loadCommentFile(f.adapter, 'discussion', f.fileId);
  expect(updated.file.threads[0].messages.at(-1)).toMatchObject({ replyTo: 'answer-00001', body: '已按团队读者完成检查' });
});
