/**
 * Liquid glass (液态玻璃): blur, refraction and the specular rim, drawn so that scrolling stays cheap.
 *
 * The obvious build — `backdrop-filter: blur() url(#displacement)` over every whole glass sheet — is
 * correct but slow: Chromium does not cache backdrop filters, so every frame in which anything over a sheet
 * changes (scrolling text, a caret) re-reads the backdrop and re-runs the whole chain (blur, three
 * displacement passes, colour matrices, composites) over the full sheet, at device resolution.
 *
 * So the work is split by what actually changes:
 *  - The blur. What lies behind every glass surface is the window background (the desk or the user's
 *    wallpaper), never the scrolling content. The blurred, brightened background is therefore rendered
 *    once into a bitmap (`BackdropSource`) and painted inside each surface by a plain layer — no filter
 *    runs per frame. A future animated background only needs a source that redraws per video frame.
 *  - The refraction. Only the rim bends light; the plateau inside is flat. Each surface gets four thin
 *    strips along its free edges, each with its own small displacement filter (`backdrop-filter: url()`),
 *    so the per-frame filter area is the rim, not the sheet. The strips bend the *unblurred* background and
 *    the blurred pane fades out across the rim above them: bending an already blurred image moves almost
 *    nothing visible (measured: a few dozen pixels changed by more than 20/255), while the sharp background
 *    shows the magnified, folded band that makes the edge read as a lens.
 *  - The specular rim: generated images over the pane.
 *
 * All of it lives in `.liquid-backdrop`, a layer at the bottom of `.app-shell` (App.vue) that the
 * controller fills per surface with `.liquid-lens` (strips), `.liquid-pane` (blur) and
 * `.liquid-shine-layer` (highlight), positioned under the surface. The surface elements
 * themselves keep only their translucent veil, outline and shadow (layout-themes.css), so they never become
 * containing blocks, stacking contexts or backdrop roots for their content.
 *
 * Only Chromium supports SVG filters in backdrop-filter (the Windows and Android shells use it; Safari and
 * Firefox do not). Elsewhere the joined card still shares its fill and outline.
 */

export const liquidGlassMaterialId = 'builtin:liquid';

/** Which edges of a surface are free glass edges. A page that joins the tab strip has no top bezel. */
export interface LiquidEdges { top: boolean; right: boolean; bottom: boolean; left: boolean }
export interface LiquidSurfaceShape {
  width: number; height: number; radius: number;
  /** Width of the curved rim in CSS px; the plateau inside it is flat and does not bend. */
  bezel: number;
  /** Height of the slab at the plateau in CSS px: taller glass bends more. Default 1.5 × bezel. */
  thickness?: number;
  /** Index of refraction (glass ≈ 1.5). */
  ior?: number;
  edges?: LiquidEdges;
}
export interface DisplacementMap {
  width: number; height: number; data: Uint8ClampedArray;
  /** feDisplacementMap `scale` that turns the map's full range back into CSS pixels (before `refraction.strength`). */
  scale: number;
}
/** A part of a surface, in CSS px from its top-left corner. */
export interface MapRegion { x: number; y: number; width: number; height: number }

const allEdges: LiquidEdges = { top: true, right: true, bottom: true, left: true };
/** Whole-surface maps (tests, tools) are capped; rim strips are always one map pixel per CSS pixel. */
const mapMaxSide = 2048;

/**
 * The optics, after Apple's material as modelled by LeonardSEO/liquid-glass-react and kube.io's
 * "Liquid Glass in the browser": the rim rises from the edge to the flat plateau along a convex squircle,
 * a straight-down view ray is refracted into it with Snell's law, and its sideways landing offset is the
 * displacement. The bend is strongest a few pixels in from the edge and fades to nothing at the plateau,
 * so the rim shows a magnified, slightly folded copy of what lies further inside — the look of a thick lens.
 */
const samples = 256;
const squircle = (t: number) => { t = Math.min(1, Math.max(0, t)); return Math.pow(1 - Math.pow(1 - t, 4), 0.25); };
export function refractionProfile(bezel: number, thickness: number, ior: number): Float32Array {
  const out = new Float32Array(samples);
  const eta = 1 / ior, h = 1e-3;
  for (let i = 0; i < samples; i++) {
    const t = (i + 0.5) / samples;
    const z = squircle(t) * thickness;
    const slope = (squircle(t + h) - squircle(t - h)) / (2 * h) * (thickness / bezel);
    const inv = 1 / Math.hypot(slope, 1);
    const nx = -slope * inv, nz = inv;
    const k = 1 - eta * eta * (1 - nz * nz);
    if (k < 0) { out[i] = 0; continue; }
    const f = eta * nz - Math.sqrt(k);
    out[i] = (f * nx) / -(-eta + f * nz) * z;
  }
  return out;
}

/** Distance inside a rounded rectangle (negative outside) and the outward normal, written into `out`. */
interface Field { depth: number; nx: number; ny: number }
/**
 * The rounded rectangle whose edges are the glass edges. Disabled edges are pushed out of the surface,
 * so they get no bezel, no highlight and their corners stay square.
 */
function outline(shape: LiquidSurfaceShape, bezel: number) {
  const edges = shape.edges ?? allEdges;
  const away = bezel * 3 + shape.radius;
  const x0 = edges.left ? 0 : -away, y0 = edges.top ? 0 : -away;
  const x1 = shape.width + (edges.right ? 0 : away), y1 = shape.height + (edges.bottom ? 0 : away);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hx = (x1 - x0) / 2, hy = (y1 - y0) / 2;
  const radius = Math.max(0, Math.min(shape.radius, hx, hy));
  return (px: number, py: number, out: Field) => {
    const x = px - cx, y = py - cy;
    const qx = Math.abs(x) - (hx - radius), qy = Math.abs(y) - (hy - radius);
    const sx = x < 0 ? -1 : 1, sy = y < 0 ? -1 : 1;
    if (qx > 0 && qy > 0) {
      const length = Math.hypot(qx, qy);
      out.depth = radius - length; out.nx = sx * qx / length; out.ny = sy * qy / length;
    } else if (qx > qy) { out.depth = radius - qx; out.nx = sx; out.ny = 0; }
    else { out.depth = radius - qy; out.nx = 0; out.ny = sy; }
  };
}

/** The largest inward shift of a rim, in CSS px, once strength and dispersion are applied. */
function maxShift(map: Pick<DisplacementMap, 'scale'>) { return map.scale / 2 * refraction.strength * (1 + refraction.dispersion); }

/**
 * The displacement map of a rounded rectangle, or of one `region` of it. Red is the horizontal shift and
 * green the vertical one, 128 meaning none. Inside the bezel the vector points inwards with the refracted
 * offset, so the rim samples the backdrop from further inside (magnification), never from outside.
 */
function profilePeak(profile: Float32Array) {
  let max = 0;
  for (const value of profile) max = Math.max(max, Math.abs(value));
  return max || 1;
}
/** The feDisplacementMap `scale` of a rim (see DisplacementMap.scale), without building a map. */
export function rimScale(bezel: number, thickness = bezel * 1.5, ior = 1.5) {
  return profilePeak(refractionProfile(Math.max(1, bezel), thickness, ior)) * 2;
}

export function displacementMap(shape: LiquidSurfaceShape, region?: MapRegion): DisplacementMap {
  const bezel = Math.max(1, Math.min(shape.bezel, shape.width / 2, shape.height / 2));
  const profile = refractionProfile(bezel, shape.thickness ?? bezel * 1.5, shape.ior ?? 1.5);
  const max = profilePeak(profile);
  const area = region ?? { x: 0, y: 0, width: shape.width, height: shape.height };
  const width = Math.max(1, Math.round(region ? area.width : Math.min(area.width, mapMaxSide)));
  const height = Math.max(1, Math.round(region ? area.height : Math.min(area.height, mapMaxSide)));
  const data = new Uint8ClampedArray(width * height * 4).fill(128);
  const sx = area.width / width, sy = area.height / height;
  const field = outline(shape, bezel), f: Field = { depth: 0, nx: 0, ny: 0 };
  // On a whole surface, pixels further than the bezel from every edge are neutral; skip them row by row.
  const skipX = region ? Infinity : Math.max(bezel, shape.radius) / sx, skipY = region ? Infinity : Math.max(bezel, shape.radius) / sy;
  for (let j = 0; j < height; j++) {
    const inner = j > skipY && j < height - skipY;
    for (let i = 0; i < width; i++) {
      if (inner && i > skipX && i < width - skipX) { i = Math.floor(width - skipX); continue; }
      field(area.x + (i + 0.5) * sx, area.y + (j + 0.5) * sy, f);
      if (f.depth < 0 || f.depth >= bezel) continue;
      const s = profile[Math.min(samples - 1, Math.floor(f.depth / bezel * samples))]! / max;
      const offset = (j * width + i) * 4;
      data[offset] = 128 - f.nx * s * 127;
      data[offset + 1] = 128 - f.ny * s * 127;
    }
  }
  for (let offset = 3; offset < data.length; offset += 4) data[offset] = 255;
  // feDisplacementMap: P'(x) = P(x + scale · (C − 0.5)), so a full-range value shifts by max.
  return { width, height, data, scale: max * 2 };
}

export interface SpecularOptions { light: number; strength: number }
/** How far in from the edge the highlight reaches, in CSS px. */
function specularReach(bezel: number) { return Math.max(1.2 * 6, Math.min(20, Math.max(4, bezel * 0.6)) * 3.5); }
/**
 * The specular rim (of the whole surface or one `region`) as a white alpha image: a crisp ~1px line at the
 * edge and a fainter one just inside it, plus a soft inner glow, brightest where the rim faces the light
 * (top-left) and again on the opposite side where the light leaves the glass, with an ambient floor.
 */
export function specularMap(shape: LiquidSurfaceShape, { light, strength }: SpecularOptions, dpr = 1, region?: MapRegion): DisplacementMap {
  const area = region ?? { x: 0, y: 0, width: shape.width, height: shape.height };
  const width = Math.max(1, Math.round(area.width * dpr)), height = Math.max(1, Math.round(area.height * dpr));
  const data = new Uint8ClampedArray(width * height * 4);
  const bezel = Math.max(1, shape.bezel), rim = 1.2, glow = Math.min(20, Math.max(4, bezel * 0.6));
  const cutoff = specularReach(bezel);
  const lx = Math.cos(light * Math.PI / 180), ly = Math.sin(light * Math.PI / 180);
  const field = outline(shape, bezel), f: Field = { depth: 0, nx: 0, ny: 0 };
  const skipX = region ? Infinity : Math.max(cutoff, shape.radius) * dpr, skipY = region ? Infinity : cutoff * dpr;
  for (let j = 0; j < height; j++) {
    const inner = j > skipY && j < height - skipY;
    for (let i = 0; i < width; i++) {
      if (inner && i > skipX && i < width - skipX) { i = Math.floor(width - skipX); continue; }
      field(area.x + (i + 0.5) / dpr, area.y + (j + 0.5) / dpr, f);
      if (f.depth < 0 || f.depth > cutoff) continue;
      const facing = f.nx * lx + f.ny * ly;
      const lit = Math.pow(Math.abs(facing), 1.6);
      const directional = facing < 0 ? lit : lit * 0.7;
      const line = Math.exp(-Math.pow(f.depth / rim, 2));
      const second = Math.exp(-Math.pow((f.depth - rim * 2.2) / rim, 2)) * 0.35;
      const halo = Math.exp(-f.depth / glow) * (0.06 + 0.3 * directional);
      const edge = Math.min(1, f.depth * dpr + 0.5);
      const alpha = ((line + second) * (0.3 + directional * 0.7) + halo) * edge * strength;
      const offset = (j * width + i) * 4;
      data[offset] = data[offset + 1] = data[offset + 2] = 255;
      data[offset + 3] = Math.min(255, alpha * 255);
    }
  }
  return { width, height, data, scale: 0 };
}

export type RimSide = 'top' | 'right' | 'bottom' | 'left';
/**
 * The strips that carry the rim: `thickness` deep along every free edge. Top and bottom span the whole
 * width (so they hold the corners); left and right fill in between. They never overlap.
 */
export function rimStrips(width: number, height: number, thickness: number, edges: LiquidEdges = allEdges): (MapRegion & { side: RimSide })[] {
  const t = Math.max(1, Math.min(Math.ceil(thickness), Math.floor(width / 2), Math.floor(height / 2)));
  const strips: (MapRegion & { side: RimSide })[] = [];
  if (edges.top) strips.push({ side: 'top', x: 0, y: 0, width, height: t });
  if (edges.bottom) strips.push({ side: 'bottom', x: 0, y: height - t, width, height: t });
  const y0 = edges.top ? t : 0, y1 = edges.bottom ? height - t : height;
  if (y1 > y0) {
    if (edges.left) strips.push({ side: 'left', x: 0, y: y0, width: t, height: y1 - y0 });
    if (edges.right) strips.push({ side: 'right', x: width - t, y: y0, width: t, height: y1 - y0 });
  }
  return strips;
}
/** Strip depth: the rim, plus room for the furthest inward sample, and the whole highlight. */
export function rimThickness(radius: number, bezel: number, shift: number) {
  return Math.max(Math.max(radius, bezel) + shift + 2, specularReach(bezel));
}

/**
 * The mask of the dense interior fill. Like Apple's tint it keeps a quarter of its strength at the edge and
 * eases to full across the bezel of every free edge, so the rim is clearer and brighter glass that shows the
 * bent backdrop while body text keeps its readable sheet.
 */
export function interiorMask(edges: LiquidEdges): string {
  const ease = (side: 'start' | 'end') => side === 'start'
    ? 'rgb(0 0 0 / .25) 0, rgb(0 0 0 / .62) calc(var(--liquid-rim) / 2), #000 var(--liquid-rim)'
    : '#000 calc(100% - var(--liquid-rim)), rgb(0 0 0 / .62) calc(100% - var(--liquid-rim) / 2), rgb(0 0 0 / .25) 100%';
  const fade = (from: boolean, to: boolean, direction: string) => `linear-gradient(${direction}, `
    + `${from ? ease('start') : '#000 0'}, ${to ? ease('end') : '#000 100%'})`;
  return `${fade(edges.left, edges.right, 'to right')}, ${fade(edges.top, edges.bottom, 'to bottom')}`;
}

/**
 * The mask of a refracting surface's blurred pane: clear at every free edge, full from one bezel in. Across
 * the rim the lens underneath shows — the background bent but not blurred — so the edge reads as a thick,
 * clear lens around a frosted interior, as on Apple's glass.
 */
export function paneMask(edges: LiquidEdges, bezel: number): string {
  const b = `${Math.round(bezel)}px`;
  const fade = (from: boolean, to: boolean, direction: string) => `linear-gradient(${direction}, `
    + `${from ? `transparent 0, rgb(0 0 0 / .5) calc(${b} * .55), #000 ${b}` : '#000 0'}, `
    + `${to ? `#000 calc(100% - ${b}), rgb(0 0 0 / .5) calc(100% - ${b} * .55), transparent 100%` : '#000 100%'})`;
  return `${fade(edges.left, edges.right, 'to right')}, ${fade(edges.top, edges.bottom, 'to bottom')}`;
}

/** Chromium only; Safari and Firefox accept nothing but the plain blur. */
export function supportsLiquidRefraction(win: Window & typeof globalThis = window): boolean {
  const agent = win.navigator?.userAgent ?? '';
  if (/Firefox\//.test(agent) || (/Safari\//.test(agent) && !/Chrom(e|ium)\//.test(agent))) return false;
  try { return !!win.CSS?.supports?.('backdrop-filter', 'url(#tano-liquid-probe)'); } catch { return false; }
}

/**
 * Apple's "clear" glass as calibrated by liquid-glass-react: a slab 1.5 bezels thick, its physical bend
 * strengthened by 1.3. The light comes from the top left. The bezel never exceeds the corner radius by much,
 * so the bent band follows the rounded corner instead of cutting across it.
 * Dispersion (red/blue bent a few per cent more/less than green) is supported but off: it triples the
 * per-frame filter work of the rim (three displacements, three colour matrices, two composites) — measured
 * at 60 fps with one pass against ~40 with three — for a fringe that is barely visible on a blurred background.
 */
export const refraction = { thickness: 1.5, ior: 1.5, strength: 1.3, dispersion: 0 as number, light: -135, minBezel: 20 } as const;
const channelSpread = [1, 0, -1] as const;
/** The rim width actually used for a surface: the CSS bezel, held near the corner radius and inside the surface. */
export function surfaceBezel(bezel: number, radius: number, width: number, height: number) {
  return Math.max(1, Math.min(bezel, Math.max(radius, refraction.minBezel), width / 2, height / 2));
}

// ---- The blurred background ----

/** What the glass shows through: the window background, blurred and toned like the lens would. */
export interface BackdropLook { blur: number; saturate: string; brightness: string }
/**
 * A source of the blurred background. `paint` puts it into a pane (positioned anywhere in the window);
 * the static wallpaper paints one pre-rendered bitmap. An animated background would implement the same
 * interface with a canvas per pane redrawn from a downscaled video frame (requestVideoFrameCallback):
 * the cost stays one small draw per frame instead of a full-window filter chain per glass surface.
 */
export interface BackdropSource {
  readonly key: string;
  paint(pane: HTMLElement, look: BackdropLook): void;
  dispose(): void;
}

/** Desk parameters read from <html>: the wallpaper and its veil (layout-themes.css --glass-desk). */
interface DeskStyle { url: string; veil: number; veilColor: string; viewport: [number, number] }

/**
 * The static wallpaper: per blur level, one bitmap of (veil over wallpaper), blurred, saturated and
 * brightened, at a fraction of the window's resolution (a blurred image has no detail to lose). Panes show
 * it with the same `center / cover fixed` placement as the desk, so it lines up with the desk exactly.
 */
class StaticWallpaperSource implements BackdropSource {
  readonly key: string;
  private image?: Promise<HTMLImageElement | undefined>;
  private readonly rendered = new Map<string, string | Promise<string | undefined>>();
  private disposed = false;
  constructor(private readonly doc: Document, private readonly desk: DeskStyle, private readonly changed: () => void) {
    this.key = JSON.stringify(desk);
  }
  paint(pane: HTMLElement, look: BackdropLook) {
    const id = `${look.blur}|${look.saturate}|${look.brightness}`;
    const current = this.rendered.get(id);
    if (typeof current === 'string') {
      const value = `url("${current}")`;
      if (pane.style.getPropertyValue('--liquid-backdrop') !== value) pane.style.setProperty('--liquid-backdrop', value);
      return;
    }
    if (!current) {
      const job = this.render(look).then(url => {
        if (this.disposed) { if (url) URL.revokeObjectURL(url); return undefined; }
        if (url) { this.rendered.set(id, url); this.changed(); } else this.rendered.delete(id);
        return url;
      });
      this.rendered.set(id, job);
    }
  }
  private load() {
    this.image ??= new Promise(resolve => {
      const image = new this.doc.defaultView!.Image();
      image.onload = () => resolve(image); image.onerror = () => resolve(undefined);
      image.src = this.desk.url;
    });
    return this.image;
  }
  private async render(look: BackdropLook): Promise<string | undefined> {
    const image = await this.load();
    if (!image || !image.naturalWidth) return undefined;
    const [viewWidth, viewHeight] = this.desk.viewport;
    // CSS px per image px under `cover`, so the blur matches the live one on screen.
    const cover = Math.max(viewWidth / image.naturalWidth, viewHeight / image.naturalHeight) || 1;
    const imageBlur = look.blur / cover;
    // Enough resolution for the remaining detail: a few bitmap px per blur radius.
    const scale = Math.min(0.5, 3 / Math.max(imageBlur, 1));
    const width = Math.max(1, Math.round(image.naturalWidth * scale)), height = Math.max(1, Math.round(image.naturalHeight * scale));
    const make = () => { const canvas = this.doc.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas; };
    const flat = make(), flatContext = flat.getContext('2d'), out = make(), context = out.getContext('2d');
    if (!flatContext || !context) return undefined;
    flatContext.imageSmoothingQuality = 'high';
    flatContext.drawImage(image, 0, 0, width, height);
    flatContext.globalAlpha = this.desk.veil; flatContext.fillStyle = this.desk.veilColor;
    flatContext.fillRect(0, 0, width, height);
    const tone = `saturate(${look.saturate}) brightness(${look.brightness})`;
    // Unblurred underneath, so the blur never darkens the frame edges with transparency.
    context.filter = tone; context.drawImage(flat, 0, 0);
    context.filter = `blur(${(imageBlur * scale).toFixed(2)}px) ${tone}`; context.drawImage(flat, 0, 0);
    const blob = await new Promise<Blob | null>(resolve => out.toBlob(resolve, 'image/webp', 0.9));
    return blob ? URL.createObjectURL(blob) : undefined;
  }
  dispose() {
    this.disposed = true;
    for (const url of this.rendered.values()) if (typeof url === 'string') URL.revokeObjectURL(url);
    this.rendered.clear();
  }
}

// ---- Surfaces ----

interface SurfaceKind {
  selector: string;
  when: (root: HTMLElement) => boolean;
  /** Whether the surface bends light at its rim (free-standing glass) or is only blurred (a page). */
  refract: boolean;
}
const kinds: SurfaceKind[] = [
  // Only sidebars with a visible surface (islands) reach track(). The compact drawer floats over the page,
  // not over the background, so it keeps its live blur.
  { selector: '.sidebar-surface', refract: true, when: root => !root.classList.contains('compact-layout') },
  { selector: '.workspace-card', refract: true, when: root => root.dataset.layout === 'islands' },
  { selector: '.document-main', refract: true, when: root => root.dataset.layout === 'document' },
  // The continuous page is the window's whole writing area, joined to the tab strip and the window edges:
  // blurred glass without a lens (a lens along its one free edge smeared the picture into a band).
  { selector: '.workspace-pane-surface', refract: false, when: root => root.dataset.layout === 'continuous' },
];
const svgNamespace = 'http://www.w3.org/2000/svg';

interface TabJoin { tab: HTMLElement; left: number; right: number; height: number }

function tabJoin(element: HTMLElement, page: DOMRect): TabJoin | undefined {
  const pane = element.closest<HTMLElement>('.workspace-native-tabs .workspace-pane');
  const layout = pane?.closest('.workspace-layout');
  if (!pane || !layout) return;
  const bar = [...layout.querySelectorAll<HTMLElement>('.workspace-tabbar')]
    .find(bar => bar.dataset.tabPaneId === pane.dataset.paneId);
  const tab = bar?.querySelector<HTMLElement>('.desktop-tab-active:not(.desktop-tab-dragging, .desktop-tab-outgoing)');
  if (!tab) return;
  const rect = tab.getBoundingClientRect();
  const list = tab.parentElement!.getBoundingClientRect();
  const left = Math.round(Math.max(0, list.left - page.left, rect.left - page.left));
  const right = Math.round(Math.min(page.width, list.right - page.left, rect.right - page.left));
  const height = Math.round(page.top - rect.top);
  if (right - left < 8 || height < 4 || Math.abs(page.top - rect.bottom) > 1) return;
  return { tab, left, right, height };
}

/** The card's rounded top edge rises around the active tab, with no stroke through the join. */
function joinedCardPath(width: number, height: number, radius: number, tab: TabJoin) {
  const { left, right, height: top } = tab;
  const corner = Math.min(radius, width / 2, height / 2, left, width - right);
  const cap = Math.min(8, (right - left) / 2, top / 2);
  const a = Math.min(cap, left - corner), b = Math.min(cap, width - corner - right);
  const bottom = top + height;
  return `M 0 ${top + corner} Q 0 ${top} ${corner} ${top}
    H ${left - a} Q ${left} ${top} ${left} ${top - a}
    V ${cap} Q ${left} 0 ${left + cap} 0
    H ${right - cap} Q ${right} 0 ${right} ${cap}
    V ${top - b} Q ${right} ${top} ${right + b} ${top}
    H ${width - corner} Q ${width} ${top} ${width} ${top + corner}
    V ${bottom - radius} Q ${width} ${bottom} ${width - radius} ${bottom}
    H ${radius} Q 0 ${bottom} 0 ${bottom - radius} Z`.replace(/\s+/g, ' ');
}

interface Strip { side: RimSide; element: HTMLDivElement; highlight?: HTMLDivElement; filter: SVGFilterElement; image: SVGFEImageElement }
interface Surface {
  id: number; refract: boolean; strips: Strip[];
  /** Under the pane: the rim strips, bending the unblurred background (refracting surfaces only). */
  lens?: HTMLDivElement;
  /** The blurred background, faded out across the free rims so the bent background shows there. */
  pane: HTMLDivElement;
  /** Over the pane: the specular highlight of the rim (refracting surfaces only). */
  shine?: HTMLDivElement;
  join?: { tab: HTMLElement; veil: HTMLDivElement; outline: SVGSVGElement; path: SVGPathElement };
  /** Computed-style reads, refreshed when the root changes (theme, layout) or the element is new. */
  look?: { radius: number; corners: string; bezel: number; strength: number; blur: number };
  shapeKey: string; placeKey: string; sourceKey?: string; mask: string; bezel: number; width: number; height: number;
}

export class LiquidGlassController {
  private surfaces = new Map<HTMLElement, Surface>();
  private nextId = 1;
  private svg?: SVGSVGElement;
  private style?: HTMLStyleElement;
  private frame = 0;
  private active = false;
  /** Set when <html> changed: computed styles (theme, radii, wallpaper) must be read again. */
  private stylesDirty = true;
  private source?: BackdropSource;
  private look: Omit<BackdropLook, 'blur'> = { saturate: '180%', brightness: '1.08' };
  private readonly rootObserver: MutationObserver;
  private readonly treeObserver: MutationObserver;
  private readonly resizeObserver?: ResizeObserver;
  private readonly canvas?: HTMLCanvasElement;
  private readonly onResize = () => { this.stylesDirty = true; this.schedule(); };
  private readonly onScroll = (event: Event) => {
    if ((event.target as HTMLElement).classList?.contains('desktop-tab-list')) this.schedule();
  };

  constructor(private readonly doc: Document = document, private readonly supported = supportsLiquidRefraction(doc.defaultView as Window & typeof globalThis)) {
    this.rootObserver = new MutationObserver(() => { this.stylesDirty = true; this.schedule(); });
    this.treeObserver = new MutationObserver(() => this.schedule());
    const view = doc.defaultView as (Window & typeof globalThis) | null;
    if (view?.ResizeObserver) this.resizeObserver = new view.ResizeObserver(() => this.schedule());
    if (supported) this.canvas = doc.createElement('canvas');
  }

  start() {
    this.rootObserver.observe(this.doc.documentElement, { attributes: true,
      attributeFilter: ['data-material', 'data-layout', 'data-theme', 'data-glass-wallpaper', 'class', 'style'] });
    this.doc.defaultView?.addEventListener('resize', this.onResize);
    this.doc.addEventListener('scroll', this.onScroll, true);
    this.schedule();
  }

  private schedule() {
    if (this.frame) return;
    const view = this.doc.defaultView;
    this.frame = view?.requestAnimationFrame ? view.requestAnimationFrame(() => { this.frame = 0; this.update(); }) : 0;
    if (!this.frame) this.update();
  }

  private wanted() {
    const root = this.doc.documentElement;
    if (root.dataset.material !== liquidGlassMaterialId) return false;
    if (!this.host()) return false;
    return !(this.doc.defaultView?.matchMedia?.('(prefers-reduced-transparency: reduce)').matches ?? false);
  }

  /** The layer under the workbench that holds the panes (App.vue). */
  private host() { return this.doc.querySelector<HTMLElement>('.app-shell > .liquid-backdrop'); }

  /**
   * Runs at most once per frame, after DOM changes. It only reads geometry (which the frame lays out anyway)
   * and touches the DOM when a surface actually moved or changed; computed styles are read only after the
   * root changed, and maps are regenerated only when a surface's size or shape changed.
   */
  private update() {
    const wanted = this.wanted();
    if (wanted !== this.active) {
      this.active = wanted;
      if (wanted) { this.treeObserver.observe(this.doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] }); this.stylesDirty = true; }
      else { this.treeObserver.disconnect(); this.clear(); return; }
    }
    if (!wanted) return;
    const root = this.doc.documentElement, host = this.host()!;
    const restyle = this.stylesDirty;
    this.stylesDirty = false;
    if (restyle && this.supported) this.refreshSource(root);
    const origin = host.getBoundingClientRect();
    const seen = new Map<HTMLElement, { kind: SurfaceKind; rect: DOMRect; join?: TabJoin }>();
    for (const kind of kinds) {
      if (!kind.when(root)) continue;
      for (const element of this.doc.querySelectorAll<HTMLElement>(kind.selector)) {
        if (seen.has(element)) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width < 8 || rect.height < 8) continue;
        const join = kind.selector === '.workspace-card' ? tabJoin(element, rect) : undefined;
        if (!this.supported && !join) continue;
        seen.set(element, { kind, rect, join });
      }
    }
    let changed = false;
    for (const element of [...this.surfaces.keys()]) if (!seen.has(element)) { this.untrack(element); changed = true; }
    for (const [element, { kind, rect, join }] of seen) this.track(element, kind, rect, origin, restyle, host, join);
    root.toggleAttribute('data-liquid-refraction', this.supported && this.surfaces.size > 0);
    if (changed || restyle || this.styleOutdated) this.writeStyles();
  }

  private styleOutdated = false;

  private refreshSource(root: HTMLElement) {
    const styles = getComputedStyle(root);
    this.look = { saturate: styles.getPropertyValue('--liquid-saturate').trim() || '180%', brightness: styles.getPropertyValue('--liquid-brightness').trim() || '1.08' };
    const url = root.hasAttribute('data-glass-wallpaper') ? /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(styles.getPropertyValue('--glass-wallpaper'))?.[1] : undefined;
    const view = this.doc.defaultView;
    // Bucketed, so resizing the window does not re-render the bitmap on every step.
    const bucket = (value: number) => Math.round(value / 160) * 160;
    const desk: DeskStyle | undefined = url ? {
      url, veil: (parseFloat(styles.getPropertyValue('--glass-wallpaper-veil')) || 30) / 100,
      veilColor: styles.getPropertyValue('--sidebar').trim() || '#e5e7eb',
      viewport: [bucket(view?.innerWidth ?? 1440), bucket(view?.innerHeight ?? 900)],
    } : undefined;
    const key = desk ? JSON.stringify(desk) : '';
    if ((this.source?.key ?? '') === key) return;
    this.source?.dispose();
    this.source = desk ? new StaticWallpaperSource(this.doc, desk, () => { this.stylesDirty = true; this.schedule(); }) : undefined;
  }

  private track(element: HTMLElement, kind: SurfaceKind, rect: DOMRect, origin: DOMRect, restyle: boolean, host: HTMLElement, join?: TabJoin) {
    let surface = this.surfaces.get(element);
    if (!surface) {
      const refract = this.supported && kind.refract;
      let lens: HTMLDivElement | undefined;
      if (refract) { lens = this.doc.createElement('div'); lens.className = 'liquid-lens'; host.append(lens); }
      const pane = this.doc.createElement('div');
      pane.className = 'liquid-pane';
      host.append(pane);
      let shine: HTMLDivElement | undefined;
      if (refract) { shine = this.doc.createElement('div'); shine.className = 'liquid-shine-layer'; host.append(shine); }
      surface = { id: this.nextId++, refract, lens, pane, shine, strips: [], shapeKey: '', placeKey: '', mask: '', bezel: 0, width: 0, height: 0 };
      this.surfaces.set(element, surface);
      if (this.supported) element.setAttribute(refract ? 'data-liquid-glass' : 'data-liquid-pane', String(surface.id));
      this.resizeObserver?.observe(element);
      restyle = true;
    }
    if (restyle || !surface.look) {
      const styles = getComputedStyle(element);
      const shine = parseFloat(styles.getPropertyValue('--liquid-specular-strength'));
      surface.look = {
        radius: parseFloat(styles.borderTopLeftRadius) || 0,
        corners: styles.borderRadius,
        bezel: parseFloat(styles.getPropertyValue('--liquid-bezel')) || 24,
        strength: Number.isFinite(shine) ? shine : 0.85,
        blur: parseFloat(styles.getPropertyValue('--liquid-pane-blur')) || 0,
      };
      for (const layer of [surface.lens, surface.shine]) if (layer) layer.style.borderRadius = surface.look.corners;
      surface.pane.style.borderRadius = join ? '0px' : surface.look.corners;
      // A new background (another wallpaper, or none) drops the old bitmap; the same one is kept until redrawn.
      const sourceKey = this.source?.key ?? '';
      if (surface.sourceKey !== sourceKey) { surface.sourceKey = sourceKey; surface.pane.style.removeProperty('--liquid-backdrop'); }
      this.source?.paint(surface.pane, { blur: surface.look.blur, ...this.look });
    }
    const w = Math.round(rect.width), h = Math.round(rect.height);
    const left = Math.round(rect.left - origin.left), top = Math.round(rect.top - origin.top);
    const placeKey = [left, top, w, h, surface.look.radius, join?.left, join?.right, join?.height].join('|');
    this.updateJoin(element, surface, join?.tab);
    if (placeKey !== surface.placeKey) {
      surface.placeKey = placeKey;
      for (const layer of [surface.lens, surface.pane, surface.shine]) if (layer) Object.assign(layer.style, { left: `${left}px`, top: `${top}px`, width: `${w}px`, height: `${h}px` });
      surface.pane.style.borderRadius = join ? '0px' : surface.look.corners;
      surface.pane.style.clipPath = '';
      if (join && surface.join) {
        const { veil, outline, path } = surface.join;
        const contour = joinedCardPath(w, h, Math.min(surface.look.radius, w / 2, h / 2), join);
        for (const layer of [surface.pane, veil, outline]) {
          Object.assign(layer.style, { left: `${left}px`, top: `${top - join.height}px`, width: `${w}px`, height: `${h + join.height}px` });
        }
        surface.pane.style.clipPath = veil.style.clipPath = `path("${contour}")`;
        path.setAttribute('d', contour);
      }
    }
    // Follow strip reflow while the selected tab moves. Scrolling the document never enters this loop.
    if (join?.tab.closest('.desktop-tab-list-animating, .desktop-tab-list-slotting') &&
      join.tab.parentElement?.getAnimations?.({ subtree: true }).some(animation => animation.playState === 'running')) this.schedule();
    if (!surface.refract) return;
    const { radius, strength } = surface.look;
    const bezel = surfaceBezel(surface.look.bezel, radius, w, h);
    const edges = join ? { ...allEdges, top: false } : allEdges;
    const shapeKey = [w, h, radius, bezel, strength, edges.top, edges.right, edges.bottom, edges.left].join('|');
    if (shapeKey === surface.shapeKey) return;
    surface.shapeKey = shapeKey;
    surface.bezel = bezel; surface.width = w; surface.height = h;
    surface.mask = interiorMask(edges);
    if (surface.join) {
      surface.join.veil.style.setProperty('--liquid-rim', `${bezel}px`);
      surface.join.veil.style.maskImage = surface.mask;
    }
    this.styleOutdated = true;
    this.buildRim(surface, { width: w, height: h, radius, bezel, thickness: bezel * refraction.thickness, ior: refraction.ior, edges }, strength);
  }

  private updateJoin(element: HTMLElement, surface: Surface, tab?: HTMLElement) {
    if (surface.join?.tab === tab) return;
    if (!tab) { this.clearJoin(element, surface); return; }
    this.resizeObserver?.observe(tab);
    tab.setAttribute('data-liquid-joined-tab', '');
    if (surface.join) {
      this.resizeObserver?.unobserve(surface.join.tab);
      surface.join.tab.removeAttribute('data-liquid-joined-tab');
      surface.join.tab = tab;
      return;
    }
    const veil = this.doc.createElement('div');
    veil.className = 'liquid-joined-veil';
    const outline = this.doc.createElementNS(svgNamespace, 'svg');
    outline.classList.add('liquid-joined-outline');
    const path = this.doc.createElementNS(svgNamespace, 'path');
    outline.append(path);
    surface.pane.after(veil);
    (surface.shine ?? veil).after(outline);
    surface.join = { tab, veil, outline, path };
    element.setAttribute('data-liquid-joined-card', '');
  }

  private clearJoin(element: HTMLElement, surface: Surface) {
    if (!surface.join) return;
    const { tab, veil, outline } = surface.join;
    this.resizeObserver?.unobserve(tab);
    tab.removeAttribute('data-liquid-joined-tab');
    veil.remove();
    outline.remove();
    element.removeAttribute('data-liquid-joined-card');
    surface.join = undefined;
  }

  /** (Re)builds the rim strips of a surface: a displacement filter and a highlight image per strip. */
  private buildRim(surface: Surface, shape: LiquidSurfaceShape, strength: number) {
    for (const strip of surface.strips) { strip.element.remove(); strip.highlight?.remove(); strip.filter.remove(); }
    surface.strips = [];
    const mask = paneMask(shape.edges ?? allEdges, shape.bezel);
    surface.pane.style.setProperty('mask-image', mask); surface.pane.style.setProperty('-webkit-mask-image', mask);
    surface.pane.style.setProperty('mask-composite', 'intersect'); surface.pane.style.setProperty('-webkit-mask-composite', 'source-in');
    const scale = rimScale(shape.bezel, shape.thickness, shape.ior);
    const thickness = rimThickness(shape.radius, shape.bezel, maxShift({ scale }));
    const ratio = Math.min(2, this.doc.defaultView?.devicePixelRatio || 1);
    for (const region of rimStrips(shape.width, shape.height, thickness, shape.edges)) {
      const id = `tano-liquid-${surface.id}-${region.side}`;
      const map = displacementMap(shape, region);
      const { filter, image } = this.createFilter(id, region.width, region.height, map.scale * refraction.strength);
      image.setAttribute('href', this.encode(map));
      const element = this.doc.createElement('div');
      element.className = 'liquid-rim';
      Object.assign(element.style, { left: `${region.x}px`, top: `${region.y}px`, width: `${region.width}px`, height: `${region.height}px` });
      element.style.setProperty('backdrop-filter', `url(#${id})`);
      surface.lens!.append(element);
      // The highlight sits over the pane, so the frosted interior never dims it.
      let highlight: HTMLDivElement | undefined;
      if (strength > 0) {
        highlight = this.doc.createElement('div');
        highlight.className = 'liquid-shine';
        Object.assign(highlight.style, { left: `${region.x}px`, top: `${region.y}px`, width: `${region.width}px`, height: `${region.height}px` });
        highlight.style.backgroundImage = `url("${this.encode(specularMap(shape, { light: refraction.light, strength }, ratio, region))}")`;
        surface.shine!.append(highlight);
      }
      surface.strips.push({ side: region.side, element, highlight, filter, image });
    }
  }

  private untrack(element: HTMLElement) {
    const surface = this.surfaces.get(element);
    if (!surface) return;
    this.clearJoin(element, surface);
    for (const strip of surface.strips) strip.filter.remove();
    surface.pane.remove(); surface.lens?.remove(); surface.shine?.remove();
    this.resizeObserver?.unobserve(element);
    element.removeAttribute('data-liquid-glass'); element.removeAttribute('data-liquid-pane');
    this.surfaces.delete(element);
  }

  private clear() {
    for (const element of [...this.surfaces.keys()]) this.untrack(element);
    this.doc.documentElement.removeAttribute('data-liquid-refraction');
    this.source?.dispose(); this.source = undefined;
    this.svg?.remove(); this.svg = undefined;
    this.style?.remove(); this.style = undefined;
  }

  private container() {
    if (!this.svg) {
      this.svg = this.doc.createElementNS(svgNamespace, 'svg');
      this.svg.setAttribute('aria-hidden', 'true');
      this.svg.setAttribute('width', '0'); this.svg.setAttribute('height', '0');
      this.svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
      this.svg.append(this.doc.createElementNS(svgNamespace, 'defs'));
      this.doc.body.append(this.svg);
    }
    return this.svg.firstElementChild!;
  }

  /**
   * feImage → three displaced copies, one per channel, added back together. The filter and the map are laid
   * 1:1 on the strip in CSS pixels (userSpaceOnUse): percentages would resolve against the hidden 0×0 SVG.
   */
  private createFilter(id: string, width: number, height: number, scale: number) {
    const make = <K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string>) => {
      const element = this.doc.createElementNS(svgNamespace, tag);
      for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
      return element;
    };
    const size = { x: '0', y: '0', width: String(width), height: String(height) };
    const filter = make('filter', { id, ...size, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' });
    const image = make('feImage', { ...size, preserveAspectRatio: 'none', result: 'map' });
    filter.append(image);
    if (!refraction.dispersion) {
      filter.append(make('feDisplacementMap', { in: 'SourceGraphic', in2: 'map', scale: scale.toFixed(2), xChannelSelector: 'R', yChannelSelector: 'G' }));
      this.container().append(filter);
      return { filter, image };
    }
    const channels = ['1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0', '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0', '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0'];
    channels.forEach((matrix, index) => {
      filter.append(make('feDisplacementMap', { in: 'SourceGraphic', in2: 'map', scale: (scale * (1 + channelSpread[index]! * refraction.dispersion)).toFixed(2),
        xChannelSelector: 'R', yChannelSelector: 'G', result: `shift${index}` }));
      filter.append(make('feColorMatrix', { in: `shift${index}`, type: 'matrix', values: matrix, result: `channel${index}` }));
    });
    filter.append(make('feComposite', { in: 'channel0', in2: 'channel1', operator: 'arithmetic', k2: '1', k3: '1', result: 'rg' }));
    filter.append(make('feComposite', { in: 'rg', in2: 'channel2', operator: 'arithmetic', k2: '1', k3: '1' }));
    this.container().append(filter);
    return { filter, image };
  }

  private encode(map: DisplacementMap) {
    const canvas = this.canvas!;
    canvas.width = map.width; canvas.height = map.height;
    const context = canvas.getContext('2d');
    if (!context) return '';
    const image = context.createImageData(map.width, map.height);
    image.data.set(map.data);
    context.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png');
  }

  /** The interior veil of a refracting surface is a pseudo-element; it gets its size and edge fade from here. */
  private writeStyles() {
    this.styleOutdated = false;
    if (!this.style) {
      this.style = this.doc.createElement('style');
      this.style.dataset.liquidGlassStyles = '';
      this.doc.head.append(this.style);
    }
    let css = '';
    for (const surface of this.surfaces.values()) {
      if (!surface.refract) continue;
      css += `[data-liquid-glass="${surface.id}"]{--liquid-w:${surface.width}px;--liquid-h:${surface.height}px;`
        + `--liquid-rim:${surface.bezel}px;--liquid-mask:${surface.mask}}\n`;
    }
    if (this.style.textContent !== css) this.style.textContent = css;
  }

  dispose() {
    const view = this.doc.defaultView;
    if (this.frame) view?.cancelAnimationFrame?.(this.frame);
    this.frame = 0;
    view?.removeEventListener('resize', this.onResize);
    this.doc.removeEventListener('scroll', this.onScroll, true);
    this.rootObserver.disconnect(); this.treeObserver.disconnect(); this.resizeObserver?.disconnect();
    this.active = false;
    this.clear();
  }
}
