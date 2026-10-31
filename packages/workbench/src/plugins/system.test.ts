// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { ObjectTypeRegistry, canonicalPluginJson, workspacePluginPath, type PluginPackage } from '@tano/protocol';
import { DemoAdapter } from '../adapter';
import { WorkspacePluginHost } from '../workspace-plugins';
import { PluginExecutionHost } from './host';
import type { PluginSandboxFactory } from './sandbox';
import { systemPlugin, systemPluginIds } from './system';

beforeEach(() => localStorage.clear());
const policy = () => new WorkspacePluginHost(new ObjectTypeRegistry(), localStorage, 'device', systemPluginIds);
it.each([false, true])('loads the system plugin by default without changing workspace content (existing policy: %s)', async existing => {
  const content = JSON.stringify({ version: 1, plugins: [] });
  const adapter = new DemoAdapter({ files: existing ? { [workspacePluginPath]: content } : {} });
  const workspace = await adapter.open(), create = vi.spyOn(adapter, 'create'), write = vi.spyOn(adapter, 'write');
  const host = policy();
  const installed = await host.loadWorkspace(adapter, workspace);
  expect(installed).toHaveLength(systemPluginIds.length);
  for (const id of systemPluginIds) expect(installed.find(plugin => plugin.manifest.id === id)).toMatchObject({ system: true, enabled: true, authorized: true });
  expect(create).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  host.dispose();
});
it.each(systemPluginIds)('keeps %s device preferences and protects product-owned code in read-only workspaces', async id => {
  const adapter = new DemoAdapter({ files: {} });
  const workspace = { ...await adapter.open(), readOnly: true };
  let host = policy(); await host.loadWorkspace(adapter, workspace);
  await host.changeWorkspace(adapter, workspace, { id: id, enabled: false }, () => {});
  host.dispose(); host = policy();
  expect((await host.loadWorkspace(adapter, workspace)).find(plugin => plugin.manifest.id === id)!.enabled).toBe(false);
  await expect(host.changeWorkspace(adapter, workspace, { uninstall: id }, () => {})).rejects.toThrow('系统插件');
  const { pkg } = await systemPlugin(id);
  await expect(host.changeWorkspace(adapter, workspace, { install: pkg.manifest, package: pkg }, () => {})).rejects.toThrow('系统插件');
  expect(() => host.authorize(workspace.id, id, undefined)).toThrow('无需单独授权');
  await host.changeWorkspace(adapter, workspace, { id: id, enabled: true }, () => {});
  expect((await host.loadWorkspace(adapter, workspace))[0].enabled).toBe(true);
  host.dispose();
});
it('ignores a portable same-ID package and executes only bundled bytes without repository or cache access', async () => {
  const { pkg } = await systemPlugin('presentation-preview');
  const fake: PluginPackage = { ...pkg, source: 'throw new Error("untrusted")' };
  const adapter = new DemoAdapter({ files: { [workspacePluginPath]: canonicalPluginJson({ version: 1, plugins: [{
    manifest: fake.manifest, integrity: 'a'.repeat(64), mode: 'required', settings: {},
  }] }) } });
  const workspace = await adapter.open(), host = policy();
  const installed = await host.loadWorkspace(adapter, workspace);
  const factory = vi.fn<PluginSandboxFactory>(() => ({ send: vi.fn(), dispose: vi.fn() }));
  const repository = { load: vi.fn(), publish: vi.fn() };
  const executor = new PluginExecutionHost({ call: vi.fn() }, () => {}, { repository }, localStorage, factory);
  executor.sync(workspace, installed);
  await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(systemPluginIds.length));
  expect(factory.mock.calls[0][0]).toBe(pkg.source);
  expect(repository.load).not.toHaveBeenCalled();
  executor.dispose(); host.dispose();
});
