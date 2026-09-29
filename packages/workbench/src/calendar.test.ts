import { expect, it } from 'vitest';
import { calendarEvents, eventsOnDay, monthDays } from './calendar';
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
