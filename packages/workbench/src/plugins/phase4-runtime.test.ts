// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parsePluginManifest,
  parsePluginPackage,
  type ExecutablePluginManifest,
  type Workspace,
} from '@tano/protocol';
import { PluginExecutionHost } from './host';
import { PluginPackageCache } from './packages';
import type { InstalledObjectPlugin } from './workspace-plugins';

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: key => map.get(key) ?? null,
    key: index => [...map.keys()][index] ?? null,
    removeItem: key => {
      map.delete(key);
    },
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

const dummyWorkspace: Workspace = {
  id: 'ws-phase4',
  name: 'Phase 4 Lab',
  path: 'phase4-lab',
  readOnly: false,
  canManageSettings: true,
  files: [],
};

afterEach(() => {
  localStorage.clear();
});

describe('Phase 4 cross-plugin stateless services RPC', () => {
  it('lazily activates provider on service call, validates schemas, and blocks undeclared dependencies', async () => {
    const storage = createMemoryStorage();
    const cache = new PluginPackageCache(storage);

    const providerManifest = parsePluginManifest({
      manifestVersion: 2,
      apiVersion: 1,
      id: 'citation-provider',
      name: '引文服务',
      version: '1.0.0',
      description: '提供引文服务',
      objectTypes: [],
      relationTypes: [],
      permissions: [],
      networkOrigins: [],
      nativeCommands: [],
      commands: [],
      views: [],
      services: [
        {
          name: 'format',
          description: '格式化引文',
          parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
          returns: { type: 'object', properties: { formatted: { type: 'string' } }, required: ['formatted'] },
        },
      ],
      activationEvents: ['onService:format'],
    }) as ExecutablePluginManifest;

    const consumerManifest = parsePluginManifest({
      manifestVersion: 2,
      apiVersion: 1,
      id: 'paper-consumer',
      name: '论文插件',
      version: '1.0.0',
      description: '调用引文服务',
      objectTypes: [],
      relationTypes: [],
      permissions: [],
      networkOrigins: [],
      nativeCommands: [],
      commands: [],
      views: [],
      usesServices: [{ pluginId: 'citation-provider', service: 'format', optional: true }],
    }) as ExecutablePluginManifest;

    const providerPkg = parsePluginPackage(JSON.stringify({ packageVersion: 1, manifest: providerManifest, source: '// provider' }));
    const consumerPkg = parsePluginPackage(JSON.stringify({ packageVersion: 1, manifest: consumerManifest, source: '// consumer' }));
    const providerIntegrity = await cache.put(providerPkg);
    const consumerIntegrity = await cache.put(consumerPkg);

    let consumerReceive: ((msg: unknown) => void) | undefined;
    const consumerSent: unknown[] = [];
    let providerActivations = 0;

    const host = new PluginExecutionHost(
      { call: vi.fn(async () => null) },
      () => {},
      {},
      storage,
      (source, receive) => {
        if (source === '// consumer') {
          consumerReceive = receive;
          queueMicrotask(() => receive({ type: 'ready' }));
          return { send: msg => consumerSent.push(msg), dispose: () => {} };
        }
        providerActivations++;
        queueMicrotask(() => receive({ type: 'ready' }));
        return {
          send: msg => {
            const m = msg as { type?: string; id?: number; kind?: string; name?: string; payload?: { args: { title: string }; callerPluginId: string } };
            if (m.type === 'invoke' && m.kind === 'service' && m.name === 'format') {
              receive({
                type: 'invoked',
                id: m.id,
                result: { formatted: `[${m.payload!.callerPluginId}] ${m.payload!.args.title}` },
              });
            }
          },
          dispose: () => {},
        };
      },
    );

    const installed: InstalledObjectPlugin[] = [
      {
        manifest: providerManifest,
        enabled: true,
        authorized: true,
        scope: 'workspace',
        rule: { manifest: providerManifest, mode: 'recommended', integrity: providerIntegrity, settings: {} },
      },
      {
        manifest: consumerManifest,
        enabled: true,
        authorized: true,
        scope: 'workspace',
        rule: { manifest: consumerManifest, mode: 'recommended', integrity: consumerIntegrity, settings: {} },
      },
    ];

    host.sync(dummyWorkspace, installed);
    await vi.waitFor(() => expect(consumerReceive).toBeDefined());
    // Provider stays lazy (idle) before first call!
    expect(providerActivations).toBe(0);

    let seq = 0;
    const rpc = async (method: string, params: Record<string, unknown>) => {
      const id = ++seq;
      consumerReceive!({ type: 'call', id, method, params });
      await vi.waitFor(() =>
        expect(consumerSent.some(msg => (msg as { id?: number; type?: string }).id === id && (msg as { type?: string }).type === 'result')).toBe(true),
      );
      return consumerSent.find(msg => (msg as { id?: number; type?: string }).id === id && (msg as { type?: string }).type === 'result') as {
        result?: unknown;
        error?: string;
      };
    };

    expect((await rpc('services.available', { pluginId: 'citation-provider', service: 'format' })).result).toBe(true);

    // Calling service wakes lazy provider and returns validated result
    const ok = await rpc('services.call', {
      pluginId: 'citation-provider',
      service: 'format',
      payload: { title: 'Attention Is All You Need' },
    });
    expect(providerActivations).toBe(1);
    expect(ok.error).toBeUndefined();
    expect(ok.result).toEqual({ formatted: '[paper-consumer] Attention Is All You Need' });

    // Schema validation rejects missing required parameter
    const badArgs = await rpc('services.call', {
      pluginId: 'citation-provider',
      service: 'format',
      payload: {},
    });
    expect(badArgs.error).toContain('缺少必填字段');

    // Undeclared dependency is rejected
    const undeclared = await rpc('services.call', {
      pluginId: 'other-plugin',
      service: 'secret',
      payload: {},
    });
    expect(undeclared.error).toContain('usesServices');

    host.dispose();
  });
});
