// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { applyAppearance, applyTheme, parseThemePreference, readThemePreference, resolvedTheme } from './theme';
import { visualFontFamily } from './editor-font';

afterEach(() => {
  applyAppearance(undefined, undefined, undefined, 'system');
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.style.removeProperty('color-scheme');
});

it('ignores legacy shape fonts and shadows while preserving geometry tokens and editor font choices', () => {
  const font = visualFontFamily('system', '');
  applyAppearance(undefined, undefined, { id: 'legacy:print', label: '旧排印', tokens: {
    'font-ui': 'serif', 'font-prose': 'cursive', 'font-mono': 'monospace',
    'radius-card': '2px', 'space-panel': '18px', 'overlay-shadow': 'none', 'dialog-shadow': 'none',
  } });
  for (const mode of ['light', 'dark'] as const) {
    applyTheme(mode);
    const computed = getComputedStyle(document.documentElement);
    for (const key of ['font-ui', 'font-prose', 'font-mono', 'overlay-shadow', 'dialog-shadow']) {
      expect(computed.getPropertyValue(`--${key}`).trim()).toBe('');
      expect(resolvedTheme().shape.tokens).not.toHaveProperty(key);
    }
    expect(computed.getPropertyValue('--radius-card').trim()).toBe('2px');
    expect(computed.getPropertyValue('--space-panel').trim()).toBe('18px');
    expect(visualFontFamily('system', '')).toBe(font);
    expect(visualFontFamily('custom', '')).toBe(font);
    expect(visualFontFamily('handwritten', '')).toContain('KaiTi');
  }
  applyAppearance();
  expect(getComputedStyle(document.documentElement).getPropertyValue('--radius-card').trim()).toBe('');
});

it('writes theme tokens in a stylesheet ordered before overlay styles so overlays can override non-default themes', () => {
  const overlay = document.createElement('style');
  overlay.id = 'tano-workbench-overlay-style';
  overlay.dataset.tanoOverlayStyle = '1';
  overlay.textContent = 'html:root[data-theme="light"] { --paper: #faf6ef; }';
  document.head.appendChild(overlay);
  try {
    applyAppearance({ id: 'sample:ink', light: { paper: '#112233', accent: '#445566' }, dark: { paper: '#101010' } }, undefined, undefined, 'light');
    const themeStyle = document.getElementById('tano-theme-tokens');
    expect(themeStyle).not.toBeNull();
    expect(themeStyle!.compareDocumentPosition(overlay) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.documentElement.style.getPropertyValue('--paper')).toBe('');
    const computed = getComputedStyle(document.documentElement);
    expect(computed.getPropertyValue('--paper').trim()).toBe('#faf6ef');
    expect(computed.getPropertyValue('--accent').trim()).toBe('#445566');
  } finally {
    overlay.remove();
  }
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
