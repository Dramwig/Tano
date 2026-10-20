import type { Node } from '@milkdown/kit/prose/model';
import { TextSelection } from '@milkdown/kit/prose/state';
import type { EditorState, Transaction } from '@milkdown/kit/prose/state';
import { CellSelection, TableMap, moveTableColumn, moveTableRow } from '@milkdown/kit/prose/tables';
import { closeHistory } from '@milkdown/kit/prose/history';
import type { TableColor } from '@tano/protocol';

export type TableAxis = 'row' | 'column';
export interface TableTarget { pos: number; axis: TableAxis; index: number }
export type TableAction = 'before' | 'after' | 'duplicate' | 'clear' | 'delete' | 'color' | 'textColor' | 'alignLeft' | 'alignCenter' | 'alignRight' | 'restoreAutoWidth';

/** Enter moves vertically; the last row grows without copying cell content or colors. */
export function nextTableRow(state: EditorState): Transaction | null {
  const { selection } = state;
  if (!(selection instanceof TextSelection)) return null;
  const { $from, $to } = selection;
  const cellDepth = $from.depth - 1;
  if (cellDepth < 1 || !['cell', 'header_cell'].includes($from.node(cellDepth).type.spec.tableRole ?? '') ||
      $to.depth < cellDepth || $from.node(cellDepth) !== $to.node(cellDepth)) return null;
  const tableDepth = cellDepth - 2;
  const table = $from.node(tableDepth);
  const start = $from.start(tableDepth);
  const map = TableMap.get(table);
  const rect = map.findCell($from.before(cellDepth) - start);
  const tr = state.tr;
  if (rect.bottom < map.height) {
    const pos = start + map.positionAt(rect.bottom, rect.left, table);
    return tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1))).scrollIntoView();
  }
  // Markdown tables have no merged cells. Do not mutate an imported merged table.
  if (table.content.content.some(row => row.content.content.some(cell => cell.attrs.rowspan !== 1 || cell.attrs.colspan !== 1)))
    return null;
  const cells = Array.from({ length: map.width }, (_, col) => {
    const header = table.nodeAt(map.map[col]!)!;
    return state.schema.nodes.table_cell!.createAndFill({ alignment: header.attrs.alignment, colwidth: header.attrs.colwidth })!;
  });
  const row = state.schema.nodes.table_row!.createChecked(null, cells);
  const end = $from.end(tableDepth);
  closeHistory(tr).insert(end, row);
  const pos = end + 1 + cells.slice(0, rect.left).reduce((size, cell) => size + cell.nodeSize, 0);
  return tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1))).scrollIntoView();
}

export function breakTableCell(state: EditorState): Transaction | null {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.$from.sameParent(selection.$to) ||
      selection.$from.parent.type.name !== 'paragraph' ||
      !['cell', 'header_cell'].includes(selection.$from.node(-1).type.spec.tableRole ?? '')) return null;
  // Avoid the commonmark hardbreak command: it filters tables and turns a second break into a paragraph.
  return state.tr.replaceSelectionWith(state.schema.nodes.hardbreak!.create(), false).scrollIntoView();
}

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
  const alignment = action === 'alignLeft' ? 'left' : action === 'alignCenter' ? 'center' : action === 'alignRight' ? 'right' : null;
  if (alignment && target.axis !== 'column') return null;
  const selection = tableLineSelection(state.doc, target);
  if (!selection) return null;
  const table = state.doc.nodeAt(target.pos)!;
  if (action === 'restoreAutoWidth') {
    if (table.attrs.autoWidth) return null;
    const tr = closeHistory(state.tr).setNodeMarkup(target.pos, undefined, { ...table.attrs, autoWidth: true });
    // Capture every fixed column in this undo step before automatic fitting changes
    // their presentation widths. Undo must restore the exact previous layout.
    for (const offset of new Set(TableMap.get(table).map))
      tr.setNodeMarkup(target.pos + 1 + offset, undefined, table.nodeAt(offset)!.attrs);
    return tr.setMeta('tanoBlockContextSelect', true);
  }
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
  if (action === 'clear' || action === 'color' || action === 'textColor' || alignment) {
    const tr = closeHistory(state.tr);
    selection.forEachCell((cell, pos) => {
      if (action === 'clear') tr.replaceWith(tr.mapping.map(pos + 1), tr.mapping.map(pos + cell.nodeSize - 1), state.schema.nodes.paragraph!.create());
      else if (alignment) tr.setNodeMarkup(pos, undefined, { ...cell.attrs, alignment });
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
