import { ownerWindow } from '@tano/editor/dom-realm';
import { EASE_EXIT, MOTION_DURATION, canAnimate } from '@tano/editor/motion';
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

/** Starts the page-drawn card that follows the pointer and returns a transparent
 * native drag image (plus hot spot) to hand to `setDragImage`.
 *
 * The OS drag image is translucent, cannot be animated and vanishes the instant the
 * button is released, so any replacement shown at release visibly pops. Drawing the
 * card in the page for the whole drag lets the release fade start from the very same
 * pixels. Trade-off: the card is clipped at the app window edge. */
export function fileDragImage(row: HTMLElement, label: string, pointer: { x: number; y: number }) {
  const win = ownerWindow(row);
  const doc = row.ownerDocument;
  const scale = win.devicePixelRatio || 1;
  const svg = iconSvg(row);
  const key = svg ? iconKey(svg) : lastKey;
  const measure = doc.createElement('canvas').getContext('2d');
  if (measure) measure.font = `400 13px ${win.getComputedStyle(row).fontFamily}`;
  const textWidth = measure?.measureText(label).width ?? label.length * 13;
  // 16px padding + 15px icon + 9px gap + text + 16px padding
  const width = Math.min(280, Math.max(120, Math.ceil(16 + 15 + 9 + textWidth + 16)));
  const canvas = tabDragImage(row, label, scale, {
    width, height: CARD_HEIGHT, iconImage: key ? icons.get(key) : undefined, noIcon: true,
  });
  if (!canvas) return;
  const rect = row.getBoundingClientRect();
  const { x: insetX, y: insetY } = TAB_DRAG_IMAGE_INSET;
  // Keep the cursor near the card's left edge, vertically centred on the row grab point.
  const grabX = Math.min(Math.max(pointer.x - rect.left, 12), width - 12);
  const hot = { x: insetX + grabX, y: insetY + CARD_HEIGHT / 2 };
  startCard(doc, canvas, scale, hot, pointer);
  // Fully transparent native image: the page card is the only visible one.
  const blank = doc.createElement('canvas');
  blank.width = blank.height = 1;
  blank.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;pointer-events:none;';
  blank.setAttribute('aria-hidden', 'true');
  doc.body.append(blank);
  win.setTimeout(() => blank.remove(), 0);
  return { canvas: blank, x: 0, y: 0 };
}

let card: { element: HTMLCanvasElement; detach: () => void } | undefined;

function startCard(doc: Document, source: HTMLCanvasElement, scale: number,
  hot: { x: number; y: number }, pointer: { x: number; y: number }) {
  if (card) { card.detach(); card.element.remove(); card = undefined; }
  // A canvas copy paints synchronously (an <img> from a data URL would decode late).
  const element = doc.createElement('canvas');
  element.width = source.width;
  element.height = source.height;
  element.getContext('2d')?.drawImage(source, 0, 0);
  element.setAttribute('aria-hidden', 'true');
  element.style.cssText = `position:fixed;left:0;top:0;width:${source.width / scale}px;height:${source.height / scale}px;` +
    'pointer-events:none;z-index:2147483000;transform-origin:30% 50%;will-change:translate;';
  const place = (x: number, y: number) => { element.style.translate = `${x - hot.x}px ${y - hot.y}px`; };
  place(pointer.x, pointer.y);
  doc.body.append(element);
  const win = ownerWindow(doc.body);
  // `drag` fires on the source for the whole gesture; (0, 0) marks the final or
  // out-of-window event in some engines and must not yank the card to the corner.
  const move = (event: DragEvent) => {
    if (event.clientX || event.clientY) place(event.clientX, event.clientY);
  };
  const end = () => settleFileDragCard();
  win.addEventListener('drag', move as EventListener, true);
  win.addEventListener('dragover', move as EventListener, true);
  win.addEventListener('dragend', end, true);
  card = {
    element,
    detach: () => {
      win.removeEventListener('drag', move as EventListener, true);
      win.removeEventListener('dragover', move as EventListener, true);
      win.removeEventListener('dragend', end, true);
    },
  };
}

/** Fade the card out where the pointer was released. Safe to call repeatedly: only the first call acts. */
export function settleFileDragCard() {
  const current = card;
  if (!current) return;
  card = undefined;
  const { element, detach } = current;
  detach(); // stop following the pointer, keep the element for the fade
  const removeCard = () => element.remove();
  if (!canAnimate(element)) {
    removeCard();
    return;
  }
  // Fade in place; the tree's own motion moves the row into its slot.
  const animation = element.animate([
    { scale: '1', opacity: 1 },
    { scale: '0.96', opacity: 0 },
  ], { duration: MOTION_DURATION.exit + 40, easing: EASE_EXIT, fill: 'forwards' });
  animation.onfinish = removeCard;
  animation.oncancel = removeCard;
}
