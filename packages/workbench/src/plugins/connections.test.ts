// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { parsePluginPackage, type PluginConnectionProvider } from '@tano/protocol';
import { PluginExecutionHost } from './host';
import { PluginPackageCache } from './packages';
import type { PluginSandboxFactory } from './sandbox';

it('binds connection requests to the authorized session and rejects undeclared origins and stale results', async () => {
  localStorage.clear();
  const pkg = parsePluginPackage(JSON.stringify({ packageVersion: 1, manifest: { manifestVersion: 2, apiVersion: 1, id: 'connections', name: '连接', version: '1.0.0', description: '', objectTypes: [], relationTypes: [], permissions: ['connections'], networkOrigins: ['https://api.example.com'] }, source: '// test' }));
  const integrity = await new PluginPackageCache().put(pkg);
  let receive!: (value: unknown) => void;
  const send = vi.fn();
  const factory: PluginSandboxFactory = (_source, callback) => { receive = callback; return { send, dispose: vi.fn() }; };
  let complete!: (value: { status: number; body: string; contentType: 'text/plain' }) => void;
  const request = vi.fn<PluginConnectionProvider['request']>(() => new Promise(resolve => { complete = resolve; }));
  const host = new PluginExecutionHost({ call: vi.fn() }, () => {}, { connections: { storageLabel: 'test', list: vi.fn(), save: vi.fn(), remove: vi.fn(), request } }, localStorage, factory);
  try {
    host.sync({ id: 'workspace-one', name: 'one', path: '/one', files: [] }, [{ manifest: pkg.manifest, enabled: true, authorized: true, rule: { manifest: pkg.manifest, integrity, mode: 'required', settings: {} } }]);
    await vi.waitFor(() => expect(receive).toBeDefined()); receive({ type: 'ready' });
    receive({ type: 'call', id: 1, method: 'connections.request', params: { origin: 'https://other.example.com', request: { path: '/' } } });
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ id: 1, error: expect.stringContaining('未在插件清单中声明') })));
    expect(request).not.toHaveBeenCalled();
    receive({ type: 'call', id: 2, method: 'connections.request', params: { origin: 'https://api.example.com', integrity: 'forged', workspaceId: 'forged', request: { path: '/v1/' } } });
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    const [context, origin, query] = request.mock.calls[0]!;
    expect(context).toMatchObject({ workspaceId: 'workspace-one', pluginId: 'connections', integrity });
    expect(origin).toBe('https://api.example.com'); expect(query).toEqual({ path: '/v1/', method: 'GET' });
    host.sync({ id: 'workspace-two', name: 'two', path: '/two', files: [] }, []);
    expect(context.signal.aborted).toBe(true); complete({ status: 200, body: 'late', contentType: 'text/plain' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(send.mock.calls.some(([message]) => message.id === 2)).toBe(false);
  } finally { host.dispose(); }
});
