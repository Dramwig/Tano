import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { reactive } from 'vue';
import type { AssistantProposal, AssistantSession, AssistantTransport, WorkspaceAdapter } from '@tano/protocol';
import { configureWorkbench } from '../runtime';
import { useAssistantStore } from './store';

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
