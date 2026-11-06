/** Device preferences only: never written into workspace content or rules. */
export const uiLocales = ['zh-CN', 'en-US', 'zh-TW', 'ja-JP', 'es-ES', 'de-DE'] as const;
export type UiLocale = typeof uiLocales[number];
export const uiLocaleOptions: readonly { value: UiLocale; label: string }[] = [
  { value: 'zh-CN', label: '简体中文' }, { value: 'en-US', label: 'English' },
  { value: 'zh-TW', label: '繁體中文' }, { value: 'ja-JP', label: '日本語' },
  { value: 'es-ES', label: 'Español' }, { value: 'de-DE', label: 'Deutsch' },
];
export const localePreferenceKey = 'tano.preference.locale';
export const localeChangeEvent = 'tano:locale-change';

export function parseUiLocale(value: unknown): UiLocale {
  return uiLocales.includes(value as UiLocale) ? value as UiLocale : 'zh-CN';
}

export function readUiLocale(): UiLocale {
  try { return parseUiLocale(window.localStorage.getItem(localePreferenceKey)); }
  catch { return 'zh-CN'; }
}

export function applyUiLocale(value: UiLocale): void {
  document.documentElement.lang = value;
}

export function saveUiLocale(value: UiLocale): void {
  try { window.localStorage.setItem(localePreferenceKey, value); }
  catch { /* Keep the selection for this session when storage is unavailable. */ }
  applyUiLocale(value);
  window.dispatchEvent(new CustomEvent(localeChangeEvent, { detail: value }));
}
