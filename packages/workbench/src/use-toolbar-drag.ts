import { onBeforeUnmount, shallowRef } from 'vue';
import { toolbarDropTarget, toolbarPaneBounds } from './toolbar-docking';
import type { ToolbarMode } from './toolbar-preference';
import type { ToolbarRect } from './selection-toolbar-position';

interface ToolbarDrag {
  x: number;
  y: number;
  bounds: ToolbarRect;
  target: ToolbarMode | null;
}

export function useToolbarDrag(
  editorElement: () => HTMLElement | undefined,
  commit: (mode: ToolbarMode) => void,
  focusEditor: () => void,
) {
  const drag = shallowRef<ToolbarDrag | null>(null);
  let pending: {
    pointer: number;
    handle: HTMLElement;
    x: number;
    y: number;
    selection: Range | null;
  } | null = null;

  function restoreSelection() {
    const range = pending?.selection;
    const editor = editorElement()?.querySelector('.ProseMirror');
    if (range && editor?.contains(range.commonAncestorContainer)) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  }

  function cleanup() {
    const current = pending;
    pending = null;
    drag.value = null;
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', end, true);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', keydown, true);
    window.removeEventListener('blur', cancel);
    window.removeEventListener('resize', cancel);
    window.visualViewport?.removeEventListener('resize', cancel);
    current?.handle.removeEventListener('lostpointercapture', cancel);
    if (current?.handle.hasPointerCapture?.(current.pointer))
      current.handle.releasePointerCapture(current.pointer);
  }

  function cancel() {
    restoreSelection();
    cleanup();
  }

  function keydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    cancel();
    focusEditor();
  }

  function move(event: PointerEvent) {
    if (!pending || event.pointerId !== pending.pointer) return;
    if (!drag.value && Math.hypot(event.clientX - pending.x, event.clientY - pending.y) < 6) return;
    event.preventDefault();
    const bounds = toolbarPaneBounds(editorElement());
    if (!bounds) return cancel();
    const target = toolbarDropTarget(event.clientX, event.clientY, bounds);
    drag.value = {
      x: event.clientX,
      y: event.clientY,
      bounds,
      target,
    };
  }

  function end(event: PointerEvent) {
    if (!pending || event.pointerId !== pending.pointer) return;
    const wasDragging = !!drag.value;
    // A pointer can be released beyond the last move event, so hit-test the release too.
    if (wasDragging) move(event);
    const current = drag.value;
    restoreSelection();
    cleanup();
    if (current?.target) commit(current.target);
    else if (wasDragging) focusEditor();
  }

  function start(event: PointerEvent) {
    if (event.button !== 0 || pending) return;
    const handle = event.currentTarget as HTMLElement;
    const editor = editorElement()?.querySelector('.ProseMirror');
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    pending = {
      pointer: event.pointerId,
      handle,
      x: event.clientX,
      y: event.clientY,
      selection:
        range && editor?.contains(range.commonAncestorContainer) ? range.cloneRange() : null,
    };
    event.preventDefault();
    handle.setPointerCapture?.(event.pointerId);
    handle.addEventListener('lostpointercapture', cancel);
    window.addEventListener('pointermove', move, { capture: true, passive: false });
    window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', keydown, true);
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
    window.visualViewport?.addEventListener('resize', cancel);
  }

  onBeforeUnmount(cleanup);
  return { drag, start, cancel };
}
