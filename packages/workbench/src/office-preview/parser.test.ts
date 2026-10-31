import { expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { utils, write } from 'xlsx';
import * as CFB from 'cfb';
import { parseOffice } from './parser';
import { officeErrors, officeLimits } from './model';

const zip = (files: Record<string, string | Uint8Array>) => zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, typeof value === 'string' ? strToU8(value) : value])));
const rels = (body: string) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
const word = (body: string) => `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><w:body>${body}</w:body></w:document>`;

it.each(['xls', 'xlsx'] as const)('reads a real %s workbook with Chinese sheets, display formats, cached formulas and literal HTML', extension => {
  const book = utils.book_new();
  const sheet = utils.aoa_to_sheet([['项目', '金额'], ['同页', 42], ['<script>alert(1)</script>', 0.25]]);
  sheet.B3.z = '0%'; sheet.B2.f = '20+22';
  utils.book_append_sheet(book, sheet, '收入'); utils.book_append_sheet(book, utils.aoa_to_sheet([['第二张表']]), '说明');
  const source = new Uint8Array(write(book, { type: 'array', bookType: extension === 'xls' ? 'biff8' : 'xlsx' }));
  const before = source.slice(), result = parseOffice(source, extension);
  expect(source).toEqual(before);
  expect(result.kind).toBe('spreadsheet');
  if (result.kind !== 'spreadsheet') throw new Error('wrong preview');
  expect(result.sheets.map(sheet => sheet.name)).toEqual(['收入', '说明']);
  expect(result.sheets[0].rows).toEqual([['项目', '金额'], ['同页', '42'], ['<script>alert(1)</script>', '25%']]);
  expect(result.sheets[0].truncated).toBe(false);
});

it('flags spreadsheet truncation instead of silently omitting out-of-range content', () => {
  const book = utils.book_new();
  const sheet = utils.aoa_to_sheet([['开始']]); sheet.A10002 = { t: 's', v: '超限行' }; sheet['!ref'] = 'A1:A10002';
  utils.book_append_sheet(book, sheet, '大表');
  const result = parseOffice(new Uint8Array(write(book, { type: 'array', bookType: 'xlsx' })), 'xlsx');
  expect(result.kind === 'spreadsheet' && result.sheets[0]).toMatchObject({ truncated: true });
  expect(result.kind === 'spreadsheet' && result.sheets[0].rows.length).toBe(officeLimits.rows);
});

it.each(['xls', 'xlsx'] as const)('preserves saved %s column widths and defaults missing widths', extension => {
  const book = utils.book_new();
  const sized = utils.aoa_to_sheet([['项目', '金额', '状态']]);
  sized['!cols'] = [{ wpx: 160 }, { wpx: 90 }];
  utils.book_append_sheet(book, sized, '有列宽');
  utils.book_append_sheet(book, utils.aoa_to_sheet([['默认']]), '默认列宽');
  const result = parseOffice(new Uint8Array(write(book, { type: 'array', bookType: extension === 'xls' ? 'biff8' : 'xlsx' })), extension);
  if (result.kind !== 'spreadsheet') throw new Error('wrong preview');
  expect(result.sheets[0].columnWidths).toEqual([160, 90, 72]);
  expect(result.sheets[1].columnWidths).toEqual([72]);
});

it('reads DOCX heading, formatted text, tables and embedded raster images as inert blocks', () => {
  const bytes = zip({ 'word/document.xml': word('<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>中文标题</w:t></w:r></w:p>' +
    '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格单元格</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
    '<w:p><w:r><w:drawing><a:blip r:embed="rImage"/></w:drawing></w:r></w:p>' +
    '<w:del><w:p><w:r><w:t>已删除文字</w:t></w:r></w:p></w:del>' +
    '<w:p><w:hyperlink r:id="rEvil"><w:r><w:t>&lt;script&gt;alert(1)&lt;/script&gt;</w:t></w:r></w:hyperlink><w:r><w:instrText>EXTERNAL FIELD</w:instrText></w:r></w:p>'),
    'word/_rels/document.xml.rels': rels('<Relationship Id="rImage" Target="media/pixel.png"/><Relationship Id="rEvil" Target="https://example.invalid/secret" TargetMode="External"/>'),
    'word/media/pixel.png': Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
  });
  const result = parseOffice(bytes, 'docx');
  expect(result.kind === 'document' && result.pages[0].blocks).toMatchObject([
    { kind: 'paragraph', heading: 1, runs: [{ text: '中文标题', bold: true }] },
    { kind: 'table', rows: [[{ blocks: [{ kind: 'paragraph', runs: [{ text: '表格单元格' }] }] }]] },
    { kind: 'image', src: 'data:image/png;base64,iVBORw0KGgo=' },
    { kind: 'paragraph', runs: [{ text: '<script>alert(1)</script>' }] },
  ]);
  expect(JSON.stringify(result)).not.toMatch(/已删除文字|EXTERNAL FIELD|https:/);
});

it('resolves PPTX slide order through relationship IDs, retains tables and ignores linked resources', () => {
  const slide = (text: string) => `<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp><p:pic><p:blipFill><a:blip r:embed="external"/></p:blipFill></p:pic><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>数据</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></p:spTree></p:cSld></p:sld>`;
  const result = parseOffice(zip({
    'ppt/presentation.xml': '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="second"/><p:sldId id="257" r:id="first"/></p:sldIdLst></p:presentation>',
    'ppt/_rels/presentation.xml.rels': rels('<Relationship Id="first" Target="slides/slide1.xml"/><Relationship Id="second" Target="slides/slide2.xml"/>'),
    'ppt/slides/slide1.xml': slide('第二页'), 'ppt/slides/slide2.xml': slide('第一页'),
    'ppt/slides/_rels/slide2.xml.rels': rels('<Relationship Id="external" Target="https://example.invalid/image" TargetMode="External"/>'),
  }), 'pptx');
  expect(result.kind === 'presentation' && result.pages.map(page => page.blocks[0])).toMatchObject([
    { runs: [{ text: '第一页' }] }, { runs: [{ text: '第二页' }] },
  ]);
  expect(result.kind === 'presentation' && result.pages[0].blocks[1]).toMatchObject({ kind: 'table' });
  expect(JSON.stringify(result)).not.toContain('https:');
});

function container(files: Record<string, Uint8Array>) {
  const file = CFB.utils.cfb_new();
  for (const [name, bytes] of Object.entries(files)) CFB.utils.cfb_add(file, name, bytes);
  return new Uint8Array(CFB.write(file, { type: 'array' }));
}
function legacyWordFixture(encrypted = false) {
  // MS-DOC FIB + CLX with two pieces: compressed Western text and UTF-16 Chinese.
  const body = new Uint8Array(1024), fib = new DataView(body.buffer);
  fib.setUint16(0, 0xa5ec, true); fib.setUint16(2, 0xc1, true); fib.setUint16(10, encrypted ? 0x100 : 0x200, true);
  fib.setUint16(32, 14, true); fib.setUint16(62, 22, true); fib.setUint32(76, 11, true); fib.setUint16(152, 93, true);
  fib.setUint32(418, 0, true); fib.setUint32(422, 33, true);
  body.set(strToU8('Hello\r'), 900);
  const unicode = '中文正文\r'; for (let i = 0; i < unicode.length; i++) fib.setUint16(920 + i * 2, unicode.charCodeAt(i), true);
  const table = new Uint8Array(33), pieces = new DataView(table.buffer);
  table[0] = 2; pieces.setUint32(1, 28, true);
  pieces.setUint32(5, 0, true); pieces.setUint32(9, 6, true); pieces.setUint32(13, 11, true);
  pieces.setUint32(19, 0x40000000 | 1800, true); pieces.setUint32(27, 920, true);
  return container({ WordDocument: body, '1Table': table });
}
it('reads legacy DOC through mixed-encoding pieces without guessing byte offsets', () => {
  const result = parseOffice(legacyWordFixture(), 'doc');
  expect(result.kind === 'document' && result.pages[0].blocks).toEqual([
    { kind: 'paragraph', runs: [{ text: 'Hello' }] }, { kind: 'paragraph', runs: [{ text: '中文正文' }] },
  ]);
});
it('recognizes legacy Word encryption', () => expect(() => parseOffice(legacyWordFixture(true), 'doc')).toThrow(officeErrors.encrypted));

function pptRecord(type: number, data: Uint8Array, flags = 0) {
  const result = new Uint8Array(data.length + 8), header = new DataView(result.buffer);
  header.setUint16(0, flags, true); header.setUint16(2, type, true); header.setUint32(4, data.length, true); result.set(data, 8); return result;
}
function concat(...parts: Uint8Array[]) { const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; } return result; }
function u32(...values: number[]) { const result = new Uint8Array(values.length * 4), data = new DataView(result.buffer); values.forEach((value, index) => data.setUint32(index * 4, value, true)); return result; }
function legacyPptFixture() {
  const persist = pptRecord(1011, u32(2, 0, 1, 256, 0));
  const doc = pptRecord(1000, pptRecord(4080, persist, 15), 15);
  const slide = (text: string) => pptRecord(1006, pptRecord(4008, strToU8(text)), 15);
  const oldSlide = slide('OBSOLETE TEXT'), latestSlide = slide('Current slide');
  const oldDirectoryOffset = doc.length + oldSlide.length;
  const oldDirectory = pptRecord(6002, u32((2 << 20) | 1, 0, doc.length));
  const oldEditOffset = oldDirectoryOffset + oldDirectory.length;
  const oldEdit = pptRecord(4085, u32(0, 0, 0, oldDirectoryOffset, 1, 3, 0));
  const latestSlideOffset = oldEditOffset + oldEdit.length;
  const directoryOffset = latestSlideOffset + latestSlide.length;
  const directory = pptRecord(6002, u32((1 << 20) | 2, latestSlideOffset));
  const editOffset = directoryOffset + directory.length;
  const edit = pptRecord(4085, u32(0, 0, oldEditOffset, directoryOffset, 1, 3, 0));
  const current = pptRecord(4086, u32(20, 0xe391c05f, editOffset, 0, 0));
  return container({ 'PowerPoint Document': concat(doc, oldSlide, oldDirectory, oldEdit, latestSlide, directory, edit), 'Current User': current });
}
it('reads only the latest legacy PPT edit and never revives obsolete slide text', () => {
  const result = parseOffice(legacyPptFixture(), 'ppt');
  expect(result.kind === 'presentation' && result.pages).toHaveLength(1);
  expect(JSON.stringify(result)).toContain('Current slide'); expect(JSON.stringify(result)).not.toContain('OBSOLETE');
});

it('rejects wrong signatures, malformed XML, DTDs, traversal, encrypted OpenXML and oversized input', () => {
  for (const extension of ['xls', 'xlsx', 'doc', 'docx', 'ppt', 'pptx']) expect(() => parseOffice(strToU8('<script>not office</script>'), extension)).toThrow(officeErrors.invalid);
  for (const body of ['<broken>', '<!DOCTYPE document [<!ENTITY x "secret">]><document>&x;</document>'])
    expect(() => parseOffice(zip({ 'word/document.xml': body }), 'docx')).toThrow(officeErrors.invalid);
  expect(() => parseOffice(zip({ '../escape.xml': 'x' }), 'docx')).toThrow(officeErrors.invalid);
  expect(() => parseOffice(container({ EncryptedPackage: new Uint8Array(20) }), 'docx')).toThrow(officeErrors.encrypted);
  expect(() => parseOffice(new Uint8Array(officeLimits.fileBytes + 1), 'doc')).toThrow(officeErrors.limit);
  expect(() => parseOffice(zip({ 'word/document.xml': new Uint8Array(officeLimits.entryBytes + 1) }), 'docx')).toThrow(officeErrors.limit);
});
