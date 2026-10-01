import { expect, it } from 'vitest';
import { documentLayoutPath, parseDocumentLayout } from '@tano/protocol';
import type { DocumentLayoutFile, FileSnapshot, WorkspaceAdapter } from '@tano/protocol';
import { loadDocumentLayout, saveDocumentLayout } from './workspace-document-layout';

const initial: DocumentLayoutFile = { version: 1, fileId: 'a12345', tables: [
  { id: 'table-one', widths: [160, 160], anchor: { content: 'one', before: '', after: '' } },
  { id: 'table-two', widths: [160, 160], anchor: { content: 'two', before: '', after: '' } },
] };
const snapshot = (file: DocumentLayoutFile): FileSnapshot => ({ content: JSON.stringify(file), hash: JSON.stringify(file), modified: 0 });
function storage(file?: DocumentLayoutFile) {
  const files = new Map<string, FileSnapshot>();
  if (file) files.set(documentLayoutPath(file.fileId), snapshot(file));
  const adapter = {
    read: async (path: string) => { const value = files.get(path); if (!value) throw new Error('missing'); return value; },
    create: async (path: string, content: string) => { if (files.has(path)) throw new Error('exists'); files.set(path, { content, hash: content, modified: 0 }); },
    write: async (path: string, content: string, expected: string) => {
      const current = files.get(path);
      if (!current) return { status: 'missing' as const };
      if (current.hash !== expected) return { status: 'conflict' as const, snapshot: current };
      const saved = { content, hash: content, modified: 0 };
      files.set(path, saved);
      return { status: 'saved' as const, snapshot: saved };
    },
  } as WorkspaceAdapter;
  return { adapter, files };
}

it('creates portable layout data and restores it by file ID after rename', async () => {
  const { adapter, files } = storage();
  await saveDocumentLayout(adapter, { file: initial, base: null });
  const loaded = await loadDocumentLayout(adapter, { id: 'workspace', name: '', path: '', files: [...files.keys()].map(path => ({ id: 'other-id', path, name: path, kind: 'file', size: 0, modified: 0 })) }, 'a12345');
  expect(loaded.file).toEqual(initial);
});

it('merges independent table edits after an external write', async () => {
  const external = structuredClone(initial);
  external.tables[1]!.widths = [200, 320];
  const { adapter } = storage(external);
  const local = structuredClone(initial);
  local.tables[0]!.widths = [80, 900];
  const saved = await saveDocumentLayout(adapter, { file: local, base: snapshot(initial) });
  expect(saved.file.tables.find(table => table.id === 'table-one')!.widths).toEqual([80, 900]);
  expect(saved.file.tables.find(table => table.id === 'table-two')!.widths).toEqual([200, 320]);
});

it('keeps the external layout and a local conflict copy when the same table changes', async () => {
  const external = structuredClone(initial);
  external.tables[0]!.widths = [200, 320];
  const { adapter, files } = storage(external);
  const local = structuredClone(initial);
  local.tables[0]!.widths = [80, 900];
  await expect(saveDocumentLayout(adapter, { file: local, base: snapshot(initial) })).rejects.toThrow('冲突');
  expect(parseDocumentLayout(files.get(documentLayoutPath('a12345'))!.content, 'a12345')).toEqual(external);
  const copy = [...files].find(([path]) => path.startsWith('.tano/conflicts/'))!;
  expect(parseDocumentLayout(copy[1].content, 'a12345')).toEqual(local);
});

it('preserves competing first-save layouts instead of merging two identities for the same table', async () => {
  const { adapter, files } = storage(initial);
  const local = structuredClone(initial);
  local.tables[0]!.id = 'another-id';
  local.tables[0]!.widths = [80, 900];
  await expect(saveDocumentLayout(adapter, { file: local, base: null })).rejects.toThrow('冲突');
  expect(parseDocumentLayout(files.get(documentLayoutPath('a12345'))!.content, 'a12345')).toEqual(initial);
});

it('rejects invalid pixel widths, identities, and duplicate table IDs', () => {
  for (const width of [0, 47, 1.5, 100_001, null]) {
    const file = structuredClone(initial);
    file.tables[0]!.widths[0] = width as number;
    expect(() => parseDocumentLayout(JSON.stringify(file), 'a12345')).toThrow();
  }
  expect(() => documentLayoutPath('../bad')).toThrow();
  expect(() => parseDocumentLayout(JSON.stringify({ ...initial, tables: [initial.tables[0], initial.tables[0]] }), 'a12345')).toThrow();
});
