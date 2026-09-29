export type VisualFontChoice = 'system' | 'serif' | 'custom';

const systemFontFamily =
  "'Inter Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif";
const serifFontFamily =
  "ui-serif, Georgia, 'Songti SC', 'Noto Serif CJK SC', 'Source Han Serif SC', SimSun, serif";

export function parseVisualFontChoice(value: string | null): VisualFontChoice {
  return value === 'serif' || value === 'custom' ? value : 'system';
}

export function sanitizeCustomFontName(value: string): string {
  return value.replace(/[^\p{L}\p{N} ._+\-]/gu, '').slice(0, 80);
}

export function visualFontFamily(choice: VisualFontChoice, customName: string): string {
  if (choice === 'serif') return serifFontFamily;
  const name = sanitizeCustomFontName(customName).trim();
  return choice === 'custom' && name
    ? `${JSON.stringify(name)}, ${systemFontFamily}`
    : systemFontFamily;
}
