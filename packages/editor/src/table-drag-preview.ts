import type { EditorView } from '@milkdown/kit/prose/view';
import { tableLineSelection } from './table-commands';
import type { TableTarget } from './table-commands';

/** Snapshot only the selected cells outside contenteditable; movement never changes the document. */
export function createTableDragPreview(
  view: EditorView,
  target: TableTarget,
  grip: HTMLElement,
  pointer: { x: number; y: number },
  visible: { left: number; right: number; top: number; bottom: number },
) {
  const cells: HTMLElement[] = [];
  tableLineSelection(view.state.doc, target)?.forEachCell((_cell, pos) => {
    const dom = view.nodeDOM(pos);
    if (dom instanceof HTMLElement) cells.push(dom);
  });
  if (!cells.length) return null;
  const table = cells[0]!.closest('table');
  if (!table) return null;
  const rects = cells.map(cell => cell.getBoundingClientRect());
  const origin = {
    left: Math.min(...rects.map(rect => rect.left)),
    right: Math.max(...rects.map(rect => rect.right)),
    top: Math.min(...rects.map(rect => rect.top)),
    bottom: Math.max(...rects.map(rect => rect.bottom)),
  };
  const left = Math.max(origin.left, visible.left);
  const right = Math.min(origin.right, visible.right);
  const top = Math.max(origin.top, visible.top);
  const bottom = Math.min(origin.bottom, visible.bottom);
  if (left >= right || top >= bottom) return null;

  const preview = document.createElement('div');
  preview.className = `tano-prose tano-table-drag-preview is-${target.axis}`;
  preview.setAttribute('aria-hidden', 'true');
  preview.inert = true;
  preview.style.width = `${right - left}px`;
  preview.style.height = `${bottom - top}px`;
  preview.style.fontSize = getComputedStyle(view.dom).fontSize;
  preview.style.fontFamily = getComputedStyle(view.dom).fontFamily;
  preview.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  const copy = table.cloneNode(false) as HTMLTableElement;
  Object.assign(copy.style, {
    // Viewport gutters and the full table's minimum width do not belong to the selected slice.
    margin: '0', minWidth: '0',
    width: `${origin.right - origin.left}px`,
    left: `${origin.left - left}px`, top: `${origin.top - top}px`,
    font: getComputedStyle(table).font,
  });
  const widths = document.createElement('colgroup');
  const body = document.createElement('tbody');
  copy.append(widths, body);
  let sourceRow: Element | null = null;
  let copyRow: HTMLTableRowElement | null = null;
  cells.forEach((cell, index) => {
    if (cell.parentElement !== sourceRow) {
      sourceRow = cell.parentElement;
      copyRow = sourceRow!.cloneNode(false) as HTMLTableRowElement;
      copyRow.style.height = `${sourceRow!.getBoundingClientRect().height}px`;
      body.append(copyRow);
    }
    const rect = rects[index]!;
    const copyCell = cell.cloneNode(true) as HTMLElement;
    copyCell.style.width = `${rect.width}px`;
    copyCell.style.height = `${rect.height}px`;
    copyRow!.append(copyCell);
    if (body.childElementCount === 1) {
      const column = document.createElement('col');
      column.style.width = `${rect.width}px`;
      widths.append(column);
    }
  });
  for (const element of [copy, ...copy.querySelectorAll('*')]) {
    element.removeAttribute('id');
    element.removeAttribute('contenteditable');
    element.classList.remove('selectedCell', 'ProseMirror-selectednode');
  }
  copy.querySelectorAll('.column-resize-handle, .tano-editor-panel').forEach(element => element.remove());
  preview.append(copy);
  const host = view.dom.parentElement!;
  host.append(preview);
  host.classList.add('tano-table-dragging');

  let frame: number | undefined;
  let dx = 0;
  let dy = 0;
  return {
    move(x: number, y: number) {
      dx = target.axis === 'column' ? x - pointer.x : 0;
      dy = target.axis === 'row' ? y - pointer.y : 0;
      if (frame !== undefined) return;
      frame = window.requestAnimationFrame(() => {
        frame = undefined;
        preview.style.transform = `translate3d(${left + dx}px, ${top + dy}px, 0)`;
        grip.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      });
    },
    destroy() {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      preview.remove();
      host.classList.remove('tano-table-dragging');
      grip.style.transform = '';
    },
  };
}
