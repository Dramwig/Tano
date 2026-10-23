export type VisualFontChoice = 'system' | 'serif' | 'mono' | 'custom';

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
const monoFontFamily =
  `'Maple Mono NF', 'Maple Mono NF CN', 'Cascadia Code', 'Sarasa Mono SC', 'Noto Sans Mono CJK SC', ${cjkSans}, ui-monospace, monospace`;

export function parseVisualFontChoice(value: string | null): VisualFontChoice {
  return value === 'serif' || value === 'mono' || value === 'custom' ? value : 'system';
}

export function sanitizeCustomFontName(value: string): string {
  return value.replace(/[^\p{L}\p{N} ._+\-]/gu, '').slice(0, 80);
}

export function visualFontFamily(choice: VisualFontChoice, customName: string): string {
  if (choice === 'serif') return serifFontFamily;
  if (choice === 'mono') return monoFontFamily;
  const name = sanitizeCustomFontName(customName).trim();
  return choice === 'custom' && name
    ? `${JSON.stringify(name)}, ${systemFontFamily}`
    : systemFontFamily;
}
