import { appearanceVersion, themeTokenNames, themeColorTokens, themeRadiusTokens, themeSpaceTokens, themeShadowTokens, type ColorThemeDefinition, type ThemeTokens, type ShapeTokens, type LayoutThemeDefinition, type ShapeThemeDefinition } from '@tano/protocol';
// Legacy v2 shapes may declare fonts. Accept the package, but keep typography
// under the user's font settings rather than applying it with component shape.
const componentShapeTokens = [...themeRadiusTokens, ...themeSpaceTokens, ...themeShadowTokens];
export type ThemePreference = 'light' | 'dark' | 'system';
export interface ResolvedTheme {
  version: typeof appearanceVersion;
  mode: 'light' | 'dark';
  tokens: Readonly<ThemeTokens>;
  layout?: Readonly<LayoutThemeDefinition>;
  shape: Readonly<{ id: string; label: string; tokens: Readonly<ShapeTokens> }>;
}
export const themeChangedEvent = 'tano-theme-changed';
let currentPreference: ThemePreference = 'system';
type ColorAppearance = Pick<ColorThemeDefinition, 'light' | 'dark'> & { id?: string };
let appearance: ColorAppearance = { light: {}, dark: {} };
const applied = new Set<string>();
let layout: LayoutThemeDefinition | undefined;
let shape: ShapeThemeDefinition | undefined;

/** Only validated contract tokens reach the host. Empty maps restore built-in CSS. */
export function applyAppearance(value?: ColorAppearance, layoutValue?: LayoutThemeDefinition, shapeValue?: ShapeThemeDefinition, mode = currentPreference): void {
  appearance = value ?? { light: {}, dark: {} };
  layout = layoutValue ? { ...layoutValue } : undefined;
  shape = shapeValue ? { ...shapeValue, tokens: Object.fromEntries(componentShapeTokens.flatMap(key =>
    shapeValue.tokens[key] === undefined ? [] : [[key, shapeValue.tokens[key]]])) } : undefined;
  const root = document.documentElement;
  root.dataset.layout = layout?.structure ?? 'continuous';
  root.dataset.surface = layout?.surface ?? 'flat';
  root.dataset.layoutTheme = layout?.id ?? 'builtin:tano';
  root.dataset.shapeTheme = shape?.id ?? 'builtin:tano';
  for (const [key, value] of [['layout-gap', layout ? `${layout.gap ?? 16}px` : undefined],
    ['layout-page-width', layout ? `${layout.pageWidth ?? 880}px` : undefined]]) {
    if (value) root.style.setProperty(`--${key}`, value);
    else root.style.removeProperty(`--${key}`);
  }
  document.documentElement.dataset.colorTheme = value?.id ?? 'builtin:tano';
  applyTheme(mode);
}

export function resolvedTheme(): ResolvedTheme {
  const styles = getComputedStyle(document.documentElement);
  return { version: appearanceVersion, mode: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
    ...(layout ? { layout: { ...layout } } : {}),
    shape: shape ? { ...shape, tokens: { ...shape.tokens } } : { id: 'builtin:tano', label: '同页默认', tokens: {} },
    tokens: Object.fromEntries(themeTokenNames.map(key => [key, styles.getPropertyValue(`--${key}`).trim()]).filter(([, value]) => value)) };
}



export function parseThemePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

/** A single-mode color theme constrains rendering without overwriting the user's preference. */
export function fixedColorMode(value?: Pick<ColorThemeDefinition, 'light' | 'dark'>): 'light' | 'dark' | undefined {
  if (value?.light !== undefined && value.dark === undefined) return 'light';
  if (value?.dark !== undefined && value.light === undefined) return 'dark';
}

/** Startup and workspace rendering use the same user-level mode. */
export function readThemePreference(principal = 'device'): ThemePreference {
  try {
    return parseThemePreference(JSON.parse(window.localStorage.getItem(`tano.appearance.v2.${encodeURIComponent(principal)}.user`) ?? 'null')?.mode);
  } catch {
    return 'system';
  }
}

export function applyTheme(preference: ThemePreference): void {
  currentPreference = preference;
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ?? false;
  const resolved = fixedColorMode(appearance) ?? (preference === 'system' ? (prefersDark ? 'dark' : 'light') : preference);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  for (const key of applied) document.documentElement.style.removeProperty(`--${key}`);
  applied.clear();
  const colors = appearance[resolved] ?? {};
  const tokens = { ...Object.fromEntries(themeColorTokens.flatMap(key => colors[key] === undefined ? [] : [[key, colors[key]]])),
    ...Object.fromEntries(componentShapeTokens.flatMap(key => shape?.tokens[key] === undefined ? [] : [[key, shape.tokens[key]]])) };
  for (const [key, value] of Object.entries(tokens)) {
    document.documentElement.style.setProperty(`--${key}`, value);
    applied.add(key);
  }
  window.dispatchEvent(new Event(themeChangedEvent));
}
