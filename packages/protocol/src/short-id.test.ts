import { afterEach, expect, it, vi } from 'vitest';
import { isShortId, newShortId } from './short-id';
afterEach(() => vi.restoreAllMocks());
it('retries occupied candidates and emits exactly six lowercase hex digits', () => {
  const random = vi.spyOn(crypto, 'getRandomValues');
  random.mockImplementationOnce((bytes) => {
    (bytes as Uint8Array).set([0xa8, 0x2f, 0x91]);
    return bytes;
  });
  random.mockImplementationOnce((bytes) => {
    (bytes as Uint8Array).set([0, 0, 1]);
    return bytes;
  });
  expect(newShortId(new Set(['a82f91']))).toBe('000001');
  expect(random).toHaveBeenCalledTimes(2);
  for (const value of ['A82F91', 'abc', 'usr_a82f91', crypto.randomUUID()])
    expect(isShortId(value)).toBe(false);
});
it('fails safely if repeated random collisions cannot be resolved', () => {
  vi.spyOn(crypto, 'getRandomValues').mockImplementation((bytes) => {
    (bytes as Uint8Array).fill(0);
    return bytes;
  });
  expect(() => newShortId(new Set(['000000']))).toThrow('短 ID');
});
