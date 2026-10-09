import { expect, it, vi } from 'vitest';
import type { AssistantProposal, AssistantRequest, AssistantSource, AssistantTransport } from '@tano/protocol';
import { runAssistant } from './engine';
import type { AssistantExecutionResult } from './execution';

const source: AssistantSource = { id: 'S1', workspaceId: 'workspace', fileId: 'abc123', path: 'note.md', content: 'old', hash: 'old', origin: 'disk' };
const edit = { sourceId: 'S1', oldText: 'old', newText: 'new', reason: 'test' };
function scenario(calls: { name: string; args: unknown }[][]) {
  const requests: AssistantRequest[] = [], proposals: AssistantProposal[] = [];
  const transport: AssistantTransport = { connections: vi.fn(), models: vi.fn(), saveConnection: vi.fn(), removeConnection: vi.fn(),
    loadSessions: vi.fn(), saveSession: vi.fn(), deleteSession: vi.fn(), request: vi.fn(async (_id, request, _signal, chunk) => {
    const callsNow = calls[requests.length] ?? []; requests.push(structuredClone(request));
    const delta = callsNow.length ? { tool_calls: callsNow.map((call, index) => ({ index, id: `${requests.length}-${index}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } })) } : { content: '根据回执汇总结果' };
    chunk(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`));
  }) };
  const options = { transport, connectionId: 'test', model: 'test', tools: true, workspaceId: 'workspace', runId: 'run', sources: [{ ...source }], history: [], prompt: '修改文档',
    signal: new AbortController().signal, delta: vi.fn(), progress: vi.fn(), proposal: (item: AssistantProposal) => proposals.push(item), toolResult: vi.fn() };
  return { requests, proposals, options };
}

it('awaits the actual write and returns a fresh source without changing the original snapshot', async () => {
  const test = scenario([[{ name: 'edit_document', args: edit }], [{ name: 'edit_document', args: { ...edit, sourceId: 'S2', oldText: 'new', newText: 'latest' } }]]);
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const execute = vi.fn(async (proposal: AssistantProposal): Promise<AssistantExecutionResult> => {
    await barrier;
    return { status: 'applied', written: true, fileId: source.fileId, source: { ...source, id: '', content: proposal.content, hash: proposal.content } };
  });
  const running = runAssistant({ ...test.options, execute });
  await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
  expect(test.requests).toHaveLength(1);
  release(); await running;
  expect(execute).toHaveBeenCalledTimes(2);
  expect(test.options.sources.map(source => source.content)).toEqual(['old', 'new', 'latest']);
  expect(JSON.parse(test.requests[1].messages.at(-1)!.content!)).toMatchObject({ written: true, status: 'applied', source: { id: 'S2', content: 'new' } });
  expect(test.proposals.every(proposal => proposal.execution === 'direct')).toBe(true);
});

it('keeps propose tools manual even when direct execution is available', async () => {
  const test = scenario([[{ name: 'propose_edit', args: edit }]]); const execute = vi.fn();
  await runAssistant({ ...test.options, prompt: '先给建议，不要修改', execute });
  expect(execute).not.toHaveBeenCalled();
  expect(JSON.parse(test.requests[1].messages.at(-1)!.content!)).toMatchObject({ written: false, status: 'awaiting_review' });
  expect(test.proposals[0].execution).toBeUndefined();
});

it('omits and rejects direct tools when the host has no execution capability', async () => {
  const test = scenario([[{ name: 'edit_document', args: edit }]]);
  await runAssistant(test.options);
  expect(test.requests[0].tools?.some(tool => tool.function.name === 'edit_document')).toBe(false);
  expect(test.proposals).toHaveLength(0);
  expect(JSON.parse(test.requests[1].messages.at(-1)!.content!).error).toContain('未提供直接执行能力');
});

it('prevents automatic retries of an uncertain write while allowing unrelated files', async () => {
  const test = scenario([[{ name: 'edit_document', args: edit }], [{ name: 'edit_document', args: edit }, { name: 'create_document', args: { path: 'other.md', content: 'other', reason: 'test' } }]]);
  const execute = vi.fn(async (proposal: AssistantProposal): Promise<AssistantExecutionResult> => proposal.kind === 'edit'
    ? { status: 'unknown', written: null, error: 'receipt lost' } : { status: 'applied', written: true });
  await runAssistant({ ...test.options, execute });
  expect(execute).toHaveBeenCalledTimes(2);
  expect(test.proposals).toHaveLength(2);
  expect(test.options.toolResult).toHaveBeenCalledWith(expect.objectContaining({ name: 'edit_document', status: 'failed', proposalId: test.proposals[0].id }));
  const results = test.requests[2].messages.filter(message => message.role === 'tool').map(message => JSON.parse(message.content!));
  expect(results).toContainEqual(expect.objectContaining({ error: expect.stringContaining('不得自动重试'), written: false }));
});

it('rejects stale source IDs after a successful execution', async () => {
  const test = scenario([[{ name: 'edit_document', args: edit }], [{ name: 'edit_document', args: edit }]]);
  const execute = vi.fn(async (): Promise<AssistantExecutionResult> => ({ status: 'applied', written: true, fileId: source.fileId }));
  await runAssistant({ ...test.options, execute });
  expect(execute).toHaveBeenCalledTimes(1);
  expect(JSON.parse(test.requests[2].messages.at(-1)!.content!).error).toContain('已提供');
});
