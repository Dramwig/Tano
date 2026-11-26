import { expect, it } from 'vitest';
import type { ObjectRecord } from '../objects/workspace-objects';
import { layoutDayTimedEvents } from './timeline-layout';

const day = new Date(2026, 8, 30);
const make = (id: string, startHour: number, endHour: number, extra: Record<string, unknown> = {}): ObjectRecord => ({
  path: `.tano/objects/${id}.tano.json`,
  snapshot: { hash: 'h', content: '', modified: 0 },
  object: {
    version: 1,
    id,
    type: 'event',
    name: id,
    description: '',
    archived: false,
    properties: {
      start: new Date(2026, 8, 30, Math.floor(startHour), Math.round((startHour % 1) * 60)).toISOString(),
      end: new Date(2026, 8, 30, Math.floor(endHour), Math.round((endHour % 1) * 60)).toISOString(),
      ...extra,
    },
  },
});

it('packs overlapping events into side-by-side columns while keeping isolated events full-width', () => {
  const blocks = layoutDayTimedEvents(
    [
      make('a00001', 9, 11),
      make('a00002', 9.5, 10.5),
      make('a00003', 10.5, 12),
      make('a00004', 14, 15),
    ],
    day,
    56,
  );
  const byId = new Map(blocks.map((block) => [block.record.object.id, block]));
  // a00001 (9-11), a00002 (9:30-10:30), a00003 (10:30-12) form one 2-column cluster:
  // a00003 reuses column 1 after a00002 ends at 10:30.
  expect(byId.get('a00001')).toMatchObject({ column: 0, columnCount: 2 });
  expect(byId.get('a00002')).toMatchObject({ column: 1, columnCount: 2 });
  expect(byId.get('a00003')).toMatchObject({ column: 1, columnCount: 2 });
  // a00004 (14-15) is a separate cluster and stays full width.
  expect(byId.get('a00004')).toMatchObject({ column: 0, columnCount: 1 });
});

it('separates simultaneous zero-duration point events and excludes all-day ranges', () => {
  const blocks = layoutDayTimedEvents(
    [
      make('b00001', 10, 10),
      make('b00002', 10, 10),
      make('b00003', 0, 24, { allDay: true }),
    ],
    day,
    56,
  );
  expect(blocks).toHaveLength(2);
  expect(blocks.map((b) => [b.record.object.id, b.column, b.columnCount, b.point])).toEqual([
    ['b00001', 0, 2, true],
    ['b00002', 1, 2, true],
  ]);
});
