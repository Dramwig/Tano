import type { ObjectRecord } from '../objects/workspace-objects';
import { eventsOnDay } from './calendar';

export interface TimedEventBlock {
  record: ObjectRecord;
  top: number;
  height: number;
  point: boolean;
  column: number;
  columnCount: number;
  visibleStart: number;
  visibleEnd: number;
}

const MIN_COLLISION_MS = 30 * 60_000;

/**
 * Assigns non-overlapping horizontal columns to concurrent timed events on one day.
 * Events are grouped into connected overlap clusters so non-overlapping slots keep full width.
 */
export function layoutDayTimedEvents(
  records: readonly ObjectRecord[],
  day: Date,
  hourHeight: number,
): TimedEventBlock[] {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();

  const items = eventsOnDay(records, day)
    .filter((record) => record.object.properties.allDay !== true)
    .map((record) => {
      const from = Date.parse(String(record.object.properties.start));
      const to = Date.parse(String(record.object.properties.end));
      const point = from === to;
      const visibleStart = Math.max(from, dayStart);
      const visibleEnd = Math.min(Math.max(to, from + MIN_COLLISION_MS), dayEnd);
      const layoutEnd = Math.max(visibleEnd, visibleStart + MIN_COLLISION_MS);
      const top = ((visibleStart - dayStart) / 3_600_000) * hourHeight;
      const height = point
        ? 24
        : Math.max(22, ((visibleEnd - visibleStart) / 3_600_000) * hourHeight);
      return { record, top, height, point, visibleStart, visibleEnd, layoutEnd };
    })
    .sort(
      (a, b) =>
        a.visibleStart - b.visibleStart ||
        b.layoutEnd - a.layoutEnd ||
        a.record.object.id.localeCompare(b.record.object.id),
    );

  const result: TimedEventBlock[] = [];
  let cluster: { item: (typeof items)[number]; column: number }[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flushCluster = () => {
    if (!cluster.length) return;
    const columnCount = columnEnds.length;
    for (const entry of cluster) {
      result.push({
        record: entry.item.record,
        top: entry.item.top,
        height: entry.item.height,
        point: entry.item.point,
        column: entry.column,
        columnCount,
        visibleStart: entry.item.visibleStart,
        visibleEnd: entry.item.visibleEnd,
      });
    }
    cluster = [];
    columnEnds = [];
    clusterEnd = -Infinity;
  };

  for (const item of items) {
    if (cluster.length > 0 && item.visibleStart >= clusterEnd) {
      flushCluster();
    }
    let column = columnEnds.findIndex((end) => end <= item.visibleStart);
    if (column < 0) {
      column = columnEnds.length;
      columnEnds.push(item.layoutEnd);
    } else {
      columnEnds[column] = item.layoutEnd;
    }
    clusterEnd = Math.max(clusterEnd, item.layoutEnd);
    cluster.push({ item, column });
  }
  flushCluster();
  return result;
}
