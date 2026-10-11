import { describe, expect, it } from 'vitest';
import { parseDataTable } from '@tano/protocol';
import { newDataTable, copyTable, dataViewRows } from './data-tables';
import {
  addDataField,
  createAndSelectDataOption,
  removeDataOption,
  renameDataOption,
} from './data-table-properties';
import { mergeDataTable } from './workspace-data-tables';

describe('table property editing', () => {
  it('creates a shared option and appends it only to the target record, without duplicates', () => {
    const table = newDataTable('a00001', 'parts');
    table.rows = [
      { id: 'r1', values: { category: ['CPU'] } },
      { id: 'r2', values: { category: ['主板'] } },
    ];
    createAndSelectDataOption(table, 'r1', 'category', '  外设  ', ['CPU']);
    expect(table.rows[0].values.category).toEqual(['CPU', '外设']);
    expect(table.rows[1].values.category).toEqual(['主板']);
    createAndSelectDataOption(table, 'r1', 'category', '外设', ['CPU', '外设']);
    expect(
      table.fields
        .find((field) => field.id === 'category')!
        .options!.filter((name) => name === '外设'),
    ).toHaveLength(1);
    expect(table.rows[0].values.category).toEqual(['CPU', '外设']);
    expect(parseDataTable(JSON.stringify(table))).toEqual(table);
  });
  it('selects a newly created single choice while keeping existing choices and colors', () => {
    const table = newDataTable('a00001', 'parts');
    table.rows = [{ id: 'r1', values: { status: '选择' } }];
    createAndSelectDataOption(table, 'r1', 'status', '待确认', '选择');
    const status = table.fields.find((field) => field.id === 'status')!;
    expect(status.options).toEqual(['待比较', '选择', '拒绝', '待确认']);
    expect(status.optionColors?.['选择']).toBe('green');
    expect(table.rows[0].values.status).toBe('待确认');
    expect(parseDataTable(JSON.stringify(table))).toEqual(table);
  });
  it('rejects stale cells, removed records, wrong field types and invalid names without orphan options', () => {
    const table = newDataTable('a00001', 'parts');
    table.rows = [{ id: 'r1', values: { category: ['CPU'] } }];
    const before = copyTable(table);
    expect(() => createAndSelectDataOption(table, 'r1', 'category', '外设', null)).toThrow(
      '外部修改',
    );
    expect(() => createAndSelectDataOption(table, 'missing', 'category', '外设', null)).toThrow(
      '记录已移除',
    );
    expect(() => createAndSelectDataOption(table, 'r1', 'price', '外设', null)).toThrow(
      '字段类型已变更',
    );
    expect(() => createAndSelectDataOption(table, 'r1', 'category', '  ', ['CPU'])).toThrow(
      '选项名称',
    );
    expect(() =>
      createAndSelectDataOption(table, 'r1', 'category', 'x'.repeat(2001), ['CPU']),
    ).toThrow('选项名称');
    expect(table).toEqual(before);
  });
  it('gives unnamed properties unique names without replacing existing fields or values', () => {
    const table = newDataTable('a00001', 'parts');
    const before = copyTable(table);
    const first = addDataField(table, '', 'number');
    const second = addDataField(table, '  ', 'number');
    expect(first.name).toBe('数字');
    expect(second.name).toBe('数字 2');
    expect(first.id).not.toBe(second.id);
    expect(table.fields.slice(0, -2)).toEqual(before.fields);
    expect(table.rows).toEqual(before.rows);
    expect(parseDataTable(JSON.stringify(table))).toEqual(table);
  });
  it('rejects duplicate names and invalid formulas without appending partial fields', () => {
    const table = newDataTable('a00001', 'parts'),
      before = copyTable(table);
    expect(() => addDataField(table, ' 名称 ', 'text')).toThrow('不重复');
    expect(() => addDataField(table, '折后价格', 'formula', '[不存在] * 2')).toThrow();
    expect(table).toEqual(before);
  });
  it('creates editable choices and stores formula references using stable field ids', () => {
    const table = newDataTable('a00001', 'parts');
    const choices = addDataField(table, '渠道', 'multiselect');
    const formula = addDataField(table, '折后价格', 'formula', '[价格] * 0.8');
    expect(choices.options).toEqual([]);
    expect(formula.formula).toBe('[price] * 0.8');
    expect(parseDataTable(JSON.stringify(table))).toEqual(table);
  });
  it('renames selected values, exact filters and colors atomically while retaining field identity', () => {
    const table = newDataTable('a00001', 'parts');
    table.rows = [{ id: 'r1', values: { name: 'A', status: '选择', category: ['CPU', '主板'] } }];
    renameDataOption(table, 'status', '选择', '已选');
    expect(table.rows[0].values.status).toBe('已选');
    expect(table.views[1].filters[0].value).toBe('已选');
    expect(dataViewRows(table, table.views[1])).toHaveLength(1);
    const status = table.fields.find((field) => field.id === 'status')!;
    expect(status.optionColors).toEqual({ 待比较: 'gray', 已选: 'green', 拒绝: 'red' });
    renameDataOption(table, 'category', 'CPU', '处理器');
    expect(table.rows[0].values.category).toEqual(['处理器', '主板']);
    expect(parseDataTable(JSON.stringify(table))).toEqual(table);
  });
  it('rejects duplicate or stale option edits without changing records', () => {
    const table = newDataTable('a00001', 'parts'),
      before = copyTable(table);
    expect(() => renameDataOption(table, 'status', '选择', '拒绝')).toThrow('不重复');
    expect(() => renameDataOption(table, 'status', '已移除', '已选')).toThrow('已变更');
    expect(table).toEqual(before);
  });
  it('refuses deletion of used options and removes unused color metadata', () => {
    const table = newDataTable('a00001', 'parts');
    table.rows = [{ id: 'r1', values: { category: ['CPU'], status: '选择' } }];
    expect(() => removeDataOption(table, 'category', 'CPU')).toThrow('记录使用');
    expect(() => removeDataOption(table, 'status', '选择')).toThrow('记录使用');
    removeDataOption(table, 'status', '拒绝');
    expect(
      table.fields.find((field) => field.id === 'status')?.optionColors?.['拒绝'],
    ).toBeUndefined();
    expect(() => parseDataTable(JSON.stringify(table))).not.toThrow();
  });
  it('round trips colors and per-column wrapping, preserving compatibility with older files', () => {
    const table = newDataTable('a00001', 'parts');
    table.views[0].fieldWrap = { name: true, spec: false };
    expect(parseDataTable(JSON.stringify(table))).toEqual(table);
    delete table.views[0].fieldWrap;
    for (const field of table.fields) delete field.optionColors;
    expect(parseDataTable(JSON.stringify(table))).toEqual(table);
    table.fields[0].optionColors = { missing: 'blue' };
    expect(() => parseDataTable(JSON.stringify(table))).toThrow('选项颜色');
    delete table.fields[0].optionColors;
    table.views[0].fieldWrap = { missing: true };
    expect(() => parseDataTable(JSON.stringify(table))).toThrow('列换行');
  });
  it('merges independent style and cell edits without losing either', () => {
    const base = newDataTable('a00001', 'parts');
    base.rows = [{ id: 'r1', values: { name: 'A', status: '选择' } }];
    const local = copyTable(base),
      remote = copyTable(base);
    local.fields.find((field) => field.id === 'status')!.optionColors!['选择'] = 'blue';
    local.views[0].fieldWrap = { name: true };
    remote.rows[0].values.name = 'B';
    const merged = mergeDataTable(base, local, remote)!;
    expect(merged.rows[0].values.name).toBe('B');
    expect(merged.fields.find((field) => field.id === 'status')?.optionColors?.['选择']).toBe(
      'blue',
    );
    expect(merged.views[0].fieldWrap).toEqual({ name: true });
  });
});
