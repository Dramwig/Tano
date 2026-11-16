export type DetachedDropPoint = {
  x: number; y: number; grabX: number; grabY: number;
  width?: number; insideSourceWindow?: boolean;
};
export function detachedWindowPosition(
  drop: DetachedDropPoint,
  scale: number,
  width: number,
  height: number,
  area?: { position: { x: number; y: number }; size: { width: number; height: number } },
) {
  const desiredX = drop.x / scale - drop.grabX;
  const desiredY = drop.y / scale - drop.grabY;
  if (!area) return { x: Math.round(desiredX), y: Math.round(desiredY) };
  const left = area.position.x / scale;
  const top = area.position.y / scale;
  // Keep a draggable part of the title bar visible while anchoring the window at the drop point.
  return {
    x: Math.round(Math.max(left, Math.min(desiredX, left + area.size.width / scale - Math.min(width, 520)))),
    y: Math.round(Math.max(top, Math.min(desiredY, top + area.size.height / scale - Math.min(height, 100)))),
  };
}


export const SETTINGS_WIDTH = 1080;
export const SETTINGS_HEIGHT = 780;

export function centeredSettingsPosition(
  parent: { position: { x: number; y: number }; size: { width: number; height: number } },
  settingsSize: { width: number; height: number },
  workArea?: { position: { x: number; y: number }; size: { width: number; height: number } },
) {
  // Native geometry and setPosition use physical pixels, including on mixed-DPI monitors.
  const x = parent.position.x + (parent.size.width - settingsSize.width) / 2;
  const y = parent.position.y + (parent.size.height - settingsSize.height) / 2;
  if (!workArea) return { x: Math.round(x), y: Math.round(y) };
  const left = workArea.position.x;
  const top = workArea.position.y;
  const right = left + workArea.size.width - settingsSize.width;
  const bottom = top + workArea.size.height - settingsSize.height;
  return {
    x: Math.round(Math.max(left, Math.min(x, Math.max(left, right)))),
    y: Math.round(Math.max(top, Math.min(y, Math.max(top, bottom)))),
  };
}
