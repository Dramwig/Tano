// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { applyAppearance, applyTheme, parseThemePreference, readThemePreference, resolvedTheme } from './theme';

afterEach(() => {
  applyAppearance(undefined, undefined, undefined, 'system');
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.style.removeProperty('color-scheme');
});

it.each(['light', 'dark'] as const)('keeps a %s-only theme fixed through preference and system changes, then restores the preference', mode => {
  let systemDark = false;
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: systemDark })));
  const color = mode === 'light' ? { light: { paper: '#fff' } } : { dark: { paper: '#111' } };
  applyAppearance(color, undefined, undefined, 'system');
  for (const preference of ['light', 'dark', 'system'] as const) {
    for (systemDark of [true, false]) {
      applyTheme(preference);
      expect(resolvedTheme()).toMatchObject({ mode, tokens: { paper: mode === 'light' ? '#fff' : '#111' } });
      expect(document.documentElement.style.colorScheme).toBe(mode);
    }
  }
  systemDark = true;
  applyAppearance(); // No preference argument: the saved system choice must survive the fixed theme.
  expect(resolvedTheme().mode).toBe('dark');
  systemDark = false; applyTheme('system');
  expect(resolvedTheme().mode).toBe('light');
});

it('falls back to system for missing or invalid saved themes', () => {
  expect(parseThemePreference(null)).toBe('system');
  window.localStorage.setItem('tano.appearance.v2.device.user', 'invalid');
  expect(readThemePreference()).toBe('system');
});

it('resolves system mode and reads the user default for startup paint', () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
  applyTheme('system');
  expect(document.documentElement.dataset.theme).toBe('dark');
  window.localStorage.setItem('tano.appearance.v2.device.user', JSON.stringify({ mode: 'light' }));
  applyTheme(readThemePreference());

  expect(document.documentElement.dataset.theme).toBe('light');
  expect(document.documentElement.style.colorScheme).toBe('light');
});
