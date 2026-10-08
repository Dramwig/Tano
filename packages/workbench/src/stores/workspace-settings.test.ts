// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { DemoAdapter } from '../adapter';
import { configureWorkbench } from '../runtime';
import { useWorkspaceStore } from './workspace';
import { defaultWorkspaceSettings, saveWorkspaceSettingsPatch } from '../workspace-settings';
import { workspaceSettingsPath } from '@tano/protocol';

let pinia: ReturnType<typeof createPinia>;
let store: ReturnType<typeof useWorkspaceStore>;
beforeEach(() => localStorage.clear());
afterEach(() => { store?.dispose(); if (pinia) disposePinia(pinia); });
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
