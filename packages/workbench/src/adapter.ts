import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open as chooseDirectory } from '@tauri-apps/plugin-dialog';
import type {
  FileEntry,
  FileSnapshot,
  Workspace,
  WorkspaceAdapter,
  WriteResult,
  RecentWorkspace,
  WorkspaceSession,
  SearchHit,
} from '@tano/protocol';
import {
  basename,
  parentPath,
  pathKey,
  validatePath,
  validateStoragePath,
  isWorkspaceDataPath,
  isWorkspaceInternalPath,
  newShortId,
  isObjectPath,
  parseObject,
} from '@tano/protocol';
import { demoFiles } from './demo';

export const native = isTauri();
import { mobile } from './platform';
const DEMO_KEY = 'tano.demo.v2';
type DemoFiles = Record<string, { id: string; content: string; modified: number }>;

export async function sha256(content: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class DemoAdapter implements WorkspaceAdapter {
  readonly mode = 'demo' as const;
  private files: DemoFiles;
  private folders: string[] = ['项目', '研究'];
  constructor() {
    let saved: { files: DemoFiles; folders: string[] } | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(DEMO_KEY) ?? 'null');
    } catch {
      /* A corrupt demo cache is replaceable. */
    }
    const initialIds = new Set<string>();
    const initialId = () => {
      const id = newShortId(initialIds);
      initialIds.add(id);
      return id;
    };
    this.files =
      saved?.files ??
      Object.fromEntries(
        Object.entries(demoFiles).map(([path, content]) => [
          path,
          { id: initialId(), content, modified: Date.now() },
        ]),
      );
    this.folders = saved?.folders ?? this.folders;
  }
  private persist() {
    localStorage.setItem(DEMO_KEY, JSON.stringify({ files: this.files, folders: this.folders }));
  }
  private async rememberIds(occupied: string[] = [], allocate = false) {
    const reserve = () => {
      const used = new Set<string>(JSON.parse(localStorage.getItem(`${DEMO_KEY}.ids`) ?? '[]'));
      for (const id of [...occupied, ...Object.values(this.files).map((file) => file.id)])
        used.add(id);
      for (const [path, file] of Object.entries(this.files)) {
        if (!isObjectPath(path)) continue;
        try {
          used.add(parseObject(file.content).id);
        } catch {
          /* Invalid objects remain unresolvable. */
        }
      }
      const id = allocate ? newShortId(used) : '';
      if (id) used.add(id);
      localStorage.setItem(`${DEMO_KEY}.ids`, JSON.stringify([...used]));
      return id;
    };
    return navigator.locks ? navigator.locks.request(`${DEMO_KEY}.ids`, reserve) : reserve();
  }
  async reserveObjectId(occupied: string[] = []) {
    return this.rememberIds(occupied, true);
  }
  private check(path: string) {
    const error = validateStoragePath(path);
    if (error) throw new Error(error);
  }
  private has(path: string) {
    return !!this.files[path] || this.folders.includes(path);
  }
  async open() {
    return this.refresh();
  }
  async loadSession(workspaceId: string): Promise<WorkspaceSession | null> {
    const saved = localStorage.getItem(`${DEMO_KEY}.session.${workspaceId}`);
    if (!saved) return null;
    const value = JSON.parse(saved) as WorkspaceSession;
    if (value.version !== 1 || !Array.isArray(value.documents) || typeof value.activeId !== 'string')
      throw new Error('浏览器会话格式无效，恢复记录已保留');
    return value;
  }
  async saveSession(workspaceId: string, session: WorkspaceSession) {
    localStorage.setItem(`${DEMO_KEY}.session.${workspaceId}`, JSON.stringify(session));
  }
  async refresh(): Promise<Workspace> {
    await this.rememberIds();
    const files: FileEntry[] = Object.entries(this.files).map(([path, file]) => ({
      id: file.id,
      path,
      name: basename(path),
      kind: 'file',
      size: new TextEncoder().encode(file.content).length,
      modified: file.modified,
    }));
    for (const path of this.folders)
      files.push({
        id: `folder:${path}`,
        path,
        name: basename(path),
        kind: 'directory',
        size: 0,
        modified: 0,
      });
    return { id: 'demo', name: '我的工作空间', path: '浏览器演示 · 数据仅保存在本浏览器', files };
  }
  async read(path: string): Promise<FileSnapshot> {
    this.check(path);
    const file = this.files[path];
    if (!file) throw new Error('文件已不存在');
    return { content: file.content, hash: await sha256(file.content), modified: file.modified };
  }
  async search(_workspaceId: string, query: string): Promise<SearchHit[]> {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return [];
    return Object.entries(this.files)
      .filter(([path]) => !isWorkspaceInternalPath(path))
      .filter(([path, file]) => `${path}\n${file.content}`.toLocaleLowerCase().includes(needle))
      .slice(0, 80)
      .map(([path, file]) => {
        const start = Math.max(0, file.content.toLocaleLowerCase().indexOf(needle) - 30);
        return { id: file.id, path, excerpt: file.content.slice(start, start + 150) };
      });
  }
  async write(path: string, content: string, expectedHash: string): Promise<WriteResult> {
    this.check(path);
    if (!this.files[path]) return { status: 'missing' };
    const current = await this.read(path);
    if (current.hash !== expectedHash) return { status: 'conflict', snapshot: current };
    const previous = this.files[path];
    this.files[path] = { ...previous, content, modified: Date.now() };
    try {
      this.persist();
    } catch (e) {
      this.files[path] = previous;
      throw e;
    }
    return { status: 'saved', snapshot: await this.read(path) };
  }
  async create(path: string, content: string) {
    this.check(path);
    if (this.has(path)) throw new Error('同名文件或文件夹已经存在');
    if (!isWorkspaceDataPath(path) && parentPath(path) && !this.folders.includes(parentPath(path)))
      throw new Error('目标文件夹不存在，请先创建文件夹');
    const id = await this.reserveObjectId();
    if (this.has(path)) throw new Error('同名文件或文件夹已经存在');
    this.files[path] = { id, content, modified: Date.now() };
    try {
      this.persist();
    } catch (e) {
      delete this.files[path];
      throw e;
    }
  }
  async createFolder(path: string) {
    const error = validatePath(path);
    if (error) throw new Error(error);
    if (this.has(path)) throw new Error('同名文件或文件夹已经存在');
    if (parentPath(path) && !this.folders.includes(parentPath(path)))
      throw new Error('父文件夹不存在');
    this.folders.push(path);
    try {
      this.persist();
    } catch (e) {
      this.folders.pop();
      throw e;
    }
  }
  async rename(from: string, to: string) {
    this.check(from);
    this.check(to);
    if (!this.files[from]) throw new Error('文件不存在');
    if (this.has(to)) throw new Error('目标名称已经存在');
    if (!isWorkspaceDataPath(to) && parentPath(to) && !this.folders.includes(parentPath(to)))
      throw new Error('目标文件夹不存在');
    const previous = this.files[from];
    this.files[to] = previous;
    delete this.files[from];
    try {
      this.persist();
    } catch (e) {
      this.files[from] = previous;
      delete this.files[to];
      throw e;
    }
  }
  async move(from: string, to: string, kind: FileEntry['kind']) {
    this.check(from);
    this.check(to);
    const isFolder = kind === 'directory';
    if (isFolder ? !this.folders.includes(from) : !this.files[from])
      throw new Error('文件已不存在');
    if (to === from || (isFolder && to.startsWith(`${from}/`)))
      throw new Error('不能将文件夹移动到自身或子文件夹');
    if (!isWorkspaceDataPath(to) && parentPath(to) && !this.folders.includes(parentPath(to)))
      throw new Error('目标文件夹不存在');
    const moving = (path: string) => path === from || (isFolder && path.startsWith(`${from}/`));
    const relocated = (path: string) => `${to}${path.slice(from.length)}`;
    const occupied = new Set(
      [...Object.keys(this.files), ...this.folders].filter((path) => !moving(path)).map(pathKey),
    );
    const moved = [...Object.keys(this.files), ...this.folders].filter(moving).map(relocated);
    for (const path of moved) {
      const error = validateStoragePath(path);
      if (error) throw new Error(error);
      const key = pathKey(path);
      if (occupied.has(key)) throw new Error('目标名称已经存在');
      occupied.add(key);
    }
    const previousFiles = this.files;
    const previousFolders = this.folders;
    this.files = Object.fromEntries(
      Object.entries(previousFiles).map(([path, file]) => [
        moving(path) ? relocated(path) : path,
        file,
      ]),
    );
    this.folders = previousFolders.map((path) => (moving(path) ? relocated(path) : path));
    try {
      this.persist();
    } catch (error) {
      this.files = previousFiles;
      this.folders = previousFolders;
      throw error;
    }
  }
  async remove(path: string) {
    this.check(path);
    await this.rememberIds();
    const previousFiles = this.files;
    const previousFolders = this.folders;
    const directory = this.folders.includes(path);
    if (!directory && !this.files[path]) throw new Error('文件已不存在');
    const removing = (entry: string) =>
      entry === path || (directory && entry.startsWith(`${path}/`));
    this.files = Object.fromEntries(
      Object.entries(this.files).filter(([entry]) => !removing(entry)),
    );
    this.folders = this.folders.filter((entry) => !removing(entry));
    try {
      this.persist();
    } catch (e) {
      this.files = previousFiles;
      this.folders = previousFolders;
      throw e;
    }
  }
  async reveal() {
    throw new Error('请运行桌面版以打开真实工作文件夹');
  }
  async watch(callback: () => void) {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== DEMO_KEY || !event.newValue) return;
      try {
        const data = JSON.parse(event.newValue);
        this.files = data.files;
        this.folders = data.folders;
        callback();
      } catch {
        /* Ignore invalid storage events. */
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }
}

export class NativeAdapter implements WorkspaceAdapter {
  readonly mode = 'desktop' as const;
  reserveObjectId = (occupied: string[]) => invoke<string>('reserve_reference_id', { occupied });
  async open(savedPath?: string): Promise<Workspace | null> {
    if (mobile && !savedPath) return invoke('open_mobile_workspace', { name: null });
    const path =
      savedPath ??
      (await chooseDirectory({
        directory: true,
        multiple: false,
        title: '选择 Tano 工作文件夹',
      }));
    if (typeof path !== 'string') return null;
    return invoke('open_workspace', { path });
  }
  createWorkspace = (name: string) => invoke<Workspace>('open_mobile_workspace', { name });
  async close(workspaceId: string) {
    await invoke<void>('close_workspace', { workspaceId });
  }
  recent = () => invoke<RecentWorkspace[]>('recent_workspaces');
  loadSession = (workspaceId: string) =>
    invoke<WorkspaceSession | null>('load_session', { workspaceId });
  saveSession = (workspaceId: string, session: WorkspaceSession) =>
    invoke<void>('save_session', { workspaceId, session });
  refresh = () => invoke<Workspace>('refresh_workspace');
  search = (workspaceId: string, query: string) =>
    invoke<SearchHit[]>('search_documents', { workspaceId, query });
  read = (path: string) => invoke<FileSnapshot>('read_document', { path });
  write = (path: string, content: string, expectedHash: string) =>
    invoke<WriteResult>('write_document', { path, content, expectedHash });
  create = (path: string, content: string) => invoke<void>('create_document', { path, content });
  createFolder = (path: string) => invoke<void>('create_folder', { path });
  rename = (from: string, to: string) => invoke<void>('rename_document', { from, to });
  move = (from: string, to: string, _kind: FileEntry['kind']) =>
    invoke<void>('move_entry', { from, to });
  duplicate = (workspaceId: string, path: string) =>
    invoke<string>('duplicate_workspace_entry', { workspaceId, path });
  remove = (path: string) => invoke<void>('remove_document', { path });
  reveal = () => invoke<void>('reveal_workspace');
  async watch(callback: () => void) {
    return listen('workspace-changed', callback);
  }
}
