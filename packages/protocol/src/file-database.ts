import type { FileMetadata } from './file-metadata';
import type { WorkspaceFile } from './file-core';
export interface FileDatabaseFilter { field: string; operator: 'contains' | 'equals' | 'empty'; value: string }
export interface FileDatabaseQuery {
  directory: string;
  recursive: boolean;
  filters: FileDatabaseFilter[];
  sort: { field: string; direction: 'asc' | 'desc' };
  groupBy: string;
}
export const defaultFileDatabaseQuery = (directory = ''): FileDatabaseQuery => ({
  directory, recursive: true, filters: [], sort: { field: 'path', direction: 'asc' }, groupBy: '',
});
export function validateFileDatabaseQuery(value: FileDatabaseQuery) {
  const field = (key: unknown) => typeof key === 'string' && /^(path|name|type|size|modified|tags|property:[\s\S]{1,100})$/.test(key);
  if (!value || typeof value !== 'object' || typeof value.directory !== 'string' || value.directory.length > 2000 || /[\u0000-\u001f]/.test(value.directory) ||
    (value.directory !== '' && (value.directory.includes('\\') || value.directory.split('/').some(p => !p || p === '.' || p === '..' || p === '.tano' || p.includes(':')))) ||
    typeof value.recursive !== 'boolean' || !Array.isArray(value.filters) || value.filters.length > 20 ||
    value.filters.some(f => !f || !field(f.field) || !['contains', 'equals', 'empty'].includes(f.operator) || typeof f.value !== 'string' || f.value.length > 1000) ||
    !value.sort || !field(value.sort.field) || !['asc', 'desc'].includes(value.sort.direction) ||
    (value.groupBy !== '' && !field(value.groupBy))) throw new Error('文件数据库查询格式无效');
  return value;
}
export interface FileDatabaseRow { file: WorkspaceFile; metadata: FileMetadata }
export function fileDatabaseValue(row: FileDatabaseRow, field: string): string | number | boolean | null | string[] {
  if (field.startsWith('property:')) return Object.hasOwn(row.metadata.properties, field.slice(9)) ? row.metadata.properties[field.slice(9)]! : null;
  if (field === 'tags') return row.metadata.tags;
  if (field === 'type') return row.file.handlerId;
  if (field === 'size') return row.file.size;
  if (field === 'modified') return row.file.modified;
  if (field === 'name') return row.file.name;
  return row.file.path;
}
export function queryFileDatabase(rows: readonly FileDatabaseRow[], query: FileDatabaseQuery) {
  validateFileDatabaseQuery(query);
  const text = (v: ReturnType<typeof fileDatabaseValue>) => v === null ? '' : String(v).toLocaleLowerCase();
  return rows.filter(row => {
    if (row.file.path.startsWith('.tano/')) return false;
    const prefix = query.directory ? `${query.directory}/` : '';
    if (!row.file.path.startsWith(prefix) || (!query.recursive && row.file.path.slice(prefix.length).includes('/'))) return false;
    return query.filters.every(filter => {
      const value = fileDatabaseValue(row, filter.field);
      if (filter.operator === 'empty') return value === null || value === '' || (Array.isArray(value) && !value.length);
      const expected = filter.value.toLocaleLowerCase();
      const values = Array.isArray(value) ? value : [value];
      return values.some(v => filter.operator === 'equals' ? text(v) === expected : text(v).includes(expected));
    });
  }).sort((a, b) => {
    const av = fileDatabaseValue(a, query.sort.field), bv = fileDatabaseValue(b, query.sort.field);
    const order = typeof av === 'number' && typeof bv === 'number' ? av - bv : text(av).localeCompare(text(bv), 'zh-CN', { numeric: true });
    return (query.sort.direction === 'desc' ? -order : order) || a.file.id.localeCompare(b.file.id);
  });
}
export function groupFileDatabase(rows: readonly FileDatabaseRow[], field: string) {
  const groups = new Map<string, FileDatabaseRow[]>();
  for (const row of rows) {
    const value = field ? fileDatabaseValue(row, field) : '';
    const keys = Array.isArray(value) ? (value.length ? value : ['']) : [value === null ? '' : String(value)];
    for (const key of keys) {
      const group = groups.get(key);
      if (group) group.push(row); else groups.set(key, [row]);
    }
  }
  return [...groups].map(([name, rows]) => ({ name, rows }));
}
