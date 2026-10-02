// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { bundledObjectPlugins, coreObjectTypes, ObjectTypeRegistry } from '@tano/protocol';
import { WorkspacePluginHost } from './workspace-plugins';
let registry: ObjectTypeRegistry, host: WorkspacePluginHost;
beforeEach(() => {
  localStorage.clear();
  registry = new ObjectTypeRegistry();
  host = new WorkspacePluginHost(registry);
});
afterEach(() => {
  host.dispose();
});
it('installs, restores after restart, scopes by workspace, disables, and uninstalls declarations', async () => {
  await host.change('one', { install: bundledObjectPlugins[0]! });
  expect(registry.get('research.dataset')).toBeDefined();
  host.dispose();
  expect(registry.get('research.dataset')).toBeUndefined();
  expect(host.load('one')[0]?.enabled).toBe(true);
  expect(registry.get('research.dataset')).toBeDefined();
  host.load('two');
  expect(registry.get('research.dataset')).toBeUndefined();
  host.load('one');
  await host.change('one', { id: 'research', enabled: false });
  expect(registry.get('research.paper')).toBeUndefined();
  expect(host.load('one')).toHaveLength(1);
  await host.change('one', { id: 'research', enabled: true });
  await host.change('one', { uninstall: 'research' });
  expect(host.load('one')).toEqual([]);
  expect(registry.list()).toEqual(coreObjectTypes);
});
it('does not activate a plugin on persistence failure or partially register conflicting manifests', async () => {
  const failing = new WorkspacePluginHost(registry, {
    getItem: () => null,
    setItem: () => {
      throw new Error('quota');
    },
  });
  await expect(failing.change('one', { install: bundledObjectPlugins[0]! })).rejects.toThrow(
    'quota',
  );
  expect(registry.list()).toEqual(coreObjectTypes);
  registry.registerObjectType({
    plugin: 'research',
    type: 'research.experiment',
    label: '外部注册',
  });
  await expect(host.change('one', { install: bundledObjectPlugins[0]! })).rejects.toThrow('已注册');
  expect(registry.get('research.paper')).toBeUndefined();
  expect(localStorage.length).toBe(0);
});
it('preserves corrupt installed state rather than overwriting it', async () => {
  localStorage.setItem('tano.object-plugins.v1.one', '{broken');
  await expect(host.change('one', { install: bundledObjectPlugins[0]! })).rejects.toThrow();
  expect(localStorage.getItem('tano.object-plugins.v1.one')).toBe('{broken');
});
it('merges another host installation before applying a toggle', async () => {
  await host.change('one', { install: bundledObjectPlugins[0]! });
  const other = new WorkspacePluginHost(new ObjectTypeRegistry());
  await other.change('one', { install: bundledObjectPlugins[1]! });
  expect(await host.change('one', { id: 'research', enabled: false })).toHaveLength(2);
  expect(registry.get('reading.book')).toBeDefined();
  other.dispose();
});
