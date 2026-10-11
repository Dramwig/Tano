import { isDataTablePath, isLegacyDataTablePath, parseDataTable } from '@tano/protocol';
import type { DataTable, FileSnapshot, Workspace, WorkspaceAdapter } from '@tano/protocol';

export interface DataTableRecord {
  fileId: string;
  table: DataTable;
  snapshot: FileSnapshot;
  path: string;
}
const canonical = (value: unknown): string => {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
};
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const identified = (value: unknown): value is { id: string }[] =>
  Array.isArray(value) && value.every((item) => object(item) && typeof item.id === 'string');
/** Three-way merge by row/field/view identity and cell key, with deletion/edit conflicts. */
function mergeValue(base: unknown, ours: unknown, theirs: unknown): unknown {
  if (same(base, ours) || same(ours, theirs)) return theirs;
  if (same(base, theirs)) return ours;
  if (object(base) && object(ours) && object(theirs)) {
    const merged = Object.create(null) as Record<string, unknown>;
    for (const key of new Set([
      ...Object.keys(base),
      ...Object.keys(ours),
      ...Object.keys(theirs),
    ])) {
      const value = mergeValue(base[key], ours[key], theirs[key]);
      if (value !== undefined) merged[key] = value;
    }
    return merged;
  }
  if (identified(base) && identified(ours) && identified(theirs)) {
    const b = new Map(base.map((item) => [item.id, item])),
      o = new Map(ours.map((item) => [item.id, item])),
      t = new Map(theirs.map((item) => [item.id, item]));
    const ids = [...new Set([...theirs, ...ours, ...base].map((item) => item.id))];
    const values = new Map(ids.map((id) => [id, mergeValue(b.get(id), o.get(id), t.get(id))]));
    const survivors = new Set(
      base.filter((item) => o.has(item.id) && t.has(item.id)).map((item) => item.id),
    );
    const order = (items: { id: string }[]) =>
      items.map((item) => item.id).filter((id) => survivors.has(id));
    const bo = order(base),
      oo = order(ours),
      to = order(theirs);
    if (!same(bo, oo) && !same(bo, to) && !same(oo, to)) throw new Error('顺序冲突');
    const preferred = !same(bo, oo) ? ours : theirs;
    const orderedIds = [...new Set([...preferred.map((item) => item.id), ...ids])];
    return orderedIds.map((id) => values.get(id)).filter((item) => item !== undefined);
  }
  throw new Error('字段冲突');
}
export function mergeDataTable(
  base: DataTable,
  ours: DataTable,
  theirs: DataTable,
): DataTable | null {
  if (base.id !== ours.id || base.id !== theirs.id) return null;
  try {
    return parseDataTable(JSON.stringify(mergeValue(base, ours, theirs)), base.id);
  } catch {
    return null;
  }
}
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
