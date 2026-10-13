import { splitFrontmatter } from '@tano/editor/syntax';
import { frontmatterValue, removeFrontmatterProperty, updateFrontmatterProperty } from '@tano/editor/frontmatter-display';

export type AppearanceProperty = 'icon' | 'cover';

export const documentCovers = [
  { value: 'tano:coral', label: '珊瑚红', background: '#e95b59' },
  { value: 'tano:amber', label: '琥珀黄', background: '#f7c254' },
  { value: 'tano:blue', label: '湖蓝', background: '#229bc2' },
  { value: 'tano:cream', label: '奶油白', background: '#fff0e5' },
  { value: 'tano:sage', label: '鼠尾草绿', background: '#91ad9d' },
  { value: 'tano:rose', label: '玫瑰粉', background: '#d992ac' },
  { value: 'tano:mist', label: '薄雾', background: 'linear-gradient(120deg, #dce8e4, #e9ede6 50%, #c8d9d4)' },
  { value: 'tano:sand', label: '暖砂', background: 'linear-gradient(120deg, #e9d6be, #f3e8d9 55%, #d8b99d)' },
  { value: 'tano:sky', label: '晴空', background: 'linear-gradient(120deg, #b7d5e6, #e1edf3 55%, #c3cee5)' },
  { value: 'tano:dusk', label: '暮色', background: 'linear-gradient(120deg, #d6c5df, #eddde0 55%, #e5c7bd)' },
  { value: 'tano:forest', label: '深林', background: 'linear-gradient(120deg, #31564c, #729484 55%, #a4b8a4)' },
  { value: 'tano:ink', label: '墨色', background: 'linear-gradient(120deg, #364250, #798692 55%, #aab4bb)' },
  { value: 'tano:lagoon', label: '浅湾', background: 'linear-gradient(160deg, #43bbc2, #9ed5ca 55%, #d3aaa0)' },
  { value: 'tano:sunset', label: '落日', background: 'linear-gradient(135deg, #ec9d7a, #e44635 60%, #dc2922)' },
  { value: 'tano:aurora', label: '极光', background: 'linear-gradient(145deg, #665bc6, #a952a0 50%, #df5274)' },
  { value: 'tano:coast', label: '海岸', background: 'linear-gradient(145deg, #255979, #639aa7 50%, #ddd2b9)' },
] as const;

export function appearanceProperty(markdown: string, key: AppearanceProperty) {
  return frontmatterValue(splitFrontmatter(markdown).prefix, key);
}

export function appearanceText(markdown: string, key: AppearanceProperty): string {
  try {
    const property = appearanceProperty(markdown, key);
    return property?.kind === 'text' ? property.value : '';
  } catch { return ''; }
}

/** Apply to the latest Markdown, preserving independent edits and rejecting a stale field. */
export function updateAppearance(markdown: string, key: AppearanceProperty, value: string,
  previous: ReturnType<typeof appearanceProperty>): string {
  const { prefix } = splitFrontmatter(markdown);
  if (!prefix && /^\uFEFF?(?:---|\+\+\+)\r?\n/.test(markdown))
    throw new Error('文档开头的属性无法解析，请在源码中修改');
  const current = appearanceProperty(markdown, key);
  if (JSON.stringify(current) !== JSON.stringify(previous))
    throw new Error(`${key === 'icon' ? '图标' : '封面'}已被修改，请重新打开选择器后重试`);
  const updated = value
    ? updateFrontmatterProperty(markdown, current ? key : null, key, 'text', value)
    : current ? removeFrontmatterProperty(markdown, key) : markdown;
  if ((appearanceProperty(updated, key)?.value ?? '') !== value)
    throw new Error('文档属性无法更新，请在源码中修改');
  return updated;
}

/** The browser demo has no attachment service; keep a bounded image in its Markdown. */
export async function embeddedCoverImage(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 10 * 1024 * 1024)
    throw new Error('请选择不超过 10 MB 的 PNG、JPEG、WebP 或 GIF 图片。');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const scale = Math.min(1, 1600 / image.naturalWidth, 900 / image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法处理封面图片，请重试。');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/webp', 0.85);
  } finally { URL.revokeObjectURL(url); }
}
