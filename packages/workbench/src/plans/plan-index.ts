import {
  isActionableTask,
  isPlanCompleted,
  isPlanObject,
  validEventDate,
  validEventTime,
  validateObjectProperties,
} from '@tano/protocol';
import type { ObjectRecord } from '../objects/workspace-objects';
import {
  localDayKey,
  type CalendarDayEntry,
  type CalendarFilter,
} from './calendar';
import { expandRecurringSeriesInWindow } from './recurrence';
import { layoutDayTimedEvents, type TimedEventBlock } from './timeline-layout';

export interface PlanRecordMeta {
  valid: boolean;
  checkable: boolean;
  completed: boolean;
  hasTime: boolean;
  allDay: boolean;
  startMs: number;
  endMs: number;
  startDayKey: string | null;
  endDayKey: string | null;
  dateKey: string | null;
  endDateKey: string | null;
  dueKey: string | null;
  hasRepeat: boolean;
  searchText: string;
}

const metaCache = new WeakMap<ObjectRecord, PlanRecordMeta>();

export function getPlanRecordMeta(record: ObjectRecord): PlanRecordMeta {
  const cached = metaCache.get(record);
  if (cached) return cached;

  const { object } = record;
  let valid = false;
  if (isPlanObject(object) && !object.archived) {
    try {
      validateObjectProperties(object.type, object.properties);
      valid = true;
    } catch {
      valid = false;
    }
  }

  const properties = object.properties;
  const checkable = isActionableTask(object);
  const completed = isPlanCompleted(object);
  let hasTime = false;
  let startMs = Number.NaN;
  let endMs = Number.NaN;
  let startDayKey: string | null = null;
  let endDayKey: string | null = null;

  if (validEventTime(properties.start) && validEventTime(properties.end)) {
    const from = Date.parse(properties.start);
    const to = Date.parse(properties.end);
    if (to >= from) {
      hasTime = true;
      startMs = from;
      endMs = to;
      startDayKey = localDayKey(new Date(from));
      // Half-open range: an event ending at midnight does not occupy the following day.
      endDayKey = to > from ? localDayKey(new Date(to - 1)) : startDayKey;
    }
  }

  const allDay = properties.allDay === true;
  const dateKey = !hasTime && validEventDate(properties.date) ? properties.date : null;
  const endDateKey =
    dateKey && validEventDate(properties.endDate) && properties.endDate >= dateKey
      ? properties.endDate
      : null;
  const dueKey = validEventDate(properties.due) ? properties.due : null;
  const hasRepeat =
    properties.repeat !== undefined && properties.repeatSourceId === undefined;
  const searchText = `${object.name}\n${object.description}`.toLocaleLowerCase();

  const meta: PlanRecordMeta = {
    valid,
    checkable,
    completed,
    hasTime,
    allDay,
    startMs,
    endMs,
    startDayKey,
    endDayKey,
    dateKey,
    endDateKey,
    dueKey,
    hasRepeat,
    searchText,
  };
  metaCache.set(record, meta);
  return meta;
}

export interface PlanDayIndex {
  windowStartKey: string;
  windowEndKey: string;
  entriesByDay: Map<string, CalendarDayEntry[]>;
  timedByDay: Map<string, ObjectRecord[]>;
  bannerByDay: Map<string, CalendarDayEntry[]>;
  countByDay: Map<string, number>;
  /** All filtered, sorted records overlapping the indexed window. */
  inWindowRecords: ObjectRecord[];
}

export const EMPTY_ENTRIES: readonly CalendarDayEntry[] = Object.freeze([]);
export const EMPTY_RECORDS: readonly ObjectRecord[] = Object.freeze([]);

function matchesFilter(meta: PlanRecordMeta, filter: CalendarFilter, needle: string): boolean {
  if (filter.kind === 'task' && !meta.checkable) return false;
  if (filter.kind === 'event' && meta.checkable) return false;
  if (!filter.showCompleted && meta.checkable && meta.completed) return false;
  if (needle && !meta.searchText.includes(needle)) return false;
  return true;
}

function overlapsWindow(meta: PlanRecordMeta, winStartKey: string, winEndKey: string): boolean {
  if (meta.hasTime && meta.startDayKey && meta.endDayKey) {
    if (meta.startDayKey <= winEndKey && meta.endDayKey >= winStartKey) return true;
  } else if (meta.dateKey) {
    const endKey = meta.endDateKey ?? meta.dateKey;
    if (meta.dateKey <= winEndKey && endKey >= winStartKey) return true;
  }
  if (meta.dueKey && meta.dueKey >= winStartKey && meta.dueKey <= winEndKey) return true;
  return false;
}

function parseDayKeyToDate(key: string): Date {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  const d = Number(key.slice(8, 10));
  return new Date(y, m - 1, d);
}

function forEachDayInClampedRange(
  rangeStart: string,
  rangeEnd: string,
  winStartKey: string,
  winEndKey: string,
  visit: (dayKey: string) => void,
) {
  const from = rangeStart < winStartKey ? winStartKey : rangeStart;
  const to = rangeEnd > winEndKey ? winEndKey : rangeEnd;
  if (from > to) return;
  if (from === to) {
    visit(from);
    return;
  }
  const cursor = parseDayKeyToDate(from);
  while (true) {
    const key = localDayKey(cursor);
    if (key > to) break;
    visit(key);
    cursor.setDate(cursor.getDate() + 1);
  }
}

function pushToMap<T>(map: Map<string, T[]>, key: string, item: T) {
  let list = map.get(key);
  if (!list) {
    list = [];
    map.set(key, list);
  }
  list.push(item);
}

export const DEFAULT_CALENDAR_FILTER: CalendarFilter = {
  kind: 'all',
  showCompleted: true,
  query: '',
};

/**
 * Builds an O(1)-lookup per-day index for records overlapping `[windowStart, windowEnd]`.
 * Only expands recurring series within the window and skips records outside it.
 */
export function buildCalendarDayIndex(
  records: readonly ObjectRecord[],
  windowStart: Date,
  windowEnd: Date,
  filter: CalendarFilter = DEFAULT_CALENDAR_FILTER,
): PlanDayIndex {
  const winStartKey = localDayKey(windowStart);
  const winEndKey = localDayKey(windowEnd);
  const entriesByDay = new Map<string, CalendarDayEntry[]>();
  const timedByDay = new Map<string, ObjectRecord[]>();
  const bannerByDay = new Map<string, CalendarDayEntry[]>();
  const countByDay = new Map<string, number>();

  if (winEndKey < winStartKey || !records.length) {
    return {
      windowStartKey: winStartKey,
      windowEndKey: winEndKey,
      entriesByDay,
      timedByDay,
      bannerByDay,
      countByDay,
      inWindowRecords: [],
    };
  }

  const needle = filter.query.trim().toLocaleLowerCase();
  const recurringSources: ObjectRecord[] = [];
  const materializedOverrides = new Set<string>();
  const matched: ObjectRecord[] = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    const src = record.object.properties.repeatSourceId;
    const occ = record.object.properties.repeatOccurrence;
    if (typeof src === 'string' && validEventDate(occ)) {
      materializedOverrides.add(
        `${record.source?.scope ?? 'workspace'}:${record.source?.id ?? ''}:${src}:${occ}`,
      );
    }

    const meta = getPlanRecordMeta(record);
    if (!meta.valid) continue;
    if (meta.hasRepeat) recurringSources.push(record);
    if (!overlapsWindow(meta, winStartKey, winEndKey)) continue;
    if (!matchesFilter(meta, filter, needle)) continue;
    matched.push(record);
  }

  if (recurringSources.length) {
    const virtuals = expandRecurringSeriesInWindow(
      recurringSources,
      materializedOverrides,
      windowStart,
      windowEnd,
    );
    for (let i = 0; i < virtuals.length; i++) {
      const record = virtuals[i]!;
      const meta = getPlanRecordMeta(record);
      if (!meta.valid) continue;
      if (!overlapsWindow(meta, winStartKey, winEndKey)) continue;
      if (!matchesFilter(meta, filter, needle)) continue;
      matched.push(record);
    }
  }

  // Sort once using cached metadata (matches `planningEvents` ordering).
  matched.sort((a, b) => {
    const ma = getPlanRecordMeta(a);
    const mb = getPlanRecordMeta(b);
    return (
      Number(ma.completed) - Number(mb.completed) ||
      (ma.hasTime ? ma.startMs : 0) - (mb.hasTime ? mb.startMs : 0) ||
      a.object.id.localeCompare(b.object.id)
    );
  });

  // Bucket into O(1) day maps in sorted order.
  for (let i = 0; i < matched.length; i++) {
    const record = matched[i]!;
    const meta = getPlanRecordMeta(record);
    let primaryStart: string | null = null;
    let primaryEnd: string | null = null;

    if (meta.hasTime && meta.startDayKey && meta.endDayKey) {
      primaryStart = meta.startDayKey;
      primaryEnd = meta.endDayKey;
      const kind = meta.allDay ? 'all-day' : 'timed';
      const entry: CalendarDayEntry = { record, kind };
      forEachDayInClampedRange(primaryStart, primaryEnd, winStartKey, winEndKey, (dayKey) => {
        pushToMap(entriesByDay, dayKey, entry);
        if (kind === 'timed') pushToMap(timedByDay, dayKey, record);
        else pushToMap(bannerByDay, dayKey, entry);
      });
    } else if (meta.dateKey) {
      primaryStart = meta.dateKey;
      primaryEnd = meta.endDateKey ?? meta.dateKey;
      const entry: CalendarDayEntry = { record, kind: 'all-day' };
      forEachDayInClampedRange(primaryStart, primaryEnd, winStartKey, winEndKey, (dayKey) => {
        pushToMap(entriesByDay, dayKey, entry);
        pushToMap(bannerByDay, dayKey, entry);
      });
    }

    if (meta.dueKey && meta.dueKey >= winStartKey && meta.dueKey <= winEndKey) {
      const alreadyCovered =
        primaryStart !== null &&
        primaryEnd !== null &&
        meta.dueKey >= primaryStart &&
        meta.dueKey <= primaryEnd;
      if (!alreadyCovered) {
        const entry: CalendarDayEntry = { record, kind: 'due' };
        pushToMap(entriesByDay, meta.dueKey, entry);
        pushToMap(bannerByDay, meta.dueKey, entry);
      }
    }
  }

  for (const [dayKey, list] of entriesByDay) {
    countByDay.set(dayKey, list.length);
  }

  return {
    windowStartKey: winStartKey,
    windowEndKey: winEndKey,
    entriesByDay,
    timedByDay,
    bannerByDay,
    countByDay,
    inWindowRecords: matched,
  };
}

const layoutCache = new WeakMap<readonly ObjectRecord[], Map<string, TimedEventBlock[]>>();

/** Cached wrapper around `layoutDayTimedEvents` keyed by the day's pre-bucketed record array + hourHeight. */
export function getCachedDayTimedLayout(
  dayRecords: readonly ObjectRecord[],
  day: Date,
  hourHeight: number,
): TimedEventBlock[] {
  if (!dayRecords.length) return [];
  const cacheKey = `${localDayKey(day)}@${hourHeight}`;
  let byDay = layoutCache.get(dayRecords);
  if (!byDay) {
    byDay = new Map();
    layoutCache.set(dayRecords, byDay);
  }
  const existing = byDay.get(cacheKey);
  if (existing) return existing;
  const computed = layoutDayTimedEvents(dayRecords, day, hourHeight);
  byDay.set(cacheKey, computed);
  return computed;
}
