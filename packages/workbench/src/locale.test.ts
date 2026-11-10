// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { localePreferenceKey, readUiLocale, systemUiLocale } from './locale';

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

it.each([
  ['zh-TW', 'zh-TW'], ['zh-HK', 'zh-TW'], ['zh-MO', 'zh-TW'], ['zh-Hant-HK', 'zh-TW'],
  ['zh-CN', 'zh-CN'], ['zh-SG', 'zh-CN'], ['en-GB', 'en-US'], ['ja', 'ja-JP'],
  ['es-MX', 'es-ES'], ['de-AT', 'de-DE'], ['fr-FR', 'zh-CN'], ['', 'zh-CN'],
])('matches system preference %s to %s', (language, locale) => {
  expect(systemUiLocale(language)).toBe(locale);
});

it('uses system language only when no preference exists, including blocked storage', () => {
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('ja-JP');
  expect(readUiLocale()).toBe('ja-JP');
  localStorage.setItem(localePreferenceKey, 'zh-CN');
  expect(readUiLocale()).toBe('zh-CN');
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  expect(readUiLocale()).toBe('ja-JP');
});
