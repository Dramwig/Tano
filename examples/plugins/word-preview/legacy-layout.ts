import * as CFB from 'cfb';

/** MS-DOC PlcfSed/SEPX: source page dimensions and margins, in twips.
 * https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/6777a859-d537-486b-96c7-fb0c959a5bf9
 */
export function legacyLayout(bytes: Uint8Array) {
  const file = CFB.read(bytes, { type: 'array' });
  const stream = (name: string) => {
    const entry = CFB.find(file, `/${name}`);
    if (!entry || entry.type !== 2) throw new Error('不是有效的 Word 文档');
    const content = Uint8Array.from(entry.content);
    return new DataView(content.buffer);
  };
  const word = stream('WordDocument');
  if (word.getUint16(0, true) !== 0xa5ec || word.getUint16(2, true) < 0xc1) throw new Error('此旧版 Word 格式暂不支持');
  if (word.getUint16(10, true) & 0x8100) throw new Error('请先在 Word 中解除文件密码');
  let pos = 34 + word.getUint16(32, true) * 2;
  pos += 2 + word.getUint16(pos, true) * 4;
  if (word.getUint16(pos, true) < 7) throw new Error('Word 分节信息无效');
  pos += 2 + 6 * 8;
  const table = stream(word.getUint16(10, true) & 0x200 ? '1Table' : '0Table');
  const offset = word.getUint32(pos, true), length = word.getUint32(pos + 4, true);
  const sections = (length - 4) / 16;
  if (!Number.isInteger(sections) || sections < 1 || sections > 1000 || offset + length > table.byteLength) throw new Error('Word 分节信息无效');
  const geometry = { width: 12240, height: 15840, left: 1800, right: 1800, top: 1440, bottom: 1440, sections };
  const sepx = table.getUint32(offset + (sections + 1) * 4 + 2, true);
  if (sepx !== 0xffffffff) {
    const end = sepx + 2 + word.getUint16(sepx, true);
    if (end > word.byteLength) throw new Error('Word 分节信息无效');
    const keys: Record<number, 'width' | 'height' | 'left' | 'right' | 'top' | 'bottom'> = {
      0xb01f: 'width', 0xb020: 'height', 0xb021: 'left', 0xb022: 'right', 0x9023: 'top', 0x9024: 'bottom',
    };
    for (let cursor = sepx + 2; cursor < end;) {
      const sprm = word.getUint16(cursor, true); cursor += 2;
      const kind = sprm >>> 13;
      const size = kind === 6 ? 1 + word.getUint8(cursor) : [1, 1, 2, 4, 2, 2, 0, 3][kind]!;
      if (cursor + size > end) throw new Error('Word 分节属性无效');
      const key = keys[sprm];
      if (key) geometry[key] = Math.abs(sprm === 0x9023 || sprm === 0x9024 ? word.getInt16(cursor, true) : word.getUint16(cursor, true));
      cursor += size;
    }
  }
  if (geometry.width < 144 || geometry.height < 144 || geometry.width > 31680 || geometry.height > 31680 ||
    geometry.left + geometry.right >= geometry.width || geometry.top + geometry.bottom >= geometry.height) throw new Error('Word 页面尺寸无效');
  return geometry;
}
