// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { displacementMap, interiorMask, LiquidGlassController, refractionProfile, rimScale, rimStrips, rimThickness, specularMap, supportsLiquidRefraction, surfaceBezel } from './liquid-glass';

const at = (map: ReturnType<typeof displacementMap>, x: number, y: number) => {
  const offset = (Math.floor(y * map.height) * map.width + Math.floor(x * map.width)) * 4;
  return [map.data[offset]!, map.data[offset + 1]!, map.data[offset + 3]!];
};

it('refracts like a squircle lens: strongest just inside the edge, nothing on the plateau', () => {
  const profile = refractionProfile(24, 36, 1.5);
  const peak = profile.indexOf(Math.max(...profile));
  expect(peak).toBeGreaterThan(0);
  expect(peak).toBeLessThan(profile.length / 4);
  expect(profile[profile.length - 1]!).toBeLessThan(0.1);
  expect([...profile].every(value => value >= 0)).toBe(true);
});

it('leaves the middle of the glass undistorted and pulls the rim in from the inside', () => {
  const map = displacementMap({ width: 400, height: 200, radius: 24, bezel: 24 });
  expect([map.width, map.height]).toEqual([400, 200]);
  expect(map.scale).toBeGreaterThan(10);
  expect(at(map, 0.5, 0.5)).toEqual([128, 128, 255]);
  // Inward: the left rim samples to the right, the top rim downwards, and so on.
  const [leftX, leftY] = at(map, 0.01, 0.5), [rightX] = at(map, 0.99, 0.5);
  const [, topY] = at(map, 0.5, 0.02), [, bottomY] = at(map, 0.5, 0.98);
  expect(leftX).toBeGreaterThan(200); expect(leftY).toBe(128);
  expect(rightX).toBeLessThan(56);
  expect(topY).toBeGreaterThan(200); expect(bottomY).toBeLessThan(56);
  const [cornerX, cornerY] = at(map, 0.02, 0.04);
  expect(cornerX).toBeGreaterThan(128); expect(cornerY).toBeGreaterThan(128);
});

it('has no bezel or highlight on edges that join something else', () => {
  const shape = { width: 400, height: 200, radius: 8, bezel: 24, edges: { top: false, right: false, bottom: false, left: true } };
  const map = displacementMap(shape);
  expect(at(map, 0.5, 0).slice(0, 2)).toEqual([128, 128]);
  expect(at(map, 0.999, 0.5).slice(0, 2)).toEqual([128, 128]);
  expect(at(map, 0.01, 0.5)[0]).toBeGreaterThan(200);
  const shine = specularMap(shape, { light: -135, strength: 1 });
  const alpha = (x: number, y: number) => shine.data[(y * shine.width + x) * 4 + 3]!;
  expect(alpha(200, 0)).toBe(0);
  expect(alpha(0, 100)).toBeGreaterThan(60);
  expect(alpha(200, 100)).toBe(0);
  expect(interiorMask({ top: false, right: false, bottom: false, left: true })).toBe(
    'linear-gradient(to right, rgb(0 0 0 / .25) 0, rgb(0 0 0 / .62) calc(var(--liquid-rim) / 2), #000 var(--liquid-rim), #000 100%), '
    + 'linear-gradient(to bottom, #000 0, #000 100%)');
});

it('lights the rim facing the top-left light more than the side edges', () => {
  const shine = specularMap({ width: 300, height: 200, radius: 20, bezel: 20 }, { light: -135, strength: 1 });
  const alpha = (x: number, y: number) => shine.data[(y * shine.width + x) * 4 + 3]!;
  // Top-left corner faces the light; the top-right corner is side-on.
  const lit = alpha(Math.round(20 - 20 * Math.SQRT1_2), Math.round(20 - 20 * Math.SQRT1_2));
  const side = alpha(Math.round(280 + 20 * Math.SQRT1_2) - 1, Math.round(20 - 20 * Math.SQRT1_2));
  expect(lit).toBeGreaterThan(side);
});

it('keeps the bezel near the corner radius and inside the surface; caps huge sheets', () => {
  expect(surfaceBezel(24, 12, 400, 400)).toBe(20);
  expect(surfaceBezel(24, 40, 400, 400)).toBe(24);
  expect(surfaceBezel(24, 40, 400, 20)).toBe(10);
  expect(displacementMap({ width: 800, height: 9000, radius: 4, bezel: 24 }).height).toBe(2048);
});

it('puts the refraction on thin rim strips that hold the whole bend and never overlap', () => {
  const strips = rimStrips(400, 200, 40);
  expect(strips.map(strip => strip.side)).toEqual(['top', 'bottom', 'left', 'right']);
  expect(strips.reduce((area, strip) => area + strip.width * strip.height, 0)).toBe(400 * 40 * 2 + 40 * 120 * 2);
  // A joined top edge has no strip; the sides then run up to it.
  const joined = rimStrips(400, 200, 40, { top: false, right: true, bottom: true, left: true });
  expect(joined.map(strip => strip.side)).toEqual(['bottom', 'left', 'right']);
  expect(joined.find(strip => strip.side === 'left')).toMatchObject({ y: 0, height: 160 });
  // Deep enough for the furthest inward sample, so a strip never samples outside itself.
  const shift = rimScale(20, 30) / 2 * 1.3 * 1.06;
  expect(rimThickness(12, 20, shift)).toBeGreaterThanOrEqual(20 + shift);
  // A strip's map is exactly that part of the whole surface's map.
  const shape = { width: 300, height: 160, radius: 16, bezel: 20 };
  const whole = displacementMap(shape), part = displacementMap(shape, { x: 0, y: 120, width: 300, height: 40 });
  expect(part.scale).toBeCloseTo(whole.scale);
  for (const [x, y] of [[5, 10], [150, 38], [298, 39]] as const) {
    const a = (y * part.width + x) * 4, b = ((120 + y) * whole.width + x) * 4;
    expect([part.data[a], part.data[a + 1]]).toEqual([whole.data[b], whole.data[b + 1]]);
  }
});

it('draws one pane per glass surface in the backdrop layer, with rim strips only where glass is free', async () => {
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
  const pane = document.querySelector<HTMLElement>('.liquid-pane')!;
  expect(root.hasAttribute('data-liquid-refraction')).toBe(true);
  expect(card.dataset.liquidGlass).toBeDefined();
  expect([pane.style.left, pane.style.top, pane.style.width, pane.style.height]).toEqual(['300px', '40px', '800px', '600px']);
  // A card with no selected tab has four free edges.
  // Lens (bent, unblurred) under the pane, highlight over it, all in the same place.
  const lens = pane.previousElementSibling as HTMLElement, shine = pane.nextElementSibling as HTMLElement;
  expect([lens.className, shine.className]).toEqual(['liquid-lens', 'liquid-shine-layer']);
  expect([lens.style.left, shine.style.width]).toEqual(['300px', '800px']);
  expect(pane.style.getPropertyValue('mask-image')).toContain('linear-gradient(to bottom, transparent 0, ');
  const strips = [...lens.querySelectorAll<HTMLElement>('.liquid-rim')];
  expect(strips).toHaveLength(4);
  for (const strip of strips) expect(strip.style.getPropertyValue('backdrop-filter')).toMatch(/^url\("?#tano-liquid-\d+-(top|bottom|left|right)"?\)$/);
  controller.dispose();
  expect(document.querySelector('.liquid-pane')).toBeNull();
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
