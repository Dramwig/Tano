import { basename, isWorkspaceInternalPath, parentPath, type FileEntry } from '@tano/protocol';

export const folderHomeFileNames = ['README.md', '_index.md', 'index.md'] as const;
export type FolderHomeFileName = typeof folderHomeFileNames[number] | '';

/** Only actual, direct children qualify. Root documents have no folder row to replace. */
export function indexFolderHomes(entries: readonly FileEntry[], filename: FolderHomeFileName = 'README.md') {
  const homes = new Map<string, FileEntry>();
  if (!filename) return homes;
  const directories = new Set(entries.filter(entry => entry.kind === 'directory' && !isWorkspaceInternalPath(entry.path)).map(entry => entry.path));
  for (const entry of entries) {
    if (entry.kind === 'file' && basename(entry.path) === filename && directories.has(parentPath(entry.path)))
      homes.set(parentPath(entry.path), entry);
  }
  return homes;
}
