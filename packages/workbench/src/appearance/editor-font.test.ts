import { expect, it } from 'vitest';
import { defaultSplitFontSettings, parseSplitFontSettings, parseVisualFontChoice, resolveEditorFont, sanitizeCustomFontName, visualFontFamily } from './editor-font';

it('keeps system, serif, handwritten, and mono as supported presets', () => {
  expect(parseVisualFontChoice(null)).toBe('system');
  expect(parseVisualFontChoice('unknown')).toBe('system');
  expect(parseVisualFontChoice('serif')).toBe('serif');
  expect(parseVisualFontChoice('handwritten')).toBe('handwritten');
  expect(parseVisualFontChoice('mono')).toBe('mono');
  expect(visualFontFamily('serif', '')).toBe('Literata, Georgia, ui-serif, serif');
  expect(visualFontFamily('mono', '')).toContain('Maple Mono NF');
  expect(visualFontFamily('handwritten', '')).toContain("'KaiTi'");
});

it('names explicit CJK fallbacks in system and mono presets', () => {
  expect(visualFontFamily('system', '')).toContain("'Microsoft YaHei UI'");
  expect(visualFontFamily('system', '')).not.toContain('var(');
  expect(visualFontFamily('mono', '')).toMatch(/'Sarasa Mono SC'.*'Microsoft YaHei UI'/);
});

it('quotes a custom font and retains a system fallback', () => {
  expect(sanitizeCustomFontName('霞鹜文楷; color: red')).toBe('霞鹜文楷 color red');
  expect(visualFontFamily('custom', '霞鹜文楷')).toMatch(/^"霞鹜文楷", .*sans-serif$/);
  expect(visualFontFamily('custom', '')).toBe(visualFontFamily('system', ''));
});

it('loads split preferences safely, preserves independent choices on reload and leaves old unified preferences intact', () => {
  expect(parseSplitFontSettings('', 'serif', '')).toEqual(defaultSplitFontSettings('serif', ''));
  expect(parseSplitFontSettings('null', 'handwritten', '')).toEqual(defaultSplitFontSettings('handwritten', ''));
  const split = { enabled: true, chinese: { choice: 'custom', customName: '霞鹜文楷' }, english: { choice: 'mono', customName: '' } };
  const loaded = parseSplitFontSettings(JSON.stringify(split), 'system', '');
  expect(loaded).toEqual(split);
  const resolved = resolveEditorFont('serif', '', loaded);
  expect(resolved.family).toContain('霞鹜文楷');
  expect(resolved.family).toContain('Tano Latin Maple Mono NF');
  expect(resolveEditorFont('serif', '', { ...loaded, enabled: false })).toEqual({ family: visualFontFamily('serif', ''), fontFaces: '' });
  expect(parseSplitFontSettings('{"enabled":"true","chinese":{"choice":"invalid","customName":"a;url(evil)"}}', 'serif', '').chinese)
    .toEqual({ choice: 'system', customName: 'aurlevil' });
});
