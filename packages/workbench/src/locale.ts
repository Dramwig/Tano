import { localeRegistry, uiLocales, type UiLocale } from './locale-registry';
export { localeRegistry, uiLocales, uiLocaleOptions, type UiLocale } from './locale-registry';

/** Device preferences only: never written into workspace content or rules. */
export const localePreferenceKey = 'tano.preference.locale';
export const localeChangeEvent = 'tano:locale-change';

export function parseUiLocale(value: unknown): UiLocale {
  return uiLocales.includes(value as UiLocale) ? value as UiLocale : 'zh-CN';
}

/** Match the browser preference only when the user has not chosen a locale. */
export function systemUiLocale(language = typeof navigator !== 'undefined' ? navigator.language : ''): UiLocale {
  const normalized = language.replace('_', '-').toLowerCase();
  if (/^zh-(?:tw|hk|mo|hant)(?:-|$)/.test(normalized)) return 'zh-TW';
  const prefix = normalized.split('-')[0];
  return localeRegistry.find(locale => locale.value.toLowerCase().startsWith(`${prefix}-`))?.value ?? 'zh-CN';
}

export function readUiLocale(): UiLocale {
  try {
    const saved = window.localStorage.getItem(localePreferenceKey);
    return saved == null ? systemUiLocale() : parseUiLocale(saved);
  } catch { return systemUiLocale(); }
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
