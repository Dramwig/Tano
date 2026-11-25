import { expect, it } from 'vitest';
import type { WorkspaceObject } from '@tano/protocol';
import {
  buildTimedProperties,
  minutesFromOffsetY,
  moveRecordToDay,
  moveRecordToSlot,
  planDateFromSlot,
  resizeRecordEnd,
  selectionRangeFromOffsets,
  snapMinutes,
} from './calendar-interaction';

const make = (properties: Record<string, unknown>): WorkspaceObject => ({
  version: 1,
  id: 'a00001',
  type: 'event',
  name: '排期任务',
  description: '说明',
  archived: false,
  properties,
});

it('snaps offsets and computes click vs drag selection ranges within day bounds', () => {
  expect(snapMinutes(37)).toBe(30);
  expect(snapMinutes(38)).toBe(45);
  expect(snapMinutes(-20)).toBe(0);
  expect(snapMinutes(2000)).toBe(24 * 60);

  expect(minutesFromOffsetY(56 * 9.25, 56)).toBe(9 * 60 + 15);

  // Simple click defaults to 1 hour aligned to 15-minute floor
  expect(selectionRangeFromOffsets(56 * 9.2, 56 * 9.2 + 2, 56)).toEqual({
    startMinutes: 9 * 60,
    endMinutes: 10 * 60,
  });

  // Upward drag normalizes start < end with >= 30m duration
  expect(selectionRangeFromOffsets(56 * 11, 56 * 9.5, 56)).toEqual({
    startMinutes: 9 * 60 + 30,
    endMinutes: 11 * 60,
  });

  // Tiny drag enforces 30m minimum
  expect(selectionRangeFromOffsets(56 * 10, 56 * 10 + 10, 56)).toEqual({
    startMinutes: 10 * 60,
    endMinutes: 10 * 60 + 30,
  });
});

it('moves timed, multi-day, and unscheduled tasks to a target day while preserving due and metadata', () => {
  const day = new Date(2026, 9, 5);

  const timed = make({
    checkable: true,
    due: '2026-10-10',
    start: new Date(2026, 9, 1, 14, 30).toISOString(),
    end: new Date(2026, 9, 1, 16, 0).toISOString(),
  });
  const movedTimed = moveRecordToDay(timed, day);
  expect(movedTimed.properties.due).toBe('2026-10-10');
  expect(new Date(String(movedTimed.properties.start)).getDate()).toBe(5);
  expect(new Date(String(movedTimed.properties.start)).getHours()).toBe(14);
  expect(Date.parse(String(movedTimed.properties.end)) - Date.parse(String(movedTimed.properties.start))).toBe(90 * 60_000);

  const multiDay = make({ date: '2026-10-01', endDate: '2026-10-03', checkable: false });
  expect(moveRecordToDay(multiDay, day).properties).toEqual({
    date: '2026-10-05',
    endDate: '2026-10-07',
    checkable: false,
  });

  const unscheduled = make({ checkable: true, completed: false, due: '2026-10-12' });
  expect(moveRecordToDay(unscheduled, day).properties).toEqual({
    checkable: true,
    completed: false,
    due: '2026-10-12',
    date: '2026-10-05',
  });
});

it('timeblocks unscheduled tasks and preserves duration when moving timed events to a new slot', () => {
  const day = new Date(2026, 9, 6);
  const unscheduled = make({ checkable: true, completed: false, due: '2026-10-12' });
  const scheduled = moveRecordToSlot(unscheduled, day, 10 * 60 + 30);
  expect(scheduled.properties.due).toBe('2026-10-12');
  expect(new Date(String(scheduled.properties.start)).getHours()).toBe(10);
  expect(new Date(String(scheduled.properties.start)).getMinutes()).toBe(30);
  expect(Date.parse(String(scheduled.properties.end)) - Date.parse(String(scheduled.properties.start))).toBe(60 * 60_000);

  const ninetyMin = make({
    checkable: false,
    start: new Date(2026, 9, 1, 9, 0).toISOString(),
    end: new Date(2026, 9, 1, 10, 30).toISOString(),
  });
  const movedSlot = moveRecordToSlot(ninetyMin, day, 15 * 60);
  expect(Date.parse(String(movedSlot.properties.end)) - Date.parse(String(movedSlot.properties.start))).toBe(90 * 60_000);
});

it('resizes timed event end with 15-minute minimum and formats quick-create slot dates', () => {
  const day = new Date(2026, 9, 6);
  const base = make(buildTimedProperties({ checkable: true }, day, 9 * 60, 10 * 60));

  const longer = resizeRecordEnd(base, day, 11 * 60 + 30);
  expect(Date.parse(String(longer.properties.end)) - Date.parse(String(longer.properties.start))).toBe(150 * 60_000);

  // Attempting to shrink past start clamps to 15-minute minimum
  const clamped = resizeRecordEnd(base, day, 8 * 60);
  expect(Date.parse(String(clamped.properties.end)) - Date.parse(String(clamped.properties.start))).toBe(15 * 60_000);

  expect(planDateFromSlot(day, 9 * 60 + 15, 10 * 60 + 45)).toEqual({
    date: '2026-10-06',
    time: '09:15',
    end: '2026-10-06T10:45',
  });
});
