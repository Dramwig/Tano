/** Device preferences only: never written into workspace content or rules. */
export type UiLocale = 'zh-CN' | 'en-US';
export const localePreferenceKey = 'tano.preference.locale';
export const localeChangeEvent = 'tano:locale-change';

export function parseUiLocale(value: unknown): UiLocale {
  return value === 'en-US' ? 'en-US' : 'zh-CN';
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
