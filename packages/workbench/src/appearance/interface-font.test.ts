// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyInterfaceFont,
  interfaceFontFamily,
  interfaceFontPreferenceKey,
  parseInterfaceFont,
  readInterfaceFont,
  saveInterfaceFont,
  usesBuiltinChinese,
} from './interface-font';

afterEach(() => {
  localStorage.clear();
  document.documentElement.style.removeProperty('--font-ui');
});

describe('interface font preference', () => {
  it('defaults to the bundled face for missing or malformed values', () => {
    expect(parseInterfaceFont(null)).toEqual({ choice: 'builtin', customName: '' });
    expect(parseInterfaceFont('{')).toEqual({ choice: 'builtin', customName: '' });
    expect(parseInterfaceFont('{"choice":"serif"}')).toEqual({ choice: 'builtin', customName: '' });
  });

  it('sanitizes custom names before they reach CSS', () => {
    expect(parseInterfaceFont('{"choice":"custom","customName":"Evil\\"; } body { x"}').customName).not.toMatch(/[";{}]/);
    expect(interfaceFontFamily({ choice: 'custom', customName: 'HarmonyOS Sans SC' }))
      .toBe('"HarmonyOS Sans SC", var(--font-ui-system)');
  });

  it('keeps the stylesheet default unless the user picks another face', () => {
    expect(interfaceFontFamily({ choice: 'builtin', customName: 'Ignored' })).toBeUndefined();
    expect(interfaceFontFamily({ choice: 'custom', customName: '  ' })).toBeUndefined();
    expect(interfaceFontFamily({ choice: 'system', customName: '' })).toBe('var(--font-ui-system)');
  });

  it('applies and clears the root override', () => {
    const root = document.documentElement;
    applyInterfaceFont({ choice: 'system', customName: '' });
    expect(root.style.getPropertyValue('--font-ui')).toBe('var(--font-ui-system)');
    applyInterfaceFont({ choice: 'builtin', customName: '' });
    expect(root.style.getPropertyValue('--font-ui')).toBe('');
  });

  it('uses the bundled Simplified Chinese face only for zh-CN and non-Han UI locales', () => {
    const builtin = { choice: 'builtin' as const, customName: '' };
    expect(usesBuiltinChinese(builtin, 'zh-CN')).toBe(true);
    expect(usesBuiltinChinese(builtin, 'en-US')).toBe(true);
    expect(usesBuiltinChinese(builtin, 'zh-TW')).toBe(false);
    expect(usesBuiltinChinese(builtin, 'ja-JP')).toBe(false);
    expect(usesBuiltinChinese({ choice: 'system', customName: '' }, 'zh-CN')).toBe(false);
  });

  it('persists on this device and applies immediately', () => {
    saveInterfaceFont({ choice: 'custom', customName: 'Segoe UI' });
    expect(JSON.parse(localStorage.getItem(interfaceFontPreferenceKey)!)).toEqual({ choice: 'custom', customName: 'Segoe UI' });
    expect(readInterfaceFont()).toEqual({ choice: 'custom', customName: 'Segoe UI' });
    expect(document.documentElement.style.getPropertyValue('--font-ui')).toBe('"Segoe UI", var(--font-ui-system)');
  });
});
