import { parseRelations, referenceKey, relationKey, relationPath } from '@tano/protocol';
import type {
  FileSnapshot,
  RelationFile,
  Workspace,
  WorkspaceAdapter,
  WorkspaceRelation,
  ReferenceIdentity,
} from '@tano/protocol';

export async function loadRelations(adapter: WorkspaceAdapter, workspace: Workspace) {
  if (!workspace.files.some((file) => file.kind === 'file' && file.path === relationPath))
    return { snapshot: null, file: { version: 1 as const, relations: [] } };
  const snapshot = await adapter.read(relationPath);
  return { snapshot, file: parseRelations(snapshot.content) };
}
export type RelationChange = { add: WorkspaceRelation } | { remove: WorkspaceRelation } | {
  replace: { type: string; target: ReferenceIdentity; previous: WorkspaceRelation[]; next: WorkspaceRelation[] };
};

/** Row-level compare-and-swap. Independent edges merge; a changed edge is never silently removed. */
export async function saveRelationChange(
  adapter: WorkspaceAdapter,
  base: FileSnapshot | null,
  change: RelationChange,
) {
  let current = base;
  for (let attempt = 0; attempt < 4; attempt++) {
    const file: RelationFile = current
      ? parseRelations(current.content)
      : { version: 1, relations: [] };
    if ('add' in change) {
      const existing = file.relations.find((row) => relationKey(row) === relationKey(change.add));
      if (!existing) {
        if (file.relations.some((row) => row.id === change.add.id))
          throw new Error('关系 ID 已被占用，请重试');
        file.relations.push(change.add);
      }
    } else if ('remove' in change) {
      const existing = file.relations.find((row) => row.id === change.remove.id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(change.remove))
        throw new Error('这条关系已被外部修改，尚未移除；请检查最新关系后重试');
      file.relations = file.relations.filter((row) => row.id !== change.remove.id);
    } else {
      const replacement = change.replace;
      const matches = (row: WorkspaceRelation) => row.type === replacement.type && referenceKey(row.target) === referenceKey(replacement.target);
      const ordered = (rows: WorkspaceRelation[]) => JSON.stringify([...rows].sort((a, b) => a.id.localeCompare(b.id)));
      if (ordered(file.relations.filter(matches)) !== ordered(replacement.previous))
        throw new Error('这些关系已被外部修改，请刷新后重试');
      const retained = file.relations.filter(row => !matches(row));
      if (replacement.next.some(row => retained.some(existing => existing.id === row.id)))
        throw new Error('关系 ID 已被占用，请重试');
      file.relations = [...retained, ...replacement.next];
    }
    const content = JSON.stringify(file, null, 2) + '\n';
    parseRelations(content);
    if (current) {
      const result = await adapter.write(relationPath, content, current.hash);
      if (result.status === 'saved') return { file, snapshot: result.snapshot };
      if (result.status === 'missing') throw new Error('关系文件已被移除或移动，请刷新后重试');
      current = result.snapshot;
    } else {
      try {
        await adapter.create(relationPath, content);
      } catch (error) {
        try {
          current = await adapter.read(relationPath);
        } catch {
          throw error;
        }
        continue;
      }
      const snapshot = await adapter.read(relationPath);
      return { file: parseRelations(snapshot.content), snapshot };
    }
  }
  throw new Error('关系文件正在被其他程序修改，请稍后重试');
}
