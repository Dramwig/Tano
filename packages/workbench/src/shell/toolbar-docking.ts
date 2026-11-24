import type { ToolbarRect } from './selection-toolbar-position';
import type { ToolbarMode } from './toolbar-preference';

export function toolbarPaneBounds(element?: HTMLElement): ToolbarRect | null {
  const pane = element?.closest<HTMLElement>('.document-layout') ?? element;
  if (!pane) return null;
  const rect = pane.getBoundingClientRect();
  const viewport = window.visualViewport;
  const left = Math.max(rect.left, viewport?.offsetLeft ?? 0) + 8;
  const top = Math.max(rect.top, viewport?.offsetTop ?? 0) + 8;
  // clientWidth excludes the document scrollbar. Tests without layout fall back to the rect.
  const right =
    Math.min(
      rect.left + (pane.clientWidth || rect.width),
      (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth),
    ) - 8;
  const bottom =
    Math.min(rect.bottom, (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight)) -
    8;
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}

export function toolbarDropTarget(x: number, y: number, bounds: ToolbarRect): ToolbarMode | null {
  // Include the small inset at the edge, but never dock in another pane or the sidebar.
  if (x < bounds.left - 8 || x > bounds.right + 8 || y < bounds.top - 8 || y > bounds.bottom + 8)
    return null;
  const horizontalEdge = Math.min(36, (bounds.bottom - bounds.top) * 0.2);
  if (y <= bounds.top + horizontalEdge) return 'fixed';
  if (y >= bounds.bottom - horizontalEdge) return 'bottom';
  const edge = Math.min(48, (bounds.right - bounds.left) * 0.2);
  if (x <= bounds.left + edge) return 'left';
  if (x >= bounds.right - edge) return 'right';
  return 'selection';
}

export function dockedToolbarPosition(
  bounds: ToolbarRect,
  side: 'left' | 'right' | 'bottom',
  width: number,
  height: number,
) {
  const travel = Math.max(0, bounds.bottom - bounds.top - height);
  const y = bounds.top + (side === 'bottom' ? travel : travel / 2);
  const x =
    side === 'bottom'
      ? bounds.left + Math.max(0, bounds.right - bounds.left - width) / 2
      : side === 'left'
        ? bounds.left
        : Math.max(bounds.left, bounds.right - width);
  return {
    x,
    y,
    menuTop: 0,
    menuHeight: bounds.bottom - bounds.top,
    menuWidth: Math.max(
      0,
      side === 'bottom' ? bounds.right - x : bounds.right - bounds.left - width - 8,
    ),
  };
}

export function dockedToolbarMenuPosition(
  bounds: ToolbarRect,
  toolbarTop: number,
  triggerTop: number,
  menuHeight: number,
) {
  const maxHeight = Math.max(0, bounds.bottom - bounds.top);
  const height = Math.min(Math.max(0, menuHeight), maxHeight);
  const y = Math.max(bounds.top, Math.min(triggerTop, bounds.bottom - height));
  return { top: y - toolbarTop, maxHeight };
}
