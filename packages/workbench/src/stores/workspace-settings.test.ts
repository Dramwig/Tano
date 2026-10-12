// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { DemoAdapter } from '../adapter';
import { configureWorkbench } from '../runtime';
import { useWorkspaceStore } from './workspace';
import { defaultWorkspaceSettings, saveWorkspaceSettingsPatch } from '../workspace-settings';
import { workspaceSettingsPath } from '@tano/protocol';
import type { WorkspaceAdapter } from '@tano/protocol';

let pinia: ReturnType<typeof createPinia>;
let store: ReturnType<typeof useWorkspaceStore>;
beforeEach(() => localStorage.clear());
afterEach(() => { store?.dispose(); if (pinia) disposePinia(pinia); vi.restoreAllMocks(); });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function setup(adapter: DemoAdapter) {
  pinia = configureWorkbench(createPinia(), { adapter, native: false, mobile: false });
  setActivePinia(pinia); store = useWorkspaceStore(); await store.initialize();
}
it('opens the configured home page and keeps its stable ID and display name across filesystem scans', async () => {
  const adapter = new DemoAdapter({ files: { 'a.md': '# A', 'b.md': '# B' } });
  const workspace = await adapter.open();
  const home = workspace.files.find(file => file.path === 'b.md')!;
  await adapter.create(workspaceSettingsPath, JSON.stringify({ ...defaultWorkspaceSettings, name: '月夜', homePageId: home.id }));
  await setup(adapter);
  expect(store.activeId).toBe(home.id);
  expect(store.workspace?.name).toBe('月夜');
  await adapter.rename('b.md', '新的首页.md');
  await store.refresh();
  expect(store.active?.path).toBe('新的首页.md');
  expect(store.workspaceSettings.homePageId).toBe(home.id);
  expect(store.workspace?.name).toBe('月夜');
  await store.updateWorkspaceSettings(workspace.id, { key: 'name', value: '新名称', previous: '月夜' });
  expect(store.workspace?.name).toBe('新名称');
  await store.create('新文件夹', true);
  expect(store.workspace?.name).toBe('新名称');
});
it('does not overwrite external settings and permits retry after reloading', async () => {
  const adapter = new DemoAdapter(); await setup(adapter);
  const workspaceId = store.workspace!.id;
  await saveWorkspaceSettingsPatch(adapter, null, { key: 'name', value: '外部名称', previous: '' });
  await store.updateWorkspaceSettings(workspaceId, { key: 'name', value: '我的名称', previous: '' });
  expect(store.workspace?.name).toBe('外部名称');
  expect(store.workspaceSettingsError).toContain('其他人或程序修改');
  expect(JSON.parse((await adapter.read(workspaceSettingsPath)).content).name).toBe('外部名称');
  await store.reloadWorkspaceSettings();
  expect(store.workspaceSettingsError).toBe('');
  await store.updateWorkspaceSettings(workspaceId, { key: 'name', value: '确认后的名称', previous: '外部名称' });
  expect(store.workspace?.name).toBe('确认后的名称');
});
it('rejects settings from another workspace and refuses to modify a read-only workspace', async () => {
  const adapter = new DemoAdapter(); await setup(adapter);
  await store.updateWorkspaceSettings('other', { key: 'showPlan', value: false, previous: true });
  expect(store.workspaceSettings.showPlan).toBe(true);
  store.workspace!.readOnly = true;
  await store.updateWorkspaceSettings(store.workspace!.id, { key: 'showPlan', value: false, previous: true });
  expect(store.workspaceSettings.showPlan).toBe(true);
  expect((await adapter.refresh()).files.some(file => file.path === workspaceSettingsPath)).toBe(false);
});

it('checks settings authority separately from content write permission', async () => {
  const adapter = new DemoAdapter(); await setup(adapter);
  store.workspace!.canManageSettings = false;
  const create = vi.spyOn(adapter, 'create');
  await store.updateWorkspaceSettings(store.workspace!.id, { key: 'name', value: 'Unauthorized', previous: '' });
  expect(store.workspaceSettings.name).toBe('');
  expect(create).not.toHaveBeenCalled();
  store.workspace!.canManageSettings = false;
  await store.updateCapabilities({ bulletListMarker: '+' });
  expect(create).not.toHaveBeenCalled();
  expect(store.workspace?.readOnly).not.toBe(true);
});
it('uses the saved workspace title source and follows external changes on refresh', async () => {
  const adapter = new DemoAdapter();
  const initial = await saveWorkspaceSettingsPatch(adapter, null, { key: 'pageTitleSource', value: 'filename', previous: 'frontmatter-first' });
  await setup(adapter);
  expect(store.workspaceSettings.pageTitleSource).toBe('filename');
  await saveWorkspaceSettingsPatch(adapter, initial.snapshot, { key: 'pageTitleSource', value: 'frontmatter', previous: 'filename' });
  await store.refresh();
  expect(store.workspaceSettings.pageTitleSource).toBe('frontmatter');
  await store.updateWorkspaceSettings(store.workspace!.id, { key: 'pageTitleSource', value: 'frontmatter-first', previous: 'frontmatter' });
  expect(store.workspaceSettings.pageTitleSource).toBe('frontmatter-first');
  expect(JSON.parse((await adapter.read(workspaceSettingsPath)).content).pageTitleSource).toBe('frontmatter-first');
});

it.each(['🌙', 'icon:book', 'data:image/png;base64,aW1hZ2U=', ''])('previews icon %j before its write finishes', async icon => {
  const adapter = new DemoAdapter();
  await saveWorkspaceSettingsPatch(adapter, null, { key: 'icon', value: '🌷', previous: '' });
  await setup(adapter);
  const gate = deferred();
  const started = deferred();
  const write = adapter.write.bind(adapter);
  vi.spyOn(adapter, 'write').mockImplementationOnce(async (...args) => {
    started.resolve(); await gate.promise; return write(...args);
  });
  const saving = store.updateWorkspaceSettings(store.workspace!.id, { key: 'icon', value: icon, previous: '🌷' });
  expect(store.workspaceSettings.icon).toBe(icon);
  expect(store.workspaceSettingsSaving).toBe(true);
  await started.promise;
  expect(JSON.parse((await adapter.read(workspaceSettingsPath)).content).icon).toBe('🌷');
  gate.resolve(); await saving;
  expect(store.workspaceSettings.icon).toBe(icon);
  expect(JSON.parse((await adapter.read(workspaceSettingsPath)).content).icon).toBe(icon);
  expect(store.workspaceSettingsSaving).toBe(false);
  expect(store.workspaceSettingsError).toBe('');
});

it('keeps the first icon preview while a previous filesystem refresh is still queued', async () => {
  const adapter = new DemoAdapter(); await setup(adapter);
  const refreshGate = deferred();
  const refreshing = deferred();
  const createGate = deferred();
  const creating = deferred();
  const refresh = adapter.refresh.bind(adapter);
  const create = adapter.create.bind(adapter);
  vi.spyOn(adapter, 'refresh').mockImplementationOnce(async () => {
    refreshing.resolve(); await refreshGate.promise; return refresh();
  });
  vi.spyOn(adapter, 'create').mockImplementationOnce(async (...args) => {
    creating.resolve(); await createGate.promise; return create(...args);
  });
  const reloading = store.reloadWorkspaceSettings(); await refreshing.promise;
  const saving = store.updateWorkspaceSettings(store.workspace!.id, { key: 'icon', value: '🌙', previous: '' });
  expect(store.workspaceSettings.icon).toBe('🌙');
  refreshGate.resolve(); await reloading; await creating.promise;
  expect(store.workspaceSettings.icon).toBe('🌙');
  createGate.resolve(); await saving;
  expect(store.workspaceSettings.icon).toBe('🌙');
  expect(JSON.parse((await adapter.read(workspaceSettingsPath)).content).icon).toBe('🌙');
});

it('rolls back a failed icon save even when reloading the workspace also fails', async () => {
  const adapter = new DemoAdapter();
  await saveWorkspaceSettingsPatch(adapter, null, { key: 'icon', value: '🌷', previous: '' });
  await setup(adapter);
  const gate = deferred();
  vi.spyOn(adapter, 'write').mockImplementationOnce(async () => { await gate.promise; throw new Error('写入失败'); });
  vi.spyOn(adapter, 'refresh').mockRejectedValue(new Error('读取失败'));
  const saving = store.updateWorkspaceSettings(store.workspace!.id, { key: 'icon', value: '🌙', previous: '🌷' });
  expect(store.workspaceSettings.icon).toBe('🌙');
  gate.resolve(); await saving;
  expect(store.workspaceSettings.icon).toBe('🌷');
  expect(store.workspaceSettingsError).toContain('写入失败');
  expect(store.workspaceSettingsSaving).toBe(false);
  expect(JSON.parse((await adapter.read(workspaceSettingsPath)).content).icon).toBe('🌷');
});

it('reconciles an optimistic icon with an external conflict and allows retry after reloading', async () => {
  const adapter = new DemoAdapter();
  const initial = await saveWorkspaceSettingsPatch(adapter, null, { key: 'icon', value: '🌷', previous: '' });
  await setup(adapter);
  await saveWorkspaceSettingsPatch(adapter, initial.snapshot, { key: 'icon', value: '🌳', previous: '🌷' });
  const workspaceId = store.workspace!.id;
  const saving = store.updateWorkspaceSettings(workspaceId, { key: 'icon', value: '🌙', previous: '🌷' });
  expect(store.workspaceSettings.icon).toBe('🌙');
  await saving;
  expect(store.workspaceSettings.icon).toBe('🌳');
  expect(store.workspaceSettingsError).toContain('其他人或程序修改');
  expect(JSON.parse((await adapter.read(workspaceSettingsPath)).content).icon).toBe('🌳');
  await store.reloadWorkspaceSettings();
  await store.updateWorkspaceSettings(workspaceId, { key: 'icon', value: '🌙', previous: '🌳' });
  expect(store.workspaceSettings.icon).toBe('🌙');
  expect(store.workspaceSettingsError).toBe('');
});

it('does not preview icons for a different or read-only workspace', async () => {
  const adapter = new DemoAdapter(); await setup(adapter);
  const wrongWorkspace = store.updateWorkspaceSettings('other', { key: 'icon', value: '🌙', previous: '' });
  expect(store.workspaceSettings.icon).toBe(''); await wrongWorkspace;
  store.workspace!.readOnly = true;
  const readOnly = store.updateWorkspaceSettings(store.workspace!.id, { key: 'icon', value: '🌙', previous: '' });
  expect(store.workspaceSettings.icon).toBe(''); await readOnly;
  expect(store.workspaceSettings.icon).toBe('');
  expect((await adapter.refresh()).files.some(file => file.path === workspaceSettingsPath)).toBe(false);
});

it('finishes an acknowledged settings edit without a full refresh or a second settings read', async () => {
  const adapter = new DemoAdapter();
  await saveWorkspaceSettingsPatch(adapter, null, { key: 'icon', value: '🌷', previous: '' });
  await setup(adapter);
  const workspaceId = store.workspace!.id;
  store.recent = [{ id: workspaceId, name: store.workspace!.name, path: '', openedAt: 1, icon: '🌷' }];
  const refresh = vi.spyOn(adapter, 'refresh').mockRejectedValue(new Error('Refresh unavailable'));
  const read = vi.spyOn(adapter, 'read');
  await store.updateWorkspaceSettings(workspaceId, { key: 'icon', value: '🌙', previous: '🌷' });
  expect(refresh).not.toHaveBeenCalled();
  // DemoAdapter reads to compare the base and build its acknowledgement; no extra read.
  expect(read).toHaveBeenCalledTimes(2);
  expect(store.workspaceSettingsError).toBe('');
  expect(store.workspaceSettingsSaving).toBe(false);
  expect(store.recent[0]?.icon).toBe('🌙');
  await store.updateWorkspaceSettings(workspaceId, { key: 'name', value: '新名称', previous: '' });
  expect(store.workspace?.name).toBe('新名称');
  expect(store.recent[0]?.name).toBe('新名称');
  expect(refresh).not.toHaveBeenCalled();
});

it('uses a creation acknowledgement to register settings and save subsequent changes without a scan', async () => {
  const adapter = new DemoAdapter(); await setup(adapter);
  const create = adapter.create.bind(adapter);
  const refresh = adapter.refresh.bind(adapter);
  vi.spyOn(adapter as WorkspaceAdapter, 'create').mockImplementation(async (...args) => {
    await create(...args); return refresh();
  });
  const scan = vi.spyOn(adapter, 'refresh').mockRejectedValue(new Error('Unexpected scan'));
  const workspaceId = store.workspace!.id;
  await store.updateWorkspaceSettings(workspaceId, { key: 'icon', value: '🌙', previous: '' });
  const file = store.workspace!.files.find(file => file.path === workspaceSettingsPath)!;
  expect(file.id).toBeTruthy();
  expect(file.size).toBe(new TextEncoder().encode((await adapter.read(workspaceSettingsPath)).content).length);
  await store.updateWorkspaceSettings(workspaceId, { key: 'showPlan', value: false, previous: true });
  expect(store.workspaceSettings).toMatchObject({ icon: '🌙', showPlan: false });
  expect(scan).not.toHaveBeenCalled();
  expect(store.workspaceSettingsError).toBe('');
});
