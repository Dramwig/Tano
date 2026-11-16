import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parsePluginPackage, parsePluginPolicy, canonicalPluginJson } from '../../packages/protocol/src/extensions';
import { FileIconRegistry } from '../../packages/workbench/src/file-icons/registry';

const content = readFileSync('examples/plugins/material-icon-theme/material-icon-theme-1.0.0.tano-plugin.json', 'utf8');

it('imports and reopens the complete offline Material theme through portable plugin rules', () => {
  const pkg = parsePluginPackage(content);
  const policy = parsePluginPolicy(JSON.stringify({ version: 1, plugins: [{ manifest: pkg.manifest, mode: 'optional', settings: {} }] }));
  const theme = policy.plugins[0]!.manifest.appearance!.icons![0]!;
  expect(pkg.source).toBeUndefined();
  expect(theme.notice).toContain('Copyright (c) 2025 Material Extensions');
  expect(theme.notice).toContain('Permission is hereby granted');
  expect(Object.keys(theme.icons).length).toBeGreaterThan(1000);
  expect(Object.keys(theme.folderNames!).length).toBeGreaterThan(4000);
  expect(canonicalPluginJson(pkg) + '\n').toBe(content);
  const registry = new FileIconRegistry();
  const dispose = registry.register(theme);
  registry.select(theme.id);
  const resolve = (path: string, directory = false, expanded = false) => registry.resolve({ path, kind: directory ? 'directory' : 'file', expanded });
  for (const name of ['notes.md', 'image.png', 'report.pdf', 'budget.xlsx', 'main.ts', 'view.vue', 'unknown.xyz']) {
    expect(resolve(name).icon.image).toMatch(/^data:image\/png;base64,/);
    expect(resolve(name).themeId).toBe(theme.id);
  }
  expect(resolve('PACKAGE.JSON').id).toBe(theme.fileNames!['package.json']);
  expect(resolve('types.d.ts').id).toBe(theme.fileExtensions!['d.ts']);
  expect(resolve('src', true).id).toBe(theme.folderNames!.src);
  expect(resolve('src', true, true).id).toBe(theme.folderNamesExpanded!.src);
  expect(resolve('src', true).id).not.toBe(resolve('src', true, true).id);
  expect(Object.values(theme.icons).some(icon => icon.lightImage)).toBe(true);
  dispose();
  expect(resolve('notes.md').themeId).toBe('builtin:tano');
});
