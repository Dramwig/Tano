/**
 * Canvas work for the frosted-glass wallpaper. Everything here runs once per import or softness
 * change, never per frame: the desk then paints one static, pre-softened bitmap, so the live
 * backdrop blur on the cards has little left to do.
 */
import type { Rgb } from './glass-wallpaper';

export interface WallpaperRender {
  /** Object URL of the softened bitmap; the caller owns it and must revoke it. */
  url: string;
  /** Coarse colour samples of the softened image, used for readability and the accent glow. */
  samples: Rgb[];
}

/** Long side of the stored original and of the rendered desk bitmap. */
const importLongSide = 2400;
const renderLongSide = 1600;
const sampleColumns = 40;
const sampleRows = 25;

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
const recipes: Record<string, { base: [string, string]; lights: [x: number, y: number, r: number, color: string][] }> = {
  'builtin:dawn': { base: ['#dfe8f3', '#f4f1ee'], lights: [
    [0.18, 0.36, 0.42, '#7fa6ffcc'], [0.74, 0.28, 0.34, '#b9a2ff99'], [0.58, 0.9, 0.4, '#8fe0d0aa'], [0.96, 0.04, 0.3, '#ffd2b099'], [0.36, 0.72, 0.22, '#5d8cff88'],
  ] },
  'builtin:dusk': { base: ['#f3e3dc', '#e7dff0'], lights: [
    [0.2, 0.3, 0.38, '#ff9f7acc'], [0.7, 0.62, 0.42, '#c68cffaa'], [0.9, 0.1, 0.3, '#ffd27aaa'], [0.36, 0.95, 0.34, '#7f9cff88'], [0.52, 0.34, 0.2, '#ff7aa088'],
  ] },
  'builtin:tide': { base: ['#10202a', '#0b1220'], lights: [
    [0.22, 0.4, 0.42, '#1f8fa0dd'], [0.72, 0.68, 0.44, '#3a5fd0bb'], [0.88, 0.08, 0.3, '#58d0b099'], [0.4, 0.96, 0.32, '#8a6cff88'], [0.56, 0.3, 0.2, '#2fb5c888'],
  ] },
};
export const builtinWallpaperIds = Object.keys(recipes);

export function paintBuiltin(id: string, width = renderLongSide, height = Math.round(renderLongSide * 0.625)): HTMLCanvasElement {
  const recipe = recipes[id] ?? recipes['builtin:dawn']!;
  const { element, context } = canvas(width, height);
  const base = context.createLinearGradient(0, 0, width * 0.3, height);
  base.addColorStop(0, recipe.base[0]); base.addColorStop(1, recipe.base[1]);
  context.fillStyle = base; context.fillRect(0, 0, width, height);
  const unit = Math.max(width, height);
  for (const [x, y, r, color] of recipe.lights) {
    const light = context.createRadialGradient(x * width, y * height, 0, x * width, y * height, r * unit);
    light.addColorStop(0, color); light.addColorStop(1, `${color.slice(0, 7)}00`);
    context.fillStyle = light; context.fillRect(0, 0, width, height);
  }
  return element;
}

/** Small unsoftened preview for the picker. */
export function builtinThumbnail(id: string): string {
  return paintBuiltin(id, 160, 100).toDataURL('image/png');
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
  return { url, samples };
}
