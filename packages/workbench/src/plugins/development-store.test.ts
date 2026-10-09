// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { parsePluginPackage } from '@tano/protocol';
import { DemoAdapter } from '../adapter';
import { configureWorkbench } from '../runtime';
import { useWorkspaceStore } from '../stores/workspace';
import { documentOverviewPlugin } from './example';
import { pluginIntegrity } from './packages';
import { WorkspacePluginHost } from '../workspace-plugins';

vi.mock('./sandbox', () => ({ createPluginSandbox: () => ({ send: vi.fn(), dispose: vi.fn() }) }));
let store: ReturnType<typeof useWorkspaceStore> | undefined;
afterEach(() => { store?.dispose(); store?.$dispose(); store = undefined; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each(['active', 'stopped', 'revoked'] as const)('checks the real store development session immediately before granting new code trust (%s)', async mode => {
  localStorage.clear();
  const adapter = new DemoAdapter({ files: {} });
  setActivePinia(configureWorkbench(createPinia(), { adapter, native: false, mobile: false }));
  store = useWorkspaceStore(); await store.initialize();
  await store.changePlugin({ install: documentOverviewPlugin.manifest, package: documentOverviewPlugin }, store.workspace!.id);
  const oldHash = store.installedPlugins[0]!.rule!.integrity!;
  await store.authorizePlugin(documentOverviewPlugin.manifest.id, oldHash, store.workspace!.id);
  const pkg = parsePluginPackage(JSON.stringify({ ...documentOverviewPlugin, source: '// new-development-build' }));
  const nextHash = await pluginIntegrity(pkg);
  const load = WorkspacePluginHost.prototype.loadWorkspace;
  vi.spyOn(WorkspacePluginHost.prototype, 'loadWorkspace').mockImplementation(async function(this: WorkspacePluginHost, adapter, workspace) {
    const installed = await load.call(this, adapter, workspace);
    // Stop exactly when the newly persisted pin is read back into the store.
    if (installed.some(plugin => plugin.rule?.integrity === nextHash)) {
      if (mode === 'stopped') store!.stopPluginDevelopment();
      // Simulate a second window revoking device trust while the new pin is read.
      if (mode === 'revoked') this.authorize(workspace.id, pkg.manifest.id, undefined);
    }
    return installed;
  });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(pkg))));
  store.startPluginDevelopment(pkg.manifest.id, `http://127.0.0.1:4173/${'a'.repeat(48)}/package.json`);
  await vi.waitFor(() => expect(store!.installedPlugins[0]!.rule!.integrity).toBe(nextHash));
  if (mode !== 'active') {
    await vi.waitFor(() => expect(store!.pluginDevelopment.active).toBe(false));
    expect(store.installedPlugins[0]!.authorized).toBe(false);
  } else await vi.waitFor(() => expect(store!.installedPlugins[0]!.authorized).toBe(true));
  expect(store.installedPlugins[0]!.rule!.history?.[0]?.integrity).toBe(oldHash);
});
