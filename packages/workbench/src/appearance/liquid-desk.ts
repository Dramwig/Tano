/** Paint the stationary desk as an ordinary SVG image filter. Chromium can reuse
 * this paint when the editor above it scrolls. A backdrop-filter would resample
 * the whole compositor backdrop, even when its pixels have not changed. */
export function svgNode<K extends keyof SVGElementTagNameMap>(doc: Document, tag: K,
  attributes: Record<string, string | number> = {}) {
  const node = doc.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

export interface GlassDesk { href: string; wallpaper: boolean; width: number; height: number }

export function readGlassDesk(host: HTMLElement, bounds: DOMRect): GlassDesk | undefined {
  const doc = host.ownerDocument;
  const wallpaper = doc.documentElement.style.getPropertyValue('--glass-wallpaper').match(/^url\("([^"]+)"\)$/)?.[1];
  if (wallpaper) {
    const view = doc.defaultView!;
    return { href: wallpaper, wallpaper: true, width: view.innerWidth, height: view.innerHeight };
  }
  const { width, height } = bounds;
  if (!width || !height) return;
  const style = getComputedStyle(host.parentElement!);
  // Serialize resolved CSS gradients, including plugin palette colours. External
  // resources cannot be loaded from an SVG used as an image; keep those live.
  if (style.backgroundImage.includes('url(')) return;
  const svg = svgNode(doc, 'svg', { width, height });
  const field = svgNode(doc, 'foreignObject', { width, height });
  const paint = doc.createElement('div');
  paint.style.cssText = 'width:100%;height:100%';
  paint.style.backgroundColor = style.backgroundColor;
  paint.style.backgroundImage = style.backgroundImage;
  field.append(paint);
  svg.append(field);
  return { href: 'data:image/svg+xml,' + encodeURIComponent(new XMLSerializer().serializeToString(svg)),
    wallpaper: false, width, height };
}

// The largest channel displacement is 180 * (1 - 0.5) CSS pixels. Include
// a little extra for interpolation and the final blur.
export const glassSamplePadding = 96;

export function paintGlassDesk(lens: HTMLElement, id: number, desk: GlassDesk,
  left: number, top: number, width: number, height: number) {
  const doc = lens.ownerDocument;
  const w = Math.max(1, Math.min(width, desk.width - left));
  const h = Math.max(1, Math.min(height, desk.height - top));
  const svg = svgNode(doc, 'svg', { width: '100%', height: '100%' });
  const defs = svgNode(doc, 'defs');
  const cropId = `tano-liquid-crop-${id}`, patternId = `tano-liquid-repeat-${id}`;
  const crop = svgNode(doc, 'svg', { id: cropId, width: w, height: h, viewBox: `${left} ${top} ${w} ${h}` });
  const size = { width: desk.width, height: desk.height };
  if (desk.wallpaper) crop.append(svgNode(doc, 'rect', { ...size, fill: 'var(--sidebar)' }));
  crop.append(svgNode(doc, 'image', { ...size, href: desk.href, preserveAspectRatio: 'xMidYMid slice' }));
  if (desk.wallpaper) crop.append(svgNode(doc, 'rect', { ...size, fill: 'var(--sidebar)', opacity: 'var(--glass-wallpaper-veil)' }));
  // Repeat a mirrored crop so all three channels sample real pixels beyond
  // the rim, as Chromium does at the bounds of a live backdrop.
  const pattern = svgNode(doc, 'pattern', { id: patternId, width: 2 * w, height: 2 * h, patternUnits: 'userSpaceOnUse' });
  for (const x of [0, 1]) for (const y of [0, 1]) {
    pattern.append(svgNode(doc, 'use', { href: `#${cropId}`,
      transform: `translate(${2 * w * x} ${2 * h * y}) scale(${x ? -1 : 1} ${y ? -1 : 1})` }));
  }
  defs.append(crop, pattern);
  const pad = glassSamplePadding;
  svg.append(defs, svgNode(doc, 'rect', { x: -pad, y: -pad, width: width + 2 * pad, height: height + 2 * pad,
    fill: `url(#${patternId})`, filter: `url(#tano-liquid-${id})` }));
  lens.replaceChildren(svg);
}
