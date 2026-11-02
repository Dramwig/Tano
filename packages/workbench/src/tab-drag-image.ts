// A prepainted bitmap is independent of WebView's DOM drag-snapshot timing.
export function tabDragImage(tab: HTMLElement, label: string) {
  const rect = tab.getBoundingClientRect();
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(28, Math.round(rect.width));
  canvas.height = Math.max(28, Math.round(rect.height));
  const context = canvas.getContext('2d');
  if (!context) return;
  const style = getComputedStyle(tab);
  const button = tab.querySelector<HTMLElement>('.desktop-tab-switch');
  const textStyle = getComputedStyle(button ?? tab);
  context.fillStyle = style.getPropertyValue('--paper').trim() || '#fff';
  context.beginPath();
  context.roundRect(0, 0, canvas.width, canvas.height, [8, 8, 0, 0]);
  context.fill();
  const left = button ? parseFloat(textStyle.paddingLeft) || 6 : 6;
  const iconY = (canvas.height - 15) / 2 - 2;
  const ink = style.getPropertyValue('--text').trim() || '#333';
  context.fillStyle = ink;
  context.font = `400 13px ${textStyle.fontFamily}`;
  context.textBaseline = 'middle';
  context.save();
  context.beginPath();
  context.rect(left + 23, 0, Math.max(0, canvas.width - left - 29), canvas.height);
  context.clip();
  context.fillText(label, left + 23, canvas.height / 2 - 2);
  context.restore();
  // Seed a file glyph so even an immediate drag has a complete bitmap. Replace
  // it with the actual tab icon once its SVG finishes decoding after pointerdown.
  context.strokeStyle = style.getPropertyValue('--muted').trim() || '#777';
  context.lineWidth = 1;
  context.strokeRect(left + 3, iconY + 2, 9, 12);
  const svg = tab.querySelector('.desktop-tab-icon svg, svg.desktop-tab-icon');
  if (svg) {
    const copy = svg.cloneNode(true) as SVGElement;
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    copy.style.color = getComputedStyle(svg).color;
    const image = new Image();
    image.onload = () => {
      context.fillStyle = style.getPropertyValue('--paper').trim() || '#fff';
      context.fillRect(left, iconY, 15, 15);
      context.drawImage(image, left, iconY, 15, 15);
    };
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`;
  }
  return canvas;
}
