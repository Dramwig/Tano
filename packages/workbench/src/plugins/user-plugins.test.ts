// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import {
  ObjectTypeRegistry,
  parsePluginManifest,
  workspacePluginPath,
  type PluginManifest,
  type PluginPackage,
} from '@tano/protocol';
import { DemoAdapter } from '../workspace/adapter';
import { documentOverviewPlugin } from './example';
import { WorkspacePluginHost } from './workspace-plugins';
import { systemPluginIds } from './system';
import {
  isAppearanceOnlyPlugin,
  readUserPlugins,
  userScopeUnsupportedReason,
} from './user-plugins';

const themeManifest: PluginManifest = parsePluginManifest({
  manifestVersion: 1,
  id: 'theme-global',
  name: '全局纸页主题',
  version: '1.0.0',
  description: '跨工作区配色主题',
  objectTypes: [],
  relationTypes: [],
  appearance: {
    version: 2,
    colors: [{ id: 'warm', label: '暖纸', light: { paper: '#fff8e8', text: '#352a20' } }],
  },
});

function createMemoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

beforeEach(() => localStorage.clear());

it('installs declarative user-scope plugins without writing .tano/plugins.tano.json and keeps them across workspaces', async () => {
  const storage = createMemoryStorage();
  const host = new WorkspacePluginHost(new ObjectTypeRegistry(), storage, 'user-a', systemPluginIds);

  const adapterA = new DemoAdapter({ files: { 'a.md': '# A\n' }, storageKey: 'demo-a-1', workspaceId: 'ws-a' });
  const workspaceA = { ...(await adapterA.open()), readOnly: true };
  const createSpy = vi.spyOn(adapterA, 'create');
  const writeSpy = vi.spyOn(adapterA, 'write');

  await host.loadWorkspace(adapterA, workspaceA);
  expect(isAppearanceOnlyPlugin(themeManifest)).toBe(true);
  // Works even in a read-only workspace without admin permission
  await host.changeWorkspace(adapterA, workspaceA, { install: themeManifest, scope: 'user' }, () => {});
  expect(createSpy).not.toHaveBeenCalled();
  expect(writeSpy).not.toHaveBeenCalled();

  const loadedA = await host.loadWorkspace(adapterA, workspaceA);
  const installedA = loadedA.find((item) => item.manifest.id === 'theme-global');
  expect(installedA).toMatchObject({ scope: 'user', enabled: true, authorized: true });
  expect(host.userPluginIntegrities().has(installedA!.rule!.integrity!)).toBe(true);

  // Switch to a brand-new workspace B: the user-scoped theme is immediately active
  const adapterB = new DemoAdapter({ files: { 'b.md': '# B\n' }, storageKey: 'demo-b-1', workspaceId: 'ws-b' });
  const workspaceB = await adapterB.open();
  const loadedB = await host.loadWorkspace(adapterB, workspaceB);
  expect(loadedB.find((item) => item.manifest.id === 'theme-global')).toMatchObject({
    scope: 'user',
    enabled: true,
    authorized: true,
  });

  // Personal settings & toggle persist across workspaces
  await host.changeWorkspace(
    adapterB,
    workspaceB,
    { id: 'theme-global', settings: { compact: true }, scope: 'user' },
    () => {},
  );
  await host.changeWorkspace(adapterB, workspaceB, { id: 'theme-global', enabled: false }, () => {});
  const reloadedA = await host.loadWorkspace(adapterA, workspaceA);
  expect(reloadedA.find((item) => item.manifest.id === 'theme-global')).toMatchObject({
    scope: 'user',
    enabled: false,
    rule: expect.objectContaining({ settings: { compact: true } }),
  });

  // Uninstall removes from user scope
  await host.changeWorkspace(adapterA, workspaceA, { uninstall: 'theme-global' }, () => {});
  expect(readUserPlugins(storage, 'user-a')).toEqual([]);
  expect((await host.loadWorkspace(adapterB, workspaceB)).find((item) => item.manifest.id === 'theme-global')).toBeUndefined();
  host.dispose();
});

it('prioritizes workspace rules (including disabled) over user-scope plugins of the same ID, and restores user copy elsewhere', async () => {
  const storage = createMemoryStorage();
  const host = new WorkspacePluginHost(new ObjectTypeRegistry(), storage, 'user-a', systemPluginIds);

  const adapterA = new DemoAdapter({ files: { 'a.md': '# A\n' }, storageKey: 'demo-a-2', workspaceId: 'ws-a' });
  const workspaceA = await adapterA.open();
  await host.loadWorkspace(adapterA, workspaceA);
  await host.changeWorkspace(adapterA, workspaceA, { install: themeManifest, scope: 'user' }, () => {});

  // Workspace A installs v2.0.0 of the same ID
  const workspaceV2 = parsePluginManifest({ ...themeManifest, version: '2.0.0' });
  await host.changeWorkspace(adapterA, workspaceA, { install: workspaceV2, scope: 'workspace' }, () => {});
  let refreshedA = await adapterA.refresh();
  const loadedA = await host.loadWorkspace(adapterA, refreshedA);
  const activeA = loadedA.find((item) => item.manifest.id === 'theme-global');
  expect(activeA).toMatchObject({
    scope: 'workspace',
    shadowedUserPlugin: true,
    manifest: expect.objectContaining({ version: '2.0.0' }),
  });

  // Workspace A sets mode: 'disabled' -> must block user-scope plugin inside Workspace A
  await host.changeWorkspace(
    adapterA,
    refreshedA,
    { id: 'theme-global', mode: 'disabled', settings: {} },
    () => {},
  );
  refreshedA = await adapterA.refresh();
  const disabledA = (await host.loadWorkspace(adapterA, refreshedA)).find((item) => item.manifest.id === 'theme-global');
  expect(disabledA).toMatchObject({ scope: 'workspace', enabled: false, shadowedUserPlugin: true });

  // Workspace B has no workspace rule -> user-scope v1.0.0 resumes automatically
  const adapterB = new DemoAdapter({ files: { 'b.md': '# B\n' }, storageKey: 'demo-b-2', workspaceId: 'ws-b' });
  const workspaceB = await adapterB.open();
  const loadedB = await host.loadWorkspace(adapterB, workspaceB);
  expect(loadedB.find((item) => item.manifest.id === 'theme-global')).toMatchObject({
    scope: 'user',
    enabled: true,
    manifest: expect.objectContaining({ version: '1.0.0' }),
  });
  expect((await adapterB.refresh()).files.some((file) => file.path === workspacePluginPath)).toBe(false);
  host.dispose();
});

it('enforces exact-integrity authorization for v2 user plugins and isolates shared non-admin workspaces from global auto-auth', async () => {
  const storage = createMemoryStorage();
  const host = new WorkspacePluginHost(new ObjectTypeRegistry(), storage, 'user-a', systemPluginIds);

  const adapterOwned1 = new DemoAdapter({ files: { 'a.md': '# A\n' }, storageKey: 'demo-o-1', workspaceId: 'ws-owned-1' });
  const owned1 = await adapterOwned1.open();
  await host.loadWorkspace(adapterOwned1, owned1);

  await host.changeWorkspace(
    adapterOwned1,
    owned1,
    { install: documentOverviewPlugin.manifest, package: documentOverviewPlugin, scope: 'user' },
    () => {},
  );
  let loaded1 = await host.loadWorkspace(adapterOwned1, owned1);
  let entry = loaded1.find((item) => item.manifest.id === documentOverviewPlugin.manifest.id)!;
  expect(entry).toMatchObject({ scope: 'user', enabled: true, authorized: false, globallyAuthorized: false });

  // Per-workspace auth only authorizes owned1, not owned2
  host.authorize(owned1.id, entry.manifest.id, entry.rule!.integrity);
  const adapterOwned2 = new DemoAdapter({ files: { 'b.md': '# B\n' }, storageKey: 'demo-o-2', workspaceId: 'ws-owned-2' });
  const owned2 = await adapterOwned2.open();
  expect(
    (await host.loadWorkspace(adapterOwned2, owned2)).find((item) => item.manifest.id === entry.manifest.id)?.authorized,
  ).toBe(false);

  // Explicit global auth authorizes owned2 (where user can manage)
  await host.loadWorkspace(adapterOwned1, owned1);
  host.authorize(owned1.id, entry.manifest.id, entry.rule!.integrity, undefined, { allWorkspaces: true });
  expect(
    (await host.loadWorkspace(adapterOwned2, owned2)).find((item) => item.manifest.id === entry.manifest.id),
  ).toMatchObject({ authorized: true, globallyAuthorized: true });

  // Non-admin shared online workspace MUST NOT inherit global auto-auth
  const teamAdapter = new DemoAdapter({ files: { 'team.md': '# Team\n' }, storageKey: 'demo-team', workspaceId: 'ws-team' });
  Object.defineProperty(teamAdapter, 'mode', { value: 'web' });
  const teamWs = { ...(await teamAdapter.open()), canManagePlugins: false };
  expect(
    (await host.loadWorkspace(teamAdapter, teamWs)).find((item) => item.manifest.id === entry.manifest.id),
  ).toMatchObject({ scope: 'user', authorized: false, globallyAuthorized: true });

  // Upgrading the user plugin to a new version invalidates global auth
  const upgradedPkg: PluginPackage = {
    ...documentOverviewPlugin,
    manifest: { ...documentOverviewPlugin.manifest, version: '1.1.0' },
  };
  await host.loadWorkspace(adapterOwned1, owned1);
  await host.changeWorkspace(
    adapterOwned1,
    owned1,
    { install: upgradedPkg.manifest, package: upgradedPkg, scope: 'user' },
    () => {},
  );
  loaded1 = await host.loadWorkspace(adapterOwned1, owned1);
  entry = loaded1.find((item) => item.manifest.id === upgradedPkg.manifest.id)!;
  expect(entry).toMatchObject({ authorized: false, globallyAuthorized: false });

  // Re-authorizing globally then revoking clears both per-workspace and global auth
  host.authorize(owned1.id, entry.manifest.id, entry.rule!.integrity, undefined, { allWorkspaces: true });
  host.authorize(owned1.id, entry.manifest.id, undefined);
  expect(
    (await host.loadWorkspace(adapterOwned2, owned2)).find((item) => item.manifest.id === entry.manifest.id),
  ).toMatchObject({ authorized: false, globallyAuthorized: false });
  host.dispose();
});

it('rejects workspace-bound capabilities (connections, native, automations) from user scope', async () => {
  const storage = createMemoryStorage();
  const host = new WorkspacePluginHost(new ObjectTypeRegistry(), storage, 'user-a', systemPluginIds);
  const adapter = new DemoAdapter({ files: {} });
  const workspace = await adapter.open();
  await host.loadWorkspace(adapter, workspace);

  const cases: Partial<PluginManifest>[] = [
    { permissions: ['connections'], networkOrigins: ['https://api.example.com'] },
    { permissions: ['native'], nativeCommands: ['git.status'] },
    { permissions: ['documents.read'], automations: [{ id: 'daily', label: '日报' }] },
  ];
  for (const extra of cases) {
    const pkg: PluginPackage = {
      ...documentOverviewPlugin,
      manifest: { ...documentOverviewPlugin.manifest, ...extra } as PluginPackage['manifest'],
      ...(extra && 'automations' in extra ? { automationSource: 'return { ok: true };' } : {}),
    };
    expect(userScopeUnsupportedReason(pkg.manifest)).toBeDefined();
    await expect(
      host.changeWorkspace(adapter, workspace, { install: pkg.manifest, package: pkg, scope: 'user' }, () => {}),
    ).rejects.toThrow('仅支持安装到工作区');
  }
  host.dispose();
});
