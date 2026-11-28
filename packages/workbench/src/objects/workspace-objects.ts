import {
  isObjectPath,
  objectDirectory,
  parseObject,
  objectTypeRegistry,
  validateObjectProperties,
} from '@tano/protocol';
import type { BatchReadItem, FileSnapshot, Workspace, WorkspaceAdapter, WorkspaceObject } from '@tano/protocol';
import { mergeObject } from '@tano/editor/workspace-objects';

export interface ObjectRecord {
  object: WorkspaceObject;
  path: string;
  snapshot: FileSnapshot;
  /** View metadata only; never serialized into a workspace object. */
  source?: { scope: 'personal' | 'workspace'; id: string; name: string };
}
export type ObjectStorage = Pick<
  WorkspaceAdapter,
  'read' | 'readBatch' | 'write' | 'create' | 'refresh' | 'reserveObjectId'
>;

export interface LoadObjectsOptions {
  /** Awaited after file reads complete and before schema validation runs. */
  beforeValidate?: () => Promise<void>;
  /** Previously loaded records; reused without disk/IPC reads when contentHash matches. */
  previous?: readonly ObjectRecord[];
  /** Concurrency limit when falling back to single-file adapter.read(). */
  concurrency?: number;
}

async function readSnapshots(
  adapter: Pick<ObjectStorage, 'read' | 'readBatch'>,
  paths: string[],
  concurrency: number,
): Promise<Map<string, BatchReadItem>> {
  const results = new Map<string, BatchReadItem>();
  if (!paths.length) return results;
  if (adapter.readBatch) {
    const batch = await adapter.readBatch(paths);
    for (const path of paths) {
      const item = batch[path];
      results.set(path, item ?? { ok: false, error: '文件读取结果缺失' });
    }
    return results;
  }
  const limit = Math.max(1, Math.min(concurrency, paths.length));
  let cursor = 0;
  const worker = async () => {
    while (cursor < paths.length) {
      const path = paths[cursor++]!;
      try {
        results.set(path, { ok: true, snapshot: await adapter.read(path) });
      } catch (error) {
        results.set(path, { ok: false, error: String(error) });
      }
    }
  };
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

export async function loadObjects(
  adapter: Pick<ObjectStorage, 'read' | 'readBatch'>,
  workspace: Workspace,
  options: LoadObjectsOptions = {},
) {
  const objectFiles = workspace.files.filter(
    (file) => file.kind === 'file' && file.path.startsWith(`${objectDirectory}/`) && isObjectPath(file.path),
  );
  const prevByPath = new Map<string, ObjectRecord>();
  if (options.previous?.length) {
    for (const record of options.previous) prevByPath.set(record.path, record);
  }
  const reused = new Map<string, ObjectRecord>();
  const toRead: string[] = [];
  for (const file of objectFiles) {
    const prev = prevByPath.get(file.path);
    if (prev && file.contentHash && prev.snapshot.hash === file.contentHash) {
      reused.set(file.path, prev);
    } else {
      toRead.push(file.path);
    }
  }
  const fetched = await readSnapshots(adapter, toRead, options.concurrency ?? 16);
  if (options.beforeValidate) await options.beforeValidate();

  const records: ObjectRecord[] = [];
  const errors: string[] = [];
  for (const file of objectFiles) {
    const existing = reused.get(file.path);
    if (existing) {
      const definition = objectTypeRegistry.get(existing.object.type);
      if (definition) {
        try {
          validateObjectProperties(existing.object.type, existing.object.properties);
        } catch (error) {
          errors.push(`${file.path}：${String(error)}`);
        }
      }
      records.push(existing);
      continue;
    }
    const item = fetched.get(file.path);
    if (!item || !item.ok) {
      errors.push(`${file.path}：${item ? item.error : '文件读取失败'}`);
      continue;
    }
    try {
      const object = parseObject(item.snapshot.content);
      const definition = objectTypeRegistry.get(object.type);
      if (definition) {
        try {
          validateObjectProperties(object.type, object.properties);
        } catch (error) {
          errors.push(`${file.path}：${String(error)}`);
        }
      }
      records.push({ object, path: file.path, snapshot: item.snapshot });
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
export { mergeObject };
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
