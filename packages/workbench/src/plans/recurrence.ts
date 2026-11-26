import ICAL from 'ical.js';
import { parseTaskRepeat, validEventDate, validEventTime } from '@tano/protocol';
import type { ObjectRecord } from '../objects/workspace-objects';
import { localDayKey } from './calendar';
import { moveRecordToDay } from './calendar-interaction';

const MAX_OCCURRENCES_PER_SERIES = 400;

function baseDayKey(record: ObjectRecord): string | null {
  const p = record.object.properties;
  if (validEventDate(p.date)) return p.date;
  if (validEventTime(p.start)) return localDayKey(new Date(p.start));
  if (validEventDate(p.due)) return p.due;
  return null;
}

export function isVirtualOccurrence(record: ObjectRecord): boolean {
  return record.object.properties.repeatVirtual === true;
}

/**
 * Expands `repeat.mode === 'schedule'` series within `[windowStart, windowEnd]`
 * into lightweight virtual occurrence records without duplicating files on disk.
 */
export function expandRecurringPlans(
  records: readonly ObjectRecord[],
  windowStart: Date,
  windowEnd: Date,
): ObjectRecord[] {
  const startKey = localDayKey(windowStart);
  const endKey = localDayKey(windowEnd);
  if (endKey < startKey) return [...records];

  const materializedOverrides = new Set<string>();
  for (const record of records) {
    const src = record.object.properties.repeatSourceId;
    const occ = record.object.properties.repeatOccurrence;
    if (typeof src === 'string' && validEventDate(occ)) {
      materializedOverrides.add(`${record.source?.scope ?? 'workspace'}:${record.source?.id ?? ''}:${src}:${occ}`);
    }
  }

  const expanded: ObjectRecord[] = [...records];

  for (const record of records) {
    if (record.object.archived) continue;
    if (record.object.properties.repeat === undefined) continue;
    if (record.object.properties.repeatSourceId !== undefined) continue;
    let rule;
    try {
      rule = parseTaskRepeat(record.object.properties.repeat);
    } catch {
      continue;
    }
    if (rule.mode !== 'schedule') continue;

    const originKey = baseDayKey(record);
    const exdates = new Set(rule.exdates ?? []);
    const frequency = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY' }[rule.frequency];
    const recur = ICAL.Recur.fromString(`FREQ=${frequency};INTERVAL=${rule.interval}`);
    const iterator = recur.iterator(ICAL.Time.fromDateString(rule.anchor));
    const scopePrefix = `${record.source?.scope ?? 'workspace'}:${record.source?.id ?? ''}:${record.object.id}:`;

    let produced = 0;
    for (let step = 0; step < 20_000 && produced < MAX_OCCURRENCES_PER_SERIES; step++) {
      const next = iterator.next();
      if (!next) break;
      const dateKey = next.toString();
      if (rule.until && dateKey > rule.until) break;
      if (dateKey > endKey) break;
      if (dateKey < startKey) continue;
      if (dateKey === originKey) continue;
      if (exdates.has(dateKey)) continue;
      if (materializedOverrides.has(`${scopePrefix}${dateKey}`)) continue;

      const targetDate = new Date(`${dateKey}T00:00:00`);
      const moved = moveRecordToDay(record.object, targetDate);
      expanded.push({
        ...record,
        object: {
          ...moved,
          properties: {
            ...moved.properties,
            repeatSourceId: record.object.id,
            repeatOccurrence: dateKey,
            repeatVirtual: true,
          },
        },
      });
      produced++;
    }
  }

  return expanded;
}
