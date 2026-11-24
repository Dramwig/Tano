import { NodeSelection, TextSelection, type EditorState } from '@milkdown/kit/prose/state';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import type { EditorView } from '@milkdown/kit/prose/view';
import { closeHistory } from '@milkdown/kit/prose/history';
import { isElement, isNode } from '../primitives/dom-realm';
import { deleteBlocks, moveBlockBeside, moveBlocksTo, type blockTree } from './block-tree';
import { BlockRangeSelection } from './block-selection';

export interface DragDecorationState {
  doc: ProseMirrorNode;
  positions: number[];
}

export interface BlockDragContext {
  getView: () => EditorView;
  window: Window & typeof globalThis;
  document: Document;
  host: HTMLElement;
  hoverSurface: HTMLElement;
  marker: HTMLElement;
  readonly: () => boolean;
  columns: () => boolean;
  getEntries: () => ReturnType<typeof blockTree>;
  getPositions: () => number[];
  blockElement: (index: number) => Element | null;
  blockRect: (index: number) => DOMRect | null;
  flushLayout: () => void;
  showHoveredHandle: () => void;
  resetHover: () => void;
  getDragDecoration: () => DragDecorationState | null;
  setDragDecoration: (next: DragDecorationState | null) => void;
  isDestroyed: () => boolean;
  isMarqueeActive: () => boolean;
  cancelMarquee: () => void;
}

export function createBlockDragController(ctx: BlockDragContext) {
  const {
    window,
    document,
    host,
    hoverSurface,
    marker,
    readonly,
    columns,
    getEntries,
    getPositions,
    blockElement,
    blockRect,
    flushLayout,
    showHoveredHandle,
    resetHover,
    getDragDecoration,
    setDragDecoration,
    isDestroyed,
    isMarqueeActive,
    cancelMarquee,
  } = ctx;
  const getComputedStyle = (element: Element, pseudo?: string | null) =>
    window.getComputedStyle(element, pseudo);

  let sourceIndex: number | null = null;
  let startingDoc: EditorState['doc'] | null = null;
  let dragging = false;
  let sourcePositions: number[] = [];
  let dragPreview: HTMLElement | null = null;
  let dragPreviewOffset = { x: 0, y: 0 };
  let pendingPointer: {
    id: number;
    index: number;
    x: number;
    y: number;
    doc: EditorState['doc'];
  } | null = null;
  let suppressClick = false;
  let clickResetTimer: number | null = null;

  function removeDragPreview() {
    dragPreview?.remove();
    dragPreview = null;
  }

  function clearDragVisuals() {
    removeDragPreview();
    marker.hidden = true;
    host.classList.remove('tano-block-dragging');
  }

  function clearDrag() {
    const view = ctx.getView();
    const refresh = getDragDecoration()?.doc.eq(view.state.doc);
    setDragDecoration(null);
    clearDragVisuals();
    dragging = false;
    pendingPointer = null;
    sourceIndex = null;
    sourcePositions = [];
    startingDoc = null;
    resetHover();
    showHoveredHandle();
    if (refresh && !isDestroyed()) {
      view.dispatch(view.state.tr.setMeta('addToHistory', false));
    }
  }

  function findInsertion(x: number, y: number) {
    const view = ctx.getView();
    const entries = getEntries();
    let parentPos = -1;
    let depth = 0;
    // The horizontal inset chooses the parent. A container header remains a sibling target.
    for (const entry of entries) {
      if (
        entry.parentPos < 0 ||
        sourcePositions.some((pos) => {
          const node = view.state.doc.nodeAt(pos);
          return node && entry.parentPos >= pos && entry.parentPos < pos + node.nodeSize;
        })
      ) {
        continue;
      }
      const dom = view.nodeDOM(entry.parentPos);
      const content = isElement(dom)
        ? dom.matches('blockquote')
          ? dom
          : dom.querySelector(':scope > .tano-enhanced-content')
        : null;
      if (
        !content ||
        content.closest('[hidden], .tano-folded-heading-content, .tano-folded-list-content')
      ) {
        continue;
      }
      const rect = content.getBoundingClientRect();
      const firstBody =
        isElement(dom) && dom.matches('blockquote') ? view.nodeDOM(entry.pos) : null;
      const bodyTop = isElement(firstBody) ? firstBody.getBoundingClientRect().top : rect.top;
      if (
        entry.depth >= depth &&
        x >= rect.left + 12 &&
        x <= rect.right &&
        y >= bodyTop &&
        y <= rect.bottom
      ) {
        parentPos = entry.parentPos;
        depth = entry.depth;
      }
    }
    const siblings = entries
      .map((entry, i) => ({ ...entry, rect: blockRect(i) }))
      .filter((entry) => entry.parentPos === parentPos);
    const next = siblings.find(({ rect }) => rect && y < (rect.top + rect.bottom) / 2);
    const parent = parentPos === -1 ? view.state.doc : view.state.doc.nodeAt(parentPos)!;
    const index = next?.index ?? parent.childCount;
    const previous = siblings.find((entry) => entry.index === index - 1)?.rect;
    const rect = next?.rect ?? previous;
    return {
      parentPos,
      index,
      y:
        previous && next?.rect
          ? (previous.bottom + next.rect.top) / 2
          : (next?.rect?.top ?? previous?.bottom),
      rect,
    };
  }

  function findDropTarget(x: number, y: number) {
    const view = ctx.getView();
    const entries = getEntries();
    const source = sourceIndex == null ? null : entries[sourceIndex];
    if (source && sourcePositions.length === 1 && columns() && window.innerWidth > 640) {
      // Prefer the deepest visible block. Top/bottom edges keep ordinary vertical sorting.
      for (let index = entries.length - 1; index >= 0; index--) {
        const target = entries[index]!;
        const rect = blockRect(index);
        if (!rect || rect.width <= 0 || rect.height <= 0) continue;
        const inset = Math.min(8, rect.height * 0.2);
        if (y < rect.top + inset || y > rect.bottom - inset) continue;
        const edge = Math.min(48, rect.width * 0.18);
        const side: 'left' | 'right' | null =
          x >= rect.left - 20 && x <= rect.left + edge
            ? 'left'
            : x >= rect.right - edge && x <= rect.right + 20
              ? 'right'
              : null;
        if (side && moveBlockBeside(view.state, source.pos, target.pos, side)) {
          return { kind: 'column' as const, pos: target.pos, side, rect };
        }
      }
    }
    return { kind: 'vertical' as const, ...findInsertion(x, y) };
  }

  function showInsertion(target: ReturnType<typeof findDropTarget>) {
    const view = ctx.getView();
    const entries = getEntries();
    const source = sourceIndex == null ? null : entries[sourceIndex];
    const hostRect = host.getBoundingClientRect();
    marker.classList.toggle('is-column', target.kind === 'column');
    if (target.kind === 'column') {
      const gap = 8;
      const width = 3;
      // A side drop creates a sibling column, so keep the entire marker
      // outside the block (and clear of its selection highlight).
      const left =
        target.side === 'left' ? target.rect.left - gap - width : target.rect.right + gap;
      marker.hidden = false;
      marker.style.top = `${target.rect.top - hostRect.top}px`;
      marker.style.left = `${left - hostRect.left}px`;
      marker.style.width = `${width}px`;
      marker.style.height = `${target.rect.height}px`;
      return;
    }
    marker.hidden =
      !source ||
      target.y == null ||
      !moveBlocksTo(view.state, sourcePositions, target.parentPos, target.index);
    if (marker.hidden) return;
    marker.style.height = '2px';
    marker.style.top = `${target.y! - hostRect.top}px`;
    marker.style.left = `${(target.rect?.left ?? hostRect.left) - hostRect.left}px`;
    marker.style.width = `${target.rect?.width ?? hostRect.width}px`;
  }

  function movePreview(x: number, y: number) {
    if (dragPreview) {
      dragPreview.style.transform = `translate3d(${x - dragPreviewOffset.x}px, ${y - dragPreviewOffset.y}px, 0)`;
    }
  }

  function beginPointerDrag(index: number, x: number, y: number) {
    const view = ctx.getView();
    const positions = getPositions();
    const element = blockElement(index);
    if (!element) return;
    const sourceRect = element.getBoundingClientRect();
    dragging = true;
    sourceIndex = index;
    const selection = view.state.selection;
    sourcePositions =
      selection instanceof BlockRangeSelection &&
      selection.blocks.some((block) => block.pos === positions[index])
        ? selection.blocks.map((block) => block.pos)
        : [positions[index]!];
    startingDoc = view.state.doc;
    // Keep the preview outside contenteditable so it cannot enter Markdown.
    const preview = document.createElement('div');
    preview.className = 'tano-prose tano-block-drag-preview';
    preview.setAttribute('aria-hidden', 'true');
    preview.inert = true;
    preview.style.width = `${element.getBoundingClientRect().width}px`;
    preview.style.fontSize = getComputedStyle(view.dom).fontSize;
    const draggedElements = sourcePositions
      .map((pos) => view.nodeDOM(pos))
      .filter((node): node is Element => isElement(node));
    for (const dragged of draggedElements) {
      const copy = dragged.cloneNode(true) as HTMLElement;
      for (const item of [copy, ...copy.querySelectorAll('*')]) {
        item.removeAttribute('id');
        item.removeAttribute('contenteditable');
        item.classList.remove(
          'ProseMirror-selectednode',
          'tano-block-selected',
          'tano-block-drag-source',
        );
      }
      copy.querySelectorAll('.tano-column-controls').forEach((el) => el.remove());
      preview.append(copy);
    }
    host.append(preview);
    // Anchor the grabbed block, even when it is in the middle of a group.
    // Measure its clone to include preview padding and collapsed margins.
    const copyRect = preview.children[draggedElements.indexOf(element)]!.getBoundingClientRect();
    const previewRect = preview.getBoundingClientRect();
    dragPreviewOffset = {
      x: x - sourceRect.left + copyRect.left - previewRect.left,
      y: y - sourceRect.top + copyRect.top - previewRect.top,
    };
    dragPreview = preview;
    movePreview(x, y);
    setDragDecoration({ doc: view.state.doc, positions: sourcePositions });
    host.classList.add('tano-block-dragging');
    view.dispatch(view.state.tr.setMeta('addToHistory', false));
    showHoveredHandle();
  }

  function onPointerDown(event: PointerEvent) {
    const view = ctx.getView();
    flushLayout();
    const handle = (event.target as Element).closest<HTMLButtonElement>('.tano-block-handle');
    if (!handle || readonly() || event.button !== 0) return;
    // Keep the custom range focused; native button focus would turn its DOM
    // range into a text selection before the grouped drag starts.
    if (view.state.selection instanceof BlockRangeSelection) event.preventDefault();
    pendingPointer = {
      id: event.pointerId,
      index: Number(handle.dataset.blockIndex),
      x: event.clientX,
      y: event.clientY,
      doc: view.state.doc,
    };
    handle.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent) {
    const view = ctx.getView();
    const pending = pendingPointer;
    if (!pending || event.pointerId !== pending.id) return;
    if (readonly() || !pending.doc.eq(view.state.doc)) {
      clearDrag();
      return;
    }
    if (!dragging) {
      const distance = Math.hypot(event.clientX - pending.x, event.clientY - pending.y);
      if (distance < 5) return;
      beginPointerDrag(pending.index, pending.x, pending.y);
    }
    if (!dragging) return;
    event.preventDefault();
    movePreview(event.clientX, event.clientY);
    showInsertion(findDropTarget(event.clientX, event.clientY));
  }

  function handlePointerUp(event: PointerEvent) {
    const view = ctx.getView();
    const entries = getEntries();
    const pending = pendingPointer;
    if (!pending || event.pointerId !== pending.id) return;
    const wasDragging = dragging;
    const rect = hoverSurface.getBoundingClientRect();
    const inside =
      rect.width > 0 && rect.height > 0
        ? event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom
        : isNode(event.target) && hoverSurface.contains(event.target);
    // A remote collaborator or a local edit may have changed positions mid-drag.
    if (
      dragging &&
      inside &&
      sourceIndex != null &&
      !readonly() &&
      startingDoc?.eq(view.state.doc)
    ) {
      const target = findDropTarget(event.clientX, event.clientY);
      const transaction =
        target.kind === 'column'
          ? moveBlockBeside(view.state, entries[sourceIndex]!.pos, target.pos, target.side)
          : moveBlocksTo(view.state, sourcePositions, target.parentPos, target.index);
      if (transaction) {
        view.dispatch(closeHistory(transaction.scrollIntoView()));
        view.dispatch(closeHistory(view.state.tr));
        view.focus();
      }
    }
    if (wasDragging) {
      event.preventDefault();
      suppressClick = true;
      if (clickResetTimer != null) clearTimeout(clickResetTimer);
      clickResetTimer = window.setTimeout(() => {
        suppressClick = false;
        clickResetTimer = null;
      }, 0);
    }
    clearDrag();
  }

  function handlePointerCancel(event: PointerEvent) {
    if (pendingPointer?.id === event.pointerId) clearDrag();
  }

  function onDragKeyDown(event: KeyboardEvent) {
    const view = ctx.getView();
    if (
      (event.key === 'Backspace' || event.key === 'Delete') &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.isComposing &&
      !view.composing &&
      !readonly()
    ) {
      const target = event.target;
      const insideEditor = target === view.dom || (isNode(target) && view.dom.contains(target));
      const insideBlockMenu = isElement(target) && !!target.closest('.block-context-menu');
      const selection = view.state.selection;
      const selectedPositions =
        selection instanceof BlockRangeSelection
          ? selection.blocks.map((block) => block.pos)
          : selection instanceof NodeSelection && selection.node.isBlock
            ? [selection.from]
            : [];
      if ((insideEditor || insideBlockMenu) && selectedPositions.length) {
        const transaction = deleteBlocks(view.state, selectedPositions);
        if (transaction) {
          event.preventDefault();
          event.stopPropagation();
          view.dispatch(transaction.scrollIntoView());
          view.focus();
          return;
        }
      }
    }
    if (event.key === 'Escape' && isMarqueeActive()) {
      event.preventDefault();
      event.stopPropagation();
      cancelMarquee();
      return;
    }
    if (
      event.key === 'Escape' &&
      !pendingPointer &&
      view.state.selection instanceof BlockRangeSelection
    ) {
      const caret = TextSelection.findFrom(view.state.selection.$from, 1, true);
      if (caret) {
        view.dispatch(
          view.state.tr
            .setSelection(caret)
            .setMeta('addToHistory', false)
            .setMeta('tanoKeepNodeView', true),
        );
      }
      event.preventDefault();
      return;
    }
    if (event.key !== 'Escape' || !pendingPointer) return;
    event.preventDefault();
    event.stopPropagation();
    clearDrag();
  }

  function consumeSuppressClick(): boolean {
    if (!suppressClick) return false;
    suppressClick = false;
    return true;
  }

  function syncDoc() {
    const view = ctx.getView();
    if (startingDoc && !startingDoc.eq(view.state.doc)) {
      clearDrag();
    }
  }

  function destroy() {
    clearDrag();
    if (clickResetTimer != null) clearTimeout(clickResetTimer);
  }

  return {
    isDragging: () => dragging,
    getSourceIndex: () => sourceIndex,
    hasPendingPointer: () => !!pendingPointer,
    clearDrag,
    onPointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    onDragKeyDown,
    consumeSuppressClick,
    syncDoc,
    destroy,
  };
}
