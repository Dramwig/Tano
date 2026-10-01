import type { Node } from '@milkdown/kit/prose/model';
import type { EditorState, Transaction } from '@milkdown/kit/prose/state';
import { CellSelection, TableMap, moveTableColumn, moveTableRow } from '@milkdown/kit/prose/tables';
import { closeHistory } from '@milkdown/kit/prose/history';
import type { TableColor } from '@tano/protocol';

export type TableAxis = 'row' | 'column';
export interface TableTarget { pos: number; axis: TableAxis; index: number }
export type TableAction = 'before' | 'after' | 'duplicate' | 'clear' | 'delete' | 'color' | 'textColor';

export function tableLineSelection(doc: Node, target: TableTarget): CellSelection | null {
  const table = doc.nodeAt(target.pos);
  if (table?.type.name !== 'table') return null;
  const map = TableMap.get(table);
  if (target.index < 0 || target.index >= (target.axis === 'row' ? map.height : map.width)) return null;
  const first = target.axis === 'row' ? target.index * map.width : target.index;
  const last = target.axis === 'row' ? first + map.width - 1 : (map.height - 1) * map.width + target.index;
  const start = target.pos + 1;
  const anchor = doc.resolve(start + map.map[first]!);
  const head = doc.resolve(start + map.map[last]!);
  return target.axis === 'row' ? CellSelection.rowSelection(anchor, head) : CellSelection.colSelection(anchor, head);
}

/** GFM requires exactly one header followed by at least one body row. */
export function tableLineAction(state: EditorState, target: TableTarget, action: TableAction, color: TableColor | null = null): Transaction | null {
  const selection = tableLineSelection(state.doc, target);
  if (!selection) return null;
  const table = state.doc.nodeAt(target.pos)!;
  const rows: Node[][] = [];
  table.forEach(row => {
    const cells: Node[] = [];
    row.forEach(cell => cells.push(cell));
    rows.push(cells);
  });
  // Markdown tables have no merged cells; leave imported merged tables to their native commands.
  if (rows.some(row => row.some(cell => cell.attrs.colspan !== 1 || cell.attrs.rowspan !== 1))) return null;
  const empty = (cell: Node) => cell.type.create({ ...cell.attrs, background: null, foreground: null }, state.schema.nodes.paragraph!.create());
  let selected = target.index;
  if (action === 'clear' || action === 'color' || action === 'textColor') {
    const tr = closeHistory(state.tr);
    selection.forEachCell((cell, pos) => {
      if (action === 'clear') tr.replaceWith(tr.mapping.map(pos + 1), tr.mapping.map(pos + cell.nodeSize - 1), state.schema.nodes.paragraph!.create());
      else tr.setNodeMarkup(pos, undefined, { ...cell.attrs, [action === 'textColor' ? 'foreground' : 'background']: color });
    });
    const next = tableLineSelection(tr.doc, target);
    if (next) tr.setSelection(next);
    return tr.setMeta('tanoBlockContextSelect', true);
  }
  if (action === 'delete') {
    if (target.axis === 'column' && rows[0]!.length === 1)
      return closeHistory(state.tr).delete(target.pos, target.pos + table.nodeSize);
    if (target.axis === 'row') {
      rows.splice(target.index, 1);
      if (rows.length === 1) rows.push(rows[0]!.map(empty));
      selected = Math.min(selected, rows.length - 1);
    } else {
      rows.forEach(row => row.splice(target.index, 1));
      selected = Math.min(selected, rows[0]!.length - 1);
    }
  } else {
    selected = target.index + (action === 'before' ? 0 : 1);
    if (target.axis === 'row') {
      const source = rows[target.index]!;
      rows.splice(selected, 0, action === 'duplicate' ? [...source] : source.map(empty));
    } else {
      rows.forEach(row => row.splice(selected, 0, action === 'duplicate' ? row[target.index]! : empty(row[target.index]!)));
    }
  }
  const converted = rows.map((cells, index) => {
    const rowType = state.schema.nodes[index === 0 ? 'table_header_row' : 'table_row']!;
    const cellType = state.schema.nodes[index === 0 ? 'table_header' : 'table_cell']!;
    return rowType.createChecked(null, cells.map(cell => cellType.createChecked(cell.attrs, cell.content, cell.marks)));
  });
  const nextTable = table.type.createChecked(table.attrs, converted, table.marks);
  const tr = closeHistory(state.tr).replaceWith(target.pos, target.pos + table.nodeSize, nextTable);
  const nextSelection = tableLineSelection(tr.doc, { ...target, index: selected });
  if (nextSelection) tr.setSelection(nextSelection);
  return tr.setMeta('tanoBlockContextSelect', true);
}

export function moveTableLine(state: EditorState, target: TableTarget, to: number): Transaction | null {
  if (!tableLineSelection(state.doc, target) || to === target.index) return null;
  const map = TableMap.get(state.doc.nodeAt(target.pos)!);
  if (!Number.isInteger(to) || to < 0 || to >= (target.axis === 'row' ? map.height : map.width)) return null;
  const command = target.axis === 'row' ? moveTableRow : moveTableColumn;
  let result: Transaction | null = null;
  command({ from: target.index, to, pos: target.pos + 1, select: true })(state, tr => {
    result = closeHistory(tr).setMeta('tanoBlockContextSelect', true);
  });
  return result;
}
