export type { FileIconDefinition, FileIconTheme } from '@tano/protocol';

export interface FileIconResource {
  path: string;
  name?: string;
  kind?: 'file' | 'directory';
  expanded?: boolean;
  folderHome?: boolean;
}
