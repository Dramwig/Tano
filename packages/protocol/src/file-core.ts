import type { FileEntry, Workspace } from './index';
import { isWorkspaceInternalPath } from './workspace-paths';

export type FilePreviewKind = 'markdown' | 'table' | 'image' | 'pdf' | 'csv' | 'json' | 'code' | 'text' | 'audio' | 'video' | 'binary';
export interface FileHandler {
  readonly id: string;
  readonly extensions: readonly string[];
  readonly mimeType: string;
  readonly preview: FilePreviewKind;
  readonly canEdit: boolean;
  /** Declarative host capabilities; never permissions granted by a file. */
  readonly permissions: readonly ('read' | 'write')[];
}
const handler = (id: string, extensions: string[], mimeType: string, preview: FilePreviewKind, canEdit = false): FileHandler =>
  Object.freeze({ id, extensions: Object.freeze(extensions), mimeType, preview, canEdit,
    permissions: Object.freeze(canEdit ? ['read', 'write'] as const : ['read'] as const) });
export const builtInFileHandlers: readonly FileHandler[] = Object.freeze([
  handler('table', ['table.json'], 'application/json', 'table', true),
  handler('markdown', ['md', 'markdown'], 'text/markdown', 'markdown', true),
  handler('pdf', ['pdf'], 'application/pdf', 'pdf'),
  ...Object.entries({ png: 'png', jpg: 'jpeg', jpeg: 'jpeg', gif: 'gif', webp: 'webp', avif: 'avif', bmp: 'bmp', svg: 'svg+xml' })
    .map(([ext, mime]) => handler(`image-${ext}`, [ext], `image/${mime}`, 'image')),
  handler('csv', ['csv', 'tsv'], 'text/csv', 'csv'),
  handler('json', ['json'], 'application/json', 'json'),
  handler('code', ['js', 'ts', 'jsx', 'tsx', 'vue', 'py', 'rs', 'css', 'html', 'htm', 'xml', 'yaml', 'yml', 'toml', 'ini', 'sh', 'sql', 'c', 'h', 'cpp', 'hpp', 'java', 'go', 'rb', 'php', 'ps1'], 'text/plain', 'code'),
  handler('text', ['txt', 'log'], 'text/plain', 'text'),
  handler('audio', ['mp3', 'wav', 'ogg', 'm4a', 'flac'], 'audio/*', 'audio'),
  handler('video', ['mp4', 'webm', 'mov'], 'video/*', 'video'),
]);
const binaryHandler = handler('binary', [], 'application/octet-stream', 'binary');
export class FileHandlerRegistry {
  constructor(readonly handlers: readonly FileHandler[] = builtInFileHandlers) {
    if (new Set(handlers.map(item => item.id)).size !== handlers.length) throw new Error('文件处理程序身份重复');
  }
  resolve(path: string): FileHandler {
    const name = path.toLowerCase();
    return this.handlers.find(item => item.extensions.some(ext => name.endsWith(`.${ext}`))) ?? binaryHandler;
  }
}
export const fileHandlers = new FileHandlerRegistry();
export interface WorkspaceFile extends FileEntry {
  workspaceId: string;
  kind: 'file';
  mimeType: string;
  handlerId: string;
  /** A missing hash means unknown; size/mtime must never authorize writes. */
  revision?: string;
}

/** Rebuildable index of adapter snapshots. The adapter alone owns persistent identity. */
export class FileRegistry {
  readonly files: readonly WorkspaceFile[];
  private readonly byId = new Map<string, WorkspaceFile>();
  private readonly byPath = new Map<string, WorkspaceFile>();
  constructor(readonly workspaceId: string, entries: readonly FileEntry[], handlers = fileHandlers) {
    for (const entry of entries) {
      if (entry.kind !== 'file') continue;
      if (this.byId.has(entry.id) || this.byPath.has(entry.path)) throw new Error('文件注册表包含重复身份或路径');
      const handler = handlers.resolve(entry.path);
      const file: WorkspaceFile = Object.freeze({ ...entry, kind: 'file', workspaceId,
        mimeType: handler.mimeType, handlerId: handler.id, revision: entry.contentHash });
      this.byId.set(file.id, file); this.byPath.set(file.path, file);
    }
    this.files = Object.freeze([...this.byId.values()]);
  }
  get(id: string) { return this.byId.get(id); }
  at(path: string) { return this.byPath.get(path); }
  userFiles() { return this.files.filter(file => !isWorkspaceInternalPath(file.path)); }
  static from(workspace: Workspace) { return new FileRegistry(workspace.id, workspace.files); }
}
