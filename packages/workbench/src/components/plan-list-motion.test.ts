// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { animate } from 'motion/mini';
import { createPlanListMotion } from './plan-list-motion';

vi.mock('motion/mini', () => ({ animate: vi.fn() }));
let root: HTMLElement;
let controller: ReturnType<typeof createPlanListMotion>;
let resized: () => void;
let shown = true;
const animations: { stop: ReturnType<typeof vi.fn>; finish: () => void }[] = [];

beforeEach(() => {
  shown = true;
  animations.length = 0;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resized = callback; }
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.mocked(animate).mockReset().mockImplementation(() => {
    let finish!: () => void;
    const finished = new Promise<void>(resolve => { finish = resolve; });
    const stop = vi.fn();
    animations.push({ stop, finish });
    return { finished, stop } as unknown as ReturnType<typeof animate>;
  });
  root = document.createElement('div');
  root.getBoundingClientRect = () => new DOMRect(20, 80, 230, 600);
  root.getClientRects = () => (shown ? [root.getBoundingClientRect()] : []) as unknown as DOMRectList;
  document.body.append(root);
});
afterEach(() => {
  controller?.dispose();
  root.remove();
  vi.unstubAllGlobals();
});
function item(key: string, y: number) {
  const element = document.createElement('div');
  const position = { y, visible: true };
  element.dataset.planLayout = key;
  element.animate = vi.fn();
  element.getBoundingClientRect = () => {
    const translate = element.style.translate.split(/\s+/).map(value => parseFloat(value) || 0);
    return new DOMRect(20 + (translate[0] ?? 0), 80 + position.y + (translate[1] ?? 0), 230, 48);
  };
  element.getClientRects = () => (shown && position.visible ? [element.getBoundingClientRect()] : []) as unknown as DOMRectList;
  root.append(element);
  return { element, position };
}
function displacement(element: HTMLElement, dy: number) {
  expect(animate).toHaveBeenCalledWith(element, { translate: [`0px ${dy}px`, '0px 0px'] }, expect.objectContaining({ duration: 0.22 }));
}

it('keeps the initial layout still and moves both task/event rows and following group headings on reorder', () => {
  const task = item('task', 0), event = item('event', 48), heading = item('completed-heading', 120);
  controller = createPlanListMotion(root);
  expect(animate).not.toHaveBeenCalled();
  controller.capture();
  task.position.y = 48;
  event.position.y = 0;
  heading.position.y = 144;
  controller.update();
  displacement(task.element, -48);
  displacement(event.element, 48);
  displacement(heading.element, -24);
});

it('moves remaining rows and lower groups when a delayed leave removes its DOM node', async () => {
  const leaving = item('leaving', 0), remaining = item('remaining', 48), heading = item('completed-heading', 120);
  controller = createPlanListMotion(root);
  leaving.element.remove();
  remaining.position.y = 0;
  heading.position.y = 72;
  await Promise.resolve();
  displacement(remaining.element, 48);
  displacement(heading.element, 48);
});

it('continues a second layout change from the current visual position and ignores stale completions', async () => {
  const row = item('task', 100);
  controller = createPlanListMotion(root);
  controller.capture();
  row.position.y = 0;
  controller.update();
  row.element.style.translate = '0px 40px';
  controller.capture();
  row.position.y = 80;
  controller.update();
  expect(animations[0]!.stop).toHaveBeenCalledOnce();
  displacement(row.element, -40);
  row.element.style.translate = '0px -30px';
  animations[0]!.finish();
  await Promise.resolve();
  expect(row.element.style.translate).toBe('0px -30px');
  animations[1]!.finish();
  await Promise.resolve();
  expect(row.element.style.translate).toBe('');
});

it('handles insertions and text wrapping without requiring a parent render', async () => {
  const row = item('existing', 0), heading = item('completed-heading', 60);
  controller = createPlanListMotion(root);
  const added = item('added-event', 48);
  heading.position.y = 108;
  await Promise.resolve();
  displacement(added.element, 6);
  displacement(heading.element, -48);
  animations.forEach(animation => animation.finish());
  await Promise.resolve();
  vi.mocked(animate).mockClear();
  added.position.y = 78;
  heading.position.y = 138;
  resized();
  displacement(added.element, -30);
  displacement(heading.element, -30);
  expect(animate).not.toHaveBeenCalledWith(row.element, expect.anything(), expect.anything());
});

it('uses the final layout directly for reduced motion and hidden sidebars', () => {
  const row = item('task', 100);
  controller = createPlanListMotion(root);
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  row.position.y = 0;
  controller.update();
  expect(animate).not.toHaveBeenCalled();
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  shown = false;
  controller.update();
  row.position.y = 80;
  shown = true;
  controller.update();
  expect(animate).not.toHaveBeenCalled();
});

it('stops active motion on disposal and ignores later observer callbacks', () => {
  const row = item('task', 100);
  controller = createPlanListMotion(root);
  row.position.y = 0;
  controller.update();
  row.element.style.translate = '0px 30px';
  controller.dispose();
  expect(animations[0]!.stop).toHaveBeenCalledOnce();
  expect(row.element.style.translate).toBe('');
  vi.mocked(animate).mockClear();
  resized();
  expect(animate).not.toHaveBeenCalled();
});
