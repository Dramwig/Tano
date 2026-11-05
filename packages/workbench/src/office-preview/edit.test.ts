import { expect, it } from 'vitest';
import { read, utils, write } from 'xlsx';
import { editWorkbook } from './edit';
function grid(extension: string) {
  const book = utils.book_new(), sheet = utils.aoa_to_sheet([['a', 'b', 'c'], ['d', 'e', 'f'], ['g', 'h', 'i']]);
  sheet['!cols'] = [{ wpx: 80 }, { wpx: 100 }, { wpx: 120 }];
  utils.book_append_sheet(book, sheet, 'Grid');
  return new Uint8Array(write(book, { type: 'array', bookType: extension === 'xls' ? 'biff8' : 'xlsx', cellStyles: true }));
}
it.each(['xls', 'xlsx'])('clears and deletes rows and columns in %s without losing surrounding cells', extension => {
  const base = grid(extension);
  const cleared = read(editWorkbook(base, extension, [{ kind: 'clear', sheet: 'Grid', axis: 'column', index: 1 }]));
  expect(utils.sheet_to_json(cleared.Sheets.Grid, { header: 1 })).toEqual([['a', '', 'c'], ['d', '', 'f'], ['g', '', 'i']]);
  const deleted = read(editWorkbook(base, extension, [
    { kind: 'delete', sheet: 'Grid', axis: 'row', index: 1 },
    { kind: 'delete', sheet: 'Grid', axis: 'column', index: 1 },
    { kind: 'cell', sheet: 'Grid', row: 1, column: 1, value: 'new' },
  ]), { cellStyles: true });
  expect(utils.sheet_to_json(deleted.Sheets.Grid, { header: 1 })).toEqual([['a', 'c'], ['g', 'new']]);
  expect(deleted.Sheets.Grid['!ref']).toBe('A1:B2');
  expect(deleted.Sheets.Grid['!cols']?.[1].wpx).toBe(120);
  const row = read(editWorkbook(base, extension, [{ kind: 'clear', sheet: 'Grid', axis: 'row', index: 1 }]));
  expect(row.Sheets.Grid.A2.v).toBe(''); expect(row.Sheets.Grid.A3.v).toBe('g');
});
it('merges independent clear operations but refuses overlapping changes and unsafe structural deletes', () => {
  const base = grid('xlsx');
  const external = editWorkbook(base, 'xlsx', [{ kind: 'cell', sheet: 'Grid', row: 2, column: 2, value: 'external' }]);
  const edit = { kind: 'clear', sheet: 'Grid', axis: 'row', index: 0 } as const;
  expect(read(editWorkbook(base, 'xlsx', [edit], external)).Sheets.Grid.C3.v).toBe('external');
  expect(() => editWorkbook(base, 'xlsx', [{ ...edit, index: 2 }], external)).toThrow('外部修改');
  expect(() => editWorkbook(base, 'xlsx', [{ ...edit, kind: 'delete' }], external)).toThrow('外部修改');
  expect(() => editWorkbook(fixture('xlsx'), 'xlsx', [{ kind: 'delete', sheet: 'Budget', axis: 'row', index: 0 }])).toThrow('公式');
});
function fixture(extension: string) {
  const book = utils.book_new(), sheet = utils.aoa_to_sheet([['original', 42], ['untouched', 1]]);
  sheet.B2.f = '1+0'; utils.book_append_sheet(book, sheet, 'Budget');
  return new Uint8Array(write(book, { type: 'array', bookType: extension === 'xls' ? 'biff8' : 'xlsx' }));
}
it.each(['xls', 'xlsx'])('persists worksheet copy, rename, deletion and subsequent edits in %s', extension => {
  const base = grid(extension);
  const output = editWorkbook(base, extension, [
    { kind: 'copy-sheet', sheet: 'Grid', name: 'Copy' },
    { kind: 'rename-sheet', sheet: 'Copy', name: 'Renamed' },
    { kind: 'cell', sheet: 'Renamed', row: 0, column: 0, value: 'changed' },
    { kind: 'delete-sheet', sheet: 'Grid' },
  ], base.slice());
  const book = read(output, { cellStyles: true });
  expect(book.SheetNames).toEqual(['Renamed']);
  expect(book.Sheets.Renamed.A1.v).toBe('changed');
  expect(book.Sheets.Renamed.B2.v).toBe('e');
  expect(book.Sheets.Renamed['!cols']?.[1].wpx).toBe(100);
  expect(read(base).Sheets.Grid.A1.v).toBe('a');
});
it('rejects invalid worksheet operations and external structural conflicts', () => {
  const base = grid('xlsx');
  expect(() => editWorkbook(base, 'xlsx', [{ kind: 'delete-sheet', sheet: 'Grid' }])).toThrow('至少保留');
  for (const name of ['grid', 'bad/name', '', 'x'.repeat(32)]) {
    expect(() => editWorkbook(base, 'xlsx', [{ kind: 'copy-sheet', sheet: 'Grid', name }])).toThrow('名称');
  }
  expect(() => editWorkbook(fixture('xlsx'), 'xlsx', [{ kind: 'rename-sheet', sheet: 'Budget', name: 'New' }])).toThrow('引用');
  const external = editWorkbook(base, 'xlsx', [{ kind: 'cell', sheet: 'Grid', row: 0, column: 0, value: 'external' }]);
  expect(() => editWorkbook(base, 'xlsx', [{ kind: 'copy-sheet', sheet: 'Grid', name: 'Copy' }], external)).toThrow('外部修改');
});
it.each(['xls', 'xlsx'])('saves %s edits, dimensions and new sheets without rebuilding untouched cells', extension => {
  const base = fixture(extension), before = base.slice();
  const bytes = editWorkbook(base, extension, [
    { kind: 'cell', sheet: 'Budget', row: 0, column: 0, value: '=literal' },
    { kind: 'column', sheet: 'Budget', column: 2 },
    { kind: 'width', sheet: 'Budget', column: 0, width: 180 },
    { kind: 'sheet', sheet: 'New' }, { kind: 'cell', sheet: 'New', row: 0, column: 0, value: 'saved' },
  ]);
  const book = read(bytes, { cellStyles: true });
  expect(base).toEqual(before);
  expect(book.Sheets.Budget.A1).toMatchObject({ t: 's', v: '=literal' });
  expect(book.Sheets.Budget.B1).toMatchObject({ t: 'n', v: 42 });
  expect(book.Sheets.Budget.B2.f).toBe(read(before).Sheets.Budget.B2.f);
  expect(book.Sheets.Budget['!cols']?.[0].wpx).toBe(180);
  expect(book.Sheets.Budget['!ref']).toBe('A1:C2');
  expect(book.Sheets.New.A1.v).toBe('saved');
});
it('merges independent external edits and rejects overlapping changes', () => {
  const base = fixture('xlsx');
  const latest = editWorkbook(base, 'xlsx', [{ kind: 'cell', sheet: 'Budget', row: 1, column: 0, value: 'external' }]);
  const result = read(editWorkbook(base, 'xlsx', [{ kind: 'cell', sheet: 'Budget', row: 0, column: 0, value: 'local' }], latest));
  expect(result.Sheets.Budget.A1.v).toBe('local'); expect(result.Sheets.Budget.A2.v).toBe('external');
  expect(() => editWorkbook(base, 'xlsx', [{ kind: 'cell', sheet: 'Budget', row: 1, column: 0, value: 'conflict' }], latest)).toThrow('外部修改');
});
