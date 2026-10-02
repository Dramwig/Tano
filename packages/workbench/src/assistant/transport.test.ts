import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ASSISTANT_PROTOCOL_VERSION } from '@tano/protocol';
import { nativeAssistantTransport } from './transport';

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
    await expect(nativeAssistantTransport().saveConnection(connection)).rejects.toThrow('版本不一致');
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
