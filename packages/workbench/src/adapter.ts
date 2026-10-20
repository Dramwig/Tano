import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open as chooseDirectory } from '@tauri-apps/plugin-dialog';
import type {
  FileEntry,
  FileChangeRequest,
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
  isMarkdown,
  parseObject,
  parseDataTable,
  isDataTablePath,
} from '@tano/protocol';
import { demoFiles } from './demo';
import { isAssistantFile, validAssistantDestination } from './assistant/files';

export const native = isTauri();
import { mobile } from './platform';
const DEMO_KEY = 'tano.demo.v2';
type DemoFiles = Record<string, { id: string; content: string; modified: number }>;
export interface DemoOptions {
  files?: Record<string, string>;
  storageKey?: string;
  name?: string;
  workspaceId?: string;
  workspacePath?: string;
}

export async function sha256(content: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class DemoAdapter implements WorkspaceAdapter {
  readonly mode = 'demo' as const;
  private files: DemoFiles;
  private folders: string[] = ['项目', '研究'];
  private readonly storageKey: string;
  private readonly workspaceName: string;
  private readonly workspaceId: string;
  private readonly workspacePath: string;
  constructor(options: DemoOptions = {}) {
    this.storageKey = options.storageKey ?? DEMO_KEY;
    this.workspaceName = options.name ?? '我的工作空间';
    this.workspaceId = options.workspaceId ?? 'demo';
    this.workspacePath = options.workspacePath ?? '浏览器演示 · 数据仅保存在本浏览器';
    const seed = options.files ?? demoFiles;
    if (options.files) {
      const folders = new Set<string>();
      for (const path of Object.keys(seed)) {
        let folder = parentPath(path);
        while (folder) { folders.add(folder); folder = parentPath(folder); }
      }
      this.folders = [...folders];
    }
    let saved: { files: DemoFiles; folders: string[] } | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(this.storageKey) ?? 'null');
    } catch {
      /* A corrupt demo cache is replaceable. */
    }
    const initialIds = new Set<string>();
    for (const [path, content] of Object.entries(seed)) {
      if (!isObjectPath(path)) continue;
      try { initialIds.add(parseObject(content).id); } catch { /* Invalid objects remain visible. */ }
    }
    const initialId = () => {
      const id = newShortId(initialIds);
      initialIds.add(id);
      return id;
    };
    this.files =
      saved?.files ??
      Object.fromEntries(
        Object.entries(seed).map(([path, content]) => [
          path,
          { id: initialId(), content, modified: Date.now() },
        ]),
      );
    this.folders = saved?.folders ?? this.folders;
    // Seeded demos need stable file IDs even before their first edit or session save.
    if (options.files && !saved?.files) this.persist();
  }
  private isTableStorage(path: string) {
    return isDataTablePath(path) || path.startsWith('.tano/conflicts/table-');
  }
  private syncFiles() {
    const stored = localStorage.getItem(this.storageKey);
    if (!stored) return;
    const data = JSON.parse(stored) as { files: DemoFiles; folders: string[] };
    if (!data.files || !Array.isArray(data.folders)) throw new Error('浏览器工作区数据损坏，原内容已保留');
    this.files = data.files;
    this.folders = data.folders;
  }
  private persist(tablePath?: string) {
    const stored = localStorage.getItem(this.storageKey);
    const data = stored ? JSON.parse(stored) as { files: DemoFiles; folders: string[] } : null;
    if (data) {
      if (!data.files || !Array.isArray(data.folders)) throw new Error('浏览器工作区数据损坏，原内容已保留');
      if (tablePath) {
        // A table transaction patches just its own file, retaining concurrent document edits.
        data.files[tablePath] = this.files[tablePath];
        localStorage.setItem(this.storageKey, JSON.stringify(data));
        this.files = data.files; this.folders = data.folders;
        return;
      }
      // Ordinary demo writes must never replace another tab's newer structured table.
      for (const path of Object.keys(this.files)) if (this.isTableStorage(path)) delete this.files[path];
      for (const [path, file] of Object.entries(data.files)) if (this.isTableStorage(path)) this.files[path] = file;
    }
    localStorage.setItem(this.storageKey, JSON.stringify({ files: this.files, folders: this.folders }));
  }
  private async rememberIds(occupied: string[] = [], allocate = false) {
    const reserve = () => {
      const used = new Set<string>(JSON.parse(localStorage.getItem(`${this.storageKey}.ids`) ?? '[]'));
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
      localStorage.setItem(`${this.storageKey}.ids`, JSON.stringify([...used]));
      return id;
    };
    return navigator.locks ? navigator.locks.request(`${this.storageKey}.ids`, reserve) : reserve();
  }
  async reserveObjectId(occupied: string[] = []) {
    return this.rememberIds(occupied, true);
  }
  async createAgentRecord(path: string, content: string) {
    this.check(path);
    const object = isDataTablePath(path) && !isWorkspaceInternalPath(path) ? parseDataTable(content) : parseObject(content);
    if (!(isDataTablePath(path) && !isWorkspaceInternalPath(path)) && path !== `.tano/objects/${object.id}.tano.json`) throw new Error('对象路径无效');
    if (!navigator.locks) throw new Error('安全预留对象身份需要 Web Locks');
    await navigator.locks.request(`${this.storageKey}.ids`, () => {
      const used = new Set<string>(JSON.parse(localStorage.getItem(`${this.storageKey}.ids`) ?? '[]'));
      if (used.has(object.id)) throw new Error('对象 ID 已被使用或预留，请重新生成建议');
      used.add(object.id); localStorage.setItem(`${this.storageKey}.ids`, JSON.stringify([...used]));
    });
    await this.create(path, content);
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
    const saved = localStorage.getItem(`${this.storageKey}.session.${workspaceId}`);
    if (!saved) return null;
    const value = JSON.parse(saved) as WorkspaceSession;
    if (value.version !== 1 || !Array.isArray(value.documents) || typeof value.activeId !== 'string')
      throw new Error('浏览器会话格式无效，恢复记录已保留');
    return value;
  }
  async saveSession(workspaceId: string, session: WorkspaceSession) {
    localStorage.setItem(`${this.storageKey}.session.${workspaceId}`, JSON.stringify(session));
  }
  async refresh(): Promise<Workspace> {
    this.syncFiles();
    await this.rememberIds();
    const files: FileEntry[] = await Promise.all(Object.entries(this.files).map(async ([path, file]) => ({
      id: file.id,
      path,
      name: basename(path),
      kind: 'file' as const,
      size: new TextEncoder().encode(file.content).length,
      modified: file.modified,
      contentHash: await sha256(file.content),
    })));
    for (const path of this.folders)
      files.push({
        id: `folder:${path}`,
        path,
        name: basename(path),
        kind: 'directory',
        size: 0,
        modified: 0,
      });
    return { id: this.workspaceId, name: this.workspaceName, path: this.workspacePath, files };
  }
  /** Browser-only resource bytes, kept with the file so moves preserve the attachment. */
  resource(path: string): { id: string; content: string } | null {
    this.check(path);
    const file = this.files[path];
    return file ? { id: file.id, content: file.content } : null;
  }
  async read(path: string): Promise<FileSnapshot> {
    this.check(path);
    this.syncFiles();
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
    let result: WriteResult = { status: 'missing' };
    await this.changeEntries(async () => {
      const file = this.files[path];
      if (!file) return;
      const snapshot = { content: file.content, hash: await sha256(file.content), modified: file.modified };
      if (snapshot.hash !== expectedHash) { result = { status: 'conflict', snapshot }; return; }
      const modified = Date.now();
      this.files[path] = { ...file, content, modified };
      result = { status: 'saved', snapshot: { content, hash: await sha256(content), modified } };
    });
    return result;
  }
  async create(path: string, content: string) {
    this.check(path);
    const id = await this.reserveObjectId();
    await this.changeEntries(() => {
      if (this.has(path)) throw new Error('同名文件或文件夹已经存在');
      if (!isWorkspaceDataPath(path) && parentPath(path) && !this.folders.includes(parentPath(path)))
        throw new Error('目标文件夹不存在，请先创建文件夹');
      this.files[path] = { id, content, modified: Date.now() };
    });
  }
  async createFolder(path: string) {
    const error = validatePath(path);
    if (error) throw new Error(error);
    return this.changeEntries(() => {
    if (this.has(path)) throw new Error('同名文件或文件夹已经存在');
    if (parentPath(path) && !this.folders.includes(parentPath(path)))
      throw new Error('父文件夹不存在');
    this.folders.push(path);
    });
  }
  async changeFile(request: FileChangeRequest): Promise<WriteResult> {
    return this.changeChecked(request, false);
  }
  async removeObjectFile(request: FileChangeRequest): Promise<WriteResult> {
    return this.changeChecked(request, true);
  }
  private async changeChecked(request: FileChangeRequest, objectDelete: boolean): Promise<WriteResult> {
    const workspace = await this.refresh();
    if (workspace.id !== request.workspaceId) throw new Error('工作区已切换');
    if (objectDelete ? (!/^\.tano\/objects\/[^/]+\.tano\.json$/.test(request.path) || !!validateStoragePath(request.path) || request.destination !== undefined) :
        (!isAssistantFile(request.path) || (request.destination !== undefined && !validAssistantDestination(request.path, request.destination))))
      throw new Error('只能操作普通 Markdown 文档或数据表，并保留文件类型');
    await this.rememberIds();
    let result: WriteResult = { status: 'missing' };
    await this.changeEntries(async () => {
      const file = this.files[request.path];
      if (!file) return;
      if (file.id !== request.fileId) throw new Error('文件身份已变化，请重新审阅');
      const snapshot = await this.read(request.path);
      if (snapshot.hash !== request.expectedHash) { result = { status: 'conflict', snapshot }; return; }
      if (this.files[request.path]?.id !== file.id || this.files[request.path]?.content !== snapshot.content) throw new Error('文件已变化，请重新审阅');
      const destination = request.destination;
      if (destination !== undefined) {
        if (this.has(destination)) throw new Error('目标名称已经存在');
        if (parentPath(destination) && !this.folders.includes(parentPath(destination))) throw new Error('目标文件夹不存在');
        this.files[destination] = file;
      }
      delete this.files[request.path];
      result = { status: 'saved', snapshot };
    });
    return result;
  }
  async rename(from: string, to: string) {
    await this.move(from, to, 'file');
  }
  /** File-tree mutations share the table-write lock, including moves of containing folders. */
  private async changeEntries(change: () => void | Promise<void>) {
    const run = async () => {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const data = JSON.parse(stored) as { files: DemoFiles; folders: string[] };
        if (!data.files || !Array.isArray(data.folders)) throw new Error('浏览器工作区数据损坏，原内容已保留');
        this.files = data.files; this.folders = data.folders;
      }
      const beforeFiles = { ...this.files }, beforeFolders = [...this.folders];
      try {
        await change();
        localStorage.setItem(this.storageKey, JSON.stringify({ files: this.files, folders: this.folders }));
      } catch (error) {
        this.files = beforeFiles; this.folders = beforeFolders;
        throw error;
      }
    };
    if (navigator.locks) return navigator.locks.request(`${this.storageKey}.tables`, run);
    if (Object.keys(this.files).some(path => this.isTableStorage(path)))
      throw new Error('此浏览器不支持安全的数据表写入，请使用支持 Web Locks 的浏览器');
    return run();
  }
  async move(from: string, to: string, kind: FileEntry['kind']) {
    this.check(from);
    this.check(to);
    return this.changeEntries(() => {
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
    });
  }
  async remove(path: string, expected?: { id: string; content: string }) {
    this.check(path);
    await this.rememberIds();
    return this.changeEntries(() => {
    if (expected && (this.files[path]?.id !== expected.id || this.files[path]?.content !== expected.content))
      throw new Error('文件已变化，请重新审阅');
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
    });
  }
  async reveal() {
    throw new Error('请运行桌面版以打开真实工作文件夹');
  }
  async watch(callback: () => void) {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== this.storageKey || !event.newValue) return;
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
  createAgentRecord = (path: string, content: string) => invoke<void>('create_agent_record', { path, content });
  async open(savedPath?: string): Promise<Workspace | null> {
    if (mobile && !savedPath) return { ...await invoke<Workspace>('open_mobile_workspace', { name: null }), canDelete: true };
    const path =
      savedPath ??
      (await chooseDirectory({
        directory: true,
        multiple: false,
        title: '选择 Tano 工作文件夹',
      }));
    if (typeof path !== 'string') return null;
    return { ...await invoke<Workspace>('open_workspace', { path }), canDelete: true };
  }
  createWorkspace = async (name: string) => ({ ...await invoke<Workspace>('open_mobile_workspace', { name }), canDelete: true });
  deleteWorkspace = (workspaceId: string) => invoke<void>('unregister_workspace', { workspaceId });
  async close(workspaceId: string) {
    await invoke<void>('close_workspace', { workspaceId });
  }
  recent = () => invoke<RecentWorkspace[]>('recent_workspaces');
  loadSession = (workspaceId: string) =>
    invoke<WorkspaceSession | null>('load_session', { workspaceId });
  saveSession = (workspaceId: string, session: WorkspaceSession) =>
    invoke<void>('save_session', { workspaceId, session });
  refresh = async () => ({ ...await invoke<Workspace>('refresh_workspace'), canDelete: true });
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
  changeFile = (request: FileChangeRequest) => invoke<WriteResult>('change_assistant_file', { request });
  removeObjectFile = (request: FileChangeRequest) => invoke<WriteResult>('delete_workspace_object', { request });
  reveal = () => invoke<void>('reveal_workspace');
  async watch(callback: () => void) {
    return listen('workspace-changed', callback);
  }
}
