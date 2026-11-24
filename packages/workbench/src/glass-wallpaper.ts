import { shallowRef } from 'vue';
import { themeChangedEvent, type ResolvedTheme } from './theme';
import type { WallpaperRender } from './glass-wallpaper-render';

/**
 * Background image behind the frosted-glass layout. A device-level preference (like the display mode):
 * the image itself lives in IndexedDB, only the display preferences live in localStorage. The result is
 * published as CSS variables on <html>, which auxiliary windows already mirror.
 */
export type Rgb = [number, number, number];
export interface WallpaperPreference {
  /** 'none' keeps the painted light field; builtin:* are generated; 'custom' is the stored image. */
  source: string;
  /** 0–100: how much the image is blurred and veiled before the glass sits on it. */
  softness: number;
  /** Explicit desk veil percentages, saved independently for light and dark mode. */
  veilOpacity?: Partial<Record<ResolvedTheme['mode'], number>>;
  /** Changes whenever the stored custom image changes, so other windows reload it. */
  customRevision?: number;
}
export interface GlassWallpaperState extends WallpaperPreference {
  url?: string;
  customThumbnail?: string;
  busy: boolean;
  error?: string;
  thumbnails: Record<string, string>;
}
export interface WallpaperImageStore {
  get(key: string): Promise<Blob | undefined>;
  put(key: string, blob: Blob): Promise<void>;
  delete(key: string): Promise<void>;
}
type WallpaperSource = CanvasImageSource & { width: number; height: number };
export interface WallpaperRenderer {
  normalizeImport(file: Blob): Promise<Blob>;
  decode(blob: Blob): Promise<WallpaperSource>;
  builtin(id: string, mode: ResolvedTheme['mode']): WallpaperSource | Promise<WallpaperSource>;
  thumbnail(id: string, mode: ResolvedTheme['mode']): string;
  customThumbnail(source: WallpaperSource): string;
  render(source: WallpaperSource, softness: number): Promise<WallpaperRender>;
}

export const builtinWallpapers = [
  { id: 'builtin:dawn', label: '晨雾' },
  { id: 'builtin:dusk', label: '暮光' },
  { id: 'builtin:clouds', label: '云层' },
] as const;
export const debugStripeWallpaper = { id: 'debug:stripes', label: '调试条纹' } as const;
export const defaultWallpaper: WallpaperPreference = { source: 'none', softness: 50 };
/** Picked files above this size are refused before decoding. */
export const maxWallpaperBytes = 30 * 1024 * 1024;

export function parseWallpaperPreference(value: unknown): WallpaperPreference {
  if (!value || typeof value !== 'object') return { ...defaultWallpaper };
  const record = value as Record<string, unknown>;
  const source = typeof record.source === 'string' && (record.source === 'none' || record.source === 'custom' ||
    builtinWallpapers.some(item => item.id === record.source)) ? record.source : 'none';
  const softness = typeof record.softness === 'number' && Number.isFinite(record.softness) ? Math.round(Math.min(100, Math.max(0, record.softness))) : defaultWallpaper.softness;
  const revision = typeof record.customRevision === 'number' && Number.isFinite(record.customRevision) ? { customRevision: record.customRevision } : {};
  const veilOpacity: WallpaperPreference['veilOpacity'] = {};
  if (record.veilOpacity && typeof record.veilOpacity === 'object') {
    for (const mode of ['light', 'dark'] as const) {
      const value = (record.veilOpacity as Record<string, unknown>)[mode];
      if (typeof value === 'number' && Number.isFinite(value)) veilOpacity[mode] = Math.round(Math.min(100, Math.max(0, value)));
    }
  }
  return { source, softness, ...(Object.keys(veilOpacity).length ? { veilOpacity } : {}), ...revision };
}

// ---- Colour maths (sRGB, matching CSS color-mix(in srgb, …)) ----
export function parseColor(value: string): Rgb | undefined {
  const text = value.trim();
  const hex = /^#([\da-f]{3,8})$/i.exec(text)?.[1];
  if (hex && [3, 4, 6, 8].includes(hex.length)) {
    const full = hex.length <= 4 ? [...hex.slice(0, 3)].map(c => c + c).join('') : hex.slice(0, 6);
    return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16)) as Rgb;
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : undefined;
}
export function mix(a: Rgb, b: Rgb, amountOfA: number): Rgb {
  return [0, 1, 2].map(i => a[i]! * amountOfA + b[i]! * (1 - amountOfA)) as Rgb;
}
export function luminance([r, g, b]: Rgb): number {
  const channel = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
export function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}
export function toHex(color: Rgb): string {
  return `#${color.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Smallest paper opacity (≥ the design minimum) at which `text` keeps `target` contrast against the
 * card over every sampled point of the background. This keeps the glass as clear as the image allows.
 */
export function solveGlassStrength(backgrounds: readonly Rgb[], paper: Rgb, text: Rgb, target: number, minimum: number, maximum = 0.98): number {
  const readable = (alpha: number) => backgrounds.every(background => contrast(text, mix(paper, background, alpha)) >= target);
  if (!backgrounds.length || readable(minimum)) return minimum;
  if (!readable(maximum)) return maximum;
  let low = minimum, high = maximum;
  for (let step = 0; step < 16; step++) {
    const middle = (low + high) / 2;
    if (readable(middle)) high = middle; else low = middle;
  }
  return Math.ceil(high * 100) / 100;
}

/** Veil of the desk colour over the image: light mode washes it out, dark mode sinks it. */
export function wallpaperVeil(softness: number, mode: 'light' | 'dark', material: 'frost' | 'liquid' = 'frost'): number {
  const s = Math.min(100, Math.max(0, softness)) / 100;
  // Frost paints a second, 90%-opaque desk behind the panes in dark mode. Clear glass
  // transmits the desk directly, so shade the wallpaper itself, including exposed tab strips.
  if (mode === 'dark' && material === 'liquid') return 0.84 + s * 0.14;
  return mode === 'dark' ? 0.3 + s * 0.3 : 0.08 + s * 0.32;
}

/**
 * Clearer than the painted-field defaults in layout-themes.css (50/74, 58/84): with an image the contrast
 * is measured, so the sheets start more transparent and are only raised where the image requires it.
 */
export const wallpaperMinimums = {
  islands: { light: { fill: 0.42, page: 0.58 }, dark: { fill: 0.5, page: 0.72 } },
  /** The continuous page is one large writing surface, so it starts a touch denser. */
  continuous: { light: { fill: 0.42, page: 0.62 }, dark: { fill: 0.5, page: 0.76 } },
  document: { light: { fill: 0.42, page: 0.6 }, dark: { fill: 0.5, page: 0.74 } },
} as const;
export type WallpaperStructure = keyof typeof wallpaperMinimums;

/** Minimum tint on a clear sheet; sampled wallpaper can require more for text contrast. */
export const liquidWallpaper = {
  /** Secondary text on liquid glass leans this far towards body text (layout-themes.css: --liquid-ink, must match). */
  ink: 0.55,
  minimums: { light: { panel: 0.06, page: 0.1 }, dark: { panel: 0.09, page: 0.14 } },
} as const;
/** Layout of the coarse samples (row-major), see glass-wallpaper-render.ts. */
export const wallpaperSampleGrid = { columns: 40, rows: 25 } as const;
export interface WallpaperStyle { veil: number; fill: number; page: number; glow: string }
export function wallpaperStyle(samples: readonly Rgb[], softness: number, mode: 'light' | 'dark',
  tokens: { paper: Rgb; sidebar: Rgb; text: Rgb; muted: Rgb }, structure: WallpaperStructure = 'islands', material: 'frost' | 'liquid' = 'frost',
  veil = wallpaperVeil(softness, mode, material)): WallpaperStyle {
  const minimum = wallpaperMinimums[structure][mode];
  const liquid = material === 'liquid';
  const backgrounds = samples.map(sample => mix(tokens.sidebar, sample, veil));
  let page: number, fill: number;
  if (liquid) {
    const lowest = liquidWallpaper.minimums[mode];
    page = solveGlassStrength(backgrounds, tokens.paper, tokens.text, 7, lowest.page);
    // Sample the left and top edges for a conservative sidebar tint.
    const grid = samples.length === wallpaperSampleGrid.columns * wallpaperSampleGrid.rows;
    const chrome = backgrounds.filter((_, index) => !grid
      || index % wallpaperSampleGrid.columns < wallpaperSampleGrid.columns * 0.3
      || Math.floor(index / wallpaperSampleGrid.columns) < wallpaperSampleGrid.rows * 0.1);
    fill = solveGlassStrength(chrome, tokens.paper, mix(tokens.text, tokens.muted, liquidWallpaper.ink), 4.5, lowest.panel);
  } else {
    // Body text needs AAA on the page; secondary text in the sidebar needs AA.
    page = solveGlassStrength(backgrounds, tokens.paper, tokens.text, 7, minimum.page);
    fill = solveGlassStrength(backgrounds, tokens.paper, tokens.muted, 4.5, minimum.fill);
  }
  // The most saturated colours of the image tint the card shadows.
  let weight = 0; const sum: Rgb = [0, 0, 0];
  for (const [r, g, b] of samples) {
    const saturation = Math.max(r, g, b) - Math.min(r, g, b) + 1;
    weight += saturation; sum[0] += r * saturation; sum[1] += g * saturation; sum[2] += b * saturation;
  }
  const glow = weight ? toHex(sum.map(v => v / weight) as Rgb) : toHex(tokens.sidebar);
  return { veil, fill, page, glow };
}

// ---- Storage ----
const databaseName = 'tano-glass-wallpaper';
export function indexedDbWallpaperStore(factory: IDBFactory | undefined = globalThis.indexedDB): WallpaperImageStore {
  const memory = new Map<string, Blob>();
  if (!factory) return { get: async key => memory.get(key), put: async (key, blob) => { memory.set(key, blob); }, delete: async key => { memory.delete(key); } };
  const open = () => new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('images');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const run = async <T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) => {
    const database = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const request = action(database.transaction('images', mode).objectStore('images'));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally { database.close(); }
  };
  return {
    get: async key => (await run<Blob | undefined>('readonly', store => store.get(key) as IDBRequest<Blob | undefined>)) ?? undefined,
    put: async (key, blob) => { await run('readwrite', store => store.put(blob, key)); },
    delete: async key => { await run('readwrite', store => store.delete(key)); },
  };
}

// ---- Controller ----
interface Storage { getItem(key: string): string | null; setItem(key: string, value: string): void }

export class GlassWallpaperController {
  readonly state = shallowRef<GlassWallpaperState>({ ...defaultWallpaper, busy: false, thumbnails: {} });
  private readonly key: string;
  private render?: WallpaperRender;
  private customSource?: { revision?: number; image: Promise<WallpaperSource> };
  private generation = 0;
  private appearanceChange = 0;
  private softnessTimer?: ReturnType<typeof setTimeout>;
  private liquidMaterial = false;
  private thumbnailMode?: ResolvedTheme['mode'];
  private developerMode = false;
  private useMaterialDefault = true;
  private wallpaperBeforeStripes?: Pick<WallpaperPreference, 'source' | 'softness' | 'veilOpacity'>;
  private readonly onTheme = () => {
    const mode = this.mode();
    const modeChanged = this.thumbnailMode !== undefined && mode !== this.thumbnailMode;
    if (modeChanged) this.updateThumbnails(mode);
    const liquid = this.isLiquid();
    const sourceChanged = this.liquidMaterial !== liquid && this.useMaterialDefault
      && !this.wallpaperBeforeStripes && this.state.value.source !== this.defaultSource();
    this.liquidMaterial = liquid;
    if (sourceChanged) this.patch({ source: this.defaultSource() });
    const { source } = this.state.value;
    this.publish(); // Repaint the current bitmap immediately while a replacement is being prepared.
    if (sourceChanged || (modeChanged && source !== 'none' && source !== 'custom')) {
      clearTimeout(this.softnessTimer);
      void this.refresh();
    }
  };
  constructor(
    private readonly principal: string,
    private readonly storage: Storage | undefined,
    private readonly images: WallpaperImageStore,
    private readonly renderer: WallpaperRenderer,
    private readonly root: () => HTMLElement = () => document.documentElement,
    private readonly target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
  ) {
    this.key = `tano.glass-wallpaper.v1.${encodeURIComponent(principal)}`;
    this.patch(this.read());
    this.target.addEventListener(themeChangedEvent, this.onTheme);
  }
  /** Keep the previous appearance visible until the implicit cloud wallpaper is ready. */
  applyWithWallpaper(material: string | undefined, mode: () => ResolvedTheme['mode'], apply: () => void) {
    const change = ++this.appearanceChange;
    if (material !== 'builtin:liquid' || this.isLiquid() || !this.useMaterialDefault || this.wallpaperBeforeStripes) {
      apply();
      return;
    }
    const prepare = async () => {
      const targetMode = mode();
      const softness = this.state.value.softness;
      let render: WallpaperRender | undefined;
      let error: string | undefined;
      try {
        const image = await this.renderer.builtin('builtin:clouds', targetMode);
        render = await this.renderer.render(image, softness);
      } catch (failure) {
        error = failure instanceof Error ? failure.message : String(failure);
      }
      if (change !== this.appearanceChange || !this.useMaterialDefault || this.wallpaperBeforeStripes) {
        if (render) URL.revokeObjectURL(render.url);
        if (change === this.appearanceChange) apply();
        return;
      }
      if (targetMode !== mode() || softness !== this.state.value.softness) {
        if (render) URL.revokeObjectURL(render.url);
        await prepare();
        return;
      }
      ++this.generation;
      clearTimeout(this.softnessTimer);
      if (this.render) URL.revokeObjectURL(this.render.url);
      this.render = render;
      this.liquidMaterial = true;
      if (this.thumbnailMode !== targetMode) this.updateThumbnails(targetMode);
      this.patch({ source: 'builtin:clouds', busy: false, url: render?.url, error });
      apply();
    };
    void prepare();
  }
  private defaultSource() { return this.isLiquid() ? 'builtin:clouds' : defaultWallpaper.source; }
  private read(): WallpaperPreference {
    try {
      const saved = this.storage?.getItem(this.key);
      this.useMaterialDefault = !saved;
      if (saved) return parseWallpaperPreference(JSON.parse(saved));
    } catch { this.useMaterialDefault = true; }
    return { ...defaultWallpaper, source: this.defaultSource() };
  }
  private write(preference: WallpaperPreference) {
    this.useMaterialDefault = false;
    try { this.storage?.setItem(this.key, JSON.stringify(preference)); } catch { /* Session-only when storage is unavailable. */ }
  }
  private patch(next: Partial<GlassWallpaperState>) { this.state.value = { ...this.state.value, ...next }; }
  private preference(): WallpaperPreference {
    const { source, softness, veilOpacity } = this.wallpaperBeforeStripes ?? this.state.value;
    const { customRevision } = this.state.value;
    return { source, softness, ...(veilOpacity ? { veilOpacity } : {}), ...(customRevision === undefined ? {} : { customRevision }) };
  }
  private leaveDebugStripes() {
    if (!this.wallpaperBeforeStripes) return;
    this.patch(this.wallpaperBeforeStripes);
    this.wallpaperBeforeStripes = undefined;
    clearTimeout(this.softnessTimer);
  }
  setDeveloperMode(enabled: boolean) {
    if (this.developerMode === enabled) return;
    this.developerMode = enabled;
    if (this.thumbnailMode !== undefined) this.updateThumbnails(this.mode());
    if (!enabled && this.wallpaperBeforeStripes) {
      this.leaveDebugStripes();
      void this.refresh();
    }
  }
  get veilOpacity() {
    const { source, softness, veilOpacity } = this.state.value;
    const mode = this.mode();
    if (veilOpacity?.[mode] !== undefined) return veilOpacity[mode];
    const liquid = this.isLiquid();
    const automatic = liquid && source === 'builtin:clouds' ? softness / 400 : wallpaperVeil(softness, mode, liquid ? 'liquid' : 'frost');
    return Math.round(automatic * 100);
  }
  setVeilOpacity(value: number, commit = false) {
    if (!Number.isFinite(value)) return;
    const opacity = Math.round(Math.min(100, Math.max(0, value)));
    this.patch({ veilOpacity: { ...this.state.value.veilOpacity, [this.mode()]: opacity } });
    this.publish();
    if (commit && !this.wallpaperBeforeStripes) this.write(this.preference());
  }
  private isLiquid() { return this.root().dataset.material === 'builtin:liquid'; }
  private mode(root = this.root()): ResolvedTheme['mode'] {
    return root.dataset.theme === 'dark' ? 'dark' : 'light';
  }
  private updateThumbnails(mode: ResolvedTheme['mode']) {
    const choices = this.developerMode ? [...builtinWallpapers, debugStripeWallpaper] : builtinWallpapers;
    const thumbnails = Object.fromEntries(choices.map(item => [item.id, this.renderer.thumbnail(item.id, mode)]));
    this.thumbnailMode = mode;
    this.patch({ thumbnails });
  }
  /** Load the saved choice; also used when another window changes it. */
  async load() {
    this.leaveDebugStripes();
    this.clearCustomSource();
    this.patch({ customRevision: undefined, veilOpacity: undefined, ...this.read() });
    this.updateThumbnails(this.mode());
    await this.refresh();
  }
  refreshPreferences(key: string | null) {
    if (key !== null && key !== this.key) return;
    const saved = this.read();
    const current = this.preference();
    if (JSON.stringify(saved) === JSON.stringify(current)) return;
    this.leaveDebugStripes();
    if (saved.customRevision !== current.customRevision) this.clearCustomSource();
    this.patch({ customRevision: undefined, veilOpacity: undefined, ...saved });
    void this.refresh();
  }
  private clearCustomSource() {
    this.customSource = undefined;
    this.patch({ customThumbnail: undefined });
  }
  private loadCustomSource(revision: number | undefined) {
    if (this.customSource && this.customSource.revision === revision) return this.customSource.image;
    const image = this.images.get(this.principal).then(blob => {
      if (!blob) throw new Error('之前选择的图片已不存在，请重新选择。');
      return this.renderer.decode(blob);
    });
    this.customSource = { revision, image };
    void image.then(source => {
      if (this.customSource?.image !== image || revision === undefined) return;
      try {
        this.patch({ customThumbnail: this.renderer.customThumbnail(source) });
      } catch { /* Preview failure does not prevent using the wallpaper. */ }
    }, () => {
      if (this.customSource?.image === image) this.customSource = undefined;
    });
    return image;
  }
  private async source() {
    const { source, customRevision } = this.state.value;
    if (source === 'custom') return this.loadCustomSource(customRevision);
    // Populate the picker even when a different wallpaper is active.
    if (customRevision !== undefined) void this.loadCustomSource(customRevision);
    return source === 'none' ? undefined : this.renderer.builtin(source, this.mode());
  }
  private async refresh() {
    const generation = ++this.generation;
    this.liquidMaterial = this.isLiquid();
    const softness = this.state.value.softness;
    this.patch({ busy: true, error: undefined });
    try {
      const source = await this.source();
      const render = source ? await this.renderer.render(source, softness) : undefined;
      if (generation !== this.generation) { if (render) URL.revokeObjectURL(render.url); return; }
      if (this.render) URL.revokeObjectURL(this.render.url);
      this.render = render;
      this.patch({ busy: false, url: render?.url });
    } catch (error) {
      if (generation !== this.generation) return;
      if (this.render) URL.revokeObjectURL(this.render.url);
      this.render = undefined;
      this.patch({ busy: false, url: undefined, error: error instanceof Error ? error.message : String(error) });
    }
    this.publish();
  }
  select(source: string) {
    if (source === debugStripeWallpaper.id) {
      if (!this.developerMode || this.wallpaperBeforeStripes) return;
      const { source: previousSource, softness, veilOpacity } = this.state.value;
      this.wallpaperBeforeStripes = { source: previousSource, softness, veilOpacity };
      clearTimeout(this.softnessTimer);
      this.patch({ source, softness: 0, veilOpacity: undefined });
      void this.refresh();
      return;
    }
    if (source === 'custom' && this.state.value.customRevision === undefined) return;
    this.leaveDebugStripes();
    this.patch({ source });
    this.write(this.preference());
    void this.refresh();
  }
  /** Live while dragging; the render is debounced so the slider stays smooth. */
  setSoftness(softness: number, commit = false) {
    this.patch({ softness: Math.round(Math.min(100, Math.max(0, softness))) });
    clearTimeout(this.softnessTimer);
    if (commit && !this.wallpaperBeforeStripes) this.write(this.preference());
    if (this.state.value.source === 'none') return;
    this.publish();
    this.softnessTimer = setTimeout(() => void this.refresh(), commit ? 0 : 120);
  }
  async importFile(file: File) {
    if (!file.type.startsWith('image/')) { this.patch({ error: '请选择图片文件。' }); return; }
    if (file.size > maxWallpaperBytes) { this.patch({ error: '图片超过 30 MB，请换一张较小的图片。' }); return; }
    this.patch({ busy: true, error: undefined });
    try {
      const blob = await this.renderer.normalizeImport(file);
      await this.images.put(this.principal, blob);
    } catch (error) {
      this.patch({ busy: false, error: error instanceof Error ? error.message : '无法保存这张图片。' });
      return;
    }
    this.clearCustomSource();
    this.leaveDebugStripes();
    this.patch({ source: 'custom', customRevision: Date.now() });
    this.write(this.preference());
    await this.refresh();
  }
  async removeCustom() {
    try { await this.images.delete(this.principal); } catch { /* A missing record is already removed. */ }
    this.clearCustomSource();
    if (this.wallpaperBeforeStripes?.source === 'custom') this.wallpaperBeforeStripes.source = 'none';
    const source = this.state.value.source === 'custom' ? 'none' : this.state.value.source;
    this.patch({ source, customRevision: undefined });
    this.write(this.preference());
    await this.refresh();
  }
  /** Compute the glass tint and contrast from the current bitmap and theme. */
  private publish() {
    const root = this.root();
    const names = ['--glass-wallpaper', '--glass-wallpaper-veil', '--glass-wallpaper-fill', '--glass-wallpaper-page', '--glass-wallpaper-glow'];
    if (!this.render || this.state.value.source === 'none') {
      root.removeAttribute('data-glass-wallpaper');
      for (const name of names) root.style.removeProperty(name);
      return;
    }
    const styles = getComputedStyle(root);
    const token = (name: string, fallback: Rgb) => parseColor(styles.getPropertyValue(`--${name}`)) ?? fallback;
    const mode = this.mode(root);
    const light = mode === 'light';
    const style = wallpaperStyle(this.render.samples, this.state.value.softness, mode, {
      paper: token('paper', light ? [251, 252, 254] : [25, 32, 42]), sidebar: token('sidebar', light ? [223, 230, 238] : [15, 19, 26]),
      text: token('text', light ? [28, 36, 48] : [227, 232, 240]), muted: token('muted', light ? [92, 104, 122] : [141, 153, 171]),
    }, root.dataset.layout === 'continuous' || root.dataset.layout === 'document' ? root.dataset.layout : 'islands',
    root.dataset.material === 'builtin:liquid' ? 'liquid' : 'frost',
    this.veilOpacity / 100);
    root.setAttribute('data-glass-wallpaper', '');
    root.style.setProperty('--glass-wallpaper', `url("${this.render.url}")`);
    root.style.setProperty('--glass-wallpaper-veil', `${Math.round(style.veil * 100)}%`);
    root.style.setProperty('--glass-wallpaper-fill', `${Math.round(style.fill * 100)}%`);
    root.style.setProperty('--glass-wallpaper-page', `${Math.round(style.page * 100)}%`);
    root.style.setProperty('--glass-wallpaper-glow', style.glow);
  }
  dispose() {
    this.appearanceChange++;
    this.generation++;
    this.clearCustomSource();
    clearTimeout(this.softnessTimer);
    this.target.removeEventListener(themeChangedEvent, this.onTheme);
    if (this.render) URL.revokeObjectURL(this.render.url);
    this.render = undefined;
    this.publish();
  }
}

let current: GlassWallpaperController | undefined;
/** The workbench owns one controller; settings read it from here (auxiliary windows share the realm). */
export function setGlassWallpaper(controller: GlassWallpaperController | undefined) { current = controller; }
export function glassWallpaper() { return current; }
