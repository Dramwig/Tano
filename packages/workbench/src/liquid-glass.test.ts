// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { glassMap, interiorMask, LiquidGlassController, supportsLiquidRefraction } from './liquid-glass';

it('softens a size-relative bevel around the rectangle or the combined tab and page outline', () => {
  const parse = (contour?: string) => new DOMParser().parseFromString(
    decodeURIComponent(glassMap(600, 76, 80, contour).split(',')[1]!), 'image/svg+xml');
  const capsule = parse();
  const center = capsule.querySelector('g[filter] > rect')!;
  expect(Number(center.getAttribute('x'))).toBeCloseTo(2.66);
  expect(center.parentElement!.getAttribute('opacity')).toBe('.93');
  expect(capsule.querySelector('feGaussianBlur')?.getAttribute('stdDeviation')).toBe('11');
  const contour = 'M0 30 H100 V0 H250 V30 H600 V76 H0 Z';
  const joined = parse(contour);
  expect(joined.querySelector('mask path')?.getAttribute('d')).toBe(contour);
  expect(joined.querySelector('g[filter] > rect')?.getAttribute('mask')).toBe('url(#core)');
  expect(interiorMask({ top: false, bottom: true, right: true, left: true })).toContain('to bottom, #000 0');
});

it('refracts the original backdrop through three channels and removes the filter on disposal', async () => {
  document.body.innerHTML = '<div class="app-shell"><div class="liquid-backdrop"></div>'
    + '<div class="workspace-native-tabs"><div class="workspace-card"></div></div></div>';
  const root = document.documentElement;
  root.dataset.material = 'builtin:liquid'; root.dataset.layout = 'islands';
  const card = document.querySelector<HTMLElement>('.workspace-card')!;
  const box = (x: number, y: number, width: number, height: number) => () => ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON() {} }) as DOMRect;
  card.getBoundingClientRect = box(300, 40, 800, 600);
  document.querySelector<HTMLElement>('.liquid-backdrop')!.getBoundingClientRect = box(0, 0, 1200, 800);
  const controller = new LiquidGlassController(document, true);
  controller.start();
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(root.hasAttribute('data-liquid-refraction')).toBe(true);
  expect(card.dataset.liquidGlass).toBeDefined();
  expect(document.querySelector('.liquid-pane')).toBeNull();
  const lens = document.querySelector<HTMLElement>('.liquid-lens')!;
  expect([lens.style.left, lens.style.top, lens.style.width, lens.style.height]).toEqual(['300px', '40px', '800px', '600px']);
  const filter = document.querySelector('filter')!;
  expect(lens.style.getPropertyValue('--liquid-filter')).toBe(`url(#${filter.id})`);
  expect([...filter.querySelectorAll('feDisplacementMap')].map(node => node.getAttribute('scale'))).toEqual(['-180', '-170', '-160']);
  expect(filter.querySelectorAll('feBlend[mode="screen"]')).toHaveLength(2);
  expect(filter.querySelector('feGaussianBlur')?.getAttribute('stdDeviation')).toBe('0.5');
  controller.dispose();
  expect(document.querySelector('filter')).toBeNull();
  expect(document.querySelector('.liquid-lens')).toBeNull();
  expect(card.hasAttribute('data-liquid-glass')).toBe(false);
  document.body.innerHTML = '';
  delete root.dataset.layout;
});

it('stays off where SVG backdrop filters are unsupported', () => {
  const fake = (userAgent: string, supports: boolean) => ({ navigator: { userAgent }, CSS: { supports: () => supports } }) as unknown as Window & typeof globalThis;
  expect(supportsLiquidRefraction(fake('Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', true))).toBe(false);
  expect(supportsLiquidRefraction(fake('Mozilla/5.0 Gecko/20100101 Firefox/140.0', true))).toBe(false);
  expect(supportsLiquidRefraction(fake('Mozilla/5.0 AppleWebKit/537.36 Chrome/140.0 Safari/537.36 Edg/140.0', true))).toBe(true);
  expect(supportsLiquidRefraction(fake('Mozilla/5.0 AppleWebKit/537.36 Chrome/140.0 Safari/537.36', false))).toBe(false);
  document.documentElement.dataset.material = 'builtin:liquid';
  const controller = new LiquidGlassController(document, false);
  controller.start();
  expect(document.documentElement.hasAttribute('data-liquid-refraction')).toBe(false);
  controller.dispose();
});

afterEach(() => { delete document.documentElement.dataset.material; });
