/** Declarative vectors only: no HTML, remote assets, or executable components. */
export interface FileIconDefinition {
  color: string;
  paths: readonly string[];
  /** Optional compact format label on the document badge. */
  label?: string;
  /** Omit for a document outline; use none for a completely custom vector. */
  silhouette?: 'file' | 'folder' | 'folder-open' | 'none';
}

export interface FileIconTheme {
  id: string;
  label: string;
  icons: Readonly<Record<string, FileIconDefinition>>;
  file?: string;
  folder?: string;
  folderExpanded?: string;
  folderHome?: string;
  folderHomeExpanded?: string;
  fileNames?: Readonly<Record<string, string>>;
  /** No leading dot; compound extensions (table.json, d.ts) are supported. */
  fileExtensions?: Readonly<Record<string, string>>;
  folderNames?: Readonly<Record<string, string>>;
  folderNamesExpanded?: Readonly<Record<string, string>>;
}

export interface FileIconResource {
  path: string;
  name?: string;
  kind?: 'file' | 'directory';
  expanded?: boolean;
  folderHome?: boolean;
}
