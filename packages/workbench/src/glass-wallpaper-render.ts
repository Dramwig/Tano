/**
 * Canvas work for glass wallpapers. The desk paints a static, pre-softened bitmap, so the live
 * backdrop blur on the cards has little left to do.
 */
import type { Rgb } from './glass-wallpaper';
import { debugStripeWallpaper, wallpaperSampleGrid } from './glass-wallpaper';
import type { ResolvedTheme } from './theme';
import cloudDay from './assets/clouds-day.webp';
import cloudNight from './assets/clouds-night.webp';

export interface WallpaperRender {
  /** Object URL of the softened bitmap; the caller owns it and must revoke it. */
  url: string;
  /** Coarse colour samples of the softened image, used for readability and the accent glow. */
  samples: Rgb[];
}

/** Long side of the stored original and of the rendered desk bitmap. */
const importLongSide = 2400;
const renderLongSide = 1600;
const sampleColumns = wallpaperSampleGrid.columns;
const sampleRows = wallpaperSampleGrid.rows;

function canvas(width: number, height: number) {
  const element = document.createElement('canvas');
  element.width = Math.max(1, Math.round(width));
  element.height = Math.max(1, Math.round(height));
  const context = element.getContext('2d');
  if (!context) throw new Error('无法处理图片：当前环境不支持 Canvas。');
  return { element, context };
}

function toBlob(element: HTMLCanvasElement, type = 'image/webp', quality = 0.88): Promise<Blob> {
  return new Promise((resolve, reject) => element.toBlob(blob => {
    if (blob) resolve(blob);
    else if (type !== 'image/jpeg') toBlob(element, 'image/jpeg', quality).then(resolve, reject);
    else reject(new Error('无法编码图片。'));
  }, type, quality));
}

type Source = CanvasImageSource & { width: number; height: number };

export async function decodeImage(blob: Blob): Promise<Source> {
  try {
    return await createImageBitmap(blob);
  } catch {
    throw new Error('无法读取这张图片，请换一张 JPG、PNG 或 WebP 图片。');
  }
}

/** Shrink a picked file once so storage stays small and later renders are cheap. */
export async function normalizeImport(file: Blob): Promise<Blob> {
  const image = await decodeImage(file);
  const scale = Math.min(1, importLongSide / Math.max(image.width, image.height));
  const { element, context } = canvas(image.width * scale, image.height * scale);
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, element.width, element.height);
  (image as Partial<ImageBitmap>).close?.();
  return toBlob(element);
}

/** Built-in wallpapers are painted, not shipped: soft fields of light with no asset weight. */
const recipes: Record<string, {
  base: Record<ResolvedTheme['mode'], [string, string]>;
  lights: [x: number, y: number, radius: number, light: string, dark: string][];
}> = {
  'builtin:dawn': {
    base: { light: ['#dfe8f3', '#f4f1ee'], dark: ['#101a29', '#151e2b'] },
    lights: [
      [0.18, 0.36, 0.42, '#7fa6ffcc', '#385892cc'],
      [0.74, 0.28, 0.34, '#b9a2ff99', '#554579aa'],
      [0.58, 0.9, 0.4, '#8fe0d0aa', '#2c6a68aa'],
      [0.96, 0.04, 0.3, '#ffd2b099', '#805c6399'],
      [0.36, 0.72, 0.22, '#5d8cff88', '#304b8288'],
    ],
  },
  'builtin:dusk': {
    base: { light: ['#f3e3dc', '#e7dff0'], dark: ['#261922', '#19172a'] },
    lights: [
      [0.2, 0.3, 0.38, '#ff9f7acc', '#935244cc'],
      [0.7, 0.62, 0.42, '#c68cffaa', '#714984bb'],
      [0.9, 0.1, 0.3, '#ffd27aaa', '#8c6045aa'],
      [0.36, 0.95, 0.34, '#7f9cff88', '#3f4c8588'],
      [0.52, 0.34, 0.2, '#ff7aa088', '#8c456188'],
    ],
  },
};
const clouds = { light: cloudDay, dark: cloudNight };
export const builtinWallpaperIds = [...Object.keys(recipes), 'builtin:clouds'];

function paintDebugStripes(context: CanvasRenderingContext2D, mode: ResolvedTheme['mode'], width: number, height: number) {
  const [teal, yellow, green, peach, ink] = mode === 'dark'
    ? ['#28484d', '#5c512e', '#3e5433', '#604435', '#dbe6e9']
    : ['#a8ddd9', '#f0dd8e', '#bad994', '#efc6a6', '#20231f'];
  context.save();
  context.scale(width, height);
  context.fillStyle = teal;
  context.fillRect(0, 0, 1, 1);
  for (const [color, x, y, radiusX, radiusY, rotation] of [
    [yellow, 0.34, 0.12, 0.48, 0.51, 0.29],
    [green, 0, 0.28, 0.22, 0.55, -0.18],
    [peach, 0.87, 0.91, 0.33, 0.43, 0.32],
  ] as const) {
    context.fillStyle = color;
    context.beginPath();
    context.ellipse(x, y, radiusX, radiusY, rotation, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();

  const spacing = Math.max(8, Math.round(width / 60));
  const thickness = Math.max(0.5, 0.75 * width / renderLongSide);
  context.fillStyle = ink;
  for (let x = Math.floor(spacing / 2); x < width; x += spacing) {
    context.fillRect(x, 0, thickness, height);
  }
}

function paintField(id: string, mode: ResolvedTheme['mode'], width: number, height: number): HTMLCanvasElement {
  const { element, context } = canvas(width, height);
  if (id === debugStripeWallpaper.id) {
    paintDebugStripes(context, mode, element.width, element.height);
    return element;
  }
  const recipe = recipes[id] ?? recipes['builtin:dawn']!;
  const base = context.createLinearGradient(0, 0, width * 0.3, height);
  base.addColorStop(0, recipe.base[mode][0]); base.addColorStop(1, recipe.base[mode][1]);
  context.fillStyle = base; context.fillRect(0, 0, width, height);
  const unit = Math.max(width, height);
  for (const [x, y, r, day, night] of recipe.lights) {
    const color = mode === 'dark' ? night : day;
    const light = context.createRadialGradient(x * width, y * height, 0, x * width, y * height, r * unit);
    light.addColorStop(0, color); light.addColorStop(1, `${color.slice(0, 7)}00`);
    context.fillStyle = light; context.fillRect(0, 0, width, height);
  }
  return element;
}

/** Small unsoftened preview for the picker. */
export function builtinThumbnail(id: string, mode: ResolvedTheme['mode']): string {
  if (id === 'builtin:clouds') return clouds[mode];
  return paintField(id, mode, 160, 100).toDataURL('image/png');
}

export async function paintBuiltin(id: string, mode: ResolvedTheme['mode']) {
  if (id !== 'builtin:clouds') return paintField(id, mode, renderLongSide, Math.round(renderLongSide * 0.625));
  const image = new Image();
  image.src = clouds[mode];
  await image.decode();
  return image;
}

export function customThumbnail(source: Source): string {
  const { element, context } = canvas(160, 100);
  const scale = Math.max(element.width / source.width, element.height / source.height);
  const width = source.width * scale, height = source.height * scale;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, (element.width - width) / 2, (element.height - height) / 2, width, height);
  return element.toDataURL('image/webp', 0.85);
}

/** True when the 2D context really applies CSS filters (Chromium yes, older WebKit no). */
function supportsFilter(context: CanvasRenderingContext2D) {
  context.filter = 'blur(1px)';
  const ok = context.filter === 'blur(1px)';
  context.filter = 'none';
  return ok;
}

/**
 * Softness 0–100 maps to a pre-blur of 0–48px at 1600px. The image is drawn slightly enlarged so the
 * blur never pulls transparent edges into the frame.
 */
export async function renderWallpaper(source: Source, softness: number): Promise<WallpaperRender> {
  const scale = renderLongSide / Math.max(source.width, source.height);
  const width = source.width * Math.min(1, scale), height = source.height * Math.min(1, scale);
  const { element, context } = canvas(width, height);
  const blur = Math.round(Math.max(0, Math.min(100, softness)) / 100 * 48 * (element.width / renderLongSide));
  const margin = blur * 2;
  context.imageSmoothingQuality = 'high';
  if (blur > 0 && supportsFilter(context)) {
    context.filter = `blur(${blur}px)`;
    context.drawImage(source, -margin, -margin, element.width + margin * 2, element.height + margin * 2);
    context.filter = 'none';
  } else if (blur > 0) {
    // Downscale-and-upscale is a decent blur where canvas filters are unavailable.
    const factor = Math.max(2, blur / 2);
    const small = canvas(element.width / factor, element.height / factor);
    small.context.imageSmoothingQuality = 'high';
    small.context.drawImage(source, 0, 0, small.element.width, small.element.height);
    context.drawImage(small.element, 0, 0, element.width, element.height);
  } else {
    context.drawImage(source, 0, 0, element.width, element.height);
  }
  const sample = canvas(sampleColumns, sampleRows);
  sample.context.imageSmoothingQuality = 'high';
  sample.context.drawImage(element, 0, 0, sampleColumns, sampleRows);
  const data = sample.context.getImageData(0, 0, sampleColumns, sampleRows).data;
  const samples: Rgb[] = [];
  for (let index = 0; index < data.length; index += 4) samples.push([data[index]!, data[index + 1]!, data[index + 2]!]);
  const url = URL.createObjectURL(await toBlob(element, 'image/webp', 0.9));
  const bitmap = new Image();
  bitmap.src = url;
  try {
    await bitmap.decode();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  return { url, samples };
}
