// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { createNativePluginConnections, createNativePluginServices } from './native';
import { parsePluginPackage } from '@tano/protocol';
import { PluginPackageCache } from './packages';
import { PluginExecutionHost, type PluginNativeContext } from './host';
import type { PluginSandboxFactory } from './sandbox';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); localStorage.clear(); });

it('keeps connection credentials in native save IPC and binds requests and cancellation to the host context', async () => {
  const provider = createNativePluginConnections(), controller = new AbortController();
  const input = { pluginId: 'importer', origin: 'https://api.example.test', integrity: 'a'.repeat(64), methods: ['GET'] as ['GET'], pathPrefix: '/v1/', authentication: 'bearer' as const, secret: 'private-test-secret' };
  vi.mocked(invoke).mockResolvedValue({});
  await provider.save('workspace', input, controller.signal);
  expect(invoke).toHaveBeenLastCalledWith('plugin_connections_save', { workspaceId: 'workspace', input, requestId: expect.any(String) });
  await provider.list('workspace', controller.signal);
  expect(invoke).toHaveBeenLastCalledWith('plugin_connections_list', { workspaceId: 'workspace', requestId: expect.any(String) });
  expect(localStorage.length).toBe(0);
  let finish!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementation(command => command === 'plugin_native_cancel' ? Promise.resolve() : new Promise(resolve => { finish = resolve; }));
  const promise = provider.request({ workspaceId: 'workspace', pluginId: input.pluginId, integrity: input.integrity, signal: controller.signal }, input.origin, { path: '/v1/items' });
  const pending = expect(promise).rejects.toThrow();
  const request = (vi.mocked(invoke).mock.lastCall![1] as { input: Record<string, unknown> }).input;
  expect(request).toEqual({ workspaceId: 'workspace', pluginId: 'importer', integrity: input.integrity, origin: input.origin, request: { path: '/v1/items', method: 'GET' }, requestId: expect.any(String) });
  controller.abort(); expect(invoke).toHaveBeenLastCalledWith('plugin_native_cancel', { requestId: request.requestId });
  finish({ status: 200, body: 'late', contentType: 'text/plain' }); await pending;
  const count = vi.mocked(invoke).mock.calls.length;
  await expect(provider.list('workspace', controller.signal)).rejects.toThrow();
  expect(invoke).toHaveBeenCalledTimes(count);
});

it('binds account login control to the native workspace and cancels a late start result', async () => {
  const oauth = createNativePluginConnections().oauth!, signal = new AbortController().signal;
  const input = { pluginId: 'importer', origin: 'https://api.example.test', integrity: 'a'.repeat(64), methods: ['GET'] as ['GET'], pathPrefix: '/v1/', providerId: 'service' };
  vi.mocked(invoke).mockResolvedValue({});
  await oauth.providers('workspace', signal);
  expect(invoke).toHaveBeenLastCalledWith('plugin_connections_oauth_providers', { workspaceId: 'workspace', requestId: expect.any(String) });
  await oauth.status('workspace', 'flow', signal);
  expect(invoke).toHaveBeenLastCalledWith('plugin_connections_oauth_status', { workspaceId: 'workspace', flowId: 'flow', requestId: expect.any(String) });
  await oauth.cancel('old-workspace', 'flow', signal);
  expect(invoke).toHaveBeenLastCalledWith('plugin_connections_oauth_cancel', { workspaceId: 'old-workspace', flowId: 'flow', requestId: expect.any(String) });
  const controller = new AbortController();
  let finish!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementation(command => command === 'plugin_native_cancel' ? Promise.resolve() : new Promise(resolve => { finish = resolve; }));
  const promise = oauth.start('workspace', input, controller.signal);
  const pending = expect(promise).rejects.toThrow();
  const request = vi.mocked(invoke).mock.lastCall![1] as Record<string, unknown>;
  expect(request).toEqual({ workspaceId: 'workspace', input, requestId: expect.any(String) });
  controller.abort();
  expect(invoke).toHaveBeenLastCalledWith('plugin_native_cancel', { requestId: request.requestId });
  finish({ id: 'late-flow', authorizationUrl: 'https://login.example.test', expiresAt: '2099-01-01T00:00:00Z' });
  await pending;
  expect(localStorage.length).toBe(0);
  expect(oauth.loginHint).toContain('此设备');
});

it('uses named IPC, propagates cancellation, and refuses late results', async () => {
  const services = createNativePluginServices();
  let finish!: (result: unknown) => void;
  vi.mocked(invoke).mockImplementation(command => command === 'plugin_native_cancel' ? Promise.resolve() : new Promise(resolve => { finish = resolve; }));
  const controller = new AbortController();
  const context = { workspaceId: 'workspace', pluginId: 'plugin', integrity: 'a'.repeat(64), signal: controller.signal };
  const promise = services['git.diff']!({ path: 'note.md', staged: true }, context);
  const pending = expect(promise).rejects.toThrow();
  const request = (vi.mocked(invoke).mock.calls[0]![1] as { request: Record<string, unknown> }).request;
  expect(request).toMatchObject({ workspaceId: 'workspace', pluginId: 'plugin', integrity: context.integrity, command: 'git.diff', args: { path: 'note.md', staged: true } });
  controller.abort();
  expect(invoke).toHaveBeenCalledWith('plugin_native_cancel', { requestId: request.requestId });
  finish({ patch: 'late' }); await pending;
  await expect(services['git.status']!({}, context)).rejects.toThrow();
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(Object.keys(services)).toEqual(['git.status', 'git.diff']);
});

it('binds native calls to the authorized package, denies undeclared commands, and cancels on workspace switch', async () => {
  const pkg = parsePluginPackage(JSON.stringify({ packageVersion: 1, manifest: { manifestVersion: 2, apiVersion: 1, id: 'git', name: 'Git', version: '1.0.0', description: '', objectTypes: [], relationTypes: [], permissions: ['native'], nativeCommands: ['git.status'] }, source: '// test' }));
  const integrity = await new PluginPackageCache().put(pkg);
  let receive!: (value: unknown) => void;
  const send = vi.fn(), dispose = vi.fn();
  const factory: PluginSandboxFactory = (_source, callback) => { receive = callback; return { send, dispose }; };
  let complete!: (value: unknown) => void;
  const status = vi.fn((_args: unknown, _context: PluginNativeContext) => new Promise(resolve => { complete = resolve; })), diff = vi.fn();
  const host = new PluginExecutionHost({ call: vi.fn() }, () => {}, { native: { 'git.status': status, 'git.diff': diff } }, localStorage, factory);
  try {
    host.sync({ id: 'one', name: 'one', path: '/one', files: [] }, [{ manifest: pkg.manifest, enabled: true, authorized: true, rule: { manifest: pkg.manifest, integrity, mode: 'required', settings: {} } }]);
    await vi.waitFor(() => expect(receive).toBeDefined()); receive({ type: 'ready' });
    receive({ type: 'call', id: 1, method: 'native.invoke', params: { command: 'git.diff', args: {} } });
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ id: 1, error: expect.stringContaining('本机命令不可用') })));
    expect(diff).not.toHaveBeenCalled();
    receive({ type: 'call', id: 2, method: 'native.invoke', params: { command: 'git.status', args: {}, workspaceId: 'forged', pluginId: 'forged', integrity: 'forged' } });
    await vi.waitFor(() => expect(status).toHaveBeenCalledOnce());
    const context = status.mock.calls[0]![1];
    expect(context).toMatchObject({ workspaceId: 'one', pluginId: 'git', integrity });
    host.sync({ id: 'two', name: 'two', path: '/two', files: [] }, []);
    expect(context.signal.aborted).toBe(true); expect(dispose).toHaveBeenCalledOnce();
    complete({ branch: 'main', entries: [] });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(send.mock.calls.some(([message]) => message.id === 2)).toBe(false);
  } finally { host.dispose(); }
});
