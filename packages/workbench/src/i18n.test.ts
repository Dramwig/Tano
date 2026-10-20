// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { initializeLocaleSync, setUiLocale, t, uiLocale } from './i18n';
import { localePreferenceKey, parseUiLocale, readUiLocale } from './locale';

const nativeEvents = vi.hoisted(() => ({
  emit: vi.fn().mockResolvedValue(undefined),
  receive: undefined as undefined | ((event: { payload: string }) => void),
}));
vi.mock('@tauri-apps/api/event', () => ({
  emit: nativeEvents.emit,
  listen: vi.fn(async (_name, listener) => { nativeEvents.receive = listener; return () => {}; }),
}));

afterEach(() => { vi.restoreAllMocks(); setUiLocale('zh-CN'); localStorage.removeItem(localePreferenceKey); });

it('defaults to Chinese and keeps interpolated user text literal', () => {
  expect(parseUiLocale(null)).toBe('zh-CN');
  expect(parseUiLocale('unsupported')).toBe('zh-CN');
  setUiLocale('en-US');
  expect(t('工作区设置 · {0}', ['主题 <script>'])).toBe('Workspace settings · 主题 <script>');
  expect(t('unknown message')).toBe('unknown message');
  expect(readUiLocale()).toBe('en-US');
});

it('continues switching during a session when storage is unavailable', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  setUiLocale('en-US');
  expect(t('新建文档')).toBe('New document');
  expect(document.documentElement.lang).toBe('en-US');
});

it('updates existing views from storage events and native settings windows without an event loop', async () => {
  localStorage.setItem(localePreferenceKey, 'en-US');
  window.dispatchEvent(new StorageEvent('storage', { key: localePreferenceKey }));
  expect(uiLocale.value).toBe('en-US');
  await initializeLocaleSync(true);
  nativeEvents.emit.mockClear();
  nativeEvents.receive!({ payload: 'zh-CN' });
  expect(t('主题')).toBe('主题');
  expect(readUiLocale()).toBe('zh-CN');
  expect(nativeEvents.emit).toHaveBeenCalledTimes(1);
  nativeEvents.receive!({ payload: 'zh-CN' });
  expect(nativeEvents.emit).toHaveBeenCalledTimes(1);
  localStorage.removeItem(localePreferenceKey);
  window.dispatchEvent(new StorageEvent('storage', { key: null }));
  expect(uiLocale.value).toBe('zh-CN');
});
