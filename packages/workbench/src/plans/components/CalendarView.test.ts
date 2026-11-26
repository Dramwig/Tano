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

  // Filter bar: hide completed & switch to tasks only
  const completedCheckbox = root.querySelector<HTMLInputElement>('.calendar-filter-completed input')!;
  completedCheckbox.checked = false;
  completedCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
  await nextTick();
  expect(root.textContent).not.toContain('已完成项');

  const taskFilterBtn = [...root.querySelectorAll<HTMLButtonElement>('.calendar-filter-kinds button')]
    .find((btn) => btn.textContent?.trim() === '任务')!;
  taskFilterBtn.click();
  await nextTick();
  expect(root.querySelectorAll('.calendar-view-event')).toHaveLength(1);

  // Reset filters and open month view "+N more" popover
  completedCheckbox.checked = true;
  completedCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
  const allFilterBtn = [...root.querySelectorAll<HTMLButtonElement>('.calendar-filter-kinds button')]
    .find((btn) => btn.textContent?.trim() === '全部')!;
  allFilterBtn.click();
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
