// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startCalendarViewTransition } from './calendar-zoom-motion';

type Update = () => Promise<void> | void;
let update: Update | undefined;
let finish: () => void;
let stage: HTMLElement;
let container: HTMLElement;

function sized(element: HTMLElement) {
  Object.defineProperty(element, 'clientWidth', { configurable: true, value: 800 });
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: 600 });
  return element;
}

beforeEach(() => {
  update = undefined;
  const finished = new Promise<void>((resolve) => { finish = resolve; });
  Object.assign(document, {
    startViewTransition: vi.fn((callback: Update) => {
      update = callback;
      return { finished, skipTransition: vi.fn() };
    }),
  });
  stage = document.createElement('div');
  container = sized(document.createElement('main'));
  container.innerHTML = `
    <div class="calendar-month-week" data-week="2026-11-09"></div>
    <div class="calendar-month-week" data-week="2026-11-16"></div>`;
  stage.append(container);
  document.body.append(stage);
});

afterEach(() => {
  stage.remove();
  Reflect.deleteProperty(document, 'startViewTransition');
  document.documentElement.classList.remove('calendar-zooming');
});

it('morphs the hovered week row into the week view when zooming in', async () => {
  const apply = vi.fn(() => {
    // The month grid is replaced by the timeline.
    container.innerHTML = '<div class="calendar-view-inner"></div>';
  });
  const started = startCalendarViewTransition({
    container, stage, from: 'month', to: 'week', date: new Date(2026, 10, 11),
    apply, positioned: () => Promise.resolve(),
  });
  expect(started).toBe(true);
  const row = container.querySelector<HTMLElement>('[data-week="2026-11-09"]')!;
  expect(row.style.getPropertyValue('view-transition-name')).toBe('calendar-zoom-focus');
  expect(container.style.getPropertyValue('view-transition-name')).toBe('calendar-zoom-context');
  expect(apply).not.toHaveBeenCalled();

  await update!();
  expect(apply).toHaveBeenCalledOnce();
  expect(container.style.getPropertyValue('view-transition-name')).toBe('calendar-zoom-focus');

  finish();
  await new Promise(resolve => setTimeout(resolve));
  expect(container.style.getPropertyValue('view-transition-name')).toBe('');
  expect(document.documentElement.classList.contains('calendar-zooming')).toBe(false);
});

it('morphs the whole viewport into the week row when zooming out', async () => {
  container.innerHTML = '<div class="calendar-view-inner"></div>';
  const started = startCalendarViewTransition({
    container, stage, from: 'week', to: 'month', date: new Date(2026, 10, 16),
    apply: () => {
      container.innerHTML = `
        <div class="calendar-month-week" data-week="2026-11-09"></div>
        <div class="calendar-month-week" data-week="2026-11-16"></div>`;
    },
    positioned: () => Promise.resolve(),
  });
  expect(started).toBe(true);
  expect(container.style.getPropertyValue('view-transition-name')).toBe('calendar-zoom-focus');
  await update!();
  expect(container.style.getPropertyValue('view-transition-name')).toBe('calendar-zoom-context');
  expect(container.querySelector<HTMLElement>('[data-week="2026-11-16"]')!
    .style.getPropertyValue('view-transition-name')).toBe('calendar-zoom-focus');
});

it('leaves pairs without a single period element, and browsers without the API, to the fallback', () => {
  const request = {
    container, stage, date: new Date(2026, 10, 11), apply: vi.fn(), positioned: () => Promise.resolve(),
  };
  expect(startCalendarViewTransition({ ...request, from: 'week', to: 'four-days' })).toBe(false);
  Reflect.deleteProperty(document, 'startViewTransition');
  expect(startCalendarViewTransition({ ...request, from: 'month', to: 'week' })).toBe(false);
  expect(request.apply).not.toHaveBeenCalled();
});
