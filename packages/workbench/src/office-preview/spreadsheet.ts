import { read, utils } from 'xlsx';
import { officeErrors, officeLimits, type OfficePreview, type OfficeSheet } from './model';

export function spreadsheet(bytes: Uint8Array): OfficePreview {
  const book = read(Uint8Array.from(bytes), { type: 'array', sheetRows: officeLimits.rows + 1, cellHTML: false,
    cellFormula: true, cellText: true, cellStyles: false, bookVBA: false, dense: false });
  if (!book.SheetNames.length || book.SheetNames.length > officeLimits.sheets) throw new Error(officeErrors.limit);
  let cells = 0;
  const sheets: OfficeSheet[] = book.SheetNames.map(name => {
    const sheet = book.Sheets[name];
    const range = utils.decode_range(sheet['!fullref'] ?? sheet['!ref'] ?? 'A1');
    const endRow = Math.min(range.e.r + 1, officeLimits.rows);
    const columns = Math.min(range.e.c + 1, officeLimits.columns);
    if ((cells += endRow * columns) > officeLimits.cells) throw new Error(officeErrors.limit);
    const rows: string[][] = [];
    for (let row = 0; row < endRow; row++) {
      const values: string[] = [];
      for (let col = 0; col < columns; col++) {
        const cell = sheet[utils.encode_cell({ r: row, c: col })];
        // Display cached results; never calculate formulas or follow links.
        values.push(cell ? String(cell.w ?? (cell.v != null ? utils.format_cell(cell) : cell.f ? `=${cell.f}` : '')) : '');
      }
      rows.push(values);
    }
    return { name, rows, columns, truncated: range.e.r >= officeLimits.rows || range.e.c >= officeLimits.columns };
  });
  return { kind: 'spreadsheet', sheets };
}
