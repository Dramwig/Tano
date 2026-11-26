// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  parsePluginFrontmatterPatch,
  parsePluginManifest,
  type ExecutablePluginManifest,
  type PluginPackage,
  type Workspace,
} from '@tano/protocol';
import { patchFrontmatterMarkdown, readFrontmatterData } from '@tano/protocol/frontmatter';
import { slashItems } from '@tano/editor/slash-commands';
import { PluginExecutionHost, type PluginRuntimeState } from './host';
import { PluginPackageCache } from './packages';
import { pluginWorkbenchSlashCommands } from './workbench';
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
  id: 'ws-phase12',
  name: 'Phase 1.2',
  path: '/phase12',
  files: [],
  readOnly: false,
};

function makeEditorManifest(overrides: Partial<ExecutablePluginManifest> = {}): ExecutablePluginManifest {
  return parsePluginManifest({
    manifestVersion: 2,
    apiVersion: 1,
    id: 'citation-helper',
    name: '文献助手',
    version: '1.0.0',
    description: 'Phase 1.2 测试插件',
    objectTypes: [],
    relationTypes: [],
    permissions: ['documents.read', 'documents.write'],
    networkOrigins: [],
    nativeCommands: [],
    commands: [
      { id: 'insert-citation', label: '插入文献引用' },
      { id: 'tag-paper', label: '更新论文属性' },
    ],
    slashCommands: [
      {
        id: 'cite',
        label: '插入文献引用',
        command: 'insert-citation',
        description: '从文献库选择并插入引用',
        keywords: ['citation', 'bibtex', '参考'],
      },
    ],
    views: [],
    ...overrides,
  }) as ExecutablePluginManifest;
}

async function setupPlugin(
  accessCall: (method: string, params: Record<string, unknown>, assertCurrent: () => void) => Promise<unknown>,
  manifest = makeEditorManifest(),
) {
  const storage = createMemoryStorage();
  const pkg: PluginPackage = { packageVersion: 1, manifest, source: 'export function activate() {}' };
  const integrity = await new PluginPackageCache(storage).put(pkg);
  let lastStates: PluginRuntimeState[] = [];
  let onMessage: ((message: unknown) => void) | undefined;
  const sent: unknown[] = [];
  const host = new PluginExecutionHost(
    { call: accessCall },
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
  return { host, rpc, getStates: () => lastStates, installed };
}

describe('Phase 1.2 protocol & frontmatter helpers', () => {
  it('validates slashCommands and frontmatter patch bounds', () => {
    const manifest = makeEditorManifest();
    expect(manifest.slashCommands).toHaveLength(1);
    expect(() =>
      makeEditorManifest({
        slashCommands: [{ id: 'bad', label: 'Bad', command: 'missing-cmd' }],
      }),
    ).toThrow('引用已声明的插件命令');

    expect(parsePluginFrontmatterPatch({ set: { status: 'done', tags: ['ai'] }, remove: ['draft'] })).toEqual({
      set: { status: 'done', tags: ['ai'] },
      remove: ['draft'],
    });
    expect(() => parsePluginFrontmatterPatch({})).toThrow();
    expect(() => parsePluginFrontmatterPatch({ set: { ' bad ': 1 } })).toThrow();
  });

  it('reads and patches YAML frontmatter while preserving comments and Markdown body', () => {
    const plain = '# Title\n\nBody text.\n';
    expect(readFrontmatterData(plain)).toEqual({ hasFrontmatter: false, data: {} });

    const created = patchFrontmatterMarkdown(plain, { set: { status: 'draft', priority: 2 } });
    expect(created).toContain('---\nstatus: draft\npriority: 2\n---\n# Title\n');
    expect(readFrontmatterData(created)).toEqual({
      hasFrontmatter: true,
      data: { status: 'draft', priority: 2 },
    });

    const commented = '---\n# keep comment\ntitle: Note\ntags:\n  - a\n---\nBody\n';
    const updated = patchFrontmatterMarkdown(commented, {
      set: { status: 'published' },
      remove: ['tags'],
    });
    expect(updated).toContain('# keep comment');
    expect(updated).toContain('status: published');
    expect(updated).not.toContain('tags:');
    expect(updated.endsWith('---\nBody\n')).toBe(true);

    const emptied = patchFrontmatterMarkdown('---\nonly: 1\n---\nBody\n', { remove: ['only'] });
    expect(emptied).toBe('Body\n');
  });

  it('merges external plugin slashCommands into editor slashItems search results', () => {
    const execute = vi.fn();
    const results = slashItems('bibtex', undefined, undefined, [
      {
        id: 'plugin:citation-helper:slash:cite',
        label: '插入文献引用',
        marker: '文献助手',
        keywords: 'citation bibtex 参考',
        execute,
      },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]!.label).toBe('插入文献引用');
    expect(results[0]!.external?.execute).toBe(execute);
  });
});

describe('Phase 1.2 runtime frontmatter, editor, and slashCommands routing', () => {
  it('supports documents.frontmatter.read -> update with baseline enforcement and editor RPCs', async () => {
    let docContent = '---\nstatus: draft\n---\n# Hello World\n';
    let docHash = 'hash-1';
    const accessCall = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === 'documents.read') {
        return { id: 'doc-1', path: 'note.md', content: docContent, hash: docHash };
      }
      if (method === 'documents.write') {
        docContent = String(params.content);
        docHash = 'hash-2';
        return { id: 'doc-1', hash: docHash, status: 'applied' };
      }
      if (method === 'editor.active') {
        return {
          fileId: 'doc-1',
          path: 'note.md',
          mode: 'rich',
          readOnly: false,
          selection: { from: 25, to: 30, empty: false },
          selectedText: 'Hello',
          blockType: 'Heading',
          hash: docHash,
        };
      }
      if (method === 'editor.insert' || method === 'editor.replaceSelection') {
        docContent = docContent.replace('Hello', String(params.text));
        docHash = 'hash-3';
        return { fileId: 'doc-1', hash: docHash, status: 'applied' };
      }
      return null;
    });
    const { host, rpc, getStates, installed } = await setupPlugin(accessCall);

    const info = (await rpc('hostInfo')).result as { capabilities: string[] };
    expect(info.capabilities).toEqual(
      expect.arrayContaining([
        'documents.frontmatter',
        'editor.active',
        'editor.insert',
        'editor.replaceSelection',
        'editor.slashCommands',
      ]),
    );

    // Rejects frontmatter update without prior read baseline
    const unbased = await rpc('documents.frontmatter.update', {
      fileId: 'doc-1',
      patch: { set: { status: 'done' } },
      baseHash: 'hash-1',
    });
    expect(unbased.error).toContain('请先读取目标内容');

    // Reads frontmatter and records baseline automatically
    const fmRead = (await rpc('documents.frontmatter.read', { fileId: 'doc-1' })).result as {
      id: string;
      hasFrontmatter: boolean;
      data: Record<string, unknown>;
      hash: string;
    };
    expect(fmRead).toEqual({
      id: 'doc-1',
      hasFrontmatter: true,
      data: { status: 'draft' },
      hash: 'hash-1',
    });

    // Updates frontmatter using the hash from frontmatter.read
    const fmUpdate = (
      await rpc('documents.frontmatter.update', {
        fileId: 'doc-1',
        patch: { set: { status: 'reviewed', reviewer: 'Alice' } },
        baseHash: fmRead.hash,
      })
    ).result as { id: string; hash: string; data: Record<string, unknown>; status: string };
    expect(fmUpdate).toEqual({
      id: 'doc-1',
      hash: 'hash-2',
      data: { status: 'reviewed', reviewer: 'Alice' },
      status: 'applied',
    });
    expect(docContent).toContain('reviewer: Alice');
    expect(docContent).toContain('# Hello World');

    // Active editor snapshot + replaceSelection
    const active = (await rpc('editor.active')).result as { selectedText: string; mode: string };
    expect(active.selectedText).toBe('Hello');
    expect(active.mode).toBe('rich');

    const replaced = (await rpc('editor.replaceSelection', { text: 'Tano' })).result as {
      fileId: string;
      hash: string;
      status: string;
    };
    expect(replaced).toEqual({ fileId: 'doc-1', hash: 'hash-3', status: 'applied' });
    expect(docContent).toContain('# Tano World');

    // Slash command exposure requires command registration (or idle lazy activation)
    expect(pluginWorkbenchSlashCommands([installed], getStates())).toEqual([]);
    await rpc('commands.register', { id: 'insert-citation' });
    const slash = pluginWorkbenchSlashCommands([installed], getStates());
    expect(slash).toHaveLength(1);
    expect(slash[0]!.id).toBe('cite');
    expect(slash[0]!.command).toBe('insert-citation');

    host.dispose();
  });

  it('enforces documents.read and documents.write permissions on editor and frontmatter APIs', async () => {
    const readonlyManifest = makeEditorManifest({ permissions: ['documents.read'] });
    const accessCall = vi.fn(async () => null);
    const { host, rpc } = await setupPlugin(accessCall, readonlyManifest);

    expect((await rpc('editor.insert', { text: 'hi' })).code).toBe('PERMISSION_DENIED');
    expect((await rpc('editor.replaceSelection', { text: 'hi' })).code).toBe('PERMISSION_DENIED');
    expect(
      (await rpc('documents.frontmatter.update', { fileId: 'doc-1', patch: { set: { a: 1 } }, baseHash: 'h' })).code,
    ).toBe('PERMISSION_DENIED');

    host.dispose();
  });
});
