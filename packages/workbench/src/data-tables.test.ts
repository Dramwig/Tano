import { describe, expect, it } from 'vitest';
import {
  dataTablePath,
  isWorkspaceDataPath,
  isDataTableFilePath,
  newDataTablePath,
  parseDataTable,
} from '@tano/protocol';
import {
  aggregateData,
  applyDataPaste,
  canonicalFormula,
  copyTable,
  dataEvaluator,
  dataViewRows,
  displayFormula,
  exportDataCsv,
  newDataTable,
  parseCellInput,
  parseDelimited,
} from './data-tables';
import { mergeDataTable, saveDataTable } from './workspace-data-tables';
import type { DataTableRecord } from './workspace-data-tables';
import type { DataTable, FileSnapshot } from '@tano/protocol';
const fixture = () => {
  const table = newDataTable('a00001', 'parts');
  table.rows = [
    { id: 'cpu_a', values: { name: 'CPU A', category: ['CPU'], price: 1500, status: '选择' } },
    { id: 'cpu_b', values: { name: 'CPU B', category: ['CPU'], price: 2000, status: '拒绝' } },
    { id: 'memory', values: { name: '内存', category: ['内存'], price: 500, status: '选择' } },
  ];
  return table;
};
const snapshot = (table: DataTable): FileSnapshot => ({
  content: JSON.stringify(table),
  hash: JSON.stringify(table),
  modified: 1,
});
const record = (table: DataTable): DataTableRecord => ({
  fileId: 'f00001',
  table,
  path: dataTablePath(table.id),
  snapshot: snapshot(table),
});

describe('portable tables and formulas', () => {
  it('recognizes user table files in arbitrary directories without exposing internal data', () => {
    expect(isDataTableFilePath('研究/候选.TABLE.JSON')).toBe(true);
    expect(isDataTableFilePath('.tano/tables/a00001.tano.json')).toBe(false);
    expect(isDataTableFilePath('../候选.table.json')).toBe(false);
    expect(newDataTablePath('比较', '研究', ['研究/比较.table.json'])).toBe(
      '研究/比较 2.table.json',
    );
    expect(newDataTablePath('a/b:c', '', [])).toBe('a-b-c.table.json');
  });
  it('has independent records, typed fields and selected-parts budget', () => {
    const table = parseDataTable(JSON.stringify(fixture())),
      evaluate = dataEvaluator(table);
    expect(evaluate(table.rows[0], 'cost')).toEqual({ value: 1500 });
    expect(evaluate(table.rows[1], 'cost')).toEqual({ value: 0 });
    expect(aggregateData(table.rows, 'cost', 'sum', evaluate)).toBe('2000');
    expect(dataViewRows(table, table.views[1]).map((row) => row.id)).toEqual(['cpu_a', 'memory']);
    expect(isWorkspaceDataPath(dataTablePath(table.id))).toBe(true);
    expect(isWorkspaceDataPath('.tano/tables/../config.json')).toBe(false);
  });
  it('preserves stable field references across rename and ignores brackets in string literals', () => {
    const table = fixture();
    table.fields.find((field) => field.id === 'cost')!.formula = canonicalFormula(
      'IF([状态] = "选择", [价格] * 2, 0)',
      table.fields,
    );
    table.fields.find((field) => field.id === 'price')!.name = '新价格';
    expect(dataEvaluator(table)(table.rows[0], 'cost').value).toBe(3000);
    expect(displayFormula(table.fields.at(-2)!.formula!, table.fields)).toContain('[新价格]');
    expect(canonicalFormula('IF("[价格]" = "[价格]", 1, 0)', table.fields)).toContain('"[价格]"');
  });
  it.each([
    ['1 + 2 * 3', 7],
    ['(1 + 2) * -3', -9],
    ['ROUND(10 / 3, 2)', 3.33],
    ['IF(FALSE, 1 / 0, MAX(2, ABS(-5)))', 5],
    ['IF(AND([price] > 1000, NOT(FALSE)), 10, 0)', 10],
    ['SUM(1, 2, 3)', 6],
  ])('evaluates %s', (formula, value) => {
    const table = fixture();
    table.fields.find((field) => field.id === 'cost')!.formula = formula;
    expect(dataEvaluator(table)(table.rows[0], 'cost')).toEqual({ value });
  });
  it.each([
    '1 / 0',
    '[missing]',
    '[cost]',
    'globalThis.fetch("https://example.com")',
    'IF(TRUE, 1)',
    'ROUND(1, 9999)',
  ])('reports invalid formula %s without executing it', (formula) => {
    const table = fixture();
    table.fields.find((field) => field.id === 'cost')!.formula = formula;
    expect(dataEvaluator(table)(table.rows[0], 'cost').error).toBeTruthy();
    expect(aggregateData(table.rows, 'cost', 'sum', dataEvaluator(table))).toBe('含公式错误');
  });
  it('rejects duplicate identities, wrong values and future formats without discarding data', () => {
    const table = fixture();
    table.rows.push(copyTable(table.rows[0]));
    expect(() => parseDataTable(JSON.stringify(table))).toThrow();
    table.rows.pop();
    table.rows[0].values.price = 'not a number';
    expect(() => parseDataTable(JSON.stringify(table))).toThrow();
    expect(() => parseDataTable(JSON.stringify({ ...fixture(), version: 2 }))).toThrow();
    expect(() => parseDataTable(JSON.stringify(fixture()), 'ffffff')).toThrow();
    expect(() =>
      parseCellInput({ id: 'date', name: '日期', type: 'date' }, '2026-02-30'),
    ).toThrow();
  });
  it('sorts numeric values and applies multiple filters and search before totals', () => {
    const table = fixture(),
      view = table.views[0];
    view.sorts = [{ field: 'price', direction: 'desc' }];
    view.filters = [{ id: 'filter', field: 'price', operator: 'gt', value: '1000' }];
    expect(dataViewRows(table, view).map((row) => row.id)).toEqual(['cpu_b', 'cpu_a']);
    expect(dataViewRows(table, view, 'A').map((row) => row.id)).toEqual(['cpu_a']);
    expect(
      aggregateData(dataViewRows(table, table.views[1]), 'price', 'average', dataEvaluator(table)),
    ).toBe('1000');
  });
});

describe('bulk entry and CSV', () => {
  it('pastes against visible row identities, preserves hidden rows and appends overflow', () => {
    const table = fixture();
    const next = applyDataPaste(table, ['memory', 'cpu_a'], ['name', 'price'], 0, 0, [
      ['内存改名', '750'],
      ['处理器', '1800'],
      ['新候选', '900'],
    ]);
    expect(next.rows.find((row) => row.id === 'memory')!.values.price).toBe(750);
    expect(next.rows.find((row) => row.id === 'cpu_b')!.values.price).toBe(2000);
    expect(next.rows.at(-1)!.values.name).toBe('新候选');
    expect(table.rows[0].values.price).toBe(1500);
  });
  it('invalid pasted values abort the entire batch', () => {
    const table = fixture();
    expect(() =>
      applyDataPaste(
        table,
        table.rows.map((row) => row.id),
        ['price'],
        0,
        0,
        [['100'], ['invalid']],
      ),
    ).toThrow();
    expect(table.rows[0].values.price).toBe(1500);
  });
  it('round trips CSV quotes, commas, newlines and typed computed values', () => {
    const table = fixture();
    table.rows[0].values.name = 'CPU "A",\n新款';
    const csv = exportDataCsv(table, table.views[0]);
    const grid = parseDelimited(csv);
    expect(grid[1][0]).toBe('CPU "A",\n新款');
    expect(grid[1][5]).toBe('1500');
    expect(() => parseDelimited('"unterminated')).toThrow();
    expect(parseDelimited('"a\tb"\t2\r\nc\t3', '\t')).toEqual([
      ['a\tb', '2'],
      ['c', '3'],
    ]);
  });
  it('exports only records matching both the saved view and current search', () => {
    const table = fixture();
    const grid = parseDelimited(exportDataCsv(table, table.views[1], false, 'CPU'));
    expect(grid).toHaveLength(2);
    expect(grid[1][0]).toBe('CPU A');
    expect(grid[1][5]).toBe('1500');
  });
});

describe('external edit protection', () => {
  it('merges independent cells in the same row and independent row additions', () => {
    const base = fixture(),
      ours = copyTable(base),
      theirs = copyTable(base);
    ours.rows[0].values.name = '我的名称';
    theirs.rows[0].values.price = 1600;
    ours.rows.push({ id: 'ours', values: { name: '我新增' } });
    theirs.rows.push({ id: 'theirs', values: { name: '外部新增' } });
    const merged = mergeDataTable(base, ours, theirs)!;
    expect(merged.rows[0].values).toMatchObject({ name: '我的名称', price: 1600 });
    expect(merged.rows).toHaveLength(5);
  });
  it('detects same-cell edits, row deletion vs edits and incompatible schema edits', () => {
    const base = fixture(),
      ours = copyTable(base),
      theirs = copyTable(base);
    ours.rows[0].values.price = 100;
    theirs.rows[0].values.price = 200;
    expect(mergeDataTable(base, ours, theirs)).toBeNull();
    ours.rows.shift();
    expect(mergeDataTable(base, ours, theirs)).toBeNull();
    const renamed = copyTable(base);
    renamed.fields.find((field) => field.id === 'price')!.type = 'text';
    expect(mergeDataTable(base, renamed, theirs)).toBeNull();
  });
  it('retries a stale hash using a three-way merge', async () => {
    const base = fixture(),
      ours = copyTable(base),
      remote = copyTable(base);
    ours.rows[0].values.price = 1600;
    remote.rows[1].values.status = '选择';
    let disk = snapshot(remote),
      writes = 0;
    const saved = await saveDataTable(
      {
        async write(_path, content, hash) {
          writes++;
          if (hash !== disk.hash) return { status: 'conflict', snapshot: disk };
          disk = { content, hash: content, modified: 2 };
          return { status: 'saved', snapshot: disk };
        },
        async create() {
          throw new Error('unexpected conflict');
        },
      },
      record(base),
      ours,
    );
    expect(writes).toBe(2);
    expect(saved.table.rows[0].values.price).toBe(1600);
    expect(saved.table.rows[1].values.status).toBe('选择');
  });
  it('preserves the complete draft when disk content overlaps or the file disappears', async () => {
    for (const missing of [false, true]) {
      const base = fixture(),
        ours = copyTable(base),
        remote = copyTable(base),
        copies: string[] = [];
      ours.rows[0].values.price = 100;
      remote.rows[0].values.price = 200;
      const disk = snapshot(remote);
      await expect(
        saveDataTable(
          {
            async write() {
              return missing ? { status: 'missing' } : { status: 'conflict', snapshot: disk };
            },
            async create(path, content) {
              expect(path).toMatch(/^\.tano\/conflicts\/table-.*\.tano\.json$/);
              copies.push(content);
            },
          },
          record(base),
          ours,
        ),
      ).rejects.toThrow('重叠修改');
      expect(JSON.parse(copies[0]).rows[0].values.price).toBe(100);
      expect(JSON.parse(disk.content).rows[0].values.price).toBe(200);
    }
  });
});
