import { isElement, ownerWindow } from './primitives/dom-realm';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorState, Transaction } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { moveBlockTo } from './block-tree';
import { BlockRangeSelection } from './block-selection';
import { applyFoldingState, buildFoldingDecorations } from './blocks-folding';
import { createBlockHandlesController } from './blocks-handles';
import { createBlockDragController, type DragDecorationState } from './blocks-drag';
import { createBlockMarqueeController } from './blocks-marquee';

/** Move one top-level Markdown block in a single, undoable editor transaction. */
export function moveBlock(
  state: EditorState,
  sourceIndex: number,
  insertionIndex: number,
): Transaction | null {
  const { doc } = state;
  if (
    sourceIndex < 0 ||
    sourceIndex >= doc.childCount ||
    insertionIndex < 0 ||
    insertionIndex > doc.childCount ||
    insertionIndex === sourceIndex ||
    insertionIndex === sourceIndex + 1
  ) {
    return null;
  }

  let sourcePos = 0;
  doc.forEach((_node, offset, index) => {
    if (index === sourceIndex) sourcePos = offset;
  });
  return moveBlockTo(state, sourcePos, -1, insertionIndex);
}

/** A gutter beside the document, outside contenteditable and Markdown serialization. */
export function blockControls(
  readonly: () => boolean,
  folding: () => boolean = () => true,
  columns: () => boolean = () => true,
  openMenu?: (event: MouseEvent, handle: HTMLButtonElement) => void,
) {
  const foldingKey = new PluginKey<Set<string>>('tano-folding');
  let dragDecoration: DragDecorationState | null = null;
  return new Plugin({
    key: foldingKey,
    state: {
      init: () => new Set<string>(),
      apply(transaction, current) {
        return applyFoldingState(transaction, current, foldingKey);
      },
    },
    props: {
      createSelectionBetween(view, $anchor, $head) {
        const selected = view.state.selection;
        if (!(selected instanceof BlockRangeSelection)) return null;
        // Browsers normalize block-boundary DOM ranges to their first/last text
        // positions. Reading that same range must not discard whole-block mode.
        const text = TextSelection.between(selected.$anchor, selected.$head);
        return ($anchor.pos === selected.anchor && $head.pos === selected.head) ||
          ($anchor.pos === text.anchor && $head.pos === text.head)
          ? selected
          : null;
      },
      handleClickOn(_view, _pos, node, _nodePos, event, direct) {
        // Leaf blocks have no text caret, so ProseMirror selects the whole node on click.
        // Whole-block selection is reserved for the gutter handle and context menu.
        return (
          event.button === 0 &&
          direct &&
          node.isBlock &&
          (node.isAtom || (isElement(event.target) && !!event.target.closest('.tano-mermaid')))
        );
      },
      decorations(state) {
        const decorations: Decoration[] =
          state.selection instanceof BlockRangeSelection
            ? state.selection.blocks.map(({ pos, node }) =>
                Decoration.node(pos, pos + node.nodeSize, { class: 'tano-block-selected' }),
              )
            : [];
        if (dragDecoration?.doc.eq(state.doc)) {
          for (const pos of dragDecoration.positions) {
            const node = state.doc.nodeAt(pos);
            if (node) {
              decorations.push(
                Decoration.node(pos, pos + node.nodeSize, { class: 'tano-block-drag-source' }),
              );
            }
          }
        }
        const foldingDecorations = buildFoldingDecorations(state, foldingKey, folding());
        if (foldingDecorations.length) decorations.push(...foldingDecorations);
        return DecorationSet.create(state.doc, decorations);
      },
    },
    view(initialView) {
      let view = initialView;
      const window = ownerWindow(view.dom);
      const document = view.dom.ownerDocument;
      const { ResizeObserver } = window;
      const host = view.dom.parentElement!;
      const hoverSurface = host.closest<HTMLElement>('.editor-scroll') ?? host.parentElement ?? host;
      const controls = document.createElement('div');
      controls.className = 'tano-block-controls';
      controls.setAttribute('aria-label', '文章块排序');
      const marker = document.createElement('div');
      marker.className = 'tano-block-drop-line';
      marker.hidden = true;
      controls.append(marker);
      host.append(controls);

      let destroyed = false;
      let dragRef!: ReturnType<typeof createBlockDragController>;
      let marqueeRef!: ReturnType<typeof createBlockMarqueeController>;

      const handles = createBlockHandlesController({
        getView: () => view,
        window,
        document,
        host,
        hoverSurface,
        controls,
        foldingKey,
        readonly,
        folding,
        openMenu,
        isDragging: () => dragRef.isDragging(),
        getSourceIndex: () => dragRef.getSourceIndex(),
        clearDrag: () => dragRef.clearDrag(),
        consumeSuppressClick: () => dragRef.consumeSuppressClick(),
        isDestroyed: () => destroyed,
      });

      marqueeRef = createBlockMarqueeController({
        getView: () => view,
        window,
        document,
        host,
        hoverSurface,
        readonly,
        getEntries: handles.getEntries,
        blockRect: handles.blockRect,
        flushLayout: handles.flushLayout,
        hasPendingPointer: () => dragRef.hasPendingPointer(),
      });

      dragRef = createBlockDragController({
        getView: () => view,
        window,
        document,
        host,
        hoverSurface,
        marker,
        readonly,
        columns,
        getEntries: handles.getEntries,
        getPositions: handles.getPositions,
        blockElement: handles.blockElement,
        blockRect: handles.blockRect,
        flushLayout: handles.flushLayout,
        showHoveredHandle: handles.showHoveredHandle,
        resetHover: handles.resetHover,
        getDragDecoration: () => dragDecoration,
        setDragDecoration: (next) => {
          dragDecoration = next;
        },
        isDestroyed: () => destroyed,
        isMarqueeActive: marqueeRef.isActive,
        cancelMarquee: marqueeRef.cancelMarquee,
      });

      function onPointerMove(event: PointerEvent) {
        if (marqueeRef.moveMarquee(event)) return;
        dragRef.handlePointerMove(event);
      }

      function onPointerUp(event: PointerEvent) {
        if (marqueeRef.handlePointerUp(event)) return;
        dragRef.handlePointerUp(event);
      }

      function onPointerCancel(event: PointerEvent) {
        marqueeRef.handlePointerCancel(event);
        dragRef.handlePointerCancel(event);
      }

      controls.addEventListener('pointerdown', dragRef.onPointerDown);
      controls.addEventListener('keydown', handles.onKeyDown);
      controls.addEventListener('click', handles.onHandleClick);
      controls.addEventListener('click', handles.onFoldClick);
      view.dom.addEventListener('keydown', handles.onEditorKeyDown, true);
      view.dom.addEventListener('beforeinput', handles.onEditorInput, true);
      view.dom.addEventListener('compositionstart', handles.onEditorInput, true);
      view.dom.addEventListener('scroll', handles.onTableScroll, true);
      if (!handles.observing) window.addEventListener('scroll', handles.onFallbackScroll, true);
      view.dom.addEventListener('tano-table-layout', handles.scheduleLayout);
      view.dom.addEventListener('tano-block-layout', handles.scheduleLayout);
      hoverSurface.addEventListener('mouseover', handles.onHover);
      hoverSurface.addEventListener('mousemove', handles.onHover);
      hoverSurface.addEventListener('mouseleave', handles.onHoverLeave);
      hoverSurface.addEventListener('pointerdown', marqueeRef.startMarquee, true);
      hoverSurface.addEventListener('pointerdown', marqueeRef.dismissBlockSelection, true);
      hoverSurface.addEventListener('click', marqueeRef.onMarqueeClick, true);
      window.addEventListener('pointermove', onPointerMove, true);
      window.addEventListener('pointerup', onPointerUp, true);
      window.addEventListener('pointercancel', onPointerCancel, true);
      window.addEventListener('keydown', dragRef.onDragKeyDown, true);
      window.addEventListener('blur', dragRef.clearDrag);
      window.addEventListener('blur', marqueeRef.cancelMarquee);
      const observer =
        typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(handles.scheduleLayout);
      observer?.observe(view.dom);
      window.addEventListener('resize', handles.scheduleLayout);
      handles.layout();

      return {
        update(nextView) {
          view = nextView;
          dragRef.syncDoc();
          handles.syncControls();
          marqueeRef.syncDoc();
          handles.showHoveredHandle();
          handles.scheduleLayout();
        },
        destroy() {
          destroyed = true;
          handles.destroy();
          dragRef.destroy();
          marqueeRef.destroy();
          observer?.disconnect();
          window.removeEventListener('resize', handles.scheduleLayout);
          window.removeEventListener('pointermove', onPointerMove, true);
          window.removeEventListener('pointerup', onPointerUp, true);
          window.removeEventListener('pointercancel', onPointerCancel, true);
          window.removeEventListener('keydown', dragRef.onDragKeyDown, true);
          window.removeEventListener('blur', dragRef.clearDrag);
          window.removeEventListener('blur', marqueeRef.cancelMarquee);
          controls.removeEventListener('pointerdown', dragRef.onPointerDown);
          controls.removeEventListener('keydown', handles.onKeyDown);
          controls.removeEventListener('click', handles.onHandleClick);
          controls.removeEventListener('click', handles.onFoldClick);
          view.dom.removeEventListener('keydown', handles.onEditorKeyDown, true);
          view.dom.removeEventListener('beforeinput', handles.onEditorInput, true);
          view.dom.removeEventListener('compositionstart', handles.onEditorInput, true);
          view.dom.removeEventListener('scroll', handles.onTableScroll, true);
          window.removeEventListener('scroll', handles.onFallbackScroll, true);
          view.dom.removeEventListener('tano-table-layout', handles.scheduleLayout);
          view.dom.removeEventListener('tano-block-layout', handles.scheduleLayout);
          hoverSurface.removeEventListener('mouseover', handles.onHover);
          hoverSurface.removeEventListener('mousemove', handles.onHover);
          hoverSurface.removeEventListener('mouseleave', handles.onHoverLeave);
          hoverSurface.removeEventListener('pointerdown', marqueeRef.dismissBlockSelection, true);
          hoverSurface.removeEventListener('pointerdown', marqueeRef.startMarquee, true);
          hoverSurface.removeEventListener('click', marqueeRef.onMarqueeClick, true);
          controls.remove();
        },
      };
    },
  });
}
