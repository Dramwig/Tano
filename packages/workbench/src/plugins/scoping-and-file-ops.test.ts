// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
  matchesPluginPathScopes,
  parsePluginAttachmentWrite,
  parsePluginManifest,
  parsePluginPackage,
  parsePluginPathScopes,
  parsePluginPolicy,
  type ExecutablePluginManifest,
} from '@tano/protocol';
import { DemoAdapter } from '../workspace/adapter';
import { configureWorkbench } from '../runtime';
import { WorkspacePluginHost } from './workspace-plugins';
import { PluginExecutionHost, type PluginRuntimeState } from './host';
import { useWorkspaceStore } from '../stores/workspace';
import { installUserPlugin } from './user-plugins';

const TEST_PLUGIN_SOURCE = 'export function activate() { /* phase-1-4-scoped */ }';
const sandboxBridge = vi.hoisted(() => ({
  receive: undefined as ((message: unknown) => void) | undefined,
  send: vi.fn(),
}));
vi.mock('./sandbox', () => ({
  createPluginSandbox: (source: string, receive: (message: unknown) => void) => {
    if (source === TEST_PLUGIN_SOURCE) {
      sandboxBridge.receive = receive;
      queueMicrotask(() => receive({ type: 'ready' }));
      return { send: sandboxBridge.send, dispose: vi.fn() };
    }
    return { send: vi.fn(), dispose: vi.fn() };
  },
}));

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

function makeScopedManifest(overrides: Partial<ExecutablePluginManifest> = {}): ExecutablePluginManifest {
  return parsePluginManifest({
    manifestVersion: 2,
    apiVersion: 1,
    id: 'daily-manager',
    name: '日报管理助手',
    version: '1.0.0',
    description: 'Phase 1.4 测试插件',
    objectTypes: [],
    relationTypes: [],
    permissions: [
      'documents.read',
      'documents.write',
      'documents.move',
      'documents.trash',
      'attachments.read',
      'attachments.write',
    ],
    networkOrigins: [],
    nativeCommands: [],
    commands: [],
    views: [],
    ...overrides,
  }) as ExecutablePluginManifest;
}

afterEach(() => {
  localStorage.clear();
});

describe('Phase 1.4 protocol validators', () => {
  it('normalizes pathScopes and rejects traversal, internal paths, and sibling prefix bypass', () => {
    const scopes = parsePluginPathScopes(['日报', '论文/2026/']);
    expect(scopes).toEqual(['日报/', '论文/2026/']);
    expect(matchesPluginPathScopes('日报/today.md', scopes)).toBe(true);
    expect(matchesPluginPathScopes('论文/2026/draft.md', scopes)).toBe(true);
    expect(matchesPluginPathScopes('日报机密/secret.md', scopes)).toBe(false);
    expect(matchesPluginPathScopes('其他/note.md', scopes)).toBe(false);
    expect(matchesPluginPathScopes('any.md', undefined)).toBe(true);

    expect(() => parsePluginPathScopes(['../secret'])).toThrow();
    expect(() => parsePluginPathScopes(['.tano/objects'])).toThrow();
    expect(() => parsePluginPathScopes(['/abs'])).toThrow();
  });

  it('validates attachments.write allowlist extensions, base64, and 400 KiB limit', () => {
    const ok = parsePluginAttachmentWrite({
      name: 'chart.svg',
      contentBase64: btoa('<svg></svg>'),
      documentPath: '日报/today.md',
      mimeType: 'image/svg+xml',
    });
    expect(ok.image).toBe(true);
    expect(ok.bytes.length).toBe('<svg></svg>'.length);

    expect(() =>
      parsePluginAttachmentWrite({ name: 'evil.exe', contentBase64: btoa('MZ') }),
    ).toThrow('不支持写入此类型');
    expect(() =>
      parsePluginAttachmentWrite({ name: 'note.md', contentBase64: btoa('# hi') }),
    ).toThrow('不支持写入此类型');
    expect(() =>
      parsePluginAttachmentWrite({ name: '../escape.png', contentBase64: btoa('x') }),
    ).toThrow('附件文件名无效');
    expect(() =>
      parsePluginAttachmentWrite({ name: 'huge.txt', contentBase64: btoa('a'.repeat(401 * 1024)) }),
    ).toThrow('400 KiB');
  });

  it('parses personalCodePlugins and per-rule pathScopes in workspace policy', () => {
    const manifest = makeScopedManifest();
    const policy = parsePluginPolicy(
      JSON.stringify({
        version: 1,
        personalCodePlugins: 'read-only',
        plugins: [
          {
            manifest,
            mode: 'recommended',
            integrity: 'a'.repeat(64),
            settings: {},
            pathScopes: ['日报'],
          },
        ],
      }),
    );
    expect(policy.personalCodePlugins).toBe('read-only');
    expect(policy.plugins[0]!.pathScopes).toEqual(['日报/']);
    expect(() =>
      parsePluginPolicy(JSON.stringify({ version: 1, personalCodePlugins: 'invalid', plugins: [] })),
    ).toThrow('个人代码插件访问策略无效');
  });
});

describe('Phase 1.4 end-to-end pathScopes, move/trash/attachments.write, and personalCodePlugins policy', () => {
  it('enforces pathScopes across list/query/search/read/create/move/trash/attachments.write', async () => {
    sandboxBridge.send.mockClear();
    sandboxBridge.receive = undefined;
    const adapter = new DemoAdapter({
      files: {
        '日报/a.md': '# Daily A\nkeyword-alpha\n',
        '日报机密/leak.md': '# Leak\nkeyword-alpha\n',
        '机密/secret.md': '# Secret\nkeyword-alpha\n',
      },
    });
    const importAttachment = vi.fn(async (_wsId: string, _docPath: string, file: File, image: boolean) => ({
      path: `日报/assets/${file.name}`,
      name: file.name,
      image,
      url: `assets/${file.name}`,
    }));
    setActivePinia(
      configureWorkbench(createPinia(), {
        adapter,
        native: false,
        mobile: false,
        attachments: {
          imageUrl: () => null,
          importAttachment,
          exportAttachment: async () => {},
        },
      }),
    );
    const store = useWorkspaceStore();
    try {
      await store.initialize();

      const manifest = makeScopedManifest();
      const pkg = parsePluginPackage(
        JSON.stringify({ packageVersion: 1, manifest, source: TEST_PLUGIN_SOURCE }),
      );
      await store.changePlugin({ install: manifest, package: pkg, scope: 'workspace' }, store.workspace!.id);
      await store.changePlugin(
        { id: manifest.id, mode: 'recommended', settings: {}, pathScopes: ['日报/'] },
        store.workspace!.id,
      );
      const installed = store.installedPlugins.find((item) => item.manifest.id === manifest.id)!;
      expect(installed.pathScopes).toEqual(['日报/']);
      await store.authorizePlugin(manifest.id, installed.rule!.integrity, store.workspace!.id);
      await vi.waitFor(() => expect(sandboxBridge.receive).toBeDefined());

      const workspace = store.workspace!;
      const dailyA = workspace.files.find((f) => f.path === '日报/a.md')!;
      const secretFile = workspace.files.find((f) => f.path === '机密/secret.md')!;
      const siblingLeak = workspace.files.find((f) => f.path === '日报机密/leak.md')!;

      let callId = 0;
      const rpc = async (method: string, params: Record<string, unknown> = {}) => {
        const id = ++callId;
        sandboxBridge.receive!({ type: 'call', id, method, params });
        await vi.waitFor(() =>
          expect(
            sandboxBridge.send.mock.calls.some(
              ([message]) => (message as { id?: number; type?: string }).id === id && (message as { type?: string }).type === 'result',
            ),
          ).toBe(true),
        );
        return sandboxBridge.send.mock.calls.find(
          ([message]) => (message as { id?: number; type?: string }).id === id && (message as { type?: string }).type === 'result',
        )![0] as { result?: unknown; error?: string; code?: string };
      };

      // 1. list / query / search ONLY see 日报/a.md
      const listed = (await rpc('documents.list')).result as { path: string }[];
      expect(listed.map((r) => r.path)).toEqual(['日报/a.md']);
      const queried = (await rpc('documents.query', { options: {} })).result as { items: { path: string }[] };
      expect(queried.items.map((r) => r.path)).toEqual(['日报/a.md']);
      const searched = (await rpc('documents.search', { options: { query: 'keyword-alpha' } })).result as {
        items: { path: string }[];
      };
      expect(searched.items.map((r) => r.path)).toEqual(['日报/a.md']);

      // 2. Direct read/create outside pathScopes is rejected
      expect((await rpc('documents.read', { fileId: secretFile.id })).error).toContain('授权目录范围');
      expect((await rpc('documents.read', { fileId: siblingLeak.id })).error).toContain('授权目录范围');
      expect((await rpc('documents.create', { path: '机密/new.md', content: 'x' })).error).toContain('授权目录范围');

      // 3. Read in-scope doc, reject move out of scope, accept move inside scope (preserving fileId)
      const docA = (await rpc('documents.read', { fileId: dailyA.id })).result as { id: string; hash: string };
      expect(
        (await rpc('documents.move', { fileId: dailyA.id, destination: '机密/moved.md', baseHash: docA.hash })).error,
      ).toContain('授权目录范围');
      expect(
        (await rpc('documents.move', { fileId: dailyA.id, destination: '日报/forged.md', baseHash: 'wrong-hash' })).error,
      ).toContain('先读取');

      const moved = (
        await rpc('documents.move', { fileId: dailyA.id, destination: '日报/b.md', baseHash: docA.hash })
      ).result as { id: string; path: string };
      expect(moved).toEqual({ id: dailyA.id, path: '日报/b.md' });
      expect(store.workspace!.files.some((f) => f.path === '日报/b.md' && f.id === dailyA.id)).toBe(true);

      // 4. attachments.write respects pathScopes and allowlist
      expect(
        (
          await rpc('attachments.write', {
            request: { name: 'diagram.svg', contentBase64: btoa('<svg/>'), documentPath: '机密/secret.md' },
          })
        ).error,
      ).toContain('授权目录范围');
      const written = (
        await rpc('attachments.write', {
          request: { name: 'diagram.svg', contentBase64: btoa('<svg/>'), documentPath: '日报/b.md', mimeType: 'image/svg+xml' },
        })
      ).result as { path: string; image: boolean };
      expect(written.path).toBe('日报/assets/diagram.svg');
      expect(written.image).toBe(true);
      expect(importAttachment).toHaveBeenCalledOnce();

      // 5. documents.trash requires baseline and removes the document cleanly
      const docB = (await rpc('documents.read', { fileId: dailyA.id })).result as { hash: string };
      const trashed = (await rpc('documents.trash', { fileId: dailyA.id, baseHash: docB.hash })).result as {
        id: string;
        path: string;
        trashed: boolean;
      };
      expect(trashed).toEqual({ id: dailyA.id, path: '日报/b.md', trashed: true });
      expect(store.workspace!.files.some((f) => f.path === '日报/b.md')).toBe(false);
    } finally {
      store.dispose();
      store.$dispose();
    }
  });

  it('enforces team workspace personalCodePlugins policy (read-only and block) while preserving user themes', async () => {
    const storage = createMemoryStorage();
    const adapter = new DemoAdapter({
      files: { 'note.md': '# Team Doc\n' },
    });
    const workspace = await adapter.open();
    const manifest = makeScopedManifest({ id: 'personal-tool', name: '个人效率工具' });
    const pkg = parsePluginPackage(
      JSON.stringify({ packageVersion: 1, manifest, source: 'export function activate() {}' }),
    );
    const themeManifest = parsePluginManifest({
      manifestVersion: 1,
      id: 'personal-theme',
      name: '个人护眼主题',
      version: '1.0.0',
      description: '纯外观',
      objectTypes: [],
      relationTypes: [],
      appearance: {
        version: 2,
        colors: [{ id: 'warm', label: '暖纸', light: { paper: '#faf6ef', text: '#352a20' } }],
      },
    });
    await installUserPlugin(manifest, pkg, { storage, principal: 'alice' });
    await installUserPlugin(themeManifest, undefined, { storage, principal: 'alice' });

    const policyHost = new WorkspacePluginHost(undefined, storage, 'alice', []);
    await policyHost.loadWorkspace(adapter, workspace);

    // 1. Set team policy to 'read-only'
    await policyHost.changeWorkspace(adapter, workspace, { personalCodePlugins: 'read-only' }, () => {});
    const refreshed1 = await adapter.refresh();
    const installedRo = await policyHost.loadWorkspace(adapter, refreshed1);
    const personalToolRo = installedRo.find((item) => item.manifest.id === 'personal-tool')!;
    expect(personalToolRo.personalCodePolicy).toBe('read-only');

    // Authorize per-workspace and verify reads work while all write permissions are blocked
    policyHost.authorize(refreshed1.id, 'personal-tool', personalToolRo.rule!.integrity);
    const installedRoAuth = await policyHost.loadWorkspace(adapter, refreshed1);
    const toolAuth = installedRoAuth.find((item) => item.manifest.id === 'personal-tool')!;
    expect(toolAuth.authorized).toBe(true);

    let onMessage: ((msg: unknown) => void) | undefined;
    const sent: unknown[] = [];
    let states: PluginRuntimeState[] = [];
    const execHost = new PluginExecutionHost(
      { call: vi.fn(async () => []) },
      (next) => {
        states = next;
      },
      {},
      storage,
      (_src, receive) => {
        onMessage = receive;
        queueMicrotask(() => receive({ type: 'ready' }));
        return { send: (msg) => sent.push(msg), dispose: () => {} };
      },
    );
    execHost.sync(refreshed1, installedRoAuth);
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
    expect((await rpc('documents.list')).error).toBeUndefined();
    expect((await rpc('documents.create', { path: 'x.md', content: 'x' })).error).toContain('只读访问');
    expect((await rpc('attachments.write', { request: {} })).error).toContain('只读访问');

    // 2. Escalate team policy to 'block': personal code plugin is blocked, personal theme stays enabled
    await policyHost.changeWorkspace(adapter, refreshed1, { personalCodePlugins: 'block' }, () => {});
    const refreshed2 = await adapter.refresh();
    const installedBlocked = await policyHost.loadWorkspace(adapter, refreshed2);
    const blockedTool = installedBlocked.find((item) => item.manifest.id === 'personal-tool')!;
    const activeTheme = installedBlocked.find((item) => item.manifest.id === 'personal-theme')!;
    expect(blockedTool.authorized).toBe(false);
    expect(blockedTool.personalCodePolicy).toBe('block');
    expect(activeTheme.enabled).toBe(true);
    expect(activeTheme.authorized).toBe(true);

    execHost.sync(refreshed2, installedBlocked);
    const blockedState = states.find((s) => s.id === 'personal-tool')!;
    expect(blockedState.status).toBe('blocked');
    expect(blockedState.message).toContain('禁止个人代码插件');

    execHost.dispose();
    policyHost.dispose();
  });
});
