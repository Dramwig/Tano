import { readonly, shallowRef } from 'vue';
import { englishMessages } from './locales/en-US';
import { applyUiLocale, localeChangeEvent, localePreferenceKey, parseUiLocale, readUiLocale, saveUiLocale } from './locale';
import type { UiLocale } from './locale';

const selectedLocale = shallowRef<UiLocale>(readUiLocale());
export const uiLocale = readonly(selectedLocale);

function receiveLocale(value: unknown) {
  selectedLocale.value = parseUiLocale(value);
  applyUiLocale(selectedLocale.value);
}

if (typeof window !== 'undefined') {
  window.addEventListener(localeChangeEvent, event => receiveLocale((event as CustomEvent).detail));
  window.addEventListener('storage', event => {
    if (event.key === localePreferenceKey || event.key === null) receiveLocale(readUiLocale());
  });
}

export function setUiLocale(value: unknown): void {
  const next = parseUiLocale(value);
  if (next === selectedLocale.value) return;
  selectedLocale.value = next;
  saveUiLocale(next);
}

/** Translate UI-owned messages only. Never pass user content or file names here. */
export function t(message: string, values: readonly unknown[] = []): string {
  const translated = selectedLocale.value === 'en-US' ? englishMessages[message] ?? message : message;
  return translated.replace(/\{(\d+)\}/g, (token, index: string) =>
    Number(index) < values.length ? String(values[Number(index)] ?? '') : token);
}

export function useI18n() { return { locale: uiLocale, setLocale: setUiLocale, t }; }

export function uiSearchText(message: string): string {
  return `${message} ${englishMessages[message] ?? ''}`;
}

/** Tauri WebViews also synchronize explicitly, including hidden settings windows. */
let syncStarted = false;
export async function initializeLocaleSync(native: boolean): Promise<void> {
  applyUiLocale(selectedLocale.value);
  if (!native || syncStarted) return;
  syncStarted = true;
  try {
    const { emit, listen } = await import('@tauri-apps/api/event');
    await listen<UiLocale>('tano-ui-locale', event => setUiLocale(event.payload));
    window.addEventListener(localeChangeEvent, () => {
      void emit('tano-ui-locale', selectedLocale.value).catch(() => {});
    });
    // A language change can happen while this hidden WebView is loading.
    setUiLocale(readUiLocale());
  } catch { syncStarted = false; }
}
