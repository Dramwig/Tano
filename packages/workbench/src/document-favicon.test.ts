// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import { createDocumentFavicon, documentIconFavicon, useDocumentFavicon } from './document-favicon';

afterEach(() => {
  document.head.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]').forEach(link => link.remove());
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
function defaultIcon() {
  const link = document.createElement('link');
  link.rel = 'icon'; link.type = 'image/svg+xml'; link.href = '/brand.svg';
  document.head.append(link);
  return link;
}
function currentIcon() { return document.head.querySelector<HTMLLinkElement>('link[rel~="icon"]')!; }

it('preserves uploaded PNG artwork and renders the selected built-in SVG instead of the default icon', async () => {
  const png = 'data:image/png;base64,aGVsbG8=';
  expect(await documentIconFavicon(png)).toEqual({ href: png, type: 'image/png' });
  const favicon = await documentIconFavicon('icon:book');
  expect(favicon?.type).toBe('image/svg+xml');
  const svg = new DOMParser().parseFromString(decodeURIComponent(favicon!.href.split(',')[1]!), 'image/svg+xml');
  expect(svg.querySelector('parsererror')).toBeNull();
  expect(svg.documentElement.getAttribute('class')).toContain('lucide-book-open');
  expect(svg.querySelectorAll('path').length).toBeGreaterThan(0);
  expect(await documentIconFavicon('icon:missing')).toBeNull();
  expect(await documentIconFavicon('data:text/html,<script>alert(1)</script>')).toBeNull();
});

it('uses the local emoji artwork and shares its decoded sheet across icon changes', async () => {
  const decode = vi.fn(async () => {});
  vi.stubGlobal('Image', class { src = ''; decode = decode; });
  const context = { drawImage: vi.fn(), fillText: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,cG5n');
  expect((await documentIconFavicon('😗'))?.type).toBe('image/png');
  await documentIconFavicon('🚀');
  expect(decode).toHaveBeenCalledOnce();
  expect(context.drawImage).toHaveBeenCalledTimes(2);
  expect(context.fillText).not.toHaveBeenCalled();
  await documentIconFavicon('自');
  expect(context.fillText).toHaveBeenCalledWith('自', 16, 17, 32);
});

it('ignores a stale image after changing documents or returning to the default icon', async () => {
  const original = defaultIcon();
  let finish!: (value: { href: string; type: string }) => void;
  const favicon = createDocumentFavicon(icon => icon === 'slow'
    ? new Promise(resolve => { finish = resolve; })
    : Promise.resolve({ href: '/fast.png', type: 'image/png' }));
  const slow = favicon.update('slow');
  await favicon.update('fast');
  expect(currentIcon().getAttribute('href')).toBe('/fast.png');
  finish({ href: '/slow.png', type: 'image/png' }); await slow;
  expect(currentIcon().getAttribute('href')).toBe('/fast.png');
  const late = favicon.update('slow');
  await favicon.update('');
  finish({ href: '/late.png', type: 'image/png' }); await late;
  expect(currentIcon()).toBe(original);
  const disposed = favicon.update('slow'); favicon.dispose();
  finish({ href: '/disposed.png', type: 'image/png' }); await disposed;
  expect(currentIcon()).toBe(original);
});

it('restores all original favicon links on image failure and disposal without changing touch icons', async () => {
  const original = defaultIcon();
  original.setAttribute('sizes', '32x32'); original.media = '(prefers-color-scheme: light)';
  const dark = original.cloneNode() as HTMLLinkElement;
  dark.href = '/brand-dark.svg'; dark.media = '(prefers-color-scheme: dark)'; document.head.append(dark);
  const touch = document.createElement('link'); touch.rel = 'apple-touch-icon'; touch.href = '/touch.png'; document.head.append(touch);
  const render = vi.fn(async () => ({ href: '/custom.png', type: 'image/png' }));
  const favicon = createDocumentFavicon(render);
  await favicon.update('custom');
  expect(document.head.querySelectorAll('link[rel~="icon"]')).toHaveLength(1);
  expect(touch.isConnected).toBe(true);
  render.mockRejectedValueOnce(new Error('decode failed'));
  await favicon.update('broken');
  expect([...document.head.querySelectorAll('link[rel~="icon"]')]).toEqual([original, dark]);
  expect(original.getAttribute('sizes')).toBe('32x32');
  await favicon.update('custom'); favicon.dispose();
  await favicon.update('late');
  expect([...document.head.querySelectorAll('link[rel~="icon"]')]).toEqual([original, dark]);
});

it('follows reactive page icon changes and restores the host favicon on unmount', async () => {
  const original = defaultIcon();
  const icon = ref('icon:book');
  const root = document.createElement('div');
  const app = createApp({ setup() { useDocumentFavicon(() => icon.value); return () => h('div'); } });
  app.mount(root);
  await vi.waitFor(() => expect(currentIcon().type).toBe('image/svg+xml'));
  await vi.waitFor(() => expect(currentIcon()).not.toBe(original));
  icon.value = 'data:image/png;base64,aGVsbG8=';
  await vi.waitFor(() => expect(currentIcon().type).toBe('image/png'));
  icon.value = ''; await nextTick();
  expect(currentIcon()).toBe(original);
  icon.value = 'icon:rocket'; await nextTick(); app.unmount();
  await nextTick();
  expect(currentIcon()).toBe(original);
});
