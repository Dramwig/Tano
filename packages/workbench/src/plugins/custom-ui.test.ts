// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { parsePluginJson, parsePluginPackage } from '@tano/protocol';
import type { PluginPackage } from '@tano/protocol';
import { documentOverviewPlugin } from './example';
import { PluginPackageCache } from './packages';
import { PluginExecutionHost, type PluginRuntimeState } from './host';

const pkg: PluginPackage = { ...documentOverviewPlugin, manifest: { ...documentOverviewPlugin.manifest, permissions: ['ui'] },
  ui: { overview: { html: '<h1>界面</h1>', css: 'h1{color:red}', source: 'render()' } } };
beforeEach(() => localStorage.clear());
it('includes all custom UI bytes in package integrity and requires explicit capability and declared view IDs', async () => {
  expect(parsePluginPackage(JSON.stringify(pkg))).toEqual(pkg);
  const cache = new PluginPackageCache();
  const integrity = await cache.put(pkg);
  expect(await cache.put({ ...pkg, ui: { overview: { ...pkg.ui!.overview!, css: 'h1{color:blue}' } } })).not.toBe(integrity);
  expect(() => parsePluginPackage(JSON.stringify({ ...pkg, manifest: documentOverviewPlugin.manifest }))).toThrow('ui 权限');
  expect(() => parsePluginPackage(JSON.stringify({ ...pkg, ui: { secret: pkg.ui!.overview } }))).toThrow('声明视图');
});

it.each([NaN, Infinity, undefined, new Date(), new Map(), () => {}, { bad: undefined }, { large: '字'.repeat(44000) }])('rejects non-JSON or oversized custom state: %s', value => {
  expect(() => parsePluginJson(value)).toThrow();
});
it('rejects cycles and deeply nested state', () => {
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  expect(() => parsePluginJson(cyclic)).toThrow();
  expect(parsePluginJson({ count: 1, items: [null, true, '有效'] })).toEqual({ count: 1, items: [null, true, '有效'] });
});

it('uses only the verified bundle, gates messages by instance and rejects non-JSON messages', async () => {
  const integrity = await new PluginPackageCache().put(pkg);
  let callback!: (message: unknown) => void;
  const send = vi.fn(), dispose = vi.fn(); let states: PluginRuntimeState[] = [];
  const host = new PluginExecutionHost({ call: vi.fn() }, value => { states = value; }, {}, localStorage,
    (_source, receive) => { callback = receive; return { send, dispose }; });
  try {
    host.sync({ id: 'workspace', name: '工作区', path: '/workspace', files: [] }, [{ manifest: pkg.manifest, enabled: true, authorized: true,
      rule: { manifest: pkg.manifest, mode: 'required', integrity, settings: {} } }]);
    await vi.waitFor(() => expect(callback).toBeDefined());
    callback({ type: 'call', id: 1, method: 'views.renderCustom', params: { id: 'overview', state: { count: 1 }, bundle: { source: 'forged' } } });
    await vi.waitFor(() => expect(states[0]?.views[0]?.custom?.state).toEqual({ count: 1 }));
    expect(states[0]!.views[0]!.custom!.bundle).toEqual(pkg.ui!.overview);
    const header = { title: '文件.pptx', status: '1 / 2', actions: [{ id: 'next', label: '下一页', icon: 'next' }] };
    callback({ type: 'call', id: 2, method: 'views.setHeader', params: { id: 'overview', header } });
    await vi.waitFor(() => expect(states[0]?.views[0]?.header).toEqual(header));
    expect(states[0]?.views[0]?.custom?.state).toEqual({ count: 1 });
    callback({ type: 'call', id: 3, method: 'views.renderCustom', params: { id: 'overview', state: { count: 2 } } });
    await vi.waitFor(() => expect(states[0]?.views[0]?.custom?.state).toEqual({ count: 2 }));
    expect(states[0]?.views[0]?.header).toEqual(header);
    callback({ type: 'call', id: 4, method: 'views.setHeader', params: { id: 'undeclared', header } });
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ id: 4, error: expect.stringContaining('没有在清单中声明') })));
    callback({ type: 'ready' });
    const instanceId = states[0]!.instanceId;
    await host.invoke(pkg.manifest.id, 'diagnostic', 'overview', { level: 'warn', message: '界面警告' }, instanceId);
    expect(states[0]?.logs?.at(-1)?.message).toBe('[界面 overview] 界面警告');
    await expect(host.invoke(pkg.manifest.id, 'diagnostic', 'overview', { level: 'error', message: '旧实例' }, 'stale')).rejects.toThrow('版本已变化');
    await expect(host.invoke(pkg.manifest.id, 'message', 'overview', {}, 'stale')).rejects.toThrow('版本已变化');
    await expect(host.invoke(pkg.manifest.id, 'message', 'overview', { data: 'x'.repeat(17000) }, instanceId)).rejects.toThrow('大小限制');
    const pending = host.invoke(pkg.manifest.id, 'message', 'overview', { move: 'todo' }, instanceId);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'invoke', kind: 'message', name: 'overview' }));
    const id = send.mock.calls.find(([message]) => message.type === 'invoke')![0].id;
    callback({ type: 'invoked', id }); await pending;
    host.sync({ id: 'other-workspace', name: '其他', path: '/other', files: [] }, []);
    await expect(host.invoke(pkg.manifest.id, 'message', 'overview', {}, instanceId)).rejects.toThrow('尚未运行');
    expect(dispose).toHaveBeenCalledOnce();
  } finally { host.dispose(); }
});
