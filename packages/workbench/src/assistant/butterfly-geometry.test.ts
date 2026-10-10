// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { measureButterflyTarget } from './butterfly';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
function fixture() {
  const clip = document.createElement('div'), element = document.createElement('button');
  clip.append(element); document.body.append(clip);
  let rect = new DOMRect(100, 120, 80, 20);
  element.getClientRects = () => [rect] as unknown as DOMRectList;
  clip.getBoundingClientRect = () => new DOMRect(50, 100, 200, 200);
  vi.spyOn(window, 'getComputedStyle').mockImplementation(node => ({
    display: (node as HTMLElement).hidden ? 'none' : 'block', visibility: 'visible', opacity: '1',
    overflow: node === clip ? 'hidden' : 'visible', overflowX: 'visible', overflowY: 'visible',
  }) as CSSStyleDeclaration);
  const hit = vi.fn((): Element | null => element);
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: hit });
  return { element, clip, hit, move: (value: DOMRect) => { rect = value; },
    target: { id: 'button', scope: 'doc', label: 'button', element: () => element } };
}
it('resolves fresh transformed bounds, rejects clipped, hidden and disconnected elements', () => {
  const { target, element, move } = fixture();
  expect(measureButterflyTarget(target)).toEqual({ left: 100, top: 120, right: 180, bottom: 140 });
  move(new DOMRect(120, 150, 84, 21));
  expect(measureButterflyTarget(target)?.left).toBe(120);
  element.hidden = true; expect(measureButterflyTarget(target)).toBeNull(); element.hidden = false;
  move(new DOMRect(100, 330, 80, 20)); expect(measureButterflyTarget(target)).toBeNull();
  element.remove(); expect(measureButterflyTarget(target)).toBeNull();
});
it('rejects overlays and chooses the first visible line of a text target', () => {
  const { target, hit } = fixture();
  const overlay = document.createElement('div'); document.body.append(overlay);
  hit.mockReturnValue(overlay); expect(measureButterflyTarget(target)).toBeNull();
  hit.mockReturnValue(target.element());
  expect(measureButterflyTarget({ ...target, rects: () => [new DOMRect(100, 70, 80, 20), new DOMRect(100, 110, 80, 20)] }))
    .toEqual({ left: 100, top: 110, right: 180, bottom: 130 });
});
