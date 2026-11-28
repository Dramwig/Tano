import { describe, expect, it } from 'vitest';
import type { ObjectRecord } from '../objects/workspace-objects';
import { buildCalendarDayIndex, getCachedDayTimedLayout, getPlanRecordMeta } from './plan-index';
import { computeHysteresisRange } from './composables/use-calendar-viewport';

function makeRecord(id: string, name: string, properties: Record<string, unknown>, archived = false): ObjectRecord {
  return {
    path: `.tano/objects/${id}.tano.json`,
    snapshot: { content: '', hash: id, modified: 0 },
    object: {
      version: 1,
      id,
      type: 'event',
      name,
      description: '',
      archived,
      properties,
    },
  };
}

describe('plan-index', () => {
  it('buckets timed, all-day, multi-day, and due items accurately and skips out-of-window records', () => {
    const timed = makeRecord('000001', 'Morning sync', {
      checkable: false,
      completed: false,
      start: new Date('2026-05-10T09:00:00').toISOString(),
      end: new Date('2026-05-10T10:00:00').toISOString(),
    });
    const allDayRange = makeRecord('000002', 'Offsite', {
      checkable: false,
      completed: false,
      date: '2026-05-10',
      endDate: '2026-05-12',
    });
    const dueOnly = makeRecord('000003', 'Submit report', {
      checkable: true,
      completed: false,
      due: '2026-05-11',
    });
    const outside = makeRecord('000004', 'Next year', {
      checkable: false,
      completed: false,
      date: '2027-01-05',
    });

    const idx = buildCalendarDayIndex(
      [timed, allDayRange, dueOnly, outside],
      new Date(2026, 4, 9),
      new Date(2026, 4, 13),
    );

    expect(idx.inWindowRecords.map((r) => r.object.id)).toEqual(['000002', '000003', '000001']);
    expect(idx.timedByDay.get('2026-05-10')?.map((r) => r.object.id)).toEqual(['000001']);
    expect(idx.bannerByDay.get('2026-05-10')?.map((e) => `${e.record.object.id}:${e.kind}`)).toEqual(['000002:all-day']);
    expect(idx.bannerByDay.get('2026-05-11')?.map((e) => `${e.record.object.id}:${e.kind}`)).toEqual([
      '000002:all-day',
      '000003:due',
    ]);
    expect(idx.countByDay.get('2026-05-10')).toBe(2);
    expect(idx.countByDay.get('2026-05-11')).toBe(2);
    expect(idx.countByDay.get('2026-05-12')).toBe(1);
    expect(idx.countByDay.get('2027-01-05')).toBeUndefined();
  });

  it('expands recurring series only within the requested window and respects filter', () => {
    const recurring = makeRecord('000010', 'Daily standup', {
      checkable: true,
      completed: false,
      start: new Date('2026-05-01T09:30:00').toISOString(),
      end: new Date('2026-05-01T10:00:00').toISOString(),
      repeat: { version: 1, mode: 'schedule', frequency: 'daily', interval: 1, anchor: '2026-05-01' },
    });

    const idx = buildCalendarDayIndex(
      [recurring],
      new Date(2026, 4, 5),
      new Date(2026, 4, 7),
      { kind: 'task', showCompleted: true, query: 'standup' },
    );

    expect(idx.countByDay.get('2026-05-05')).toBe(1);
    expect(idx.countByDay.get('2026-05-06')).toBe(1);
    expect(idx.countByDay.get('2026-05-07')).toBe(1);
    expect(idx.countByDay.get('2026-05-04')).toBeUndefined();
    expect(idx.countByDay.get('2026-05-08')).toBeUndefined();
  });

  it('caches parsed metadata and day timed layout by object reference', () => {
    const rec = makeRecord('000020', 'Design review', {
      checkable: false,
      completed: false,
      start: new Date('2026-05-10T14:00:00').toISOString(),
      end: new Date('2026-05-10T15:00:00').toISOString(),
    });
    expect(getPlanRecordMeta(rec)).toBe(getPlanRecordMeta(rec));

    const dayRecords = [rec];
    const day = new Date(2026, 4, 10);
    const first = getCachedDayTimedLayout(dayRecords, day, 56);
    const second = getCachedDayTimedLayout(dayRecords, day, 56);
    expect(first).toBe(second);
    expect(first).toHaveLength(1);
  });
});

describe('computeHysteresisRange', () => {
  it('keeps the existing range while scrolling within buffer margins and shifts only near edges', () => {
    const initial = computeHysteresisRange(null, 14, 20, 42, 4, 2);
    expect(initial).toEqual({ start: 10, end: 24 });

    // Scrolling 1 day right stays inside triggerMargin (2): exact same object reference returned
    const within = computeHysteresisRange(initial, 15, 21, 42, 4, 2);
    expect(within).toBe(initial);

    // Reaching within 2 days of end (23 > 24 - 2) shifts the window
    const shifted = computeHysteresisRange(initial, 17, 23, 42, 4, 2);
    expect(shifted).toEqual({ start: 13, end: 27 });
  });

  it('expands without pruning when preserveExisting is true (during drag)', () => {
    const initial = { start: 10, end: 24 };
    const expanded = computeHysteresisRange(initial, 18, 24, 42, 4, 2, true);
    expect(expanded).toEqual({ start: 10, end: 28 });
  });
});
