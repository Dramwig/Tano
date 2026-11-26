// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  parsePluginEditorDecorations,
  parsePluginManifest,
  parsePluginPackage,
  type ExecutablePluginManifest,
  type PluginPackage,
  type Workspace,
} from '@tano/protocol';
import { PluginExecutionHost, type PluginRuntimeState } from './host';
import { PluginPackageCache } from './packages';
import { pluginWorkbenchCodeBlockRenderers, pluginWorkbenchDecorations } from './workbench';
import type { InstalledObjectPlugin } from './workspace-plugins';

function createMemoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

const sampleWorkspace: Workspace = {
  id: 'ws-phase13',
  name: 'Phase 1.3',
  path: '/phase13',
  files: [],
  readOnly: false,
};

const chartUiBundle = {
  html: '<div id="chart"></div>',
  css: '#chart { padding: 8px; }',
  source: 'tanoView.onState(() => {});',
};

function makePhase13Manifest(overrides: Partial<ExecutablePluginManifest> = {}): ExecutablePluginManifest {
  return parsePluginManifest({
    manifestVersion: 2,
    apiVersion: 1,
    id: 'chart-blocks',
    name: '图表与标注插件',
    version: '1.0.0',
    description: 'Phase 1.3 测试插件',
    objectTypes: [],
    relationTypes: [],
    permissions: ['documents.read', 'ui'],
    networkOrigins: [],
    nativeCommands: [],
    commands: [{ id: 'inspect-lint', label: '查看标注详情' }],
    views: [{ id: 'chart-card', label: '图表卡片', location: 'panel' }],
    codeBlockRenderers: [
      {
        languages: ['chart', 'tano-chart'],
        view: 'chart-card',
        label: '交互图表',
        height: 280,
      },
    ],
    ...overrides,
  }) as ExecutablePluginManifest;
}

async function setupPlugin(manifest = makePhase13Manifest(), includeUi = true) {
  const storage = createMemoryStorage();
  const pkg: PluginPackage = parsePluginPackage(
    JSON.stringify({
      packageVersion: 1,
      manifest,
      source: 'export function activate() {}',
      ...(includeUi ? { ui: { 'chart-card': chartUiBundle } } : {}),
    }),
  );
  const integrity = await new PluginPackageCache(storage).put(pkg);
  let lastStates: PluginRuntimeState[] = [];
  let onMessage: ((message: unknown) => void) | undefined;
  const sent: unknown[] = [];
  const host = new PluginExecutionHost(
    { call: vi.fn(async () => null) },
    (states) => {
      lastStates = states;
    },
    {},
    storage,
    (_source, receive) => {
      onMessage = receive;
      queueMicrotask(() => receive({ type: 'ready' }));
      return { send: (msg) => sent.push(msg), dispose: () => {} };
    },
  );
  const installed: InstalledObjectPlugin = {
    manifest,
    enabled: true,
    authorized: true,
    scope: 'workspace',
    rule: { manifest, mode: 'recommended', integrity, settings: {} },
  };
  host.sync(sampleWorkspace, [installed]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  let callId = 0;
  const rpc = async (method: string, params: Record<string, unknown> = {}) => {
    const id = ++callId;
    const before = sent.length;
    onMessage!({ type: 'call', id, method, params });
    for (let i = 0; i < 40; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      const reply = sent.slice(before).find((msg) => (msg as { id?: number }).id === id) as
        | { result?: unknown; error?: string; code?: string }
        | undefined;
      if (reply) return reply;
    }
    throw new Error(`RPC timeout for ${method}`);
  };
  return { host, rpc, getStates: () => lastStates, installed, sent, onMessage: () => onMessage! };
}

describe('Phase 1.3 protocol validators', () => {
  it('validates codeBlockRenderers permissions, reserved languages, height bounds, and UI bundle presence', () => {
    const manifest = makePhase13Manifest();
    expect(manifest.codeBlockRenderers).toHaveLength(1);

    expect(() => makePhase13Manifest({ permissions: ['documents.read'] })).toThrow('ui 权限');
    expect(() =>
      makePhase13Manifest({
        codeBlockRenderers: [{ languages: ['mermaid'], view: 'chart-card' }],
      }),
    ).toThrow();
    expect(() =>
      makePhase13Manifest({
        codeBlockRenderers: [{ languages: ['chart'], view: 'missing-view' }],
      }),
    ).toThrow('引用已声明的视图');
    expect(() =>
      makePhase13Manifest({
        codeBlockRenderers: [{ languages: ['chart'], view: 'chart-card', height: 50 }],
      }),
    ).toThrow('120 至 720');

    expect(() =>
      parsePluginPackage(
        JSON.stringify({
          packageVersion: 1,
          manifest,
          source: 'export function activate() {}',
        }),
      ),
    ).toThrow('缺少 UI 界面包');
  });

  it('validates editor decorations offsets, tones, badges, and limits', () => {
    expect(
      parsePluginEditorDecorations([
        { id: 'hit-1', from: 0, to: 10, tone: 'warning', badge: '待核对', tooltip: '说明', command: 'inspect-lint' },
        { from: 12, to: 12, badge: '行尾徽章' },
      ]),
    ).toHaveLength(2);

    expect(() => parsePluginEditorDecorations([{ from: 5, to: 5 }])).toThrow('badge');
    expect(() => parsePluginEditorDecorations([{ from: 10, to: 5 }])).toThrow('偏移范围无效');
    expect(() => parsePluginEditorDecorations([{ from: 0, to: 2, tone: 'neon' }])).toThrow('样式类型无效');
  });
});

describe('Phase 1.3 runtime codeBlockRenderers and decorations', () => {
  it('exposes capabilities, publishes decorations and codeBlockRenderers, allows codeBlock messages, and cleans up on dispose', async () => {
    const { host, rpc, getStates, installed, sent, onMessage } = await setupPlugin();

    const info = (await rpc('hostInfo')).result as { capabilities: string[] };
    expect(info.capabilities).toEqual(
      expect.arrayContaining(['editor.decorations', 'editor.codeBlockRenderers']),
    );

    // Code block renderer is available as soon as plugin starts running
    const renderers = pluginWorkbenchCodeBlockRenderers([installed], getStates());
    expect(renderers).toHaveLength(1);
    expect(renderers[0]!.languages).toEqual(['chart', 'tano-chart']);
    expect(renderers[0]!.bundle).toEqual(chartUiBundle);

    // Messages from a code block UI bundle route cleanly to the Worker without prior renderCustom
    const invokePromise = host.invoke(
      'chart-blocks',
      'message',
      'chart-card',
      { fileId: 'doc-1', language: 'chart', payload: { action: 'ping' } },
      renderers[0]!.instanceId,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    const invokeMsg = sent.find((msg) => (msg as { type?: string }).type === 'invoke') as { id: number; kind: string; name: string };
    expect(invokeMsg).toMatchObject({ kind: 'message', name: 'chart-card' });
    onMessage()({ type: 'invoked', id: invokeMsg.id });
    await invokePromise;

    // Rejects undeclared command binding on decoration
    const badDeco = await rpc('editor.setDecorations', {
      fileId: 'doc-1',
      decorations: [{ from: 0, to: 5, command: 'undeclared' }],
    });
    expect(badDeco.error).toContain('没有在清单中声明');

    // Accepts valid decorations and exposes via pluginWorkbenchDecorations
    await rpc('editor.setDecorations', {
      fileId: 'doc-1',
      decorations: [
        { id: 'warn-1', from: 2, to: 8, tone: 'warning', badge: '引用缺失', command: 'inspect-lint' },
      ],
    });
    const decos = pluginWorkbenchDecorations(getStates(), 'doc-1');
    expect(decos).toHaveLength(1);
    expect(decos[0]!.badge).toBe('引用缺失');
    expect(decos[0]!.tone).toBe('warning');

    // Clear decorations for doc-1
    await rpc('editor.clearDecorations', { fileId: 'doc-1' });
    expect(pluginWorkbenchDecorations(getStates(), 'doc-1')).toEqual([]);

    // Re-add and verify dispose clears both decorations and codeBlockRenderers
    await rpc('editor.setDecorations', {
      fileId: 'doc-1',
      decorations: [{ from: 0, to: 3, tone: 'accent' }],
    });
    host.dispose();
    expect(pluginWorkbenchDecorations(getStates(), 'doc-1')).toEqual([]);
    expect(pluginWorkbenchCodeBlockRenderers([installed], getStates())).toEqual([]);
  });

  it('rejects editor.setDecorations when plugin lacks documents.read permission', async () => {
    const manifest = makePhase13Manifest({ permissions: ['ui'] });
    const { host, rpc } = await setupPlugin(manifest, true);
    const result = await rpc('editor.setDecorations', {
      fileId: 'doc-1',
      decorations: [{ from: 0, to: 3 }],
    });
    expect(result.code).toBe('PERMISSION_DENIED');
    host.dispose();
  });
});
