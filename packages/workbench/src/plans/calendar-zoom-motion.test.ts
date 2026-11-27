// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { animate } from 'motion/mini';
import { captureCalendarZoom, playCalendarZoom } from './calendar-zoom-motion';

vi.mock('motion/mini', () => ({ animate: vi.fn(() => ({ stop: vi.fn(), finished: Promise.resolve() })) }));

let stage: HTMLElement;
let container: HTMLElement;

/** jsdom has no layout: give elements fixed boxes. */
function place(element: Element, x: number, y: number, w: number, h: number) {
  element.getBoundingClientRect = () => ({
    x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON: () => ({}),
  }) as DOMRect;
}

beforeEach(() => {
  stage = document.createElement('div');
  container = document.createElement('main');
  Object.defineProperty(container, 'clientWidth', { configurable: true, value: 800 });
  Object.defineProperty(container, 'clientHeight', { configurable: true, value: 600 });
  place(container, 0, 0, 800, 600);
  stage.append(container);
  document.body.append(stage);
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    value: vi.fn(() => ({ finished: Promise.resolve() })),
  });
  vi.mocked(animate).mockClear();
});

afterEach(() => {
  stage.remove();
  Reflect.deleteProperty(HTMLElement.prototype, 'animate');
});

/** Month grid: two visible cells, each with its date number and one event chip. */
function monthGrid() {
  container.innerHTML = `
    <div data-zoom-day="2026-11-10"><b data-zoom-num="2026-11-10">10</b><i data-zoom-scale></i></div>
    <div data-zoom-day="2026-11-11"><b data-zoom-num="2026-11-11">11</b><i data-zoom-scale></i></div>`;
  const [ten, eleven] = container.querySelectorAll('[data-zoom-day]');
  place(ten!, 100, 100, 100, 80);
  place(eleven!, 200, 100, 100, 80);
  place(ten!.firstElementChild!, 180, 104, 16, 16);
  place(eleven!.firstElementChild!, 280, 104, 16, 16);
}

it('morphs the days visible before and after, and leaves the rest in the fading copy', async () => {
  monthGrid();
  const snapshot = captureCalendarZoom(container, stage)!;
  expect(snapshot.ghost.classList.contains('calendar-zoom-ghost')).toBe(true);

  // The week view only shows the 11th: a tall column, with its number in the header.
  container.innerHTML = `
    <strong data-zoom-num="2026-11-11">11</strong>
    <div data-zoom-day="2026-11-11"><i data-zoom-scale></i></div>`;
  place(container.querySelector('[data-zoom-day]')!, 300, 60, 140, 540);
  place(container.querySelector('[data-zoom-num]')!, 330, 20, 24, 24);
  await playCalendarZoom(snapshot, container);

  const animated = vi.mocked(animate).mock.calls.map(([element]) => element as HTMLElement);
  // The column, its event chip (scale-corrected) and the header number.
  expect(animated).toHaveLength(3);
  const column = vi.mocked(animate).mock.calls[0]!;
  const frames = (column[1] as { transform: string[] }).transform;
  expect(frames[0]).toBe(`translate(-100px, 40px) scale(${100 / 140}, ${80 / 540})`);
  expect(frames.at(-1)).toBe('translate(0px, 0px) scale(1, 1)');
  const chip = (vi.mocked(animate).mock.calls[1]![1] as { transform: string[] }).transform;
  expect(chip[0]).toBe(`scale(${140 / 100}, ${540 / 80})`);

  const landed = [...snapshot.ghost.querySelectorAll<HTMLElement>('[data-zoom-landed]')]
    .map(element => element.dataset.zoomDay ?? `num ${element.dataset.zoomNum}`);
  expect(landed).toEqual(['2026-11-11', 'num 2026-11-11']);
  expect(snapshot.ghost.isConnected).toBe(false);
});

it('ends a change still animating before measuring the next one', () => {
  monthGrid();
  const stop = vi.fn();
  vi.mocked(animate).mockReturnValue({ stop, finished: new Promise(() => {}) } as never);
  const first = captureCalendarZoom(container, stage)!;
  void playCalendarZoom(first, container);
  expect(container.querySelectorAll('[data-zoom-moving]')).toHaveLength(2);

  captureCalendarZoom(container, stage);
  expect(stop).toHaveBeenCalled();
  expect(container.querySelectorAll('[data-zoom-moving]')).toHaveLength(0);
  expect((container.querySelector('[data-zoom-day]') as HTMLElement).style.transform).toBe('');
});

it('skips the animation when motion is reduced', () => {
  document.documentElement.dataset.motion = 'reduced';
  try {
    expect(captureCalendarZoom(container, stage)).toBeUndefined();
  } finally {
    delete document.documentElement.dataset.motion;
  }
});
