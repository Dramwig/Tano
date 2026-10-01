import { documentLayoutPath, parseDocumentLayout } from '@tano/protocol';
import type { DocumentLayoutFile, FileSnapshot, Workspace, WorkspaceAdapter } from '@tano/protocol';

export interface DocumentLayoutState {
  file: DocumentLayoutFile;
  base: FileSnapshot | null;
  error?: string;
  conflict?: { path: string; draft: string };
}

export class DocumentLayoutConflict extends Error {
  constructor(readonly path: string) {
    super(`表格布局发生冲突，外部版本未覆盖；当前布局已保留在 ${path}`);
  }
}

export async function loadDocumentLayout(adapter: WorkspaceAdapter, workspace: Workspace, fileId: string): Promise<DocumentLayoutState> {
  const path = documentLayoutPath(fileId);
  if (!workspace.files.some(file => file.kind === 'file' && file.path === path))
    return { file: { version: 1, fileId, tables: [] }, base: null };
  const base = await adapter.read(path);
  return { file: parseDocumentLayout(base.content, fileId), base };
}

export function layoutDirty(state: DocumentLayoutState) {
  return JSON.stringify(state.file) !== JSON.stringify(state.base
    ? parseDocumentLayout(state.base.content, state.file.fileId)
    : { version: 1, fileId: state.file.fileId, tables: [] });
}

/** Merge independent tables against the original base; conflicting layouts keep both files. */
export async function saveDocumentLayout(adapter: WorkspaceAdapter, state: DocumentLayoutState) {
  const draft = parseDocumentLayout(JSON.stringify(state.file), state.file.fileId);
  const path = documentLayoutPath(draft.fileId);
  const original = state.base ? parseDocumentLayout(state.base.content, draft.fileId)
    : { version: 1 as const, fileId: draft.fileId, tables: [] };
  let base = state.base;
  const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = base ? parseDocumentLayout(base.content, draft.fileId)
      : { version: 1 as const, fileId: draft.fileId, tables: [] };
    const merged = structuredClone(current);
    const ids = new Set([...original.tables, ...draft.tables].map(table => table.id));
    for (const id of ids) {
      const before = original.tables.find(table => table.id === id);
      const after = draft.tables.find(table => table.id === id);
      if (equal(before, after)) continue;
      const disk = current.tables.find(table => table.id === id);
      const competingIdentity = !before && after && !disk && current.tables.some(table =>
        table.id !== id && equal(table.anchor, after.anchor));
      if (competingIdentity || (!equal(before, disk) && !equal(after, disk))) {
        const copyPath = `.tano/conflicts/layout-${draft.fileId}-${crypto.randomUUID()}.json`;
        await adapter.create(copyPath, JSON.stringify(draft, null, 2) + '\n');
        throw new DocumentLayoutConflict(copyPath);
      }
      merged.tables = merged.tables.filter(table => table.id !== id);
      if (after) merged.tables.push(after);
    }
    const content = JSON.stringify(merged, null, 2) + '\n';
    if (base) {
      const result = await adapter.write(path, content, base.hash);
      if (result.status === 'saved') return { file: merged, base: result.snapshot };
      if (result.status === 'missing') throw new Error('表格布局文件已被外部移除，当前布局仍保留');
      base = result.snapshot;
    } else {
      try { await adapter.create(path, content); }
      catch (error) {
        try { base = await adapter.read(path); }
        catch { throw error; }
        continue;
      }
      const snapshot = await adapter.read(path);
      if (snapshot.content !== content) { base = snapshot; continue; }
      return { file: merged, base: snapshot };
    }
  }
  throw new Error('表格布局正在被其他程序修改，当前布局仍保留，请稍后重试');
}
