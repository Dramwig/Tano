import { ownerWindow } from '@tano/editor/dom-realm';
import { TAB_DRAG_IMAGE_INSET, tabDragImage } from './tab-drag-image';

// Dragging a file row out of the tree uses the same card as dragging a tab:
// rounded, hairline ring, soft shadow, icon + label sized to the text. The icon
// SVG decodes asynchronously, so it is warmed on pointerdown and dragstart can
// paint the finished bitmap synchronously.
const CARD_HEIGHT = 34;
const icons = new Map<string, HTMLImageElement>();
let lastKey: string | undefined;

function iconSvg(row: HTMLElement) {
  return row.querySelector<SVGElement>('.tree-icon svg:not(.tree-chevron)');
}

function iconKey(svg: SVGElement) {
  const copy = svg.cloneNode(true) as SVGElement;
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.style.color = ownerWindow(svg).getComputedStyle(svg).color;
  return new XMLSerializer().serializeToString(copy);
}

/** Decode the row's icon ahead of dragstart. Safe to call on every pointerdown. */
export function warmFileDragIcon(row: HTMLElement) {
  const svg = iconSvg(row);
  if (!svg) { lastKey = undefined; return; }
  const key = lastKey = iconKey(svg);
  if (icons.has(key)) return;
  if (icons.size > 64) icons.clear();
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(key)}`;
  icons.set(key, image);
}

/** Card bitmap plus the hot spot (CSS px) that keeps it under the pointer. */
export function fileDragImage(row: HTMLElement, label: string, pointer: { x: number; y: number }) {
  const win = ownerWindow(row);
  const scale = win.devicePixelRatio || 1;
  const svg = iconSvg(row);
  const key = svg ? iconKey(svg) : lastKey;
  const measure = row.ownerDocument.createElement('canvas').getContext('2d');
  if (measure) measure.font = `400 13px ${win.getComputedStyle(row).fontFamily}`;
  const textWidth = measure?.measureText(label).width ?? label.length * 13;
  // 16px padding + 15px icon + 9px gap + text + 16px padding
  const width = Math.min(280, Math.max(120, Math.ceil(16 + 15 + 9 + textWidth + 16)));
  const canvas = tabDragImage(row, label, scale, {
    width, height: CARD_HEIGHT, iconImage: key ? icons.get(key) : undefined, noIcon: true,
  });
  if (!canvas) return;
  canvas.style.cssText = `position:fixed;left:-10000px;top:-10000px;width:${canvas.width / scale}px;height:${canvas.height / scale}px;pointer-events:none;`;
  canvas.setAttribute('aria-hidden', 'true');
  row.ownerDocument.body.append(canvas);
  win.setTimeout(() => canvas.remove(), 0);
  const rect = row.getBoundingClientRect();
  const { x: insetX, y: insetY } = TAB_DRAG_IMAGE_INSET;
  // Keep the cursor near the card's left edge, vertically centred on the row grab point.
  const grabX = Math.min(Math.max(pointer.x - rect.left, 12), width - 12);
  return { canvas, x: insetX + grabX, y: insetY + CARD_HEIGHT / 2 };
}
