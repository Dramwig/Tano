// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { DemoAdapter } from './adapter';
import { rewriteImportLinks, writeWorkspaceImport } from './workspace-import';
import type { PreparedImport } from './document-import';

let adapter: DemoAdapter;
beforeEach(() => { localStorage.clear(); adapter = new DemoAdapter(); });
const prepared: PreparedImport = { pages: [
  { path: 'A.md', sourcePath: 'A.html', content: '[B](folder/B.html#heading)' },
  { path: 'folder/B.md', sourcePath: 'folder/B.html', content: '# B' },
], assets: [], issues: [] };

it('creates a new folder on collision without changing existing files, and rewrites links', async () => {
  await adapter.createFolder('Import');
  await adapter.create('Import/A.md', 'Original');
  const receipt = await writeWorkspaceImport(adapter, prepared, 'import', 'demo');
  expect(receipt.folder).toBe('import 2');
  expect(receipt.paths).toEqual(['import 2/A.md', 'import 2/folder/B.md']);
  expect((await adapter.read('Import/A.md')).content).toBe('Original');
  expect((await adapter.read('import 2/A.md')).content).toBe('[B](folder/B.md#heading)');
});

it('rewrites reference definitions and Obsidian links while preserving code and remote links', () => {
  const mapping = new Map([['vault/notes/b.html', 'Import/notes/B.md'], ['vault/notes/b.md', 'Import/notes/B.md'], ['vault/images/a.png', 'attachments/a.png']]);
  const content = '---\nrelated: "[[B]]"\n---\n\n[Ref][b]\n\n[b]: B.html "Title"\n\n[[B|Alias]] ![[../images/a.png]]\n\n`[[B]]`\n\n```md\n[B](B.md)\n```\n\n[Remote](https://example.com/B.md)';
  const result = rewriteImportLinks(content, 'vault/notes/A.md', 'Import/notes/A.md', mapping);
  expect(result).toContain('[b]: B.md "Title"');
  expect(result).toContain('related: "[[B]]"');
  expect(result).toContain('[Alias](B.md)');
  expect(result).toContain('![a.png](../../attachments/a.png)');
  expect(result).toContain('`[[B]]`');
  expect(result).toContain('```md\n[B](B.md)\n```');
  expect(result).toContain('https://example.com/B.md');
});

it('remaps Roam cross-page references to the generated page filenames', async () => {
  const { prepareImport } = await import('./document-import');
  const bytes = new TextEncoder().encode(JSON.stringify([{ title: 'First', children: [{ string: '[[Second]]' }] }, { title: 'Second', children: [] }]));
  const file = new File([bytes], 'Roam.json');
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
  const receipt = await writeWorkspaceImport(adapter, await prepareImport([file]), 'Import', 'demo');
  expect((await adapter.read(receipt.paths[0])).content).toContain('[Second](2-Second.md)');
});

it('reports partial failures and preserves successful pages', async () => {
  const create = adapter.create.bind(adapter);
  vi.spyOn(adapter, 'create').mockImplementation(async (path, content) => {
    if (path.endsWith('/A.md')) throw new Error('Write denied');
    return create(path, content);
  });
  const receipt = await writeWorkspaceImport(adapter, prepared, 'Import', 'demo');
  expect(receipt.paths).toEqual(['Import/folder/B.md']);
  expect(receipt.issues).toEqual([{ name: 'A.html', message: 'Write denied' }]);
  expect((await adapter.read('Import/folder/B.md')).content).toBe('# B');
});

it('rejects stale workspace, invalid destination, and read-only permission before mutation', async () => {
  const createFolder = vi.spyOn(adapter, 'createFolder');
  await expect(writeWorkspaceImport(adapter, prepared, 'Import', 'different')).rejects.toThrow('切换');
  await expect(writeWorkspaceImport(adapter, prepared, '../Import', 'demo')).rejects.toThrow('名称');
  const refresh = adapter.refresh.bind(adapter);
  vi.spyOn(adapter, 'refresh').mockImplementation(async () => ({ ...await refresh(), readOnly: true }));
  await expect(writeWorkspaceImport(adapter, prepared, 'Import', 'demo')).rejects.toThrow('阅读权限');
  expect(createFolder).not.toHaveBeenCalled();
});

it('uses the attachment service and remaps images to the saved workspace attachment', async () => {
  const importAsset = vi.fn(async () => 'attachments/image.png');
  const receipt = await writeWorkspaceImport(adapter, { pages: [{ sourcePath: 'A.md', path: 'A.md', content: '![Image](img.png)' }],
    assets: [{ sourcePath: 'img.png', file: new File(['image'], 'img.png') }], issues: [] }, 'Import', 'demo', { importAsset });
  expect(importAsset).toHaveBeenCalledOnce();
  expect((await adapter.read(receipt.paths[0])).content).toBe('![Image](../attachments/image.png)');
});
