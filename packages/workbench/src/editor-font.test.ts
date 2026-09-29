import { expect, it } from 'vitest';
import { parseVisualFontChoice, sanitizeCustomFontName, visualFontFamily } from './editor-font';

it('keeps system and serif as supported presets', () => {
  expect(parseVisualFontChoice(null)).toBe('system');
  expect(parseVisualFontChoice('unknown')).toBe('system');
  expect(parseVisualFontChoice('serif')).toBe('serif');
  expect(visualFontFamily('serif', '')).toContain('Georgia');
});

it('quotes a custom font and retains a system fallback', () => {
  expect(sanitizeCustomFontName('霞鹜文楷; color: red')).toBe('霞鹜文楷 color red');
  expect(visualFontFamily('custom', '霞鹜文楷')).toMatch(/^"霞鹜文楷", .*sans-serif$/);
  expect(visualFontFamily('custom', '')).toBe(visualFontFamily('system', ''));
});
