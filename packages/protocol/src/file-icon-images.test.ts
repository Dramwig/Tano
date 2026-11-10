import { expect, it } from 'vitest';
import { isFileIconImage, parseFileIconTheme } from './appearance';

const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH+QAAAAASUVORK5CYII=';

it('accepts embedded PNGs and retains artwork, light variants and attribution', () => {
  expect(isFileIconImage(pixel)).toBe(true);
  const theme = { id: 'test', label: 'Test', notice: 'Copyright\nMIT',
    icons: { note: { color: 'currentColor', paths: [], image: pixel, lightImage: pixel } }, file: 'note' };
  expect(parseFileIconTheme(theme)).toEqual(theme);
});

it('rejects remote images, SVG, oversized artwork, truncated PNGs and unbounded dimensions', () => {
  const large = Uint8Array.from(atob(pixel.slice(22)), char => char.charCodeAt(0));
  new DataView(large.buffer).setUint32(16, 4096);
  const encode = (bytes: Uint8Array) => `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
  for (const image of ['https://example.com/icon.png', 'data:image/svg+xml;base64,PHN2Zy8+',
    'data:image/png;base64,' + 'AAAA'.repeat(12000), pixel.slice(0, -4), encode(large), encode(large.slice(0, 33))]) {
    expect(isFileIconImage(image)).toBe(false);
    expect(() => parseFileIconTheme({ id: 'test', label: 'Test', icons: { note: { color: 'currentColor', paths: [], image } } })).toThrow();
  }
  expect(() => parseFileIconTheme({ id: 'test', label: 'Test', icons: { note: { color: 'currentColor', paths: [], lightImage: pixel } } })).toThrow();
});
