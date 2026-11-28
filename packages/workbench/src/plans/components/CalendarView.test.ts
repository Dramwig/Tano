// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import type { App } from 'vue';
import type { CalendarViewMode } from '../calendar';
import { PLAN_DRAG_MIME } from '../calendar-interaction';
import type { ObjectRecord } from '../../objects/workspace-objects';
import CalendarView from './CalendarView.vue';

const planFixture = vi.hoisted(() => ({
  records: [] as ObjectRecord[],
  defaultScope: 'workspace' as 'workspace' | 'personal',
  workspaceId: 'ws',
  workspaceWritable: true,
  personalWritable: true,
  recordsFor: vi.fn(() => [] as ObjectRecord[]),
  canEdit: vi.fn((_record: ObjectRecord) => true),
  create: vi.fn(async (value: unknown) => value),
  update: vi.fn(async (record: ObjectRecord, value: ObjectRecord['object']) => ({ ...record, object: value })),
}));
vi.mock('../../stores/plans', () => ({ usePlanStore: () => planFixture }));

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
  planFixture.records = [];
  planFixture.defaultScope = 'workspace';
  planFixture.workspaceWritable = true;
  planFixture.personalWritable = true;
  planFixture.recordsFor.mockReset();
  planFixture.recordsFor.mockReturnValue([]);
  planFixture.canEdit.mockReset();
  planFixture.canEdit.mockReturnValue(true);
  planFixture.create.mockClear();
  planFixture.update.mockClear();
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

it('zooms in on the period under the pointer', async () => {
  mode.value = 'month';
  await render();
  const cell = viewport.querySelector<HTMLElement>('.calendar-month-cell[data-day="2026-10-15"]')!;
  wheel({ deltaY: -120 }, cell);
  expect(selectDate).toHaveBeenCalledExactlyOnceWith(new Date(2026, 9, 15));
  expect(selectMode).toHaveBeenCalledExactlyOnceWith('week');

  selectDate.mockClear();
  mode.value = 'year';
  await render();
  now += 250;
  wheel({ deltaY: -120 }, viewport.querySelector<HTMLElement>('.calendar-year-month[data-month="2026-11"] .calendar-year-weekdays')!);
  expect(selectDate).toHaveBeenCalledExactlyOnceWith(new Date(2026, 10, 1));

  selectDate.mockClear();
  mode.value = 'week';
  await render();
  now += 250;
  wheel({ deltaY: -120 }, viewport.querySelector<HTMLElement>('.calendar-view-day-column[data-day="2026-10-03"]')!);
  // Saturday keeps the four-day window inside its week: Thursday to Sunday.
  expect(selectDate).toHaveBeenCalledExactlyOnceWith(new Date(2026, 9, 1));
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

it('renders overlapping columns, due-only markers, inline completion, month overflow popover, and filters', async () => {
  const makeRecord = (id: string, name: string, properties: Record<string, unknown>): ObjectRecord => ({
    path: `.tano/objects/${id}.tano.json`,
    snapshot: { hash: `h-${id}`, content: '', modified: 1 },
    source: { scope: 'workspace', id: 'ws', name: '项目空间' },
    object: { version: 1, id, type: 'event', name, description: '', archived: false, properties },
  });
  const records = ref<ObjectRecord[]>([
    makeRecord('a00001', '架构评审', {
      checkable: false,
      start: new Date(2026, 8, 30, 9, 0).toISOString(),
      end: new Date(2026, 8, 30, 11, 0).toISOString(),
    }),
    makeRecord('a00002', '并发任务', {
      checkable: true,
      completed: false,
      start: new Date(2026, 8, 30, 9, 30).toISOString(),
      end: new Date(2026, 8, 30, 10, 30).toISOString(),
    }),
    makeRecord('a00003', '截止交付', {
      checkable: true,
      completed: false,
      due: '2026-09-30',
    }),
    makeRecord('a00004', '已完成项', {
      checkable: true,
      completed: true,
      date: '2026-09-30',
    }),
  ]);
  app.unmount();
  app = createApp(() => h(CalendarView, {
    date,
    mode: mode.value,
    records: records.value,
    'onSelect-mode': selectMode,
    'onSelect-date': selectDate,
    'onVisible-month': selectDate,
    'onVisible-year': selectDate,
    'onVisible-timeline': selectDate,
  }));
  app.mount(root);
  await render();

  // Overlap columns in timeline view
  const timedBlocks = [...root.querySelectorAll<HTMLElement>('.calendar-view-event')];
  expect(timedBlocks).toHaveLength(2);
  expect(timedBlocks[0]!.style.width).toBe('calc(50% - 4px)');
  expect(timedBlocks[1]!.style.left).toBe('calc(50% + 2px)');

  // Due-only task appears in banner row
  expect(root.querySelector('.calendar-view-date-event.is-due')?.textContent).toContain('截止交付');

  // Inline completion toggles task via plans.update
  const checkBtn = root.querySelector<HTMLButtonElement>('[aria-label="完成：并发任务"]')!;
  checkBtn.click();
  await vi.waitFor(() => expect(planFixture.update).toHaveBeenCalledTimes(1));
  expect(planFixture.update.mock.calls[0]![1].properties).toMatchObject({ checkable: true, completed: true });

  // Filter menu: hide completed & switch to tasks only
  root.querySelector<HTMLButtonElement>('.calendar-filter-trigger')!.click();
  await nextTick();
  root.querySelector<HTMLButtonElement>('.calendar-filter-completed')!.click();
  await nextTick();
  expect(root.textContent).not.toContain('已完成项');

  const taskFilterBtn = [...root.querySelectorAll<HTMLButtonElement>('.calendar-filter-kinds button')]
    .find((btn) => btn.textContent?.trim() === '任务')!;
  taskFilterBtn.click();
  await nextTick();
  expect(root.querySelectorAll('.calendar-view-event')).toHaveLength(1);
  expect(root.querySelector('.calendar-filter-trigger')?.textContent).toContain('任务');

  // Reset filters and open month view "+N more" popover
  root.querySelector<HTMLButtonElement>('.calendar-filter-reset')!.click();
  await nextTick();
  expect(root.querySelector('.calendar-filter-menu')).toBeNull();
  mode.value = 'month';
  await render();

  const moreBtn = root.querySelector<HTMLButtonElement>('.calendar-month-more')!;
  expect(moreBtn.textContent).toContain('另有 1 项');
  moreBtn.click();
  await nextTick();
  const popover = document.body.querySelector('.calendar-day-popover')!;
  expect(popover).not.toBeNull();
  expect(popover.textContent).toContain('截止交付');
  expect(popover.textContent).toContain('已完成项');
});

it('supports timeline slot quick-create, bottom-edge resize, and drag-and-drop timeblocking with readonly guards', async () => {
  const makeRecord = (id: string, name: string, properties: Record<string, unknown>): ObjectRecord => ({
    path: `.tano/objects/${id}.tano.json`,
    snapshot: { hash: `h-${id}`, content: '', modified: 1 },
    source: { scope: 'workspace', id: 'ws', name: '项目空间' },
    object: { version: 1, id, type: 'event', name, description: '', archived: false, properties },
  });
  const timed = makeRecord('a00001', '例会', {
    checkable: false,
    start: new Date(2026, 8, 30, 9, 0).toISOString(),
    end: new Date(2026, 8, 30, 10, 0).toISOString(),
  });
  const unscheduled = makeRecord('a00002', '未安排任务', {
    checkable: true,
    completed: false,
    due: '2026-10-05',
  });
  const readonlyEvent = makeRecord('a00003', '只读日程', {
    checkable: false,
    syncReadOnly: true,
    start: new Date(2026, 8, 30, 13, 0).toISOString(),
    end: new Date(2026, 8, 30, 14, 0).toISOString(),
  });

  planFixture.recordsFor.mockReturnValue([timed, unscheduled, readonlyEvent]);
  planFixture.canEdit.mockImplementation((record: ObjectRecord) => record.object.properties.syncReadOnly !== true);

  app.unmount();
  mode.value = 'week';
  app = createApp(() => h(CalendarView, {
    date,
    mode: mode.value,
    records: [timed, unscheduled, readonlyEvent],
    'onSelect-mode': selectMode,
    'onSelect-date': selectDate,
    'onVisible-month': selectDate,
    'onVisible-year': selectDate,
    'onVisible-timeline': selectDate,
  }));
  app.mount(root);
  await render();

  // Only editable timed event gets a resize handle
  const handles = root.querySelectorAll<HTMLElement>('.calendar-event-resize-handle');
  expect(handles).toHaveLength(1);

  // Resize downward by 56px (+1 hour) -> 09:00-11:00
  handles[0]!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientY: 560 }));
  window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientY: 616 }));
  window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientY: 616 }));
  await vi.waitFor(() => expect(planFixture.update).toHaveBeenCalledTimes(1));
  const resized = planFixture.update.mock.calls[0]![1];
  expect(Date.parse(String(resized.properties.end)) - Date.parse(String(resized.properties.start))).toBe(120 * 60_000);

  // Click empty timeline slot at 11:00 (top = 0, clientY = 11 * 56 = 616) -> opens quick-create modal
  const col = root.querySelector<HTMLElement>('.calendar-view-day-column[data-day="2026-09-30"]')!;
  vi.spyOn(col, 'getBoundingClientRect').mockReturnValue({
    top: 0, bottom: 1344, left: 0, right: 120, width: 120, height: 1344, x: 0, y: 0, toJSON: () => ({}),
  });
  col.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientY: 11 * 56 }));
  window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientY: 11 * 56 }));
  await nextTick();

  const dialog = document.body.querySelector<HTMLElement>('.calendar-create-dialog')!;
  expect(dialog).not.toBeNull();
  const titleInput = dialog.querySelector<HTMLInputElement>('.calendar-create-title')!;
  titleInput.value = '快速新建评审';
  titleInput.dispatchEvent(new Event('input', { bubbles: true }));
  dialog.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  await vi.waitFor(() => expect(planFixture.create).toHaveBeenCalledTimes(1));
  expect(planFixture.create.mock.calls[0]![0]).toMatchObject({ type: 'event', name: '快速新建评审' });

  // Drop unscheduled sidebar task onto 2026-09-30 at 15:00 (15 * 56 = 840)
  const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(dropEvent, 'clientY', { value: 15 * 56 });
  Object.defineProperty(dropEvent, 'dataTransfer', {
    value: { getData: (type: string) => (type === PLAN_DRAG_MIME ? 'a00002' : ''), types: [PLAN_DRAG_MIME] },
  });
  col.dispatchEvent(dropEvent);
  await vi.waitFor(() => expect(planFixture.update).toHaveBeenCalledTimes(2));
  const timeblocked = planFixture.update.mock.calls[1]![1];
  expect(timeblocked.properties.due).toBe('2026-10-05');
  expect(new Date(String(timeblocked.properties.start)).getHours()).toBe(15);

  // Switch to month view and drop unscheduled task onto 2026-10-02
  mode.value = 'month';
  await render();
  const cell = root.querySelector<HTMLElement>('.calendar-month-cell[data-day="2026-10-02"]')!;
  const monthDrop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(monthDrop, 'dataTransfer', {
    value: { getData: (type: string) => (type === PLAN_DRAG_MIME ? 'a00002' : ''), types: [PLAN_DRAG_MIME] },
  });
  cell.dispatchEvent(monthDrop);
  await vi.waitFor(() => expect(planFixture.update).toHaveBeenCalledTimes(3));
  expect(planFixture.update.mock.calls[2]![1].properties).toMatchObject({
    checkable: true,
    due: '2026-10-05',
    date: '2026-10-02',
  });
});

it('repositions the timeline scroll once initial loading finishes', async () => {
  app.unmount();
  const loading = ref(true);
  app = createApp(() => h(CalendarView, {
    date,
    mode: 'week',
    loading: loading.value,
    'onSelect-mode': selectMode,
    'onSelect-date': selectDate,
    'onVisible-month': selectDate,
    'onVisible-year': selectDate,
    'onVisible-timeline': selectDate,
  }));
  app.mount(root);
  await render();
  viewport = root.querySelector('.calendar-view')!;
  expect(viewport.scrollLeft).toBe(0);
  expect(viewport.scrollTop).toBe(0);

  loading.value = false;
  await render();
  expect(viewport.scrollLeft).toBeGreaterThan(0);
  expect(viewport.scrollTop).toBe(56 * 7);
});

it('defers timeline edge extension during horizontal scrollbar drags and avoids runaway loops', async () => {
  vi.useFakeTimers();
  try {
    // Week view with 42 initial days (dayWidth = 90px in jsdom, clientWidth = 682 -> ~7 days visible).
    const dayWidth = 90;
    const clientWidth = 682;
    let currentScrollWidth = 52 + 42 * dayWidth;
    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: clientWidth });
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 500 });
    Object.defineProperty(viewport, 'scrollWidth', { configurable: true, get: () => currentScrollWidth });
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({
      top: 0, bottom: 514, left: 0, right: 696, width: 696, height: 514, x: 0, y: 0, toJSON: () => ({}),
    });

    const dayCount = () => viewport.querySelectorAll('.calendar-view-day-column').length;
    expect(dayCount()).toBe(42);

    // 1. Scrolling partway (e.g. 4 days from left edge = 360px, previously < clientWidth) must not extend.
    viewport.scrollLeft = 4 * dayWidth;
    viewport.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(300);
    await render();
    expect(dayCount()).toBe(42);

    // 2. Dragging the horizontal scrollbar thumb all the way to the left edge must NOT extend mid-drag.
    viewport.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 508 }));
    for (let i = 0; i < 5; i++) {
      viewport.scrollLeft = 20;
      viewport.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(100);
      await render();
    }
    expect(dayCount()).toBe(42);
    expect(viewport.scrollLeft).toBe(20);

    // 3. Releasing the scrollbar extends once by 14 days and shifts scrollLeft inward.
    currentScrollWidth = 52 + 56 * dayWidth;
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    viewport.dispatchEvent(new Event('scrollend'));
    await render();
    expect(dayCount()).toBe(56);
    expect(viewport.scrollLeft).toBe(14 * dayWidth + 20);

    // 4. Shift+wheel scrolling near the right edge still extends immediately.
    now += 500;
    viewport.scrollLeft = currentScrollWidth - clientWidth - 30;
    wheel({ ctrlKey: false, shiftKey: true, deltaY: 20 });
    viewport.dispatchEvent(new Event('scroll'));
    await render();
    expect(dayCount()).toBe(70);
  } finally {
    vi.useRealTimers();
  }
});

it('slides the fixed-width timeline window on overscroll without teleporting and renders minimalist acceleration particles', async () => {
  vi.useFakeTimers();
  try {
    const dayWidth = 90;
    const clientWidth = 682;
    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: clientWidth });
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 500 });
    Object.defineProperty(viewport, 'scrollWidth', {
      configurable: true,
      get: () => 52 + viewport.querySelectorAll('.calendar-view-day-column').length * dayWidth,
    });

    const track = root.querySelector<HTMLElement>('.calendar-escroll-track')!;
    const thumb = root.querySelector<HTMLElement>('.calendar-escroll-thumb')!;
    Object.defineProperty(track, 'clientWidth', { configurable: true, value: 660 });
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      top: 500, bottom: 514, left: 0, right: 660, width: 660, height: 14, x: 0, y: 500, toJSON: () => ({}),
    });

    const firstDayKey = () => viewport.querySelector<HTMLElement>('.calendar-view-day-column')?.dataset.day;
    viewport.dispatchEvent(new Event('scroll'));
    await render();
    const initialThumbLeft = parseFloat(thumb.style.left);
    const initialFirstDay = firstDayKey();
    expect(initialThumbLeft).toBeGreaterThan(0);

    // Grab the thumb and drag to the far-left edge (0px): stops cleanly without sliding the window.
    const startX = 200;
    thumb.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: startX }));
    window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: startX - initialThumbLeft }));
    await render();
    expect(viewport.scrollLeft).toBe(0);
    expect(thumb.classList.contains('is-overscrolling')).toBe(false);
    expect(root.querySelectorAll('.calendar-escroll-particle')).toHaveLength(0);
    expect(firstDayKey()).toBe(initialFirstDay);

    // Pull 40px past the left edge -> left directional gradient + elastic squash + minimalist particles.
    window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: startX - initialThumbLeft - 40 }));
    await render();
    expect(thumb.classList.contains('is-overscroll-start')).toBe(true);
    expect(thumb.style.transformOrigin).toBe('left center');
    const gentleHeadMix = parseFloat(thumb.style.getPropertyValue('--elastic-head-mix'));
    const gentleParticleCount = root.querySelectorAll('.calendar-escroll-particle').length;
    expect(gentleParticleCount).toBeGreaterThanOrEqual(3);

    // First RAF slides the fixed 42-day window leftward (total day count stays 42, first day moves earlier).
    vi.advanceTimersByTime(20);
    await render();
    expect(viewport.querySelectorAll('.calendar-view-day-column')).toHaveLength(42);
    expect(firstDayKey()! < initialFirstDay!).toBe(true);
    expect(viewport.scrollLeft).toBeLessThan(dayWidth);

    // Pull 160px past the left edge -> deeper directional gradient and more particles.
    window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: startX - initialThumbLeft - 160 }));
    await render();
    const fastHeadMix = parseFloat(thumb.style.getPropertyValue('--elastic-head-mix'));
    const fastParticleCount = root.querySelectorAll('.calendar-escroll-particle').length;
    expect(fastHeadMix).toBeGreaterThan(gentleHeadMix);
    expect(fastParticleCount).toBeGreaterThan(gentleParticleCount);

    // Releasing right after left overscroll keeps the thumb at the left edge even after
    // trailing scroll/scrollend events arrive (must not trigger 14-day extension or jump).
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    viewport.dispatchEvent(new Event('scroll'));
    viewport.dispatchEvent(new Event('scrollend'));
    vi.advanceTimersByTime(200);
    await render();
    expect(thumb.classList.contains('is-overscrolling')).toBe(false);
    expect(thumb.classList.contains('is-rebounding')).toBe(true);
    expect(root.querySelectorAll('.calendar-escroll-particle')).toHaveLength(0);
    expect(viewport.querySelectorAll('.calendar-view-day-column')).toHaveLength(42);
    expect(parseFloat(thumb.style.left)).toBeLessThan(20);
  } finally {
    vi.useRealTimers();
  }
});

it('renders vertical elastic overscroll scrollbar for month and year views', async () => {
  vi.useFakeTimers();
  try {
    mode.value = 'year';
    await render();

    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 500 });
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 2400 });

    const track = root.querySelector<HTMLElement>('.calendar-escroll.is-vertical .calendar-escroll-track')!;
    const thumb = root.querySelector<HTMLElement>('.calendar-escroll.is-vertical .calendar-escroll-thumb')!;
    expect(track).not.toBeNull();
    expect(thumb).not.toBeNull();
    Object.defineProperty(track, 'clientHeight', { configurable: true, value: 492 });

    const firstYear = () => Number(viewport.querySelector<HTMLElement>('.calendar-year-section')?.dataset.year);
    const initialYear = firstYear();
    viewport.scrollTop = 700;
    viewport.dispatchEvent(new Event('scroll'));
    await render();
    const initialThumbTop = parseFloat(thumb.style.top);
    expect(initialThumbTop).toBeGreaterThan(0);

    // Drag up past the top edge -> vertical elastic squash + upward particles + fixed 3-year window slides earlier.
    const startY = 200;
    thumb.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientY: startY }));
    window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientY: startY - initialThumbTop - 80 }));
    await render();
    expect(thumb.classList.contains('is-overscroll-start')).toBe(true);
    expect(thumb.style.transformOrigin).toBe('center top');
    expect(root.querySelectorAll('.calendar-escroll-particle').length).toBeGreaterThan(0);

    viewport.scrollTop = 0;
    vi.advanceTimersByTime(34);
    await render();
    expect(viewport.querySelectorAll('.calendar-year-section')).toHaveLength(3);
    expect(firstYear()).toBeLessThan(initialYear);

    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    await render();
    expect(thumb.classList.contains('is-overscrolling')).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});
