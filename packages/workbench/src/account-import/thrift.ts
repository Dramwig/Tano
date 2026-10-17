// Evernote's published EDAM API uses the Thrift binary protocol over HTTPS.
// Authentication is injected by the native host, never by this codec.
type Field = { type: number; value: unknown };
type Struct = Record<number, Field>;
export function thriftFields(fields: { id: number; type: number; value: unknown }[]): string {
  const bytes: number[] = [];
  function number(value: number, size: number) { for (let index = size - 1; index >= 0; index--) bytes.push((value / 2 ** (index * 8)) & 255); }
  function value(type: number, input: unknown) {
    if (type === 2) bytes.push(input ? 1 : 0);
    else if (type === 8) number(Number(input), 4);
    else if (type === 11) { const text = new TextEncoder().encode(String(input)); number(text.length, 4); bytes.push(...text); }
    else if (type === 12) struct(input as typeof fields);
    else throw new Error('不支持的 EDAM 请求类型');
  }
  function struct(items: typeof fields) { for (const item of items) { bytes.push(item.type); number(item.id, 2); value(item.type, item.value); } bytes.push(0); }
  struct(fields);
  return btoa(String.fromCharCode(...bytes));
}
export function thriftResult(encoded: string): unknown {
  const binary = atob(encoded), bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  const view = new DataView(bytes.buffer); let offset = 0, count = 0;
  function number(size: number) { if (offset + size > bytes.length) throw new Error('Evernote 响应不完整'); const result = size === 1 ? view.getUint8(offset) : size === 2 ? view.getInt16(offset) : view.getInt32(offset); offset += size; return result; }
  function value(type: number, depth = 0): unknown {
    if (depth > 100 || ++count > 1000000) throw new Error('Evernote 响应超过解析限制');
    if (type === 2 || type === 3) return number(1);
    if (type === 6) return number(2);
    if (type === 8) return number(4);
    if (type === 10 || type === 4) { if (offset + 8 > bytes.length) throw new Error('Evernote 响应不完整'); offset += 8; return null; }
    if (type === 11) { const length = number(4); if (length < 0 || offset + length > bytes.length) throw new Error('Evernote 字符串长度无效'); const text = new TextDecoder().decode(bytes.subarray(offset, offset + length)); offset += length; return text; }
    if (type === 12) { const result: Struct = {}; for (let field = number(1); field; field = number(1)) { const id = number(2); result[id] = { type: field, value: value(field, depth + 1) }; } return result; }
    if (type === 14 || type === 15) { const itemType = number(1), length = number(4); if (length < 0 || length > 100000) throw new Error('Evernote 列表长度无效'); return Array.from({ length }, () => value(itemType, depth + 1)); }
    if (type === 13) { const keyType = number(1), itemType = number(1), length = number(4); if (length < 0 || length > 100000) throw new Error('Evernote 映射长度无效'); return Array.from({ length }, () => [value(keyType, depth + 1), value(itemType, depth + 1)]); }
    throw new Error('Evernote 响应类型无效');
  }
  const version = number(4), messageType = version & 255;
  if ((version >>> 16) !== 0x8001) throw new Error('Evernote 协议版本无效');
  value(11); number(4);
  const result = value(12) as Struct;
  if (messageType !== 2 || !result[0]) throw new Error('Evernote 请求失败，请检查授权和访问权限');
  return result[0].value;
}
export const thriftField = (value: unknown, id: number) => (value as Struct | undefined)?.[id]?.value;
