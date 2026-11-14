// A prepainted bitmap is independent of WebView's DOM drag-snapshot timing.
// It is shown by the native overlay outside the window, so it must look like
// the in-window `.desktop-tab-drag-preview` card: fully rounded, hairline
// ring and soft shadow. The shadow needs transparent room around the card.
export const TAB_DRAG_IMAGE_INSET = { x: 24, y: 18 } as const;
const SHADOW_BOTTOM = 32;

/** Painted at device pixels (`scale`), so the native overlay stays as crisp as the DOM. */
export function tabDragImage(tab: HTMLElement, label: string, scale = window.devicePixelRatio || 1) {
  const rect = tab.getBoundingClientRect();
  const width = Math.max(28, Math.round(rect.width));
  const height = Math.max(28, Math.round(rect.height));
  const { x: insetX, y: insetY } = TAB_DRAG_IMAGE_INSET;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round((width + insetX * 2) * scale);
  canvas.height = Math.round((height + insetY + SHADOW_BOTTOM) * scale);
  const context = canvas.getContext('2d');
  if (!context) return;
  context.scale(scale, scale);
  const style = getComputedStyle(tab);
  const color = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const paper = color('--paper', '#fff');
  const card = () => { context.beginPath(); context.roundRect(insetX, insetY, width, height, 8); };

  // box-shadow: 0 8px 22px rgb(0 0 0 / 12%), 0 2px 6px rgb(0 0 0 / 6%)
  for (const [offset, blur, alpha] of [[8, 22, 0.12], [2, 6, 0.06]] as const) {
    context.save();
    context.shadowColor = `rgb(0 0 0 / ${alpha})`;
    // Shadow geometry ignores the context transform: give it device pixels.
    context.shadowBlur = blur * scale;
    context.shadowOffsetY = offset * scale;
    context.fillStyle = paper;
    card();
    context.fill();
    context.restore();
  }
  // box-shadow: 0 0 0 1px var(--line)
  context.save();
  context.strokeStyle = color('--line', '#ddd');
  context.lineWidth = 1;
  context.beginPath();
  context.roundRect(insetX - 0.5, insetY - 0.5, width + 1, height + 1, 8.5);
  context.stroke();
  context.restore();
  context.fillStyle = paper;
  card();
  context.fill();

  // Same content layout as the preview: 16px padding, 15px icon, 9px gap.
  const left = insetX + 16;
  const middle = insetY + height / 2;
  const iconY = middle - 7.5;
  const textLeft = left + 15 + 9;
  const button = tab.querySelector<HTMLElement>('.desktop-tab-switch');
  context.fillStyle = color('--text', '#333');
  context.font = `400 13px ${getComputedStyle(button ?? tab).fontFamily}`;
  context.textBaseline = 'middle';
  context.save();
  context.beginPath();
  context.rect(textLeft, insetY, Math.max(0, insetX + width - 16 - textLeft), height);
  context.clip();
  context.fillText(label, textLeft, middle);
  context.restore();
  // Seed a file glyph so even an immediate drag has a complete bitmap. Replace
  // it with the actual tab icon once its SVG finishes decoding after pointerdown.
  context.strokeStyle = color('--muted', '#777');
  context.lineWidth = 1;
  context.strokeRect(left + 3, iconY + 2, 9, 12);
  const svg = tab.querySelector('.desktop-tab-icon svg, svg.desktop-tab-icon');
  if (svg) {
    const copy = svg.cloneNode(true) as SVGElement;
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    copy.style.color = getComputedStyle(svg).color;
    const image = new Image();
    image.onload = () => {
      context.fillStyle = paper;
      context.fillRect(left, iconY, 15, 15);
      context.drawImage(image, left, iconY, 15, 15);
    };
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`;
  }
  return canvas;
}
