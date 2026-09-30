import { expect, it } from 'vitest';
import { validateObjectProperties } from '@tano/protocol';
import { readPlanDate, writePlanDate } from './plan-date';

it('round-trips a day or a precise time without adding a duration or losing completion', () => {
  const date = { date: '2028-02-29', time: '', end: '' };
  const day = writePlanDate({ checkable: true, completed: true }, date);
  expect(day).toEqual({ checkable: true, completed: true, date: '2028-02-29' });
  expect(readPlanDate(day)).toEqual(date);
  const time = { ...date, time: '23:15' };
  const point = writePlanDate(day, time);
  expect(point).toEqual({ checkable: true, completed: true, start: new Date('2028-02-29T23:15').toISOString(), end: new Date('2028-02-29T23:15').toISOString() });
  expect(readPlanDate(point)).toEqual(time);
  expect(writePlanDate(point, date)).toEqual(day);
  for (const properties of [day, point]) expect(() => validateObjectProperties('event', properties)).not.toThrow();
});

it('preserves an existing cross-day duration when reading and writing the common control', () => {
  const value = { date: '2026-09-30', time: '23:45', end: '2026-10-01T01:15' };
  const properties = writePlanDate({ checkable: false, completed: false, custom: 'preserve' }, value);
  expect(readPlanDate(properties)).toEqual(value);
  expect(properties.custom).toBe('preserve');
  expect(writePlanDate(properties, { date: '', time: '', end: '' })).toEqual({ checkable: false, completed: false, custom: 'preserve' });
});

it('rejects malformed dates and times rather than silently normalizing them', () => {
  expect(() => writePlanDate({}, { date: '2026-02-29', time: '', end: '' })).toThrow('计划日期');
  expect(() => writePlanDate({}, { date: '2026-10-01', time: '25:30', end: '' })).toThrow('计划时间');
  expect(() => writePlanDate({}, { date: '2026-10-01', time: '', end: '2026-02-29' })).toThrow('结束日期格式');
  expect(() => writePlanDate({}, { date: '2026-10-01', time: '', end: '2026-09-30' })).toThrow('结束日期不能早于');
});

it.each([
  ['2026-10-01', '2026-10-01', '2026-10-02'],
  ['2026-12-31', '2027-01-02', '2027-01-03'],
  ['2028-02-28', '2028-02-29', '2028-03-01'],
  ['2026-03-07', '2026-03-09', '2026-03-10'],
  ['2026-03-08', '2026-03-08', '2026-03-09'],
])('round-trips the inclusive all-day range %s through %s using exclusive stored end %s', (date, end, exclusiveEnd) => {
  const value = { date, time: '', end };
  const properties = writePlanDate({ checkable: false, custom: 'keep' }, value);
  expect(properties).toEqual({ checkable: false, custom: 'keep', allDay: true, start: new Date(`${date}T00:00:00`).toISOString(), end: new Date(`${exclusiveEnd}T00:00:00`).toISOString() });
  expect(() => validateObjectProperties('event', properties)).not.toThrow();
  expect(readPlanDate(properties)).toEqual(value);
  const precise = writePlanDate(properties, { date, time: '09:00', end: `${end}T10:00` });
  expect(precise.allDay).toBeUndefined();
  expect(readPlanDate(precise)).toEqual({ date, time: '09:00', end: `${end}T10:00` });
  expect(writePlanDate(properties, { date, time: '', end: '' })).toEqual({ checkable: false, custom: 'keep', date });
});
