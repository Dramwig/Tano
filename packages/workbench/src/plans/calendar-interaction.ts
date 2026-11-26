import type { WorkspaceObject } from '@tano/protocol';
import { validEventDate, validEventTime } from '@tano/protocol';
import { localDateTime, localDayKey } from './calendar';
import type { PlanDateValue } from './plan-date';

export const PLAN_DRAG_MIME = 'application/x-tano-plan-key';
export const SNAP_MINUTES = 15;
export const MIN_DURATION_MINUTES = 15;
export const DEFAULT_CLICK_DURATION_MINUTES = 60;
const DAY_MINUTES = 24 * 60;

export function snapMinutes(minutes: number, step = SNAP_MINUTES): number {
  const clamped = Math.max(0, Math.min(DAY_MINUTES, minutes));
  return Math.max(0, Math.min(DAY_MINUTES, Math.round(clamped / step) * step));
}

export function minutesFromOffsetY(offsetY: number, hourHeight: number, step = SNAP_MINUTES): number {
  if (!Number.isFinite(offsetY) || hourHeight <= 0) return 0;
  return snapMinutes((offsetY / hourHeight) * 60, step);
}

export function selectionRangeFromOffsets(
  anchorY: number,
  currentY: number,
  hourHeight: number,
  step = SNAP_MINUTES,
): { startMinutes: number; endMinutes: number } {
  if (Math.abs(currentY - anchorY) < 6) {
    const raw = Math.max(0, Math.min(DAY_MINUTES - step, (anchorY / hourHeight) * 60));
    const startMinutes = Math.floor(raw / step) * step;
    const endMinutes = Math.min(DAY_MINUTES, startMinutes + DEFAULT_CLICK_DURATION_MINUTES);
    return { startMinutes, endMinutes };
  }
  const a = minutesFromOffsetY(anchorY, hourHeight, step);
  const b = minutesFromOffsetY(currentY, hourHeight, step);
  const startMinutes = Math.min(a, b);
  const endMinutes = Math.min(DAY_MINUTES, Math.max(startMinutes + 30, Math.max(a, b)));
  if (startMinutes >= DAY_MINUTES) {
    return { startMinutes: DAY_MINUTES - 30, endMinutes: DAY_MINUTES };
  }
  return { startMinutes, endMinutes };
}

export function formatMinutesLabel(minutes: number): string {
  const clamped = Math.max(0, Math.min(DAY_MINUTES, Math.round(minutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function planDateFromSlot(day: Date, startMinutes: number, endMinutes: number): PlanDateValue {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, startMinutes);
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, Math.max(startMinutes + MIN_DURATION_MINUTES, endMinutes));
  const startLocal = localDateTime(start);
  return {
    date: startLocal.slice(0, 10),
    time: startLocal.slice(11, 16),
    end: localDateTime(end),
  };
}

export function buildTimedProperties(
  properties: Record<string, unknown>,
  day: Date,
  startMinutes: number,
  endMinutes: number,
): Record<string, unknown> {
  const safeStart = Math.max(0, Math.min(DAY_MINUTES - MIN_DURATION_MINUTES, startMinutes));
  const safeEnd = Math.max(safeStart + MIN_DURATION_MINUTES, Math.min(DAY_MINUTES, endMinutes));
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, safeStart);
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, safeEnd);
  const next: Record<string, unknown> = { ...properties };
  delete next.date;
  delete next.endDate;
  delete next.allDay;
  next.start = start.toISOString();
  next.end = end.toISOString();
  return next;
}

function addCalendarDays(dateKey: string, deltaDays: number): string {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + deltaDays);
  return localDayKey(date);
}

function calendarDayDelta(fromDayKey: string, toDayKey: string): number {
  return Math.round(
    (Date.parse(`${toDayKey}T00:00:00Z`) - Date.parse(`${fromDayKey}T00:00:00Z`)) / 86_400_000,
  );
}

/** Moves an event or task to a target calendar day, preserving its time-of-day duration or span. */
export function moveRecordToDay<T extends WorkspaceObject>(object: T, targetDay: Date): T {
  const p = object.properties;
  const targetKey = localDayKey(targetDay);
  const next: Record<string, unknown> = { ...p };

  if (validEventTime(p.start) && validEventTime(p.end)) {
    const startDate = new Date(p.start);
    const endDate = new Date(p.end);
    const delta = calendarDayDelta(localDayKey(startDate), targetKey);
    if (p.allDay === true) {
      const movedStart = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + delta);
      const movedEnd = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() + delta);
      next.start = movedStart.toISOString();
      next.end = movedEnd.toISOString();
      next.allDay = true;
    } else {
      const durationMs = Math.max(0, endDate.getTime() - startDate.getTime());
      const movedStart = new Date(
        targetDay.getFullYear(),
        targetDay.getMonth(),
        targetDay.getDate(),
        startDate.getHours(),
        startDate.getMinutes(),
        startDate.getSeconds(),
        startDate.getMilliseconds(),
      );
      next.start = movedStart.toISOString();
      next.end = new Date(movedStart.getTime() + durationMs).toISOString();
    }
    return { ...object, properties: next };
  }

  delete next.start;
  delete next.end;
  delete next.allDay;
  if (validEventDate(p.date) && validEventDate(p.endDate)) {
    const delta = calendarDayDelta(p.date, targetKey);
    next.date = targetKey;
    next.endDate = addCalendarDays(p.endDate, delta);
  } else {
    delete next.endDate;
    next.date = targetKey;
  }
  return { ...object, properties: next };
}

/** Moves or timeblocks a record into a specific timed slot on a target day, preserving existing duration if timed. */
export function moveRecordToSlot<T extends WorkspaceObject>(
  object: T,
  targetDay: Date,
  startMinutes: number,
  fallbackDurationMinutes = DEFAULT_CLICK_DURATION_MINUTES,
): T {
  const p = object.properties;
  let durationMinutes = fallbackDurationMinutes;
  if (validEventTime(p.start) && validEventTime(p.end) && p.allDay !== true) {
    const existing = Math.round((Date.parse(p.end) - Date.parse(p.start)) / 60_000);
    if (existing >= MIN_DURATION_MINUTES) durationMinutes = existing;
    else if (existing === 0) durationMinutes = 0;
  }
  const safeStart = Math.max(0, Math.min(DAY_MINUTES - MIN_DURATION_MINUTES, snapMinutes(startMinutes)));
  const start = new Date(targetDay.getFullYear(), targetDay.getMonth(), targetDay.getDate(), 0, safeStart);
  const end = durationMinutes === 0
    ? new Date(start.getTime())
    : new Date(
        targetDay.getFullYear(),
        targetDay.getMonth(),
        targetDay.getDate(),
        0,
        Math.min(DAY_MINUTES, safeStart + Math.max(MIN_DURATION_MINUTES, durationMinutes)),
      );
  const next: Record<string, unknown> = { ...p };
  delete next.date;
  delete next.endDate;
  delete next.allDay;
  next.start = start.toISOString();
  next.end = end.toISOString();
  return { ...object, properties: next };
}

/** Resizes a timed event's end time on the given day while keeping start intact and >= 15 minutes duration. */
export function resizeRecordEnd<T extends WorkspaceObject>(
  object: T,
  day: Date,
  newEndMinutes: number,
): T {
  const p = object.properties;
  if (!validEventTime(p.start)) return object;
  const startMs = Date.parse(p.start);
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const clampedMinutes = Math.max(MIN_DURATION_MINUTES, Math.min(DAY_MINUTES, snapMinutes(newEndMinutes)));
  const targetEndMs = dayStart + clampedMinutes * 60_000;
  const safeEndMs = Math.max(startMs + MIN_DURATION_MINUTES * 60_000, targetEndMs);
  return {
    ...object,
    properties: {
      ...p,
      end: new Date(safeEndMs).toISOString(),
    },
  };
}
