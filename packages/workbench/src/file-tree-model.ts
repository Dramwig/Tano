import { isWorkspaceInternalPath, parentPath, type FileEntry } from '@tano/protocol';

const compareNames = new Intl.Collator('zh-CN', { numeric: true }).compare;
export interface FileTreeRow { file: FileEntry; depth: number; position: number; siblings: number }

export function indexFileTree(entries: readonly FileEntry[]) {
  const folders = new Map<string, FileEntry[]>();
  for (const file of entries) {
    if (isWorkspaceInternalPath(file.path)) continue;
    const parent = parentPath(file.path);
    const children = folders.get(parent) ?? [];
    if (!folders.has(parent)) folders.set(parent, children);
    children.push(file);
  }
  for (const children of folders.values()) children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    if (a.path === '开始使用.md') return -1;
    if (b.path === '开始使用.md') return 1;
    return compareNames(a.name, b.name);
  });
  return folders;
}

export function flattenFileTree(folders: ReadonlyMap<string, readonly FileEntry[]>, parent: string,
  depth: number, collapsed: (path: string) => boolean): FileTreeRow[] {
  const rows: FileTreeRow[] = [];
  const visit = (parent: string, depth: number) => {
    const children = folders.get(parent) ?? [];
    children.forEach((file, index) => {
      rows.push({ file, depth, position: index + 1, siblings: children.length });
      if (file.kind === 'directory' && !collapsed(file.path)) visit(file.path, depth + 1);
    });
  };
  visit(parent, depth);
  return rows;
}
