// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import type { ObjectPluginManifest } from '@tano/protocol';
import { AppearanceController, builtinAppearance } from './appearance';
import { FileIconRegistry } from './file-icons/registry';
import { applyAppearance, applyTheme, readThemePreference, resolvedTheme } from './theme';
import { WorkspacePluginHost } from './workspace-plugins';
import { ObjectTypeRegistry } from '@tano/protocol';
import { DemoAdapter } from './adapter';

const manifest: ObjectPluginManifest = { manifestVersion: 1, id: 'sample', name: '样例', version: '1.0.0', description: '', objectTypes: [], relationTypes: [],
  appearance: { version: 2, colors: [{ id: 'ink', label: '墨', light: { paper: '#fff' }, dark: { paper: '#123' } }],
    icons: [{ id: 'ink', label: '墨', icons: { note: { color: 'currentColor', paths: ['M2 2h4'] } }, fileExtensions: { md: 'note' } }] } };
afterEach(() => { applyAppearance(); localStorage.clear(); vi.unstubAllGlobals(); });
it('keeps shape independent of colors and layout, with partial presets leaving icons and shape untouched', () => {
  const custom = structuredClone(manifest);
  custom.appearance!.presets = [{ id: 'partial', label: '配色与结构', color: 'ink', layout: 'builtin:islands' }];
  const controller = new AppearanceController(new FileIconRegistry());
  controller.sync('one', [{ manifest: custom, enabled: true }]);
  expect(controller.state.value.presets.find(p => p.id === 'sample:partial')?.previews).toEqual([
    { mode: 'light', colors: { '--preview-paper': '#fff' } },
    { mode: 'dark', colors: { '--preview-paper': '#123' } },
  ]);
  controller.select({ workspaceId: 'one', kind: 'icons', id: 'sample:ink' });
  controller.select({ workspaceId: 'one', kind: 'shape', id: 'builtin:crisp' });
  controller.select({ workspaceId: 'one', kind: 'preset', id: 'sample:partial' });
  expect(controller.state.value.active).toEqual({ color: 'sample:ink', icons: 'sample:ink', layout: 'builtin:islands', shape: 'builtin:crisp' });
  expect(document.documentElement.style.getPropertyValue('--radius-card')).toBe('0px');
  controller.select({ workspaceId: 'one', kind: 'color', id: 'builtin:tano' });
  expect(document.documentElement.style.getPropertyValue('--radius-card')).toBe('0px');
  controller.select({ workspaceId: 'one', kind: 'shape', id: 'builtin:tano' });
  expect(document.documentElement.style.getPropertyValue('--radius-card')).toBe(''); controller.dispose();
});
it('keeps mode user-wide while isolating workspace slots and accounts, including startup and reload', () => {
  const installed = [{ manifest, enabled: true }];
  const controller = new AppearanceController(new FileIconRegistry(), 'alice', localStorage);
  controller.sync('one', installed); controller.select({ workspaceId: 'one', kind: 'color', id: 'sample:ink' });
  controller.select({ workspaceId: 'one', kind: 'mode', id: 'dark' });
  controller.sync('two', installed);
  expect(controller.state.value.scope).toBe('user'); expect(controller.state.value.active.color).toBe('sample:ink');
  expect(resolvedTheme().mode).toBe('dark');
  controller.select({ workspaceId: 'two', kind: 'scope', id: 'workspace' });
  controller.select({ workspaceId: 'two', kind: 'color', id: 'builtin:tano' });
  controller.select({ workspaceId: 'two', kind: 'mode', id: 'light' });
  expect(readThemePreference('alice')).toBe('light');
  expect(JSON.parse(localStorage.getItem('tano.appearance.v2.alice.workspace.two')!)).toEqual({
    enabled: true, selected: { color: 'builtin:tano', icons: 'builtin:tano', layout: 'builtin:tano', shape: 'builtin:tano' },
  });
  controller.sync('one', installed); expect(controller.state.value.mode).toBe('light'); expect(controller.state.value.active.color).toBe('sample:ink');
  controller.sync('two', installed); expect(controller.state.value.mode).toBe('light');
  expect(controller.state.value.active.color).toBe('builtin:tano');
  controller.select({ workspaceId: 'two', kind: 'scope', id: 'user' });
  expect(controller.state.value.mode).toBe('light'); expect(controller.state.value.active.color).toBe('sample:ink'); controller.dispose();
  const reload = new AppearanceController(new FileIconRegistry(), 'alice', localStorage); reload.sync('two', installed);
  expect(reload.state.value.scope).toBe('user'); expect(reload.state.value.mode).toBe(readThemePreference('alice')); reload.dispose();
  const bob = new AppearanceController(new FileIconRegistry(), 'bob', localStorage); bob.sync('one', installed);
  expect(bob.state.value.active.color).toBe('builtin:tano'); expect(bob.state.value.mode).toBe('system'); bob.dispose();
});
it('resolves builtin availability from the host catalog and blocks unavailable presets atomically', () => {
  const custom = structuredClone(manifest); custom.appearance!.presets = [{ id: 'new', label: '新布局', color: 'ink', layout: 'builtin:new', shape: 'builtin:new-shape' }];
  const controller = new AppearanceController(new FileIconRegistry()); controller.sync('one', [{ manifest: custom, enabled: true }]);
  expect(controller.state.value.presets.find(p => p.id === 'sample:new')?.unavailable).toBe(true);
  expect(controller.state.value.presets.find(p => p.id === 'sample:new')?.missing).toEqual([
    { kind: 'layout', id: 'builtin:new' }, { kind: 'shape', id: 'builtin:new-shape' },
  ]);
  controller.select({ workspaceId: 'one', kind: 'preset', id: 'sample:new' }); expect(controller.state.value.active.color).toBe('builtin:tano'); controller.dispose();
  const host = new AppearanceController(new FileIconRegistry(), 'device', undefined, applyAppearance,
    { ...builtinAppearance, shapes: [...builtinAppearance.shapes, { id: 'builtin:new-shape', label: '新形态', tokens: {} }],
      layouts: [...builtinAppearance.layouts, { id: 'builtin:new', label: '新布局', structure: 'islands', surface: 'flat' }] });
  host.sync('one', [{ manifest: custom, enabled: true }]); host.select({ workspaceId: 'one', kind: 'preset', id: 'sample:new' });
  expect(host.state.value.active.layout).toBe('builtin:new'); expect(host.state.value.active.color).toBe('sample:ink'); host.dispose();
});
it('uses only explicitly configured presets from the injected catalog without inferring shape', () => {
  const controller = new AppearanceController(new FileIconRegistry(), 'device', undefined, applyAppearance, {
    layouts: [{ id: 'builtin:custom', label: '自定义卡片', structure: 'islands', surface: 'flat' }],
    shapes: [{ id: 'builtin:angular', label: '棱角', tokens: { 'radius-card': '0px' } }],
    presets: [
      { id: 'builtin:custom-set', label: '自定义组合', selected: { layout: 'builtin:custom', shape: 'builtin:angular' } },
      { id: 'builtin:structure-only', label: '仅结构', selected: { layout: 'builtin:custom' } },
    ],
  });
  controller.sync('one', []);
  expect(controller.state.value.presets.map(p => p.id)).toEqual(['builtin:custom-set', 'builtin:structure-only']);
  controller.select({ workspaceId: 'one', kind: 'preset', id: 'builtin:structure-only' });
  expect(controller.state.value.active.shape).toBe('builtin:tano');
  controller.select({ workspaceId: 'one', kind: 'preset', id: 'builtin:custom-set' });
  expect(controller.state.value.active.shape).toBe('builtin:angular');
  expect(document.documentElement.style.getPropertyValue('--radius-card')).toBe('0px');
  expect(controller.state.value.presets[0]?.structure).toBe('islands');
  controller.dispose();
});
it('refreshes inherited preferences from another window without discarding a local override', () => {
  const controller = new AppearanceController(new FileIconRegistry(), 'alice', localStorage); controller.sync('one', []);
  const selected = { ...controller.state.value.selected, shape: 'builtin:crisp' };
  localStorage.setItem('tano.appearance.v2.alice.user', JSON.stringify({ selected, mode: 'dark' }));
  controller.refreshPreferences('tano.appearance.v2.alice.user'); expect(controller.state.value.active.shape).toBe('builtin:crisp');
  controller.select({ workspaceId: 'one', kind: 'scope', id: 'workspace' });
  controller.select({ workspaceId: 'one', kind: 'shape', id: 'builtin:handwritten' });
  for (const mode of ['light', 'system']) {
    localStorage.setItem('tano.appearance.v2.alice.user', JSON.stringify({ selected, mode }));
    controller.refreshPreferences('tano.appearance.v2.alice.user');
    expect(controller.state.value.mode).toBe(mode);
    expect(controller.state.value.active.shape).toBe('builtin:handwritten');
  }
  controller.dispose();
});
const presetManifest: ObjectPluginManifest = { ...manifest, appearance: { ...manifest.appearance!,
  presets: [{ id: 'writing', label: '书写', color: 'ink', icons: 'ink', layout: 'builtin:retro', shape: 'builtin:tano' }] } };
it('applies single-mode themes without changing user preference through workspace overrides, reload and plugin fallback', () => {
  const custom = structuredClone(manifest);
  custom.appearance!.colors!.push({ id: 'day', label: '日光', light: { paper: '#fff9ed' } }, { id: 'night', label: '夜色', dark: { paper: '#17202a' } });
  custom.appearance!.presets = [{ id: 'day', label: '日光', color: 'day' }, { id: 'night', label: '夜色', color: 'night' }];
  const installed = [{ manifest: custom, enabled: true }];
  let controller = new AppearanceController(new FileIconRegistry(), 'alice', localStorage);
  controller.sync('one', installed);
  expect(controller.state.value.presets.find(p => p.id === 'sample:day')?.previews).toEqual([
    { mode: 'light', colors: { '--preview-paper': '#fff9ed' } },
  ]);
  expect(controller.state.value.presets.find(p => p.id === 'builtin:tano')?.previews?.map(preview => preview.mode)).toEqual(['light', 'dark']);
  controller.select({ workspaceId: 'one', kind: 'mode', id: 'dark' });
  controller.select({ workspaceId: 'one', kind: 'color', id: 'sample:ink' });
  const savedUser = localStorage.getItem('tano.appearance.v2.alice.user');
  controller.select({ workspaceId: 'one', kind: 'scope', id: 'workspace' });
  controller.select({ workspaceId: 'one', kind: 'preset', id: 'sample:day' });
  expect(resolvedTheme().mode).toBe('light');
  expect(controller.state.value.mode).toBe('dark');
  controller.select({ workspaceId: 'one', kind: 'mode', id: 'light' }); // Reject stale/forged mode commands while fixed.
  expect(localStorage.getItem('tano.appearance.v2.alice.user')).toBe(savedUser);
  expect(JSON.parse(localStorage.getItem('tano.appearance.v2.alice.workspace.one')!)).not.toHaveProperty('mode');
  controller.sync('two', installed); expect(resolvedTheme().mode).toBe('dark');
  controller.sync('one', installed); expect(resolvedTheme().mode).toBe('light');
  controller.dispose();
  controller = new AppearanceController(new FileIconRegistry(), 'alice', localStorage);
  controller.sync('one', installed); expect(resolvedTheme().mode).toBe('light');
  controller.sync('one', [{ manifest: custom, enabled: false }]);
  expect(controller.state.value.selected.color).toBe('sample:day');
  expect(controller.state.value.active.color).toBe('builtin:tano'); expect(resolvedTheme().mode).toBe('dark');
  controller.sync('one', installed); expect(resolvedTheme().mode).toBe('light');
  controller.select({ workspaceId: 'one', kind: 'preset', id: 'sample:night' });
  expect(resolvedTheme().mode).toBe('dark');
  expect(controller.state.value.presets.find(p => p.id === 'sample:night')?.previews).toEqual([
    { mode: 'dark', colors: { '--preview-paper': '#17202a' } },
  ]);
  localStorage.setItem('tano.appearance.v2.alice.user', JSON.stringify({ ...JSON.parse(savedUser!), mode: 'light' }));
  controller.refreshPreferences('tano.appearance.v2.alice.user');
  expect(controller.state.value.mode).toBe('light'); expect(resolvedTheme().mode).toBe('dark');
  controller.select({ workspaceId: 'one', kind: 'color', id: 'sample:ink' });
  expect(resolvedTheme().mode).toBe('light');
  controller.dispose();
});
it('applies all preset choices with one save and repaint, supports customization and preserves mode', () => {
  const storage = { getItem: vi.fn(), setItem: vi.fn() }, apply = vi.fn(applyAppearance);
  const registry = new FileIconRegistry(), controller = new AppearanceController(registry, 'alice', storage, apply);
  controller.sync('one', [{ manifest: presetManifest, enabled: true }]);
  controller.select({ workspaceId: 'one', kind: 'mode', id: 'dark' }); apply.mockClear(); storage.setItem.mockClear();
  controller.select({ workspaceId: 'one', kind: 'preset', id: 'sample:writing' });
  expect(storage.setItem).toHaveBeenCalledOnce(); expect(apply).toHaveBeenCalledOnce();
  expect(controller.state.value.active).toEqual({ color: 'sample:ink', icons: 'sample:ink', layout: 'builtin:retro', shape: 'builtin:tano' });
  expect(controller.state.value.presetId).toBe('sample:writing');
  expect(registry.resolve({ path: 'x.md' }).id).toBe('note');
  expect(resolvedTheme().mode).toBe('dark');
  controller.select({ workspaceId: 'one', kind: 'icons', id: 'builtin:tano' });
  expect(controller.state.value.presetId).toBeUndefined();
  controller.select({ workspaceId: 'one', kind: 'preset', id: 'sample:writing' });
  expect(controller.state.value.presetId).toBe('sample:writing');
  controller.select({ workspaceId: 'one', kind: 'preset', id: 'builtin:tano' });
  expect(controller.state.value.active).toEqual({ color: 'builtin:tano', icons: 'builtin:tano', layout: 'builtin:tano', shape: 'builtin:tano' });
  expect(controller.state.value.presetId).toBe('builtin:tano'); controller.dispose();
});
it('persists choices across reload, restores disabled presets and never reapplies changed recommendations', () => {
  const installed = [{ manifest: presetManifest, enabled: true }];
  let controller = new AppearanceController(new FileIconRegistry(), 'alice', localStorage);
  controller.sync('one', installed);
  controller.select({ workspaceId: 'one', kind: 'preset', id: 'sample:writing' });
  const selected = { ...controller.state.value.selected }; controller.dispose();
  controller = new AppearanceController(new FileIconRegistry(), 'alice', localStorage);
  controller.sync('one', installed); expect(controller.state.value.presetId).toBe('sample:writing');
  controller.sync('two', installed);
  controller.select({ workspaceId: 'one', kind: 'preset', id: 'sample:writing' });
  expect(controller.state.value.presetId).toBe('sample:writing');
  controller.sync('one', [{ manifest: presetManifest, enabled: false }]);
  expect(controller.state.value.active.color).toBe('builtin:tano'); expect(controller.state.value.presetId).toBeUndefined();
  controller.select({ workspaceId: 'one', kind: 'preset', id: 'sample:writing' });
  expect(controller.state.value.selected).toEqual(selected);
  controller.sync('one', installed); expect(controller.state.value.presetId).toBe('sample:writing');
  const updated = structuredClone(presetManifest); updated.appearance!.presets![0]!.layout = 'builtin:paper';
  controller.sync('one', [{ manifest: updated, enabled: true }]);
  expect(controller.state.value.selected).toEqual(selected); expect(controller.state.value.presetId).toBeUndefined();
  controller.select({ workspaceId: 'one', kind: 'preset', id: 'sample:writing' });
  expect(controller.state.value.active.layout).toBe('builtin:paper'); controller.dispose();
});
it('persists recent presets with one selection write and isolates account and workspace history', () => {
  let controller = new AppearanceController(new FileIconRegistry(), 'alice', localStorage);
  controller.sync('one', []);
  controller.select({ workspaceId: 'one', kind: 'preset', id: 'builtin:islands' });
  controller.select({ workspaceId: 'one', kind: 'preset', id: 'builtin:retro' });
  expect(controller.state.value.recentPresetIds).toEqual(['builtin:retro', 'builtin:islands', 'builtin:tano']);
  controller.dispose();
  controller = new AppearanceController(new FileIconRegistry(), 'alice', localStorage);
  controller.sync('one', []);
  expect(controller.state.value.recentPresetIds).toEqual(['builtin:retro', 'builtin:islands', 'builtin:tano']);
  controller.select({ workspaceId: 'one', kind: 'mode', id: 'dark' });
  expect(controller.state.value.recentPresetIds).toEqual(['builtin:retro', 'builtin:islands', 'builtin:tano']);
  controller.select({ workspaceId: 'one', kind: 'scope', id: 'workspace' });
  controller.select({ workspaceId: 'one', kind: 'preset', id: 'builtin:paper' });
  expect(controller.state.value.recentPresetIds?.[0]).toBe('builtin:paper');
  controller.sync('two', []);
  expect(controller.state.value.recentPresetIds?.[0]).toBe('builtin:retro');
  controller.sync('one', []);
  expect(controller.state.value.recentPresetIds?.[0]).toBe('builtin:paper');
  controller.select({ workspaceId: 'one', kind: 'scope', id: 'user' });
  expect(controller.state.value.recentPresetIds?.[0]).toBe('builtin:retro');
  controller.dispose();
  controller = new AppearanceController(new FileIconRegistry(), 'bob', localStorage);
  controller.sync('one', []);
  expect(controller.state.value.recentPresetIds).toBeUndefined();
  controller.select({ workspaceId: 'one', kind: 'scope', id: 'workspace' });
  controller.select({ workspaceId: 'one', kind: 'preset', id: 'builtin:islands' });
  expect(controller.state.value.recentPresetIds?.[0]).toBe('builtin:islands');
  controller.select({ workspaceId: 'one', kind: 'scope', id: 'user' });
  expect(controller.state.value.recentPresetIds).toBeUndefined();
  controller.dispose();
});
it('restores an unavailable plugin layout after re-enable and clears it on disposal', () => {
  const layoutPlugin: ObjectPluginManifest = { ...manifest, appearance: { version: 2, layouts: [{ id: 'sheet', label: '纸张', structure: 'document', surface: 'paper', pageWidth: 800 }] } };
  const controller = new AppearanceController(new FileIconRegistry());
  controller.sync('one', [{ manifest: layoutPlugin, enabled: true }]);
  controller.select({ workspaceId: 'one', kind: 'layout', id: 'sample:sheet' });
  expect(document.documentElement.style.getPropertyValue('--layout-page-width')).toBe('800px');
  controller.sync('one', [{ manifest: layoutPlugin, enabled: false }]);
  expect(controller.state.value.active.layout).toBe('builtin:tano');
  expect(controller.state.value.selected.layout).toBe('sample:sheet');
  controller.sync('one', [{ manifest: layoutPlugin, enabled: true }]);
  expect(document.documentElement.dataset.surface).toBe('paper');
  controller.dispose();
  expect(resolvedTheme().layout).toBeUndefined();
  expect(document.documentElement.dataset.layout).toBe('continuous');
});
it('keeps color and icons independent, restores fallback on disable/uninstall, and restores selection on re-enable', () => {
  const registry = new FileIconRegistry(), controller = new AppearanceController(registry, 'alice', localStorage);
  controller.sync('one', [{ manifest, enabled: true }]);
  expect(controller.state.value.active).toEqual({ color: 'builtin:tano', icons: 'builtin:tano', layout: 'builtin:tano', shape: 'builtin:tano' });
  controller.select({ workspaceId: 'one', kind: 'icons', id: 'sample:ink' });
  expect(controller.state.value.active.color).toBe('builtin:tano');
  expect(registry.resolve({ path: 'x.md' }).id).toBe('note');
  expect(registry.resolve({ path: 'x.pdf' }).id).toBe('pdf');
  controller.select({ workspaceId: 'one', kind: 'color', id: 'sample:ink' });
  applyTheme('light'); expect(document.documentElement.style.getPropertyValue('--paper')).toBe('#fff');
  applyTheme('dark'); expect(document.documentElement.style.getPropertyValue('--paper')).toBe('#123');
  expect(document.documentElement.style.getPropertyValue('--radius-card')).toBe('');
  for (const installed of [[{ manifest, enabled: false }], []]) {
    controller.sync('one', installed);
    expect(controller.state.value.active).toEqual({ color: 'builtin:tano', icons: 'builtin:tano', layout: 'builtin:tano', shape: 'builtin:tano' });
    expect(controller.state.value.selected.color).toBe('sample:ink');
    expect(document.documentElement.style.getPropertyValue('--paper')).toBe('');
    controller.sync('one', [{ manifest, enabled: true }]);
    expect(controller.state.value.active.color).toBe('sample:ink');
  }
  controller.dispose(); expect(registry.resolve({ path: 'x.md' }).id).toBe('markdown');
});
it('isolates workspace/account choices, rejects stale settings commands, and persists reloads', () => {
  const registry = new FileIconRegistry(), controller = new AppearanceController(registry, 'alice', localStorage);
  const installed = [{ manifest, enabled: true }];
  controller.sync('one', installed); controller.select({ workspaceId: 'one', kind: 'scope', id: 'workspace' }); controller.select({ workspaceId: 'one', kind: 'color', id: 'sample:ink' });
  controller.sync('two', installed);
  controller.select({ workspaceId: 'one', kind: 'icons', id: 'sample:ink' });
  expect(controller.state.value.active).toEqual({ color: 'builtin:tano', icons: 'builtin:tano', layout: 'builtin:tano', shape: 'builtin:tano' });
  controller.sync('one', installed); expect(controller.state.value.active.color).toBe('sample:ink');
  controller.dispose();
  const reload = new AppearanceController(registry, 'alice', localStorage); reload.sync('one', installed);
  expect(reload.state.value.active.color).toBe('sample:ink'); reload.dispose();
  const bob = new AppearanceController(registry, 'bob', localStorage); bob.sync('one', installed);
  expect(bob.state.value.active.color).toBe('builtin:tano'); bob.dispose();
});
it('handles malformed contributions, removed themes in updates, and blocked storage without breaking the workbench', () => {
  const storage = { getItem() { throw Error(); }, setItem() { throw Error(); } };
  const controller = new AppearanceController(new FileIconRegistry(), 'alice', storage);
  controller.sync('one', [{ manifest, enabled: true }]); controller.select({ workspaceId: 'one', kind: 'color', id: 'sample:ink' });
  const invalid = { ...manifest, appearance: { ...manifest.appearance!, version: 9 } } as unknown as ObjectPluginManifest;
  controller.sync('one', [{ manifest: invalid, enabled: true }]);
  expect(controller.state.value.errors).toHaveLength(1); expect(controller.state.value.active.color).toBe('builtin:tano');
  controller.sync('two', []); controller.sync('one', [{ manifest, enabled: true }]);
  expect(controller.state.value.active.color).toBe('sample:ink');
  controller.sync('one', [{ manifest: { ...manifest, appearance: undefined }, enabled: true }]);
  expect(controller.state.value.active.color).toBe('builtin:tano'); controller.dispose();
});
it('requires authorization for theme contributions bundled with executable plugins', () => {
  const controller = new AppearanceController(new FileIconRegistry());
  const executable = { ...manifest, manifestVersion: 2 as const, apiVersion: 1 as const, permissions: [], commands: [], views: [], networkOrigins: [], nativeCommands: [] };
  controller.sync('one', [{ manifest: executable, enabled: true, authorized: true }]);
  controller.select({ workspaceId: 'one', kind: 'color', id: 'sample:ink' });
  controller.sync('one', [{ manifest: executable, enabled: true, authorized: false }]);
  expect(controller.state.value.active.color).toBe('builtin:tano'); controller.dispose();
});
it('resolves system changes with selected theme tokens', () => {
  const controller = new AppearanceController(new FileIconRegistry());
  controller.sync('one', [{ manifest, enabled: true }]); controller.select({ workspaceId: 'one', kind: 'color', id: 'sample:ink' });
  vi.stubGlobal('matchMedia', () => ({ matches: true })); applyTheme('system');
  expect(resolvedTheme().mode).toBe('dark'); expect(resolvedTheme().tokens.paper).toBe('#123');
  vi.stubGlobal('matchMedia', () => ({ matches: false })); applyTheme('system');
  expect(resolvedTheme().tokens.paper).toBe('#fff'); controller.dispose();
});
it('round-trips actual workspace install, disable and uninstall through portable plugin policy', async () => {
  const adapter = new DemoAdapter({ files: {} }); const workspace = await adapter.open();
  const host = new WorkspacePluginHost(new ObjectTypeRegistry(), localStorage);
  const controller = new AppearanceController(new FileIconRegistry(), 'device', localStorage);
  const refresh = async () => controller.sync(workspace.id, await host.loadWorkspace(adapter, await adapter.refresh()));
  await refresh();
  await host.changeWorkspace(adapter, workspace, { install: manifest, package: { packageVersion: 1, manifest } }, () => {}); await refresh();
  controller.select({ workspaceId: workspace.id, kind: 'color', id: 'sample:ink' }); expect(controller.state.value.active.color).toBe('sample:ink');
  await host.changeWorkspace(adapter, await adapter.refresh(), { id: manifest.id, enabled: false }, () => {}); await refresh();
  expect(controller.state.value.active.color).toBe('builtin:tano');
  await host.changeWorkspace(adapter, await adapter.refresh(), { id: manifest.id, enabled: true }, () => {}); await refresh();
  expect(controller.state.value.active.color).toBe('sample:ink');
  await host.changeWorkspace(adapter, await adapter.refresh(), { uninstall: manifest.id }, () => {}); await refresh();
  expect(controller.state.value.colors.filter(item => !item.id.startsWith('builtin:'))).toEqual([]); expect(controller.state.value.active.color).toBe('builtin:tano');
  controller.dispose(); host.dispose();
});

it('does not re-register or repaint themes on unrelated workspace refreshes', () => {
  const registry = new FileIconRegistry(), apply = vi.fn();
  const register = vi.spyOn(registry, 'register');
  const controller = new AppearanceController(registry, 'device', undefined, apply);
  controller.sync('one', [{ manifest, enabled: true }]);
  controller.select({ workspaceId: 'one', kind: 'color', id: 'sample:ink' });
  register.mockClear(); apply.mockClear();
  controller.sync('one', [{ manifest: structuredClone(manifest), enabled: true }]);
  expect(register).not.toHaveBeenCalled(); expect(apply).not.toHaveBeenCalled();
  expect(controller.state.value.active.color).toBe('sample:ink'); controller.dispose();
});
