// @vitest-environment jsdom
import { createApp, h, nextTick, shallowRef, type App } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parsePluginManifest,
  parsePluginStatusBarItem,
  parsePluginUiConfirmOptions,
  parsePluginUiPickOptions,
  parsePluginUiPromptOptions,
  parsePluginUiToastOptions,
  type ExecutablePluginManifest,
  type PluginPackage,
  type Workspace,
} from '@tano/protocol';
import { PluginExecutionHost, type PluginRuntimeState } from './host';
import { PluginPackageCache } from './packages';
import { pluginWorkbenchStatusBarItems } from './workbench';
import type { InstalledObjectPlugin } from './workspace-plugins';
import PluginUiDialog from './components/PluginUiDialog.vue';
import PluginStatusBar from './components/PluginStatusBar.vue';
import PluginDocumentSlot from './components/PluginDocumentSlot.vue';

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
  id: 'ws-phase1',
  name: 'Phase 1',
  path: '/phase1',
  files: [],
  readOnly: false,
};

function makeManifest(overrides: Partial<ExecutablePluginManifest> = {}): ExecutablePluginManifest {
  return parsePluginManifest({
    manifestVersion: 2,
    apiVersion: 1,
    id: 'word-counter',
    name: '字数与工具条',
    version: '1.0.0',
    description: 'Phase 1.1 测试插件',
    objectTypes: [],
    relationTypes: [],
    permissions: [],
    networkOrigins: [],
    nativeCommands: [],
    commands: [{ id: 'open-stats', label: '打开统计' }],
    views: [
      { id: 'doc-header', label: '字数概览', location: 'documentHeader' },
      { id: 'doc-footer', label: '参考脚注', location: 'documentFooter' },
      { id: 'doc-inspector', label: '文档分析', location: 'documentSidebar' },
    ],
    ...overrides,
  }) as ExecutablePluginManifest;
}

async function setupRunningPlugin(
  accessCall: (method: string, params: Record<string, unknown>, assertCurrent: () => void) => Promise<unknown>,
  manifest = makeManifest(),
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
      return {
        send: (msg) => sent.push(msg),
        dispose: () => {},
      };
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
  return { host, rpc, getStates: () => lastStates, onMessage: () => onMessage!, sent };
}

describe('Phase 1.1 protocol validators', () => {
  it('accepts documentSidebar, documentHeader, and documentFooter view locations', () => {
    const manifest = makeManifest();
    expect(manifest.views.map((view) => view.location)).toEqual([
      'documentHeader',
      'documentFooter',
      'documentSidebar',
    ]);
  });

  it('validates statusBar items and ui dialog/toast options with strict bounds', () => {
    expect(parsePluginStatusBarItem({ id: 'words', text: '1,240 字', command: 'open-stats' })).toEqual({
      id: 'words',
      text: '1,240 字',
      align: 'right',
      priority: 0,
      tone: 'default',
      command: 'open-stats',
    });
    expect(() => parsePluginStatusBarItem({ id: 'BAD ID', text: 'x' })).toThrow();
    expect(() => parsePluginStatusBarItem({ id: 'words', text: 'x'.repeat(61) })).toThrow();
    expect(() => parsePluginStatusBarItem({ id: 'words', text: 'ok', priority: 9999 })).toThrow();

    expect(
      parsePluginUiPickOptions({
        title: '选择模板',
        items: [{ id: 'a', label: '周报', description: '每周总结' }],
      }).items,
    ).toHaveLength(1);
    expect(() => parsePluginUiPickOptions({ title: '空', items: [] })).toThrow();
    expect(() =>
      parsePluginUiPickOptions({
        title: '重复',
        items: [
          { id: 'dup', label: 'A' },
          { id: 'dup', label: 'B' },
        ],
      }),
    ).toThrow();

    expect(parsePluginUiPromptOptions({ title: '输入名称', defaultValue: '笔记' }).defaultValue).toBe('笔记');
    expect(parsePluginUiConfirmOptions({ title: '确认执行', danger: true }).danger).toBe(true);
    expect(parsePluginUiToastOptions({ message: '已完成', tone: 'success' })).toEqual({
      message: '已完成',
      tone: 'success',
    });
    expect(() => parsePluginUiToastOptions({ message: 'x', tone: 'invalid' })).toThrow();
  });
});

describe('Phase 1.1 runtime statusBar and ui dialogs', () => {
  it('exposes Phase 1.1 capabilities, enforces statusBar bounds/commands, and cleans up on dispose', async () => {
    const accessCall = vi.fn(async () => null);
    const { host, rpc, getStates } = await setupRunningPlugin(accessCall);

    const info = (await rpc('hostInfo')).result as { capabilities: string[] };
    expect(info.capabilities).toEqual(
      expect.arrayContaining([
        'ui.dialogs',
        'ui.statusBar',
        'views.documentSidebar',
        'views.documentHeader',
        'views.documentFooter',
      ]),
    );

    // Rejects undeclared command binding
    const badCmd = await rpc('ui.setStatusBar', {
      item: { id: 'bad', text: 'Bad', command: 'not-declared' },
    });
    expect(badCmd.error).toContain('没有在清单中声明');

    // Accepts up to 4 items and sorts by priority descending
    await rpc('ui.setStatusBar', {
      item: { id: 'low', text: 'Low', align: 'left', priority: 10 },
    });
    await rpc('ui.setStatusBar', {
      item: { id: 'high', text: 'High', align: 'right', priority: 50, command: 'open-stats', tone: 'accent' },
    });
    await rpc('ui.setStatusBar', { item: { id: 'third', text: '3' } });
    await rpc('ui.setStatusBar', { item: { id: 'fourth', text: '4' } });

    const fifth = await rpc('ui.setStatusBar', { item: { id: 'fifth', text: '5' } });
    expect(fifth.error).toContain('最多只能注册 4 个状态栏项');

    const sorted = pluginWorkbenchStatusBarItems(getStates());
    expect(sorted.map((item) => item.id)).toEqual(['high', 'low', 'fourth', 'third']);

    await rpc('ui.removeStatusBar', { id: 'low' });
    expect(pluginWorkbenchStatusBarItems(getStates()).map((item) => item.id)).toEqual([
      'high',
      'fourth',
      'third',
    ]);

    host.dispose();
    expect(pluginWorkbenchStatusBarItems(getStates())).toEqual([]);
  });

  it('routes ui.pick, ui.prompt, ui.confirm, ui.toast and blocks concurrent overlapping dialogs', async () => {
    let releasePick: ((value: unknown) => void) | undefined;
    let capturedSignal: AbortSignal | undefined;
    const accessCall = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === 'ui.pick') {
        capturedSignal = params.signal as AbortSignal;
        expect(params.pluginName).toBe('字数与工具条');
        return new Promise((resolve) => {
          releasePick = resolve;
        });
      }
      if (method === 'ui.prompt') return '新标题';
      if (method === 'ui.confirm') return true;
      return null;
    });
    const { host, rpc, onMessage, sent } = await setupRunningPlugin(accessCall);

    // Start pick dialog (pending user input)
    const before = sent.length;
    onMessage()({
      type: 'call',
      id: 100,
      method: 'ui.pick',
      params: { options: { title: '选择一个选项', items: [{ id: 'opt-1', label: '选项一' }] } },
    });
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(capturedSignal?.aborted).toBe(false);

    // Concurrent second dialog from same plugin must be rejected immediately
    const second = await rpc('ui.confirm', { options: { title: '弹窗轰炸' } });
    expect(second.error).toContain('已有进行中的交互弹窗');

    // Finish first dialog
    releasePick!('opt-1');
    await new Promise((resolve) => setTimeout(resolve, 15));
    const pickReply = sent.slice(before).find((msg) => (msg as { id?: number }).id === 100) as {
      result?: unknown;
    };
    expect(pickReply?.result).toBe('opt-1');

    // Sequential prompt, confirm, and toast succeed
    expect((await rpc('ui.prompt', { options: { title: '请输入' } })).result).toBe('新标题');
    expect((await rpc('ui.confirm', { options: { title: '确认？' } })).result).toBe(true);
    expect((await rpc('ui.toast', { message: '已保存', tone: 'success' })).error).toBeUndefined();
    expect(accessCall).toHaveBeenCalledWith(
      'ui.toast',
      expect.objectContaining({ pluginId: 'word-counter', message: '已保存', tone: 'success' }),
      expect.any(Function),
    );

    host.dispose();
    expect(capturedSignal?.aborted).toBe(true);
  });
});

describe('Phase 1.1 workbench UI components', () => {
  let app: App | undefined;
  let root: HTMLDivElement | undefined;
  afterEach(() => {
    app?.unmount();
    app = undefined;
    root?.remove();
    root = undefined;
  });

  it('PluginUiDialog renders source attribution, filters pick items, submits prompt, and dismisses toasts', async () => {
    root = document.createElement('div');
    document.body.append(root);
    const resolved: unknown[] = [];
    const dismissed: string[] = [];
    const dialog = shallowRef<any>({
      id: 'dlg-1',
      kind: 'pick',
      pluginId: 'word-counter',
      pluginName: '字数与工具条',
      options: {
        title: '选择视图',
        items: [
          { id: 'alpha', label: '字数统计', description: '统计正文' },
          { id: 'beta', label: '阅读时间', detail: '按每分钟 300 字估算' },
        ],
      },
    });
    const toasts = shallowRef([
      {
        id: 'toast-1',
        pluginId: 'word-counter',
        pluginName: '字数与工具条',
        message: '已更新',
        tone: 'success' as const,
      },
    ]);
    app = createApp({
      render: () =>
        h(PluginUiDialog, {
          dialog: dialog.value,
          toasts: toasts.value,
          onResolve: (id: string, value: string | boolean | null) => resolved.push([id, value]),
          onDismissToast: (id: string) => dismissed.push(id),
        }),
    });
    app.mount(root);
    await nextTick();

    expect(root.textContent).toContain('插件：字数与工具条');
    const search = root.querySelector<HTMLInputElement>('.plugin-ui-search input')!;
    search.value = '阅读';
    search.dispatchEvent(new Event('input'));
    await nextTick();

    const options = root.querySelectorAll<HTMLButtonElement>('.plugin-ui-option');
    expect(options).toHaveLength(1);
    options[0]!.click();
    await nextTick();
    expect(resolved[0]).toEqual(['dlg-1', 'beta']);

    root.querySelector<HTMLButtonElement>('.plugin-toast-close')!.click();
    await nextTick();
    expect(dismissed).toEqual(['toast-1']);

    dialog.value = {
      id: 'dlg-2',
      kind: 'prompt',
      pluginId: 'word-counter',
      pluginName: '字数与工具条',
      options: { title: '输入标签', defaultValue: '重要' },
    };
    await nextTick();
    const input = root.querySelector<HTMLInputElement>('.plugin-ui-input')!;
    input.value = '归档';
    input.dispatchEvent(new Event('input'));
    await nextTick();
    root.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await nextTick();
    expect(resolved[1]).toEqual(['dlg-2', '归档']);
  });

  it('PluginStatusBar hides when empty and triggers bound commands on click', async () => {
    root = document.createElement('div');
    document.body.append(root);
    const execute = vi.fn(async () => {});
    const items = shallowRef<any[]>([]);
    app = createApp({
      render: () =>
        h(PluginStatusBar, {
          items: items.value,
          workspaceId: 'ws-1',
          activeDocumentId: 'doc-42',
          execute,
        }),
    });
    app.mount(root);
    await nextTick();
    expect(root.querySelector('.plugin-status-bar')).toBeNull();

    items.value = [
      {
        key: 'plugin:word-counter:status:words',
        id: 'words',
        text: '1,240 字',
        align: 'right',
        tone: 'accent',
        command: 'open-stats',
        pluginId: 'word-counter',
        pluginName: '字数与工具条',
        instanceId: 'inst-1',
      },
    ];
    await nextTick();
    root.querySelector<HTMLButtonElement>('button.plugin-status-item')!.click();
    await nextTick();
    expect(execute).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      pluginId: 'word-counter',
      instanceId: 'inst-1',
      kind: 'command',
      name: 'open-stats',
      payload: { workspaceId: 'ws-1', fileId: 'doc-42' },
    });
  });

  it('PluginDocumentSlot renders documentHeader only when running plugin provides content', async () => {
    root = document.createElement('div');
    document.body.append(root);
    const execute = vi.fn(async () => {});
    const view = {
      key: 'plugin:word-counter:doc-header',
      id: 'doc-header',
      label: '字数概览',
      location: 'documentHeader' as const,
      pluginId: 'word-counter',
      pluginName: '字数与工具条',
    };
    const runtimes = shallowRef<PluginRuntimeState[]>([
      {
        id: 'word-counter',
        instanceId: 'i1',
        name: '字数与工具条',
        status: 'running',
        message: '',
        commands: [],
        views: [],
      },
    ]);
    app = createApp({
      render: () =>
        h(PluginDocumentSlot, {
          location: 'documentHeader',
          views: [view],
          runtimes: runtimes.value,
          workspaceId: 'ws-1',
          execute,
        }),
    });
    app.mount(root);
    await nextTick();
    expect(root.querySelector('.plugin-document-slot')).toBeNull();

    runtimes.value = [
      {
        id: 'word-counter',
        instanceId: 'i1',
        name: '字数与工具条',
        status: 'running',
        message: '',
        commands: [],
        views: [{ ...view, tree: { type: 'text', text: '共 1,240 字 · 预计阅读 4 分钟' } }],
      },
    ];
    await nextTick();
    expect(root.querySelector('.plugin-document-slot')).not.toBeNull();
    expect(root.textContent).toContain('共 1,240 字 · 预计阅读 4 分钟');
  });
});
