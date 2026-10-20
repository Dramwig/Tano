import {
  isObjectPath,
  objectDirectory,
  parseObject,
  objectTypeRegistry,
  validateObjectProperties,
} from '@tano/protocol';
import type { FileSnapshot, Workspace, WorkspaceAdapter, WorkspaceObject } from '@tano/protocol';
import { mergeDescription } from './description-merge';

export interface ObjectRecord {
  object: WorkspaceObject;
  path: string;
  snapshot: FileSnapshot;
  /** View metadata only; never serialized into a workspace object. */
  source?: { scope: 'personal' | 'workspace'; id: string; name: string };
}
export type ObjectStorage = Pick<WorkspaceAdapter, 'read' | 'write' | 'create' | 'refresh' | 'reserveObjectId'>;
export async function loadObjects(adapter: Pick<ObjectStorage, 'read'>, workspace: Workspace) {
  const records: ObjectRecord[] = [],
    errors: string[] = [];
  for (const file of workspace.files.filter(
    (file) => file.kind === 'file' && file.path.startsWith(`${objectDirectory}/`) && isObjectPath(file.path),
  )) {
    try {
      const snapshot = await adapter.read(file.path);
      const object = parseObject(snapshot.content);
      const definition = objectTypeRegistry.get(object.type);
      if (definition && !definition.retired) {
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
import { mergeWorkspaceObject } from '@tano/protocol';
export const mergeObject = (base: WorkspaceObject, ours: WorkspaceObject, theirs: WorkspaceObject) => mergeWorkspaceObject(base, ours, theirs, mergeDescription);
export async function saveObject(
  adapter: Pick<ObjectStorage, 'write'> & Partial<Pick<ObjectStorage, 'create'>>,
  record: ObjectRecord,
  draft: WorkspaceObject,
) {
  const ours = parseObject(JSON.stringify(draft));
  validateObjectProperties(ours.type, ours.properties);
  let current = record.snapshot;
  for (let attempt = 0; attempt < 3; attempt++) {
    const merged = mergeObject(record.object, ours, parseObject(current.content));
    if (!merged) {
      if (adapter.create) {
        const copy = `.tano/conflicts/object-${ours.id}-${crypto.randomUUID()}.tano.json`;
        try {
          await adapter.create(copy, JSON.stringify(ours, null, 2) + '\n');
        } catch (reason) {
          throw new Error(`对象已被外部修改且存在冲突；外部版本未覆盖，冲突副本未能保存，当前草稿仍保留：${String(reason)}`);
        }
        throw new Error(`对象已被外部修改且存在冲突；外部版本未覆盖，当前草稿已保留在 ${copy}`);
      }
      throw new Error('对象已被外部修改且存在冲突；你的草稿仍保留，可另存为对象副本。');
    }
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
