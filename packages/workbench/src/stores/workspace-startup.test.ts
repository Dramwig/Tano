// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RecentWorkspace } from '@tano/protocol';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { DemoAdapter } from '../adapter';
import { configureWorkbench } from '../runtime';
import { useWorkspaceStore } from './workspace';
import { workspaceWelcomeContent, workspaceWelcomePath } from '../workspace-welcome';
import { readStartupWorkspace, rememberStartupWorkspace, startupWorkspaceKey } from '../workspace-startup';

let pinia: ReturnType<typeof createPinia>;
let store: ReturnType<typeof useWorkspaceStore>;
beforeEach(() => localStorage.clear());
afterEach(async () => {
  await store?.dispose();
  if (pinia) disposePinia(pinia);
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
});

it('opens a requested local workspace at startup instead of asking for another folder', async () => {
  const adapter = new DemoAdapter();
  Object.defineProperty(adapter, 'mode', { value: 'desktop' });
  const open = vi.spyOn(adapter, 'open');
  pinia = configureWorkbench(createPinia(), { adapter, native: false, mobile: false });
  setActivePinia(pinia);
  store = useWorkspaceStore();
  await store.initialize('C:\\我的 notes');
  expect(open).toHaveBeenCalledExactlyOnceWith('C:\\我的 notes');
  expect(store.workspace).not.toBeNull();
});

it('keeps first local startup at the workspace picker until a folder is selected', async () => {
  const adapter = new DemoAdapter();
  Object.defineProperty(adapter, 'mode', { value: 'desktop' });
  const open = vi.spyOn(adapter, 'open');
  pinia = configureWorkbench(createPinia(), { adapter, native: false, mobile: false });
  setActivePinia(pinia);
  store = useWorkspaceStore();
  await store.initialize();
  expect(open).not.toHaveBeenCalled();
  expect(store.workspace).toBeNull();
});

const olderWorkspace = { id: 'older', name: '旧仓库', path: 'C:\\旧仓库', openedAt: 1 };
const lastWorkspace = { id: 'last', name: '上次仓库', path: 'C:\\上次仓库', openedAt: 2 };

function localWorkspace(history: RecentWorkspace[] = [olderWorkspace, lastWorkspace]) {
  const adapter = new DemoAdapter({ files: { 'README.md': '# 首页', '笔记.md': '# 笔记' }, storageKey: `startup-${crypto.randomUUID()}` });
  Object.defineProperty(adapter, 'mode', { value: 'desktop' });
  const local = Object.assign(adapter, {
    recent: vi.fn(async () => history),
    open: vi.fn(async (path?: string) => {
      const selected = history.find(item => item.path === path);
      if (!selected) throw new Error('工作区不存在');
      return { ...await adapter.refresh(), ...selected, canDelete: true };
    }),
    deleteWorkspace: vi.fn(async (id: string) => { history = history.filter(item => item.id !== id); }),
    close: vi.fn(async () => {}),
  });
  mountStore(local);
  return local;
}

function mountStore(adapter: DemoAdapter) {
  pinia = configureWorkbench(createPinia(), { adapter, native: false, mobile: false });
  setActivePinia(pinia);
  store = useWorkspaceStore();
}

async function restart(adapter: DemoAdapter) {
  await store.dispose();
  disposePinia(pinia);
  mountStore(adapter);
  await store.initialize();
}

it('migrates existing installs to the most recently opened local workspace and restores its active document', async () => {
  const adapter = localWorkspace();
  await store.initialize();
  expect(adapter.open).toHaveBeenCalledExactlyOnceWith(lastWorkspace.path);
  expect(store.workspace?.id).toBe(lastWorkspace.id);
  const note = store.workspace!.files.find(file => file.path === '笔记.md')!;
  await store.openFileInNewTab(note);
  await store.flush();
  const tabs = store.tabs.map(tab => tab.id);
  await restart(adapter);
  expect(store.tabs.map(tab => tab.id)).toEqual(tabs);
  expect(store.active?.path).toBe('笔记.md');
});

it('remembers a successful switch even when another workspace has a newer history timestamp', async () => {
  const adapter = localWorkspace();
  await store.initialize();
  await store.openWorkspace(olderWorkspace.path);
  await restart(adapter);
  expect(adapter.open).toHaveBeenLastCalledWith(olderWorkspace.path);
  expect(store.workspace?.id).toBe(olderWorkspace.id);
});

it('uses the current registered path for the remembered workspace ID', async () => {
  rememberStartupWorkspace(lastWorkspace.id);
  const adapter = localWorkspace([{ ...lastWorkspace, path: 'D:\\已移动的仓库' }]);
  await store.initialize();
  expect(adapter.open).toHaveBeenCalledExactlyOnceWith('D:\\已移动的仓库');
});

it('gives an explicitly requested workspace priority over startup memory', async () => {
  rememberStartupWorkspace(lastWorkspace.id);
  const adapter = localWorkspace();
  await store.initialize(olderWorkspace.path);
  expect(adapter.open).toHaveBeenCalledExactlyOnceWith(olderWorkspace.path);
  expect(readStartupWorkspace()).toBe(olderWorkspace.id);
});

it.each(['delete', 'leave'])('stays at the picker after a successful %s, including the next launch', async action => {
  const adapter = localWorkspace();
  await store.initialize();
  expect(await (action === 'delete' ? store.deleteWorkspace(lastWorkspace.id) : store.leaveWorkspace())).toBe(true);
  expect(store.workspace).toBeNull();
  expect(readStartupWorkspace()).toBeNull();
  adapter.open.mockClear();
  await restart(adapter);
  expect(adapter.open).not.toHaveBeenCalled();
  expect(store.workspace).toBeNull();
  expect(store.recent.some(item => item.id === olderWorkspace.id)).toBe(true);
  await store.openWorkspace(olderWorkspace.path);
  await restart(adapter);
  expect(store.workspace?.id).toBe(olderWorkspace.id);
});

it('keeps startup memory when deletion fails', async () => {
  const adapter = localWorkspace();
  await store.initialize();
  adapter.deleteWorkspace.mockRejectedValueOnce(new Error('删除失败'));
  expect(await store.deleteWorkspace(lastWorkspace.id)).toBe(false);
  expect(readStartupWorkspace()).toBe(lastWorkspace.id);
  expect(store.workspace?.id).toBe(lastWorkspace.id);
});

it('does not replace the remembered workspace when switching fails', async () => {
  const adapter = localWorkspace();
  await store.initialize();
  adapter.open.mockRejectedValueOnce(new Error('权限不足'));
  await store.openWorkspace(olderWorkspace.path);
  expect(readStartupWorkspace()).toBe(lastWorkspace.id);
  expect(store.workspace?.id).toBe(lastWorkspace.id);
});

it('pauses old workspace refreshes during a switch and resumes external changes after failure', async () => {
  const adapter = localWorkspace();
  let changed!: () => void;
  vi.spyOn(adapter, 'watch').mockImplementation(async callback => { changed = callback; return () => {}; });
  await store.initialize();
  vi.useFakeTimers();
  const refresh = vi.spyOn(adapter, 'refresh');
  let settle!: () => void, entered!: () => void;
  const barrier = new Promise<void>(resolve => { entered = resolve; });
  store.setBeforeWorkspaceChange(() => new Promise<void>(resolve => { settle = resolve; entered(); }));
  adapter.open.mockRejectedValueOnce(new Error('offline'));
  changed();
  const switching = store.openWorkspace(olderWorkspace.path);
  await barrier;
  changed();
  await vi.advanceTimersByTimeAsync(500);
  expect(refresh).not.toHaveBeenCalled();
  settle();
  await switching;
  expect(store.workspace?.id).toBe(lastWorkspace.id);
  await vi.advanceTimersByTimeAsync(150);
  expect(refresh).toHaveBeenCalledTimes(1);
});

it('shows the picker instead of opening another repository when the remembered workspace was removed', async () => {
  rememberStartupWorkspace(lastWorkspace.id);
  const adapter = localWorkspace([olderWorkspace]);
  await store.initialize();
  expect(adapter.open).not.toHaveBeenCalled();
  expect(store.workspace).toBeNull();
  expect(readStartupWorkspace()).toBeNull();
  await restart(adapter);
  expect(adapter.open).not.toHaveBeenCalled();
});

it('leaves a failed automatic open recoverable at the picker', async () => {
  rememberStartupWorkspace(lastWorkspace.id);
  const adapter = localWorkspace();
  adapter.open.mockRejectedValueOnce(new Error('权限不足'));
  await store.initialize();
  expect(store.workspace).toBeNull();
  expect(store.busy).toBe(false);
  expect(store.fatal).toBe('权限不足');
  expect(readStartupWorkspace()).toBe(lastWorkspace.id);
  await store.openWorkspace(lastWorkspace.path);
  expect(store.workspace?.id).toBe(lastWorkspace.id);
  expect(store.fatal).toBe('');
});

it('does not use stale history or open a folder dialog when recent history fails to load', async () => {
  const adapter = localWorkspace();
  store.recent = [lastWorkspace];
  adapter.recent.mockRejectedValueOnce(new Error('无法读取历史记录'));
  await store.initialize();
  expect(adapter.open).not.toHaveBeenCalled();
  expect(store.fatal).toBe('无法读取历史记录');
});

it('keeps detached windows from replacing the main window startup selection', async () => {
  rememberStartupWorkspace(lastWorkspace.id);
  window.history.replaceState(null, '', `/?detachedTab=blank:test&workspacePath=${encodeURIComponent(olderWorkspace.path)}`);
  const adapter = localWorkspace();
  await store.initialize();
  expect(adapter.open).toHaveBeenCalledExactlyOnceWith(olderWorkspace.path);
  expect(store.tabs.map(tab => tab.id)).toEqual([expect.stringMatching(/^blank:/)]);
  expect(readStartupWorkspace()).toBe(lastWorkspace.id);
  await store.leaveWorkspace();
  expect(readStartupWorkspace()).toBe(lastWorkspace.id);
});

it('opens a detached settings tab without restoring the main window document tabs', async () => {
  rememberStartupWorkspace(lastWorkspace.id);
  window.history.replaceState(null, '', `/?detachedTab=view:settings&workspacePath=${encodeURIComponent(olderWorkspace.path)}&settingsPage=shortcuts`);
  const adapter = localWorkspace();
  store.registerViews([{ id: 'view:settings', label: '设置', icon: {}, detachable: true }]);
  await store.initialize();
  expect(adapter.open).toHaveBeenCalledExactlyOnceWith(olderWorkspace.path);
  expect(store.tabs.map(tab => tab.id)).toEqual(['view:settings']);
  expect(store.activeId).toBe('view:settings');
  expect(store.active).toBeUndefined();
  expect(readStartupWorkspace()).toBe(lastWorkspace.id);
});

it('recovers invalid device preferences through recent history', async () => {
  localStorage.setItem(startupWorkspaceKey, '{broken');
  const adapter = localWorkspace();
  await store.initialize();
  expect(store.workspace?.id).toBe(lastWorkspace.id);
  expect(readStartupWorkspace()).toBe(lastWorkspace.id);
});

it('does not block opening a workspace when the startup preference cannot be saved', async () => {
  const adapter = localWorkspace();
  const setItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key === startupWorkspaceKey) throw new Error('存储不可用');
    setItem.call(this, key, value);
  });
  await store.initialize();
  expect(store.workspace?.id).toBe(lastWorkspace.id);
  expect(store.fatal).toBe('');
});

function emptyWorkspace(mode: 'desktop' | 'web' = 'web') {
  const adapter = new DemoAdapter({ files: {}, storageKey: `welcome-${crypto.randomUUID()}` });
  Object.defineProperty(adapter, 'mode', { value: mode });
  pinia = configureWorkbench(createPinia(), { adapter, native: false, mobile: false });
  setActivePinia(pinia);
  store = useWorkspaceStore();
  return adapter;
}

it('creates and opens an editable guide for an explicitly created workspace', async () => {
  const adapter = emptyWorkspace();
  Object.assign(adapter, { createWorkspace: vi.fn(() => adapter.refresh()) });
  await store.createWorkspace('新项目');
  expect(store.fatal).toBe('');
  expect(store.active?.path).toBe(workspaceWelcomePath);
  expect(store.active?.content).toBe(workspaceWelcomeContent('web'));
  expect(store.workspace?.files.filter(file => file.kind === 'file')).toHaveLength(1);
  store.editDocument(store.activeId, '# 我的第一篇笔记\n');
  expect(await store.flush()).toBe(true);
  expect((await adapter.read(workspaceWelcomePath)).content).toBe('# 我的第一篇笔记\n');
});

it('creates immediately with a default name and ignores another click while creation is pending', async () => {
  const adapter = emptyWorkspace();
  const create = vi.fn(() => adapter.refresh());
  Object.assign(adapter, { createWorkspace: create });
  await Promise.all([store.createWorkspace(), store.createWorkspace()]);
  expect(create).toHaveBeenCalledExactlyOnceWith('新工作区');
  expect(store.active?.path).toBe(workspaceWelcomePath);
});

it('numbers default names and reserves renamed mobile workspaces by their backing folder names', async () => {
  const adapter = emptyWorkspace('desktop');
  const create = vi.fn(() => adapter.refresh());
  Object.assign(adapter, { createWorkspace: create });
  store.recent = [
    { id: 'first', name: '新工作区', path: 'C:\\手机空间\\新工作区', openedAt: 0 },
    { id: 'second', name: '研究笔记', path: 'C:\\手机空间\\新工作区 2', openedAt: 0 },
  ];
  await store.createWorkspace();
  expect(create).toHaveBeenCalledExactlyOnceWith('新工作区 3');
});

it('initializes newly created local workspaces on their first open', async () => {
  const adapter = emptyWorkspace('desktop');
  vi.spyOn(adapter, 'open').mockImplementationOnce(async () => ({ ...await adapter.refresh(), newlyCreated: true }));
  await store.initialize('C:\\新工作区');
  expect(store.active?.path).toBe(workspaceWelcomePath);
  expect(store.active?.content).toBe(workspaceWelcomeContent('desktop'));
});

it('explains metadata deletion after opening a reinitialized local workspace', async () => {
  const adapter = emptyWorkspace('desktop');
  await adapter.create('已有笔记.md', '# 原有内容\n');
  vi.spyOn(adapter, 'open').mockImplementationOnce(async () => ({
    ...await adapter.refresh(), newlyCreated: true, reinitialized: true,
  }));
  const create = vi.spyOn(adapter, 'create');
  await store.initialize('C:\\已有文件夹');
  expect(store.workspace).not.toBeNull();
  expect(store.active?.content).toBe('# 原有内容\n');
  expect(create).not.toHaveBeenCalled();
  expect(store.fatal).toBe('.tano 已删除，工作区已重新初始化。旧对象已丢失，文档和附件保留。');
  store.fatal = '';
  await store.openWorkspace('C:\\已有文件夹');
  expect(store.fatal).toBe('');
});

it('keeps the reinitialization notice when an empty folder receives its welcome document', async () => {
  const adapter = emptyWorkspace('desktop');
  vi.spyOn(adapter, 'open').mockImplementationOnce(async () => ({
    ...await adapter.refresh(), newlyCreated: true, reinitialized: true,
  }));
  await store.initialize('C:\\空文件夹');
  expect(store.active?.path).toBe(workspaceWelcomePath);
  expect(store.fatal).toContain('工作区已重新初始化');
});

it('does not recreate a deleted guide when an existing empty workspace is reopened', async () => {
  const adapter = emptyWorkspace();
  Object.assign(adapter, { createWorkspace: () => adapter.refresh() });
  await store.createWorkspace('新项目');
  await adapter.remove(workspaceWelcomePath);
  await store.openWorkspace();
  expect(store.workspace?.files).toEqual([]);
  expect(store.active).toBeUndefined();
});

it('leaves existing empty workspaces empty', async () => {
  emptyWorkspace();
  await store.initialize();
  expect(store.workspace?.files).toEqual([]);
  expect(store.active).toBeUndefined();
});

it('preserves content in an existing folder when it first becomes a local workspace', async () => {
  const adapter = emptyWorkspace('desktop');
  await adapter.create('已有笔记.md', '# 原有内容\n');
  vi.spyOn(adapter, 'open').mockImplementationOnce(async () => ({ ...await adapter.refresh(), newlyCreated: true }));
  const create = vi.spyOn(adapter, 'create');
  await store.initialize('C:\\已有文件夹');
  expect(create).not.toHaveBeenCalled();
  expect(store.active?.path).toBe('已有笔记.md');
  expect(store.active?.content).toBe('# 原有内容\n');
});

it('keeps the new workspace usable when its guide cannot be saved', async () => {
  const adapter = emptyWorkspace();
  Object.assign(adapter, { createWorkspace: () => adapter.refresh() });
  vi.spyOn(adapter, 'create').mockRejectedValue(new Error('network offline'));
  await store.createWorkspace('新项目');
  expect(store.workspace).not.toBeNull();
  expect(store.busy).toBe(false);
  expect(store.fatal).toContain('入门文档未能添加');
});
