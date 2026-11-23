// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  contrast, GlassWallpaperController, parseColor, parseWallpaperPreference, solveGlassStrength, wallpaperStyle, wallpaperVeil,
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

it('sanitises saved preferences', () => {
  expect(parseWallpaperPreference(null)).toEqual({ source: 'none', softness: 50 });
  expect(parseWallpaperPreference({ source: 'builtin:dusk', softness: 140, customRevision: 3 })).toEqual({ source: 'builtin:dusk', softness: 100, customRevision: 3 });
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
    thumbnail: id => `data:${id}`,
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
  expect(controller.state.value.thumbnails['builtin:dawn']).toBe('data:builtin:dawn');
  controller.select('builtin:dawn'); await flush();
  expect(root.hasAttribute('data-glass-wallpaper')).toBe(true);
  expect(root.style.getPropertyValue('--glass-wallpaper')).toBe('url("blob:1-50")');
  expect(root.style.getPropertyValue('--glass-wallpaper-veil')).toBe('24%');
  expect(parseFloat(root.style.getPropertyValue('--glass-wallpaper-page'))).toBeGreaterThanOrEqual(58);
  expect(JSON.parse(localStorage.getItem('tano.glass-wallpaper.v1.alice')!)).toEqual({ source: 'builtin:dawn', softness: 50 });
  // A theme change recomputes the mode-dependent veil without re-rendering the bitmap.
  root.dataset.theme = 'dark'; window.dispatchEvent(new Event(themeChangedEvent));
  expect(root.style.getPropertyValue('--glass-wallpaper-veil')).toBe('45%');
  expect(renderer.render).toHaveBeenCalledTimes(1);
  controller.select('none'); await flush();
  expect(root.hasAttribute('data-glass-wallpaper')).toBe(false);
  expect(root.style.getPropertyValue('--glass-wallpaper')).toBe('');
  expect(revoked).toEqual(['blob:1-50']);
  controller.dispose();
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
  expect(controller.state.value).toMatchObject({ source: 'custom', busy: false, url: 'blob:1-50' });
  const saved = JSON.parse(localStorage.getItem('tano.glass-wallpaper.v1.alice')!);
  expect(saved.customRevision).toEqual(expect.any(Number));

  const other = new GlassWallpaperController('alice', localStorage, store, renderer, () => document.createElement('div'));
  await other.load();
  expect(other.state.value).toMatchObject({ source: 'custom', customRevision: saved.customRevision });
  other.refreshPreferences('unrelated');
  await controller.removeCustom();
  expect(images.has('alice')).toBe(false);
  expect(controller.state.value.source).toBe('none');
  expect(controller.state.value.customRevision).toBeUndefined();
  other.refreshPreferences('tano.glass-wallpaper.v1.alice'); await flush();
  expect(other.state.value.source).toBe('none');
  controller.dispose(); other.dispose();
});

it('debounces softness while dragging, renders once on release and drops stale renders', async () => {
  vi.useFakeTimers();
  const { store, renderer } = fakes();
  const controller = new GlassWallpaperController('alice', localStorage, store, renderer);
  await controller.load();
  controller.select('builtin:tide'); await vi.runAllTimersAsync();
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
