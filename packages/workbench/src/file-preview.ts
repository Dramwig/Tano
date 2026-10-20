import Papa from 'papaparse';
export function csvPreview(text: string, path: string) {
  const result = Papa.parse<string[]>(text, { delimiter: /\.tsv$/i.test(path) ? '\t' : ',', preview: 501, skipEmptyLines: true });
  return { rows: result.data.slice(0, 500).map(row => row.slice(0, 100)),
    truncated: result.data.length > 500 || result.meta.truncated || result.data.some(row => row.length > 100),
    error: result.errors.find(error => error.code === 'MissingQuotes')?.message };
}
/** Refuse misleading active content before handing bytes to a media renderer. */
export function verifyPreviewBytes(bytes: Uint8Array, type: string, mime: string) {
  const starts = (...signature: number[]) => signature.every((value, index) => bytes[index] === value);
  const ascii = new TextDecoder().decode(bytes.subarray(0, 1024));
  if (type === 'pdf' && !ascii.startsWith('%PDF-')) throw new Error('文件内容与 PDF 类型不符');
  if (type !== 'image') return;
  const valid = mime === 'image/png' ? starts(137, 80, 78, 71, 13, 10, 26, 10)
    : mime === 'image/jpeg' ? starts(255, 216, 255)
    : mime === 'image/gif' ? /^GIF8[79]a/.test(ascii)
    : mime === 'image/webp' ? ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP'
    : mime === 'image/bmp' ? ascii.startsWith('BM')
    : mime === 'image/avif' ? ascii.slice(4, 8) === 'ftyp' && /avif|avis/.test(ascii.slice(8, 40))
    : mime === 'image/svg+xml' ? /^(?:\s*<\?xml[^>]*>\s*)?(?:\s*<!--[\s\S]*?-->\s*)*\s*<svg[\s>]/i.test(ascii)
    : false;
  if (!valid) throw new Error('文件内容与图片类型不符');
}
