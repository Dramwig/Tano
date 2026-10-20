import { emptyFileMetadata, fileMetadataPath, parseFileMetadata } from '@tano/protocol';
import type { FileMetadata, FileSnapshot, Workspace, WorkspaceAdapter } from '@tano/protocol';
import { frontmatterProperties, frontmatterValue } from '@tano/editor/frontmatter-display';
export interface FileMetadataState { file: FileMetadata; base: FileSnapshot | null; referenceCount?: number }
/** Read-only projection; Markdown properties remain in the source document. */
export function markdownFileMetadata(id: string, content: string): FileMetadata {
  const file = emptyFileMetadata(id);
  for (const property of frontmatterProperties(content) ?? []) {
    const value = frontmatterValue(content, property.name);
    if (!value) continue;
    if (['tags', '标签'].includes(property.name)) {
      const tags: unknown = value.kind === 'list' ? JSON.parse(value.value) : value.value.split(/[,，]/);
      if (Array.isArray(tags)) file.tags.push(...tags.filter((tag): tag is string => typeof tag === 'string').map(tag => tag.trim()).filter(Boolean));
    } else if (!['object', 'list'].includes(value.kind)) {
      Object.defineProperty(file.properties, property.name, { enumerable: true, configurable: true, writable: true,
        value: value.kind === 'null' ? null : value.kind === 'number' ? Number(value.value) : value.kind === 'boolean' ? value.value === 'true' : value.value });
    }
  }
  file.tags = [...new Set(file.tags)];
  // Aliases are only for querying the common columns; never write them back.
  for (const [key, alias] of [['owner', '负责人'], ['status', '状态']]) {
    if (!Object.hasOwn(file.properties, key) && Object.hasOwn(file.properties, alias!)) file.properties[key!] = file.properties[alias!]!;
  }
  return file;
}
export async function loadFileMetadata(adapter: WorkspaceAdapter, workspace: Workspace, id: string): Promise<FileMetadataState> {
  const path = fileMetadataPath(id);
  if (!workspace.files.some(file => file.path === path)) return { file: emptyFileMetadata(id), base: null };
  const base = await adapter.read(path);
  return { file: parseFileMetadata(base.content, id), base };
}
/** Merge fields against the editor's immutable base; preserve both versions on overlap. */
export async function saveFileMetadata(adapter: WorkspaceAdapter, state: FileMetadataState): Promise<FileMetadataState> {
  const draft = parseFileMetadata(JSON.stringify(state.file), state.file.fileId);
  const original = state.base ? parseFileMetadata(state.base.content, draft.fileId) : emptyFileMetadata(draft.fileId);
  const path = fileMetadataPath(draft.fileId);
  let base = state.base;
  const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  for (let attempt = 0; attempt < 4; attempt++) {
    const disk = base ? parseFileMetadata(base.content, draft.fileId) : emptyFileMetadata(draft.fileId);
    const merged = structuredClone(disk);
    let conflict = false;
    for (const key of new Set([...Object.keys(original.properties), ...Object.keys(draft.properties)])) {
      const before = original.properties[key], after = draft.properties[key], current = disk.properties[key];
      if (equal(before, after)) continue;
      if (!equal(before, current) && !equal(after, current)) { conflict = true; break; }
      if (after === undefined) delete merged.properties[key]; else merged.properties[key] = after;
    }
    // Tags are a set: independent additions/removals commute.
    const removed = new Set(original.tags.filter(tag => !draft.tags.includes(tag)));
    merged.tags = [...new Set([...disk.tags.filter(tag => !removed.has(tag)), ...draft.tags.filter(tag => !original.tags.includes(tag))])];
    if (conflict) {
      const copy = `.tano/conflicts/file-${draft.fileId}-${crypto.randomUUID()}.tano.json`;
      await adapter.create(copy, JSON.stringify(draft, null, 2) + '\n');
      throw new Error(`文件属性发生冲突，外部版本未覆盖；你的版本已保留在 ${copy}`);
    }
    const content = JSON.stringify(parseFileMetadata(JSON.stringify(merged), draft.fileId), null, 2) + '\n';
    if (base) {
      const result = await adapter.write(path, content, base.hash);
      if (result.status === 'saved') return { file: merged, base: result.snapshot };
      if (result.status === 'missing') throw new Error('文件属性已被外部删除，当前修改仍保留');
      base = result.snapshot;
    } else {
      try { await adapter.create(path, content); }
      catch (error) { try { base = await adapter.read(path); } catch { throw error; } continue; }
      const snapshot = await adapter.read(path);
      if (snapshot.content !== content) { base = snapshot; continue; }
      return { file: merged, base: snapshot };
    }
  }
  throw new Error('文件属性正在被其他程序修改，请稍后重试');
}
