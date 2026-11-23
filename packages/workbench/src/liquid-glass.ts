export const liquidGlassMaterialId = 'builtin:liquid';

/** Edges along which the rectangular tint fades. */
export interface LiquidEdges { top: boolean; right: boolean; bottom: boolean; left: boolean }

/** Glass Surface's two directional gradients and soft mid-grey interior, in CSS pixels. */
export function glassMap(width: number, height: number, radius: number, contour?: string) {
  const inset = Math.min(width, height) * 0.035;
  const rect = (fill: string) => `<rect width="${width}" height="${height}" rx="${radius}" ${fill}/>`;
  // Inset the entire tab-and-page silhouette. There is no path segment across the
  // foot of the tab, so the bevel follows the exposed top edge and turns around the tab.
  const coreMask = contour ? `<mask id="core" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}">
    <path d="${contour}" fill="white" stroke="black" stroke-width="${2 * inset}" stroke-linejoin="round"/>
  </mask>` : '';
  const core = contour
    ? `<rect width="100%" height="100%" mask="url(#core)"/>`
    : `<rect x="${inset}" y="${inset}" width="${width - 2 * inset}" height="${height - 2 * inset}" rx="${radius}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      ${coreMask}
      <linearGradient id="x"><stop stop-color="red"/><stop offset="1" stop-color="red" stop-opacity="0"/></linearGradient>
      <linearGradient id="y" x2="0" y2="1"><stop stop-color="blue" stop-opacity="0"/><stop offset="1" stop-color="blue"/></linearGradient>
      <filter id="soft" filterUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}">
        <feGaussianBlur stdDeviation="11"/>
      </filter>
    </defs>
    <rect width="100%" height="100%"/>
    ${rect('fill="url(#x)"')}
    ${rect('fill="url(#y)" style="mix-blend-mode:difference"')}
    <g fill="#808080" opacity=".93" filter="url(#soft)">${core}</g>
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
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

/** Chromium supports local SVG filters on the live backdrop. */
export function supportsLiquidRefraction(win: Window & typeof globalThis = window): boolean {
  const agent = win.navigator?.userAgent ?? '';
  if (/Firefox\//.test(agent) || (/Safari\//.test(agent) && !/Chrom(e|ium)\//.test(agent))) return false;
  try { return !!win.CSS?.supports?.('backdrop-filter', 'url(#tano-liquid-probe)'); } catch { return false; }
}

// ---- Surfaces ----

interface SurfaceKind {
  selector: string;
  when: (root: HTMLElement) => boolean;
}
const kinds: SurfaceKind[] = [
  { selector: '.sidebar-surface', when: root => root.dataset.layout === 'islands' },
  { selector: '.workspace-card', when: root => root.dataset.layout === 'islands' },
  // Paper hides the pane backing when the document supplies its own sheet. The bounds
  // check below also skips hidden panes, so a settings tab and an editor get one lens each.
  { selector: '.workspace-pane-surface, .main-column.workspace-card:not(:has(.workspace-pane))', when: root => root.dataset.layout !== 'islands' },
  { selector: '.document-main', when: root => root.dataset.layout === 'document' },
  { selector: '.settings-backdrop:not(.settings-tabbed) .settings-main', when: () => true },
  { selector: '.selection-toolbar .selection-format-toolbar', when: () => true },
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
function joinedCardPath(width: number, height: number, radius: number, tab: TabJoin, paneBacking: boolean) {
  const { left, right, height: top } = tab;
  const leftCorner = Math.min(radius, width / 2, height / 2, left);
  // The pane backing is rounded only where it meets the sidebar and title bar.
  const rightCorner = paneBacking ? 0 : Math.min(radius, width / 2, height / 2, width - right);
  const bottomCorner = paneBacking ? 0 : radius;
  const cap = Math.min(8, (right - left) / 2, top / 2);
  const a = Math.min(cap, left - leftCorner), b = Math.min(cap, width - rightCorner - right);
  const bottom = top + height;
  return `M 0 ${top + leftCorner} Q 0 ${top} ${leftCorner} ${top}
    H ${left - a} Q ${left} ${top} ${left} ${top - a}
    V ${cap} Q ${left} 0 ${left + cap} 0
    H ${right - cap} Q ${right} 0 ${right} ${cap}
    V ${top - b} Q ${right} ${top} ${right + b} ${top}
    H ${width - rightCorner} Q ${width} ${top} ${width} ${top + rightCorner}
    V ${bottom - bottomCorner} Q ${width} ${bottom} ${width - bottomCorner} ${bottom}
    H ${bottomCorner} Q 0 ${bottom} 0 ${bottom - bottomCorner} Z`.replace(/\s+/g, ' ');
}

interface Surface {
  id: number; refract: boolean;
  filter?: SVGFilterElement;
  lens?: HTMLDivElement;
  join?: { tab: HTMLElement; veil: HTMLDivElement; outline: SVGSVGElement; path: SVGPathElement };
  /** Computed-style reads, refreshed when the root changes (theme, layout) or the element is new. */
  look?: { radius: number; corners: string; bezel: number };
  shapeKey: string; placeKey: string; mask: string; bezel: number; width: number; height: number;
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
  private readonly rootObserver: MutationObserver;
  private readonly treeObserver: MutationObserver;
  private readonly resizeObserver?: ResizeObserver;
  private readonly reducedTransparency?: MediaQueryList;
  private readonly onResize = () => { this.stylesDirty = true; this.schedule(); };
  private readonly onScroll = (event: Event) => {
    if ((event.target as HTMLElement).classList?.contains('desktop-tab-list')) this.schedule();
  };

  constructor(private readonly doc: Document = document, private readonly supported = supportsLiquidRefraction(doc.defaultView as Window & typeof globalThis)) {
    this.rootObserver = new MutationObserver(() => { this.stylesDirty = true; this.schedule(); });
    this.treeObserver = new MutationObserver(() => this.schedule());
    const view = doc.defaultView as (Window & typeof globalThis) | null;
    this.reducedTransparency = view?.matchMedia?.('(prefers-reduced-transparency: reduce)');
    if (view?.ResizeObserver) this.resizeObserver = new view.ResizeObserver(() => this.schedule());
  }

  start() {
    this.reducedTransparency?.addEventListener?.('change', this.onResize);
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
    return !this.reducedTransparency?.matches;
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
    const origin = host.getBoundingClientRect();
    const seen = new Map<HTMLElement, { rect: DOMRect; join?: TabJoin }>();
    for (const kind of kinds) {
      if (!kind.when(root)) continue;
      for (const element of this.doc.querySelectorAll<HTMLElement>(kind.selector)) {
        if (seen.has(element)) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width < 8 || rect.height < 8) continue;
        const join = element.matches('.workspace-card, .workspace-pane-surface') ? tabJoin(element, rect) : undefined;
        if (!this.supported && !join) continue;
        seen.set(element, { rect, join });
      }
    }
    let changed = false;
    for (const element of [...this.surfaces.keys()]) if (!seen.has(element)) { this.untrack(element); changed = true; }
    for (const [element, { rect, join }] of seen) this.track(element, rect, origin, restyle, host, join);
    root.toggleAttribute('data-liquid-refraction', this.supported && this.surfaces.size > 0);
    if (changed || restyle || this.styleOutdated) this.writeStyles();
  }

  private styleOutdated = false;

  private track(element: HTMLElement, rect: DOMRect, origin: DOMRect, restyle: boolean, host: HTMLElement, join?: TabJoin) {
    // Scrolling paper, settings dialogs and the sliding drawer must sample their own
    // backdrop and follow their container's clipping and movement.
    const capsule = element.classList.contains('selection-format-toolbar');
    const local = capsule || element.matches('.document-main, .settings-main, .compact-layout .sidebar-surface');
    let surface = this.surfaces.get(element);
    if (surface?.refract && local !== element.hasAttribute('data-liquid-local')) {
      this.untrack(element);
      surface = undefined;
    }
    if (!surface) {
      const refract = this.supported;
      let lens: HTMLDivElement | undefined;
      if (refract && !local) { lens = this.doc.createElement('div'); lens.className = 'liquid-lens'; host.append(lens); }
      surface = { id: this.nextId++, refract, lens, shapeKey: '', placeKey: '', mask: '', bezel: 0, width: 0, height: 0 };
      this.surfaces.set(element, surface);
      if (this.supported) {
        element.setAttribute('data-liquid-glass', String(surface.id));
        element.toggleAttribute('data-liquid-local', local);
      }
      this.resizeObserver?.observe(element);
      restyle = true;
    }
    if (restyle || !surface.look) {
      const styles = getComputedStyle(element);
      surface.look = {
        radius: parseFloat(styles.borderTopLeftRadius) || 0,
        corners: styles.borderRadius,
        bezel: parseFloat(styles.getPropertyValue('--liquid-bezel')) || 12,
      };
      if (surface.lens) surface.lens.style.borderRadius = surface.look.corners;
    }
    const w = local ? element.offsetWidth : Math.round(rect.width);
    const h = local ? element.offsetHeight : Math.round(rect.height);
    if (local) {
      const key = [w, h, surface.look.radius].join('|');
      if (key !== surface.shapeKey) {
        surface.shapeKey = key;
        this.applyFilter(surface, element, w, h, Math.min(surface.look.radius, w, h));
      }
      return;
    }
    const left = Math.round(rect.left - origin.left), top = Math.round(rect.top - origin.top);
    const view = this.doc.defaultView!;
    const continuousPage = this.doc.documentElement.dataset.layout === 'continuous'
      && element.matches('.workspace-pane-surface, .main-column.workspace-card');
    const edges = {
      top: !join, left: true,
      right: !continuousPage || rect.right < view.innerWidth - 1,
      bottom: !continuousPage || rect.bottom < view.innerHeight - 1,
    };
    // The host clips at the window. Move the optical rim, inset shadow and tab outline
    // beyond that clip together, leaving the real pane and its hit area at their layout size.
    const overhang = Math.ceil(Math.min(w, h) * 0.04 + surface.look.radius + 48);
    const lensWidth = w + (edges.right ? 0 : overhang);
    const lensHeight = h + (edges.bottom ? 0 : overhang);
    const tabHeight = join?.height ?? 0;
    const opticalHeight = lensHeight + tabHeight;
    const contour = join ? joinedCardPath(lensWidth, lensHeight, Math.min(surface.look.radius, w / 2, h / 2), join, element.classList.contains('workspace-pane-surface')) : undefined;
    const placeKey = [left, top, lensWidth, lensHeight, surface.look.radius, join?.left, join?.right, join?.height].join('|');
    this.updateJoin(element, surface, host, join?.tab);
    if (placeKey !== surface.placeKey) {
      surface.placeKey = placeKey;
      const bounds = { left: `${left}px`, top: `${top - tabHeight}px`, width: `${lensWidth}px`, height: `${opticalHeight}px` };
      const clipPath = contour ? `path("${contour}")` : '';
      if (surface.lens) Object.assign(surface.lens.style, bounds, { clipPath });
      if (contour && surface.join) {
        const { veil, outline, path } = surface.join;
        for (const layer of [veil, outline]) Object.assign(layer.style, bounds);
        veil.style.clipPath = clipPath;
        path.setAttribute('d', contour);
      }
    }
    // Follow strip reflow while the selected tab moves. Scrolling the document never enters this loop.
    if (join?.tab.closest('.desktop-tab-list-animating, .desktop-tab-list-slotting') &&
      join.tab.parentElement?.getAnimations?.({ subtree: true }).some(animation => animation.playState === 'running')) this.schedule();
    if (!surface.refract) return;
    const { radius } = surface.look;
    const bezel = Math.min(surface.look.bezel, w / 2, h / 2);
    const shapeKey = [w, h, lensWidth, opticalHeight, radius, bezel, contour].join('|');
    if (shapeKey === surface.shapeKey) return;
    surface.shapeKey = shapeKey;
    surface.bezel = bezel; surface.width = w; surface.height = h;
    surface.mask = interiorMask(edges);
    if (surface.join) {
      surface.join.veil.style.setProperty('--liquid-rim', `${bezel}px`);
      surface.join.veil.style.maskImage = surface.mask;
    }
    this.styleOutdated = true;
    surface.lens!.toggleAttribute('data-joined', !!join);
    this.applyFilter(surface, surface.lens!, lensWidth, opticalHeight, radius, contour,
      edges.right && edges.bottom ? undefined : {
        right: edges.right ? lensWidth + bezel : w - bezel,
        bottom: edges.bottom ? opticalHeight + bezel : h + tabHeight - bezel,
        bezel,
      });
  }

  private updateJoin(element: HTMLElement, surface: Surface, host: HTMLElement, tab?: HTMLElement) {
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
    host.append(veil, outline);
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

  private untrack(element: HTMLElement) {
    const surface = this.surfaces.get(element);
    if (!surface) return;
    this.clearJoin(element, surface);
    surface.filter?.remove();
    element.style.removeProperty('--liquid-filter');
    surface.lens?.remove();
    this.resizeObserver?.unobserve(element);
    element.removeAttribute('data-liquid-glass');
    element.removeAttribute('data-liquid-local');
    this.surfaces.delete(element);
  }

  private clear() {
    for (const element of [...this.surfaces.keys()]) this.untrack(element);
    this.doc.documentElement.removeAttribute('data-liquid-refraction');
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

  private applyFilter(surface: Surface, target: HTMLElement, width: number, height: number, radius: number, contour?: string,
    seam?: { right: number; bottom: number; bezel: number }) {
    const map = glassMap(width, height, radius, contour);
    const seamKey = seam ? [seam.right, seam.bottom, seam.bezel].join('|') : '';
    if (surface.filter?.getAttribute('width') === String(width) && surface.filter.getAttribute('height') === String(height)
      && surface.filter.dataset.seam === seamKey) {
      surface.filter.querySelector('feImage')!.setAttribute('href', map);
      return;
    }
    surface.filter?.remove();
    const id = `tano-liquid-${surface.id}`;
    const make = <K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string>) => {
      const element = this.doc.createElementNS(svgNamespace, tag);
      for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
      return element;
    };
    const size = { x: '0', y: '0', width: String(width), height: String(height) };
    const filter = make('filter', { id, ...size, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' });
    filter.dataset.seam = seamKey;
    const image = make('feImage', { ...size, preserveAspectRatio: 'none', result: 'map' });
    filter.append(image);
    image.setAttribute('href', map);
    const scales = [-180, -170, -160];
    const channels = ['1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0', '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0', '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0'];
    channels.forEach((matrix, index) => {
      filter.append(make('feDisplacementMap', { in: 'SourceGraphic', in2: 'map', scale: String(scales[index]),
        xChannelSelector: 'R', yChannelSelector: 'G', result: `shift${index}` }));
      filter.append(make('feColorMatrix', { in: `shift${index}`, type: 'matrix', values: matrix, result: `channel${index}` }));
    });
    filter.append(make('feBlend', { in: 'channel0', in2: 'channel1', mode: 'screen', result: 'rg' }));
    filter.append(make('feBlend', { in: 'rg', in2: 'channel2', mode: 'screen', result: 'rgb' }));
    filter.append(make('feGaussianBlur', { in: 'rgb', stdDeviation: '0.5', result: 'refracted' }));
    if (seam) {
      // Blend the refracted image back into the original backdrop before it reaches
      // a window seam. The extended frame and the page tint are separate from this blend.
      const pad = seam.bezel;
      filter.append(make('feFlood', { x: String(-pad), y: String(-pad),
        width: String(seam.right + pad), height: String(seam.bottom + pad), 'flood-color': 'white' }));
      filter.append(make('feGaussianBlur', { ...size, stdDeviation: String(pad / 6), result: 'lensMask' }));
      filter.append(make('feComposite', { in: 'refracted', in2: 'lensMask', operator: 'in' }));
      filter.append(make('feComposite', { in2: 'SourceGraphic', operator: 'over' }));
    }
    this.container().append(filter);
    surface.filter = filter;
    target.style.setProperty('--liquid-filter', `url(#${id})`);
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
      if (!surface.lens) continue;
      css += `[data-liquid-glass="${surface.id}"]{--liquid-w:${surface.width}px;--liquid-h:${surface.height}px;`
        + `--liquid-rim:${surface.bezel}px;--liquid-mask:${surface.mask}}\n`;
    }
    if (this.style.textContent !== css) this.style.textContent = css;
  }

  dispose() {
    this.reducedTransparency?.removeEventListener?.('change', this.onResize);
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
