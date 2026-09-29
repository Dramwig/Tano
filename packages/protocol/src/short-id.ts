/** Reference IDs are six lowercase hexadecimal digits; workspace/session IDs are separate. */
export const shortIdPattern = '^[0-9a-f]{6}$';
export const isShortId = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{6}$/.test(value);

/** The caller must atomically claim the result in its persistent workspace namespace. */
export function newShortId(occupied: ReadonlySet<string> = new Set()): string {
  for (let attempt = 0; attempt < 256; attempt++) {
    const bytes = crypto.getRandomValues(new Uint8Array(3));
    const id = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (!occupied.has(id)) return id;
  }
  throw new Error('无法分配未占用的短 ID，请稍后重试');
}
