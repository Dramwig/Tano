import { shallowRef } from 'vue';
import { parsePluginAppearance, type ColorThemeDefinition, type LayoutThemeDefinition, type ShapeThemeDefinition } from '@tano/protocol';
import { builtinColors } from './builtin-colors';
import { FileIconRegistry } from '../file-icons/registry';
import { applyAppearance, fixedColorMode, parseThemePreference, type ThemePreference } from './theme';
import type { InstalledObjectPlugin } from '../plugins/workspace-plugins';

export const appearanceKinds = ['color', 'icons', 'layout', 'material', 'shape'] as const;
/** Kinds a theme plugin may set. Materials are drawn by the host, so plugins cannot contribute or reference them. */
const pluginPresetKinds = ['color', 'icons', 'layout', 'shape'] as const;
/** Raised card: flat opaque surfaces with sculpted bevels and dimensional edges. */
export const raisedCardMaterial = 'builtin:raised';
/** The frosted-glass material turns the sidebar and page sheets of any layout into translucent glass. */
export const glassMaterial = 'builtin:frost';
/** Liquid glass: the same layers, but clear glass whose thick edges catch the light. */
export const liquidGlassMaterial = 'builtin:liquid';
/** Glass materials share the desk, the background image and the layer structure. */
export const glassMaterials: readonly string[] = [glassMaterial, liquidGlassMaterial];
const materialSurface: Record<string, NonNullable<AppearancePreset['material']>> = {
  [raisedCardMaterial]: 'raised',
  [glassMaterial]: 'frost',
  [liquidGlassMaterial]: 'liquid',
};
export type AppearanceKind = typeof appearanceKinds[number];
export const builtinDefault = 'builtin:tano';
export const insetLayout = 'builtin:inset';
const cardIslandsLayout = { structure: 'islands', surface: 'flat', gap: 16, pageWidth: 960 } as const;
export const builtinAppearance: AppearanceBuiltins = {
  layouts: [
    { id: insetLayout, label: '留边布局', ...cardIslandsLayout },
    { id: 'builtin:islands', label: '卡片岛', ...cardIslandsLayout },
    { id: 'builtin:paper', label: '纸感', structure: 'document', surface: 'paper', gap: 24, pageWidth: 800 },
  ],
  colors: builtinColors,
  materials: [
    { id: raisedCardMaterial, label: '立体卡片' },
    { id: glassMaterial, label: '磨砂玻璃' },
    { id: liquidGlassMaterial, label: '液态玻璃' },
  ],
  shapes: [
    { id: 'builtin:rounded', label: '圆润宽松', tokens: { 'radius-control': '10px', 'radius-card': '16px', 'radius-dialog': '20px', 'space-panel': '22px', 'space-row-gap': '6px',
      'overlay-shadow': '0px 1px 2px #1b263a14, 0px 8px 24px #1b263a14', 'dialog-shadow': '0px 24px 64px #1b263a33' } },
    { id: 'builtin:handwritten', label: '柔和圆角', tokens: { 'radius-control': '6px', 'radius-card': '6px', 'radius-dialog': '10px',
      'overlay-shadow': '0px 2px 4px #3a2b1f22, 0px 10px 24px #3a2b1f33', 'dialog-shadow': '0px 20px 56px #3a2b1f55' } },
    { id: 'builtin:print', label: '微圆角', tokens: { 'radius-control': '3px', 'radius-card': '2px', 'radius-dialog': '4px',
      'overlay-shadow': '0px 1px 3px #00000026, 0px 10px 28px #0000001f', 'dialog-shadow': '0px 18px 56px #00000040' } },
    { id: 'builtin:crisp', label: '直角紧凑', tokens: { 'radius-control': '0px', 'radius-card': '0px', 'radius-dialog': '0px', 'space-panel': '12px', 'space-control-y': '4px', 'overlay-shadow': 'none', 'dialog-shadow': 'none' } },
  ],
  presets: [
    { id: builtinDefault, label: '同页默认', selected: { color: builtinDefault, icons: builtinDefault, layout: builtinDefault, material: builtinDefault, shape: builtinDefault } },
    { id: 'builtin:islands', label: '卡片岛', selected: { color: 'builtin:mist', icons: builtinDefault, layout: 'builtin:islands', material: builtinDefault, shape: 'builtin:rounded' } },
    { id: 'builtin:paper', label: '纸感', selected: { color: 'builtin:ink', icons: builtinDefault, layout: 'builtin:paper', material: builtinDefault, shape: 'builtin:print' } },
    { id: 'builtin:frost', label: '磨砂玻璃', selected: { color: 'builtin:haze', icons: builtinDefault, layout: 'builtin:islands', material: glassMaterial, shape: 'builtin:rounded' } },
    { id: 'builtin:liquid', label: '液态玻璃', selected: { color: 'builtin:haze', icons: builtinDefault, layout: 'builtin:islands', material: liquidGlassMaterial, shape: 'builtin:rounded' } },
  ],
};
/** The host owns the catalog. The protocol only validates builtin reference syntax. */
export interface AppearanceBuiltins {
  colors?: readonly ColorThemeDefinition[];
  layouts: readonly LayoutThemeDefinition[];
  shapes: readonly ShapeThemeDefinition[];
  /** Host-drawn card materials besides the default flat one. */
  materials?: readonly AppearanceChoice[];
  presets: readonly Pick<AppearancePreset, 'id' | 'label' | 'selected'>[];
}
export interface AppearanceChoice { id: string; label: string }
export type AppearanceSelection =
  | { workspaceId: string; kind: AppearanceKind | 'preset' | 'remove-preset' | 'scope' | 'mode'; id: string }
  | { workspaceId: string; kind: 'save-preset' };
export interface AppearancePreview {
  mode: 'light' | 'dark';
  colors: Record<string, string>;
}
export interface AppearancePreset extends AppearanceChoice {
  selected: Partial<Record<AppearanceKind, string>>;
  customNumber?: number;
  unavailable?: boolean;
  missing?: { kind: AppearanceKind; id: string }[];
  previews?: AppearancePreview[];
  structure?: LayoutThemeDefinition['structure'];
  /** Set when the preset uses a non-flat material, so the preview can draw it. */
  material?: 'raised' | 'frost' | 'liquid';
}
export interface AppearanceSnapshot {
  workspaceId: string;
  scope: 'user' | 'workspace';
  mode: ThemePreference;
  colors: AppearanceChoice[];
  icons: AppearanceChoice[];
  layouts: LayoutThemeDefinition[];
  shapes: AppearanceChoice[];
  materials: AppearanceChoice[];
  presets: AppearancePreset[];
  presetId?: string;
  currentPreset?: AppearancePreset;
  canSavePreset?: boolean;
  recentPresetIds?: string[];
  selected: Record<AppearanceKind, string>;
  active: Record<AppearanceKind, string>;
  color?: ColorThemeDefinition;
  layout?: LayoutThemeDefinition;
  shape?: ShapeThemeDefinition;
  errors: string[];
}
const defaults = (): Record<AppearanceKind, string> => ({ color: builtinDefault, icons: builtinDefault, layout: builtinDefault, material: builtinDefault, shape: builtinDefault });
const initial = (): AppearanceSnapshot => ({ workspaceId: '', scope: 'user', mode: 'system', colors: [], icons: [], layouts: [], shapes: [], materials: [], presets: [], selected: defaults(), active: defaults(), errors: [] });
interface Preferences { selected: Record<AppearanceKind, string>; mode: ThemePreference; recentPresetIds?: string[] }
interface WorkspacePreferences { selected: Record<AppearanceKind, string>; enabled: boolean; recentPresetIds?: string[] }
type AppearanceStorage = Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'key' | 'length' | 'removeItem'>>;
function readPresetHistory(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0))].slice(0, 12) : [];
}
function readChoices(value: unknown): Record<AppearanceKind, string> | undefined {
  if (!value || typeof value !== 'object') return;
  const input = value as Record<string, unknown>;
  if (typeof input.color !== 'string' || typeof input.icons !== 'string') return;
  return Object.fromEntries(appearanceKinds.map(kind => [kind, typeof input[kind] === 'string' ? input[kind] : builtinDefault])) as Record<AppearanceKind, string>;
}

/** Preferences are user defaults plus an explicit device-local workspace override. */
export class AppearanceController {
  readonly state = shallowRef<AppearanceSnapshot>(initial());
  private disposers: (() => void)[] = [];
  private signature = '';
  private colors = new Map<string, ColorThemeDefinition>();
  private layouts = new Map<string, LayoutThemeDefinition>();
  private shapes = new Map<string, ShapeThemeDefinition>();
  private memory = new Map<string, unknown>();
  constructor(readonly registry: FileIconRegistry, private principal = 'device',
    private storage?: AppearanceStorage,
    private apply = applyAppearance,
    private builtins: AppearanceBuiltins = builtinAppearance) {}

  private get userKey() { return `tano.appearance.v2.${encodeURIComponent(this.principal)}.user`; }
  private get customPresetPrefix() { return `${this.userKey}.preset.`; }
  private workspaceKey(id: string) { return `tano.appearance.v2.${encodeURIComponent(this.principal)}.workspace.${encodeURIComponent(id)}`; }
  private read(key: string): any {
    if (this.memory.has(key)) return this.memory.get(key);
    try { return JSON.parse(this.storage?.getItem(key) ?? 'null'); } catch { return undefined; }
  }
  private write(key: string, value: unknown) {
    this.memory.set(key, value);
    try { this.storage?.setItem(key, JSON.stringify(value)); } catch { /* Session preferences still work. */ }
  }
  private userPreferences(): Preferences {
    const saved = this.read(this.userKey), selected = readChoices(saved?.selected);
    const recentPresetIds = readPresetHistory(saved?.recentPresetIds);
    return { selected: selected ?? defaults(), mode: parseThemePreference(saved?.mode), recentPresetIds: recentPresetIds.length ? recentPresetIds : undefined };
  }
  private preferences(workspaceId: string): Preferences & { scope: 'user' | 'workspace' } {
    const user = this.userPreferences();
    if (!workspaceId) return { ...user, scope: 'user' };
    const key = this.workspaceKey(workspaceId), saved = this.read(key);
    const selected = readChoices(saved?.selected);
    if (saved?.enabled && selected) return { selected, mode: user.mode, scope: 'workspace', recentPresetIds: readPresetHistory(saved?.recentPresetIds) };
    return { ...user, scope: 'user' };
  }
  /** Called by the owning window on preference storage events from another window. */
  refreshPreferences(key: string | null) {
    const refreshPresets = key === null || key.startsWith(this.customPresetPrefix);
    if (!refreshPresets && key !== this.userKey && key !== this.workspaceKey(this.state.value.workspaceId)) return;
    if (key === null) this.memory.clear(); else this.memory.delete(key);
    const next = { ...this.state.value, ...this.preferences(this.state.value.workspaceId) };
    if (refreshPresets) this.loadCustomPresets(next);
    this.activate(next);
  }
  sync(workspaceId: string, installed: readonly InstalledObjectPlugin[]) {
    const signature = JSON.stringify([workspaceId, installed.map(plugin => [plugin.manifest.id,
      plugin.manifest.name, plugin.manifest.manifestVersion, plugin.enabled, plugin.authorized, plugin.manifest.appearance])]);
    if (signature === this.signature) return;
    this.signature = signature;
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
    this.colors = new Map((this.builtins.colors ?? []).map(item => [item.id, item]));
    this.layouts = new Map(this.builtins.layouts.map(item => [item.id, item]));
    this.shapes = new Map(this.builtins.shapes.map(item => [item.id, item]));
    const next: AppearanceSnapshot = { ...initial(), workspaceId, ...this.preferences(workspaceId), colors: (this.builtins.colors ?? []).map(({ id, label }) => ({ id, label })), layouts: [...this.builtins.layouts], shapes: [...this.builtins.shapes],
      materials: [...(this.builtins.materials ?? [])],
      presets: this.builtins.presets.map(preset => ({ ...preset, selected: { ...preset.selected }, ...this.colorPreview(preset.selected.color),
        ...this.layoutPreview(preset.selected) })) };
    if (workspaceId) for (const plugin of installed) {
      if (!plugin.enabled || (plugin.manifest.manifestVersion === 2 && !plugin.authorized) || !plugin.manifest.appearance) continue;
      const disposers: (() => void)[] = [];
      try {
        const contribution = parsePluginAppearance(plugin.manifest.appearance);
        for (const icons of contribution.icons ?? []) disposers.push(this.registry.register({ ...icons, id: `${plugin.manifest.id}:${icons.id}` }));
        const registerChoices = <T extends AppearanceChoice>(items: T[] | undefined, map: Map<string, T>, choices: T[]) => {
          for (const item of items ?? []) {
            const id = `${plugin.manifest.id}:${item.id}`;
            map.set(id, { ...item, id });
            choices.push({ ...item, id, label: `${item.label} · ${plugin.manifest.name}` });
          }
        };
        registerChoices(contribution.colors, this.colors, next.colors);
        registerChoices(contribution.layouts, this.layouts, next.layouts);
        registerChoices(contribution.shapes, this.shapes, next.shapes);
        for (const icons of contribution.icons ?? []) next.icons.push({ id: `${plugin.manifest.id}:${icons.id}`, label: `${icons.label} · ${plugin.manifest.name}` });
        for (const preset of contribution.presets ?? []) {
          const selected: AppearancePreset['selected'] = {};
          for (const kind of pluginPresetKinds) {
            const reference = preset[kind];
            if (reference !== undefined) selected[kind] = reference.startsWith('builtin:') ? reference : `${plugin.manifest.id}:${reference}`;
          }
          next.presets.push({ id: `${plugin.manifest.id}:${preset.id}`, label: `${preset.label} · ${plugin.manifest.name}`, selected,
            ...this.colorPreview(selected.color), ...this.layoutPreview(selected) });
        }
        this.disposers.push(...disposers);
      } catch {
        for (const dispose of disposers) dispose();
        next.errors.push(`${plugin.manifest.name}：主题无法加载，已回退到默认外观。`);
      }
    }
    for (const preset of next.presets) Object.assign(preset, this.presetAvailability(next, preset.selected));
    this.loadCustomPresets(next);
    this.activate(next);
  }
  /** A preset that leaves the layout alone previews no structure; the current combination always has one. */
  private layoutPreview(selected: Partial<Record<AppearanceKind, string>>, current = false): Pick<AppearancePreset, 'structure' | 'material'> {
    const surface = selected.material ? materialSurface[selected.material] : undefined;
    const material = surface ? { material: surface } : {};
    if (!selected.layout && !current) return { structure: undefined, ...material };
    const layout = selected.layout ? this.layouts.get(selected.layout) : undefined;
    return { structure: layout?.structure ?? 'continuous', ...material };
  }
  /** Keep both palettes in light-to-dark order, independent of the active appearance. */
  private colorPreview(id?: string): Pick<AppearancePreset, 'previews'> {
    const color = id === builtinDefault ? { light: {}, dark: {} } : id ? this.colors.get(id) : undefined;
    if (!color) return {};
    return { previews: (['light', 'dark'] as const).flatMap(mode => {
      const tokens = color[mode];
      if (tokens === undefined) return [];
      return [{ mode, colors: Object.fromEntries(['paper', 'surface', 'green', 'text', 'line', 'control-border', 'muted', 'sidebar', 'selected',
        'syntax-blue', 'syntax-purple', 'syntax-teal']
        .flatMap(key => { const value = tokens[key as keyof typeof tokens]; return value ? [[`--preview-${key}`, value]] : []; })) }];
    }) };
  }
  private available(state: AppearanceSnapshot, kind: AppearanceKind, id: string) {
    return id === builtinDefault || (kind === 'color' ? state.colors : kind === 'icons' ? state.icons : kind === 'layout' ? state.layouts
      : kind === 'material' ? state.materials : state.shapes).some(choice => choice.id === id);
  }
  private presetAvailability(state: AppearanceSnapshot, selected: AppearancePreset['selected']) {
    const missing = appearanceKinds.flatMap(kind => {
      const id = selected[kind];
      return id !== undefined && !this.available(state, kind, id) ? [{ kind, id }] : [];
    });
    return { missing, unavailable: missing.length > 0 };
  }
  private loadCustomPresets(state: AppearanceSnapshot) {
    const prefix = this.customPresetPrefix;
    const keys = new Set([...this.memory.keys()].filter(key => key.startsWith(prefix)));
    try {
      const count = this.storage?.length ?? 0;
      for (let index = 0; index < count; index++) {
        const key = this.storage?.key?.(index);
        if (key?.startsWith(prefix)) keys.add(key);
      }
    } catch { /* Session presets are still available. */ }
    const saved = [...keys].flatMap(key => {
      const entry = this.read(key);
      const selected = readChoices(entry?.selected);
      return selected && Number.isFinite(entry.createdAt)
        ? [{ id: key.slice(prefix.length), selected, createdAt: Number(entry.createdAt) }] : [];
    }).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    state.presets = [...state.presets.filter(preset => preset.customNumber === undefined), ...saved.map(({ id, selected }, index) => ({
      id, label: '自定义主题 {0}', customNumber: index + 1, selected,
      ...this.colorPreview(selected.color), ...this.layoutPreview(selected), ...this.presetAvailability(state, selected),
    }))];
  }
  private saveCurrentPreset(state: AppearanceSnapshot) {
    if (!state.canSavePreset) return;
    // Each combination has its own key so settings windows can save independently.
    const id = `custom:theme:${appearanceKinds.map(kind => encodeURIComponent(state.active[kind])).join(':')}`;
    const key = this.customPresetPrefix + id;
    if (!this.read(key)) this.write(key, { selected: { ...state.active }, createdAt: Date.now() });
    const next = { ...state };
    this.loadCustomPresets(next);
    this.activate(next);
  }
  private removeCustomPreset(state: AppearanceSnapshot, id: string) {
    if (!state.presets.some(preset => preset.id === id && preset.customNumber !== undefined)) return;
    const key = this.customPresetPrefix + id;
    try {
      if (this.storage?.removeItem) {
        this.storage.removeItem(key);
        this.memory.delete(key);
      } else {
        this.write(key, null);
      }
    } catch {
      this.memory.set(key, null); // Keep the deletion for this session if storage is unavailable.
    }
    const next = { ...state };
    this.loadCustomPresets(next);
    this.activate(next);
  }
  select(selection: AppearanceSelection) {
    const state = this.state.value;
    if (selection.workspaceId !== state.workspaceId) return;
    if (selection.kind === 'save-preset') {
      this.saveCurrentPreset(state);
      return;
    }
    if (selection.kind === 'remove-preset') {
      this.removeCustomPreset(state, selection.id);
      return;
    }
    if (selection.kind === 'scope') {
      if (!state.workspaceId || !['user', 'workspace'].includes(selection.id)) return;
      const value: WorkspacePreferences = { enabled: selection.id === 'workspace', selected: { ...state.selected },
        ...(state.recentPresetIds?.length ? { recentPresetIds: state.recentPresetIds } : {}) };
      this.write(this.workspaceKey(state.workspaceId), value);
      this.activate({ ...state, ...this.preferences(state.workspaceId) }); return;
    }
    if (selection.kind === 'mode') {
      if (fixedColorMode(state.color)) return;
      if (['light', 'dark', 'system'].includes(selection.id)) {
        const mode = selection.id as ThemePreference;
        this.write(this.userKey, { ...this.userPreferences(), mode });
        this.activate({ ...state, mode });
      }
      return;
    }
    if (selection.kind === 'preset') {
      const preset = state.presets.find(item => item.id === selection.id);
      if (preset && !preset.unavailable) this.saveSelection({ ...state.selected, ...preset.selected }, preset.id);
      return;
    }
    if (!appearanceKinds.includes(selection.kind) || !this.available(state, selection.kind, selection.id)) return;
    this.saveSelection({ ...state.selected, [selection.kind]: selection.id });
  }
  private saveSelection(selected: Record<AppearanceKind, string>, presetId?: string) {
    const state = this.state.value;
    const recentPresetIds = presetId
      ? readPresetHistory([presetId, state.presetId, ...(state.recentPresetIds ?? [])]) : state.recentPresetIds;
    const history = recentPresetIds?.length ? { recentPresetIds } : {};
    this.write(state.scope === 'workspace' ? this.workspaceKey(state.workspaceId) : this.userKey,
      state.scope === 'workspace' ? { selected, enabled: true, ...history } : { selected, mode: this.userPreferences().mode, ...history });
    this.activate({ ...state, selected, recentPresetIds, mode: this.userPreferences().mode });
  }
  private activate(next: AppearanceSnapshot) {
    next.color = this.colors.get(next.selected.color);
    next.layout = this.layouts.get(next.selected.layout);
    next.shape = this.shapes.get(next.selected.shape);
    next.active = Object.fromEntries(appearanceKinds.map(kind => [kind, this.available(next, kind, next.selected[kind]) ? next.selected[kind] : builtinDefault])) as Record<AppearanceKind, string>;
    // A partial recommendation matches only its declared slots; prioritize the most specific match.
    next.presetId = [...next.presets].sort((a, b) => Object.keys(b.selected).length - Object.keys(a.selected).length).find(preset => !preset.unavailable && appearanceKinds
      .every(kind => preset.selected[kind] === undefined || (preset.selected[kind] === next.selected[kind] && next.selected[kind] === next.active[kind])))?.id;
    const preset = next.presets.find(item => item.id === next.presetId);
    next.canSavePreset = !next.presets.some(item => appearanceKinds.every(kind => item.selected[kind] === next.active[kind]));
    next.currentPreset = { id: preset?.id ?? 'current', label: preset?.label ?? '当前搭配', customNumber: preset?.customNumber, selected: { ...next.active },
      ...this.colorPreview(next.active.color), ...this.layoutPreview(next.active, true) };
    this.registry.select(next.active.icons);
    this.apply(next.color, next.layout, next.shape, next.mode, next.active.material === builtinDefault ? undefined : next.active.material);
    this.state.value = next;
  }
  dispose() {
    for (const dispose of this.disposers) dispose();
    this.disposers = []; this.colors.clear(); this.layouts.clear(); this.shapes.clear(); this.registry.select(builtinDefault); this.apply();
    this.state.value = initial(); this.signature = '';
  }
}
