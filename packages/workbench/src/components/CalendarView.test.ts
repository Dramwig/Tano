// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import type { App } from 'vue';
import type { CalendarViewMode } from '../calendar';
import CalendarView from './CalendarView.vue';

vi.mock('../stores/plans', () => ({ usePlanStore: () => ({ records: [] }) }));

let app: App;
let root: HTMLElement;
let viewport: HTMLElement;
let now: number;
const mode = ref<CalendarViewMode>('week');
const date = new Date(2026, 8, 30);
const selectMode = vi.fn((value: CalendarViewMode) => { mode.value = value; });
const selectDate = vi.fn();

async function render() {
  // Mode changes position the timeline after rendering its days.
  for (let i = 0; i < 4; i++) await nextTick();
}
function wheel(options: WheelEventInit = {}, target: EventTarget = viewport) {
  const event = new WheelEvent('wheel', {
    bubbles: true, cancelable: true, ctrlKey: true, deltaY: 120, ...options,
  });
  target.dispatchEvent(event);
  return event;
}

beforeEach(async () => {
  now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  selectMode.mockClear();
  selectDate.mockClear();
  mode.value = 'week';
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(() => h(CalendarView, {
    date, mode: mode.value,
    'onSelect-mode': selectMode,
    'onSelect-date': selectDate,
    'onVisible-month': selectDate,
    'onVisible-year': selectDate,
    'onVisible-timeline': selectDate,
  }));
  app.mount(root);
  await render();
  viewport = root.querySelector('.calendar-view')!;
});

afterEach(() => {
  app.unmount();
  root.remove();
  vi.restoreAllMocks();
});

it('zooms through all time scales in both directions without changing the selected date', async () => {
  mode.value = 'day';
  await render();
  const steps: [number, string][] = [
    [120, '4 天视图'], [120, '周视图'], [120, '月视图'], [120, '年视图'],
    [-120, '月视图'], [-120, '周视图'], [-120, '4 天视图'], [-120, '日视图'],
  ];
  for (const [deltaY, label] of steps) {
    now += 250;
    expect(wheel({ deltaY }).defaultPrevented).toBe(true);
    await render();
    expect(viewport.getAttribute('aria-label')).toBe(`日历${label}`);
    if (label === '月视图' || label === '年视图') expect(viewport.scrollLeft).toBe(0);
  }
  expect(selectDate).not.toHaveBeenCalled();
});

it.each<[CalendarViewMode, number]>([['day', -120], ['year', 120]])(
  'stops at the %s boundary while still preventing browser zoom', async (initial, deltaY) => {
    mode.value = initial;
    await render();
    expect(wheel({ deltaY }).defaultPrevented).toBe(true);
    expect(selectMode).not.toHaveBeenCalled();
  },
);

it.each<[number, CalendarViewMode]>([[-120, 'week'], [120, 'year']])(
  'zooms the monthly agenda by %s from the month scale', async (deltaY, expected) => {
    mode.value = 'agenda';
    await render();
    wheel({ deltaY });
    expect(selectMode).toHaveBeenCalledExactlyOnceWith(expected);
  },
);

it('handles wheel events from calendar children and leaves events outside the calendar alone', () => {
  const ancestorWheel = vi.fn();
  root.addEventListener('wheel', ancestorWheel);
  expect(wheel({}, viewport.querySelector('.calendar-view-day-column')!).defaultPrevented).toBe(true);
  expect(selectMode).toHaveBeenCalledExactlyOnceWith('month');
  expect(ancestorWheel).not.toHaveBeenCalled();
  expect(wheel({}, root).defaultPrevented).toBe(false);
  expect(selectMode).toHaveBeenCalledTimes(1);
});

it('preserves ordinary and Shift scrolling, with Ctrl taking priority over Shift', async () => {
  const left = viewport.scrollLeft;
  expect(wheel({ ctrlKey: false }).defaultPrevented).toBe(false);
  expect(viewport.scrollLeft).toBe(left);
  expect(wheel({ ctrlKey: false, shiftKey: true }).defaultPrevented).toBe(true);
  expect(viewport.scrollLeft).toBeGreaterThan(left);
  expect(selectMode).not.toHaveBeenCalled();
  const shifted = viewport.scrollLeft;
  expect(wheel({ shiftKey: true }).defaultPrevented).toBe(true);
  expect(viewport.scrollLeft).toBe(shifted);
  await render();
  expect(mode.value).toBe('month');
  expect(wheel({ ctrlKey: false, shiftKey: true }).defaultPrevented).toBe(false);
});

it('accumulates small deltas and throttles a burst to keep view changes deliberate', async () => {
  mode.value = 'day';
  await render();
  wheel({ deltaY: 15 });
  wheel({ deltaY: 15 });
  expect(selectMode).not.toHaveBeenCalled();
  wheel({ deltaY: 15 });
  await render();
  expect(mode.value).toBe('four-days');
  for (let i = 0; i < 5; i++) {
    now += 20;
    expect(wheel().defaultPrevented).toBe(true);
  }
  expect(selectMode).toHaveBeenCalledTimes(1);
  now += 200;
  wheel();
  await render();
  expect(mode.value).toBe('week');
});

it('discards partial gestures on reversal, a pause, or release of Ctrl', () => {
  wheel({ deltaY: 30 });
  wheel({ deltaY: -30 });
  expect(selectMode).not.toHaveBeenCalled();
  now += 250;
  wheel({ deltaY: -20 });
  expect(selectMode).not.toHaveBeenCalled();
  wheel({ ctrlKey: false });
  wheel({ deltaY: -20 });
  expect(selectMode).not.toHaveBeenCalled();
  wheel({ deltaY: -20 });
  expect(selectMode).toHaveBeenCalledExactlyOnceWith('four-days');
});

it.each([1, 2])('supports wheel deltas reported in mode %s', (deltaMode) => {
  wheel({ deltaMode, deltaY: deltaMode === 1 ? 3 : 1 });
  expect(selectMode).toHaveBeenCalledExactlyOnceWith('month');
});

it('ignores horizontal gestures and empty deltas without allowing browser zoom', () => {
  expect(wheel({ deltaY: 0 }).defaultPrevented).toBe(true);
  expect(wheel({ deltaX: 120, deltaY: 5 }).defaultPrevented).toBe(true);
  expect(selectMode).not.toHaveBeenCalled();
});
