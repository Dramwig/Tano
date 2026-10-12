// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import type { App } from 'vue';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { DemoAdapter } from '../adapter';
import { configureWorkbench } from '../runtime';
import { useWorkspaceStore } from '../stores/workspace';
import { calendarEvents } from '../calendar';
import SidebarPlan from './SidebarPlan.vue';
import { usePlanStore } from '../stores/plans';
import { BrowserPersonalPlans } from '../personal-plans';
import { animate } from 'motion/mini';

vi.mock('motion/mini', () => ({ animate: vi.fn(() => ({ stop: vi.fn(), cancel: vi.fn(), finished: Promise.resolve() })) }));

let app: App;
let root: HTMLElement;
let store: ReturnType<typeof useWorkspaceStore>;
let pinia: ReturnType<typeof createPinia>;
const date = ref(new Date(2026, 8, 29));
const selectEvent = vi.fn();
beforeEach(async () => {
  localStorage.clear();
  vi.stubGlobal('navigator', { locks: { request: async (_name: string, run: () => unknown) => run() } });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  date.value = new Date(2026, 8, 29);
  selectEvent.mockClear();
  pinia = createPinia();
  configureWorkbench(pinia, { adapter: new DemoAdapter(), native: false, mobile: false });
  setActivePinia(pinia);
  store = useWorkspaceStore();
  await store.openWorkspace();
  await usePlanStore().refreshPersonal();
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(() =>
    h(SidebarPlan, {
      date: date.value,
      'onSelect-date': (value: Date) => {
        date.value = value;
      },
      'onSelect-event': selectEvent,
    }),
  );
  app.use(pinia);
  app.mount(root);
});
afterEach(() => {
  app.unmount();
  store.dispose();
  disposePinia(pinia);
  root.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const control = <T extends HTMLElement>(label: string) =>
  document.querySelector<T>(`[aria-label="${label}"]`)!;
const section = (name: string) => root.querySelector<HTMLElement>(`section[aria-label="${name}"]`)!;
function draggableCalendar() {
  const viewport = root.querySelector<HTMLElement>('.sidebar-calendar-scroll')!;
  Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 180 });
  viewport.scrollTop = 780;
  const captured = new Set<number>();
  viewport.setPointerCapture = vi.fn((id: number) => { captured.add(id); });
  viewport.hasPointerCapture = (id: number) => captured.has(id);
  viewport.releasePointerCapture = vi.fn((id: number) => { captured.delete(id); });
  return viewport;
}
function calendarPointer(
  target: EventTarget,
  type: string,
  x: number,
  y: number,
  options: { pointerId?: number; pointerType?: string; isPrimary?: boolean; button?: number } = {},
) {
  const event = new MouseEvent(type, {
    bubbles: true, cancelable: true, clientX: x, clientY: y,
    button: options.button ?? 0, buttons: type === 'pointerup' ? 0 : 1,
  });
  Object.defineProperties(event, {
    pointerId: { value: options.pointerId ?? 1 },
    pointerType: { value: options.pointerType ?? 'mouse' },
    isPrimary: { value: options.isPrimary ?? true },
  });
  target.dispatchEvent(event);
}

async function scrollCalendarTo(viewport: HTMLElement, firstDate: string, offset = 0) {
  const days = [...viewport.querySelectorAll<HTMLElement>('[data-date]')];
  const index = days.findIndex(day => day.dataset.date === firstDate);
  expect(index).toBeGreaterThanOrEqual(0);
  viewport.scrollTop = Math.floor(index / 7) * 30 + offset;
  viewport.dispatchEvent(new Event('scroll'));
  await nextTick();
}

it.each([
  ['2026-07-27', '2026 年 8 月', '2026-08'],
  ['2026-08-31', '2026 年 9 月', '2026-09'],
  ['2026-12-28', '2027 年 1 月', '2027-01'],
  ['2027-01-25', '2027 年 2 月', '2027-02'],
])('identifies the dominant visible month from %s, including dates after the top week', async (firstDate, title, prefix) => {
  const viewport = draggableCalendar();
  await scrollCalendarTo(viewport, firstDate!);
  expect(root.querySelector('.sidebar-calendar-month > span')?.textContent).toBe(title);
  for (const day of viewport.querySelectorAll<HTMLElement>('[data-date]'))
    expect(day.classList.contains('outside-month')).toBe(!day.dataset.date!.startsWith(prefix!));
  expect(date.value.getDate()).toBe(29);
});

it('weights partially visible rows and keeps the current month stable at an even split', async () => {
  const viewport = draggableCalendar();
  // From August 10, the six rows contain 22 August days and 20 September days.
  // Scrolling 30/7 pixels clips one August day-equivalent and reveals one of September.
  await scrollCalendarTo(viewport, '2026-08-10', 4.2);
  expect(root.querySelector('.sidebar-calendar-month > span')?.textContent).toBe('2026 年 8 月');
  await scrollCalendarTo(viewport, '2026-08-10', 4.4);
  expect(root.querySelector('.sidebar-calendar-month > span')?.textContent).toBe('2026 年 9 月');
  await scrollCalendarTo(viewport, '2026-08-10', 4.2);
  expect(root.querySelector('.sidebar-calendar-month > span')?.textContent).toBe('2026 年 8 月');

  // May 11 through June 21 has exactly three full weeks from each month.
  await scrollCalendarTo(viewport, '2026-05-11', 5);
  expect(root.querySelector('.sidebar-calendar-month > span')?.textContent).toBe('2026 年 6 月');
  await scrollCalendarTo(viewport, '2026-05-11');
  expect(root.querySelector('.sidebar-calendar-month > span')?.textContent).toBe('2026 年 6 月');
  await scrollCalendarTo(viewport, '2026-05-11', -5);
  expect(root.querySelector('.sidebar-calendar-month > span')?.textContent).toBe('2026 年 5 月');
  await scrollCalendarTo(viewport, '2026-05-11');
  expect(root.querySelector('.sidebar-calendar-month > span')?.textContent).toBe('2026 年 5 月');
});

it('allows clicks with slight hand movement and scrolls drags vertically without selecting a date', async () => {
  const viewport = draggableCalendar();
  const day = control<HTMLButtonElement>('2026-09-16，0 个事件');
  calendarPointer(day, 'pointerdown', 40, 100);
  calendarPointer(window, 'pointermove', 41, 102);
  calendarPointer(window, 'pointerup', 41, 102);
  day.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  await nextTick();
  expect(date.value.getDate()).toBe(16);
  expect(viewport.scrollTop).toBe(780);
  expect(viewport.setPointerCapture).not.toHaveBeenCalled();

  calendarPointer(day, 'pointerdown', 40, 100);
  calendarPointer(window, 'pointermove', 100, 70);
  await nextTick();
  expect(viewport.scrollTop).toBe(810);
  expect(viewport.scrollLeft).toBe(0);
  expect(viewport.classList.contains('dragging')).toBe(true);
  calendarPointer(window, 'pointermove', 150, 80);
  expect(viewport.scrollTop).toBe(800);
  calendarPointer(window, 'pointerup', 150, 80);
  const nextDay = control<HTMLButtonElement>('2026-09-17，0 个事件');
  nextDay.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
  await nextTick();
  expect(date.value.getDate()).toBe(16);
  expect(viewport.classList.contains('dragging')).toBe(false);
  expect(viewport.releasePointerCapture).toHaveBeenCalledWith(1);

  calendarPointer(nextDay, 'pointerdown', 40, 100);
  calendarPointer(window, 'pointerup', 40, 100);
  nextDay.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  await nextTick();
  expect(date.value.getDate()).toBe(17);
});

it('does not scroll or select a date for a horizontal drag and preserves keyboard activation', async () => {
  const viewport = draggableCalendar();
  const day = control<HTMLButtonElement>('2026-09-16，0 个事件');
  calendarPointer(day, 'pointerdown', 40, 100);
  calendarPointer(window, 'pointermove', 100, 100);
  calendarPointer(window, 'pointerup', 100, 100);
  day.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  expect(viewport.scrollTop).toBe(780);
  expect(viewport.scrollLeft).toBe(0);
  expect(date.value.getDate()).toBe(29);
  day.click();
  await nextTick();
  expect(date.value.getDate()).toBe(16);
});

it.each(['pointercancel', 'lostpointercapture', 'blur'])('stops calendar dragging on %s', async (type) => {
  const viewport = draggableCalendar();
  calendarPointer(viewport, 'pointerdown', 40, 100);
  calendarPointer(window, 'pointermove', 40, 70);
  if (type === 'blur') window.dispatchEvent(new Event('blur'));
  else calendarPointer(type === 'lostpointercapture' ? viewport : window, type, 40, 70);
  calendarPointer(window, 'pointermove', 40, 20);
  await nextTick();
  expect(viewport.scrollTop).toBe(810);
  expect(viewport.classList.contains('dragging')).toBe(false);
  expect(viewport.releasePointerCapture).toHaveBeenCalledWith(1);
});

it('keeps drag movement continuous when the calendar recycles offscreen weeks', async () => {
  const viewport = draggableCalendar();
  viewport.scrollTop = 180;
  calendarPointer(viewport, 'pointerdown', 40, 100);
  calendarPointer(window, 'pointermove', 40, 131);
  viewport.dispatchEvent(new Event('scroll'));
  await nextTick();
  expect(viewport.scrollTop).toBe(809);
  calendarPointer(window, 'pointermove', 40, 141);
  expect(viewport.scrollTop).toBe(799);
  calendarPointer(window, 'pointerup', 40, 141);
  expect(date.value.getDate()).toBe(29);
});

it.each([{ pointerType: 'touch' }, { isPrimary: false }, { button: 2 }])(
  'leaves native touch and non-primary gestures alone: %j', (options) => {
    const viewport = draggableCalendar();
    calendarPointer(viewport, 'pointerdown', 40, 100, options);
    calendarPointer(window, 'pointermove', 40, 70, options);
    calendarPointer(window, 'pointerup', 40, 70, options);
    expect(viewport.scrollTop).toBe(780);
    expect(viewport.setPointerCapture).not.toHaveBeenCalled();
  },
);

async function quickAdd(name: string) {
  control<HTMLButtonElement>('添加未安排任务').click();
  await nextTick();
  const input = control<HTMLInputElement>('事件名称');
  input.value = name;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
}
const submit = () =>
  document
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

async function chooseSchedule(label: string) {
  control<HTMLButtonElement>('时间安排').click();
  await nextTick();
  [...document.querySelectorAll<HTMLButtonElement>('.plan-date-menu button')]
    .find(button => button.textContent?.trim() === label)!.click();
  await nextTick();
}
async function choosePrecision(label: '全天事件' | '精确时间') {
  const buttons = document.querySelectorAll<HTMLButtonElement>('.plan-date-label button');
  expect(buttons).toHaveLength(1);
  expect(buttons[0]!.textContent).toBe(`切换为${label}`);
  buttons[0]!.click();
  await nextTick();
  expect(buttons[0]!.textContent).toBe(label === '全天事件' ? '切换为精确时间' : '切换为全天事件');
}

it.each(['workspace', 'personal'] as const)('uses independent timed-event and unscheduled-task presets in %s', async scope => {
  usePlanStore().view = scope;
  date.value = new Date(2026, 9, 2);
  await nextTick();
  control<HTMLButtonElement>('为 10 月 2 日 添加事件').click();
  await nextTick();
  expect(document.querySelector<HTMLInputElement>('.plan-checkable input')!.checked).toBe(false);
  expect(control<HTMLButtonElement>('时间安排').textContent).toContain('时间段');
  expect([...document.querySelectorAll<HTMLInputElement>('input[type=datetime-local]')].map(input => input.value))
    .toEqual(['2026-10-02T09:00', '2026-10-02T10:00']);
  const name = control<HTMLInputElement>('事件名称');
  name.value = '项目讨论';
  name.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  submit();
  const records = () => scope === 'personal' ? usePlanStore().personal : store.objects;
  await vi.waitFor(() => expect(records()).toHaveLength(1));
  expect(records()[0]!.object.properties).toEqual({
    checkable: false, completed: false,
    start: new Date('2026-10-02T09:00').toISOString(),
    end: new Date('2026-10-02T10:00').toISOString(),
  });
  expect(section('当天安排').textContent).toContain('项目讨论');
  expect(section('当天安排').querySelector('input[type=checkbox]')).toBeNull();

  await quickAdd('整理资料');
  expect(document.querySelector<HTMLInputElement>('.plan-checkable input')!.checked).toBe(true);
  expect(control<HTMLButtonElement>('时间安排').textContent).toContain('未安排');
  expect(document.querySelector('.plan-date-inputs')).toBeNull();
  submit();
  await vi.waitFor(() => expect(records()).toHaveLength(2));
  expect(records().find(record => record.object.name === '整理资料')!.object.properties)
    .toEqual({ checkable: true, completed: false });
  expect(section('未安排任务').textContent).toContain('整理资料');
  expect(section('当天安排').textContent).not.toContain('整理资料');
});

it('creates, completes, reopens and opens one persisted event while the sidebar reflects date changes', async () => {
  const completedToggle = control<HTMLButtonElement>('已完成');
  const completedPanel = document.getElementById(completedToggle.getAttribute('aria-controls')!)!;
  expect(completedToggle.getAttribute('aria-expanded')).toBe('false');
  expect(completedPanel.hidden).toBe(true);
  expect(completedToggle.textContent).toContain('0');
  await quickAdd('整理资料');
  submit();
  await vi.waitFor(() => expect(store.objects).toHaveLength(1));
  const id = store.objects[0]!.object.id;
  expect(store.objects[0]!.object).toMatchObject({
    type: 'event',
    properties: { checkable: true, completed: false },
  });
  expect(section('未安排任务').textContent).toContain('整理资料');
  const details = section('未安排任务').querySelectorAll<HTMLButtonElement>('li button');
  expect(details).toHaveLength(1);
  details[0]!.click();
  expect(selectEvent).toHaveBeenCalledWith(id);
  control<HTMLInputElement>('完成：整理资料').click();
  await vi.waitFor(() => expect(store.objects[0]!.object.properties.completed).toBe(true));
  expect(section('未安排任务').textContent).not.toContain('整理资料');
  expect(completedToggle.textContent).toContain('1');
  expect(completedToggle.getAttribute('aria-expanded')).toBe('false');
  expect(control<HTMLInputElement>('标记未完成：整理资料')).toBeNull();
  completedToggle.click();
  await nextTick();
  expect(completedToggle.getAttribute('aria-expanded')).toBe('true');
  expect(completedPanel.hidden).toBe(false);
  expect(section('已完成任务').textContent).toContain('整理资料');
  completedToggle.click();
  await nextTick();
  expect(completedPanel.hidden).toBe(true);
  expect(control<HTMLInputElement>('标记未完成：整理资料')).toBeNull();
  completedToggle.click();
  await nextTick();
  expect(control<HTMLInputElement>('标记未完成：整理资料').checked).toBe(true);
  control<HTMLInputElement>('标记未完成：整理资料').click();
  await vi.waitFor(() => expect(store.objects[0]!.object.properties.completed).toBe(false));
  expect(completedToggle.textContent).toContain('0');
  expect(section('已完成任务').textContent).toContain('没有已完成的任务');
  expect(section('未安排任务').textContent).toContain('整理资料');
  const record = store.objects[0]!;
  await usePlanStore().update(record, {
    ...record.object,
    properties: { ...record.object.properties, date: '2026-09-29' },
  });
  await vi.waitFor(() => expect(store.objects[0]!.object.properties.date).toBe('2026-09-29'));
  expect(store.objects).toHaveLength(1);
  expect(store.objects[0]!.object.id).toBe(id);
  expect(section('当天安排').textContent).toContain('整理资料');
  expect(section('未安排任务').textContent).not.toContain('整理资料');
  date.value = new Date(2026, 8, 30);
  await nextTick();
  expect(section('当天安排').textContent).not.toContain('整理资料');
  expect(control<HTMLButtonElement>('2026-09-30，0 个事件').getAttribute('aria-pressed')).toBe(
    'true',
  );
  const persisted = JSON.parse(localStorage.getItem('tano.demo.v2')!);
  expect(JSON.parse(persisted.files[store.objects[0]!.path].content).properties.date).toBe(
    '2026-09-29',
  );
  date.value = new Date(2026, 8, 29);
  await nextTick();
  control<HTMLInputElement>('完成：整理资料').click();
  await vi.waitFor(() => expect(store.objects[0]!.object.properties.completed).toBe(true));
  expect(section('当天安排').textContent).toContain('整理资料');
  expect(section('当天安排').querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(true);
  expect(section('已完成任务').textContent).toContain('整理资料');
  expect(section('已完成任务').querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(true);
  expect(section('当天安排').querySelector('.sidebar-calendar-empty')).toBeNull();
  section('已完成任务').querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
  await vi.waitFor(() => expect(store.objects[0]!.object.properties.completed).toBe(false));
  expect(section('当天安排').querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false);
  expect(section('已完成任务').textContent).not.toContain('整理资料');
  section('当天安排').querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
  await vi.waitFor(() => expect(store.objects[0]!.object.properties.completed).toBe(true));
  date.value = new Date(2026, 8, 30);
  await nextTick();
  expect(section('当天安排').textContent).not.toContain('整理资料');
  expect(section('已完成任务').textContent).toContain('整理资料');
  expect(section('已完成任务').textContent).toContain('2026-09-29');
});

it('creates ordinary timed events through the same form and opens their detail', async () => {
  await quickAdd('项目讨论');
  document.querySelector<HTMLInputElement>('.plan-checkable input')!.click();
  await nextTick();
  await choosePrecision('精确时间');
  const completion = document.querySelector<HTMLInputElement>('.plan-checkable input')!;
  completion.click();
  await nextTick();
  completion.click();
  await nextTick();
  expect(document.querySelectorAll('input[type=datetime-local]')).toHaveLength(1);
  submit();
  await vi.waitFor(() => expect(store.objects).toHaveLength(1));
  expect(store.objects[0]!.object).toMatchObject({
    type: 'event',
    properties: { checkable: false },
  });
  expect(calendarEvents(store.objects)).toHaveLength(1);
  expect(store.objects[0]!.object.properties.start).toBe(store.objects[0]!.object.properties.end);
  expect(section('当天安排').textContent).not.toContain('09:00 – 09:00');
  expect(section('当天安排').querySelector('input[type=checkbox]')).toBeNull();
  section('当天安排').querySelector<HTMLButtonElement>('.plan-event-detail')!.click();
  expect(selectEvent).toHaveBeenCalledWith(store.objects[0]!.object.id);
});

it.each(['workspace', 'personal'] as const)('persists a date-only anniversary without completion in %s and preserves the chosen date when toggling completion', async scope => {
  await quickAdd('纪念日');
  if (scope === 'personal') {
    control<HTMLButtonElement>('保存到').click();
    await nextTick();
    document.querySelector<HTMLButtonElement>('[role=menuitemradio][aria-label="个人"]')!.click();
    await nextTick();
  }
  const completion = document.querySelector<HTMLInputElement>('.plan-checkable input')!;
  completion.click();
  await nextTick();
  expect(control<HTMLButtonElement>('时间安排').textContent).toContain('计划日期');
  await choosePrecision('精确时间');
  await choosePrecision('全天事件');
  const day = document.querySelector<HTMLInputElement>('input[type=date]')!;
  day.value = '2026-10-02';
  day.dispatchEvent(new Event('input', { bubbles: true }));
  completion.click();
  await nextTick();
  completion.click();
  await nextTick();
  expect(day.value).toBe('2026-10-02');
  expect(document.querySelector('input[type=datetime-local]')).toBeNull();
  submit();
  const records = () => scope === 'personal' ? usePlanStore().personal : store.objects;
  await vi.waitFor(() => expect(records()).toHaveLength(1));
  expect(records()[0]!.object.properties).toEqual({ checkable: false, completed: false, date: '2026-10-02' });
  expect(JSON.parse(records()[0]!.snapshot.content).properties).toEqual(records()[0]!.object.properties);
  date.value = new Date(2026, 9, 2);
  await nextTick();
  expect(section('当天安排').textContent).toContain('纪念日');
  expect(section('当天安排').querySelector('input[type=checkbox]')).toBeNull();
  expect(section('未安排任务').textContent).not.toContain('纪念日');
});

it.each(['workspace', 'personal'] as const)('switches a range between times and inclusive dates, then saves every included day in %s', async scope => {
  await quickAdd('假期');
  if (scope === 'personal') {
    control<HTMLButtonElement>('保存到').click();
    await nextTick();
    document.querySelector<HTMLButtonElement>('[role=menuitemradio][aria-label="个人"]')!.click();
    await nextTick();
  }
  await chooseSchedule('时间段');
  async function fill(index: number, value: string) {
    const input = document.querySelectorAll<HTMLInputElement>('.plan-date-inputs input')[index]!;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
  }
  const values = () => [...document.querySelectorAll<HTMLInputElement>('.plan-date-inputs input')].map(input => input.value);
  await fill(0, '2026-09-30T23:45');
  await fill(1, '2026-10-02T01:15');
  await choosePrecision('全天事件');
  expect(values()).toEqual(['2026-09-30', '2026-10-02']);
  await chooseSchedule('时间段');
  expect(values()).toEqual(['2026-09-30', '2026-10-02']);
  await fill(0, '2026-10-01');
  expect(values()).toEqual(['2026-10-01', '2026-10-03']);
  await choosePrecision('精确时间');
  expect(values()).toEqual(['2026-10-01T23:45', '2026-10-03T01:15']);
  await choosePrecision('全天事件');
  document.querySelector<HTMLInputElement>('.plan-checkable input')!.click();
  await nextTick();
  expect(values()).toEqual(['2026-10-01', '2026-10-03']);
  submit();
  const records = () => scope === 'personal' ? usePlanStore().personal : store.objects;
  await vi.waitFor(() => expect(records()).toHaveLength(1));
  expect(records()[0]!.object.properties).toEqual({ checkable: false, completed: false, allDay: true, start: new Date('2026-10-01T00:00:00').toISOString(), end: new Date('2026-10-04T00:00:00').toISOString() });
  expect(JSON.parse(records()[0]!.snapshot.content).properties).toEqual(records()[0]!.object.properties);
  for (const day of [1, 2, 3]) {
    date.value = new Date(2026, 9, day);
    await nextTick();
    expect(section('当天安排').textContent).toContain('假期');
    expect(section('当天安排').textContent).toContain('全天');
  }
  date.value = new Date(2026, 9, 4);
  await nextTick();
  expect(section('当天安排').textContent).not.toContain('假期');
});

it('merges day and time into one schedule option, preserves date and time, and supports keyboard navigation and dismissal', async () => {
  await quickAdd('日期任务');
  await chooseSchedule('计划日期');
  const day = document.querySelector<HTMLInputElement>('input[type=date]')!;
  day.value = '2026-10-02';
  day.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  const trigger = control<HTMLButtonElement>('时间安排');
  trigger.click();
  await nextTick();
  const menu = document.querySelector<HTMLElement>('[role=menu]')!;
  expect([...menu.querySelectorAll('[role=menuitemradio]')].map(option => option.textContent?.trim())).toEqual(['未安排', '计划日期', '时间段']);
  expect(document.activeElement?.textContent?.trim()).toBe('计划日期');
  menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  expect(document.activeElement?.textContent?.trim()).toBe('时间段');
  (document.activeElement as HTMLButtonElement).click();
  await nextTick();
  expect(document.querySelector('[role=menu]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(document.querySelector<HTMLInputElement>('input[type=datetime-local]')!.value).toBe('2026-10-02T09:00');
  await chooseSchedule('计划日期');
  expect(document.querySelectorAll('input[type=datetime-local]')).toHaveLength(1);
  const time = document.querySelector<HTMLInputElement>('input[type=datetime-local]')!;
  time.value = '2026-10-02T14:35';
  time.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  await chooseSchedule('计划日期');
  expect(time.value).toBe('2026-10-02T14:35');
  await choosePrecision('全天事件');
  expect(document.querySelector<HTMLInputElement>('input[type=date]')!.value).toBe('2026-10-02');
  await choosePrecision('精确时间');
  expect(document.querySelector<HTMLInputElement>('input[type=datetime-local]')!.value).toBe('2026-10-02T14:35');
  await choosePrecision('全天事件');
  submit();
  await vi.waitFor(() => expect(store.objects).toHaveLength(1));
  expect(store.objects[0]!.object.properties).toMatchObject({
    checkable: true,
    date: '2026-10-02',
  });
  expect(calendarEvents(store.objects)).toHaveLength(0);
  await quickAdd('取消草稿');
  control<HTMLButtonElement>('时间安排').click();
  await nextTick();
  document.activeElement!.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
  await nextTick();
  expect(document.querySelector('[role=menu]')).toBeNull();
  expect(control<HTMLInputElement>('事件名称').value).toBe('取消草稿');
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(document.querySelector('[role=dialog]')).toBeNull());
  expect(store.objects).toHaveLength(1);
});

it('preserves the creation draft and resets completion feedback when storage rejects a write', async () => {
  const create = vi
    .spyOn(store, 'createObject')
    .mockRejectedValueOnce(new Error('保存失败，请重试'));
  await quickAdd('保留草稿');
  submit();
  await vi.waitFor(() =>
    expect(document.querySelector('[role=alert]')?.textContent).toContain('保存失败'),
  );
  expect(control<HTMLInputElement>('事件名称').value).toBe('保留草稿');
  create.mockRestore();
  submit();
  await vi.waitFor(() => expect(store.objects).toHaveLength(1));
  let rejectWrite!: (reason: Error) => void;
  const update = vi.spyOn(store, 'updateObject').mockImplementationOnce(() => new Promise((_resolve, reject) => {
    rejectWrite = reject;
  }));
  const completion = control<HTMLInputElement>('完成：保留草稿');
  completion.click();
  await nextTick();
  expect(completion.checked).toBe(false);
  expect(completion.disabled).toBe(true);
  expect(completion.parentElement!.classList.contains('is-completed')).toBe(true);
  expect(completion.closest('li')!.classList.contains('completed')).toBe(true);
  expect(store.objects[0]!.object.properties.completed).toBe(false);
  completion.click();
  expect(update).toHaveBeenCalledTimes(1);
  rejectWrite(new Error('外部修改冲突'));
  await vi.waitFor(() =>
    expect(root.querySelector('[role=alert]')?.textContent).toContain('外部修改冲突'),
  );
  await nextTick();
  expect(store.objects[0]!.object.properties.completed).toBe(false);
  expect(control<HTMLInputElement>('完成：保留草稿').checked).toBe(false);
  expect(completion.disabled).toBe(false);
  expect(completion.parentElement!.classList.contains('is-completed')).toBe(false);
  expect(completion.closest('li')!.classList.contains('completed')).toBe(false);
});

it('persists completion immediately while keeping the source row visible until its animation finishes', async () => {
  await quickAdd('动画完成前保留事项');
  submit();
  await vi.waitFor(() => expect(store.objects).toHaveLength(1));
  const row = control<HTMLInputElement>('完成：动画完成前保留事项').closest('li')!;
  let finishFade!: () => void;
  const finished = new Promise<void>(resolve => { finishFade = resolve; });
  row.animate = vi.fn();
  vi.mocked(animate).mockReturnValueOnce({ finished, stop: vi.fn(), cancel: vi.fn() } as unknown as ReturnType<typeof animate>);
  control<HTMLInputElement>('完成：动画完成前保留事项').click();
  await vi.waitFor(() => expect(store.objects[0]!.object.properties.completed).toBe(true));
  expect(JSON.parse(store.objects[0]!.snapshot.content).properties.completed).toBe(true);
  expect(row.isConnected).toBe(true);
  expect(section('未安排任务').textContent).toContain('动画完成前保留事项');
  expect(section('未安排任务').querySelector('.sidebar-calendar-empty')).toBeNull();
  finishFade();
  await vi.waitFor(() => expect(row.isConnected).toBe(false));
  expect(section('未安排任务').textContent).not.toContain('动画完成前保留事项');
  expect(section('未安排任务').textContent).toContain('没有未安排的任务');
});

it('opens a separate panel with the selected date and returns keyboard focus when dismissed', async () => {
  const trigger = control<HTMLButtonElement>('为 9 月 29 日 添加事件');
  trigger.focus();
  trigger.click();
  await nextTick();
  const panel = document.querySelector<HTMLElement>('[role=dialog][aria-label="新建事件"]')!;
  expect(panel).not.toBeNull();
  expect(root.contains(panel)).toBe(false);
  expect(root.querySelector('form')).toBeNull();
  expect(document.activeElement).toBe(control<HTMLInputElement>('事件名称'));
  expect(panel.querySelector<HTMLInputElement>('input[type=datetime-local]')!.value).toBe('2026-09-29T09:00');
  const first = control<HTMLButtonElement>('保存到');
  first.focus();
  first.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
  );
  expect(document.activeElement?.textContent?.trim()).toBe('取消');
  panel.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
  await vi.waitFor(() => expect(document.querySelector('[role=dialog]')).toBeNull());
  expect(document.activeElement).toBe(trigger);
  expect(store.objects).toHaveLength(0);
});

it('keeps the panel open during saving and closes it once the event is persisted', async () => {
  const create = store.createObject;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(store, 'createObject').mockImplementation(async (value) => {
    await gate;
    return create(value);
  });
  await quickAdd('等待保存');
  submit();
  await nextTick();
  const panel = document.querySelector<HTMLElement>('[role=dialog]')!;
  expect(panel.querySelector<HTMLButtonElement>('.plan-create-actions button[type=button]')!.disabled).toBe(true);
  panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  panel.parentElement!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await nextTick();
  expect(document.querySelector('[role=dialog]')).toBe(panel);
  release();
  await vi.waitFor(() => expect(document.querySelector('[role=dialog]')).toBeNull());
  expect(section('未安排任务').textContent).toContain('等待保存');
});

it('keeps workspace records read-only while allowing creation in the independent personal space', async () => {
  await store.createObject({
    type: 'task',
    name: '旧接口新任务',
    description: '',
    archived: false,
    properties: { status: 'todo' },
  });
  expect(store.objects[0]!.object.type).toBe('event');
  store.workspace!.readOnly = true;
  await nextTick();
  expect(control<HTMLButtonElement>('添加未安排任务').disabled).toBe(false);
  expect(control<HTMLInputElement>('完成：旧接口新任务').disabled).toBe(true);
  await quickAdd('只读项目之外的个人任务');
  control<HTMLButtonElement>('保存到').click();
  await nextTick();
  expect(document.querySelector<HTMLButtonElement>('[role=menuitemradio][aria-label="工作区"]')!.disabled).toBe(true);
  document.querySelector<HTMLButtonElement>('[role=menuitemradio][aria-label="个人"]')!.click();
  await nextTick();
  submit();
  await vi.waitFor(() => expect(usePlanStore().personal).toHaveLength(1));
  expect(store.objects).toHaveLength(1);
  expect(control<HTMLButtonElement>('计划范围').textContent).toContain('个人');
  control<HTMLInputElement>('完成：只读项目之外的个人任务').click();
  await vi.waitFor(() => expect(usePlanStore().personal[0]!.object.properties.completed).toBe(true));
});

it('defaults to the selected source and scopes detail selection and completion for colliding short IDs', async () => {
  const plans = usePlanStore();
  const shared = await store.createObject({ type: 'event', name: '工作区事项', description: '', archived: false, properties: { checkable: true } });
  const personal = await plans.createPersonal({ type: 'event', name: '个人事项', description: '', archived: false, properties: { checkable: true } });
  // A workspace and personal space allocate IDs independently.
  store.objects[0]!.object.id = personal.object.id;
  plans.view = 'all';
  await nextTick();
  expect(section('未安排任务').textContent).toContain('工作区事项');
  expect(section('未安排任务').textContent).toContain('个人事项');
  control<HTMLInputElement>('完成：个人事项').click();
  await vi.waitFor(() => expect(plans.personal[0]!.object.properties.completed).toBe(true));
  expect(shared.object.properties.completed).not.toBe(true);
  control<HTMLButtonElement>('已完成').click();
  await nextTick();
  expect(section('已完成任务').textContent).toContain('个人事项');
  expect(section('未安排任务').textContent).not.toContain('个人事项');
  const button = [...root.querySelectorAll<HTMLButtonElement>('.plan-event-detail')].find(button => button.textContent!.includes('个人事项'))!;
  button.click();
  expect(selectEvent).toHaveBeenCalledWith(`personal:${plans.personalId}:${personal.object.id}`);
  plans.view = 'workspace';
  await nextTick();
  expect(section('已完成任务').textContent).not.toContain('个人事项');
  expect(section('未安排任务').textContent).toContain('工作区事项');
  plans.view = 'personal';
  await nextTick();
  expect(section('已完成任务').textContent).toContain('个人事项');
  await quickAdd('第二条个人事项');
  expect(control<HTMLButtonElement>('保存到').textContent).toContain('个人');
});

it('keeps ownership in a compact header menu with keyboard navigation and restores focus without closing the draft', async () => {
  await quickAdd('归属菜单');
  const trigger = control<HTMLButtonElement>('保存到');
  expect(document.querySelector('form [aria-label="保存到"]')).toBeNull();
  trigger.click();
  await nextTick();
  expect(document.activeElement?.getAttribute('aria-label')).toBe('工作区');
  const menu = control<HTMLElement>('保存位置');
  menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  expect(document.activeElement?.getAttribute('aria-label')).toBe('个人');
  (document.activeElement as HTMLButtonElement).click();
  await nextTick();
  expect(trigger.textContent).toContain('个人');
  expect(document.activeElement).toBe(trigger);
  trigger.click();
  await nextTick();
  control<HTMLElement>('保存位置').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await nextTick();
  expect(control<HTMLElement>('保存位置')).toBeNull();
  expect(control<HTMLInputElement>('事件名称').value).toBe('归属菜单');
  expect(document.activeElement).toBe(trigger);
});

it('switches the sidebar range from the heading and closes the menu on Escape or outside focus', async () => {
  const trigger = control<HTMLButtonElement>('计划范围');
  expect(root.querySelector('select')).toBeNull();
  trigger.click();
  await nextTick();
  expect(document.activeElement?.getAttribute('aria-label')).toBe('工作区');
  control<HTMLElement>('查看计划').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  expect(document.activeElement?.getAttribute('aria-label')).toBe('个人');
  (document.activeElement as HTMLButtonElement).click();
  await nextTick();
  expect(usePlanStore().view).toBe('personal');
  expect(document.activeElement).toBe(trigger);
  trigger.click();
  await nextTick();
  control<HTMLElement>('查看计划').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await nextTick();
  expect(control<HTMLElement>('查看计划')).toBeNull();
  trigger.click();
  await nextTick();
  control<HTMLButtonElement>('回到今天').focus();
  await nextTick();
  expect(control<HTMLElement>('查看计划')).toBeNull();
});

it.each([
  ['the blank heading area', '.sidebar-calendar-heading', false],
  ['outside content that stops pointer propagation', '.sidebar-calendar-month', true],
] as const)('closes the range menu when pressing %s', async (_name, selector, stopPropagation) => {
  control<HTMLButtonElement>('计划范围').click();
  await nextTick();
  const target = root.querySelector<HTMLElement>(selector)!;
  if (stopPropagation) target.addEventListener('pointerdown', event => event.stopPropagation(), { once: true });
  target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
  await nextTick();
  expect(control<HTMLElement>('查看计划')).toBeNull();
  expect(control<HTMLButtonElement>('计划范围').getAttribute('aria-expanded')).toBe('false');
});

it('explains an outdated desktop host only in personal views and resumes after an explicit retry', async () => {
  const plans = usePlanStore();
  const failure = vi.spyOn(BrowserPersonalPlans.prototype, 'refresh').mockRejectedValue('Command personal_plans_list not found');
  await plans.refreshPersonal();
  await nextTick();
  expect(plans.requiresDesktopRestart).toBe(true);
  expect(plans.personalWritable).toBe(false);
  expect(root.querySelector('.plan-load-notice')).toBeNull();
  expect(root.textContent).not.toContain('personal_plans_list');
  const count = failure.mock.calls.length;
  window.dispatchEvent(new Event('focus'));
  await nextTick();
  expect(failure).toHaveBeenCalledTimes(count);
  plans.view = 'personal';
  await nextTick();
  expect(root.querySelector('summary')?.textContent).toContain('需更新桌面程序');
  expect(root.querySelector('.plan-load-notice')?.textContent).toContain('更新并重启应用');
  expect(root.textContent).not.toContain('这一天没有安排');
  failure.mockRestore();
  root.querySelector<HTMLButtonElement>('.plan-load-notice button')!.click();
  await vi.waitFor(() => expect(root.querySelector('.plan-load-notice')).toBeNull());
  expect(plans.requiresDesktopRestart).toBe(false);
  expect(plans.personalWritable).toBe(true);
});
