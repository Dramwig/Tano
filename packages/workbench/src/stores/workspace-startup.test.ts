// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { DemoAdapter } from '../adapter';
import { configureWorkbench } from '../runtime';
import { useWorkspaceStore } from './workspace';
import { workspaceWelcomeContent, workspaceWelcomePath } from '../workspace-welcome';

let pinia: ReturnType<typeof createPinia>;
let store: ReturnType<typeof useWorkspaceStore>;
afterEach(() => { store?.dispose(); if (pinia) disposePinia(pinia); });

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

it('keeps ordinary local startup at the workspace picker until a folder is selected', async () => {
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
