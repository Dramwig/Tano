import { invoke } from '@tauri-apps/api/core';
import { newShortId, parseObject, validateObjectProperties } from '@tano/protocol';
import type { FileSnapshot, Workspace, WriteResult } from '@tano/protocol';
import { sha256 } from './adapter';
import type { ObjectRecord, ObjectStorage } from './workspace-objects';

export const PERSONAL_PLANS_KEY = 'tano.personal-plans.v1';
export const planKey = (record: ObjectRecord) =>
  record.source?.scope === 'personal'
    ? `personal:${record.source.id}:${record.object.id}`
    : record.object.id;
export const planSourceLabel = (record: ObjectRecord) =>
  record.source?.scope === 'personal' ? '个人' : (record.source?.name ?? '工作区');

function checkPath(path: string) {
  if (!/^\.tano\/objects\/[0-9a-f]{6}\.tano\.json$/.test(path))
    throw new Error('无效的个人事项路径');
}
function checkContent(path: string, content: string) {
  const object = parseObject(content);
  if (object.type !== 'event' || path !== `.tano/objects/${object.id}.tano.json`)
    throw new Error('个人计划仅支持事件，且文件名必须与 ID 一致');
  validateObjectProperties(object.type, object.properties);
}
interface PersonalData {
  version: 1;
  id: string;
  files: Record<string, { content: string; modified: number }>;
  reserved: string[];
}

/** Separate from demo/workspace storage. Read fresh inside every write lock. */
export class BrowserPersonalPlans implements ObjectStorage {
  private load(): PersonalData {
    const text = localStorage.getItem(PERSONAL_PLANS_KEY);
    if (!text) return { version: 1, id: 'browser-personal', files: {}, reserved: [] };
    try {
      const data = JSON.parse(text) as PersonalData;
      if (
        data.version !== 1 ||
        data.id !== 'browser-personal' ||
        !data.files ||
        typeof data.files !== 'object' ||
        Array.isArray(data.files) ||
        !Array.isArray(data.reserved) ||
        !data.reserved.every((id) => typeof id === 'string' && /^[0-9a-f]{6}$/.test(id))
      )
        throw new Error();
      for (const [path, file] of Object.entries(data.files)) {
        checkPath(path);
        if (!file || typeof file.content !== 'string' || !Number.isFinite(file.modified))
          throw new Error();
      }
      return data;
    } catch {
      throw new Error('个人计划存储损坏，原数据已保留，请先恢复数据');
    }
  }
  private async mutate<T>(operation: () => Promise<T> | T): Promise<T> {
    if (!navigator.locks)
      throw new Error('此浏览器不支持安全保存个人计划，请使用支持 Web Locks 的浏览器');
    return navigator.locks.request(PERSONAL_PLANS_KEY, operation);
  }
  async refresh(): Promise<Workspace> {
    const data = this.load();
    return {
      id: data.id,
      name: '个人',
      path: '当前浏览器的个人计划',
      files: Object.entries(data.files).map(([path, file]) => ({
        id: path.split('/').at(-1)!.slice(0, 6),
        path,
        name: path.split('/').at(-1)!,
        kind: 'file',
        modified: file.modified,
        size: new TextEncoder().encode(file.content).length,
      })),
    };
  }
  async read(path: string): Promise<FileSnapshot> {
    checkPath(path);
    const file = this.load().files[path];
    if (!file) throw new Error('个人事项已不存在');
    return { ...file, hash: await sha256(file.content) };
  }
  async reserveObjectId(occupied: string[] = []) {
    return this.mutate(() => {
      const data = this.load();
      const used = new Set([
        ...data.reserved,
        ...occupied,
        ...Object.keys(data.files).map((path) => path.split('/').at(-1)!.slice(0, 6)),
      ]);
      const id = newShortId(used);
      data.reserved = [...used, id];
      localStorage.setItem(PERSONAL_PLANS_KEY, JSON.stringify(data));
      return id;
    });
  }
  async create(path: string, content: string) {
    checkPath(path);
    checkContent(path, content);
    return this.mutate(() => {
      const data = this.load();
      if (data.files[path]) throw new Error('个人事项已存在');
      data.files[path] = { content, modified: Date.now() };
      localStorage.setItem(PERSONAL_PLANS_KEY, JSON.stringify(data));
    });
  }
  async write(path: string, content: string, expectedHash: string): Promise<WriteResult> {
    checkPath(path);
    checkContent(path, content);
    return this.mutate(async () => {
      const data = this.load();
      const file = data.files[path];
      if (!file) return { status: 'missing' };
      const snapshot = { ...file, hash: await sha256(file.content) };
      if (snapshot.hash !== expectedHash) return { status: 'conflict', snapshot };
      const saved = { content, modified: Date.now() };
      data.files[path] = saved;
      localStorage.setItem(PERSONAL_PLANS_KEY, JSON.stringify(data));
      return { status: 'saved', snapshot: { ...saved, hash: await sha256(content) } };
    });
  }
}

export class NativePersonalPlans implements ObjectStorage {
  refresh = () => invoke<Workspace>('personal_plans_list');
  reserveObjectId = (occupied: string[]) => invoke<string>('personal_plans_reserve', { occupied });
  read = (path: string) => invoke<FileSnapshot>('personal_plans_read', { path });
  create = (path: string, content: string) =>
    invoke<void>('personal_plans_create', { path, content });
  write = (path: string, content: string, expectedHash: string) =>
    invoke<WriteResult>('personal_plans_write', { path, content, expectedHash });
}
