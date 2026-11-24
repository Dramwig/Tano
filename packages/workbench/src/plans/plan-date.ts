import { validEventDate, validEventTime } from '@tano/protocol';
import { localDateTime, localDayKey } from './calendar';

/** One editable planned date, optionally refined to a time and an end. */
export interface PlanDateValue {
  date: string;
  time: string;
  /** Inclusive end date for all-day ranges; local date-time for precise ranges. */
  end: string;
}
export function readPlanDate(properties: Record<string, unknown>): PlanDateValue {
  if (validEventDate(properties.date)) return { date: properties.date, time: '', end: '' };
  if (validEventTime(properties.start)) {
    const start = localDateTime(new Date(properties.start));
    if (properties.allDay === true && validEventTime(properties.end)) {
      // Stored all-day ranges end at the next midnight; the editor shows the last included day.
      const end = Date.parse(properties.end);
      return { date: start.slice(0, 10), time: '', end: localDayKey(new Date(end > Date.parse(properties.start) ? end - 1 : end)) };
    }
    return {
      date: start.slice(0, 10),
      time: start.slice(11),
      end: validEventTime(properties.end) && Date.parse(properties.end) !== Date.parse(properties.start)
        ? localDateTime(new Date(properties.end)) : '',
    };
  }
  return { date: '', time: '', end: '' };
}
export function writePlanDate(properties: Record<string, unknown>, value: PlanDateValue) {
  const result = { ...properties };
  delete result.date;
  delete result.start;
  delete result.end;
  delete result.allDay;
  if (value.date) {
    if (!validEventDate(value.date)) throw new Error('计划日期格式无效');
    if (value.time) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time)) throw new Error('计划时间格式无效');
      result.start = new Date(`${value.date}T${value.time}`).toISOString();
      result.end = value.end ? new Date(value.end).toISOString() : result.start;
    } else if (value.end) {
      if (!validEventDate(value.end)) throw new Error('结束日期格式无效');
      if (value.end < value.date) throw new Error('结束日期不能早于开始日期');
      const end = new Date(`${value.end}T00:00:00`);
      end.setDate(end.getDate() + 1);
      result.start = new Date(`${value.date}T00:00:00`).toISOString();
      result.end = end.toISOString();
      result.allDay = true;
    } else result.date = value.date;
  }
  return result;
}
