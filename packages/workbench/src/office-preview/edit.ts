import { read, write, utils } from 'xlsx';
import { officeLimits } from './model';
import { parseOffice } from './parser';

export type SheetEdit =
  | { kind: 'width'; sheet: string; column: number; width: number }
  | { kind: 'cell'; sheet: string; row: number; column: number; value: string }
  | { kind: 'column'; sheet: string; column: number }
  | { kind: 'clear'; sheet: string; axis: 'row' | 'column'; index: number }
  | { kind: 'delete'; sheet: string; axis: 'row' | 'column'; index: number }
  | { kind: 'rename-sheet'; sheet: string; name: string }
  | { kind: 'copy-sheet'; sheet: string; name: string }
  | { kind: 'delete-sheet'; sheet: string }
  | { kind: 'sheet'; sheet: string };

/** Edit the full source workbook, never rebuild from the limited preview. */
export function editWorkbook(bytes: Uint8Array, extension: string, edits: SheetEdit[], latest?: Uint8Array): Uint8Array {
  if (!['xls', 'xlsx'].includes(extension) || bytes.length > officeLimits.fileBytes) throw new Error('不支持编辑此工作簿');
  for (const source of latest ? [bytes, latest] : [bytes]) {
    const parsed = parseOffice(source, extension);
    if (parsed.kind !== 'spreadsheet' || parsed.sheets.some(sheet => sheet.truncated)) throw new Error('工作簿超过编辑上限，请在 Office 中编辑');
  }
  const options = { type: 'array' as const, cellStyles: true, cellFormula: true, bookVBA: true, cellHTML: false };
  const original = read(Uint8Array.from(bytes), options);
  const book = latest ? read(Uint8Array.from(latest), options) : original;
  const sheetStructure = edits.some(edit => ['rename-sheet', 'copy-sheet', 'delete-sheet'].includes(edit.kind));
  if (latest && (sheetStructure || edits.some(edit => edit.kind === 'delete')) && (bytes.length !== latest.length || bytes.some((value, i) => value !== latest[i]))) {
    throw new Error('调整工作簿结构前文件已被外部修改，未覆盖原文件；本地草稿已保留');
  }
  if (latest && !sheetStructure) {
    const added = new Set<string>();
    for (const edit of edits) {
      const before = original.Sheets[edit.sheet], after = book.Sheets[edit.sheet];
      let conflict = false;
      if (edit.kind === 'sheet') { conflict = !!after; added.add(edit.sheet); }
      else if (!added.has(edit.sheet)) {
        if (!before || !after) conflict = true;
        else if (edit.kind === 'cell') {
          const address = utils.encode_cell({ r: edit.row, c: edit.column });
          conflict = JSON.stringify(before[address]) !== JSON.stringify(after[address]);
        } else if (edit.kind === 'clear' || edit.kind === 'delete') {
          const addresses = new Set([...Object.keys(before), ...Object.keys(after)]);
          conflict = [...addresses].some(address => !address.startsWith('!') && utils.decode_cell(address)[edit.axis === 'row' ? 'r' : 'c'] === edit.index && JSON.stringify(before[address]) !== JSON.stringify(after[address]));
        } else if (edit.kind === 'width') conflict = JSON.stringify(before['!cols']?.[edit.column]) !== JSON.stringify(after['!cols']?.[edit.column]);
        else if (edit.kind === 'column') conflict = utils.decode_range(after['!ref'] ?? 'A1').e.c >= edit.column && utils.decode_range(before['!ref'] ?? 'A1').e.c < edit.column;
      }
      if (conflict) throw new Error('同一单元格、列或工作表已被外部修改，未覆盖原文件；本地草稿已保留');
    }
  }
  for (const edit of edits) {
    if (edit.kind === 'rename-sheet' || edit.kind === 'copy-sheet' || edit.kind === 'delete-sheet') {
      const index = book.SheetNames.indexOf(edit.sheet);
      if (index < 0) throw new Error('工作表不存在');
      if (book.vbaraw || book.Workbook?.Names?.length || book.SheetNames.some(name => Object.entries(book.Sheets[name]).some(([key, cell]) => !key.startsWith('!') && (cell?.f || cell?.F)))) {
        throw new Error('工作簿包含公式、名称或宏引用，请在 Office 中重命名、复制或删除工作表');
      }
      if (edit.kind !== 'delete-sheet') {
        if (!edit.name.trim() || edit.name.length > 31 || /[\\/?*\[\]:\x00-\x1f]/.test(edit.name) || /^'|'$/.test(edit.name) || book.SheetNames.some(name => !(edit.kind === 'rename-sheet' && name === edit.sheet) && name.toLowerCase() === edit.name.toLowerCase())) throw new Error('工作表名称无效或重复（最多 31 个字符）');
      }
      if (edit.kind === 'rename-sheet') {
        book.Sheets[edit.name] = book.Sheets[edit.sheet]; delete book.Sheets[edit.sheet];
        book.SheetNames[index] = edit.name;
        if (book.Workbook?.Sheets?.[index]) book.Workbook.Sheets[index].name = edit.name;
      } else if (edit.kind === 'copy-sheet') {
        if (book.SheetNames.length >= officeLimits.sheets) throw new Error('工作表数量超限');
        book.Sheets[edit.name] = structuredClone(book.Sheets[edit.sheet]);
        book.SheetNames.splice(index + 1, 0, edit.name);
        book.Workbook?.Sheets?.splice(index + 1, 0, { ...(book.Workbook.Sheets[index] ?? {}), name: edit.name, Hidden: 0 });
      } else {
        if (book.SheetNames.length <= 1 || !book.SheetNames.some((_, i) => i !== index && !book.Workbook?.Sheets?.[i]?.Hidden)) throw new Error('至少保留一个可见工作表');
        book.SheetNames.splice(index, 1); delete book.Sheets[edit.sheet]; book.Workbook?.Sheets?.splice(index, 1);
      }
      continue;
    }
    if (edit.kind === 'sheet') {
      if (book.SheetNames.length >= officeLimits.sheets || book.SheetNames.includes(edit.sheet)) throw new Error('工作表名称重复或数量超限');
      const sheet = utils.aoa_to_sheet([['']]);
      utils.book_append_sheet(book, sheet, edit.sheet);
      continue;
    }
    const sheet = book.Sheets[edit.sheet];
    if (edit.kind === 'clear' || edit.kind === 'delete') {
      if (!sheet || !Number.isInteger(edit.index) || edit.index < 0 || edit.index >= (edit.axis === 'row' ? officeLimits.rows : officeLimits.columns)) throw new Error('无效的行或列');
      const axis = edit.axis === 'row' ? 'r' : 'c';
      const range = utils.decode_range(sheet['!ref'] ?? 'A1');
      if (edit.index > range.e[axis]) throw new Error('无效的行或列');
      if (edit.kind === 'clear' && Object.entries(sheet).some(([key, cell]) => !key.startsWith('!') && cell?.F && utils.decode_cell(key)[axis] === edit.index)) throw new Error('选区包含数组公式，请在 Office 中清除内容');
      if (edit.kind === 'delete') {
        // SheetJS does not rewrite formulas, named ranges or table references when moving cells.
        // Refuse these workbooks rather than silently corrupting their references.
        if (book.Workbook?.Names?.length || book.SheetNames.some(name => Object.entries(book.Sheets[name]).some(([key, cell]) => !key.startsWith('!') && (cell?.f || cell?.F))) || sheet['!autofilter']) {
          throw new Error('此工作簿包含公式、名称或筛选引用，请在 Office 中删除行列；可在此清除内容');
        }
      }
      for (const address of Object.keys(sheet).filter(key => !key.startsWith('!')).sort((a, b) => utils.decode_cell(a)[axis] - utils.decode_cell(b)[axis])) {
        const position = utils.decode_cell(address), cell = sheet[address];
        if (position[axis] === edit.index) {
          if (edit.kind === 'clear') sheet[address] = { t: 's', v: '', ...(cell.s ? { s: cell.s } : {}) };
          else delete sheet[address];
        } else if (edit.kind === 'delete' && position[axis] > edit.index) {
          delete sheet[address]; position[axis]--; sheet[utils.encode_cell(position)] = cell;
        }
      }
      if (edit.kind === 'delete') {
        if (edit.axis === 'row') sheet['!rows']?.splice(edit.index, 1); else sheet['!cols']?.splice(edit.index, 1);
        sheet['!merges'] = sheet['!merges']?.flatMap(merge => {
          if (merge.s[axis] === edit.index && merge.e[axis] === edit.index) return [];
          if (merge.s[axis] > edit.index) merge.s[axis]--;
          if (merge.e[axis] >= edit.index) merge.e[axis]--;
          return [merge];
        });
        range.s[axis] = Math.max(0, range.s[axis] - (range.s[axis] > edit.index ? 1 : 0));
        range.e[axis] = Math.max(range.s[axis], range.e[axis] - 1);
        sheet['!ref'] = utils.encode_range(range);
        sheet[utils.encode_cell(range.e)] ??= { t: 's', v: '' };
      }
      continue;
    }
    if (!sheet || !Number.isInteger(edit.column) || edit.column < 0 || edit.column >= officeLimits.columns) throw new Error('无效的工作表或列');
    if (edit.kind === 'width') {
      if (!Number.isFinite(edit.width) || edit.width < 24 || edit.width > 2048) throw new Error('无效列宽');
      (sheet['!cols'] ??= [])[edit.column] = { ...sheet['!cols']?.[edit.column], wpx: edit.width, wch: undefined, width: undefined };
      continue;
    }
    const range = utils.decode_range(sheet['!ref'] ?? 'A1');
    range.e.c = Math.max(range.e.c, edit.column);
    if (edit.kind === 'cell') {
      if (!Number.isInteger(edit.row) || edit.row < 0 || edit.row >= officeLimits.rows) throw new Error('无效行');
      range.e.r = Math.max(range.e.r, edit.row);
      const address = utils.encode_cell({ r: edit.row, c: edit.column });
      const previous = sheet[address];
      // Text editing is literal: never execute an entered formula or external link.
      sheet[address] = { t: 's', v: edit.value, ...(previous?.s ? { s: previous.s } : {}) };
    } else {
      // A blank cell makes the appended column survive serialization and reopening.
      sheet[utils.encode_cell({ r: range.s.r, c: edit.column })] ??= { t: 's', v: '' };
    }
    sheet['!ref'] = utils.encode_range(range);
  }
  const output = new Uint8Array(write(book, { type: 'array', bookType: extension === 'xls' ? 'biff8' : 'xlsx', cellStyles: true }));
  if (output.length > officeLimits.fileBytes) throw new Error('工作簿超过 50 MiB');
  const verified = read(Uint8Array.from(output), options);
  for (const name of book.SheetNames) for (const [address, cell] of Object.entries(book.Sheets[name])) {
    if (!address.startsWith('!') && cell?.f && verified.Sheets[name]?.[address]?.f !== cell.f) {
      throw new Error('当前格式无法保留已有公式，已停止保存；请在 Office 中另存为 XLSX 后编辑');
    }
  }
  return output;
}
