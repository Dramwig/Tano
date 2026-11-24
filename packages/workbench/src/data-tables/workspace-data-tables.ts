import { isDataTablePath, isLegacyDataTablePath, parseDataTable } from '@tano/protocol';
import type { DataTable, FileSnapshot, Workspace, WorkspaceAdapter } from '@tano/protocol';

export interface DataTableRecord {
  fileId: string;
  table: DataTable;
  snapshot: FileSnapshot;
  path: string;
}
import { mergeDataTable } from '@tano/protocol';
export { mergeDataTable } from '@tano/protocol';
export class DataTableConflict extends Error {
  constructor(readonly copyPath: string) {
    super(
      `数据表存在重叠修改，外部内容已保留；你的版本已保存到 ${copyPath}。可另存副本后重新载入。`,
    );
  }
}
export async function loadDataTables(
  adapter: Pick<WorkspaceAdapter, 'read'>,
  workspace: Workspace,
) {
  const records: DataTableRecord[] = [],
    errors: string[] = [];
  for (const file of workspace.files.filter(
    (file) => file.kind === 'file' && isDataTablePath(file.path),
  )) {
    try {
      const snapshot = await adapter.read(file.path);
      records.push({
        fileId: file.id,
        table: parseDataTable(
          snapshot.content,
          isLegacyDataTablePath(file.path) ? file.path.split('/').at(-1)!.slice(0, 6) : undefined,
        ),
        path: file.path,
        snapshot,
      });
    } catch (error) {
      errors.push(`${file.path}：${String(error)}，原文件已保留`);
    }
  }
  return { records, errors };
}
export async function saveDataTable(
  adapter: Pick<WorkspaceAdapter, 'write' | 'create'>,
  record: DataTableRecord,
  draft: DataTable,
): Promise<DataTableRecord> {
  const ours = parseDataTable(JSON.stringify(draft), record.table.id);
  let snapshot = record.snapshot;
  for (let attempt = 0; attempt < 4; attempt++) {
    let merged: DataTable | null;
    try {
      merged = mergeDataTable(record.table, ours, parseDataTable(snapshot.content, ours.id));
    } catch {
      merged = null;
    }
    if (!merged) {
      const copyPath = `.tano/conflicts/table-${ours.id}-${crypto.randomUUID()}.tano.json`;
      await adapter.create(copyPath, JSON.stringify(ours, null, 2) + '\n');
      throw new DataTableConflict(copyPath);
    }
    const result = await adapter.write(
      record.path,
      JSON.stringify(merged, null, 2) + '\n',
      snapshot.hash,
    );
    if (result.status === 'saved')
      return { table: merged, snapshot: result.snapshot, path: record.path, fileId: record.fileId };
    if (result.status === 'missing') {
      const copyPath = `.tano/conflicts/table-${ours.id}-${crypto.randomUUID()}.tano.json`;
      await adapter.create(copyPath, JSON.stringify(ours, null, 2) + '\n');
      throw new DataTableConflict(copyPath);
    }
    snapshot = result.snapshot;
  }
  throw new Error('数据表持续被外部修改，请稍后重试；当前编辑仍保留');
}
