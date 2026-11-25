import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  packPluginArchiveV2,
  pluginPermissions,
  pluginViewLocations,
  unpackPluginArchiveV2,
  type ExecutablePluginManifest,
  type PluginPackage,
} from '@tano/protocol';
import {
  applyOverlayToWorkspaceViews,
  isOverlaySidebarNavHidden,
  overlaySidebarNavOrderStyle,
  resolveOverlayTabView,
} from './overlay-mapping';
import { PluginPackageCache } from './packages';
import { PluginExecutionHost } from './host';
import type { PluginWorkbenchView } from './workbench';
import workerSource from './worker.js?raw';

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

function createInProcessSandbox(pluginSource: string, receive: (message: unknown) => void) {
  let workerOnMessage: ((event: { data: unknown }) => void) | null = null;
  let terminated = false;
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const workerEnv = {
    postMessage: (data: unknown) => {
      if (!terminated) queueMicrotask(() => receive(structuredClone(data)));
    },
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(handler);
    },
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    setTimeout,
    clearTimeout,
  };
  const runner = new Function(
    'postMessage',
    'addEventListener',
    'console',
    'setTimeout',
    'clearTimeout',
    `${workerSource}\nconst __start = async () => {\n${pluginSource}\npostMessage({ type: 'ready' });\n};\nvoid __start();\nreturn { onmessage };`,
  );
  const exports = runner(
    workerEnv.postMessage,
    workerEnv.addEventListener,
    workerEnv.console,
    workerEnv.setTimeout,
    workerEnv.clearTimeout,
  );
  workerOnMessage = exports.onmessage;
  return {
    send(data: unknown) {
      if (!terminated) queueMicrotask(() => workerOnMessage?.({ data: structuredClone(data) }));
    },
    dispose() {
      terminated = true;
    },
  };
}

describe('P0-1: L1/Tier 2 Overlay shell mapping', () => {
  it('hides and reorders home sidebar nav items and workspace view tabs safely', () => {
    expect(isOverlaySidebarNavHidden('plan', ['calendar'])).toBe(true);
    expect(isOverlaySidebarNavHidden('view:mail', ['mail'])).toBe(true);
    expect(isOverlaySidebarNavHidden('search', ['search'])).toBe(true);
    expect(isOverlaySidebarNavHidden('graph', ['mail'])).toBe(false);

    expect(overlaySidebarNavOrderStyle('view:mail', ['mail', 'calendar'])).toEqual({ order: 0 });
    expect(overlaySidebarNavOrderStyle('plan', ['mail', 'calendar'])).toEqual({ order: 1 });
    expect(overlaySidebarNavOrderStyle('unknown', ['mail', 'calendar'])).toBeUndefined();

    const baseViews = [
      { id: 'repository', label: '文件' },
      { id: 'events', label: '事件与任务' },
      { id: 'assistant', label: '助手' },
      { id: 'plugin-views', label: '插件' },
    ];
    const reordered = applyOverlayToWorkspaceViews(baseViews, ['tasks'], ['plugins', 'files']);
    expect(reordered.map((v) => v.id)).toEqual(['plugin-views', 'repository', 'assistant']);

    // Never returns an empty list even if every mapped view is hidden
    const onlyMapped = [
      { id: 'repository', label: '文件' },
      { id: 'plugin-views', label: '插件' },
    ];
    expect(applyOverlayToWorkspaceViews(onlyMapped, ['files', 'plugins']).map((v) => v.id)).toEqual([
      'repository',
    ]);
  });

  it('resolves homeTabView vs newTabView and falls back in Safe Mode', () => {
    const homeView = {
      key: 'dashboard:home',
      pluginId: 'dashboard',
      pluginName: 'Dashboard',
      id: 'home',
      label: '工作台首页',
      location: 'homeTab',
    } as PluginWorkbenchView;
    const newTabView = {
      key: 'dashboard:newtab',
      pluginId: 'dashboard',
      pluginName: 'Dashboard',
      id: 'newtab',
      label: '新建标签页',
      location: 'newTab',
    } as PluginWorkbenchView;

    expect(resolveOverlayTabView('', { homeTabView: homeView, newTabView })).toBe(homeView);
    expect(resolveOverlayTabView('blank:123', { homeTabView: homeView, newTabView })).toBe(newTabView);
    expect(resolveOverlayTabView('', { safeMode: true, homeTabView: homeView, newTabView })).toBeNull();
    expect(resolveOverlayTabView('blank:123', { safeMode: true, homeTabView: homeView, newTabView })).toBeNull();
  });
});

describe('P0-2: v2 ZIP binary assets cache and Worker tano.assets API', () => {
  it('persists binary assets in PluginPackageCache and serves them via tano.assets.list/read', async () => {
    const storage = createMemoryStorage();
    const manifest: ExecutablePluginManifest = {
      manifestVersion: 2,
      apiVersion: 1,
      id: 'asset-reader',
      name: '资产读取插件',
      version: '1.0.0',
      description: '验证 v2 ZIP 二进制资产读取',
      objectTypes: [],
      relationTypes: [],
      permissions: [],
      networkOrigins: [],
      nativeCommands: [],
      commands: [{ id: 'read-bin', label: '读取二进制资产' }],
      views: [],
    };
    const pkg: PluginPackage = {
      packageVersion: 1,
      manifest,
      source: `
        tano.commands.register('read-bin', async () => {
          const list = await tano.assets.list();
          const asset = await tano.assets.read('models/dict.bin');
          await tano.notify(JSON.stringify({ list, bytes: asset.bytes, base64: asset.base64 }));
        });
      `,
    };
    const payload = new Uint8Array([0x54, 0x41, 0x4e, 0x4f, 0x02]); // "TANO\x02"
    const zipBytes = packPluginArchiveV2({
      pkg,
      binaryAssets: { 'models/dict.bin': payload },
    });
    const unpacked = unpackPluginArchiveV2(zipBytes);

    const cache = new PluginPackageCache(storage);
    const integrity = await cache.put(unpacked.pkg, unpacked.binaryAssets);

    expect(await cache.listBinaryAssets(integrity)).toEqual(['models/dict.bin']);
    const cached = await cache.getBinaryAsset(integrity, 'models/dict.bin');
    expect(cached).toEqual({
      path: 'models/dict.bin',
      bytes: 5,
      base64: Buffer.from(payload).toString('base64'),
    });
    await expect(cache.getBinaryAsset(integrity, '../escape.bin')).rejects.toThrow(/路径无效/);

    // Execute inside PluginExecutionHost using the same storage so worker can call tano.assets.*
    let latestMessage = '';
    let runningResolve: (() => void) | null = null;
    const ready = new Promise<void>((res) => {
      runningResolve = res;
    });
    const host = new PluginExecutionHost(
      { call: async () => null },
      (states) => {
        const st = states.find((s) => s.id === 'asset-reader');
        if (st?.status === 'running' && st.commands.some((c) => c.id === 'read-bin')) {
          runningResolve?.();
        }
        if (st?.message) latestMessage = st.message;
      },
      { host: { coreVersion: '0.14.0', platform: 'web' } },
      storage,
      (src, receive) => createInProcessSandbox(src, receive),
    );

    host.sync(
      {
        id: 'ws-assets',
        name: 'WS',
        path: 'ws',
        mode: 'demo',
        files: [],
      } as never,
      [
        {
          manifest,
          enabled: true,
          authorized: true,
          scope: 'workspace',
          rule: { manifest, integrity, mode: 'recommended', settings: {} },
        },
      ],
    );

    await ready;
    await host.invoke('asset-reader', 'command', 'read-bin', { workspaceId: 'ws-assets' });
    const parsed = JSON.parse(latestMessage) as { list: string[]; bytes: number; base64: string };
    expect(parsed.list).toEqual(['models/dict.bin']);
    expect(parsed.bytes).toBe(5);
    expect(parsed.base64).toBe(Buffer.from(payload).toString('base64'));
    host.dispose();

    // Cleanup removes binary assets along with package
    await cache.remove(integrity);
    expect(await cache.listBinaryAssets(integrity)).toEqual([]);
  });
});

describe('P1-4: Official manifest.schema.json contract parity', () => {
  it('stays in sync with runtime permissions, view locations, and Phase 0–4 fields', () => {
    const schemaPath = resolve(__dirname, '../../../protocol/manifest.schema.json');
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as {
      $schema: string;
      $defs: {
        permission: { enum: string[] };
        viewLocation: { enum: string[] };
        executableManifest: { properties: Record<string, unknown> };
      };
    };

    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.$defs.permission.enum).toEqual([...pluginPermissions]);
    expect(schema.$defs.viewLocation.enum).toEqual([...pluginViewLocations]);

    const props = schema.$defs.executableManifest.properties;
    for (const key of [
      '$schema',
      'engines',
      'platforms',
      'fileHandlers',
      'slashCommands',
      'codeBlockRenderers',
      'assistantTools',
      'assistantContextProviders',
      'services',
      'usesServices',
      'settingsSchema',
      'activationEvents',
      'automations',
    ]) {
      expect(props).toHaveProperty(key);
    }
  });
});
