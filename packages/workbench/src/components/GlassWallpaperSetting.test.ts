// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { GlassWallpaperController, setGlassWallpaper, type Rgb, type WallpaperRenderer } from '../glass-wallpaper';
import { preloadUiLocale, setUiLocale } from '../i18n';
import GlassWallpaperSetting from './GlassWallpaperSetting.vue';

let app: App | undefined;
let root: HTMLElement;
afterEach(() => { app?.unmount(); root?.remove(); setGlassWallpaper(undefined); localStorage.clear(); });
beforeAll(async () => {
  const { uiLocales } = await import('../locale');
  await Promise.all(uiLocales.map(preloadUiLocale));
  URL.revokeObjectURL = vi.fn();
});

function mount() {
  root = document.createElement('div'); document.body.append(root);
  app = createApp(() => h(GlassWallpaperSetting)); app.mount(root);
}

it('renders nothing without a workbench controller', () => {
  mount();
  expect(root.querySelector('.glass-wallpaper')).toBeNull();
});

it('lists the light field and built-in images, applies a choice and enables softness', async () => {
  setUiLocale('zh-CN');
  const source = { width: 4, height: 4 } as unknown as CanvasImageSource & { width: number; height: number };
  const renderer: WallpaperRenderer = { normalizeImport: async blob => blob, decode: async () => source, builtin: () => source,
    customThumbnail: () => 'data:image/webp;base64,cHJldmlldw==',
    thumbnail: id => `data:image/png;base64,${id.length}`, render: async () => ({ url: 'blob:x', samples: [[200, 210, 230]] as Rgb[] }) };
  const images = new Map<string, Blob>();
  const controller = new GlassWallpaperController('device', localStorage, { get: async k => images.get(k), put: async (k, b) => { images.set(k, b); }, delete: async k => { images.delete(k); } }, renderer);
  await controller.load();
  setGlassWallpaper(controller);
  mount();
  const labels = [...root.querySelectorAll('.glass-wallpaper-choice')].map(button => button.textContent?.trim());
  expect(labels).toEqual(['光斑', '晨雾', '暮光']);
  const slider = root.querySelector<HTMLInputElement>('input[type="range"]')!;
  expect(slider.disabled).toBe(true);
  expect(root.querySelector('[aria-label="移除我的图片"]')).toBeNull();
  root.querySelectorAll<HTMLButtonElement>('.glass-wallpaper-choice')[2]!.click();
  await new Promise(resolve => setTimeout(resolve, 0)); await nextTick();
  expect(root.querySelector('.glass-wallpaper-choice[aria-pressed="true"]')?.textContent).toContain('暮光');
  expect(slider.disabled).toBe(false);

  const stripes = () => [...root.querySelectorAll<HTMLButtonElement>('.glass-wallpaper-choice')]
    .find(button => button.textContent?.trim() === '调试条纹');
  const wallpaperKey = 'tano.glass-wallpaper.v1.device';
  expect(stripes()).toBeUndefined();
  controller.select('debug:stripes');
  expect(controller.state.value.source).toBe('builtin:dusk');
  controller.setDeveloperMode(true);
  await nextTick();
  stripes()!.click();
  await nextTick();
  expect(stripes()!.getAttribute('aria-pressed')).toBe('true');
  expect(slider.value).toBe('0');
  controller.setSoftness(25, true);
  expect(JSON.parse(localStorage.getItem(wallpaperKey)!)).toEqual({ source: 'builtin:dusk', softness: 50 });
  controller.setDeveloperMode(false);
  await nextTick();
  expect(stripes()).toBeUndefined();
  expect(root.querySelector('.glass-wallpaper-choice[aria-pressed="true"]')?.textContent).toContain('暮光');
  expect(slider.value).toBe('50');

  await controller.importFile(new File(['image'], 'wallpaper.webp', { type: 'image/webp' }));
  await nextTick();
  const custom = [...root.querySelectorAll('.glass-wallpaper-choice')].find(button => button.textContent?.trim() === '我的图片')!;
  const swatch = custom.querySelector<HTMLElement>('.glass-wallpaper-swatch')!;
  const preview = swatch.style.backgroundImage;
  expect(preview).toContain('cHJldmlldw==');
  root.querySelector<HTMLButtonElement>('.glass-wallpaper-choice')!.click();
  await new Promise(resolve => setTimeout(resolve, 0)); await nextTick();
  expect(custom.getAttribute('aria-pressed')).toBe('false');
  expect(swatch.style.backgroundImage).toBe(preview);
  controller.dispose();
});
