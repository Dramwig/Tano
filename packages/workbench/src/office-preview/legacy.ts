import * as CFB from 'cfb';
import { officeErrors, officeLimits, paragraphs, type OfficePage, type OfficePreview } from './model';

export function compound(bytes: Uint8Array) {
  const file = CFB.read(bytes, { type: 'array' });
  if (CFB.find(file, '/EncryptedPackage')) throw new Error(officeErrors.encrypted);
  return file;
}
function stream(file: CFB.CFB$Container, name: string): Uint8Array {
  const entry = CFB.find(file, `/${name}`);
  if (!entry || entry.type !== 2) throw new Error(officeErrors.invalid);
  return Uint8Array.from(entry.content);
}
function view(bytes: Uint8Array) { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
function bounds(bytes: Uint8Array, start: number, length: number) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0 || start + length > bytes.length)
    throw new Error(officeErrors.invalid);
}
export function legacyWord(file: CFB.CFB$Container): OfficePreview {
  const bytes = stream(file, 'WordDocument');
  bounds(bytes, 0, 34);
  const fib = view(bytes);
  if (fib.getUint16(0, true) !== 0xa5ec) throw new Error(officeErrors.invalid);
  if (fib.getUint16(10, true) & 0x8100) throw new Error(officeErrors.encrypted);
  if (fib.getUint16(2, true) < 0xc1) throw new Error(officeErrors.legacy);
  let position = 34 + fib.getUint16(32, true) * 2;
  bounds(bytes, position, 2);
  const words = fib.getUint16(position, true); position += 2;
  bounds(bytes, position, words * 4 + 2);
  if (words < 4) throw new Error(officeErrors.invalid);
  const characters = fib.getUint32(position + 12, true);
  if (characters > officeLimits.characters) throw new Error(officeErrors.limit);
  position += words * 4;
  const pairs = fib.getUint16(position, true); position += 2;
  if (pairs <= 33) throw new Error(officeErrors.invalid);
  bounds(bytes, position, pairs * 8);
  const clxOffset = fib.getUint32(position + 33 * 8, true), clxSize = fib.getUint32(position + 33 * 8 + 4, true);
  const table = stream(file, fib.getUint16(10, true) & 0x200 ? '1Table' : '0Table');
  bounds(table, clxOffset, clxSize);
  const tableView = view(table);
  let cursor = clxOffset;
  while (cursor < clxOffset + clxSize && table[cursor] === 1) {
    bounds(table, cursor + 1, 2); cursor += 3 + tableView.getUint16(cursor + 1, true);
  }
  bounds(table, cursor, 5);
  if (table[cursor] !== 2) throw new Error(officeErrors.invalid);
  const size = tableView.getUint32(cursor + 1, true), count = (size - 4) / 12;
  if (!Number.isInteger(count) || count < 0 || cursor + 5 + size > clxOffset + clxSize) throw new Error(officeErrors.invalid);
  const start = cursor + 5;
  bounds(table, start, size);
  let text = '', covered = 0;
  for (let index = 0; index < count && covered < characters; index++) {
    const from = tableView.getUint32(start + index * 4, true), to = tableView.getUint32(start + (index + 1) * 4, true);
    if (from !== covered || to < from) throw new Error(officeErrors.invalid);
    const length = Math.min(to, characters) - from;
    const compressedOffset = tableView.getUint32(start + (count + 1) * 4 + index * 8 + 2, true);
    const compressed = !!(compressedOffset & 0x40000000);
    const offset = (compressedOffset & 0x3fffffff) / (compressed ? 2 : 1);
    bounds(bytes, offset, length * (compressed ? 1 : 2));
    text += new TextDecoder(compressed ? 'windows-1252' : 'utf-16le').decode(bytes.subarray(offset, offset + length * (compressed ? 1 : 2)));
    covered = Math.min(to, characters);
  }
  if (covered !== characters) throw new Error(officeErrors.invalid);
  const blocks = paragraphs(text), pages: OfficePage[] = [];
  for (let offset = 0; offset < blocks.length; offset += 200) pages.push({ name: '', blocks: blocks.slice(offset, offset + 200) });
  return { kind: 'document', pages: pages.length ? pages : [{ name: '', blocks: [] }], legacy: true };
}

interface RecordHeader { type: number; instance: number; container: boolean; start: number; end: number }
function record(bytes: Uint8Array, offset: number, end = bytes.length): RecordHeader {
  bounds(bytes, offset, 8);
  const data = view(bytes), flags = data.getUint16(offset, true), size = data.getUint32(offset + 4, true);
  if (offset + 8 + size > end) throw new Error(officeErrors.invalid);
  return { type: data.getUint16(offset + 2, true), instance: flags >> 4, container: (flags & 15) === 15,
    start: offset + 8, end: offset + 8 + size };
}
function records(bytes: Uint8Array, start: number, end: number): RecordHeader[] {
  const result: RecordHeader[] = [];
  while (start < end) { const item = record(bytes, start, end); result.push(item); start = item.end; }
  return result;
}
/** Follow the current edit's persist directory; obsolete/deleted slide text must never leak into a preview. */
export function legacyPresentation(file: CFB.CFB$Container): OfficePreview {
  const bytes = stream(file, 'PowerPoint Document'), current = stream(file, 'Current User');
  bounds(current, 0, 20);
  const currentView = view(current), data = view(bytes);
  if (currentView.getUint32(12, true) === 0xf3d1c4df) throw new Error(officeErrors.encrypted);
  if (currentView.getUint32(12, true) !== 0xe391c05f) throw new Error(officeErrors.invalid);
  let offset = currentView.getUint32(16, true), documentId = 0;
  const directory = new Map<number, number>(), visited = new Set<number>();
  while (offset) {
    if (visited.has(offset) || visited.size >= 1000) throw new Error(officeErrors.invalid);
    visited.add(offset);
    const edit = record(bytes, offset);
    if (edit.type !== 4085 || edit.end - edit.start < 28) throw new Error(officeErrors.invalid);
    if (edit.end - edit.start >= 32 && data.getUint32(edit.start + 28, true)) throw new Error(officeErrors.encrypted);
    if (!documentId) documentId = data.getUint32(edit.start + 16, true);
    const persist = record(bytes, data.getUint32(edit.start + 12, true));
    if (![6001, 6002].includes(persist.type)) throw new Error(officeErrors.invalid);
    let cursor = persist.start;
    while (cursor < persist.end) {
      bounds(bytes, cursor, 4);
      const header = data.getUint32(cursor, true), first = header & 0xfffff, count = header >>> 20;
      cursor += 4;
      if (!count || cursor + count * 4 > persist.end) throw new Error(officeErrors.invalid);
      for (let index = 0; index < count; index++) if (!directory.has(first + index)) directory.set(first + index, data.getUint32(cursor + index * 4, true));
      cursor += count * 4;
    }
    const previous = data.getUint32(edit.start + 8, true);
    if (previous >= offset) throw new Error(officeErrors.invalid);
    offset = previous;
  }
  const documentOffset = directory.get(documentId);
  if (documentOffset === undefined) throw new Error(officeErrors.invalid);
  const document = record(bytes, documentOffset);
  if (document.type !== 1000) throw new Error(officeErrors.invalid);
  const list = records(bytes, document.start, document.end).find(item => item.type === 4080 && item.instance === 0);
  if (!list) throw new Error(officeErrors.invalid);
  const slides: { persistId: number; text: string[] }[] = [];
  let active: (typeof slides)[number] | undefined;
  function atomText(item: RecordHeader) {
    if (item.type === 4000 || item.type === 4008) return new TextDecoder(item.type === 4000 ? 'utf-16le' : 'windows-1252').decode(bytes.subarray(item.start, item.end));
    return '';
  }
  for (const item of records(bytes, list.start, list.end)) {
    if (item.type === 1011) {
      if (item.end - item.start < 20) throw new Error(officeErrors.invalid);
      active = { persistId: data.getUint32(item.start, true), text: [] }; slides.push(active);
    } else { const text = atomText(item); if (text && active) active.text.push(text); }
  }
  if (!slides.length || slides.length > officeLimits.pages) throw new Error(officeErrors.limit);
  function shapeText(item: RecordHeader, texts: string[], depth = 0) {
    if (depth > 64) throw new Error(officeErrors.limit);
    const text = atomText(item);
    if (text) texts.push(text);
    // ClientTextbox (500D) is an OfficeArt container whose low version nibble can be zero.
    else if (item.container || item.type === 0xf00d) for (const child of records(bytes, item.start, item.end)) shapeText(child, texts, depth + 1);
  }
  const pages = slides.map(slide => {
    const slideOffset = directory.get(slide.persistId);
    if (slideOffset === undefined) throw new Error(officeErrors.invalid);
    const item = record(bytes, slideOffset);
    if (item.type !== 1006) throw new Error(officeErrors.invalid);
    const texts = [...slide.text]; shapeText(item, texts);
    return { name: '', blocks: paragraphs(texts.join('\n')) };
  });
  return { kind: 'presentation', pages, legacy: true };
}
