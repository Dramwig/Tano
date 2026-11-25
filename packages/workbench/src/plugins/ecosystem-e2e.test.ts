// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import {
  isPluginArchiveV2Bytes,
  packPluginArchiveV2,
  parsePluginManifest,
  parsePluginPackage,
  pluginArchiveDigest,
  unpackPluginArchiveV2,
  type AssistantRequest,
  type AssistantSession,
  type AssistantTransport,
  type ExecutablePluginManifest,
} from '@tano/protocol';
import { DemoAdapter } from '../workspace/adapter';
import { configureWorkbench, createLocalExtensions } from '../runtime';
import { useWorkspaceStore } from '../stores/workspace';
import { useAssistantStore } from '../assistant/store';
import { pluginAssistantWireName } from './assistant-bridge';

const PROVIDER_SRC = '/* e2e-provider-v2 */';
const CONSUMER_SRC = '/* e2e-consumer-v2 */';

const sandboxes = vi.hoisted(() => ({
  bySource: new Map<string, { receive: (msg: unknown) => void; sent: unknown[] }>(),
  providerActivations: 0,
  createdCards: [] as Record<string, unknown>[],
}));

vi.mock('./sandbox', () => ({
  createPluginSandbox: (source: string, receive: (message: unknown) => void) => {
    const sent: unknown[] = [];
    if (source === PROVIDER_SRC || source === CONSUMER_SRC) {
      sandboxes.bySource.set(source, { receive, sent });
      if (source === PROVIDER_SRC) sandboxes.providerActivations++;
      queueMicrotask(() => receive({ type: 'ready' }));
      return {
        send: (msg: unknown) => {
          sent.push(msg);
          const m = msg as {
            type?: string;
            id?: number;
            kind?: string;
            name?: string;
            payload?: Record<string, unknown>;
          };
          if (source === PROVIDER_SRC && m.type === 'invoke') {
            if (m.kind === 'service' && m.name === 'format') {
              const args = (m.payload?.args ?? {}) as { title?: string };
              receive({
                type: 'invoked',
                id: m.id,
                result: { formatted: `APA(${m.payload?.callerPluginId}): ${args.title}` },
              });
            } else if (m.kind === 'assistant-context' && m.name === 'board') {
              receive({
                type: 'invoked',
                id: m.id,
                result: { title: '看板实时摘要', content: '进行中 3 项，含 1 项高优。' },
              });
            } else if (m.kind === 'assistant-tool' && m.name === 'list_cards') {
              receive({
                type: 'invoked',
                id: m.id,
                result: { cards: [{ id: 'c-1', title: '合并验证' }] },
              });
            } else if (m.kind === 'assistant-tool' && m.name === 'create_card') {
              const args = (m.payload?.args ?? {}) as Record<string, unknown>;
              sandboxes.createdCards.push(args);
              receive({ type: 'invoked', id: m.id, result: { id: 'c-2', ...args, ok: true } });
            }
          }
        },
        dispose: vi.fn(),
      };
    }
    return { send: vi.fn(), dispose: vi.fn() };
  },
}));

function encodeSse(frames: unknown[]): Uint8Array[] {
  const encoder = new TextEncoder();
  return [...frames.map(f => encoder.encode(`data: ${JSON.stringify(f)}\n\n`)), encoder.encode('data: [DONE]\n\n')];
}

function createMockTransport(handler: (req: AssistantRequest) => unknown[]): AssistantTransport {
  const sessions = new Map<string, AssistantSession>();
  return {
    connections: async () => [
      { id: 'conn-e2e', name: 'E2E LLM', endpoint: 'https://api.example.invalid/v1', tools: true, maxOutputTokens: 2048, hasKey: true },
    ],
    models: async () => ['gpt-e2e'],
    saveConnection: async () => {},
    removeConnection: async () => {},
    loadSessions: async wsId => [...sessions.values()].filter(s => s.workspaceId === wsId),
    saveSession: async session => {
      const next = { ...session, revision: session.revision + 1 };
      sessions.set(session.id, next);
      return next.revision;
    },
    deleteSession: async (_wsId, id) => {
      sessions.delete(id);
    },
    request: async (_connId, request, signal, chunk) => {
      signal.throwIfAborted();
      for (const bytes of encodeSse(handler(request))) {
        signal.throwIfAborted();
        chunk(bytes);
      }
    },
  };
}

afterEach(() => {
  localStorage.clear();
  document.getElementById('tano-workbench-overlay-style')?.remove();
  sandboxes.bySource.clear();
  sandboxes.providerActivations = 0;
  sandboxes.createdCards = [];
});

describe('Combined Phase 0-4 Plugin Ecosystem End-to-End Integration', () => {
  it('verifies ZIP v2 container -> pathScopes/frontmatter/statusBar -> Assistant tools/context/tano.ai -> L1/Tier2 Overlay + L2 Forge -> Cross-plugin RPC -> Safe Mode & Tier 3 cutoff', async () => {
    // --- Phase 0 + Phase 4: Build & pack deterministic v2 ZIP containers with raw WASM binary ---
    const providerManifest = parsePluginManifest({
      manifestVersion: 2,
      apiVersion: 1,
      id: 'suite-provider',
      name: '全能引文与看板',
      version: '1.0.0',
      description: 'Phase 0-4 综合提供方插件',
      objectTypes: [],
      relationTypes: [],
      permissions: ['documents.read', 'documents.write', 'documents.move', 'attachments.write', 'ai.invoke'],
      networkOrigins: [],
      nativeCommands: [],
      commands: [{ id: 'refresh', label: '刷新面板' }],
      views: [{ id: 'home', label: '自定义首页', location: 'homeTab' }],
      assistantTools: [
        {
          name: 'list_cards',
          label: '读取卡片',
          description: '只读查询卡片',
          effect: 'read',
          parameters: { type: 'object', properties: { status: { type: 'string' } }, required: ['status'] },
        },
        {
          name: 'create_card',
          label: '创建卡片',
          description: '写入新建卡片',
          effect: 'write',
          parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
        },
      ],
      assistantContextProviders: [
        { id: 'board', label: '看板摘要', description: '返回当前看板状态', maxBytes: 4096 },
      ],
      services: [
        {
          name: 'format',
          description: '格式化引文',
          parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
          returns: { type: 'object', properties: { formatted: { type: 'string' } }, required: ['formatted'] },
        },
      ],
    }) as ExecutablePluginManifest;

    const consumerManifest = parsePluginManifest({
      manifestVersion: 2,
      apiVersion: 1,
      id: 'suite-consumer',
      name: '论文协作消费者',
      version: '1.0.0',
      description: '跨插件调用引文服务',
      objectTypes: [],
      relationTypes: [],
      permissions: ['documents.read'],
      networkOrigins: [],
      nativeCommands: [],
      commands: [],
      views: [],
      usesServices: [{ pluginId: 'suite-provider', service: 'format', optional: false }],
    }) as ExecutablePluginManifest;

    const wasmPayload = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
    const providerPkgV1 = parsePluginPackage(JSON.stringify({ packageVersion: 1, manifest: providerManifest, source: PROVIDER_SRC }));
    const zipBytes = packPluginArchiveV2({ pkg: providerPkgV1, binaryAssets: { 'layout.wasm': wasmPayload } });
    expect(isPluginArchiveV2Bytes(zipBytes)).toBe(true);
    expect(await pluginArchiveDigest(zipBytes)).toBe(
      await pluginArchiveDigest(packPluginArchiveV2({ pkg: providerPkgV1, binaryAssets: { 'layout.wasm': wasmPayload } })),
    );
    const unpacked = unpackPluginArchiveV2(zipBytes);
    expect(unpacked.binaryAssets['layout.wasm']).toEqual(wasmPayload);

    // --- Setup Workspace + Assistant stores with generic CloudExtension hooks ---
    const adapter = new DemoAdapter({
      files: {
        '日报/today.md': '---\ntitle: 今日日志\ntags:\n  - work\n---\n正文内容\n',
        '机密/private.md': '# 机密文档\n',
      },
    });
    const importAttachment = vi.fn(async (_wsId: string, _docPath: string, file: File, image: boolean) => ({
      path: `日报/assets/${file.name}`,
      name: file.name,
      image,
      url: `assets/${file.name}`,
    }));

    const overlayState = reactive<{
      safeMode: boolean;
      hiddenSidebarItems?: string[];
      homeTabViewKey?: string;
    }>({ safeMode: false });
    const extensionApplied: Record<string, unknown>[] = [];

    const readWire = pluginAssistantWireName('suite-provider', 'list_cards');
    const writeWire = pluginAssistantWireName('suite-provider', 'create_card');
    let assistantRound = 0;

    const transport = createMockTransport(req => {
      if (!req.tools) {
        return [{ choices: [{ index: 0, delta: { content: '{"tag":"urgent"}' }, finish_reason: 'stop' }] }];
      }
      assistantRound++;
      if (assistantRound === 1) {
        return [
          {
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    { index: 0, id: 'c1', type: 'function', function: { name: readWire, arguments: '{"status":"doing"}' } },
                    { index: 1, id: 'c2', type: 'function', function: { name: writeWire, arguments: '{"title":"全链路验收","_reason":"验收创建"}' } },
                    {
                      index: 2,
                      id: 'c3',
                      type: 'function',
                      function: {
                        name: 'host_propose_overlay',
                        arguments: JSON.stringify({
                          homeTabViewKey: 'plugin:suite-provider:home',
                          hiddenSidebarItems: ['mail'],
                        }),
                      },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
          },
        ];
      }
      return [{ choices: [{ index: 0, delta: { content: '已完成查询并生成 2 项待确认提案。' }, finish_reason: 'stop' }] }];
    });

    const hostExtensions = {
      ...createLocalExtensions(),
      overlay: {
        get snapshot() {
          return overlayState;
        },
        setSafeMode(enabled: boolean) {
          overlayState.safeMode = enabled;
        },
      },
      assistant: {
        listTools: () => [
          {
            type: 'function' as const,
            function: {
              name: 'host_propose_overlay',
              description: 'Host extension overlay proposal',
              parameters: { type: 'object', properties: {} },
            },
          },
        ],
        executeTool: async (name: string, args: Record<string, unknown>, ctx: { workspaceId: string; runId: string }) => {
          if (name !== 'host_propose_overlay') return undefined;
          return {
            kind: 'proposal' as const,
            proposal: {
              id: crypto.randomUUID(),
              runId: ctx.runId,
              workspaceId: ctx.workspaceId,
              kind: 'plugin' as const,
              path: '宿主工作台微调',
              base: '',
              content: JSON.stringify(args),
              reason: '通过 CloudExtension 应用微调',
              status: 'ready' as const,
              preview: { before: '', after: JSON.stringify(args), diskHash: null, path: '宿主工作台微调' },
              pluginAction: {
                pluginId: 'host.overlay',
                pluginName: 'Host Overlay',
                toolName: 'apply',
                label: '应用微调',
                effect: 'write' as const,
              },
            },
          };
        },
        applyProposal: async (proposal: { pluginAction?: { pluginId?: string } }, parsedArgs: Record<string, unknown>) => {
          if (proposal.pluginAction?.pluginId !== 'host.overlay') return undefined;
          extensionApplied.push(parsedArgs);
          overlayState.hiddenSidebarItems = parsedArgs.hiddenSidebarItems as string[];
          overlayState.homeTabViewKey = parsedArgs.homeTabViewKey as string;
          return { after: JSON.stringify(parsedArgs), hash: 'apply', fileId: 'host.overlay' };
        },
      },
    };

    setActivePinia(
      configureWorkbench(createPinia(), {
        adapter,
        assistant: transport,
        attachments: { imageUrl: () => null, importAttachment, exportAttachment: async () => {} },
        native: false,
        mobile: false,
        extensions: () => hostExtensions,
      }),
    );

    const workspace = useWorkspaceStore();
    const assistant = useAssistantStore();

    try {
      await workspace.initialize();
      const wsId = workspace.workspace!.id;

      // Install unpacked v2-ZIP provider + consumer plugin, restrict provider pathScopes to 日报/
      await workspace.changePlugin({ install: unpacked.pkg.manifest, package: unpacked.pkg, scope: 'workspace' }, wsId);
      await workspace.changePlugin({ id: providerManifest.id, mode: 'recommended', settings: {}, pathScopes: ['日报/'] }, wsId);
      const consumerPkg = parsePluginPackage(JSON.stringify({ packageVersion: 1, manifest: consumerManifest, source: CONSUMER_SRC }));
      await workspace.changePlugin({ install: consumerManifest, package: consumerPkg, scope: 'workspace' }, wsId);

      for (const id of [providerManifest.id, consumerManifest.id]) {
        const inst = workspace.installedPlugins.find(p => p.manifest.id === id)!;
        await workspace.authorizePlugin(id, inst.rule!.integrity, wsId);
      }
      await vi.waitFor(() => expect(sandboxes.bySource.size).toBe(2));

      let rpcSeq = 0;
      const rpc = async (source: string, method: string, params: Record<string, unknown> = {}) => {
        const box = sandboxes.bySource.get(source)!;
        const id = ++rpcSeq;
        box.receive({ type: 'call', id, method, params });
        await vi.waitFor(() =>
          expect(box.sent.some(m => (m as { id?: number; type?: string }).id === id && (m as { type?: string }).type === 'result')).toBe(true),
        );
        return box.sent.find(m => (m as { id?: number; type?: string }).id === id && (m as { type?: string }).type === 'result') as {
          result?: unknown;
          error?: string;
        };
      };

      // --- Phase 1: pathScopes, frontmatter, statusBar, attachments.write, move ---
      const listed = (await rpc(PROVIDER_SRC, 'documents.list')).result as { id: string; path: string }[];
      expect(listed.map(f => f.path)).toEqual(['日报/today.md']);
      const todayId = listed[0]!.id;

      const fm = (await rpc(PROVIDER_SRC, 'documents.frontmatter.read', { fileId: todayId })).result as {
        hash: string;
        data: { title: string };
      };
      expect(fm.data.title).toBe('今日日志');
      const fmUpdated = await rpc(PROVIDER_SRC, 'documents.frontmatter.update', {
        fileId: todayId,
        patch: { set: { reviewed: true } },
        baseHash: fm.hash,
      });
      expect(fmUpdated.error).toBeUndefined();

      await rpc(PROVIDER_SRC, 'ui.setStatusBar', {
        item: { id: 'sb-1', text: '已审阅', align: 'right', command: 'refresh' },
      });
      expect(workspace.pluginStatusBarItems.some(i => i.text === '已审阅')).toBe(true);

      const attOut = await rpc(PROVIDER_SRC, 'attachments.write', {
        request: { name: 'chart.svg', contentBase64: btoa('<svg/>'), documentPath: '日报/today.md', mimeType: 'image/svg+xml' },
      });
      expect(attOut.error).toBeUndefined();
      expect((await rpc(PROVIDER_SRC, 'attachments.write', {
        request: { name: 'leak.svg', contentBase64: btoa('<svg/>'), documentPath: '机密/private.md' },
      })).error).toContain('授权目录范围');

      // --- Phase 4: Cross-plugin stateless services RPC ---
      expect((await rpc(CONSUMER_SRC, 'services.available', { pluginId: 'suite-provider', service: 'format' })).result).toBe(true);
      const formatted = await rpc(CONSUMER_SRC, 'services.call', {
        pluginId: 'suite-provider',
        service: 'format',
        payload: { title: 'Tano Blueprint' },
      });
      expect(formatted.error).toBeUndefined();
      expect(formatted.result).toEqual({ formatted: 'APA(suite-consumer): Tano Blueprint' });

      // --- Phase 2 + Phase 3: Assistant @context, read/write tools, tano.ai, L1/Tier2 Overlay, L2 Forge ---
      await vi.waitFor(() => expect(assistant.session).not.toBeNull());
      await vi.waitFor(() => expect(assistant.loading).toBe(false));
      await assistant.selectConnection('conn-e2e');
      await assistant.selectModel('gpt-e2e');

      assistant.prompt = '结合 @board 帮我检查卡片、应用个人微调并建一个工坊草稿';
      await assistant.send();
      expect(assistant.error).toBe('');

      const reply = assistant.session!.messages.at(-1)!;
      expect(reply.proposals).toHaveLength(2);
      expect(sandboxes.createdCards).toHaveLength(0);
      expect(workspace.overlaySnapshot.homeTabViewKey).toBeUndefined();

      // Explicitly confirm both proposals (plugin write tool + CloudExtension assistant tool)
      for (const proposal of reply.proposals!) {
        await assistant.review(proposal, true);
        expect(proposal.status).toBe('applied');
      }
      expect(sandboxes.createdCards).toEqual([{ title: '全链路验收' }]);
      expect(extensionApplied).toHaveLength(1);
      expect(workspace.overlaySnapshot.homeTabViewKey).toBe('plugin:suite-provider:home');
      expect(workspace.pluginHomeTabView?.key).toBe('plugin:suite-provider:home');

      // Plugin invokes host-managed tano.ai.structured (zero key exposure)
      const aiRes = await rpc(PROVIDER_SRC, 'ai.structured', {
        request: {
          prompt: '标记优先级',
          schema: { type: 'object', properties: { tag: { type: 'string' } }, required: ['tag'] },
        },
      });
      expect(aiRes.error).toBeUndefined();
      expect((aiRes.result as { data: { tag: string } }).data).toEqual({ tag: 'urgent' });

      // Safe Mode via CloudExtension hook immediately disables custom homeTab & 3rd-party plugins
      workspace.setSafeMode(true);
      await vi.waitFor(() =>
        expect(workspace.pluginRuntime.find(rt => rt.id === 'suite-provider')?.status).toBe('blocked'),
      );
      expect(workspace.overlaySnapshot.safeMode).toBe(true);
      expect(workspace.pluginHomeTabView).toBeNull();
    } finally {
      assistant.$dispose();
      workspace.dispose();
      workspace.$dispose();
    }
  });
});
