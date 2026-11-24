import { isWorkspaceViewPath, parseWorkspaceView, workspaceViewPath } from '@tano/protocol';
import type { FileSnapshot, Workspace, WorkspaceAdapter, WorkspaceViewDefinition } from '@tano/protocol';

/** A parsed portable view and the revision of the definition file that supplied it. */
export interface WorkspaceViewRecord {
  view: WorkspaceViewDefinition;
  path: string;
  snapshot: FileSnapshot;
}

/**
 * Load only portable view definitions from the current workspace.
 *
 * A malformed or cross-workspace view is reported while the source file stays
 * untouched. View files are projections and can be rebuilt; they never become
 * an alternate content store.
 */
export async function loadWorkspaceViews(adapter: Pick<WorkspaceAdapter, 'read'>, workspace: Workspace) {
  const records: WorkspaceViewRecord[] = [];
  const errors: string[] = [];
  for (const file of workspace.files.filter(
    (entry) => entry.kind === 'file' && isWorkspaceViewPath(entry.path),
  )) {
    try {
      const snapshot = await adapter.read(file.path);
      const view = parseWorkspaceView(snapshot.content);
      if (workspaceViewPath(view.id) !== file.path) {
        errors.push(`${file.path}：视图文件名必须与稳定视图 ID 一致，已跳过`);
        continue;
      }
      if (view.workspaceId !== workspace.id) {
        errors.push(`${file.path}：视图属于其他工作区，已跳过`);
        continue;
      }
      records.push({ view, path: file.path, snapshot });
    } catch (error) {
      errors.push(`${file.path}：${String(error)}`);
    }
  }
  const ids = new Map<string, number>();
  for (const record of records) ids.set(record.view.id, (ids.get(record.view.id) ?? 0) + 1);
  for (const [id, count] of ids)
    if (count > 1) errors.push(`视图 ID ${id} 重复，已停用重复定义`);
  return {
    records: records.filter((record) => ids.get(record.view.id) === 1),
    errors,
  };
}
