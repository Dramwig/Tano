// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  canonicalPluginJson,
  externalizeHeavyIconAssets,
  hydratePluginPackageAssets,
  ObjectTypeRegistry,
  parsePluginPackage,
  parsePluginPolicy,
  workspacePluginPath,
  workspacePluginPolicyLimit,
} from '@tano/protocol';
import { DemoAdapter } from '../workspace/adapter';
import { FileIconRegistry } from '../file-icons/registry';
import { AppearanceController } from '../appearance/appearance';
import { WorkspacePluginHost } from './workspace-plugins';
import type { PluginPackageRepository } from './packages';

const tinyPng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

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

it('validates iconRefs + assets.icons symmetry, preset references, and 1 MiB modern policy limit', () => {
  const inlinePkg = parsePluginPackage(
    JSON.stringify({
      packageVersion: 1,
      manifest: {
        manifestVersion: 1,
        id: 'raster-icons',
        name: '位图图标',
        version: '1.0.0',
        description: '测试位图外置',
        objectTypes: [],
        relationTypes: [],
        appearance: {
          version: 2,
          icons: [
            {
              id: 'raster',
              label: '位图集',
              notice: 'MIT License',
              icons: { doc: { color: 'currentColor', paths: [], silhouette: 'none', image: tinyPng } },
              file: 'doc',
            },
          ],
          presets: [{ id: 'p1', label: '预设', icons: 'raster' }],
        },
      },
    }),
  );

  const separated = externalizeHeavyIconAssets(inlinePkg);
  expect(separated.manifest.appearance?.icons).toBeUndefined();
  expect(separated.manifest.appearance?.iconRefs).toEqual([
    { id: 'raster', label: '位图集', notice: 'MIT License' },
  ]);
  expect(separated.assets?.icons).toHaveLength(1);
  expect(JSON.stringify(separated.manifest)).not.toContain('data:image/png;base64,');

  // Round-trip parse and hydrate
  const reparsed = parsePluginPackage(canonicalPluginJson(separated));
  const hydrated = hydratePluginPackageAssets(reparsed.manifest, reparsed);
  expect(hydrated.appearance?.icons?.[0]?.icons.doc?.image).toBe(tinyPng);

  // Missing assets.icons for declared iconRefs must throw
  expect(() =>
    parsePluginPackage(JSON.stringify({ packageVersion: 1, manifest: separated.manifest })),
  ).toThrow('assets.icons');

  // Policy with iconRefs must lock integrity
  expect(() =>
    parsePluginPolicy(
      JSON.stringify({
        version: 1,
        plugins: [{ manifest: separated.manifest, mode: 'optional', settings: {} }],
      }),
    ),
  ).toThrow('内容摘要');

  // Modern policy without inline PNGs enforces strict 1 MiB cap
  const oversizedModern = JSON.stringify({
    version: 1,
    plugins: [
      {
        manifest: {
          manifestVersion: 1,
          id: 'big',
          name: '大规则',
          version: '1.0.0',
          description: 'a'.repeat(100),
          objectTypes: [],
          relationTypes: [],
        },
        mode: 'optional',
        settings: { pad: 'x'.repeat(workspacePluginPolicyLimit + 1024) },
      },
    ],
  });
  expect(() => parsePluginPolicy(oversizedModern)).toThrow('1 MiB');
});

it('keeps vector SVG icon themes inline without externalizing them', () => {
  const vectorPkg = parsePluginPackage(
    JSON.stringify({
      packageVersion: 1,
      manifest: {
        manifestVersion: 1,
        id: 'vector-icons',
        name: '矢量图标',
        version: '1.0.0',
        description: '',
        objectTypes: [],
        relationTypes: [],
        appearance: {
          version: 2,
          icons: [
            {
              id: 'mono',
              label: '单色',
              icons: { doc: { color: 'currentColor', paths: ['M4 4h12v12H4z'] } },
              file: 'doc',
            },
          ],
        },
      },
    }),
  );
  const result = externalizeHeavyIconAssets(vectorPkg);
  expect(result).toBe(vectorPkg);
  expect(result.assets).toBeUndefined();
});

it('automatically externalizes real 2.2 MiB Material Icon Theme out of .tano/plugins.tano.json and hydrates via cache and repository', async () => {
  const rawMaterial = readFileSync(
    'examples/plugins/material-icon-theme/material-icon-theme-1.0.0.tano-plugin.json',
    'utf8',
  );
  const materialPkg = parsePluginPackage(rawMaterial);
  const ownerStorage = createMemoryStorage();
  const repoBlobs = new Map<string, string>();
  const repository: PluginPackageRepository = {
    publish: vi.fn(async (_ws, integrity, content) => {
      repoBlobs.set(integrity, content);
    }),
    load: vi.fn(async (_ws, integrity) => {
      const content = repoBlobs.get(integrity);
      if (!content) throw new Error('missing');
      return content;
    }),
  };

  const adapter = new DemoAdapter({
    files: { 'notes.md': '# Hello\n' },
    storageKey: 'demo-icon-assets',
    workspaceId: 'ws-icons',
  });
  const workspace = await adapter.open();
  const ownerHost = new WorkspacePluginHost(new ObjectTypeRegistry(), ownerStorage, 'owner', []);
  await ownerHost.loadWorkspace(adapter, workspace, repository);
  await ownerHost.changeWorkspace(
    adapter,
    workspace,
    { install: materialPkg.manifest, package: materialPkg, scope: 'workspace' },
    () => {},
    repository,
  );

  // Portable .tano/plugins.tano.json stays tiny (< 10 KiB) with zero inline PNG bytes!
  const policyFile = await adapter.read(workspacePluginPath);
  expect(new TextEncoder().encode(policyFile.content).length).toBeLessThan(10 * 1024);
  expect(policyFile.content).not.toContain('data:image/png;base64,');
  expect(repository.publish).toHaveBeenCalledOnce();

  // Teammate with empty local cache hydrates PNG icons from the SHA-256 verified repository
  const memberStorage = createMemoryStorage();
  const memberHost = new WorkspacePluginHost(new ObjectTypeRegistry(), memberStorage, 'member', []);
  const refreshed = await adapter.refresh();
  const installed = await memberHost.loadWorkspace(adapter, refreshed, repository);
  expect(repository.load).toHaveBeenCalledOnce();

  const registry = new FileIconRegistry();
  const appearance = new AppearanceController(registry, 'member', memberStorage, () => {});
  appearance.sync(refreshed.id, installed);
  appearance.select({ workspaceId: refreshed.id, kind: 'icons', id: 'material-icon-theme:material' });
  expect(registry.resolve({ path: 'main.ts' }).icon.image).toMatch(/^data:image\/png;base64,/);

  appearance.dispose();
  ownerHost.dispose();
  memberHost.dispose();
});
