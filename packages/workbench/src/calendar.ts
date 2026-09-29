import { validateObjectProperties } from '@tano/protocol';
import type { ObjectRecord } from './workspace-objects';

export const localDayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const localDateTime = (date: Date) =>
  `${localDayKey(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
export function monthDays(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  return Array.from(
    { length: 42 },
    (_, index) => new Date(month.getFullYear(), month.getMonth(), index - offset + 1),
  );
}
export function calendarEvents(records: readonly ObjectRecord[]) {
  return records
    .filter(({ object }) => {
      if (object.type !== 'event' || object.archived) return false;
      try {
        validateObjectProperties('event', object.properties);
        return true;
      } catch {
        return false;
      }
    })
    .sort(
      (a, b) =>
        Date.parse(String(a.object.properties.start)) -
          Date.parse(String(b.object.properties.start)) || a.object.id.localeCompare(b.object.id),
    );
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
