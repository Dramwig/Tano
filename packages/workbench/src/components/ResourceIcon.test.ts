// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { createApp, h, nextTick, reactive } from 'vue';
import { FileIconRegistry, fileIconRegistryKey } from '../file-icons/registry';
import FileTree from './FileTree.vue';
import FolderView from './FolderView.vue';
import WorkspaceBreadcrumb from './WorkspaceBreadcrumb.vue';
import ResourceIcon from './ResourceIcon.vue';

it('renders embedded artwork and light variants without document silhouettes or labels', async () => {
  const { readFileSync } = await import('node:fs');
  const { parsePluginPackage } = await import('@tano/protocol');
  const pkg = parsePluginPackage(readFileSync('examples/plugins/material-icon-theme/material-icon-theme-1.0.0.tano-plugin.json', 'utf8'));
  const theme = pkg.manifest.appearance!.icons![0]!;
  const name = Object.keys(theme.fileNames!).find(name => theme.icons[theme.fileNames![name]!]!.lightImage)!;
  const registry = new FileIconRegistry();
  const dispose = registry.register(theme); registry.select(theme.id);
  const root = document.createElement('div');
  const app = createApp({ render: () => h(ResourceIcon, { path: name }) });
  app.provide(fileIconRegistryKey, registry); app.mount(root);
  try {
    expect(root.querySelectorAll('image')).toHaveLength(2);
    expect(root.querySelector('image')?.getAttribute('href')).toMatch(/^data:image\/png;base64,/);
    expect(root.querySelectorAll('path, text')).toHaveLength(0);
    dispose(); await nextTick();
    expect(root.querySelectorAll('image')).toHaveLength(0);
    expect(root.querySelector('path')).not.toBeNull();
  } finally { app.unmount(); root.remove(); }
});

it('updates mounted tree icons when a theme is selected or removed, retaining document overrides', async () => {
  const root = document.createElement('div'); document.body.append(root);
  const registry = new FileIconRegistry();
  const app = createApp({ render: () => h(FileTree, {
    entries: ['notes.md', 'image.png', 'custom.md'].map(path => ({ id: path, path, name: path, kind: 'file' as const, modified: 0, size: 0 })),
    documentIcons: { 'custom.md': '🌿' },
  }) });
  app.provide(fileIconRegistryKey, registry);
  app.mount(root);
  try {
    expect(root.querySelector('[data-file-icon="image"]')?.getAttribute('width')).toBe('16');
    const dispose = registry.register({ id: 'test', label: 'Test', icons: { note: { color: 'syntax-blue', paths: ['M2 2h4'], silhouette: 'none' } }, fileExtensions: { md: 'note' } });
    registry.select('test'); await nextTick();
    expect(root.querySelector('[data-file-icon="note"]')).not.toBeNull();
    expect(root.querySelector('[data-file-icon="note"]')?.getAttribute('style')).toContain('var(--syntax-blue)');
    expect(root.querySelectorAll('[data-file-icon="note"] path')).toHaveLength(1);
    expect(root.querySelector('[data-file-icon="image"]')).not.toBeNull();
    expect(root.querySelector('[data-emoji]')?.getAttribute('data-emoji')).toBe('🌿');
    expect(root.querySelector('.lucide')).toBeNull();
    dispose(); await nextTick();
    expect(root.querySelector('[data-file-icon="note"]')).toBeNull();
    expect(root.querySelector('[data-file-icon="markdown"]')).not.toBeNull();
  } finally { app.unmount(); root.remove(); }
});

it('keeps Office formats consistent across explorer, folder rows and breadcrumbs after renaming', async () => {
  const formats = [['方案.v2.doc', 'word'], ['方案.DOCX', 'word'], ['预算.xls', 'spreadsheet'],
    ['预算.XLSX', 'spreadsheet'], ['汇报.ppt', 'slides'], ['汇报.PPTX', 'slides']] as const;
  const entries = reactive(formats.map(([path], index) => ({ id: String(index), path: String(path), name: String(path),
    kind: 'file' as const, size: (index + 1) * 1024 * 1024, modified: 0 })));
  const root = document.createElement('div'); document.body.append(root);
  const app = createApp({ render: () => h('div', [
    h(FileTree, { entries }),
    h(FolderView, { entries, directory: { path: '', name: 'Office', missing: false } }),
    ...entries.map(file => h(WorkspaceBreadcrumb, { key: file.id, entries, workspaceName: 'Office', path: file.path })),
  ]) });
  app.mount(root);
  try {
    const assertIcon = (path: string, id: string) => {
      const tree = [...root.querySelectorAll('.tree-row')].find(row => row.getAttribute('title') === path)!;
      const folder = [...root.querySelectorAll('.folder-view-entry')].find(row => row.getAttribute('data-path') === path)!;
      const crumb = [...root.querySelectorAll('.breadcrumb-current')].find(row => row.getAttribute('aria-label') === path)!;
      for (const [row, size] of [[tree, '16'], [folder, '16'], [crumb, '14']] as const) {
        const icon = row.querySelector('svg')!;
        expect(icon.getAttribute('data-file-icon')).toBe(id);
        expect(icon.getAttribute('width')).toBe(size);
        expect(icon.getAttribute('height')).toBe(size);
      }
    };
    for (const [path, id] of formats) assertIcon(path, id);
    entries[0].path = entries[0].name = '更名.xlsx';
    await nextTick();
    assertIcon('更名.xlsx', 'spreadsheet');
  } finally { app.unmount(); root.remove(); }
});
