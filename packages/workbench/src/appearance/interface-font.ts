import { sanitizeCustomFontName } from './editor-font';

/** Device-local typeface for menus, sidebars, tabs, dialogs and settings.
 * Document prose keeps its own font setting (editor-font.ts). */
export type InterfaceFontChoice = 'builtin' | 'system' | 'custom';
export interface InterfaceFontPreference { choice: InterfaceFontChoice; customName: string }

export const interfaceFontPreferenceKey = 'tano.preference.interfaceFont';
export const interfaceFontChanged = 'tano:interface-font-changed';

export function defaultInterfaceFont(): InterfaceFontPreference {
  return { choice: 'builtin', customName: '' };
}

export function parseInterfaceFont(value: string | null): InterfaceFontPreference {
  try {
    const saved = JSON.parse(value ?? 'null');
    if (!saved || typeof saved !== 'object') return defaultInterfaceFont();
    const choice: InterfaceFontChoice = saved.choice === 'system' || saved.choice === 'custom' ? saved.choice : 'builtin';
    const customName = typeof saved.customName === 'string' ? sanitizeCustomFontName(saved.customName) : '';
    return { choice, customName };
  } catch {
    return defaultInterfaceFont();
  }
}

export function readInterfaceFont(): InterfaceFontPreference {
  try {
    return parseInterfaceFont(window.localStorage.getItem(interfaceFontPreferenceKey));
  } catch {
    return defaultInterfaceFont();
  }
}

/** Same file the stylesheet's 'Tano UI Sans SC' 400 face points at; Vite emits
 * one hashed asset for both references. */
export const builtinChineseRegularUrl = new URL('../fonts/TanoUISansSC-Regular.woff2', import.meta.url).href;

/** The bundled Chinese face is Simplified Chinese; other Han locales keep
 * platform faces (workbench-shell.css :lang rule), so they skip the preload. */
export function usesBuiltinChinese(preference: InterfaceFontPreference, lang = document.documentElement.lang): boolean {
  return preference.choice === 'builtin' && !/^(zh-(TW|HK|MO|Hant)|ja|ko)\b/i.test(lang);
}

/** Start fetching the regular Chinese face before Vue and the stylesheet load,
 * so the first paint does not swap from the platform face. */
export function preloadBuiltinChinese(preference: InterfaceFontPreference): void {
  if (!usesBuiltinChinese(preference) || document.querySelector('link[data-tano-ui-font]')) return;
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'font';
  link.type = 'font/woff2';
  link.crossOrigin = 'anonymous';
  link.href = builtinChineseRegularUrl;
  link.dataset.tanoUiFont = '';
  document.head.append(link);
}

/** `undefined` keeps the stylesheet default (bundled Inter + bundled Noto Sans SC). */
export function interfaceFontFamily(preference: InterfaceFontPreference): string | undefined {
  if (preference.choice === 'system') return 'var(--font-ui-system)';
  const name = sanitizeCustomFontName(preference.customName).trim();
  if (preference.choice === 'custom' && name) return `${JSON.stringify(name)}, var(--font-ui-system)`;
  return undefined;
}

export function applyInterfaceFont(preference: InterfaceFontPreference, root: HTMLElement = document.documentElement): void {
  const family = interfaceFontFamily(preference);
  if (family) root.style.setProperty('--font-ui', family);
  else root.style.removeProperty('--font-ui');
}

let syncInstalled = false;
/** Run once per window before Vue mounts, so the first paint already uses the
 * chosen face and the separate settings window stays in step with the main one. */
export function installInterfaceFont(): void {
  const preference = readInterfaceFont();
  applyInterfaceFont(preference);
  preloadBuiltinChinese(preference);
  if (syncInstalled) return;
  syncInstalled = true;
  window.addEventListener('storage', (event) => {
    if (event.key === interfaceFontPreferenceKey || event.key === null) applyInterfaceFont(readInterfaceFont());
  });
  window.addEventListener(interfaceFontChanged, (event) => {
    applyInterfaceFont((event as CustomEvent<InterfaceFontPreference>).detail);
  });
}

export function saveInterfaceFont(preference: InterfaceFontPreference): void {
  const value = { choice: preference.choice, customName: sanitizeCustomFontName(preference.customName) };
  try {
    window.localStorage.setItem(interfaceFontPreferenceKey, JSON.stringify(value));
  } catch {
    // The choice still applies to this window when device storage is unavailable.
  }
  applyInterfaceFont(value);
  window.dispatchEvent(new CustomEvent<InterfaceFontPreference>(interfaceFontChanged, { detail: value }));
}
