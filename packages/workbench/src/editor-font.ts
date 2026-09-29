export type VisualFontChoice = 'system' | 'serif' | 'mono' | 'custom';

const systemFontFamily =
  "'Inter Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif";
const serifFontFamily =
  'Literata, Georgia, ui-serif, serif';
const monoFontFamily =
  "'Maple Mono NF', 'Cascadia Code', 'Microsoft YaHei', ui-monospace, monospace";

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
