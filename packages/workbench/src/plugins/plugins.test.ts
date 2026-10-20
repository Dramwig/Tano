// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { ObjectTypeRegistry, bundledObjectPlugins, parsePluginPackage, parsePluginPolicy, parsePluginView, workspacePluginPath } from '@tano/protocol';
import { DemoAdapter } from '../adapter';
import { WorkspacePluginHost } from '../workspace-plugins';
import { loadPluginPolicy, savePluginRule } from './policy';
import { documentOverviewPlugin } from './example';
import { PluginPackageCache } from './packages';
import { PluginExecutionHost, type PluginRuntimeState } from './host';
import type { PluginSandboxFactory } from './sandbox';

beforeEach(() => localStorage.clear());
const rule = (index = 0) => ({ manifest: bundledObjectPlugins[index]!, mode: 'recommended' as const, settings: {} });

it('ignores a required retired Git rule while preserving portable policy bytes', async () => {
  const adapter = new DemoAdapter({ files: {} });
  const workspace = await adapter.open();
  const base = await loadPluginPolicy(adapter, workspace);
  const manifest = { ...bundledObjectPlugins[0]!, id: 'git-inspector', objectTypes: [], relationTypes: [] };
  await savePluginRule(adapter, base, manifest.id, { manifest, mode: 'required', settings: {} }, () => {});
  const before = (await adapter.read(workspacePluginPath)).content;
  const host = new WorkspacePluginHost(new ObjectTypeRegistry());
  expect(await host.loadWorkspace(adapter, await adapter.refresh())).toEqual([]);
  expect((await adapter.read(workspacePluginPath)).content).toBe(before);
  await expect(host.changeWorkspace(adapter, workspace, { id: manifest.id, enabled: true }, () => {})).rejects.toThrow('Git 功能已内置');
  host.dispose();
});

it('rejects executable fields in old manifests, unknown permissions, tampered policy and unbounded views', () => {
  expect(() => parsePluginPackage(JSON.stringify({ ...bundledObjectPlugins[0], source: 'steal()' }))).toThrow();
  expect(() => parsePluginPackage(JSON.stringify({ ...documentOverviewPlugin, manifest: { ...documentOverviewPlugin.manifest, permissions: ['shell'] } }))).toThrow();
  expect(() => parsePluginPolicy(JSON.stringify({ version: 1, plugins: [{ manifest: documentOverviewPlugin.manifest, mode: 'required' }] }))).toThrow('摘要');
  expect(() => parsePluginView({ type: 'html', html: '<img src=x>' })).toThrow();
  expect(() => parsePluginView({ type: 'stack', children: Array.from({ length: 301 }, () => ({ type: 'text', text: '' })) })).toThrow();
});

it('shares pinned declarations across devices and rejects member policy mutations', async () => {
  const adapter = new DemoAdapter({ files: {} });
  const owner = new WorkspacePluginHost(new ObjectTypeRegistry());
  const workspace = await adapter.open();
  await owner.loadWorkspace(adapter, workspace);
  await owner.changeWorkspace(adapter, workspace, { install: bundledObjectPlugins[0]! }, () => {});
  const shared = await adapter.refresh();
  const member = new WorkspacePluginHost(new ObjectTypeRegistry(), { getItem: () => null, setItem: vi.fn() });
  expect((await member.loadWorkspace(adapter, shared))[0]?.manifest.id).toBe('research');
  await expect(member.changeWorkspace(adapter, { ...shared, canManagePlugins: false }, { uninstall: 'research' }, () => {})).rejects.toThrow('管理员');
  await owner.loadWorkspace(adapter, shared);
  await owner.changeWorkspace(adapter, shared, { id: 'research', mode: 'required', settings: {} }, () => {});
  await member.loadWorkspace(adapter, await adapter.refresh());
  await expect(member.changeWorkspace(adapter, shared, { id: 'research', enabled: false }, () => {})).rejects.toThrow('统一控制');
  owner.dispose(); member.dispose();
});

it('merges independent concurrent installs and preserves a conflicting rule proposal', async () => {
  const adapter = new DemoAdapter({ files: {} });
  const base = await loadPluginPolicy(adapter, await adapter.open());
  const first = await savePluginRule(adapter, base, 'research', rule(), () => {});
  await savePluginRule(adapter, base, 'reading', rule(1), () => {});
  expect(parsePluginPolicy((await adapter.read(workspacePluginPath)).content).plugins).toHaveLength(2);
  await savePluginRule(adapter, first, 'research', { ...rule(), mode: 'required' }, () => {});
  await expect(savePluginRule(adapter, first, 'research', { ...rule(), mode: 'disabled' }, () => {})).rejects.toThrow('已保存在');
  expect((await adapter.refresh()).files.some(file => file.path.startsWith('.tano/conflicts/plugins-'))).toBe(true);
  expect(parsePluginPolicy((await adapter.read(workspacePluginPath)).content).plugins.find(row => row.manifest.id === 'research')?.mode).toBe('required');
});

it('checks package bytes on every load and invalidates authorization on version changes', async () => {
  const cache = new PluginPackageCache();
  const integrity = await cache.put(documentOverviewPlugin);
  const adapter = new DemoAdapter({ files: {} });
  const host = new WorkspacePluginHost(new ObjectTypeRegistry());
  let workspace = await adapter.open();
  await host.loadWorkspace(adapter, workspace);
  await host.changeWorkspace(adapter, workspace, { install: documentOverviewPlugin.manifest, package: documentOverviewPlugin }, () => {});
  workspace = await adapter.refresh();
  expect((await host.loadWorkspace(adapter, workspace))[0]?.authorized).toBe(false);
  host.authorize(workspace.id, 'document-overview', integrity);
  expect((await host.loadWorkspace(adapter, workspace))[0]?.authorized).toBe(true);
  const update = { ...documentOverviewPlugin, source: `${documentOverviewPlugin.source}\n// different bytes` };
  await host.changeWorkspace(adapter, workspace, { install: update.manifest, package: update }, () => {});
  expect((await host.loadWorkspace(adapter, await adapter.refresh()))[0]?.authorized).toBe(false);
  localStorage.setItem(`tano.plugin-package.v1.${integrity}`, JSON.stringify(update));
  await expect(cache.get(integrity)).rejects.toThrow('校验失败');
  host.dispose();
});

it('denies undeclared APIs and drops callbacks after workspace changes', async () => {
  const cache = new PluginPackageCache();
  const integrity = await cache.put(documentOverviewPlugin);
  const receive: ((message: unknown) => void)[] = [];
  const send = vi.fn(), disposed = vi.fn(), call = vi.fn().mockResolvedValue([]);
  const factory: PluginSandboxFactory = (_source, callback) => { receive.push(callback); return { send, dispose: disposed }; };
  let states: PluginRuntimeState[] = [];
  const host = new PluginExecutionHost({ call }, next => { states = next; }, {}, localStorage, factory);
  const installation = { manifest: documentOverviewPlugin.manifest, enabled: true, authorized: true,
    rule: { manifest: documentOverviewPlugin.manifest, mode: 'required' as const, settings: {}, integrity } };
  host.sync({ id: 'one', path: '/one', name: 'one', files: [] }, [installation]);
  await vi.waitFor(() => expect(receive).toHaveLength(1));
  receive[0]!({ type: 'ready' });
  expect(states[0]?.status).toBe('running');
  receive[0]!({ type: 'call', id: 1, method: 'documents.write', params: {} });
  await vi.waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ id: 1, error: expect.stringContaining('权限') })));
  expect(call).not.toHaveBeenCalled();
  host.notify({ type: 'objects.changed', changes: [{ id: 'private-object', kind: 'updated' }] });
  expect(send.mock.calls.some(([message]) => message.type === 'event')).toBe(false);
  host.notify({ type: 'documents.changed', changes: [{ id: 'document-id', kind: 'updated' }] });
  expect(send).toHaveBeenCalledWith({ type: 'event', event: { type: 'documents.changed', changes: [{ id: 'document-id', kind: 'updated' }] } });
  host.sync({ id: 'two', path: '/two', name: 'two', files: [] }, []);
  receive[0]!({ type: 'call', id: 2, method: 'documents.list', params: {} });
  expect(call).not.toHaveBeenCalled(); expect(disposed).toHaveBeenCalled(); expect(states).toEqual([]);
  host.dispose();
});

it('sends nested reactive shared settings through the structured-clone boundary as detached JSON', async () => {
  const integrity = await new PluginPackageCache().put(documentOverviewPlugin);
  const installation = reactive({ manifest: documentOverviewPlugin.manifest, enabled: true, authorized: true,
    rule: { manifest: documentOverviewPlugin.manifest, mode: 'required' as const, integrity,
      settings: { marker: 'A', filters: [{ completed: false }], options: { limit: 50 } } } });
  let receive: ((message: unknown) => void) | undefined;
  const messages: any[] = [];
  const host = new PluginExecutionHost({ call: vi.fn() }, () => {}, {}, localStorage,
    (_source, callback) => { receive = callback; return { send: message => { messages.push(structuredClone(message)); }, dispose() {} }; });
  try {
    host.sync({ id: 'one', path: '/one', name: 'one', files: [] }, [installation]);
    await vi.waitFor(() => expect(receive).toBeTypeOf('function'));
    receive!({ type: 'call', id: 1, method: 'context', params: {} });
    await vi.waitFor(() => expect(messages).toHaveLength(1));
    expect(messages[0]).toEqual({ type: 'result', id: 1, result: { workspaceId: 'one', pluginId: 'document-overview',
      settings: { marker: 'A', filters: [{ completed: false }], options: { limit: 50 } } } });
    messages[0].result.settings.options.limit = 1;
    expect(installation.rule.settings.options.limit).toBe(50);
  } finally { host.dispose(); }
});

it('keeps device authorization separate for different accounts on the same workspace', async () => {
  const adapter = new DemoAdapter({ files: {} });
  const owner = new WorkspacePluginHost(new ObjectTypeRegistry(), localStorage, 'alice');
  const workspace = await adapter.open();
  await owner.loadWorkspace(adapter, workspace);
  await owner.changeWorkspace(adapter, workspace, { install: documentOverviewPlugin.manifest, package: documentOverviewPlugin }, () => {});
  const updated = await adapter.refresh();
  const installed = await owner.loadWorkspace(adapter, updated);
  owner.authorize(workspace.id, documentOverviewPlugin.manifest.id, installed[0]!.rule!.integrity);
  expect((await owner.loadWorkspace(adapter, updated))[0]?.authorized).toBe(true);
  const other = new WorkspacePluginHost(new ObjectTypeRegistry(), localStorage, 'bob');
  expect((await other.loadWorkspace(adapter, updated))[0]?.authorized).toBe(false);
  owner.dispose(); other.dispose();
});
