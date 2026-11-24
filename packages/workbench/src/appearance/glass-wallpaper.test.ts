// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  contrast, GlassWallpaperController, liquidWallpaper, mix, parseColor, parseWallpaperPreference, solveGlassStrength, wallpaperStyle, wallpaperVeil,
  type Rgb, type WallpaperImageStore, type WallpaperRenderer,
} from './glass-wallpaper';
import { themeChangedEvent } from './theme';

const white: Rgb = [255, 255, 255], black: Rgb = [0, 0, 0];
const tokens = { paper: [251, 252, 254] as Rgb, sidebar: [223, 230, 238] as Rgb, text: [28, 36, 48] as Rgb, muted: [92, 104, 122] as Rgb };

it('parses colours and keeps contrast maths symmetric', () => {
  expect(parseColor('#fff')).toEqual(white);
  expect(parseColor(' #1c2430 ')).toEqual([28, 36, 48]);
  expect(parseColor('rgb(1, 2, 3)')).toEqual([1, 2, 3]);
  expect(parseColor('var(--x)')).toBeUndefined();
  expect(contrast(white, black)).toBeCloseTo(21, 5);
  expect(contrast(black, white)).toBeCloseTo(contrast(white, black), 10);
});

it('keeps the design minimum on a calm image and only raises opacity as far as readability needs', () => {
  expect(solveGlassStrength([[240, 244, 248]], tokens.paper, tokens.text, 7, 0.74)).toBe(0.74);
  // At the page minimum even black stays above 7:1; a clearer sheet over black does not.
  expect(solveGlassStrength([black], tokens.paper, tokens.text, 7, 0.74)).toBe(0.74);
  const dark: Rgb[] = [[20, 20, 30], [40, 60, 90]];
  const alpha = solveGlassStrength(dark, tokens.paper, tokens.text, 7, 0.5);
  expect(alpha).toBeGreaterThan(0.5);
  expect(alpha).toBeLessThanOrEqual(0.98);
  // The solved card really is readable over every sample, and a notch clearer would not be.
  const card = (background: Rgb, a: number) => background.map((v, i) => tokens.paper[i]! * a + v * (1 - a)) as Rgb;
  for (const background of dark) expect(contrast(tokens.text, card(background, alpha))).toBeGreaterThanOrEqual(7);
  expect(dark.some(background => contrast(tokens.text, card(background, alpha - 0.02)) < 7)).toBe(true);
});

it('derives veil, opacity and glow per mode, with softer images veiled more', () => {
  expect(wallpaperVeil(0, 'light')).toBeCloseTo(0.08); expect(wallpaperVeil(100, 'light')).toBeCloseTo(0.4);
  expect(wallpaperVeil(0, 'dark')).toBeCloseTo(0.3); expect(wallpaperVeil(100, 'dark')).toBeCloseTo(0.6);
  const vivid: Rgb[] = [[30, 60, 200], [200, 40, 120], [10, 10, 10]];
  const sharp = wallpaperStyle(vivid, 0, 'light', tokens), soft = wallpaperStyle(vivid, 100, 'light', tokens);
  expect(sharp.page).toBeGreaterThanOrEqual(soft.page);
  expect(sharp.fill).toBeGreaterThanOrEqual(0.42);
  expect(sharp.glow).toMatch(/^#[\da-f]{6}$/);
  const darkTokens = { paper: [25, 32, 42] as Rgb, sidebar: [15, 19, 26] as Rgb, text: [227, 232, 240] as Rgb, muted: [141, 153, 171] as Rgb };
  const bright: Rgb[] = [[250, 250, 250], [255, 230, 200]];
  const night = wallpaperStyle(bright, 0, 'dark', darkTokens);
  expect(night.page).toBeGreaterThanOrEqual(0.72);
  expect(night.fill).toBeGreaterThan(0.5); // Secondary text over a bright image needs a denser sidebar.
  const fillCard = (background: Rgb) => background.map((v, i) => darkTokens.paper[i]! * night.fill + v * (1 - night.fill)) as Rgb;
  for (const sample of bright) expect(contrast(darkTokens.muted, fillCard(sample.map((v, i) => darkTokens.sidebar[i]! * 0.3 + v * 0.7) as Rgb))).toBeGreaterThanOrEqual(4.5);
});

it('starts the large continuous page denser than island cards and the document sheet', () => {
  const pale: Rgb[] = [[236, 240, 246]];
  const islands = wallpaperStyle(pale, 50, 'light', tokens, 'islands');
  const continuous = wallpaperStyle(pale, 50, 'light', tokens, 'continuous');
  const sheet = wallpaperStyle(pale, 50, 'light', tokens, 'document');
  expect([islands.page, sheet.page, continuous.page]).toEqual([0.58, 0.6, 0.62]);
  expect(wallpaperStyle(pale, 50, 'dark', { paper: [25, 32, 42], sidebar: [15, 19, 26], text: [227, 232, 240], muted: [141, 153, 171] }, 'continuous').page).toBeGreaterThanOrEqual(0.76);
});

it('keeps liquid glass clearer than frosted glass while body and sidebar text stay readable', () => {
  // A 40×25 grid: a mid-grey wall on the left, a dark patch in the middle of the page.
  const samples: Rgb[] = Array.from({ length: 1000 }, (_, index) => {
    const column = index % 40, row = Math.floor(index / 40);
    return column < 10 ? [120, 130, 140] : column > 16 && column < 26 && row > 5 && row < 18 ? [55, 45, 40] : [215, 210, 205];
  });
  const frost = wallpaperStyle(samples, 50, 'light', tokens, 'continuous');
  const liquid = wallpaperStyle(samples, 50, 'light', tokens, 'continuous', 'liquid');
  expect(liquid.veil).toBe(frost.veil);
  // The sidebar pane is measured only over the left column, so the dark patch does not thicken it.
  expect(liquid.fill).toBeLessThan(frost.fill);
  const over = (background: Rgb, alpha: number) => mix(tokens.paper, background, alpha);
  for (const sample of samples) {
    const bare = mix(tokens.sidebar, sample, liquid.veil);
    expect(contrast(tokens.text, over(bare, liquid.page))).toBeGreaterThanOrEqual(7);
  }
  // Secondary text (leaning towards body text) on the sidebar pane over the left column: AA.
  const ink = mix(tokens.text, tokens.muted, liquidWallpaper.ink);
  for (const [index, sample] of samples.entries()) {
    if (index % 40 >= 12) continue;
    const lens = mix(tokens.sidebar, sample, liquid.veil);
    expect(contrast(ink, over(lens, liquid.fill))).toBeGreaterThanOrEqual(4.5);
  }
});

it('sanitises saved preferences', () => {
  expect(parseWallpaperPreference(null)).toEqual({ source: 'none', softness: 50 });
  expect(parseWallpaperPreference({ source: 'builtin:dusk', softness: 140, customRevision: 3 })).toEqual({ source: 'builtin:dusk', softness: 100, customRevision: 3 });
  expect(parseWallpaperPreference({ source: 'builtin:tide', softness: 35, customRevision: 3 })).toEqual({ source: 'none', softness: 35, customRevision: 3 });
  expect(parseWallpaperPreference({ source: 'https://evil', softness: 'x' })).toEqual({ source: 'none', softness: 50 });
});

let urls = 0;
const revoked: string[] = [];
function fakes() {
  const images = new Map<string, Blob>();
  const store: WallpaperImageStore = { get: async key => images.get(key), put: async (key, blob) => { images.set(key, blob); }, delete: async key => { images.delete(key); } };
  const source = { width: 10, height: 10 } as unknown as CanvasImageSource & { width: number; height: number };
  const renderer: WallpaperRenderer = {
    normalizeImport: vi.fn(async (file: Blob) => file),
    decode: vi.fn(async () => source),
    builtin: vi.fn(() => source),
    thumbnail: (id, mode) => `data:${id}:${mode}`,
    customThumbnail: vi.fn(() => 'data:custom'),
    render: vi.fn(async (_source, softness) => ({ url: `blob:${++urls}-${softness}`, samples: [[40, 60, 120]] as Rgb[] })),
  };
  return { images, store, renderer };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const root = document.documentElement;

beforeEach(() => {
  localStorage.clear(); urls = 0; revoked.length = 0;
  URL.revokeObjectURL = vi.fn((url: string) => { revoked.push(url); });
  root.removeAttribute('style'); root.removeAttribute('data-glass-wallpaper'); root.dataset.theme = 'light';
});
afterEach(() => { vi.useRealTimers(); });

it('publishes a built-in wallpaper as CSS variables, persists the choice and clears it again', async () => {
  const { store, renderer } = fakes();
  const controller = new GlassWallpaperController('alice', localStorage, store, renderer);
  await controller.load();
  expect(root.hasAttribute('data-glass-wallpaper')).toBe(false);
  expect(controller.state.value.thumbnails['builtin:dawn']).toBe('data:builtin:dawn:light');
  controller.select('builtin:dawn'); await flush();
  expect(root.hasAttribute('data-glass-wallpaper')).toBe(true);
  expect(root.style.getPropertyValue('--glass-wallpaper')).toBe('url("blob:1-50")');
  expect(root.style.getPropertyValue('--glass-wallpaper-veil')).toBe('24%');
  expect(parseFloat(root.style.getPropertyValue('--glass-wallpaper-page'))).toBeGreaterThanOrEqual(58);
  expect(JSON.parse(localStorage.getItem('tano.glass-wallpaper.v1.alice')!)).toEqual({ source: 'builtin:dawn', softness: 50 });
  root.dataset.theme = 'dark'; window.dispatchEvent(new Event(themeChangedEvent));
  expect(controller.state.value.thumbnails).toEqual({
    'builtin:dawn': 'data:builtin:dawn:dark',
    'builtin:dusk': 'data:builtin:dusk:dark',
    'builtin:clouds': 'data:builtin:clouds:dark',
  });
  await flush();
  expect(renderer.builtin).toHaveBeenNthCalledWith(1, 'builtin:dawn', 'light');
  expect(renderer.builtin).toHaveBeenNthCalledWith(2, 'builtin:dawn', 'dark');
  expect(root.style.getPropertyValue('--glass-wallpaper')).toBe('url("blob:2-50")');
  expect(root.style.getPropertyValue('--glass-wallpaper-veil')).toBe('45%');
  // Changing other appearance settings in dark mode reuses the dark bitmap.
  window.dispatchEvent(new Event(themeChangedEvent)); await flush();
  expect(renderer.render).toHaveBeenCalledTimes(2);
  expect(JSON.parse(localStorage.getItem('tano.glass-wallpaper.v1.alice')!)).toEqual({ source: 'builtin:dawn', softness: 50 });
  controller.select('none'); await flush();
  expect(root.hasAttribute('data-glass-wallpaper')).toBe(false);
  expect(root.style.getPropertyValue('--glass-wallpaper')).toBe('');
  expect(revoked).toEqual(['blob:1-50', 'blob:2-50']);
  controller.dispose();
});

it('applies softness to both glass materials and preserves manual veil opacity', async () => {
  const { store, renderer } = fakes();
  const controller = new GlassWallpaperController('alice', localStorage, store, renderer);
  await controller.load();
  controller.select('builtin:dusk'); await flush();
  root.dataset.material = 'builtin:liquid';
  window.dispatchEvent(new Event(themeChangedEvent)); await flush();
  expect(renderer.render).toHaveBeenCalledTimes(1);
  controller.setVeilOpacity(65, true);
  controller.setSoftness(72, true); await flush();
  expect(renderer.render).toHaveBeenLastCalledWith(expect.anything(), 72);
  expect(root.style.getPropertyValue('--glass-wallpaper-veil')).toBe('65%');
  root.dataset.material = 'builtin:frost';
  window.dispatchEvent(new Event(themeChangedEvent)); await flush();
  expect(renderer.render).toHaveBeenCalledTimes(2);
  controller.dispose();
  delete root.dataset.material;
});

it('discards a prepared cloud wallpaper when the user switches away before it is ready', async () => {
  const { store, renderer } = fakes();
  const controller = new GlassWallpaperController('alice', localStorage, store, renderer);
  await controller.load();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.mocked(renderer.render).mockImplementationOnce(async () => {
    await gate;
    return { url: 'blob:abandoned', samples: [] };
  });
  const applyLiquid = vi.fn();
  const applyFlat = vi.fn();
  controller.applyWithWallpaper('builtin:liquid', () => 'light', applyLiquid);
  controller.applyWithWallpaper(undefined, () => 'light', applyFlat);
  expect(applyFlat).toHaveBeenCalledOnce();
  release();
  await flush();
  expect(applyLiquid).not.toHaveBeenCalled();
  expect(revoked).toEqual(['blob:abandoned']);
  controller.dispose();
});

it('restores a manual veil per mode without re-rendering the liquid bitmap', async () => {
  const { store, renderer } = fakes();
  root.dataset.material = 'builtin:liquid';
  const controller = new GlassWallpaperController('alice', localStorage, store, renderer);
  try {
    await controller.load();
    await controller.importFile(new File(['png'], 'a.png', { type: 'image/png' }));
    const renders = vi.mocked(renderer.render).mock.calls.length;
    controller.setVeilOpacity(100, true);
    expect(root.style.getPropertyValue('--glass-wallpaper-veil')).toBe('100%');
    root.dataset.theme = 'dark'; window.dispatchEvent(new Event(themeChangedEvent));
    expect(root.style.getPropertyValue('--glass-wallpaper-veil')).toBe('91%');
    controller.setVeilOpacity(0, true);
    expect(root.style.getPropertyValue('--glass-wallpaper-veil')).toBe('0%');
    expect(renderer.render).toHaveBeenCalledTimes(renders);
    await controller.load();
    expect(controller.veilOpacity).toBe(0);
    root.dataset.theme = 'light'; window.dispatchEvent(new Event(themeChangedEvent));
    expect(controller.veilOpacity).toBe(100);
  } finally {
    controller.dispose();
    delete root.dataset.material;
  }
});

it('imports, reloads in another window and removes a custom image', async () => {
  const { images, store, renderer } = fakes();
  const controller = new GlassWallpaperController('alice', localStorage, store, renderer);
  await controller.load();
  controller.select('custom'); // Nothing stored yet: ignored.
  expect(controller.state.value.source).toBe('none');
  await controller.importFile(new File(['x'], 'a.txt', { type: 'text/plain' }));
  expect(controller.state.value.error).toBe('请选择图片文件。');
  await controller.importFile(new File(['png'], 'a.png', { type: 'image/png' }));
  expect(images.has('alice')).toBe(true);
  expect(controller.state.value).toMatchObject({ source: 'custom', busy: false, url: 'blob:1-50', customThumbnail: 'data:custom' });
  root.dataset.theme = 'dark'; window.dispatchEvent(new Event(themeChangedEvent));
  await flush();
  expect(renderer.render).toHaveBeenCalledTimes(1);
  expect(controller.state.value).toMatchObject({ source: 'custom', busy: false, url: 'blob:1-50' });
  const saved = JSON.parse(localStorage.getItem('tano.glass-wallpaper.v1.alice')!);
  expect(saved.customRevision).toEqual(expect.any(Number));

  controller.select('builtin:dawn'); await flush();
  expect(revoked).toContain('blob:1-50');
  expect(controller.state.value.customThumbnail).toBe('data:custom');
  expect(renderer.decode).toHaveBeenCalledTimes(1);

  const other = new GlassWallpaperController('alice', localStorage, store, renderer, () => document.createElement('div'));
  await other.load();
  await flush();
  expect(other.state.value).toMatchObject({ source: 'builtin:dawn', customRevision: saved.customRevision, customThumbnail: 'data:custom' });

  const now = vi.spyOn(Date, 'now').mockReturnValue(saved.customRevision + 1);
  vi.mocked(renderer.customThumbnail).mockReturnValue('data:replacement');
  await controller.importFile(new File(['replacement'], 'b.png', { type: 'image/png' }));
  now.mockRestore();
  other.refreshPreferences('tano.glass-wallpaper.v1.alice'); await flush();
  expect(other.state.value).toMatchObject({ source: 'custom', customThumbnail: 'data:replacement' });
  other.refreshPreferences('unrelated');
  await controller.removeCustom();
  expect(images.has('alice')).toBe(false);
  expect(controller.state.value.source).toBe('none');
  expect(controller.state.value.customRevision).toBeUndefined();
  expect(controller.state.value.customThumbnail).toBeUndefined();
  other.refreshPreferences('tano.glass-wallpaper.v1.alice'); await flush();
  expect(other.state.value.source).toBe('none');
  expect(other.state.value.customThumbnail).toBeUndefined();
  controller.dispose(); other.dispose();
});

it('debounces softness while dragging, renders once on release and drops stale renders', async () => {
  vi.useFakeTimers();
  const { store, renderer } = fakes();
  const controller = new GlassWallpaperController('alice', localStorage, store, renderer);
  await controller.load();
  controller.select('builtin:dusk'); await vi.runAllTimersAsync();
  for (const value of [55, 60, 70]) controller.setSoftness(value);
  expect(root.style.getPropertyValue('--glass-wallpaper-veil')).toBe('30%'); // Veil follows the slider immediately.
  controller.setSoftness(72, true); await vi.runAllTimersAsync();
  expect((renderer.render as ReturnType<typeof vi.fn>).mock.calls.map(call => call[1])).toEqual([50, 72]);
  expect(JSON.parse(localStorage.getItem('tano.glass-wallpaper.v1.alice')!).softness).toBe(72);
  controller.dispose();
  expect(root.hasAttribute('data-glass-wallpaper')).toBe(false);
});

it('reports a missing stored image instead of failing silently', async () => {
  const { store, renderer } = fakes();
  localStorage.setItem('tano.glass-wallpaper.v1.alice', JSON.stringify({ source: 'custom', softness: 50, customRevision: 1 }));
  const controller = new GlassWallpaperController('alice', localStorage, store, renderer);
  await controller.load();
  expect(controller.state.value.error).toBe('之前选择的图片已不存在，请重新选择。');
  expect(root.hasAttribute('data-glass-wallpaper')).toBe(false);
  controller.dispose();
});
