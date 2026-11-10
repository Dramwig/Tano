// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { parsePluginPackage, parsePluginPolicy, canonicalPluginJson } from '../packages/protocol/src/extensions';
import { FileIconRegistry } from '../packages/workbench/src/file-icons/registry';
import { AppearanceController } from '../packages/workbench/src/appearance';

const content = readFileSync('examples/plugins/vscode-icons/vscode-icons-1.0.0.tano-plugin.json', 'utf8');
const pkg = parsePluginPackage(content);
const material = parsePluginPackage(readFileSync('examples/plugins/material-icon-theme/material-icon-theme-1.0.0.tano-plugin.json', 'utf8'));
afterEach(() => localStorage.clear());

it('imports the offline classic theme with correct artwork attribution and bounded packaging', () => {
  const theme = pkg.manifest.appearance!.icons![0]!;
  expect(pkg.source).toBeUndefined();
  expect(canonicalPluginJson(pkg) + '\n').toBe(content);
  expect(new TextEncoder().encode(content).length).toBeLessThan(4 * 1024 * 1024);
  expect(Object.keys(theme.icons).length).toBeGreaterThan(1200);
  expect(theme.notice).toContain('Copyright The vscode-icons Contributors');
  expect(theme.notice).toContain('https://creativecommons.org/licenses/by-sa/4.0/');
  expect(theme.notice).toContain('These artwork adaptations remain CC BY-SA 4.0');
  expect(theme.notice).toContain('Permission is hereby granted');
  expect(Object.values(theme.icons).some(icon => icon.lightImage)).toBe(true);
  const registry = new FileIconRegistry();
  const dispose = registry.register(theme); registry.select(theme.id);
  const resolve = (path: string, directory = false, expanded = false) => registry.resolve({path, kind:directory ? 'directory' : 'file', expanded});
  for (const name of ['notes.md', 'main.js', 'main.ts', 'main.py', 'view.tsx', 'photo.png', 'report.pdf', 'budget.xlsx']) {
    expect(resolve(name).id, name).not.toBe(theme.file);
    expect(resolve(name).icon.image).toMatch(/^data:image\/png;base64,/);
  }
  expect(resolve('PACKAGE.JSON').id).toBe(theme.fileNames!['package.json']);
  expect(resolve('package.json').id).not.toBe(resolve('arbitrary.json').id);
  expect(resolve('main.d.ts').id).not.toBe(resolve('main.ts').id);
  expect(resolve('src', true).id).toBe(theme.folderNames!.src);
  expect(resolve('src', true, true).id).toBe(theme.folderNamesExpanded!.src);
  expect(resolve('src', true).id).not.toBe(resolve('src', true, true).id);
  expect(resolve('unknown.xyz').id).toBe(theme.file);
  expect(resolve('xposed_init').id).toBe(theme.file);
  expect(theme.fileNames).not.toHaveProperty('xposed_init');
  dispose(); expect(resolve('notes.md').themeId).toBe('builtin:tano');
});

it('coexists with Material, persists independent selection, and restores it after re-enabling', () => {
  const policy = parsePluginPolicy(JSON.stringify({version:1, plugins:[pkg,material].map(({manifest}) => ({manifest,mode:'recommended',settings:{}}))}));
  const installed = policy.plugins.map(({manifest}) => ({manifest, enabled:true}));
  const registry = new FileIconRegistry();
  const controller = new AppearanceController(registry, 'test', localStorage, () => {});
  controller.sync('one', installed);
  expect(registry.resolve({path:'notes.md'}).themeId).toBe('builtin:tano');
  for (const id of ['vscode-icons:classic','material-icon-theme:material','vscode-icons:classic']) {
    controller.select({workspaceId:'one',kind:'icons',id});
    expect(registry.resolve({path:'notes.md'}).themeId).toBe(id);
  }
  controller.sync('one', installed.map(row => ({...row, enabled:row.manifest.id !== 'vscode-icons'})));
  expect(registry.resolve({path:'notes.md'}).themeId).toBe('builtin:tano');
  controller.sync('one', installed);
  expect(registry.resolve({path:'notes.md'}).themeId).toBe('vscode-icons:classic');
  controller.dispose();
  const reloaded = new AppearanceController(registry, 'test', localStorage, () => {});
  reloaded.sync('one', installed);
  expect(registry.resolve({path:'notes.md'}).themeId).toBe('vscode-icons:classic');
  reloaded.dispose();
}, 20000);
