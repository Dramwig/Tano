import { basename, pathKey, validatePath } from './paths';

/** Portable structured tables. Rows are records, never automatically-created documents. */
export type DataFieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'checkbox'
  | 'select'
  | 'multiselect'
  | 'url'
  | 'attachment'
  | 'formula';
export type DataValue = string | number | boolean | string[] | null;
export const dataOptionColors = [
  'default',
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
] as const;
export type DataOptionColor = (typeof dataOptionColors)[number];
export interface DataField {
  id: string;
  name: string;
  type: DataFieldType;
  options?: string[];
  optionColors?: Record<string, DataOptionColor>;
  formula?: string;
}
export interface DataRow {
  id: string;
  values: Record<string, DataValue>;
}
export type DataAggregate = 'none' | 'sum' | 'average' | 'min' | 'max' | 'count' | 'filled';
export interface DataFilter {
  id: string;
  field: string;
  operator: 'eq' | 'ne' | 'contains' | 'empty' | 'notEmpty' | 'gt' | 'lt';
  value: string;
}
export interface DataView {
  id: string;
  name: string;
  type: 'table' | 'cards' | 'board';
  filters: DataFilter[];
  sorts: { field: string; direction: 'asc' | 'desc' }[];
  groupBy: string;
  hiddenFields: string[];
  widths: Record<string, number>;
  aggregates: Record<string, DataAggregate>;
  wrap: boolean;
  fieldWrap?: Record<string, boolean>;
  freeze: boolean;
}
export interface DataTable {
  version: 1;
  id: string;
  name: string;
  archived: boolean;
  fields: DataField[];
  rows: DataRow[];
  views: DataView[];
}
export const dataTableDirectory = '.tano/tables';
export const isLegacyDataTablePath = (path: string) =>
  /^\.tano\/tables\/[0-9a-f]{6}\.tano\.json$/.test(path);
export const isDataTableFilePath = (path: string) =>
  /\.table\.json$/i.test(path) && !validatePath(path);
export const isDataTablePath = (path: string) =>
  isDataTableFilePath(path) || isLegacyDataTablePath(path);
export const dataTableName = (path: string) => basename(path).replace(/\.table\.json$/i, '');
/** Choose a portable, unoccupied filename; adapters still enforce no-clobber creation. */
export function newDataTablePath(name: string, parent: string, paths: readonly string[]) {
  let stem =
    name
      .normalize('NFC')
      .replace(/[\\/<>:"|?*\u0000-\u001f]/g, '-')
      .replace(/^[. ]+|[. ]+$/g, '')
      .slice(0, 80) || '未命名数据表';
  if (validatePath(`${stem}.table.json`)) stem = `数据表-${stem}`;
  const prefix = `${parent ? `${parent}/` : ''}${stem}`;
  const occupied = new Set(paths.map(pathKey));
  let path = `${prefix}.table.json`;
  for (let index = 2; occupied.has(pathKey(path)); index++) path = `${prefix} ${index}.table.json`;
  const error = validatePath(path);
  if (error) throw new Error(error);
  return path;
}
/** Previous hidden storage location, retained only for migration and old session recovery. */
export function dataTablePath(id: string) {
  if (!/^[0-9a-f]{6}$/.test(id)) throw new Error('数据表身份无效');
  return `${dataTableDirectory}/${id}.tano.json`;
}
export const dataFieldTypes: Record<DataFieldType, string> = {
  text: '文本',
  number: '数字',
  date: '日期',
  checkbox: '勾选',
  select: '单选',
  multiselect: '多选',
  url: '链接',
  attachment: '附件',
  formula: '公式',
};
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const validId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[a-zA-Z0-9_-]{1,64}$/.test(value) &&
  !['__proto__', 'constructor', 'prototype'].includes(value);
const validName = (value: unknown): value is string =>
  typeof value === 'string' &&
  !!value.trim() &&
  value.length <= 200 &&
  !/[\u0000-\u001f]/.test(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length <= 2000);
function unique(items: { id: string }[]) {
  return new Set(items.map((item) => item.id)).size === items.length;
}
export function validDataValue(field: DataField, value: unknown): value is DataValue {
  if (value === null) return true;
  if (field.type === 'formula') return false;
  if (field.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (field.type === 'checkbox') return typeof value === 'boolean';
  if (field.type === 'multiselect')
    return (
      strings(value) &&
      value.every((item) => field.options?.includes(item)) &&
      new Set(value).size === value.length
    );
  if (field.type === 'attachment')
    return (
      strings(value) &&
      value.every((item) => /^[0-9a-f]{6}$/.test(item)) &&
      new Set(value).size === value.length
    );
  if (typeof value !== 'string' || value.length > 100000) return false;
  if (field.type === 'select') return value === '' || !!field.options?.includes(value);
  if (field.type === 'date') {
    const date = new Date(`${value}T00:00:00Z`);
    return (
      value === '' ||
      (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(date.getTime()) &&
        date.toISOString().slice(0, 10) === value)
    );
  }
  return true;
}
/** Reject corrupt/unsupported content without resetting it; retain unknown extension keys. */
export function parseDataTable(content: string, expectedId?: string): DataTable {
  if (new TextEncoder().encode(content).length > 8 * 1024 * 1024)
    throw new Error('数据表超过 8 MiB，请拆分为多个表');
  const table = JSON.parse(content) as DataTable;
  const fail = (message: string): never => {
    throw new Error(`数据表格式无效：${message}`);
  };
  if (
    !record(table) ||
    table.version !== 1 ||
    !/^[0-9a-f]{6}$/.test(table.id) ||
    (expectedId && table.id !== expectedId) ||
    !validName(table.name) ||
    typeof table.archived !== 'boolean'
  )
    fail('版本、身份或名称');
  if (
    !Array.isArray(table.fields) ||
    !table.fields.length ||
    table.fields.length > 200 ||
    !unique(table.fields)
  )
    fail('字段重复或数量超出范围');
  const names = new Set<string>();
  for (const field of table.fields) {
    if (
      !record(field) ||
      !validId(field.id) ||
      !validName(field.name) ||
      names.has(field.name) ||
      !Object.hasOwn(dataFieldTypes, field.type)
    )
      fail('字段名称、身份或类型');
    names.add(field.name);
    if (
      field.options !== undefined &&
      (!strings(field.options) ||
        new Set(field.options).size !== field.options.length ||
        field.options.some((option) => !option.trim()))
    )
      fail('选项');
    if (
      field.optionColors !== undefined &&
      (!record(field.optionColors) ||
        Object.entries(field.optionColors).some(
          ([option, color]) =>
            !field.options?.includes(option) || !dataOptionColors.includes(color),
        ))
    )
      fail('选项颜色');
    if (
      field.formula !== undefined &&
      (typeof field.formula !== 'string' || field.formula.length > 4000)
    )
      fail('公式过长');
  }
  const fields = new Map(table.fields.map((field) => [field.id, field]));
  if (!Array.isArray(table.rows) || table.rows.length > 50000 || !unique(table.rows))
    fail('记录重复或数量超出范围');
  for (const row of table.rows) {
    if (!record(row) || !validId(row.id) || !record(row.values)) fail('记录身份或单元格');
    for (const [key, value] of Object.entries(row.values))
      if (!fields.has(key) || !validDataValue(fields.get(key)!, value))
        fail(`单元格 ${row.id}/${key}`);
  }
  if (
    !Array.isArray(table.views) ||
    !table.views.length ||
    table.views.length > 100 ||
    !unique(table.views)
  )
    fail('视图');
  for (const view of table.views) {
    if (
      !record(view) ||
      !validId(view.id) ||
      !validName(view.name) ||
      !['table', 'cards', 'board'].includes(view.type) ||
      typeof view.wrap !== 'boolean' ||
      typeof view.freeze !== 'boolean'
    )
      fail('视图设置');
    if (
      view.fieldWrap !== undefined &&
      (!record(view.fieldWrap) ||
        Object.entries(view.fieldWrap).some(
          ([id, wrap]) => !fields.has(id) || typeof wrap !== 'boolean',
        ))
    )
      fail('列换行设置');
    if (
      !Array.isArray(view.filters) ||
      view.filters.length > 100 ||
      !unique(view.filters) ||
      view.filters.some(
        (filter) =>
          !record(filter) ||
          !validId(filter.id) ||
          !fields.has(filter.field) ||
          !['eq', 'ne', 'contains', 'empty', 'notEmpty', 'gt', 'lt'].includes(filter.operator) ||
          typeof filter.value !== 'string',
      )
    )
      fail('筛选');
    if (
      !Array.isArray(view.sorts) ||
      view.sorts.some(
        (sort) =>
          !record(sort) || !fields.has(sort.field) || !['asc', 'desc'].includes(sort.direction),
      )
    )
      fail('排序');
    if (
      typeof view.groupBy !== 'string' ||
      (view.groupBy && !fields.has(view.groupBy)) ||
      !strings(view.hiddenFields) ||
      view.hiddenFields.some((id) => !fields.has(id))
    )
      fail('分组或隐藏字段');
    if (
      !record(view.widths) ||
      Object.entries(view.widths).some(
        ([id, width]) => !fields.has(id) || !Number.isFinite(width) || width < 80 || width > 1200,
      )
    )
      fail('列宽');
    if (
      !record(view.aggregates) ||
      Object.entries(view.aggregates).some(
        ([id, aggregate]) =>
          !fields.has(id) ||
          !['none', 'sum', 'average', 'min', 'max', 'count', 'filled'].includes(aggregate),
      )
    )
      fail('汇总');
  }
  return table;
}
