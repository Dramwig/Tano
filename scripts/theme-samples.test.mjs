import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { buildPlugin, verifyPlugin, protocol } from './plugin-build.mjs';

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}
function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }

it('ships a layout-only plugin with independently composable structures and materials', async () => {
  const directory = resolve('examples/plugins/theme-layouts');
  const built = await buildPlugin(directory);
  const shipped = await verifyPlugin(await readFile(resolve(directory, 'theme-layouts-1.0.0.tano-plugin.json'), 'utf8'));
  expect(shipped.integrity).toBe(built.integrity);
  expect(built.pkg.manifest.appearance.layouts).toHaveLength(2);
  expect(built.pkg.manifest.appearance.presets).toHaveLength(2);
  expect(new Set(built.pkg.manifest.appearance.layouts.map(layout => layout.structure))).toEqual(new Set(['islands', 'document']));
  expect(built.pkg.manifest.appearance.colors).toBeUndefined();
  expect(built.pkg.source).toBeUndefined();
});

it.each(['paper', 'tide', 'contrast'])('ships a reproducible, complete, readable %s theme package without executable code', async name => {
  const directory = resolve(`examples/plugins/theme-${name}`);
  const built = await buildPlugin(directory);
  const shipped = await verifyPlugin(await readFile(resolve(directory, `theme-${name}-1.0.0.tano-plugin.json`), 'utf8'));
  expect(shipped.integrity).toBe(built.integrity);
  expect(built.pkg.source).toBeUndefined(); expect(built.pkg.ui).toBeUndefined();
  const { themeColorTokens, themeShapeTokens } = await protocol();
  const appearance = built.pkg.manifest.appearance;
  expect(appearance.icons).toHaveLength(1);
  expect(appearance.presets.length).toBeGreaterThan(0);
  for (const preset of appearance.presets) {
    expect(preset.color).toBe(appearance.colors[0].id);
    if (preset.icons) expect(preset.icons).toBe(appearance.icons[0].id);
  }
  expect(Object.keys(appearance.shapes[0].tokens).sort()).toEqual([...themeShapeTokens].sort());
  for (const mode of ['light', 'dark']) {
    const tokens = appearance.colors[0][mode];
    expect(Object.keys(tokens).sort()).toEqual([...themeColorTokens].sort());
    for (const foreground of ['text', 'text-secondary', 'muted']) {
      for (const background of ['paper', 'sidebar', 'surface']) {
        expect(contrast(tokens[foreground], tokens[background]), `${mode} ${foreground}/${background}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    for (const background of ['green-fill', 'green-fill-hover']) {
      expect(contrast(tokens['on-accent'], tokens[background]), `${mode} on-accent/${background}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});
