import { readonly, shallowRef } from 'vue';
import { loadedLocale, loadLocaleCatalogs } from './locale-catalogs';
import { applyUiLocale, localeChangeEvent, localePreferenceKey, parseUiLocale, readUiLocale, saveUiLocale } from './locale';
import type { UiLocale } from './locale';
import { startupCopy } from './startup-copy';
import { pluralMessage } from './plurals';

// The host prepares the device preference before mounting; synchronous standalone
// consumers retain the source language until that explicit initialization.
const selectedLocale = shallowRef<UiLocale>('zh-CN');
export const uiLocale = readonly(selectedLocale);
export const localeLoadError = shallowRef(false);
let request = 0;

export async function preloadUiLocale(locale: UiLocale): Promise<void> {
  await Promise.all([loadLocaleCatalogs('en-US'), loadLocaleCatalogs(locale)]);
}

/** Await before mounting any window; t() stays synchronous after preparation. */
export async function initializeUiLocale(): Promise<void> {
  // Storage events may arrive while imports are in flight. Only mount once the
  // final preference is ready, including changes from another window.
  while (!await changeLocale(readUiLocale(), false)) {
    if (localeLoadError.value) throw new Error(startupCopy(readUiLocale()).failure);
  }
}

function receiveLocale(value: unknown) {
  void changeLocale(parseUiLocale(value), false);
}

if (typeof window !== 'undefined') {
  window.addEventListener(localeChangeEvent, event => receiveLocale((event as CustomEvent).detail));
  window.addEventListener('storage', event => {
    if (event.key === localePreferenceKey || event.key === null) receiveLocale(readUiLocale());
  });
}

async function changeLocale(next: UiLocale, persist: boolean): Promise<boolean> {
  const generation = ++request;
  localeLoadError.value = false;
  try {
    if (!loadedLocale(next) || !loadedLocale('en-US')) await preloadUiLocale(next);
    if (generation !== request) return false;
    const changed = next !== selectedLocale.value;
    selectedLocale.value = next;
    applyUiLocale(next);
    let stored: string | null = null;
    try { stored = window.localStorage.getItem(localePreferenceKey); } catch { /* Session selection still works. */ }
    if (persist && (changed || stored !== next)) saveUiLocale(next);
    return true;
  } catch {
    if (generation === request) localeLoadError.value = true;
    return false;
  }
}

export function setUiLocale(value: unknown): Promise<boolean> {
  return changeLocale(parseUiLocale(value), true);
}

/** Translate UI-owned messages only. Never pass user content or file names here. */
export function t(message: string, values: readonly unknown[] = []): string {
  const locale = selectedLocale.value;
  const source = message.includes('::') ? message.slice(message.indexOf('::') + 2) : message;
  const catalog = loadedLocale(locale)?.messages[message] ? loadedLocale(locale) : loadedLocale('en-US');
  const plural = catalog?.plurals[message];
  const translated = locale === 'zh-CN' ? source : plural
    ? pluralMessage(plural, values, catalog === loadedLocale(locale) ? locale : 'en-US')
    : catalog?.messages[message] ?? source;
  return translated.replace(/\{(\d+)\}/g, (token, index: string) =>
    Number(index) < values.length ? String(values[Number(index)] ?? '') : token);
}

export function useI18n() { return { locale: uiLocale, setLocale: setUiLocale, t }; }

export function uiSearchText(message: string): string {
  return `${t(message)} ${message} ${loadedLocale('en-US')?.messages[message] ?? ''}`;
}

export function uiIconLabel(value: string, source: string): string {
  const locale = selectedLocale.value;
  return locale === 'zh-CN' ? source : loadedLocale(locale)?.icons[value] ?? loadedLocale('en-US')?.icons[value] ?? source;
}

/** Tauri WebViews also synchronize explicitly, including hidden settings windows. */
let syncStarted = false;
export async function initializeLocaleSync(native: boolean): Promise<void> {
  applyUiLocale(selectedLocale.value);
  if (!native || syncStarted) return;
  syncStarted = true;
  try {
    const { emit, listen } = await import('@tauri-apps/api/event');
    await listen<UiLocale>('tano-ui-locale', event => { void setUiLocale(event.payload); });
    window.addEventListener(localeChangeEvent, () => {
      void emit('tano-ui-locale', selectedLocale.value).catch(() => {});
    });
    // A language change can happen while this hidden WebView is loading.
    await setUiLocale(readUiLocale());
  } catch { syncStarted = false; }
}
