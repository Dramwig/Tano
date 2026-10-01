export const defaultTableColumnWidth = 160;
export const minimumTableColumnWidth = 48;
export const tableColors = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const;
export type TableColor = typeof tableColors[number];

export interface TableLayout {
  id: string;
  widths: number[];
  backgrounds?: (TableColor | null)[][];
  foregrounds?: (TableColor | null)[][];
  anchor: { content: string; before: string; after: string };
}

export interface DocumentLayoutFile {
  version: 1;
  fileId: string;
  tables: TableLayout[];
}

export function documentLayoutPath(fileId: string) {
  if (!/^[0-9a-f]{6}$/.test(fileId)) throw new Error('文档身份无效');
  return `.tano/document-layout/${fileId}.tano.json`;
}

export function parseDocumentLayout(content: string, fileId: string): DocumentLayoutFile {
  documentLayoutPath(fileId);
  const file = JSON.parse(content) as DocumentLayoutFile;
  if (!file || file.version !== 1 || file.fileId !== fileId ||
      !Array.isArray(file.tables) || file.tables.length > 2000)
    throw new Error('表格布局文件格式或身份无效');
  const ids = new Set<string>();
  for (const table of file.tables) {
    if (!table || typeof table.id !== 'string' || !/^[0-9a-z-]{8,80}$/i.test(table.id) ||
        ids.has(table.id) || !Array.isArray(table.widths) || !table.widths.length ||
        table.widths.length > 1000 || table.widths.some(width =>
          !Number.isInteger(width) || width < minimumTableColumnWidth || width > 100_000) ||
        !table.anchor || typeof table.anchor.content !== 'string' || table.anchor.content.length > 8_000_000 ||
        typeof table.anchor.before !== 'string' || table.anchor.before.length > 80 ||
        typeof table.anchor.after !== 'string' || table.anchor.after.length > 80)
      throw new Error('表格列宽或锚点格式无效');
    ids.add(table.id);
    for (const colors of [table.backgrounds, table.foregrounds]) {
      if (colors !== undefined && (!Array.isArray(colors) || colors.length > 10000 ||
          colors.some(row => !Array.isArray(row) || row.length !== table.widths.length ||
            row.some(color => color !== null && !tableColors.includes(color)))))
        throw new Error('表格颜色格式无效');
    }
  }
  return file;
}
