import type {
  DataField,
  DataFieldType,
  DataOptionColor,
  DataTable,
  DataValue,
} from '@tano/protocol';
import { dataFieldTypes } from '@tano/protocol';
import { canonicalFormula, tableItemId } from './data-tables';
import {
  CalendarDays,
  CheckSquare,
  Hash,
  Link,
  List,
  ListFilter,
  Paperclip,
  Sigma,
  Type,
} from 'lucide-vue-next';

export const dataFieldIcons: Record<DataFieldType, typeof Type> = {
  text: Type,
  number: Hash,
  date: CalendarDays,
  checkbox: CheckSquare,
  select: ListFilter,
  multiselect: List,
  url: Link,
  attachment: Paperclip,
  formula: Sigma,
};

export function addDataField(table: DataTable, name: string, type: DataFieldType, formula = '') {
  name = name.trim();
  if (!name) {
    const label = dataFieldTypes[type];
    name = label;
    for (let suffix = 2; table.fields.some((field) => field.name === name); suffix++)
      name = `${label} ${suffix}`;
  }
  if (name.length > 200 || table.fields.some((field) => field.name === name))
    throw new Error('请输入不重复的属性名称（最多 200 字）');
  const field: DataField = { id: tableItemId(), name, type };
  if (type === 'select' || type === 'multiselect') field.options = [];
  if (type === 'formula') field.formula = canonicalFormula(formula, [...table.fields, field]);
  table.fields.push(field);
  return field;
}
export const optionPalette: { value: DataOptionColor; label: string; color: string }[] = [
  { value: 'default', label: '默认', color: 'var(--muted)' },
  { value: 'gray', label: '灰色', color: '#82827e' },
  { value: 'brown', label: '棕色', color: '#a87858' },
  { value: 'orange', label: '橙色', color: '#c87e39' },
  { value: 'yellow', label: '黄色', color: '#b99b35' },
  { value: 'green', label: '绿色', color: '#538c6f' },
  { value: 'blue', label: '蓝色', color: '#548ac2' },
  { value: 'purple', label: '紫色', color: '#9a72b4' },
  { value: 'pink', label: '粉色', color: '#bc7195' },
  { value: 'red', label: '红色', color: '#c56e65' },
];
export function optionStyle(field: DataField, option: string) {
  const color =
    optionPalette.find((item) => item.value === field.optionColors?.[option])?.color ??
    'var(--muted)';
  return {
    backgroundColor: `color-mix(in srgb, ${color} 19%, var(--paper))`,
    color: `color-mix(in srgb, ${color} 70%, var(--text))`,
  };
}
/** Create the shared option and select it in one undoable operation. */
export function createAndSelectDataOption(
  table: DataTable,
  rowId: string,
  fieldId: string,
  name: string,
  expected: DataValue,
) {
  const field = table.fields.find((item) => item.id === fieldId);
  const row = table.rows.find((item) => item.id === rowId);
  if (!field || !['select', 'multiselect'].includes(field.type))
    throw new Error('字段类型已变更，请重新打开选项菜单');
  if (!row) throw new Error('记录已移除');
  name = name.trim();
  if (!name || name.length > 2000) throw new Error('请输入选项名称（最多 2000 字）');
  const current = row.values[fieldId] ?? null;
  if (JSON.stringify(current) !== JSON.stringify(expected))
    throw new Error(`此单元格已被外部修改，请核对后重新创建「${name}」。`);
  if (!field.options?.includes(name)) field.options = [...(field.options ?? []), name];
  row.values[fieldId] =
    field.type === 'select'
      ? name
      : [...new Set([...(Array.isArray(current) ? current : []), name])];
}
/** Rename the option and its exact references as one undoable table operation. */
export function renameDataOption(table: DataTable, fieldId: string, before: string, next: string) {
  const field = table.fields.find((item) => item.id === fieldId);
  if (!field?.options?.includes(before)) throw new Error('选项已变更，请重新打开属性菜单');
  next = next.trim();
  if (next === before) return;
  if (!next || next.length > 2000 || field.options.includes(next))
    throw new Error('请输入不重复的选项名称');
  field.options = field.options.map((option) => (option === before ? next : option));
  if (field.optionColors && Object.hasOwn(field.optionColors, before)) {
    const entries = Object.entries(field.optionColors).map(([key, color]) => [
      key === before ? next : key,
      color,
    ]);
    field.optionColors = Object.fromEntries(entries);
  }
  for (const row of table.rows) {
    const value = row.values[fieldId];
    if (value === before) row.values[fieldId] = next;
    else if (Array.isArray(value))
      row.values[fieldId] = value.map((item) => (item === before ? next : item));
  }
  for (const view of table.views)
    for (const filter of view.filters) {
      if (
        filter.field === fieldId &&
        ['eq', 'ne'].includes(filter.operator) &&
        filter.value === before
      )
        filter.value = next;
    }
}
export function removeDataOption(table: DataTable, fieldId: string, option: string) {
  const field = table.fields.find((item) => item.id === fieldId);
  if (!field?.options?.includes(option)) throw new Error('选项已变更，请重新打开属性菜单');
  if (
    table.rows.some(
      (row) =>
        row.values[fieldId] === option ||
        (Array.isArray(row.values[fieldId]) && row.values[fieldId].includes(option)),
    )
  )
    throw new Error('此选项仍被记录使用，请先修改这些记录再删除');
  field.options = field.options.filter((item) => item !== option);
  if (field.optionColors) delete field.optionColors[option];
}
