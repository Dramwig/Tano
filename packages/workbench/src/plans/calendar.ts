import {
  isActionableTask,
  isPlanCompleted,
  isPlanObject,
  validEventDate,
  validEventTime,
  validateObjectProperties,
} from '@tano/protocol';
import type { ObjectRecord } from '../objects/workspace-objects';
import { localDayKey } from '@tano/protocol/assistant-tasks';
import { uiLocale } from '../i18n/i18n';

export const CALENDAR_TAB_ID = 'view:calendar';
export type CalendarViewMode = 'day' | 'four-days' | 'week' | 'month' | 'year' | 'agenda';

export { localDayKey };
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
  if (uiLocale.value !== 'zh-CN') {
    if (mode === 'year') return date.toLocaleDateString(uiLocale.value, { year: 'numeric' });
    if (mode === 'month' || mode === 'agenda') return date.toLocaleDateString(uiLocale.value, { month: 'long', year: 'numeric' });
    const days = visibleCalendarDays(date, mode);
    const format = new Intl.DateTimeFormat(uiLocale.value, { year: 'numeric', month: 'short', day: 'numeric' });
    return mode === 'day' ? format.format(date) : format.formatRange(days[0]!, days.at(-1)!);
  }
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
export const isCheckableEvent = ({ object }: ObjectRecord) => isActionableTask(object);
export const isEventCompleted = ({ object }: ObjectRecord) => isPlanCompleted(object);
export const hasEventTime = ({ object: { properties } }: ObjectRecord) =>
  validEventTime(properties.start) && validEventTime(properties.end) && Date.parse(properties.end) >= Date.parse(properties.start);
export const eventDueDate = ({ object: { properties } }: ObjectRecord): string | null =>
  validEventDate(properties.due) ? properties.due : null;
export const isEventOverdue = (record: ObjectRecord, today = localDayKey(new Date())) => {
  const due = eventDueDate(record);
  return isCheckableEvent(record) && !isEventCompleted(record) && due !== null && due < today;
};
export const isDateOnlyOnDay = ({ object: { properties } }: ObjectRecord, day: Date) => {
  if (validEventTime(properties.start) && validEventTime(properties.end)) return false;
  if (!validEventDate(properties.date)) return false;
  const key = localDayKey(day);
  if (validEventDate(properties.endDate)) return properties.date <= key && key <= properties.endDate;
  return properties.date === key;
};

export interface CalendarFilter {
  kind: 'all' | 'task' | 'event';
  showCompleted: boolean;
  query: string;
}

export function filterCalendarRecords(records: readonly ObjectRecord[], filter: CalendarFilter) {
  const needle = filter.query.trim().toLocaleLowerCase();
  return records.filter((record) => {
    const checkable = isCheckableEvent(record);
    if (filter.kind === 'task' && !checkable) return false;
    if (filter.kind === 'event' && checkable) return false;
    if (!filter.showCompleted && checkable && isEventCompleted(record)) return false;
    if (needle && !`${record.object.name}\n${record.object.description}`.toLocaleLowerCase().includes(needle)) return false;
    return true;
  });
}

/** Planning includes date-only and unscheduled tasks as well as timed events. */
export function planningEvents(records: readonly ObjectRecord[]) {
  return records
    .filter(({ object }) => {
      if (!isPlanObject(object) || object.archived) return false;
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
  return records.filter(record => timed.has(record) || isDateOnlyOnDay(record, day));
}
export interface CalendarDayEntry {
  record: ObjectRecord;
  kind: 'timed' | 'all-day' | 'due';
}
/** Combines scheduled items on a day with tasks whose due date falls on that day. */
export function calendarDayEntries(records: readonly ObjectRecord[], day: Date): CalendarDayEntry[] {
  const dayKey = localDayKey(day);
  const timed = new Set(eventsOnDay(records.filter(hasEventTime), day));
  const entries: CalendarDayEntry[] = [];
  for (const record of records) {
    if (timed.has(record)) {
      entries.push({ record, kind: record.object.properties.allDay === true ? 'all-day' : 'timed' });
    } else if (isDateOnlyOnDay(record, day)) {
      entries.push({ record, kind: 'all-day' });
    } else if (eventDueDate(record) === dayKey) {
      entries.push({ record, kind: 'due' });
    }
  }
  return entries;
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
