import { validEventDate, validEventTime, validateObjectProperties } from '@tano/protocol';
import type { ObjectRecord } from './workspace-objects';

export const CALENDAR_TAB_ID = 'view:calendar';
export type CalendarViewMode = 'day' | 'four-days' | 'week' | 'month' | 'year' | 'agenda';

export const localDayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const localDateTime = (date: Date) =>
  `${localDayKey(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
export function weekDays(date: Date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
  return Array.from({ length: 7 }, (_, index) =>
    new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index));
}
export function visibleCalendarDays(date: Date, mode: CalendarViewMode) {
  if (mode === 'week') return weekDays(date);
  const count = mode === 'four-days' ? 4 : 1;
  return Array.from({ length: count }, (_, index) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate() + index));
}
export function shiftCalendarDate(date: Date, mode: CalendarViewMode, offset: number) {
  if (mode === 'year' || mode === 'month' || mode === 'agenda') {
    const first = new Date(date.getFullYear(), date.getMonth() + offset * (mode === 'year' ? 12 : 1), 1);
    const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    return new Date(first.getFullYear(), first.getMonth(), Math.min(date.getDate(), lastDay));
  }
  const days = mode === 'week' ? 7 : mode === 'four-days' ? 4 : 1;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset * days);
}
export function calendarPeriodTitle(date: Date, mode: CalendarViewMode) {
  if (mode === 'year') return `${date.getFullYear()} 年`;
  if (mode === 'month' || mode === 'agenda')
    return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
  const days = visibleCalendarDays(date, mode);
  const first = days[0]!;
  const last = days.at(-1)!;
  if (mode === 'day')
    return `${first.getFullYear()} 年 ${first.getMonth() + 1} 月 ${first.getDate()} 日`;
  if (first.getFullYear() === last.getFullYear() && first.getMonth() === last.getMonth())
    return `${first.getFullYear()} 年 ${first.getMonth() + 1} 月 · ${first.getDate()}–${last.getDate()} 日`;
  return `${first.getFullYear()} 年 ${first.getMonth() + 1} 月 ${first.getDate()} 日 – ${first.getFullYear() === last.getFullYear() ? '' : `${last.getFullYear()} 年 `}${last.getMonth() + 1} 月 ${last.getDate()} 日`;
}
export function monthDays(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  return Array.from(
    { length: 42 },
    (_, index) => new Date(month.getFullYear(), month.getMonth(), index - offset + 1),
  );
}
export const isCheckableEvent = ({ object }: ObjectRecord) =>
  object.type === 'task' || (object.type === 'event' && object.properties.checkable === true);
export const isEventCompleted = ({ object }: ObjectRecord) =>
  object.properties.completed === true || (object.type === 'task' && ['done', 'completed'].includes(String(object.properties.status)));
export const hasEventTime = ({ object: { properties } }: ObjectRecord) =>
  validEventTime(properties.start) && validEventTime(properties.end) && Date.parse(properties.end) >= Date.parse(properties.start);

/** Planning includes date-only and unscheduled tasks as well as timed events. */
export function planningEvents(records: readonly ObjectRecord[]) {
  return records
    .filter(({ object }) => {
      if (!['event', 'task'].includes(object.type) || object.archived) return false;
      try {
        validateObjectProperties(object.type, object.properties);
        return true;
      } catch {
        return false;
      }
    })
    .sort(
      (a, b) =>
        Number(isEventCompleted(a)) - Number(isEventCompleted(b)) ||
        (hasEventTime(a) ? Date.parse(String(a.object.properties.start)) : 0) -
          (hasEventTime(b) ? Date.parse(String(b.object.properties.start)) : 0) || a.object.id.localeCompare(b.object.id),
    );
}
export function calendarEvents(records: readonly ObjectRecord[]) {
  return planningEvents(records).filter(hasEventTime);
}
export function plannedEventsOnDay(records: readonly ObjectRecord[], day: Date) {
  const timed = new Set(eventsOnDay(records.filter(hasEventTime), day));
  return records.filter(record => timed.has(record) || (!hasEventTime(record) && record.object.properties.date === localDayKey(day)));
}
export function unscheduledTasks(records: readonly ObjectRecord[]) {
  return records.filter(record => isCheckableEvent(record) && !hasEventTime(record) && !validEventDate(record.object.properties.date));
}
/** Half-open ranges: an event ending at midnight does not occupy the following day. */
export function eventsOnDay(records: readonly ObjectRecord[], day: Date) {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
  return records.filter(({ object }) => {
    const from = Date.parse(String(object.properties.start)),
      to = Date.parse(String(object.properties.end));
    return from < end && (to > start || (from === to && from >= start));
  });
}
