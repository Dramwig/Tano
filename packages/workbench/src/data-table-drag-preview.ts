/** Visual-only column reordering. Persist the order only when the user drops. */
export function createColumnDragPreview(root: HTMLElement, id: string, startX: number) {
  const grid = root.querySelector<HTMLTableElement>('.data-grid');
  const scroller = grid?.closest<HTMLElement>('.data-grid-scroll');
  if (!grid || !scroller) return;
  const headers = [...grid.querySelectorAll<HTMLElement>('thead th[data-field]')];
  const slots = headers.map(header => ({ id: header.dataset.field!, rect: header.getBoundingClientRect() }));
  const from = slots.findIndex(slot => slot.id === id);
  if (from < 0) return;
  const source = slots[from].rect;
  const initialScroll = scroller.scrollLeft;
  const viewportBottom = Math.min(window.innerHeight, scroller.getBoundingClientRect().bottom);
  const cells = [...grid.querySelectorAll<HTMLElement>('[data-field]')];
  const indices = new Map(slots.map((slot, index) => [slot.id, index]));
  const originals = cells.map(cell => ({ cell, index: indices.get(cell.dataset.field!)!, offset: 0,
    transform: cell.style.transform, transition: cell.style.transition, opacity: cell.style.opacity }));
  // Read geometry before writing styles; clone only the visible portion of the column.
  const visible = cells.filter(cell => cell.dataset.field === id)
    .map(cell => ({ cell, rect: cell.getBoundingClientRect() }))
    .filter(({ rect }) => rect.bottom >= source.top && rect.top <= viewportBottom);
  const contentBottom = visible.reduce((bottom, { rect }) => Math.max(bottom, rect.bottom), source.bottom);
  const layer = root.cloneNode(false) as HTMLElement;
  layer.removeAttribute('id');
  layer.classList.add('data-column-drag-preview');
  layer.setAttribute('aria-hidden', 'true');
  layer.inert = true;
  Object.assign(layer.style, {
    position: 'fixed', left: `${source.left}px`, top: `${source.top}px`, width: `${source.width}px`,
    height: `${Math.max(0, Math.min(contentBottom, viewportBottom) - source.top)}px`,
    minHeight: '0', overflow: 'hidden', pointerEvents: 'none', zIndex: '10000',
    background: 'var(--paper)',
    boxShadow: '0 0 10px #00000014, 0 0 0 1px #0000000f', borderRadius: '6px',
    willChange: 'transform', contain: 'layout paint',
  });
  for (const { cell, rect } of visible) {
    const table = grid.cloneNode(false) as HTMLElement;
    Object.assign(table.style, { position: 'absolute', left: '0', top: `${rect.top - source.top}px`, width: `${source.width}px`, margin: '0' });
    const section = document.createElement(cell.tagName === 'TH' ? 'thead' : 'tbody');
    const row = document.createElement('tr');
    const clone = cell.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
    Object.assign(clone.style, { width: `${source.width}px`, minWidth: `${source.width}px`, height: `${rect.height}px`, boxSizing: 'border-box' });
    row.append(clone); section.append(row); table.append(section); layer.append(table);
  }
  root.append(layer);
  const transition = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'none' : 'transform 180ms ease';
  for (const { cell } of originals) {
    if (cell.dataset.field === id) cell.style.opacity = '0';
  }
  let lastTo = from;
  const preview = {
    move(clientX: number) {
      layer.style.transform = `translate3d(${clientX - startX}px, 0, 0)`;
      preview.shift(preview.target(clientX));
    },
    target(clientX: number) {
      const x = clientX + scroller.scrollLeft - initialScroll;
      const slot = slots.find(slot => x >= slot.rect.left && x <= slot.rect.right);
      return slot && { id: slot.id, after: x > slot.rect.left + slot.rect.width / 2 };
    },
    shift(target?: { id: string; after: boolean }) {
      const index = target ? indices.get(target.id)! : from;
      const insertion = target ? index + Number(target.after) : from;
      const to = insertion > from ? insertion - 1 : insertion;
      if (to === lastTo) return;
      lastTo = to;
      for (const original of originals) {
        const { cell, index } = original;
        const offset = index > from && index <= to ? -source.width : index < from && index >= to ? source.width : 0;
        if (offset === original.offset) continue;
        original.offset = offset;
        cell.style.transition = transition;
        cell.style.transform = offset ? `translateX(${offset}px)` : original.transform;
      }
    },
    destroy() {
      layer.remove();
      for (const { cell, transform, transition, opacity } of originals) {
        if (cell.style.transform !== transform) cell.style.transform = transform;
        if (cell.style.transition !== transition) cell.style.transition = transition;
        if (cell.style.opacity !== opacity) cell.style.opacity = opacity;
      }
    },
  };
  return preview;
}

/** Rows only make room within their existing group; filtered records stay untouched. */
export function createRowDragPreview(root: HTMLElement, id: string, startY: number) {
  const grid = root.querySelector<HTMLTableElement>('.data-grid');
  const row = [...grid?.querySelectorAll<HTMLTableRowElement>('tbody tr[data-row]') ?? []]
    .find(row => row.dataset.row === id);
  if (!grid || !row?.parentElement) return;
  const rows = [...row.parentElement.querySelectorAll<HTMLTableRowElement>(':scope > tr[data-row]')];
  const originals = rows.map(row => ({ row, id: row.dataset.row!, rect: row.getBoundingClientRect(),
    transform: row.style.transform, transition: row.style.transition, opacity: row.style.opacity, offset: 0 }));
  const from = rows.indexOf(row);
  const source = originals[from].rect;
  const widths = [...row.cells].map(cell => cell.getBoundingClientRect().width);
  const layer = root.cloneNode(false) as HTMLElement;
  layer.removeAttribute('id');
  layer.classList.add('data-row-drag-preview');
  layer.setAttribute('aria-hidden', 'true');
  layer.inert = true;
  Object.assign(layer.style, {
    position: 'fixed', left: `${source.left}px`, top: `${source.top}px`,
    width: `${Math.max(0, Math.min(source.right, window.innerWidth) - source.left)}px`, height: `${source.height}px`,
    minHeight: '0', overflow: 'hidden', pointerEvents: 'none', zIndex: '10000',
    background: 'var(--paper)',
    boxShadow: '0 0 10px #00000014, 0 0 0 1px #0000000f', borderRadius: '5px',
    willChange: 'transform', contain: 'layout paint',
  });
  const table = grid.cloneNode(false) as HTMLTableElement;
  Object.assign(table.style, { width: `${source.width}px`, margin: '0' });
  const columns = document.createElement('colgroup');
  for (const width of widths) {
    const column = document.createElement('col');
    column.style.width = `${width}px`;
    columns.append(column);
  }
  const body = document.createElement('tbody');
  const clone = row.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
  clone.style.height = `${source.height}px`;
  body.append(clone); table.append(columns, body); layer.append(table); root.append(layer);
  row.style.opacity = '0';
  const transition = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'none' : 'transform 180ms ease';
  let lastTo = from;
  function target(clientY: number) {
    const slot = originals.find(slot => clientY >= slot.rect.top && clientY <= slot.rect.bottom);
    return slot && { id: slot.id, after: clientY > slot.rect.top + slot.rect.height / 2 };
  }
  return {
    target,
    move(clientY: number) {
      layer.style.transform = `translate3d(0, ${clientY - startY}px, 0)`;
      const next = target(clientY);
      const index = next ? originals.findIndex(row => row.id === next.id) : from;
      const insertion = next ? index + Number(next.after) : from;
      const to = insertion > from ? insertion - 1 : insertion;
      if (to === lastTo) return;
      lastTo = to;
      originals.forEach((original, index) => {
        const offset = index > from && index <= to ? -source.height : index < from && index >= to ? source.height : 0;
        if (offset === original.offset) return;
        original.offset = offset;
        original.row.style.transition = transition;
        original.row.style.transform = offset ? `translateY(${offset}px)` : original.transform;
      });
    },
    destroy() {
      layer.remove();
      for (const { row, transform, transition, opacity } of originals) {
        if (row.style.transform !== transform) row.style.transform = transform;
        if (row.style.transition !== transition) row.style.transition = transition;
        if (row.style.opacity !== opacity) row.style.opacity = opacity;
      }
    },
  };
}

type ReorderTarget = { id: string; after: boolean };
/** Pointer events keep both previews at display refresh speed, outside Vue rendering. */
export function startColumnPointerReorder(
  root: HTMLElement, id: string, down: PointerEvent,
  drop: (target: ReorderTarget) => void,
  start: () => void,
) {
  return startTablePointerReorder(root, id, down, drop, start, 'column');
}
export function startRowPointerReorder(
  root: HTMLElement, id: string, down: PointerEvent,
  drop: (target: ReorderTarget) => void,
  start: () => void,
) {
  return startTablePointerReorder(root, id, down, drop, start, 'row');
}
function startTablePointerReorder(
  root: HTMLElement, id: string, down: PointerEvent,
  drop: (target: ReorderTarget) => void, start: () => void, axis: 'column' | 'row',
) {
  if (down.button !== 0 || !down.isPrimary) return;
  const heading = down.currentTarget as HTMLElement;
  let preview: ReturnType<typeof createColumnDragPreview> | ReturnType<typeof createRowDragPreview>;
  const coordinate = (event: PointerEvent) => axis === 'column' ? event.clientX : event.clientY;
  let frame = 0, position = coordinate(down), finished = false;
  const userSelect = root.style.userSelect;
  function clearClickSuppression() {
    heading.removeEventListener('click', suppressClick, true);
    heading.removeEventListener('pointerdown', clearClickSuppression, true);
  }
  function suppressClick(event: MouseEvent) {
    clearClickSuppression();
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  function cleanup() {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(frame);
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', cancel);
    document.removeEventListener('keydown', keydown, true);
    window.removeEventListener('blur', cancel);
    heading.removeEventListener('lostpointercapture', cancel);
    if (heading.hasPointerCapture(down.pointerId)) heading.releasePointerCapture(down.pointerId);
    root.style.userSelect = userSelect;
    // Escape can finish before pointerup; consume its click, but never the next gesture.
    if (preview) heading.addEventListener('pointerdown', clearClickSuppression, { once: true, capture: true });
    else clearClickSuppression();
    preview?.destroy();
    preview = undefined;
  }
  function move(event: PointerEvent) {
    if (event.pointerId !== down.pointerId) return;
    position = coordinate(event);
    if (!preview) {
      if (Math.abs(position - coordinate(down)) < 5) return;
      start();
      preview = axis === 'column' ? createColumnDragPreview(root, id, down.clientX)
        : createRowDragPreview(root, id, down.clientY);
      if (!preview) { cleanup(); return; }
      root.style.userSelect = 'none';
      heading.addEventListener('click', suppressClick, true);
      heading.setPointerCapture(down.pointerId);
      heading.addEventListener('lostpointercapture', cancel);
    }
    event.preventDefault();
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; preview?.move(position); });
  }
  function up(event: PointerEvent) {
    if (event.pointerId !== down.pointerId) return;
    const rect = root.querySelector('.data-grid')?.getBoundingClientRect();
    const bounds = root.querySelector('.data-grid-scroll')?.getBoundingClientRect();
    const inside = axis === 'column' ? rect && event.clientY >= rect.top && event.clientY <= rect.bottom
      : bounds && event.clientX >= bounds.left && event.clientX <= bounds.right;
    const target = inside ? preview?.target(coordinate(event)) : undefined;
    cleanup();
    if (target && target.id !== id) drop(target);
  }
  function cancel() { cleanup(); }
  function keydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    cleanup();
  }
  document.addEventListener('pointermove', move, { passive: false });
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', cancel);
  document.addEventListener('keydown', keydown, true);
  window.addEventListener('blur', cancel);
  return cleanup;
}
