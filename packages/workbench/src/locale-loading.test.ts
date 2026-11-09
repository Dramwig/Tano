// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { localeDefinition } from './locale-registry';
import { initializeUiLocale, setUiLocale, t, uiLocale, uiIconLabel, localeLoadError } from './i18n';
import { loadedLocale } from './locale-catalogs';
import { localePreferenceKey } from './locale';

afterEach(async () => { vi.restoreAllMocks(); await setUiLocale('zh-CN'); localStorage.clear(); });

it('loads only the selected and fallback catalogs before first rendering', async () => {
  localStorage.setItem(localePreferenceKey, 'ja-JP');
  await initializeUiLocale();
  expect(uiLocale.value).toBe('ja-JP');
  expect(t('新建文档')).not.toBe('新建文档');
  expect(uiIconLabel('folder', '文件夹')).not.toBe('');
  expect(loadedLocale('en-US')).toBeDefined();
  expect(loadedLocale('ja-JP')).toBeDefined();
  expect(loadedLocale('de-DE')).toBeUndefined();
  expect(loadedLocale('es-ES')).toBeUndefined();
});

it('keeps the latest selection when an older import finishes later', async () => {
  const entry = localeDefinition('de-DE');
  const original = entry.loadMessages;
  let finish!: () => void;
  vi.spyOn(entry, 'loadMessages').mockImplementation(async () => {
    await new Promise<void>(resolve => { finish = resolve; });
    return original();
  });
  const german = setUiLocale('de-DE');
  await setUiLocale('en-US');
  finish();
  expect(await german).toBe(false);
  expect(uiLocale.value).toBe('en-US');
  expect(localStorage.getItem(localePreferenceKey)).toBe('en-US');
});

it('preserves the active language on import failure and allows a retry', async () => {
  await setUiLocale('en-US');
  const entry = localeDefinition('es-ES');
  const original = entry.loadMessages;
  const loader = vi.spyOn(entry, 'loadMessages').mockRejectedValueOnce(new Error('offline')).mockImplementation(original);
  expect(await setUiLocale('es-ES')).toBe(false);
  expect(localeLoadError.value).toBe(true);
  expect(uiLocale.value).toBe('en-US');
  expect(t('新建文档')).toBe('New document');
  expect(await setUiLocale('es-ES')).toBe(true);
  expect(loader).toHaveBeenCalledTimes(2);
  expect(localeLoadError.value).toBe(false);
});
