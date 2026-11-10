import { computed } from 'vue';
import { describe, expect, it } from 'vitest';
import { FileIconRegistry, type FileIconTheme } from './registry';

describe('file icon themes', () => {
  it('distinguishes file formats, exact names, compound suffixes and folders', () => {
    const registry = new FileIconRegistry();
    const resolve = (path: string) => registry.resolve({ path }).id;
    expect(['notes.md', 'photo.PNG', 'report.pdf', 'book.docx', 'budget.xlsx', 'deck.pptx', 'movie.mp4', 'sound.mp3', 'bundle.tar.gz', 'data.json', 'tasks.TABLE.JSON', 'view.tsx', 'AGENTS.md', 'README.md', 'unknown.xyz', 'LICENSE']
      .map(resolve)).toEqual(['markdown', 'image', 'pdf', 'word', 'spreadsheet', 'slides', 'video', 'audio', 'archive', 'json', 'table', 'react', 'agents', 'readme', 'file', 'file']);
    expect(resolve('C:\\notes\\AGENTS.md')).toBe('agents');
    expect(registry.resolve({ path: 'archive.pdf', kind: 'directory' }).id).toBe('folder');
    expect(registry.resolve({ path: 'src', kind: 'directory', expanded: true }).id).toBe('folder-open');
    expect(registry.resolve({ path: 'src', kind: 'directory', expanded: true, folderHome: true }).id).toBe('folder-home-open');
    expect(resolve('constructor')).toBe('file');
  });

  const theme = (): FileIconTheme => ({ id: 'plugin.example', label: 'Example',
    icons: { custom: { color: '#aabbcc', paths: ['M2 2h4'] }, special: { color: '#123456', label: 'TS', paths: [] } },
    fileNames: { 'special.d.ts': 'special' }, fileExtensions: { ts: 'custom', 'd.ts': 'special' },
    folderNames: { src: 'custom' }, folderNamesExpanded: { src: 'special' },
  });

  it('updates reactive consumers, preserves default formats, and restores defaults on disposal', () => {
    const registry = new FileIconRegistry(), other = new FileIconRegistry();
    const icon = computed(() => registry.resolve({ path: 'a.ts' }));
    const dispose = registry.register(theme());
    expect(icon.value.id).toBe('typescript'); // registration does not activate a plugin
    registry.select('plugin.example');
    expect(icon.value.id).toBe('custom');
    expect(other.resolve({ path: 'a.ts' }).id).toBe('typescript');
    expect(registry.resolve({ path: 'a.d.ts' }).id).toBe('special');
    expect(registry.resolve({ path: 'photo.png' }).id).toBe('image');
    expect(registry.resolve({ path: 'src', kind: 'directory', expanded: true }).id).toBe('special');
    dispose(); dispose();
    expect(icon.value.id).toBe('typescript');
    expect(() => registry.select('plugin.example')).toThrow();
  });

  it('gives names priority over extensions and snapshots untrusted contributions', () => {
    const registry = new FileIconRegistry(), source = theme();
    source.fileNames = { 'special.ts': 'special' };
    registry.register(source); registry.select(source.id);
    source.fileNames = {};
    expect(registry.resolve({ path: 'SPECIAL.TS' }).id).toBe('special');
    expect(() => registry.register(theme())).toThrow('already registered');
    expect(() => registry.register({ ...theme(), id: 'broken', file: 'missing' })).toThrow('Unknown file icon');
    expect(() => registry.register({ ...theme(), id: 'unsafe', icons: { custom: { color: 'url(https://example.com)' as any, paths: [] } } })).toThrow('Invalid file icon');
    for (const image of ['https://example.com/icon.png', 'data:image/svg+xml;base64,PHN2Zy8+']) {
      expect(() => registry.register({ ...theme(), id: 'unsafe-image', icons: { custom: { color: 'currentColor', paths: [], image } } })).toThrow('Invalid file icon');
    }
    expect(() => registry.register({ ...theme(), id: 'builtin:tano' })).toThrow('already registered');
  });
});
