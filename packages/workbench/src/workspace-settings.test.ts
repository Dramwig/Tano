// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { DemoAdapter } from './adapter';
import { workspaceSettingsPath } from '@tano/protocol';
import { defaultWorkspaceSettings, loadWorkspaceSettings, parseWorkspaceSettings, saveWorkspaceSettingsPatch } from './workspace-settings';
import { builtinWorkspaceIcons, workspaceEmojiGroups } from './workspace-icons';

beforeEach(() => localStorage.clear());
it('persists portable settings independently of Markdown content and workspace identity', async () => {
  const adapter = new DemoAdapter();
  const workspace = await adapter.open();
  const document = workspace.files.find(file => file.path.endsWith('.md'))!;
  const before = await adapter.read(document.path);
  const initial = await saveWorkspaceSettingsPatch(adapter, null, { key: 'name', value: '月夜', previous: '' });
  const saved = await saveWorkspaceSettingsPatch(adapter, initial.snapshot, { key: 'homePageId', value: document.id, previous: '' });
  await adapter.rename(document.path, '重命名.md');
  const reopened = new DemoAdapter();
  const next = await reopened.open();
  expect(next.id).toBe(workspace.id);
  expect((await loadWorkspaceSettings(reopened, next)).settings).toEqual(saved.settings);
  expect(next.files.find(file => file.path === '重命名.md')?.id).toBe(saved.settings.homePageId);
  expect(await reopened.read('重命名.md')).toEqual(before);
});
it('merges independent edits, preserves unknown fields, and handles competing creators', async () => {
  const adapter = new DemoAdapter();
  await adapter.create(workspaceSettingsPath, JSON.stringify({ ...defaultWorkspaceSettings, future: 'keep' }));
  const base = await adapter.read(workspaceSettingsPath);
  await saveWorkspaceSettingsPatch(adapter, base, { key: 'icon', value: '🌙', previous: '' });
  const saved = await saveWorkspaceSettingsPatch(adapter, base, { key: 'showPlan', value: false, previous: true });
  expect(saved.settings).toMatchObject({ icon: '🌙', showPlan: false });
  expect(JSON.parse(saved.snapshot.content).future).toBe('keep');
  const merged = await saveWorkspaceSettingsPatch(adapter, null, { key: 'showPlugins', value: false, previous: true });
  expect(merged.settings).toMatchObject({ icon: '🌙', showPlan: false, showPlugins: false });
});
it('retains the external version when the same field conflicts or the settings file is corrupt', async () => {
  const adapter = new DemoAdapter();
  const first = await saveWorkspaceSettingsPatch(adapter, null, { key: 'name', value: '原名称', previous: '' });
  const external = await saveWorkspaceSettingsPatch(adapter, first.snapshot, { key: 'name', value: '外部名称', previous: '原名称' });
  await expect(saveWorkspaceSettingsPatch(adapter, first.snapshot, { key: 'name', value: '我的名称', previous: '原名称' })).rejects.toThrow('其他人或程序修改');
  expect(await adapter.read(workspaceSettingsPath)).toEqual(external.snapshot);
  await adapter.write(workspaceSettingsPath, '{broken', external.snapshot.hash);
  await expect(saveWorkspaceSettingsPatch(adapter, external.snapshot, { key: 'showPlan', value: false, previous: true })).rejects.toThrow();
  expect((await adapter.read(workspaceSettingsPath)).content).toBe('{broken');
});
it('rejects invalid settings without creating a file', async () => {
  const adapter = new DemoAdapter();
  await expect(saveWorkspaceSettingsPatch(adapter, null, { key: 'name', value: '长'.repeat(66), previous: '' })).rejects.toThrow('65');
  expect((await adapter.refresh()).files.some(file => file.path === workspaceSettingsPath)).toBe(false);
  expect(() => parseWorkspaceSettings(JSON.stringify({ ...defaultWorkspaceSettings, icon: 'data:image/svg+xml;base64,xxx' }))).toThrow('图标');
  expect(() => parseWorkspaceSettings(JSON.stringify({ ...defaultWorkspaceSettings, showPlan: 'false' }))).toThrow('类型');
});
it('defaults older workspaces to YAML title first and persists the source separately for each workspace', async () => {
  expect(parseWorkspaceSettings('{"version":1}').pageTitleSource).toBe('frontmatter-first');
  const adapter = new DemoAdapter({ storageKey: 'workspace-a', workspaceId: 'a', files: { '文档.md': '---\ntitle: 标题\n---\n正文\n' } });
  await adapter.open();
  const document = await adapter.read('文档.md');
  await saveWorkspaceSettingsPatch(adapter, null, { key: 'pageTitleSource', value: 'filename', previous: 'frontmatter-first' });
  const reopened = new DemoAdapter({ storageKey: 'workspace-a', workspaceId: 'a' });
  expect((await loadWorkspaceSettings(reopened, await reopened.open())).settings.pageTitleSource).toBe('filename');
  expect(await reopened.read('文档.md')).toEqual(document);
  const other = new DemoAdapter({ storageKey: 'workspace-b', workspaceId: 'b' });
  expect((await loadWorkspaceSettings(other, await other.open())).settings.pageTitleSource).toBe('frontmatter-first');
});
it('merges other settings while preserving a conflicting external title source', async () => {
  const adapter = new DemoAdapter();
  const initial = await saveWorkspaceSettingsPatch(adapter, null, { key: 'pageTitleSource', value: 'filename', previous: 'frontmatter-first' });
  await saveWorkspaceSettingsPatch(adapter, initial.snapshot, { key: 'icon', value: '🌙', previous: '' });
  const external = await saveWorkspaceSettingsPatch(adapter, initial.snapshot, { key: 'pageTitleSource', value: 'frontmatter', previous: 'filename' });
  expect(external.settings.icon).toBe('🌙');
  await expect(saveWorkspaceSettingsPatch(adapter, initial.snapshot, { key: 'pageTitleSource', value: 'frontmatter-first', previous: 'filename' })).rejects.toThrow('其他人或程序修改');
  expect(await adapter.read(workspaceSettingsPath)).toEqual(external.snapshot);
});
it.each(['unknown', '', null, 1])('rejects an invalid title source %j without changing workspace settings', async (pageTitleSource) => {
  const adapter = new DemoAdapter();
  const initial = await saveWorkspaceSettingsPatch(adapter, null, { key: 'name', value: '工作区', previous: '' });
  await expect(saveWorkspaceSettingsPatch(adapter, initial.snapshot, {
    key: 'pageTitleSource', value: pageTitleSource as 'filename', previous: 'frontmatter-first',
  })).rejects.toThrow();
  expect(await adapter.read(workspaceSettingsPath)).toEqual(initial.snapshot);
});
it('persists built-in icon IDs and accepts catalog emojis within the native recent-icon limits', async () => {
  for (const icon of [...builtinWorkspaceIcons, ...workspaceEmojiGroups.flatMap(group => group.icons)]) {
    expect([...icon.value].length).toBeLessThanOrEqual(16);
    expect(parseWorkspaceSettings(JSON.stringify({ ...defaultWorkspaceSettings, icon: icon.value })).icon).toBe(icon.value);
  }
  expect(() => parseWorkspaceSettings(JSON.stringify({ ...defaultWorkspaceSettings, icon: 'icon:unknown' }))).toThrow('未知');
  const adapter = new DemoAdapter(); await adapter.open();
  await saveWorkspaceSettingsPatch(adapter, null, { key: 'icon', value: 'icon:rocket', previous: '' });
  const reopened = new DemoAdapter(); const workspace = await reopened.open();
  expect((await loadWorkspaceSettings(reopened, workspace)).settings.icon).toBe('icon:rocket');
});
