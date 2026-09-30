import { expect, it } from 'vitest';
import { calendarEvents, calendarPeriodTitle, eventsOnDay, monthDays, shiftCalendarDate, visibleCalendarDays, weekDays, planningEvents, plannedEventsOnDay, unscheduledTasks, isEventCompleted } from './calendar';
import type { ObjectRecord } from './workspace-objects';
const event = (id: string, start: string, end: string, archived = false): ObjectRecord => ({
  path: `${id}.tano.json`,
  snapshot: { hash: 'h', content: '', modified: 0 },
  object: {
    version: 1,
    id,
    type: 'event',
    name: id,
    archived,
    description: '',
    properties: { start, end },
  },
});
it('lays out Monday-first weeks across leap days and year boundaries', () => {
  const leap = monthDays(new Date(2028, 1, 1));
  expect(leap).toHaveLength(42);
  expect(leap[0]!.getDay()).toBe(1);
  expect(leap.filter((date) => date.getMonth() === 1)).toHaveLength(29);
  const january = monthDays(new Date(2027, 0, 1));
  expect(january[0]!.getFullYear()).toBe(2026);
});
it('lays out the visible week from Monday to Sunday across months', () => {
  expect(weekDays(new Date(2026, 9, 1)).map(day => day.getDate())).toEqual([28, 29, 30, 1, 2, 3, 4]);
});
it('moves each calendar view by its visible period across date boundaries', () => {
  const date = new Date(2026, 11, 31);
  expect(visibleCalendarDays(date, 'four-days').map(day => day.getDate())).toEqual([31, 1, 2, 3]);
  expect(shiftCalendarDate(date, 'day', 1).getFullYear()).toBe(2027);
  expect(shiftCalendarDate(date, 'four-days', 1).getDate()).toBe(4);
  expect(shiftCalendarDate(date, 'week', 1).getDate()).toBe(7);
  expect(shiftCalendarDate(date, 'month', 1).getMonth()).toBe(0);
  expect(shiftCalendarDate(new Date(2026, 0, 31), 'month', 1).getDate()).toBe(28);
  expect(shiftCalendarDate(date, 'agenda', 1).getFullYear()).toBe(2027);
  expect(shiftCalendarDate(date, 'year', 1).getFullYear()).toBe(2027);
  expect(calendarPeriodTitle(date, 'four-days')).toBe('2026 年 12 月 31 日 – 2027 年 1 月 3 日');
});
it('includes cross-day and zero-duration events, excludes midnight end, archived and invalid events', () => {
  const start = new Date(2026, 8, 26, 23).toISOString(),
    midnight = new Date(2026, 8, 27).toISOString(),
    end = new Date(2026, 8, 27, 1).toISOString();
  const rows = calendarEvents([
    event('a00001', start, midnight),
    event('a00002', start, end),
    event('a00003', midnight, midnight),
    event('a00004', start, end, true),
    event('a00005', 'bad', end),
    event('a00006', end, start),
  ]);
  expect(rows).toHaveLength(3);
  expect(eventsOnDay(rows, new Date(2026, 8, 27)).map((row) => row.object.id)).toEqual([
    'a00002',
    'a00003',
  ]);
});
it('separates unscheduled, date-only and timed events without copying a task into a second event', () => {
  const make = (id: string, properties: Record<string, unknown>): ObjectRecord => ({
    ...event(id, '', ''), object: { ...event(id, '', '').object, properties },
  });
  const rows = planningEvents([
    make('a00001', { checkable: true }),
    make('a00002', { checkable: true, date: '2026-09-29' }),
    make('a00003', { checkable: true, completed: true, start: new Date(2026, 8, 29, 9).toISOString(), end: new Date(2026, 8, 29, 10).toISOString() }),
    make('a00004', { checkable: true, date: 'bad' }),
    { ...make('a00005', {}), object: { ...make('a00005', {}).object, type: 'task', properties: { status: 'done' } } },
  ]);
  expect(rows).toHaveLength(4);
  expect(unscheduledTasks(rows).map(row => row.object.id)).toEqual(['a00001', 'a00005']);
  expect(plannedEventsOnDay(rows, new Date(2026, 8, 29)).map(row => row.object.id)).toEqual(['a00002', 'a00003']);
  expect(calendarEvents(rows).map(row => row.object.id)).toEqual(['a00003']);
  expect(isEventCompleted(rows.find(row => row.object.id === 'a00005')!)).toBe(true);
});

it('keeps anniversaries on their local date without a time slot or completion state', () => {
  const anniversary = event('a00001', '', '');
  anniversary.object.properties = { checkable: false, completed: false, date: '2028-02-29' };
  const rows = planningEvents([anniversary]);
  expect(plannedEventsOnDay(rows, new Date(2028, 1, 29))).toEqual([anniversary]);
  expect(plannedEventsOnDay(rows, new Date(2028, 1, 28))).toEqual([]);
  expect(plannedEventsOnDay(rows, new Date(2028, 2, 1))).toEqual([]);
  expect(calendarEvents(rows)).toEqual([]);
  expect(unscheduledTasks(rows)).toEqual([]);
});
