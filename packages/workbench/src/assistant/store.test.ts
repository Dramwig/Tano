import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { reactive } from 'vue';
import type { AssistantProposal, AssistantSession, AssistantTransport, WorkspaceAdapter } from '@tano/protocol';
import { parseAssistantSession } from '@tano/protocol';
import { configureWorkbench, useWorkbenchRuntime } from '../runtime';
import { useAssistantStore, useInlineAssistantStore } from './store';

const fixture = vi.hoisted(() => ({ workspace: null as any }));
vi.mock('../stores/workspace', () => ({ useWorkspaceStore: () => fixture.workspace }));

const connection = { id: 'connection', name: 'test', endpoint: '', tools: true, hasKey: false, maxOutputTokens: 2048 };
const session = (): AssistantSession => ({ version: 1, id: crypto.randomUUID(), workspaceId: 'workspace', title: 'test',
  revision: 1, createdAt: 1, updatedAt: 1, messages: [] });
const proposal = (runId = 'reply'): AssistantProposal => ({ id: crypto.randomUUID(), runId, workspaceId: 'workspace',
  kind: 'edit', fileId: 'abc123', path: 'note.md', base: 'old', content: 'new', reason: 'test', status: 'ready',
  preview: { before: 'old', after: 'new', diskHash: 'old', path: 'note.md' } });

describe('assistant session coordination', () => {
  let pinia: ReturnType<typeof createPinia>;
  let transport: AssistantTransport;
  let history: AssistantSession[];
  beforeEach(() => {
    history = [];
    fixture.workspace = reactive({ workspace: { id: 'workspace', path: 'local', files: [] }, assistantEpoch: 1,
      capabilities: { features: { objectReferences: true } },
      activeId: 'abc123', tabs: [{ id: 'abc123' }, { id: 'other' }],
      panes: [{ id: 'pane', tabs: ['abc123', 'other'], activeId: 'abc123' }], createBlankTab: vi.fn(),
      assistantRules: vi.fn(async () => []), assistantSnapshot: vi.fn(), search: vi.fn(),
      reviewAssistantProposal: vi.fn(async () => ({ status: 'saved', applied: { before: 'old', after: 'new', hash: 'new', fileId: 'abc123' } })) });
    transport = {
      connections: vi.fn(async () => [connection]), saveConnection: vi.fn(), removeConnection: vi.fn(), request: vi.fn(),
      models: vi.fn(async () => ['test', 'other']),
      loadSessions: vi.fn(async () => structuredClone(history)), saveSession: vi.fn(async value => value.revision + 1), deleteSession: vi.fn(),
    };
    pinia = createPinia(); setActivePinia(pinia);
    configureWorkbench(pinia, { adapter: { mode: 'web' } as WorkspaceAdapter, native: false, mobile: false, assistant: transport });
  });
  afterEach(() => { disposePinia(pinia); vi.restoreAllMocks(); });
  async function ready() {
    const store = useAssistantStore();
    await vi.waitFor(() => expect(store.loading).toBe(false));
    return store;
  }
  it.each(['inline', 'panel'] as const)('runs inline and panel requests concurrently and stops only %s', async stopped => {
    const panel = await ready();
    const inline = useInlineAssistantStore();
    await vi.waitFor(() => expect(inline.loading).toBe(false));
    await panel.selectModel('test'); await inline.selectModel('other');
    const requests = new Map<string, { signal: AbortSignal; finish: () => void }>();
    vi.mocked(transport.request).mockImplementation(async (_id, request, signal, chunk) => {
      chunk(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'tano.progress', kind: request.model === 'test' ? 'thinking' : 'validating' })}\n\n`));
      await new Promise<void>((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        requests.set(request.model, { signal, finish: () => { signal.removeEventListener('abort', abort); resolve(); } });
      });
      chunk(new TextEncoder().encode('data: {"choices":[{"index":0,"delta":{"content":"完成"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
    });
    panel.open(); panel.prompt = '侧栏任务';
    const panelRun = panel.send();
    await vi.waitFor(() => expect(requests.has('test')).toBe(true));
    inline.newSession(); inline.prompt = '选区任务';
    const inlineRun = inline.send();
    await vi.waitFor(() => expect(requests.size).toBe(2));
    expect(panel.busy && inline.busy).toBe(true);
    expect(panel.opened).toBe(true); expect(inline.opened).toBe(false);
    expect(panel.progress).toBe('正在思考'); expect(inline.progress).toBe('正在核对回答');
    expect(panel.session!.id).not.toBe(inline.session!.id);
    expect(panel.session!.messages[0].content).toBe('侧栏任务');
    expect(inline.session!.messages[0].content).toBe('选区任务');
    expect(vi.mocked(transport.request).mock.calls[1][1].tools?.some(tool => tool.function.name === 'ask_user')).toBe(false);
    const cancelled = stopped === 'inline' ? inline : panel;
    const remaining = stopped === 'inline' ? panel : inline;
    cancelled.stop();
    await (stopped === 'inline' ? inlineRun : panelRun);
    expect(cancelled.session!.messages.at(-1)!.state).toBe('cancelled');
    expect(remaining.busy).toBe(true);
    const remainingRequest = requests.get(stopped === 'inline' ? 'test' : 'other')!;
    expect(remainingRequest.signal.aborted).toBe(false);
    remainingRequest.finish(); await Promise.all([panelRun, inlineRun]);
    expect(remaining.session!.messages.at(-1)!.state).toBe('completed');
    expect(panel.sessions.every(item => item.id !== inline.session!.id)).toBe(true);
  });
  it('starts the inline runner independently of restored conversation history', async () => {
    const restored = { ...session(), connectionId: connection.id, model: 'test' };
    history.push(restored);
    const panel = await ready(); const inline = useInlineAssistantStore();
    await vi.waitFor(() => expect(inline.loading).toBe(false));
    expect(panel.session!.id).toBe(restored.id);
    expect(inline.session!.id).not.toBe(restored.id);
    expect(inline.session!.messages).toEqual([]);
    expect(transport.loadSessions).toHaveBeenCalledOnce();
  });
  it.each([false, true])('starts a draft conversation without a fixed questionnaire (managed: %s)', async managed => {
    fixture.workspace.documents = [{ id: 'abc123', content: '', path: 'note.md' }];
    fixture.workspace.assistantSnapshot.mockResolvedValue({ id: 'S1', workspaceId: 'workspace', fileId: 'abc123', path: 'note.md', content: '', hash: 'empty', origin: 'disk' });
    vi.mocked(transport.request).mockImplementation(async (_id, _request, _signal, chunk) => {
      chunk(new TextEncoder().encode('data: {"choices":[{"index":0,"delta":{"content":"我会先整理已有资料。"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
    });
    const store = await ready(); await store.selectModel('test');
    store.setManaged(() => managed);
    const previous = store.session!.id;
    store.files = ['unrelated']; store.selection = { fileId: 'unrelated', text: 'old' };
    await store.startDocumentDraft('abc123');
    expect(store.session!.id).not.toBe(previous);
    expect(store.modelId).toBe('test');
    expect(store.files).toEqual(['abc123']);
    expect(store.selection).toBeNull();
    expect(store.displayMode).toBe('floating');
    expect(store.opened).toBe(true);
    expect(store.session!.messages[0].content).toBe('开始草稿');
    expect(store.session!.messages[1].content).toBe('我会先整理已有资料。');
    expect(store.pendingUserInput).toBeNull();
    expect(transport.request).toHaveBeenCalledOnce();
  });
  it('keeps the draft starter ready to send when no model is selected', async () => {
    fixture.workspace.documents = [{ id: 'abc123', content: '', path: 'note.md' }];
    const store = await ready(); await store.startDocumentDraft('abc123');
    expect(store.error).toContain('选择模型');
    expect(store.prompt).toBe('开始草稿');
    expect(transport.request).not.toHaveBeenCalled();
  });
  function askTwoQuestions() {
    vi.mocked(transport.request).mockImplementation(async (_id, request, _signal, chunk) => {
      const delta = request.messages.at(-1)?.role === 'tool' ? { content: '根据你的回答继续。' }
        : { content: '先确认两个问题。', tool_calls: [{ index: 0, id: 'questions', type: 'function', function: { name: 'ask_user', arguments: JSON.stringify({ questions: [
          { id: 'deadline', question: '什么时候交付？' }, { id: 'scope', question: '范围是什么？', options: ['全部', '第一阶段'] },
        ] }) } }] };
      chunk(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`));
    });
  }
  it('waits for real answers, persists skipped questions and resumes the same model tool call', async () => {
    askTwoQuestions();
    const store = await ready(); await store.selectModel('test'); store.prompt = '帮我安排项目';
    const run = store.send();
    await vi.waitFor(() => expect(store.pendingUserInput).not.toBeNull());
    const pending = store.pendingUserInput!;
    expect(pending.request.questions.map(question => question.id)).toEqual(['deadline', 'scope']);
    expect(store.busy).toBe(true); expect(transport.request).toHaveBeenCalledOnce();
    pending.values[0] = '下周五'; pending.step = 1;
    store.opened = false; store.open();
    expect(store.pendingUserInput!.values[0]).toBe('下周五');
    await store.submitUserInput('wrong-id'); expect(transport.request).toHaveBeenCalledOnce();
    await store.submitUserInput(pending.request.id); await run;
    expect(store.pendingUserInput).toBeNull(); expect(store.busy).toBe(false);
    expect(transport.request).toHaveBeenCalledTimes(2);
    const receipt = vi.mocked(transport.request).mock.calls[1][1].messages.find(message => message.role === 'tool');
    expect(receipt?.tool_call_id).toBe('questions');
    expect(JSON.parse(receipt!.content!)).toEqual({ status: 'answered', answers: [
      { questionId: 'deadline', answer: '下周五' }, { questionId: 'scope', answer: null },
    ] });
    const saved = parseAssistantSession(JSON.parse(JSON.stringify(store.session)));
    expect(saved.messages[1].userInputs![0].status).toBe('answered');
    expect(saved.messages[1].content).toContain('根据你的回答继续');
  });
  it('retains answers after a persistence failure and accepts a single successful retry', async () => {
    askTwoQuestions();
    const store = await ready(); await store.selectModel('test'); store.prompt = '安排项目';
    const run = store.send(); await vi.waitFor(() => expect(store.pendingUserInput).not.toBeNull());
    const pending = store.pendingUserInput!; pending.values[0] = '明天';
    vi.mocked(transport.saveSession).mockRejectedValueOnce(new Error('磁盘忙'));
    await store.submitUserInput(pending.request.id);
    expect(store.error).toContain('回答保存失败'); expect(pending.request.status).toBe('pending');
    expect(pending.values[0]).toBe('明天'); expect(transport.request).toHaveBeenCalledOnce();
    await store.submitUserInput(pending.request.id); await run;
    expect(transport.request).toHaveBeenCalledTimes(2);
  });
  it.each(['stop', 'workspace'])('cancels pending input on %s without continuing or accepting stale answers', async action => {
    askTwoQuestions();
    const store = await ready(); await store.selectModel('test'); store.prompt = '安排项目';
    const run = store.send(); await vi.waitFor(() => expect(store.pendingUserInput).not.toBeNull());
    const pending = store.pendingUserInput!;
    if (action === 'stop') store.stop();
    else fixture.workspace.assistantEpoch++;
    await run; await store.submitUserInput(pending.request.id);
    expect(store.pendingUserInput).toBeNull(); expect(pending.request.status).toBe('cancelled');
    expect(transport.request).toHaveBeenCalledOnce();
  });
  it('restores unfinished question records as interrupted without replaying a tool call', async () => {
    history = [{ ...session(), messages: [{ id: 'reply', role: 'assistant', content: '请补充', createdAt: 1, state: 'running',
      userInputs: [{ id: 'ask', contentOffset: 3, questions: [{ id: 'topic', question: '主题？' }], status: 'pending' }] }] }];
    const store = await ready();
    expect(store.session!.messages[0].state).toBe('interrupted');
    expect(store.session!.messages[0].userInputs![0].status).toBe('cancelled');
    expect(store.pendingUserInput).toBeNull();
    expect(transport.request).not.toHaveBeenCalled();
  });
  it('persists failed tool receipts and sends actual proposal state in the next conversation turn', async () => {
    const store = await ready(); await store.selectModel('test');
    let round = 0;
    vi.mocked(transport.request).mockImplementation(async (_id, request, _signal, chunk) => {
      round++;
      if (round === 3) {
        const previous = JSON.parse(request.messages.find(item => item.role === 'assistant')!.content!);
        expect(previous.answer).toContain('已提交');
        expect(previous.execution).toMatchObject({ proposals: [], tools: [{ name: 'propose_create', status: 'failed', error: expect.stringContaining('路径') }] });
      }
      const delta = round === 1 ? { tool_calls: [{ index: 0, id: 'invalid-create', type: 'function',
        function: { name: 'propose_create', arguments: JSON.stringify({ path: '../test.md', content: '# Test', reason: 'test' }) } }] }
        : { content: round === 2 ? '已提交创建建议' : '上一轮没有生成建议' };
      chunk(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`));
    });
    store.prompt = '创建 test.md'; await store.send();
    const saved = parseAssistantSession(JSON.parse(JSON.stringify(vi.mocked(transport.saveSession).mock.calls.at(-1)![0])));
    expect(saved.messages.at(-1)?.proposals).toEqual([]);
    expect(saved.messages.at(-1)?.toolResults).toEqual([{ name: 'propose_create', status: 'failed', error: expect.stringContaining('路径') }]);
    store.prompt = '建议在哪'; await store.send();
    expect(round).toBe(3);
    expect(fixture.workspace.reviewAssistantProposal).not.toHaveBeenCalled();
  });
  it('checks a connection independently of the selected conversation and without generating content', async () => {
    const store = await ready();
    store.connections.push({ ...connection, id: 'second' });
    store.modelId = 'chosen'; store.models = ['cached']; store.modelsError = 'previous';
    const currentSession = store.session;
    vi.mocked(transport.models).mockResolvedValue(['one', 'one', 'two']);
    const controller = new AbortController();
    expect(await store.checkConnection('second', controller.signal)).toBe(2);
    expect(transport.models).toHaveBeenCalledWith('second', controller.signal);
    expect(store.connectionId).toBe(connection.id);
    expect(store.modelId).toBe('chosen');
    expect(store.models).toEqual(['cached']);
    expect(store.modelsError).toBe('previous');
    expect(store.session).toBe(currentSession);
    expect(transport.request).not.toHaveBeenCalled();
    expect(transport.saveSession).not.toHaveBeenCalled();
  });
  it('rejects missing, malformed, failed, and cancelled connectivity checks', async () => {
    const store = await ready();
    const controller = new AbortController();
    await expect(store.checkConnection('removed', controller.signal)).rejects.toThrow('已移除');
    expect(transport.models).not.toHaveBeenCalled();
    vi.mocked(transport.models).mockResolvedValueOnce([' invalid ']);
    await expect(store.checkConnection(connection.id, controller.signal)).rejects.toThrow('模型列表格式无效');
    vi.mocked(transport.models).mockRejectedValueOnce(new Error('网络失败'));
    await expect(store.checkConnection(connection.id, controller.signal)).rejects.toThrow('网络失败');
    vi.mocked(transport.models).mockImplementationOnce(async () => { controller.abort(); return ['one']; });
    await expect(store.checkConnection(connection.id, controller.signal)).rejects.toThrow();
    vi.mocked(transport.models).mockClear();
    await expect(store.checkConnection(connection.id, controller.signal)).rejects.toThrow();
    expect(transport.models).not.toHaveBeenCalled();
  });
  it('changes display modes during a run without changing the conversation, draft or access', async () => {
    const store = await ready(); store.open();
    const current = store.session;
    store.prompt = 'draft'; store.files = ['abc123']; store.busy = true;
    store.setDisplayMode('floating');
    expect(store.displayMode).toBe('floating');
    store.setDisplayMode('fullscreen');
    expect(store.fullscreenTabId).toBe('abc123');
    expect(store.fullscreenPaneId).toBe('pane');
    expect(store.isFullscreenTab('abc123')).toBe(true);
    expect(store.isFullscreenTab('other')).toBe(false);
    fixture.workspace.activeId = 'other';
    expect(store.fullscreenTabId).toBe('abc123');
    store.setDisplayMode('sidebar');
    expect(store.fullscreenTabId).toBe('');
    expect(store.session).toBe(current);
    expect(store.prompt).toBe('draft');
    expect(store.files).toEqual(['abc123']);
    expect(store.busy).toBe(true);
    expect(transport.request).not.toHaveBeenCalled();
  });
  it('returns to the sidebar when the fullscreen tab closes or its workspace changes', async () => {
    const store = await ready(); store.open(); store.setDisplayMode('fullscreen');
    fixture.workspace.tabs = [{ id: 'other' }];
    await vi.waitFor(() => expect(store.displayMode).toBe('sidebar'));
    expect(store.opened).toBe(true);
    fixture.workspace.activeId = 'other'; store.setDisplayMode('fullscreen');
    fixture.workspace.assistantEpoch++;
    await vi.waitFor(() => expect(store.loading).toBe(false));
    expect(store.displayMode).toBe('sidebar');
    expect(store.fullscreenTabId).toBe('');
  });
  it('creates a blank tab for fullscreen when there is no current tab', async () => {
    const store = await ready(); store.open();
    fixture.workspace.activeId = ''; fixture.workspace.tabs = [];
    fixture.workspace.createBlankTab.mockImplementation(() => {
      fixture.workspace.activeId = 'blank:assistant';
      fixture.workspace.tabs = [{ id: 'blank:assistant' }];
    });
    store.setDisplayMode('fullscreen');
    expect(fixture.workspace.createBlankTab).toHaveBeenCalledOnce();
    expect(store.isFullscreenTab('blank:assistant')).toBe(true);
  });
  it('restores interrupted generation and unknown writes without restarting execution', async () => {
    const restored = session();
    restored.messages = [{ id: 'reply', role: 'assistant', content: 'partial', createdAt: 1, state: 'running', proposals: [{ ...proposal(), status: 'applying' }] }];
    history.push(restored);
    const store = await ready();
    expect(store.session!.messages[0].state).toBe('interrupted');
    expect(store.session!.messages[0].proposals![0].status).toBe('unknown');
    expect(transport.request).not.toHaveBeenCalled();
  });
  it('does not submit a write if persisting the application intent fails', async () => {
    const store = await ready();
    const item = proposal();
    vi.mocked(transport.saveSession).mockRejectedValue(new Error('disk full'));
    await store.review(item, true);
    expect(fixture.workspace.reviewAssistantProposal).not.toHaveBeenCalled();
    expect(item.status).toBe('ready');
    expect(store.error).toContain('disk full');
  });
  it('keeps a confirmed file receipt even when saving conversation history fails', async () => {
    const store = await ready();
    const item = proposal();
    vi.mocked(transport.saveSession).mockResolvedValueOnce(1).mockRejectedValue(new Error('history full'));
    await store.review(item, true);
    expect(item.status).toBe('applied');
    expect(item.applied?.after).toBe('new');
    expect(store.error).toContain('内容已保存');
  });
  it('marks a lost write receipt unknown and prevents blind resubmission', async () => {
    const store = await ready();
    const item = proposal();
    fixture.workspace.reviewAssistantProposal.mockRejectedValue(new Error('receipt lost'));
    await store.review(item, true);
    expect(item.status).toBe('unknown');
    await store.review(item, true);
    expect(fixture.workspace.reviewAssistantProposal).toHaveBeenCalledTimes(1);
  });
  it('verifies path changes using stable identity, and never infers successful deletion from absence', async () => {
    const store = await ready();
    const item: AssistantProposal = { ...proposal(), kind: 'rename', destination: 'next.md', status: 'unknown',
      preview: { before: 'old', after: 'old', path: 'note.md', destination: 'next.md', diskHash: 'old' } };
    const adapter = useWorkbenchRuntime().adapter;
    adapter.refresh = vi.fn(async () => ({ id: 'workspace', name: 'workspace', path: 'local', files: [
      { id: 'abc123', path: 'next.md', name: 'next.md', kind: 'file' as const, size: 3, modified: 1 },
    ] }));
    adapter.read = vi.fn(async () => ({ content: 'old', hash: 'old', modified: 1 }));
    await store.verify(item);
    expect(item.status).toBe('applied'); expect(item.applied?.fileId).toBe('abc123');
    const removed: AssistantProposal = { ...proposal(), kind: 'delete', content: '', status: 'unknown' };
    vi.mocked(adapter.refresh).mockResolvedValue({ id: 'workspace', name: 'workspace', path: 'local', files: [] });
    await store.verify(removed);
    expect(removed.status).toBe('unknown'); expect(store.error).toContain('无法确认');
    await store.review(removed, true);
    expect(fixture.workspace.reviewAssistantProposal).not.toHaveBeenCalled();
  });
  it('deletes using the loaded revision and retains local history on concurrent changes', async () => {
    const restored = session(); history.push(restored);
    const store = await ready();
    vi.mocked(transport.deleteSession).mockRejectedValue(new Error('changed in another window'));
    await expect(store.deleteSession(restored.id)).rejects.toThrow('another window');
    expect(transport.deleteSession).toHaveBeenCalledWith('workspace', restored.id, 1);
    expect(store.sessions).toHaveLength(1);
  });
  it('invalidates an active run when the same workspace is reopened', async () => {
    const store = await ready();
    await store.selectModel('test');
    vi.mocked(transport.request).mockImplementation(async (_id, _request, signal) => {
      await new Promise<void>((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    });
    store.prompt = 'question'; const sending = store.send();
    await vi.waitFor(() => expect(transport.request).toHaveBeenCalled());
    fixture.workspace.assistantEpoch++;
    await sending;
    await vi.waitFor(() => expect(store.loading).toBe(false));
    expect(store.busy).toBe(false);
    expect(store.session!.messages).toHaveLength(0);
  });
  it('imports an external proposal once and uses the same review coordinator', async () => {
    const external = session(); external.revision = 0; external.external = true;
    const item = { ...proposal(external.id), id: external.id };
    external.messages = [{ id: external.id, role: 'assistant', content: 'external', createdAt: 1, proposals: [item] }];
    transport.loadExternalSessions = vi.fn(async () => [external]);
    transport.recordExternalResult = vi.fn(async () => {});
    const store = await ready();
    await store.loadExternal(); expect(store.externalSessions).toHaveLength(1);
    await store.importExternal(store.externalSessions[0]);
    await store.review(store.session!.messages[0].proposals![0], true);
    expect(fixture.workspace.reviewAssistantProposal).toHaveBeenCalledTimes(1);
    expect(transport.recordExternalResult).toHaveBeenCalled();
    await store.loadExternal(); expect(store.externalSessions).toHaveLength(0);
  });
  it('settles cancellation before allowing a window to close', async () => {
    const store = await ready();
    await store.selectModel('test');
    vi.mocked(transport.saveSession).mockClear();
    vi.mocked(transport.request).mockImplementation(async (_id, _request, signal) => {
      await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true }));
    });
    store.prompt = 'question'; const sending = store.send();
    await vi.waitFor(() => expect(transport.request).toHaveBeenCalled());
    await store.settle(); await sending;
    expect(store.busy).toBe(false);
    expect(store.session!.messages.at(-1)?.state).toBe('cancelled');
    expect(transport.saveSession).toHaveBeenCalledTimes(2);
    expect(store.session!.messages.at(-1)?.timing?.firstContentMs).toBeUndefined();
    expect(store.session!.messages.at(-1)?.timing?.totalMs).toBeGreaterThanOrEqual(0);
  });
  it('persists task latency measured with a monotonic clock, ignoring empty chunks', async () => {
    const store = await ready();
    await store.selectModel('test');
    let elapsed = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
    vi.mocked(transport.request).mockImplementation(async (_id, _request, _signal, chunk) => {
      const frame = (content: string) => new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`);
      elapsed = 20; chunk(frame(''));
      elapsed = 150; chunk(frame('中文回答'));
      elapsed = 300; chunk(frame('补充内容'));
      elapsed = 450; chunk(new TextEncoder().encode('data: [DONE]\n\n'));
    });
    store.prompt = 'question'; await store.send();
    expect(store.session!.messages.at(-1)?.timing).toEqual({ firstContentMs: 150, totalMs: 450 });
    expect(vi.mocked(transport.saveSession).mock.calls.at(-1)?.[0].messages.at(-1)?.timing)
      .toEqual({ firstContentMs: 150, totalMs: 450 });
  });
  it('requires an explicit model before sending', async () => {
    const store = await ready();
    store.prompt = 'question'; await store.send();
    expect(store.error).toContain('选择模型');
    expect(transport.request).not.toHaveBeenCalled();
    expect(transport.saveSession).not.toHaveBeenCalled();
  });
  it('persists only the initially attached source IDs when tools read more documents', async () => {
    const store = await ready(); await store.selectModel('test');
    fixture.workspace.assistantSnapshot.mockImplementation(async (_scope: unknown, fileId: string) => ({
      id: '', workspaceId: 'workspace', fileId, path: `${fileId}.md`, content: '文档正文', hash: 'hash', origin: 'disk',
    }));
    store.files = ['attached'];
    let requests = 0;
    vi.mocked(transport.request).mockImplementation(async (_id, _request, _signal, chunk) => {
      const delta = requests++ % 2 === 0 ? { tool_calls: [{ index: 0, id: 'read-more', type: 'function',
        function: { name: 'read_document', arguments: JSON.stringify({ fileId: 'retrieved' }) } }] } : { content: '回答[来源:S1]' };
      chunk(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`));
    });
    store.prompt = '你好'; await store.send();
    const saved = parseAssistantSession(JSON.parse(JSON.stringify(vi.mocked(transport.saveSession).mock.calls.at(-1)![0])));
    expect(saved.messages.at(-1)?.sources?.map(source => source.fileId)).toEqual(['attached', 'retrieved']);
    expect(saved.messages.at(-1)?.attachedSourceIds).toEqual(['S1']);
    store.files = []; store.prompt = '继续'; await store.send();
    expect(store.session!.messages.at(-1)?.sources?.map(source => source.fileId)).toEqual(['retrieved']);
    expect(store.session!.messages.at(-1)?.attachedSourceIds).toEqual([]);
    expect(store.session!.messages[1]!.attachedSourceIds).toEqual(['S1']);
  });
  it('keeps document search available when workspace object features are disabled', async () => {
    fixture.workspace.capabilities.features.objectReferences = false;
    const store = await ready(); await store.selectModel('test'); store.prompt = '总结工作区'; await store.send();
    const names = vi.mocked(transport.request).mock.calls[0][1].tools!.map(tool => tool.function.name);
    expect(names).toContain('search_documents'); expect(names).toContain('read_document');
    expect(names).not.toContain('read_workspace_objects'); expect(names).not.toContain('query_tasks');
  });
  it('persists models separately for conversations and restores them after reopening', async () => {
    const store = await ready();
    await store.selectModel('test'); const first = store.session!.id;
    store.newSession(); await store.selectModel('other'); const second = store.session!.id;
    store.selectSession(first); expect(store.modelId).toBe('test');
    store.selectSession(second); expect(store.modelId).toBe('other');
    history = JSON.parse(JSON.stringify(store.sessions));
    fixture.workspace.assistantEpoch++;
    await vi.waitFor(() => expect(transport.loadSessions).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(store.loading).toBe(false));
    store.selectSession(first); expect(store.modelId).toBe('test');
    store.selectSession(second); expect(store.modelId).toBe('other');
  });
  it('persists reasoning per conversation, restores it, and validates saved selections', async () => {
    vi.mocked(transport.connections).mockResolvedValue([{ ...connection, kind: 'codex-cli', reasoningEffort: 'high' }]);
    const store = await ready();
    expect(store.reasoningEffort).toBe('high');
    await store.selectReasoningEffort('low'); const first = store.session!.id;
    store.newSession(); await store.selectReasoningEffort('cli-default'); const second = store.session!.id;
    store.selectSession(first); expect(store.reasoningEffort).toBe('low');
    store.selectSession(second); expect(store.reasoningEffort).toBe('cli-default');
    expect(transport.saveConnection).not.toHaveBeenCalled();
    history = JSON.parse(JSON.stringify(store.sessions));
    fixture.workspace.assistantEpoch++;
    await vi.waitFor(() => expect(transport.loadSessions).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(store.loading).toBe(false));
    store.selectSession(first); expect(store.reasoningEffort).toBe('low');
    store.selectSession(second); expect(store.reasoningEffort).toBe('cli-default');
    expect(() => parseAssistantSession({ ...session(), reasoningEffort: 'invalid' })).toThrow('助手会话格式无效');
  });
  it('sends the current conversation effort and locks it during generation', async () => {
    vi.mocked(transport.connections).mockResolvedValue([{ ...connection, kind: 'codex-cli', reasoningEffort: 'high' }]);
    const store = await ready(); await store.selectModel('test'); await store.selectReasoningEffort('low');
    vi.mocked(transport.request).mockImplementation(async (_id, request, signal) => {
      expect(request.reasoningEffort).toBe('low');
      await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true }));
    });
    store.prompt = 'question'; const sending = store.send();
    await vi.waitFor(() => expect(transport.request).toHaveBeenCalled());
    await store.selectReasoningEffort('high'); expect(store.reasoningEffort).toBe('low');
    await store.settle(); await sending;
    expect(store.session!.reasoningEffort).toBe('low');
  });
  it('defaults new Codex chats to medium and keeps old chats without a choice on CLI settings', async () => {
    vi.mocked(transport.connections).mockResolvedValue([{ ...connection, kind: 'codex-cli' }]);
    const store = await ready(); expect(store.reasoningEffort).toBe('medium');
    store.sessions.push({ ...session(), connectionId: connection.id });
    store.selectSession(store.sessions.at(-1)!.id); expect(store.reasoningEffort).toBe('cli-default');
    store.connections.push({ ...connection, id: 'api' });
    await store.selectConnection('api');
    expect(store.session!.reasoningEffort).toBeUndefined();
    await expect(store.selectReasoningEffort('low')).rejects.toThrow('不支持');
    await store.selectModel('test');
    vi.mocked(transport.request).mockImplementation(async (_id, request, _signal, chunk) => {
      expect(request).not.toHaveProperty('reasoningEffort');
      chunk(new TextEncoder().encode('data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
    });
    store.prompt = 'question'; await store.send();
    expect(transport.request).toHaveBeenCalled();
  });
  it('uses the selected model and locks selection throughout generation', async () => {
    const store = await ready(); await store.selectModel('other');
    vi.mocked(transport.request).mockImplementation(async (_id, request, signal) => {
      expect(request.model).toBe('other');
      await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true }));
    });
    store.prompt = 'question'; const sending = store.send();
    await vi.waitFor(() => expect(transport.request).toHaveBeenCalled());
    await store.selectModel('test'); expect(store.modelId).toBe('other');
    await store.settle(); await sending;
    expect(store.session!.messages.at(-1)?.model).toBe('other');
  });
  it('discards a late model list and clears the model when switching connections', async () => {
    const other = { ...connection, id: 'second' };
    vi.mocked(transport.connections).mockResolvedValue([connection, other]);
    let finish!: (values: string[]) => void;
    vi.mocked(transport.models).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce(['second-model']);
    const store = await ready(); store.open();
    await store.selectConnection(connection.id); await store.selectModel('test');
    await vi.waitFor(() => expect(transport.models).toHaveBeenCalledTimes(1));
    const signal = vi.mocked(transport.models).mock.calls[0][1];
    await store.selectConnection(other.id);
    await vi.waitFor(() => expect(store.models).toEqual(['second-model']));
    finish(['old-model']); await Promise.resolve();
    expect(signal.aborted).toBe(true); expect(store.models).toEqual(['second-model']);
    expect(store.modelId).toBe(''); expect(store.session!.model).toBeUndefined();
  });
  it('allows a manually specified model when discovery fails or returns no models', async () => {
    const store = await ready(); store.open();
    vi.mocked(transport.models).mockRejectedValue(new Error('no listing endpoint'));
    await store.reloadModels(); expect(store.modelsError).toContain('no listing');
    await store.selectModel('custom-model'); expect(store.session!.model).toBe('custom-model');
    vi.mocked(transport.models).mockResolvedValue([]);
    await store.reloadModels(); expect(store.modelsError).toContain('未返回');
    expect(store.modelId).toBe('custom-model');
  });
  it('resets the conversation model when a connection changes CLI kind or executable', async () => {
    const store = await ready();
    await store.selectConnection(connection.id); await store.selectModel('custom-model');
    const cli = { ...connection, kind: 'codex-cli' as const, endpoint: '', cliPath: '' };
    vi.mocked(transport.connections).mockResolvedValue([cli]);
    await store.saveConnection(cli);
    expect(store.modelId).toBe('');
    await store.selectModel('cli-default');
    const changed = { ...cli, cliPath: 'C:/tools/codex.exe' };
    vi.mocked(transport.connections).mockResolvedValue([changed]);
    await store.saveConnection(changed);
    expect(store.modelId).toBe(''); expect(store.session!.model).toBeUndefined();
  });
  it('keeps a removed connection attached to history instead of replacing it', async () => {
    const restored = { ...session(), connectionId: 'removed', model: 'old-model' }; history.push(restored);
    const store = await ready();
    expect(store.connectionId).toBe('removed'); expect(store.connection).toBeUndefined();
    store.prompt = 'question'; await store.send(); expect(transport.request).not.toHaveBeenCalled();
    await store.selectConnection(connection.id); await store.selectModel('test');
    vi.mocked(transport.connections).mockResolvedValue([{ ...connection, id: 'remaining' }]);
    await store.removeConnection(connection.id);
    expect(store.connectionId).toBe(connection.id); expect(store.session!.connectionId).toBe(connection.id);
    expect(store.connection).toBeUndefined();
  });
  it('recovers the last assistant model for legacy conversations', async () => {
    const restored = session();
    restored.messages = [{ id: 'reply', role: 'assistant', content: 'answer', createdAt: 1, model: 'legacy-model' }];
    history.push(restored);
    const store = await ready(); expect(store.modelId).toBe('legacy-model');
  });
});
