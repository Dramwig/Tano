import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ASSISTANT_PROTOCOL_VERSION } from '@tano/protocol';
import { nativeAssistantTransport } from './transport';
import { AssistantStream } from './engine';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke, Channel: class { onmessage?: unknown } }));
const connection = { id: 'connection', name: 'test', endpoint: 'https://example.com/v1', tools: true, maxOutputTokens: 4096 };

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
