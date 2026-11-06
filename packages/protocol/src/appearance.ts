/** Versioned, data-only appearance contract. Keys map to CSS custom properties. */
export const appearanceVersion = 2 as const;
export const themeColorTokens = [
  'paper', 'sidebar', 'surface', 'surface-raised', 'hover', 'text', 'text-secondary', 'muted',
  'line', 'line-strong', 'control-border', 'selected', 'selected-text', 'selection', 'accent',
  'green', 'green-hover', 'green-fill', 'green-fill-hover', 'on-accent', 'block-selection',
  'danger', 'danger-bg', 'warning', 'warning-bg', 'warning-border', 'switch-off',
  'syntax-purple', 'syntax-red', 'syntax-blue', 'syntax-orange', 'syntax-teal', 'syntax-green',
  'highlight-bg', 'suggestion-color', 'diff-add-bg', 'diff-remove-bg', 'quote-border',
  'scrollbar-thumb', 'scrollbar-thumb-hover', 'backdrop',
] as const;
export const themeFontTokens = ['font-ui', 'font-mono', 'font-prose'] as const;
export const themeRadiusTokens = ['radius-control', 'radius-card', 'radius-dialog'] as const;
export const themeSpaceTokens = ['space-control-x', 'space-control-y', 'space-panel', 'space-row-gap'] as const;
export const themeShadowTokens = ['overlay-shadow', 'dialog-shadow'] as const;
export const themeShapeTokens = [...themeFontTokens, ...themeRadiusTokens, ...themeSpaceTokens, ...themeShadowTokens] as const;
export const themeTokenNames = [...themeColorTokens, ...themeFontTokens, ...themeRadiusTokens, ...themeSpaceTokens, ...themeShadowTokens] as const;
export type ThemeTokenName = typeof themeTokenNames[number];
export type ThemeTokens = Partial<Record<ThemeTokenName, string>>;
export type ColorTokens = Partial<Record<typeof themeColorTokens[number], string>>;
export type ShapeTokens = Partial<Record<typeof themeShapeTokens[number], string>>;
/** Declare at least one mode. An omitted mode is unsupported; {} inherits its built-in palette. */
export type ColorThemeDefinition = {
  id: string;
  label: string;
} & ({ light: ColorTokens; dark?: ColorTokens } | { light?: ColorTokens; dark: ColorTokens });
export interface ShapeThemeDefinition {
  id: string;
  label: string;
  tokens: ShapeTokens;
}
export type FileIconColor = `#${string}` | 'currentColor' | typeof themeColorTokens[number];
export interface FileIconDefinition {
  color: FileIconColor;
  paths: readonly string[];
  label?: string;
  silhouette?: 'file' | 'folder' | 'folder-open' | 'none';
  /** Embedded raster artwork; never a URL or executable SVG. */
  image?: string;
  lightImage?: string;
}
export interface FileIconTheme {
  id: string;
  label: string;
  notice?: string;
  icons: Readonly<Record<string, FileIconDefinition>>;
  file?: string;
  folder?: string;
  folderExpanded?: string;
  folderHome?: string;
  folderHomeExpanded?: string;
  fileNames?: Readonly<Record<string, string>>;
  fileExtensions?: Readonly<Record<string, string>>;
  folderNames?: Readonly<Record<string, string>>;
  folderNamesExpanded?: Readonly<Record<string, string>>;
}
export interface PluginAppearance {
  version: typeof appearanceVersion;
  colors?: ColorThemeDefinition[];
  icons?: FileIconTheme[];
  layouts?: LayoutThemeDefinition[];
  shapes?: ShapeThemeDefinition[];
  presets?: ThemePresetDefinition[];
}
/** Local contribution IDs, or explicit builtin:<id> references. No cross-plugin dependencies. */
export interface ThemePresetDefinition {
  id: string;
  label: string;
  color?: string;
  icons?: string;
  layout?: string;
  shape?: string;
}
/** Host-owned structures preserve editor, focus, scroll and drag semantics. */
export interface LayoutThemeDefinition {
  id: string;
  label: string;
  structure: 'continuous' | 'islands' | 'notebook' | 'document';
  surface: 'flat' | 'paper' | 'skeuomorphic';
  gap?: number;
  pageWidth?: number;
}
/** Only host-designed and verified structure/material pairs are supported. */
export const layoutSurfaceByStructure = {
  continuous: 'flat', islands: 'flat', notebook: 'skeuomorphic', document: 'paper',
} as const satisfies Record<LayoutThemeDefinition['structure'], LayoutThemeDefinition['surface']>;
const color = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i;
export function isFileIconColor(value: unknown): value is FileIconColor {
  return typeof value === 'string' && (color.test(value) || value === 'currentColor' || (themeColorTokens as readonly string[]).includes(value));
}
export function fileIconCssColor(value: FileIconColor): string {
  return (themeColorTokens as readonly string[]).includes(value) ? `var(--${value})` : value;
}
/** Bound decoded dimensions as well as encoded bytes before passing artwork to the image decoder. */
export function isFileIconImage(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 44 * 1024 || !/^data:image\/png;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
  try {
    const bytes = Uint8Array.from(atob(value.slice(22)), char => char.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    if (bytes.length < 45 || view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a ||
      view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452 ||
      ![16, 20].every(offset => view.getUint32(offset) > 0 && view.getUint32(offset) <= 128)) return false;
    let hasData = false;
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = view.getUint32(offset), type = view.getUint32(offset + 4);
      if (length > bytes.length - offset - 12) return false;
      if (type === 0x49444154) hasData = true;
      if (type === 0x49454e44) return hasData && length === 0 && offset + 12 === bytes.length;
      offset += length + 12;
    }
  } catch { return false; }
  return false;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function keys(value: unknown, allowed: readonly string[]): asserts value is Record<string, unknown> {
  if (!record(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error('主题包含不支持的字段');
}
function label(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 80 || /[\u0000-\u001f]/.test(value)) throw new Error('主题名称无效');
}
function id(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9.-]{0,79}$/.test(value)) throw new Error('主题 ID 无效');
}
export function parseThemeTokens(value: unknown): ThemeTokens {
  keys(value, themeTokenNames);
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string' || item.length > 300) throw new Error(`主题变量无效：${key}`);
    let valid = false;
    if ((themeColorTokens as readonly string[]).includes(key)) valid = color.test(item);
    if ((themeFontTokens as readonly string[]).includes(key)) valid = item.split(',').every(family => /^(?:"[\p{L}\p{N} ._-]+"|'[\p{L}\p{N} ._-]+'|[\p{L}\p{N} ._-]+)$/u.test(family.trim()));
    if ((themeRadiusTokens as readonly string[]).includes(key)) valid = /^\d+(?:\.\d+)?px$/.test(item) && parseFloat(item) <= 24;
    if ((themeSpaceTokens as readonly string[]).includes(key)) valid = /^\d+(?:\.\d+)?px$/.test(item) && parseFloat(item) >= 2 && parseFloat(item) <= 24;
    if ((themeShadowTokens as readonly string[]).includes(key)) {
      valid = item === 'none' || (item.split(',').length <= 3 && item.split(',').every(shadow => {
        const parts = shadow.trim().split(/\s+/);
        return parts.length >= 3 && parts.length <= 5 && color.test(parts.at(-1)!) &&
          parts.slice(0, -1).every(part => /^-?\d+(?:\.\d+)?px$/.test(part) && Math.abs(parseFloat(part)) <= 100) &&
          (parts.length < 4 || parseFloat(parts[2]!) >= 0);
      }));
    }
    if (!valid) throw new Error(`主题变量无效：${key}`);
  }
  return { ...value } as ThemeTokens;
}
export function parseFileIconTheme(value: unknown): FileIconTheme {
  const defaults = ['file', 'folder', 'folderExpanded', 'folderHome', 'folderHomeExpanded'];
  const maps = ['fileNames', 'fileExtensions', 'folderNames', 'folderNamesExpanded'];
  keys(value, ['id', 'label', 'notice', 'icons', ...defaults, ...maps]);
  id(value.id); label(value.label);
  if (value.notice !== undefined && (typeof value.notice !== 'string' || value.notice.length > 4096 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value.notice))) throw new Error('图标许可声明无效');
  if (!record(value.icons) || !Object.keys(value.icons).length || Object.keys(value.icons).length > 2048) throw new Error('图标主题数量无效');
  const icons: Record<string, FileIconDefinition> = {};
  for (const [name, icon] of Object.entries(value.icons)) {
    id(name); keys(icon, ['color', 'paths', 'label', 'silhouette', 'image', 'lightImage']);
    if (!isFileIconColor(icon.color) ||
      !Array.isArray(icon.paths) || icon.paths.length > 32 || icon.paths.some(path => typeof path !== 'string' || path.length > 4096 || !/^[MmZzLlHhVvCcSsQqTtAaEe\d\s.,+\-]*$/.test(path)) ||
      (icon.label !== undefined && (typeof icon.label !== 'string' || icon.label.length > 4 || /[\u0000-\u001f]/.test(icon.label))) ||
      (icon.silhouette !== undefined && !['file', 'folder', 'folder-open', 'none'].includes(String(icon.silhouette))) ||
      (icon.image !== undefined && !isFileIconImage(icon.image)) ||
      (icon.lightImage !== undefined && (icon.image === undefined || !isFileIconImage(icon.lightImage)))) throw new Error(`图标无效：${name}`);
    icons[name] = { color: icon.color, paths: [...icon.paths],
      ...(icon.label === undefined ? {} : { label: icon.label as string }),
      ...(icon.silhouette === undefined ? {} : { silhouette: icon.silhouette as FileIconDefinition['silhouette'] }),
      ...(icon.image === undefined ? {} : { image: icon.image as string }),
      ...(icon.lightImage === undefined ? {} : { lightImage: icon.lightImage as string }) };
  }
  const result: Record<string, unknown> = { id: value.id, label: value.label, icons,
    ...(value.notice === undefined ? {} : { notice: value.notice }) };
  const reference = (name: unknown) => {
    if (typeof name !== 'string' || !Object.hasOwn(icons, name)) throw new Error('图标引用不存在');
    return name;
  };
  for (const name of defaults) if (value[name] !== undefined) result[name] = reference(value[name]);
  for (const name of maps) if (value[name] !== undefined) {
    const map = value[name];
    if (!record(map) || Object.keys(map).length > 8192) throw new Error('图标匹配表无效');
    const normalized: Record<string, string> = Object.create(null);
    for (const [key, target] of Object.entries(map)) {
      if (!key.trim() || key.length > 255 || /[\u0000-\u001f/\\]/.test(key) || Object.hasOwn(normalized, key.toLowerCase())) throw new Error('图标匹配名称重复或无效');
      normalized[key.toLowerCase()] = reference(target);
    }
    result[name] = normalized;
  }
  return result as unknown as FileIconTheme;
}
export function parsePluginAppearance(value: unknown): PluginAppearance {
  keys(value, ['version', 'colors', 'icons', 'layouts', 'shapes', 'presets']);
  if (value.version !== appearanceVersion) throw new Error('不支持此主题契约版本');
  const parseList = <T extends { id: string }>(input: unknown, parse: (value: unknown) => T): T[] => {
    if (!Array.isArray(input) || input.length > 12) throw new Error('主题列表无效');
    const result = input.map(parse);
    if (new Set(result.map(item => item.id)).size !== result.length) throw new Error('主题 ID 重复');
    return result;
  };
  const colors = value.colors === undefined ? undefined : parseList<ColorThemeDefinition>(value.colors, item => {
    keys(item, ['id', 'label', 'light', 'dark']); id(item.id); label(item.label);
    const parseColors = (tokens: unknown): ColorTokens | undefined => {
      if (tokens === undefined) return;
      keys(tokens, themeColorTokens);
      return parseThemeTokens(tokens);
    };
    const light = parseColors(item.light), dark = parseColors(item.dark);
    if (light === undefined) {
      if (dark === undefined) throw new Error('配色主题至少需要浅色或深色模式');
      return { id: item.id, label: item.label, dark };
    }
    return { id: item.id, label: item.label, light, ...(dark === undefined ? {} : { dark }) };
  });
  const shapes = value.shapes === undefined ? undefined : parseList(value.shapes, item => {
    keys(item, ['id', 'label', 'tokens']); id(item.id); label(item.label); keys(item.tokens, themeShapeTokens);
    return { id: item.id, label: item.label, tokens: parseThemeTokens(item.tokens) };
  });
  const icons = value.icons === undefined ? undefined : parseList(value.icons, parseFileIconTheme);
  const layouts = value.layouts === undefined ? undefined : parseList(value.layouts, item => {
    keys(item, ['id', 'label', 'structure', 'surface', 'gap', 'pageWidth']); id(item.id); label(item.label);
    if (typeof item.structure !== 'string' || !['continuous', 'islands', 'notebook', 'document'].includes(item.structure) ||
      typeof item.surface !== 'string' || !['flat', 'paper', 'skeuomorphic'].includes(item.surface)) throw new Error('布局风格无效');
    if (layoutSurfaceByStructure[item.structure as LayoutThemeDefinition['structure']] !== item.surface) throw new Error(`不支持此布局与材质组合：${item.structure} × ${item.surface}`);
    for (const [key, min, max] of [['gap', 8, 32], ['pageWidth', 640, 1200]] as const) {
      if (item[key] !== undefined && (typeof item[key] !== 'number' || !Number.isInteger(item[key]) || item[key] < min || item[key] > max)) throw new Error(`布局尺寸无效：${key}`);
    }
    return { ...item } as unknown as LayoutThemeDefinition;
  });
  const presets = value.presets === undefined ? undefined : parseList(value.presets, item => {
    keys(item, ['id', 'label', 'color', 'icons', 'layout', 'shape']); id(item.id); label(item.label);
    const reference = (key: 'color' | 'icons' | 'layout' | 'shape', choices: { id: string }[] | undefined) => {
      const target = item[key];
      if (target === undefined) return {};
      if (typeof target !== 'string' || !(/^builtin:[a-z][a-z0-9.-]{0,79}$/.test(target) || choices?.some(choice => choice.id === target))) throw new Error(`主题预设引用不存在：${key}`);
      return { [key]: target };
    };
    if (['color', 'icons', 'layout', 'shape'].every(key => item[key] === undefined)) throw new Error('主题预设至少需要指定一项');
    return { id: item.id, label: item.label, ...reference('color', colors), ...reference('icons', icons), ...reference('layout', layouts), ...reference('shape', shapes) };
  });
  if (!colors?.length && !icons?.length && !layouts?.length && !shapes?.length && !presets?.length) throw new Error('主题包至少需要一套配色、图标、布局、形态或预设');
  return { version: value.version, ...(colors ? { colors } : {}), ...(icons ? { icons } : {}), ...(layouts ? { layouts } : {}), ...(shapes ? { shapes } : {}), ...(presets ? { presets } : {}) };
}
