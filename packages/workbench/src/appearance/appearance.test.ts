// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import type { ObjectPluginManifest } from '@tano/protocol';
import { AppearanceController, builtinAppearance, glassMaterials, paperMaterial, raisedCardMaterial } from './appearance';
import { FileIconRegistry } from '../file-icons/registry';
import { applyAppearance, applyTheme, readThemePreference, resolvedTheme } from './theme';
import { WorkspacePluginHost } from '../plugins/workspace-plugins';
import { ObjectTypeRegistry } from '@tano/protocol';
import { DemoAdapter } from '../workspace/adapter';

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
  expect(controller.state.value.active).toEqual({ color: 'sample:ink', icons: 'sample:ink', layout: 'builtin:islands', material: 'builtin:tano', shape: 'builtin:crisp' });
  expect(getComputedStyle(document.documentElement).getPropertyValue('--radius-card').trim()).toBe('0px');
  controller.select({ workspaceId: 'one', kind: 'color', id: 'builtin:tano' });
  expect(getComputedStyle(document.documentElement).getPropertyValue('--radius-card').trim()).toBe('0px');
  controller.select({ workspaceId: 'one', kind: 'shape', id: 'builtin:tano' });
  expect(getComputedStyle(document.documentElement).getPropertyValue('--radius-card').trim()).toBe(''); controller.dispose();
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
    enabled: true, selected: { color: 'builtin:tano', icons: 'builtin:tano', layout: 'builtin:tano', material: 'builtin:tano', shape: 'builtin:tano' },
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
  expect(getComputedStyle(document.documentElement).getPropertyValue('--radius-card').trim()).toBe('0px');
  expect(controller.state.value.presets[0]?.structure).toBe('islands');
  controller.dispose();
});
it('treats frosted glass as a material that combines freely with every layout and palette', () => {
  const root = document.documentElement;
  const controller = new AppearanceController(new FileIconRegistry(), 'device', undefined, applyAppearance); controller.sync('one', []);
  expect(controller.state.value.layouts.map(layout => ({ id: layout.id, label: layout.label }))).toEqual([
    { id: 'builtin:inset', label: '留边布局' },
    { id: 'builtin:islands', label: '卡片岛' },
    { id: 'builtin:paper', label: '纸页布局' },
  ]);
  expect(controller.state.value.materials).toEqual([
    { id: 'builtin:raised', label: '立体卡片' },
    { id: 'builtin:paper', label: '纸纹' },
    { id: 'builtin:frost', label: '磨砂玻璃' },
    { id: 'builtin:liquid', label: '液态玻璃' },
  ]);
  const preset = controller.state.value.presets.find(p => p.id === 'builtin:frost');
  expect(preset).toMatchObject({ unavailable: false, structure: 'islands', material: 'frost',
    selected: { color: 'builtin:haze', layout: 'builtin:islands', material: 'builtin:frost' } });
  expect(controller.state.value.presets.find(p => p.id === 'builtin:islands')?.material).toBeUndefined();
  controller.select({ workspaceId: 'one', kind: 'preset', id: 'builtin:frost' });
  expect([root.dataset.layout, root.dataset.surface, root.dataset.material]).toEqual(['islands', 'flat', 'builtin:frost']);
  expect(controller.state.value.currentPreset).toMatchObject({ id: 'builtin:frost', material: 'frost' });
  // Any palette, any structure: nothing else changes when one slot changes.
  controller.select({ workspaceId: 'one', kind: 'color', id: 'builtin:ink' });
  controller.select({ workspaceId: 'one', kind: 'layout', id: 'builtin:paper' });
  expect(controller.state.value.active).toMatchObject({ color: 'builtin:ink', layout: 'builtin:paper', material: 'builtin:frost' });
  expect([root.dataset.layout, root.dataset.material]).toEqual(['document', 'builtin:frost']);
  controller.select({ workspaceId: 'one', kind: 'layout', id: 'builtin:tano' });
  expect([root.dataset.layout, root.dataset.material]).toEqual(['continuous', 'builtin:frost']);
  expect(controller.state.value.currentPreset).toMatchObject({ id: 'current', structure: 'continuous', material: 'frost' });
  controller.select({ workspaceId: 'one', kind: 'material', id: 'builtin:tano' });
  expect(controller.state.value.selected.layout).toBe('builtin:tano');
  expect(root.dataset.material).toBeUndefined();
  // The card-island preset brings a flat material back explicitly.
  controller.select({ workspaceId: 'one', kind: 'material', id: 'builtin:frost' });
  controller.select({ workspaceId: 'one', kind: 'preset', id: 'builtin:islands' });
  expect(controller.state.value.active.material).toBe('builtin:tano');
  expect(controller.state.value.presetId).toBe('builtin:islands');
  controller.select({ workspaceId: 'one', kind: 'material', id: 'plugin:unknown' });
  expect(controller.state.value.active.material).toBe('builtin:tano');
  controller.dispose();
  expect(root.dataset.material).toBeUndefined();
});
it('offers liquid glass as a second glass material with its own preset and preview', () => {
  const root = document.documentElement;
  const controller = new AppearanceController(new FileIconRegistry(), 'device', undefined, applyAppearance); controller.sync('one', []);
  expect(controller.state.value.presets.find(p => p.id === 'builtin:liquid')).toMatchObject({ unavailable: false, structure: 'islands', material: 'liquid',
    selected: { color: 'builtin:haze', layout: 'builtin:islands', material: 'builtin:liquid' } });
  controller.select({ workspaceId: 'one', kind: 'preset', id: 'builtin:liquid' });
  expect(root.dataset.material).toBe('builtin:liquid');
  expect(controller.state.value.currentPreset).toMatchObject({ id: 'builtin:liquid', material: 'liquid' });
  // Switching between the two glass materials keeps every other slot.
  controller.select({ workspaceId: 'one', kind: 'material', id: 'builtin:frost' });
  expect(controller.state.value.presetId).toBe('builtin:frost');
  controller.select({ workspaceId: 'one', kind: 'layout', id: 'builtin:paper' });
  controller.select({ workspaceId: 'one', kind: 'material', id: 'builtin:liquid' });
  expect(controller.state.value.active).toMatchObject({ layout: 'builtin:paper', material: 'builtin:liquid' });
  expect(controller.state.value.currentPreset).toMatchObject({ id: 'current', structure: 'document', material: 'liquid' });
  controller.dispose();
  expect(root.dataset.material).toBeUndefined();
});
it('offers raised card and paper grain as non-glass materials that preview and persist across layouts', () => {
  const root = document.documentElement;
  expect(glassMaterials).not.toContain(raisedCardMaterial);
  expect(glassMaterials).not.toContain(paperMaterial);
  const controller = new AppearanceController(new FileIconRegistry(), 'device', localStorage, applyAppearance);
  controller.sync('one', []);
  expect(controller.state.value.presets.find(p => p.id === 'builtin:paper')).toMatchObject({
    unavailable: false,
    structure: 'document',
    material: 'paper',
    selected: { color: 'builtin:ink', layout: 'builtin:paper', material: paperMaterial, shape: 'builtin:print' },
  });
  controller.select({ workspaceId: 'one', kind: 'layout', id: 'builtin:islands' });
  controller.select({ workspaceId: 'one', kind: 'material', id: paperMaterial });
  expect([root.dataset.layout, root.dataset.material]).toEqual(['islands', 'builtin:paper']);
  expect(controller.state.value.currentPreset).toMatchObject({ id: 'current', structure: 'islands', material: 'paper' });
  controller.select({ workspaceId: 'one', kind: 'material', id: raisedCardMaterial });
  expect([root.dataset.layout, root.dataset.material]).toEqual(['islands', 'builtin:raised']);
  expect(controller.state.value.currentPreset).toMatchObject({ id: 'current', structure: 'islands', material: 'raised' });
  controller.select({ workspaceId: 'one', kind: 'save-preset' });
  const savedId = controller.state.value.presetId!;
  expect(controller.state.value.presets.find(p => p.id === savedId)).toMatchObject({ material: 'raised', structure: 'islands' });
  controller.select({ workspaceId: 'one', kind: 'layout', id: 'builtin:tano' });
  expect([root.dataset.layout, root.dataset.material]).toEqual(['continuous', 'builtin:raised']);
  expect(controller.state.value.currentPreset).toMatchObject({ structure: 'continuous', material: 'raised' });
  controller.dispose();
  const reload = new AppearanceController(new FileIconRegistry(), 'device', localStorage, applyAppearance);
  reload.sync('one', []);
  expect(reload.state.value.active.material).toBe('builtin:raised');
  expect(root.dataset.material).toBe('builtin:raised');
  reload.dispose();
  expect(root.dataset.material).toBeUndefined();
});
it('provides shadow gray (builtin:shade) as a dual-mode neutral palette with recessed desk contrast', () => {
  const shade = builtinAppearance.colors?.find(color => color.id === 'builtin:shade');
  expect(shade).toMatchObject({ id: 'builtin:shade', label: '影灰' });
  expect(shade?.light.sidebar).toBe('#e8e7e4');
  expect(shade?.light.paper).toBe('#ffffff');
  expect(shade?.dark.sidebar).toBe('#131312');
  expect(shade?.dark.paper).toBe('#20201f');
  const controller = new AppearanceController(new FileIconRegistry(), 'device', localStorage, applyAppearance);
  controller.sync('one', []);
  controller.select({ workspaceId: 'one', kind: 'color', id: 'builtin:shade' });
  controller.select({ workspaceId: 'one', kind: 'material', id: raisedCardMaterial });
  expect(document.documentElement.dataset.colorTheme).toBe('builtin:shade');
  expect(document.documentElement.dataset.material).toBe('builtin:raised');
  expect(controller.state.value.colors.find(color => color.id === 'builtin:shade')?.label).toBe('影灰');
  controller.dispose();
});
it('reads older saved choices without a material as flat', () => {
  localStorage.setItem('tano.appearance.v2.carol.user', JSON.stringify({ selected: { color: 'builtin:mist', icons: 'builtin:tano', layout: 'builtin:islands', shape: 'builtin:rounded' }, mode: 'light' }));
  const controller = new AppearanceController(new FileIconRegistry(), 'carol', localStorage); controller.sync('one', []);
  expect(controller.state.value.selected.material).toBe('builtin:tano');
  expect(controller.state.value.presetId).toBe('builtin:islands');
  controller.dispose(); localStorage.clear();
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
  presets: [{ id: 'writing', label: '书写', color: 'ink', icons: 'ink', layout: 'builtin:islands', shape: 'builtin:tano' }] } };
it('saves a complete preset from a partial match and keeps other windows’ saves and plugin requirements', () => {
  const installed = [{ manifest: presetManifest, enabled: true }];
  const aliceWindow = () => new AppearanceController(new FileIconRegistry(), 'alice', localStorage, vi.fn());
  const first = aliceWindow(), second = aliceWindow();
  first.sync('one', installed);
  second.sync('two', []);
  first.select({ workspaceId: 'one', kind: 'scope', id: 'workspace' });
  first.select({ workspaceId: 'one', kind: 'preset', id: 'sample:writing' });
  first.select({ workspaceId: 'one', kind: 'material', id: 'builtin:frost' });
  expect(first.state.value.presetId).toBe('sample:writing');
  const selected = first.state.value.active;
  first.select({ workspaceId: 'one', kind: 'save-preset' });
  const id = first.state.value.presetId!;
  expect(first.state.value.currentPreset).toMatchObject({ customNumber: 1, selected });
  expect(first.state.value.canSavePreset).toBe(false);
  first.select({ workspaceId: 'one', kind: 'save-preset' });
  expect(first.state.value.presets.filter(preset => preset.customNumber)).toHaveLength(1);

  // This window has yet to receive the first window’s storage event.
  second.select({ workspaceId: 'two', kind: 'shape', id: 'builtin:crisp' });
  second.select({ workspaceId: 'two', kind: 'save-preset' });
  expect(second.state.value.presets.find(preset => preset.id === id)?.unavailable).toBe(true);
  const key = `tano.appearance.v2.alice.user.preset.${second.state.value.presetId}`;
  first.refreshPreferences(key);
  expect(first.state.value.presets.filter(preset => preset.customNumber)).toHaveLength(2);
  expect(first.state.value.scope).toBe('workspace');
  expect(first.state.value.active).toEqual(selected);

  const reopened = aliceWindow();
  reopened.sync('one', installed);
  reopened.select({ workspaceId: 'one', kind: 'preset', id: 'builtin:tano' });
  reopened.select({ workspaceId: 'one', kind: 'preset', id });
  expect(reopened.state.value.active).toEqual(selected);
  expect(reopened.state.value.currentPreset?.id).toBe(id);

  // The window without the required plugin can still remove the saved preset.
  second.select({ workspaceId: 'two', kind: 'remove-preset', id });
  const removedKey = `tano.appearance.v2.alice.user.preset.${id}`;
  expect(localStorage.getItem(removedKey)).toBeNull();
  first.refreshPreferences(removedKey);
  expect(first.state.value.presets.some(preset => preset.id === id)).toBe(false);
  expect(first.state.value.presets.some(preset => preset.id === second.state.value.presetId)).toBe(true);
  expect(first.state.value.active).toEqual(selected);
  expect(first.state.value.canSavePreset).toBe(true);
  for (const controller of [first, second, reopened]) controller.dispose();
});
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
  expect(controller.state.value.active).toEqual({ color: 'sample:ink', icons: 'sample:ink', layout: 'builtin:islands', material: 'builtin:tano', shape: 'builtin:tano' });
  expect(controller.state.value.presetId).toBe('sample:writing');
  expect(registry.resolve({ path: 'x.md' }).id).toBe('note');
  expect(resolvedTheme().mode).toBe('dark');
  controller.select({ workspaceId: 'one', kind: 'icons', id: 'builtin:tano' });
  expect(controller.state.value.presetId).toBeUndefined();
  controller.select({ workspaceId: 'one', kind: 'preset', id: 'sample:writing' });
  expect(controller.state.value.presetId).toBe('sample:writing');
  controller.select({ workspaceId: 'one', kind: 'preset', id: 'builtin:tano' });
  expect(controller.state.value.active).toEqual({ color: 'builtin:tano', icons: 'builtin:tano', layout: 'builtin:tano', material: 'builtin:tano', shape: 'builtin:tano' });
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
  controller.select({ workspaceId: 'one', kind: 'preset', id: 'builtin:paper' });
  controller.select({ workspaceId: 'one', kind: 'preset', id: 'builtin:islands' });
  expect(controller.state.value.recentPresetIds).toEqual(['builtin:islands', 'builtin:paper', 'builtin:tano']);
  controller.dispose();
  controller = new AppearanceController(new FileIconRegistry(), 'alice', localStorage);
  controller.sync('one', []);
  expect(controller.state.value.recentPresetIds).toEqual(['builtin:islands', 'builtin:paper', 'builtin:tano']);
  controller.select({ workspaceId: 'one', kind: 'mode', id: 'dark' });
  expect(controller.state.value.recentPresetIds).toEqual(['builtin:islands', 'builtin:paper', 'builtin:tano']);
  controller.select({ workspaceId: 'one', kind: 'scope', id: 'workspace' });
  controller.select({ workspaceId: 'one', kind: 'preset', id: 'builtin:paper' });
  expect(controller.state.value.recentPresetIds?.[0]).toBe('builtin:paper');
  controller.sync('two', []);
  expect(controller.state.value.recentPresetIds?.[0]).toBe('builtin:islands');
  controller.sync('one', []);
  expect(controller.state.value.recentPresetIds?.[0]).toBe('builtin:paper');
  controller.select({ workspaceId: 'one', kind: 'scope', id: 'user' });
  expect(controller.state.value.recentPresetIds?.[0]).toBe('builtin:islands');
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
  expect(controller.state.value.active).toEqual({ color: 'builtin:tano', icons: 'builtin:tano', layout: 'builtin:tano', material: 'builtin:tano', shape: 'builtin:tano' });
  controller.select({ workspaceId: 'one', kind: 'icons', id: 'sample:ink' });
  expect(controller.state.value.active.color).toBe('builtin:tano');
  expect(registry.resolve({ path: 'x.md' }).id).toBe('note');
  expect(registry.resolve({ path: 'x.pdf' }).id).toBe('pdf');
  controller.select({ workspaceId: 'one', kind: 'color', id: 'sample:ink' });
  applyTheme('light'); expect(getComputedStyle(document.documentElement).getPropertyValue('--paper').trim()).toBe('#fff');
  applyTheme('dark'); expect(getComputedStyle(document.documentElement).getPropertyValue('--paper').trim()).toBe('#123');
  expect(getComputedStyle(document.documentElement).getPropertyValue('--radius-card').trim()).toBe('');
  for (const installed of [[{ manifest, enabled: false }], []]) {
    controller.sync('one', installed);
    expect(controller.state.value.active).toEqual({ color: 'builtin:tano', icons: 'builtin:tano', layout: 'builtin:tano', material: 'builtin:tano', shape: 'builtin:tano' });
    expect(controller.state.value.selected.color).toBe('sample:ink');
    expect(getComputedStyle(document.documentElement).getPropertyValue('--paper').trim()).toBe('');
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
  expect(controller.state.value.active).toEqual({ color: 'builtin:tano', icons: 'builtin:tano', layout: 'builtin:tano', material: 'builtin:tano', shape: 'builtin:tano' });
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
