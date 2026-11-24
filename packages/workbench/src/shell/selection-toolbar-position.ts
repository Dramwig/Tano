export interface ToolbarRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Keep the capsule in its own pane and outside the selected text. */
export function selectionToolbarPosition(
  lines: readonly ToolbarRect[],
  bounds: ToolbarRect,
  width: number,
  height: number,
) {
  const visible = lines.filter(
    (rect) =>
      rect.bottom > bounds.top &&
      rect.top < bounds.bottom &&
      rect.right > bounds.left &&
      rect.left < bounds.right,
  );
  if (!visible.length || width > bounds.right - bounds.left || height > bounds.bottom - bounds.top)
    return null;
  const top = Math.min(...visible.map((rect) => rect.top));
  const bottom = Math.max(...visible.map((rect) => rect.bottom));
  const above = top - height - 8;
  const below = bottom + 8;
  const y = above >= bounds.top ? above : below + height <= bounds.bottom ? below : null;
  if (y === null) return null;
  const line = y === above ? visible[0]! : visible.at(-1)!;
  const x = Math.max(
    bounds.left,
    Math.min((line.left + line.right - width) / 2, bounds.right - width),
  );
  const spaceAbove = y - bounds.top - 6;
  const spaceBelow = bounds.bottom - y - height - 6;
  return {
    x,
    y,
    menuSide: spaceBelow >= Math.min(280, spaceAbove) ? 'below' : 'above',
    menuWidth: bounds.right - x,
  };
}
