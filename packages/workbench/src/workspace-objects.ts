import {
  isObjectPath,
  objectDirectory,
  parseObject,
  objectTypeRegistry,
  validateObjectProperties,
} from '@tano/protocol';
import type { FileSnapshot, Workspace, WorkspaceAdapter, WorkspaceObject } from '@tano/protocol';

export interface ObjectRecord {
  object: WorkspaceObject;
  path: string;
  snapshot: FileSnapshot;
}
export async function loadObjects(adapter: WorkspaceAdapter, workspace: Workspace) {
  const records: ObjectRecord[] = [],
    errors: string[] = [];
  for (const file of workspace.files.filter(
    (file) => file.kind === 'file' && file.path.startsWith(`${objectDirectory}/`) && isObjectPath(file.path),
  )) {
    try {
      const snapshot = await adapter.read(file.path);
      const object = parseObject(snapshot.content);
      if (objectTypeRegistry.get(object.type)) {
        try {
          validateObjectProperties(object.type, object.properties);
        } catch (error) {
          errors.push(`${file.path}：${String(error)}`);
        }
      }
      records.push({ object, path: file.path, snapshot });
    } catch (error) {
      errors.push(`${file.path}：${String(error)}`);
    }
  }
  const ids = new Map<string, number>();
  for (const record of records) ids.set(record.object.id, (ids.get(record.object.id) ?? 0) + 1);
  for (const [id, count] of ids)
    if (count > 1) errors.push(`对象 ID ${id} 重复，引用已停用；请修复重复文件`);
  return { records: records.filter((record) => ids.get(record.object.id) === 1), errors };
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Merge independently edited fields. Identity/type are immutable, never inferred from a title. */
export function mergeObject(
  base: WorkspaceObject,
  ours: WorkspaceObject,
  theirs: WorkspaceObject,
): WorkspaceObject | null {
  if (
    base.id !== ours.id ||
    base.id !== theirs.id ||
    base.type !== ours.type ||
    base.type !== theirs.type
  )
    return null;
  const merged = { ...theirs };
  for (const key of ['name', 'description', 'archived', 'properties'] as const) {
    if (key === 'properties') {
      const result: Record<string, unknown> = Object.assign(Object.create(null), theirs.properties);
      for (const field of new Set([
        ...Object.keys(base.properties),
        ...Object.keys(ours.properties),
      ])) {
        if (same(base.properties[field], ours.properties[field])) continue;
        if (
          !same(base.properties[field], theirs.properties[field]) &&
          !same(ours.properties[field], theirs.properties[field])
        )
          return null;
        if (Object.hasOwn(ours.properties, field)) result[field] = ours.properties[field];
        else delete result[field];
      }
      merged.properties = result;
    } else if (!same(base[key], ours[key])) {
      if (!same(base[key], theirs[key]) && !same(ours[key], theirs[key])) return null;
      Object.assign(merged, { [key]: ours[key] });
    }
  }
  return parseObject(JSON.stringify(merged));
}
export async function saveObject(
  adapter: WorkspaceAdapter,
  record: ObjectRecord,
  draft: WorkspaceObject,
) {
  const ours = parseObject(JSON.stringify(draft));
  validateObjectProperties(ours.type, ours.properties);
  let current = record.snapshot;
  for (let attempt = 0; attempt < 3; attempt++) {
    const merged = mergeObject(record.object, ours, parseObject(current.content));
    if (!merged) throw new Error('对象已被外部修改且存在冲突；你的草稿仍保留，可另存为对象副本。');
    validateObjectProperties(merged.type, merged.properties);
    const result = await adapter.write(
      record.path,
      JSON.stringify(merged, null, 2) + '\n',
      current.hash,
    );
    if (result.status === 'saved')
      return { object: merged, path: record.path, snapshot: result.snapshot };
    if (result.status === 'missing')
      throw new Error('对象已被移除或移动；草稿仍保留，请刷新后重试或另存副本。');
    current = result.snapshot;
  }
  throw new Error('对象正在被其他程序修改，草稿仍保留，请稍后重试。');
}
