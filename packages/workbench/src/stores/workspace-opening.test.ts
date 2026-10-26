// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { watch } from 'vue';
import { workspaceCapabilityPath, type Workspace, type WorkspaceAdapter } from '@tano/protocol';
import { newDataTable } from '../data-tables';
import { DemoAdapter } from '../adapter';
import { configureWorkbench } from '../runtime';
import { useWorkspaceStore } from './workspace';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
let pinia: ReturnType<typeof createPinia>;
let store: ReturnType<typeof useWorkspaceStore>;
let adapter: WorkspaceAdapter;
let target: Workspace;

beforeEach(async () => {
  localStorage.clear();
  const demo = new DemoAdapter({ files: { 'README.md': '# 旧页面' } });
  Object.defineProperty(demo, 'mode', { value: 'desktop' });
  const initial = await demo.open();
  adapter = demo;
  target = { ...initial, id: 'target', name: '目标工作区', path: 'C:\\目标工作区' };
  pinia = configureWorkbench(createPinia(), { adapter, native: false, mobile: false });
  setActivePinia(pinia);
  store = useWorkspaceStore();
  await store.openWorkspace('C:\\旧工作区');
});
afterEach(async () => {
  vi.restoreAllMocks();
  await store.dispose();
  disposePinia(pinia);
});

it.each(['open', 'switch', 'create'] as const)('enters the loading display synchronously for %s, before scanning finishes', async action => {
  if (action === 'open') await store.leaveWorkspace();
  const oldWorkspace = store.workspace;
  const oldDocument = store.active;
  const scanned = deferred<Workspace>();
  const open = vi.spyOn(adapter, 'open').mockImplementation(() => scanned.promise);
  if (action !== 'open') adapter.selectWorkspacePath = vi.fn();
  adapter.createWorkspace = vi.fn(() => scanned.promise);
  const operation = action === 'create' ? store.createWorkspace('新工作区')
    : store.openWorkspace(action === 'switch' ? target.path : undefined);
  expect(store.openingWorkspace).toBe(true);
  expect(store.workspace).toBe(oldWorkspace);
  expect(store.active).toBe(oldDocument);
  await vi.waitFor(() => expect(action === 'create' ? adapter.createWorkspace : open).toHaveBeenCalledOnce());
  expect(store.openingWorkspace).toBe(true);
  scanned.resolve(target);
  await operation;
  expect(store.openingWorkspace).toBe(false);
  expect(store.busy).toBe(false);
  expect(store.workspace?.id).toBe(target.id);
  if (action !== 'open') expect(adapter.selectWorkspacePath).not.toHaveBeenCalled();
});

it('keeps the current page throughout folder selection, then shows loading before the confirmed scan', async () => {
  const selected = deferred<string | null>();
  const scanned = deferred<Workspace>();
  const oldWorkspace = store.workspace;
  const oldDocument = store.active;
  adapter.selectWorkspacePath = vi.fn(() => selected.promise);
  const open = vi.spyOn(adapter, 'open').mockImplementation(() => scanned.promise);
  const beforeSwitch = vi.fn(async () => {});
  store.setDocumentLifecycle({ beforeSwitch, beforeCloseDocument: async () => {} });
  const operation = store.openWorkspace();
  expect(store.busy).toBe(true);
  expect(store.openingWorkspace).toBe(false);
  expect(store.workspace).toBe(oldWorkspace);
  expect(store.active).toBe(oldDocument);
  expect(beforeSwitch).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
  // Repeated clicks while the native dialog is open cannot start another picker.
  await store.openWorkspace();
  expect(adapter.selectWorkspacePath).toHaveBeenCalledOnce();
  selected.resolve(target.path);
  await vi.waitFor(() => expect(open).toHaveBeenCalledExactlyOnceWith(target.path));
  expect(store.openingWorkspace).toBe(true);
  expect(beforeSwitch).toHaveBeenCalledOnce();
  expect(store.workspace).toBe(oldWorkspace);
  scanned.resolve(target);
  await operation;
  expect(store.openingWorkspace).toBe(false);
  expect(store.workspace?.id).toBe(target.id);
});

it.each(['cancel', 'error'] as const)('never flashes a skeleton or suspends the current editor on picker %s', async outcome => {
  const oldWorkspace = store.workspace;
  const oldDocument = store.active;
  const transitions: boolean[] = [];
  const stop = watch(() => store.openingWorkspace, value => transitions.push(value), { flush: 'sync' });
  adapter.selectWorkspacePath = outcome === 'cancel' ? vi.fn(async () => null)
    : vi.fn(async () => { throw new Error('无法显示文件夹选择窗口'); });
  const open = vi.spyOn(adapter, 'open');
  const beforeSwitch = vi.fn(async () => {});
  const afterSwitch = vi.fn(async () => {});
  store.setDocumentLifecycle({ beforeSwitch, afterSwitch, beforeCloseDocument: async () => {} });
  await store.openWorkspace();
  stop();
  expect(transitions).toEqual([]);
  expect(open).not.toHaveBeenCalled();
  expect(beforeSwitch).not.toHaveBeenCalled();
  expect(afterSwitch).not.toHaveBeenCalled();
  expect(store.busy).toBe(false);
  expect(store.workspace).toBe(oldWorkspace);
  expect(store.active).toBe(oldDocument);
  expect(store.fatal).toBe(outcome === 'cancel' ? '' : '无法显示文件夹选择窗口');
});

it('keeps loading through session recovery, then releases the ready workspace before resuming its editor', async () => {
  vi.spyOn(adapter, 'open').mockResolvedValue(target);
  const session = deferred<null>();
  const entered = deferred<void>();
  vi.spyOn(adapter, 'loadSession').mockImplementation(async () => { entered.resolve(); return session.promise; });
  const resumed = deferred<void>();
  const handoff = deferred<void>();
  store.setDocumentLifecycle({
    beforeSwitch: async () => {}, beforeCloseDocument: async () => {},
    afterSwitch: async () => { handoff.resolve(); await resumed.promise; },
  });
  const operation = store.openWorkspace(target.path);
  await entered.promise;
  expect(store.workspace?.id).toBe(target.id);
  expect(store.active).toBeUndefined();
  expect(store.openingWorkspace).toBe(true);
  session.resolve(null);
  await handoff.promise;
  expect(store.active).toBeDefined();
  expect(store.openingWorkspace).toBe(false);
  expect(store.busy).toBe(false);
  resumed.resolve();
  await operation;
  expect(store.openingWorkspace).toBe(false);
});

it.each(['cancel', 'error'] as const)('restores the old workspace and document after %s', async outcome => {
  const oldWorkspace = store.workspace;
  const oldDocument = store.active;
  const tabs = store.tabs.map(tab => tab.id);
  const open = vi.spyOn(adapter, 'open');
  if (outcome === 'cancel') open.mockResolvedValue(null);
  else open.mockRejectedValue(new Error('无法打开文件夹'));
  const operation = store.openWorkspace();
  expect(store.openingWorkspace).toBe(true);
  await operation;
  expect(store.openingWorkspace).toBe(false);
  expect(store.workspace).toBe(oldWorkspace);
  expect(store.active).toBe(oldDocument);
  expect(store.tabs.map(tab => tab.id)).toEqual(tabs);
});

it('shows loading while the previous editor settles, then recovers if handoff fails', async () => {
  const oldDocument = store.active;
  const settled = deferred<void>();
  store.setBeforeWorkspaceChange(async () => { await settled.promise; throw new Error('编辑器保存失败'); });
  const open = vi.spyOn(adapter, 'open');
  const operation = store.openWorkspace(target.path);
  expect(store.openingWorkspace).toBe(true);
  expect(store.active).toBe(oldDocument);
  settled.resolve();
  await operation;
  expect(open).not.toHaveBeenCalled();
  expect(store.active).toBe(oldDocument);
  expect(store.openingWorkspace).toBe(false);
  expect(store.fatal).toBe('编辑器保存失败');
});

it('publishes the file tree before session recovery and clears only that region on scan completion', async () => {
  const session = deferred<null>();
  const entered = deferred<void>();
  vi.spyOn(adapter, 'open').mockResolvedValue(target);
  vi.spyOn(adapter, 'loadSession').mockImplementation(() => { entered.resolve(); return session.promise; });
  const operation = store.openWorkspace(target.path);
  expect(store.workspaceLoading.files).toBe(true);
  await entered.promise;
  expect(store.workspace?.id).toBe(target.id);
  expect(store.workspaceLoading.files).toBe(false);
  expect(store.workspaceLoading.session).toBe(true);
  session.resolve(null);
  await operation;
});

it.each(['slow', 'failure'] as const)('opens the initial document without waiting for a %s table or workspace rules', async outcome => {
  const tablePath = '慢表格.table.json';
  await adapter.create(workspaceCapabilityPath, '{}');
  await adapter.create(tablePath, JSON.stringify(newDataTable('abc123')));
  target.files = (await adapter.refresh()).files;
  vi.spyOn(adapter, 'open').mockResolvedValue(target);
  vi.spyOn(adapter, 'loadSession').mockResolvedValue(null);
  const table = deferred<void>(), rules = deferred<void>();
  const read = adapter.read.bind(adapter);
  vi.spyOn(adapter, 'read').mockImplementation(async path => {
    if (path === tablePath) {
      await table.promise;
      if (outcome === 'failure') throw new Error('表格读取失败');
    }
    if (path === workspaceCapabilityPath) await rules.promise;
    return read(path);
  });
  const operation = store.openWorkspace(target.path);
  try {
    await vi.waitFor(() => expect(store.workspace?.id).toBe(target.id));
    await vi.waitFor(() => expect(store.active?.path).toBe('README.md'));
    expect(store.workspaceLoading.files).toBe(false);
    expect(store.workspaceLoading.session).toBe(false);
    expect(store.restoringDocuments).toEqual({});
    expect(store.workspaceLoading.tables).toBe(true);
    expect(store.workspaceLoading.capabilities).toBe(true);
    table.resolve();
    await vi.waitFor(() => expect(store.workspaceLoading.tables).toBe(false));
    expect(store.workspaceLoading.capabilities).toBe(true);
    expect(store.active?.content).toBe('# 旧页面');
  } finally { table.resolve(); rules.resolve(); await operation; }
});

it('restores tab labels before bodies, prioritizes visible documents, and keeps other panes loading independently', async () => {
  for (let i = 0; i < 6; i++) await adapter.create(`后台${i}.md`, `# 后台${i}`);
  target.files = (await adapter.refresh()).files;
  const files = target.files.filter(file => file.path.endsWith('.md'));
  const visible = files.at(-1)!;
  vi.spyOn(adapter, 'open').mockResolvedValue(target);
  vi.spyOn(adapter, 'loadSession').mockResolvedValue({ version: 1, activeId: visible.id,
    tabs: files.map(file => file.id), documents: files.map(file => ({ id: file.id, path: file.path })) });
  const gates = new Map(files.map(file => [file.path, deferred<void>()]));
  const reads: string[] = [];
  const read = adapter.read.bind(adapter);
  vi.spyOn(adapter, 'read').mockImplementation(async path => {
    if (gates.has(path)) { reads.push(path); await gates.get(path)!.promise; }
    return read(path);
  });
  const operation = store.openWorkspace(target.path);
  try {
    await vi.waitFor(() => expect(reads.length).toBe(4));
    expect(reads[0]).toBe(visible.path);
    expect(store.tabs.map(tab => tab.path)).toEqual(files.map(file => file.path));
    expect(store.workspaceLoading.session).toBe(false);
    expect(Object.keys(store.restoringDocuments)).toHaveLength(files.length);
    gates.get(visible.path)!.resolve();
    await vi.waitFor(() => expect(store.active?.path).toBe(visible.path));
    expect(store.restoringDocuments[visible.id]).toBeUndefined();
    expect(store.restoringDocuments[files[0].id]).toBe(files[0].path);
    expect(store.activeId).toBe(visible.id);
  } finally { for (const gate of gates.values()) gate.resolve(); await operation; }
  expect(store.tabs.map(tab => tab.id)).toEqual(files.map(file => file.id));
  expect(store.activeId).toBe(visible.id);
});
