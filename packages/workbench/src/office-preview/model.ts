/** Inert, structured-cloneable reading model. No document HTML, URLs or executable content. */
export interface OfficeRun { text: string; bold?: boolean; italic?: boolean; underline?: boolean }
export type OfficeBlock =
  | { kind: 'paragraph'; runs: OfficeRun[]; heading?: number }
  | { kind: 'table'; rows: { blocks: OfficeBlock[]; colspan: number }[][] }
  | { kind: 'image'; src: string; alt: string };
export interface OfficePage { name: string; blocks: OfficeBlock[] }
export interface OfficeSheet { name: string; rows: string[][]; columns: number; truncated: boolean }
export type OfficePreview =
  | { kind: 'spreadsheet'; sheets: OfficeSheet[] }
  | { kind: 'document'; pages: OfficePage[]; legacy: boolean }
  | { kind: 'presentation'; pages: OfficePage[]; legacy: boolean };
export const officeLimits = {
  fileBytes: 50 * 1024 * 1024, expandedBytes: 100 * 1024 * 1024,
  entryBytes: 20 * 1024 * 1024, entries: 2000,
  pages: 1000, sheets: 200, rows: 10000, columns: 200, cells: 500000,
  blocks: 50000, characters: 5_000_000, imageBytes: 5 * 1024 * 1024,
};
export const officeErrors = {
  invalid: 'Office 文件损坏或内容与扩展名不符。',
  encrypted: '暂不支持预览加密或受密码保护的 Office 文件，请解密后重试。',
  limit: 'Office 文件超过预览处理上限，请导出后查看。',
  legacy: '暂不支持此旧版 Office 文件的编码，请另存为新版格式后查看。',
  timeout: 'Office 文件解析超时，请导出后查看。',
};
export function paragraphs(text: string): OfficeBlock[] {
  // Field instructions must not be exposed as document content. Retain field results.
  const fields: boolean[] = [];
  let result = '';
  for (const char of text) {
    if (char === '\x13') { fields.push(false); continue; }
    if (char === '\x14') { if (fields.length) fields[fields.length - 1] = true; continue; }
    if (char === '\x15') { fields.pop(); continue; }
    if (fields.some(shown => !shown)) continue;
    result += char;
  }
  return result.replace(/[\r\v\f]/g, '\n').replace(/\x07/g, '\t')
    .replace(/[\x00-\x06\x08\x0e-\x1f]/g, '').split('\n')
    .filter(line => line.trim()).map(text => ({ kind: 'paragraph', runs: [{ text }] }));
}
