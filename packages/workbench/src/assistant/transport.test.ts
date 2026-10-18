import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ASSISTANT_PROTOCOL_VERSION } from '@tano/protocol';
import { demoAssistantTransport, nativeAssistantTransport } from './transport';
import { AssistantStream, runAssistant } from './engine';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke, Channel: class { onmessage?: unknown } }));
const connection = { id: 'connection', name: 'test', endpoint: 'https://example.com/v1', tools: true, maxOutputTokens: 4096 };

describe('draft clarification in the browser demo', () => {
  it('uses English clarification and receipts while leaving an unknown topic unwritten', async () => {
    const proposal = vi.fn(), execute = vi.fn();
    let text = '';
    await runAssistant({ transport: demoAssistantTransport(), connectionId: 'demo', model: '模拟响应', tools: true,
      locale: 'en-US', workspaceId: 'workspace', runId: 'run', history: [], prompt: 'Start a draft', signal: new AbortController().signal,
      sources: [{ id: 'S1', workspaceId: 'workspace', fileId: 'abc123', path: '新建文档.md', content: '', hash: 'empty', origin: 'draft' }],
      delta: value => { text += value; }, progress: () => {}, proposal, execute,
      askUser: async questions => {
        expect(questions[0].question).toBe('What should this document be about?');
        expect(questions[1].options).toEqual(['Myself', 'Team', 'Clients']);
        return questions.map(question => ({ questionId: question.id, answer: null }));
      },
    });
    expect(proposal).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(text).toContain('The topic is still unknown');
  });

  it('keeps original source text and citation IDs in an English simulated response', async () => {
    let text = '';
    await runAssistant({ transport: demoAssistantTransport(), connectionId: 'demo', model: '模拟响应', tools: false,
      locale: 'en-US', workspaceId: 'workspace', runId: 'run', history: [], prompt: 'Summarize', signal: new AbortController().signal,
      sources: [{ id: 'S1', workspaceId: 'workspace', fileId: 'abc123', path: '中文名字.md', content: '中文原文和 English {0}', hash: 'hash', origin: 'draft' }],
      delta: value => { text += value; }, progress: () => {}, proposal: () => {},
    });
    expect(text).toBe('Simulated browser response: read “中文名字.md”.\n\n中文原文和 English {0}\n\n[来源:S1]');
  });

  it('keeps the document unchanged when the topic is skipped', async () => {
    const proposal = vi.fn(), execute = vi.fn();
    let text = '';
    await runAssistant({ transport: demoAssistantTransport(), connectionId: 'demo', model: '模拟响应', tools: true,
      workspaceId: 'workspace', runId: 'run', history: [], prompt: 'Start a draft', signal: new AbortController().signal,
      sources: [{ id: 'S1', workspaceId: 'workspace', fileId: 'abc123', path: '新建文档 3.md', content: '', hash: 'empty', origin: 'draft' }],
      delta: value => { text += value; }, progress: () => {}, proposal, execute,
      askUser: async questions => questions.map(question => ({ questionId: question.id, answer: question.id === 'format' ? '完整草稿' : null })),
    });
    expect(proposal).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(text).toContain('还不知道这篇文档要写什么');
  });
});

describe('native assistant protocol compatibility', () => {
  beforeEach(() => { invoke.mockReset(); });
  it('blocks an old backend before reading connections or sending credentials', async () => {
    invoke.mockRejectedValue('Command assistant_protocol_version not found');
    const transport = nativeAssistantTransport();
    await expect(transport.connections()).rejects.toThrow('完全退出同页');
    await expect(transport.saveConnection(connection, 'test-only-secret')).rejects.toThrow('仅刷新页面');
    expect(invoke.mock.calls).toEqual([['assistant_protocol_version']]);
  });
  it('blocks incompatible native versions', async () => {
    invoke.mockResolvedValue(ASSISTANT_PROTOCOL_VERSION + 1);
    await expect(nativeAssistantTransport().saveConnection(connection)).rejects.toThrow(
      `版本不一致（前端协议 ${ASSISTANT_PROTOCOL_VERSION}，桌面后端协议 ${ASSISTANT_PROTOCOL_VERSION + 1}）`,
    );
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it('checks once and saves connections without a model on a compatible backend', async () => {
    invoke.mockImplementation(async (command: string) => command === 'assistant_protocol_version' ? ASSISTANT_PROTOCOL_VERSION
      : command === 'assistant_connections' ? [] : undefined);
    const transport = nativeAssistantTransport();
    await Promise.all([transport.connections(), transport.saveConnection(connection)]);
    expect(invoke.mock.calls.filter(([command]) => command === 'assistant_protocol_version')).toHaveLength(1);
    expect(invoke).toHaveBeenCalledWith('assistant_connection_save', { connection, key: null });
    expect(invoke.mock.calls.find(([command]) => command === 'assistant_connection_save')![1].connection).not.toHaveProperty('model');
  });
  it('retains genuine storage errors from a compatible backend', async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'assistant_protocol_version') return ASSISTANT_PROTOCOL_VERSION;
      throw '模型连接数据损坏，原记录已保留';
    });
    await expect(nativeAssistantTransport().connections()).rejects.toBe('模型连接数据损坏，原记录已保留');
  });
});

describe('native assistant channel delivery', () => {
  const request = { model: 'test', messages: [] };
  let channel: { onmessage: (bytes: number[]) => void };
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation(async (command: string, args?: Record<string, any>) => {
      if (command === 'assistant_protocol_version') return ASSISTANT_PROTOCOL_VERSION;
      if (command === 'assistant_request') channel = args!.onChunk;
    });
  });
  it('waits for ordered delivery even when invoke has already resolved', async () => {
    const stream = new AssistantStream(() => {});
    let finished = false;
    const result = nativeAssistantTransport().request('connection', request, new AbortController().signal,
      bytes => stream.push(bytes)).then(() => { finished = true; return stream.finish(); });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('assistant_request', expect.anything()));
    expect(finished).toBe(false);
    const call = { index: 0, id: 'proposal', type: 'function', function: { name: 'propose_create', arguments: '{}' } };
    channel.onmessage([...new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [call] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`)]);
    await Promise.resolve();
    expect(finished).toBe(false);
    channel.onmessage([]);
    expect(await result).toEqual([{ id: 'proposal', type: 'function', function: call.function }]);
  });
  it('can cancel while waiting for channel delivery and ignores late data', async () => {
    const controller = new AbortController();
    const chunk = vi.fn();
    const result = nativeAssistantTransport().request('connection', request, controller.signal, chunk);
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('assistant_request', expect.anything()));
    controller.abort();
    await rejected;
    channel.onmessage([1]);
    expect(chunk).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith('assistant_cancel', expect.anything());
  });
  it('preserves parser errors without waiting for a missing end marker', async () => {
    const failure = new Error('invalid frame');
    const result = nativeAssistantTransport().request('connection', request, new AbortController().signal,
      () => { throw failure; });
    const rejected = expect(result).rejects.toBe(failure);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('assistant_request', expect.anything()));
    channel.onmessage([1]);
    await rejected;
  });
  it('preserves backend errors without requiring successful channel completion', async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'assistant_protocol_version') return ASSISTANT_PROTOCOL_VERSION;
      throw new Error('provider failed');
    });
    await expect(nativeAssistantTransport().request('connection', request, new AbortController().signal,
      () => {})).rejects.toThrow('provider failed');
  });
});
