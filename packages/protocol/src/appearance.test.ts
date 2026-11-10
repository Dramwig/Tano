import { describe, expect, it } from 'vitest';
import { parsePluginPackage } from './extensions';
import { parsePluginAppearance, parseThemeTokens } from './appearance';

const appearance = () => ({ version: 2, colors: [{ id: 'paper', label: '纸页', light: { paper: '#fff' }, dark: { paper: '#111' } }],
  icons: [{ id: 'lines', label: '线条', icons: { note: { color: 'currentColor', paths: ['M2 2h4'], silhouette: 'none' } }, file: 'note' }] });
const manifest = () => ({ manifestVersion: 1, id: 'theme-paper', name: '纸页', description: '主题', version: '1.0.0', objectTypes: [], relationTypes: [], appearance: appearance() });

it('imports a data-only theme with both modes, no source or UI authority', () => {
  const pkg = parsePluginPackage(JSON.stringify({ packageVersion: 1, manifest: manifest() }));
  expect(pkg.manifest.appearance).toEqual(appearance());
  expect(pkg.source).toBeUndefined();
  expect(() => parsePluginPackage(JSON.stringify({ packageVersion: 1, manifest: manifest(), source: 'alert(1)' }))).toThrow();
});
it('preserves appearance on executable manifests without changing old package serialization', () => {
  const input = { ...manifest(), manifestVersion: 2, apiVersion: 1, permissions: [], commands: [], views: [] };
  expect(parsePluginPackage(JSON.stringify({ packageVersion: 1, manifest: input, source: 'void 0' })).manifest.appearance).toEqual(appearance());
  const old = manifest(); delete (old as Partial<typeof old>).appearance;
  expect(parsePluginPackage(JSON.stringify(old)).manifest).not.toHaveProperty('appearance');
});
describe('appearance boundary', () => {
  it('validates partial presets and checks builtin syntax without hardcoding the host catalog', () => {
    const preset = { id: 'writing', label: '书写', color: 'paper', icons: 'lines', layout: 'builtin:paper' };
    expect(parsePluginAppearance({ ...appearance(), presets: [preset] }).presets).toEqual([preset]);
    const builtin = { ...preset, color: 'builtin:tano', icons: 'builtin:tano' };
    expect(parsePluginAppearance({ version: 2, presets: [builtin] }).presets).toEqual([builtin]);
    expect(parsePluginAppearance({ version: 2, presets: [{ id: 'future', label: '未来布局', layout: 'builtin:future' }] }).presets?.[0]?.color).toBeUndefined();
    expect(() => parsePluginAppearance({ version: 2, presets: [{ id: 'empty', label: '空' }] })).toThrow();
    for (const change of [{ color: 'missing' }, { icons: 'other:lines' }, { layout: 'builtin:invalid:more' }, { layout: null }, { mode: 'dark' }]) {
      expect(() => parsePluginAppearance({ ...appearance(), presets: [{ ...preset, ...change }] })).toThrow();
    }
    expect(() => parsePluginAppearance({ ...appearance(), presets: [preset, preset] })).toThrow();
    const layout = { id: 'desk', label: '桌面', structure: 'document', surface: 'paper' };
    expect(parsePluginAppearance({ ...appearance(), layouts: [layout], presets: [{ ...preset, layout: 'desk' }] }).presets?.[0]?.layout).toBe('desk');
  });
  it('separates shape tokens from colors and accepts only whitelisted icon semantic colors', () => {
    expect(() => parsePluginAppearance({ version: 2, colors: [{ id: 'x', label: 'x', light: { 'font-prose': 'serif' }, dark: {} }] })).toThrow();
    expect(() => parsePluginAppearance({ version: 2, shapes: [{ id: 'x', label: 'x', tokens: { paper: '#fff' } }] })).toThrow();
    const shape = { id: 'print', label: '排印', tokens: { 'font-prose': 'serif', 'radius-card': '0px' } };
    expect(parsePluginAppearance({ version: 2, shapes: [shape], presets: [{ id: 'print', label: '排印', shape: 'print' }] }).shapes).toEqual([shape]);
    for (const color of ['accent', 'syntax-blue', '#123456', 'currentColor']) {
      const input = appearance(); input.icons[0]!.icons.note.color = color;
      expect(parsePluginAppearance(input).icons?.[0]?.icons.note?.color).toBe(color);
    }
    for (const color of ['font-prose', 'var(--evil)', 'url(x)', 'unknown']) {
      const input = appearance(); input.icons[0]!.icons.note.color = color;
      expect(() => parsePluginAppearance(input)).toThrow();
    }
  });
  it('accepts layout-only plugins and rejects unbounded geometry or arbitrary CSS', () => {
    const layout = { id: 'desk', label: '工作台', structure: 'islands', surface: 'flat', gap: 12, pageWidth: 960 };
    expect(parsePluginAppearance({ version: 2, layouts: [layout] }).layouts).toEqual([layout]);
    for (const change of [{ structure: 'script' }, { structure: ['islands'] }, { surface: 'url(x)' }, { gap: -1 }, { gap: 33 }, { pageWidth: 4000 }, { pageWidth: null }, { css: 'body{display:none}' }]) {
      expect(() => parsePluginAppearance({ version: 2, layouts: [{ ...layout, ...change }] })).toThrow();
    }
  });
  it.each(['continuous', 'islands', 'document'].flatMap(structure =>
    ['flat', 'paper'].map(surface => ({ structure, surface }))))('checks layout combination $structure × $surface', ({ structure, surface }) => {
    const parse = () => parsePluginAppearance({ version: 2, layouts: [{ id: 'x', label: 'X', structure, surface }] });
    const supported = ['continuous:flat', 'islands:flat', 'document:paper'];
    if (supported.includes(`${structure}:${surface}`)) expect(parse().layouts?.[0]).toMatchObject({ structure, surface });
    else expect(parse).toThrow(`不支持此布局与材质组合：${structure} × ${surface}`);
  });
  it('rejects the retired notebook structure and skeuomorphic surface with a clear message', () => {
    expect(() => parsePluginAppearance({ version: 2, layouts: [{ id: 'x', label: 'X', structure: 'notebook', surface: 'skeuomorphic' }] }))
      .toThrow('笔记本布局已停止支持');
    expect(() => parsePluginAppearance({ version: 2, layouts: [{ id: 'x', label: 'X', structure: 'document', surface: 'skeuomorphic' }] }))
      .toThrow('布局风格无效');
  });
  it.each([{ light: { paper: '#fff' }, dark: { paper: '#111' } }, { light: {} }, { dark: { paper: '#111' } }])('preserves supported modes without synthesizing absent palettes: %s', modes => {
    const color = { id: 'sample', label: '样例', ...modes };
    const pkg = parsePluginPackage(JSON.stringify({ packageVersion: 1, manifest: { ...manifest(), appearance: { version: 2, colors: [color] } } }));
    expect(pkg.manifest.appearance?.colors).toEqual([color]);
  });
  it.each([{}, { light: null }, { dark: [] }, { light: {}, dark: false }])('rejects absent or malformed mode definitions: %s', modes => {
    expect(() => parsePluginAppearance({ version: 2, colors: [{ id: 'sample', label: '样例', ...modes }] })).toThrow();
  });
  it.each([
    { paper: 'url(https://evil.test)' }, { paper: '#fff;display:none' }, { position: 'fixed' },
    { 'font-ui': 'url(data:text/html,)' }, { 'font-ui': 'sans-serif; color:red' },
    { 'radius-control': '200px' }, { 'space-control-y': '-10px' }, { 'space-panel': '0px' },
    { 'dialog-shadow': '0px 0px 10000px #000' }, { 'dialog-shadow': '0px 0px -2px #000' },
  ])('rejects unsafe or out-of-contract tokens: %s', value => expect(() => parseThemeTokens(value)).toThrow());
  it('rejects unknown versions, missing modes, duplicate IDs and malformed vectors', () => {
    const source = appearance();
    for (const input of [{ ...source, version: 1 }, { ...source, version: 3 }, { version: 2 }, { ...source, colors: [source.colors[0], source.colors[0]] },
      { ...source, colors: [{ id: 'x', label: 'X' }] },
      { ...source, icons: [{ ...source.icons[0], file: 'missing' }] },
      { ...source, icons: [{ ...source.icons[0], icons: { x: { color: '#fff', paths: ['<script>'] } } }] },
      { ...source, icons: [{ ...source.icons[0], fileNames: { 'A.md': 'note', 'a.MD': 'note' } }] },
    ]) expect(() => parsePluginAppearance(input)).toThrow();
  });
  it('copies nested contributions and accepts bounded typography, spacing and shadows', () => {
    const input = appearance(), parsed = parsePluginAppearance(input);
    input.colors[0]!.light.paper = '#000'; input.icons[0]!.icons.note.paths.push('M0 0');
    expect(parsed.colors![0]!.light?.paper).toBe('#fff'); expect(parsed.icons![0]!.icons.note!.paths).toHaveLength(1);
    expect(parseThemeTokens({ 'font-ui': "'思源黑体', sans-serif", 'radius-card': '0px', 'space-panel': '24px', 'overlay-shadow': '0px 2px 4px #0008, 1px 1px 0px #fff' })).toBeDefined();
  });
});
