// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { canonicalPluginJson, parsePluginPackage, type PluginCatalogRelease } from '@tano/protocol';
import { DemoAdapter } from '../adapter';
import { configureWorkbench } from '../runtime';
import { useWorkspaceStore } from '../stores/workspace';
import { documentOverviewPlugin } from './example';
import { pluginIntegrity } from './packages';
import type { PluginCatalogProvider } from './catalog';

vi.mock('./sandbox', () => ({ createPluginSandbox: () => ({ send: vi.fn(), dispose: vi.fn() }) }));
let store: ReturnType<typeof useWorkspaceStore>;
afterEach(() => { store?.dispose(); store?.$dispose(); vi.restoreAllMocks(); });
async function fixture() {
  localStorage.clear();
  const pkg = parsePluginPackage(JSON.stringify(documentOverviewPlugin));
  const release: PluginCatalogRelease = { publisher: 'author', manifest: pkg.manifest, integrity: await pluginIntegrity(pkg), bytes: new TextEncoder().encode(canonicalPluginJson(pkg)).length,
    publishedAt: '2026-10-09T00:00:00.000Z', source: 'https://example.com/source', license: 'MIT', notes: '', status: 'published' };
  const download = vi.fn<PluginCatalogProvider['download']>(async () => ({ pkg, sourceUrl: `https://catalog.example.com/packages/${release.integrity}.json` }));
  const publish = vi.fn(async () => {});
  const adapter = new DemoAdapter({ files: {} });
  setActivePinia(configureWorkbench(createPinia(), { adapter, native: false, mobile: false,
    plugins: { catalog: { source: 'https://catalog.example.com/index.json', list: vi.fn(), download }, repository: { publish, load: vi.fn() } } }));
  store = useWorkspaceStore(); await store.initialize();
  return { pkg, release, download, publish, workspace: store.workspace!.id, controller: new AbortController(), adapter };
}
it('installs into the existing workspace publication path without implicitly granting code trust', async () => {
  const { release, publish, workspace, controller } = await fixture();
  await store.installCatalogRelease(release, workspace, controller.signal);
  const installed = store.installedPlugins.find(item => item.manifest.id === release.manifest.id)!;
  expect(publish).toHaveBeenCalledWith(workspace, release.integrity, expect.any(String));
  expect(installed.rule?.integrity).toBe(release.integrity); expect(installed.authorized).toBe(false);
  expect(installed.rule?.sourceUrl).toContain(`/packages/${release.integrity}.json`);
});
it('keeps administrator rules and rollback history on update while requiring authorization for the new hash', async () => {
  const { pkg, release, download, workspace, controller } = await fixture();
  await store.installCatalogRelease(release, workspace, controller.signal);
  await store.authorizePlugin(pkg.manifest.id, release.integrity, workspace);
  await store.changePlugin({ id: pkg.manifest.id, mode: 'required', settings: { team: 'research' } }, workspace);
  const next = parsePluginPackage(JSON.stringify({ ...pkg, manifest: { ...pkg.manifest, version: '2.0.0' } }));
  const nextRelease = { ...release, manifest: next.manifest, integrity: await pluginIntegrity(next), bytes: new TextEncoder().encode(canonicalPluginJson(next)).length };
  download.mockResolvedValueOnce({ pkg: next });
  await store.installCatalogRelease(nextRelease, workspace, controller.signal);
  const installed = store.installedPlugins[0]!;
  expect(installed.rule).toMatchObject({ mode: 'required', settings: { team: 'research' }, integrity: nextRelease.integrity });
  expect(installed.rule?.history?.[0]?.integrity).toBe(release.integrity);
  expect(installed.authorized).toBe(false);
});
it.each(['switch', 'revoke', 'abort', 'corrupt'] as const)('rejects a late or invalid catalog download (%s)', async mode => {
  const { pkg, release, download, publish, workspace, controller } = await fixture();
  download.mockImplementationOnce(async () => {
    if (mode === 'switch') store.workspace = { ...store.workspace!, id: 'another-workspace' };
    if (mode === 'revoke') store.workspace!.canManagePlugins = false;
    if (mode === 'abort') controller.abort();
    return { pkg: mode === 'corrupt' ? { ...pkg, source: 'changed' } : pkg };
  });
  await expect(store.installCatalogRelease(release, workspace, controller.signal)).rejects.toThrow();
  expect(publish).not.toHaveBeenCalled(); expect(store.installedPlugins).toHaveLength(0);
});
