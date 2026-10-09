// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import type { AssistantRequest, AssistantSession, AssistantTransport } from '@tano/protocol';
import { parseAssistantSession, parseObject } from '@tano/protocol';
import { DemoAdapter } from '../adapter';
import { configureWorkbench } from '../runtime';
import { useWorkspaceStore } from '../stores/workspace';
import { useAssistantStore } from './store';

let pinia: ReturnType<typeof createPinia>, adapter: DemoAdapter, workspace: ReturnType<typeof useWorkspaceStore>, assistant: ReturnType<typeof useAssistantStore>;
let transport: AssistantTransport, saved: AssistantSession[], requests: AssistantRequest[];
type Step = (request: AssistantRequest) => { name: string; args: unknown }[] | Promise<{ name: string; args: unknown }[]>;
let steps: Step[];
beforeEach(async () => {
  localStorage.clear(); saved = []; requests = []; steps = [];
  adapter = new DemoAdapter({ files: { 'note.md': 'alpha\nbeta\ngamma\n', 'folder/keep.md': 'keep' } });
  transport = { connections: async () => [{ id: 'test', name: 'test', endpoint: '', tools: true, maxOutputTokens: 2048, hasKey: false }], models: async () => ['test'],
    saveConnection: vi.fn(), removeConnection: vi.fn(), loadSessions: async () => [], deleteSession: vi.fn(),
    saveSession: vi.fn(async value => { saved.push(parseAssistantSession(value)); return value.revision + 1; }),
    request: async (_id, request, _signal, chunk) => {
      const step = steps[requests.length]; requests.push(structuredClone(request));
      const calls = await step?.(request) ?? [];
      const delta = calls.length ? { tool_calls: calls.map((call, index) => ({ index, id: `${requests.length}-${index}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } })) } : { content: '按回执汇总结果' };
      chunk(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`));
    } };
  pinia = configureWorkbench(createPinia(), { adapter, native: false, mobile: false, assistant: transport }); setActivePinia(pinia);
  workspace = useWorkspaceStore(); await workspace.openWorkspace(); assistant = useAssistantStore();
  await vi.waitFor(() => expect(assistant.loading).toBe(false)); await assistant.selectModel('test');
  saved = [];
});
afterEach(() => { workspace.dispose(); disposePinia(pinia); vi.restoreAllMocks(); });
const lastResult = (request: AssistantRequest) => JSON.parse(request.messages.at(-1)!.content!);
const file = () => workspace.workspace!.files.find(file => file.path === 'note.md')!;
const edit = () => [{ name: 'edit_document', args: { sourceId: 'S1', oldText: 'beta', newText: 'changed', reason: '用户要求修改' } }];
const reply = () => assistant.session!.messages.at(-1)!;

it('retrieves unattached documents, tasks and references with full workspace context by default', async () => {
  const document = workspace.workspace!.files.find(file => file.path === 'folder/keep.md')!;
  const task = await workspace.createObject({ type: 'event', name: '核对 keep 文档',
    description: `[@keep](object://document/${document.id})`, archived: false, properties: { checkable: true, completed: false } });
  const query = { documentId: document.id, directory: null, state: 'all', personId: null, query: null };
  steps = [() => [{ name: 'search_documents', args: { query: 'keep' } }],
    request => { expect(lastResult(request)).toContainEqual(expect.objectContaining({ fileId: document.id }));
      return [{ name: 'read_document', args: { fileId: document.id } }]; },
    request => { expect(lastResult(request)).toMatchObject({ content: 'keep', fileId: document.id });
      return [{ name: 'read_workspace_objects', args: {} }]; },
    () => [{ name: 'query_tasks', args: query }],
    request => { expect(lastResult(request).tasks).toContainEqual(expect.objectContaining({ id: task.object.id }));
      return [{ name: 'read_reference_context', args: { type: 'document', id: document.id } }]; },
    request => { expect(lastResult(request).incoming.length).toBeGreaterThan(0); return []; }];
  expect(assistant.files).toEqual([]); assistant.prompt = '查找 keep 文档及关联任务'; await assistant.send();
  expect(reply().state).toBe('completed'); expect(reply().toolResults?.every(result => result.status === 'succeeded')).toBe(true);
  expect(reply().attachedSourceIds).toEqual([]); expect(reply().sources?.[0].fileId).toBe(document.id);
  const original = assistant.session!.id; assistant.newSession(); assistant.selectSession(original);
  requests = []; steps = [() => [{ name: 'query_tasks', args: query }],
    request => { expect(lastResult(request).tasks).toContainEqual(expect.objectContaining({ id: task.object.id })); return []; }];
  assistant.prompt = '继续查询关联任务'; await assistant.send();
  expect(reply().toolResults?.[0].status).toBe('succeeded');
});

it('executes create, edit, rename, move and delete in one turn with durable receipts and fresh sources', async () => {
  const identities: string[] = [];
  steps = [() => [{ name: 'create_document', args: { path: 'created.md', content: 'first', reason: '用户要求创建' } }],
    request => { const result = lastResult(request); expect(result.written).toBe(true); identities.push(result.fileId);
      return [{ name: 'edit_document', args: { sourceId: result.source.id, oldText: 'first', newText: 'second', reason: '补充内容' } }]; },
    request => { const result = lastResult(request); expect(result.written).toBe(true); identities.push(result.fileId);
      return [{ name: 'rename_document', args: { sourceId: result.source.id, destination: 'renamed.md', reason: '用户要求重命名' } }]; },
    request => { const result = lastResult(request); expect(result.source.path).toBe('renamed.md'); identities.push(result.fileId);
      return [{ name: 'move_document', args: { sourceId: result.source.id, destination: 'folder/renamed.md', reason: '用户要求移动' } }]; },
    request => { const result = lastResult(request); expect(result.source.path).toBe('folder/renamed.md'); identities.push(result.fileId);
      return [{ name: 'delete_document', args: { sourceId: result.source.id, reason: '用户要求删除' } }]; },
    request => { expect(lastResult(request)).toMatchObject({ written: true, status: 'applied' }); return []; }];
  assistant.prompt = '创建、修改、重命名、移动，再删除测试文档'; await assistant.send();
  expect(reply().state).toBe('completed');
  expect(reply().proposals?.map(proposal => proposal.status)).toEqual(Array(5).fill('applied'));
  expect(new Set(identities).size).toBe(1);
  expect((await adapter.refresh()).files.some(file => file.path.includes('created.md') || file.path.includes('renamed.md'))).toBe(false);
  expect(reply().sources?.map(source => source.content)).toEqual(['first', 'second', 'second', 'second']);
  expect(saved.filter(session => session.messages.at(-1)?.proposals?.some(proposal => proposal.status === 'applying'))).toHaveLength(5);
  expect(parseAssistantSession(saved.at(-1)!).messages.at(-1)!.proposals?.every(proposal => proposal.status === 'applied')).toBe(true);
});

it('keeps suggestions unwritten and executes a later instruction without changing a mode', async () => {
  assistant.files = [file().id];
  steps = [() => [{ ...edit()[0], name: 'propose_edit' }]];
  assistant.prompt = '先给建议，不要修改'; await assistant.send();
  expect(reply().proposals![0].status).toBe('ready'); expect((await adapter.read('note.md')).content).toContain('beta');
  const suggestion = reply().proposals![0];
  requests = []; steps = [edit]; assistant.prompt = '现在直接修改正文'; await assistant.send();
  expect(requests[0].tools?.some(tool => tool.function.name === 'edit_document')).toBe(true);
  expect(requests[0].tools?.some(tool => tool.function.name === 'propose_edit')).toBe(true);
  expect(reply().proposals![0].status).toBe('applied'); expect((await adapter.read('note.md')).content).toContain('changed');
  expect(suggestion.status).toBe('ready');
});

it('drops a legacy suggestion-only preference so it cannot silently block current instructions', async () => {
  assistant.session = parseAssistantSession(JSON.parse(JSON.stringify({ ...assistant.session, executionMode: 'suggest' })));
  expect(assistant.session).not.toHaveProperty('executionMode');
  assistant.files = [file().id]; steps = [edit]; assistant.prompt = '直接修改正文'; await assistant.send();
  expect(reply().proposals![0].status).toBe('applied'); expect((await adapter.read('note.md')).content).toContain('changed');
  expect(saved.at(-1)).not.toHaveProperty('executionMode');
});

it('merges independent external edits and stops on overlaps without writing', async () => {
  assistant.files = [file().id];
  steps = [async () => { await adapter.write('note.md', 'external\nbeta\ngamma\n', (await adapter.read('note.md')).hash); return edit(); }];
  assistant.prompt = '修改第二段'; await assistant.send();
  expect(reply().proposals![0].status).toBe('applied'); expect((await adapter.read('note.md')).content).toBe('external\nchanged\ngamma\n');
  requests = []; steps = [async () => { await adapter.write('note.md', 'external\nhuman\ngamma\n', (await adapter.read('note.md')).hash);
    return [{ name: 'edit_document', args: { sourceId: 'S1', oldText: 'changed', newText: 'agent', reason: 'test' } }]; }];
  assistant.prompt = '再修改第二段'; await assistant.send();
  expect(reply().proposals![0].status).toBe('conflicted'); expect((await adapter.read('note.md')).content).toContain('human');
  expect(lastResult(requests[1])).toMatchObject({ written: false, status: 'conflicted' });
});

it('does not delete a source changed after the model read it', async () => {
  assistant.files = [file().id]; steps = [async () => {
    await adapter.write('note.md', 'external replacement', (await adapter.read('note.md')).hash);
    return [{ name: 'delete_document', args: { sourceId: 'S1', reason: '用户要求删除' } }];
  }];
  assistant.prompt = '删除这篇笔记'; await assistant.send();
  expect(reply().proposals![0].status).toBe('ready'); expect(reply().proposals![0].error).toContain('已暂停');
  expect((await adapter.read('note.md')).content).toBe('external replacement');
});

it('does not write when persisting intent fails, or when cancelled after intent persistence', async () => {
  assistant.files = [file().id]; steps = [edit];
  const save = transport.saveSession;
  vi.mocked(transport.saveSession).mockImplementation(async value => {
    if (value.messages.at(-1)?.proposals?.some(proposal => proposal.status === 'applying')) throw new Error('history unavailable');
    saved.push(parseAssistantSession(value)); return value.revision + 1;
  });
  assistant.prompt = '修改文档'; await assistant.send();
  expect(reply().proposals![0].status).toBe('ready'); expect((await adapter.read('note.md')).content).toContain('beta');
  requests = []; steps = [edit];
  vi.mocked(save).mockImplementation(async value => {
    saved.push(parseAssistantSession(value));
    if (value.messages.at(-1)?.proposals?.some(proposal => proposal.status === 'applying')) assistant.stop();
    return value.revision + 1;
  });
  assistant.prompt = '修改文档'; await assistant.send();
  expect(reply().state).toBe('cancelled'); expect((await adapter.read('note.md')).content).toContain('beta');
});

it('records successful writes after cancellation and blocks later operations', async () => {
  assistant.files = [file().id]; steps = [() => [...edit(), { name: 'create_document', args: { path: 'later.md', content: 'later', reason: 'test' } }]];
  const write = adapter.write.bind(adapter);
  vi.spyOn(adapter, 'write').mockImplementationOnce(async (...args) => { const result = await write(...args); assistant.stop(); return result; });
  assistant.prompt = '修改文档并创建 later.md'; await assistant.send();
  expect(reply().state).toBe('cancelled'); expect(reply().proposals).toHaveLength(1);
  expect(reply().proposals![0].status).toBe('applied'); expect((await adapter.read('note.md')).content).toContain('changed');
  expect((await adapter.refresh()).files.some(file => file.path === 'later.md')).toBe(false);
});

it('keeps a lost write receipt unknown and never retries that target in later turns', async () => {
  assistant.files = [file().id]; steps = [edit];
  const write = vi.spyOn(adapter, 'write').mockRejectedValue(new Error('receipt lost'));
  assistant.prompt = '修改文档'; await assistant.send();
  expect(reply().proposals![0].status).toBe('unknown'); expect(lastResult(requests[1]).written).toBeNull();
  requests = []; steps = [edit]; assistant.prompt = '继续修改'; await assistant.send();
  expect(write).toHaveBeenCalledTimes(1); expect(reply().proposals![0].error).toContain('先核对');
});

it('executes task updates from one snapshot and refreshes it before the next read', async () => {
  const tasks: Awaited<ReturnType<typeof workspace.createObject>>[] = [];
  for (const name of ['核对发布清单', '检查文档']) tasks.push(await workspace.createObject({ type: 'event', name, description: '',
    archived: false, properties: { checkable: true, completed: false, due: '2026-10-01' } }));
  steps = [() => [{ name: 'read_workspace_objects', args: {} }],
    () => tasks.map(task => ({ name: 'update_task', args: { target: { type: 'event', id: task.object.id },
      patch: { properties: { due: '2026-10-12' } }, reason: '按用户要求改期' } })),
    () => [{ name: 'read_workspace_objects', args: {} }],
    request => { expect(JSON.stringify(lastResult(request))).toContain('2026-10-12');
      expect(JSON.stringify(lastResult(request))).not.toContain('2026-10-01'); return []; }];
  assistant.prompt = '把这两项任务截止日期改成 10 月 12 日'; await assistant.send();
  expect(reply().state).toBe('completed'); expect(reply().proposals?.map(proposal => proposal.status)).toEqual(['applied', 'applied']);
  for (const task of tasks) expect(parseObject((await adapter.read(task.path)).content).properties.due).toBe('2026-10-12');
});

it('pauses a duplicate task creation while still creating an unrelated task', async () => {
  await workspace.createObject({ type: 'event', name: '核对发布清单', description: '', archived: false, properties: { checkable: true } });
  steps = [() => [{ name: 'read_workspace_objects', args: {} }],
    () => ['核对发布清单', '检查新文档'].map(name => ({ name: 'create_event', args: { name, description: '', properties: { checkable: true }, reason: '用户要求创建' } }))];
  assistant.prompt = '新增这两项任务'; await assistant.send();
  expect(reply().proposals?.map(proposal => proposal.status)).toEqual(['ready', 'applied']);
  expect(reply().proposals![0].error).toContain('重复');
  expect(workspace.objects.filter(record => record.object.name === '核对发布清单')).toHaveLength(1);
  expect(workspace.objects.filter(record => record.object.name === '检查新文档')).toHaveLength(1);
});
