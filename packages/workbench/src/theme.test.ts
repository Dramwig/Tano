// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { applyTheme, parseThemePreference, readThemePreference, saveThemePreference } from './theme';

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.style.removeProperty('color-scheme');
});

it('falls back to system for missing or invalid saved themes', () => {
  expect(parseThemePreference(null)).toBe('system');
  window.localStorage.setItem('tano.preference.theme', 'invalid');
  expect(readThemePreference()).toBe('system');
});

it('resolves the system theme and persists an explicit choice', () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
  applyTheme('system');
  expect(document.documentElement.dataset.theme).toBe('dark');
  saveThemePreference('light');
  expect(window.localStorage.getItem('tano.preference.theme')).toBe('light');
  expect(document.documentElement.dataset.theme).toBe('light');
  expect(document.documentElement.style.colorScheme).toBe('light');
});
