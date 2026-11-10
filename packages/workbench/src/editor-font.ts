export type VisualFontChoice = 'system' | 'serif' | 'handwritten' | 'mono' | 'custom';
export interface FontSelection { choice: VisualFontChoice; customName: string }
export interface SplitFontSettings {
  enabled: boolean;
  chinese: FontSelection;
  english: FontSelection;
}

/* System and mono presets name explicit CJK fallbacks to avoid unrelated
   generic glyph fallbacks. Keep these stacks in
   sync with --font-cjk-sans / --font-ui / --font-mono in styles.css. */
const cjkSans =
  "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei UI', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Noto Sans SC', 'Source Han Sans SC'";
const systemFontFamily =
  `-apple-system, BlinkMacSystemFont, 'Segoe UI Variable Text', 'Segoe UI', ${cjkSans}, sans-serif`;
const serifFontFamily =
  // Preserve the original platform serif fallback for CJK. Explicit STSong
  // takes over on Windows with Office fonts and changes the established face.
  'Literata, Georgia, ui-serif, serif';
const handwrittenFontFamily =
  "'KaiTi', 'STKaiti', 'Kaiti SC', 'Noto Serif CJK SC', Georgia, serif";
const monoFontFamily =
  `'Maple Mono NF', 'Maple Mono NF CN', 'Cascadia Code', 'Sarasa Mono SC', 'Noto Sans Mono CJK SC', ${cjkSans}, ui-monospace, monospace`;

export function parseVisualFontChoice(value: string | null): VisualFontChoice {
  return value === 'serif' || value === 'handwritten' || value === 'mono' || value === 'custom' ? value : 'system';
}

export function sanitizeCustomFontName(value: string): string {
  return value.replace(/[^\p{L}\p{N} ._+\-]/gu, '').slice(0, 80);
}

export function visualFontFamily(choice: VisualFontChoice, customName: string): string {
  if (choice === 'serif') return serifFontFamily;
  if (choice === 'handwritten') return handwrittenFontFamily;
  if (choice === 'mono') return monoFontFamily;
  const name = sanitizeCustomFontName(customName).trim();
  return choice === 'custom' && name
    ? `${JSON.stringify(name)}, ${systemFontFamily}`
    : systemFontFamily;
}

export function defaultSplitFontSettings(choice: VisualFontChoice = 'system', customName = ''): SplitFontSettings {
  return { enabled: false, chinese: { choice, customName }, english: { choice, customName } };
}

/** Malformed device preferences fall back to the existing unified font. */
export function parseSplitFontSettings(value: string, choice: VisualFontChoice, customName: string): SplitFontSettings {
  const fallback = defaultSplitFontSettings(choice, customName);
  try {
    const saved = JSON.parse(value);
    const selection = (input: unknown): FontSelection => {
      if (!input || typeof input !== 'object') return { choice, customName };
      const font = input as Record<string, unknown>;
      return { choice: parseVisualFontChoice(typeof font.choice === 'string' ? font.choice : choice),
        customName: typeof font.customName === 'string' ? sanitizeCustomFontName(font.customName) : customName };
    };
    return { enabled: saved?.enabled === true, chinese: selection(saved?.chinese), english: selection(saved?.english) };
  } catch { return fallback; }
}

const latinSystemFonts = ['Segoe UI Variable Text', 'Segoe UI', 'Helvetica Neue', 'Arial', 'Noto Sans', 'Liberation Sans', 'DejaVu Sans'];
const latinPresetFonts: Record<Exclude<VisualFontChoice, 'custom'>, string[]> = {
  system: latinSystemFonts,
  serif: ['Literata', 'Georgia', 'Times New Roman', 'Noto Serif', 'Liberation Serif', 'DejaVu Serif'],
  handwritten: ['KaiTi', 'STKaiti', 'Kaiti SC', 'Georgia', 'Times New Roman'],
  mono: ['Maple Mono NF', 'Maple Mono NF CN', 'Cascadia Code', 'Sarasa Mono SC', 'Noto Sans Mono CJK SC', 'Consolas', 'Menlo', 'Liberation Mono', 'DejaVu Sans Mono'],
};
export const latinFontAliasPrefix = 'Tano Latin ';
const bundledLatinFaces: Record<string, { url: string; style: string; weight: string }[]> = {
  Literata: [
    { url: new URL('./fonts/Literata.woff2', import.meta.url).href, style: 'normal', weight: '200 900' },
    { url: new URL('./fonts/Literata-Italic.woff2', import.meta.url).href, style: 'italic', weight: '200 900' },
  ],
  'Maple Mono NF': [
    { url: new URL('./fonts/MapleMono-NF-Regular.ttf', import.meta.url).href, style: 'normal', weight: '400' },
    { url: new URL('./fonts/MapleMono-NF-Italic.ttf', import.meta.url).href, style: 'italic', weight: '400' },
    { url: new URL('./fonts/MapleMono-NF-Bold.ttf', import.meta.url).href, style: 'normal', weight: '700' },
    { url: new URL('./fonts/MapleMono-NF-BoldItalic.ttf', import.meta.url).href, style: 'italic', weight: '700' },
  ],
};

/** Restrict the English faces to Latin glyphs even when a local face includes CJK.
 * Chinese characters and full-width punctuation use the Chinese stack unchanged.
 * Each fallback gets its own face, so missing glyphs can reach the next font. */
export function resolveEditorFont(choice: VisualFontChoice, customName: string, split?: SplitFontSettings): { family: string; fontFaces: string } {
  if (!split?.enabled) return { family: visualFontFamily(choice, customName), fontFaces: '' };
  const english = split.english;
  const custom = sanitizeCustomFontName(english.customName).trim();
  const fonts = english.choice === 'custom' ? [...(custom ? [custom] : []), ...latinSystemFonts] : latinPresetFonts[english.choice];
  const names = [...new Set(fonts)];
  const aliases = names.map(name => JSON.stringify(latinFontAliasPrefix + name));
  const fontFaces = names.flatMap((name, index) => {
    const bundled = Object.hasOwn(bundledLatinFaces, name) ? bundledLatinFaces[name] : undefined;
    const sources = bundled?.map(face => `src: url(${JSON.stringify(face.url)}); font-style: ${face.style}; font-weight: ${face.weight};`)
      ?? [`src: local(${JSON.stringify(name)});`];
    return sources.map(source => `@font-face { font-family: ${aliases[index]}; ${source} font-display: swap; unicode-range: U+0000-024F, U+1E00-1EFF; }`);
  }).join('\n');
  return { family: [...aliases, visualFontFamily(split.chinese.choice, split.chinese.customName)].join(', '), fontFaces };
}
