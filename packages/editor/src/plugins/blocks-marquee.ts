import { NodeSelection, TextSelection, type EditorState } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { isElement } from '../primitives/dom-realm';
import { BlockRangeSelection } from './block-selection';
import type { blockTree } from './block-tree';

export interface BlockMarqueeContext {
  getView: () => EditorView;
  window: Window & typeof globalThis;
  document: Document;
  host: HTMLElement;
  hoverSurface: HTMLElement;
  readonly: () => boolean;
  getEntries: () => ReturnType<typeof blockTree>;
  blockRect: (index: number) => DOMRect | null;
  flushLayout: () => void;
  hasPendingPointer: () => boolean;
}

export function createBlockMarqueeController(ctx: BlockMarqueeContext) {
  const { window, document, host, hoverSurface, readonly, getEntries, blockRect, flushLayout } =
    ctx;

  const marqueeBox = document.createElement('div');
  marqueeBox.className = 'tano-block-selection-box';
  marqueeBox.hidden = true;
  marqueeBox.setAttribute('aria-hidden', 'true');
  host.append(marqueeBox);

  let marquee: { id: number; x: number; y: number; active: boolean; state: EditorState } | null =
    null;
  let suppressMarqueeClick = false;
  let marqueeClickTimer: number | undefined;

  function dismissBlockSelection(event: PointerEvent) {
    const view = ctx.getView();
    const { selection, doc } = view.state;
    const target = event.target;
    if (
      event.button !== 0 ||
      event.shiftKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      view.composing ||
      view.dragging ||
      ctx.hasPendingPointer() ||
      marquee ||
      !(
        (selection instanceof NodeSelection && selection.node.isBlock) ||
        selection instanceof BlockRangeSelection
      ) ||
      !isElement(target)
    ) {
      return;
    }
    // Keep the selection available to block actions and floating editor controls.
    if (
      target.closest(
        '.tano-block-controls, .tano-editor-panel, [role="menu"], button, input, textarea, select',
      )
    ) {
      return;
    }
    const selectedDOM =
      selection instanceof BlockRangeSelection
        ? selection.blocks.map((block) => view.nodeDOM(block.pos)).find((dom) => dom?.contains(target))
        : view.nodeDOM(selection.from);
    if (
      selectedDOM?.contains(target) &&
      ((selection instanceof NodeSelection && selection.node.isAtom) ||
        target.closest('[contenteditable]')?.getAttribute('contenteditable') === 'false')
    ) {
      return;
    }
    // Clear whole-block selection before ProseMirror's mousedown handler can
    // treat the selected node as draggable. Native dragging then selects text.
    // Backgrounds and noneditable previews do not update ProseMirror's selection.
    // Let the subsequent native click still place the caret or start a new selection.
    const caret =
      TextSelection.findFrom(selection.$from, 1, true) ??
      TextSelection.findFrom(doc.resolve(selection.to), -1, true);
    if (caret) {
      view.dispatch(
        view.state.tr
          .setSelection(caret)
          .setMeta('addToHistory', false)
          .setMeta('tanoKeepNodeView', true),
      );
      // The menu owns focus, so dispatch alone leaves the old DOM range in
      // place. Sync it before native mousedown can drag that entire range.
      if (selectedDOM?.contains(target)) view.focus();
    }
  }

  function startMarquee(event: PointerEvent) {
    const view = ctx.getView();
    if (
      readonly() ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      view.composing ||
      !isElement(event.target) ||
      event.target.closest(
        'button, input, textarea, select, a, .document-cover, .tano-block-controls, .tano-editor-panel, [role="menu"]',
      )
    ) {
      return;
    }
    const rect = view.dom.getBoundingClientRect();
    // The left gutter includes the space beside the document title. Only
    // editor block entries participate in hit testing, never the page title.
    const surface = hoverSurface.getBoundingClientRect();
    if (event.clientX >= rect.left || event.clientY < surface.top || event.clientY > rect.bottom + 12) {
      return;
    }
    flushLayout();
    marquee = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      active: false,
      state: view.state,
    };
    event.preventDefault();
  }

  function moveMarquee(event: PointerEvent): boolean {
    const current = marquee;
    if (!current) return false;
    if (current.id !== event.pointerId) return true;
    const view = ctx.getView();
    if (readonly() || !current.state.doc.eq(view.state.doc)) {
      cancelMarquee();
      return true;
    }
    if (!current.active && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 5) {
      return true;
    }
    current.active = true;
    event.preventDefault();
    const top = Math.min(current.y, event.clientY);
    const bottom = Math.max(current.y, event.clientY);
    const left = Math.min(current.x, event.clientX);
    const right = Math.max(current.x, event.clientX);
    const entries = getEntries();
    const hits = entries.filter((entry, index) => {
      if (entry.parentPos !== -1) return false;
      const rect = blockRect(index);
      // The gutter can start a marquee, but only actual block overlap selects it.
      return (
        rect &&
        rect.height > 0 &&
        rect.bottom > top &&
        rect.top < bottom &&
        right > rect.left &&
        left < rect.right
      );
    });
    marqueeBox.hidden = false;
    Object.assign(marqueeBox.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${right - left}px`,
      height: `${bottom - top}px`,
    });
    if (!hits.length) {
      if (!view.state.selection.eq(current.state.selection)) {
        view.dispatch(
          view.state.tr
            .setSelection(current.state.selection)
            .setMeta('addToHistory', false)
            .setMeta('tanoKeepNodeView', true),
        );
      }
      return true;
    }
    const first = hits[0]!.pos;
    const last = hits.at(-1)!.pos;
    const selection = BlockRangeSelection.betweenBlocks(
      view.state.doc,
      event.clientY >= current.y ? first : last,
      event.clientY >= current.y ? last : first,
    )!;
    if (!selection.eq(view.state.selection)) {
      view.dispatch(view.state.tr.setSelection(selection).setMeta('addToHistory', false));
    }
    return true;
  }

  function cancelMarquee() {
    const view = ctx.getView();
    const current = marquee;
    marquee = null;
    marqueeBox.hidden = true;
    if (
      current?.active &&
      current.state.doc.eq(view.state.doc) &&
      !view.state.selection.eq(current.state.selection)
    ) {
      view.dispatch(
        view.state.tr
          .setSelection(current.state.selection)
          .setMeta('addToHistory', false)
          .setMeta('tanoKeepNodeView', true),
      );
    }
  }

  function handlePointerUp(event: PointerEvent): boolean {
    if (marquee?.id !== event.pointerId) return false;
    const view = ctx.getView();
    const active = marquee.active;
    marquee = null;
    marqueeBox.hidden = true;
    if (active) {
      event.preventDefault();
      suppressMarqueeClick = true;
      marqueeClickTimer = window.setTimeout(() => {
        suppressMarqueeClick = false;
      }, 0);
      view.focus();
    } else {
      // Gutter pointerdown defers dismissal so a drag can retain its
      // starting selection. A release below the drag threshold is a click.
      dismissBlockSelection(event);
    }
    return true;
  }

  function handlePointerCancel(event: PointerEvent) {
    if (marquee?.id === event.pointerId) cancelMarquee();
  }

  function onMarqueeClick(event: MouseEvent) {
    if (!suppressMarqueeClick) return;
    suppressMarqueeClick = false;
    event.preventDefault();
    event.stopPropagation();
  }

  function syncDoc() {
    const view = ctx.getView();
    if (marquee && !marquee.state.doc.eq(view.state.doc)) cancelMarquee();
  }

  function destroy() {
    marquee = null;
    marqueeBox.remove();
    if (marqueeClickTimer !== undefined) clearTimeout(marqueeClickTimer);
  }

  return {
    isActive: () => !!marquee,
    startMarquee,
    moveMarquee,
    cancelMarquee,
    dismissBlockSelection,
    handlePointerUp,
    handlePointerCancel,
    onMarqueeClick,
    syncDoc,
    destroy,
  };
}
