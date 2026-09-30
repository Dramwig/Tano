import { describe, expect, it } from 'vitest';
import { parseCalendar, writeCalendar } from './ical';
const wrap = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`;
const event = 'BEGIN:VEVENT\r\nUID:one\r\nSUMMARY:项目评审\r\nDESCRIPTION:第一行\\n第二行\r\nDTSTART:20260930T030000Z\r\nDTEND:20260930T040000Z\r\nEND:VEVENT';
describe('iCalendar interoperability', () => {
  it('separates events and completed VTODOs, preserves folded Chinese and escaped text', () => {
    const text = wrap(event.replace('项目评审', '项目\r\n 评审') + '\r\nBEGIN:VTODO\r\nUID:todo-1\r\nSUMMARY:买菜\r\nSTATUS:COMPLETED\r\nDUE;VALUE=DATE:20261001\r\nEND:VTODO');
    const calendar = parseCalendar(text, 'calendar');
    expect(calendar.items).toHaveLength(1);
    expect(calendar.items[0]!.value).toMatchObject({ name: '项目评审', description: '第一行\n第二行', start: '2026-09-30T03:00:00.000Z' });
    expect(calendar.ignored).toBe(1);
    expect(parseCalendar(text, 'todo').items[0]!.value).toMatchObject({ date: '2026-10-01', completed: true });
  });
  it('preserves all-day exclusive end and reports unsupported timezone instead of shifting it', () => {
    const result = parseCalendar(wrap(event.replace('DTSTART:20260930T030000Z', 'DTSTART;VALUE=DATE:20260930').replace('DTEND:20260930T040000Z', 'DTEND;VALUE=DATE:20261002')), 'calendar');
    expect(result.items[0]!.value.allDay).toBe(true);
    expect(new Date(result.items[0]!.value.end!).getDate()).toBe(2);
    const bad = parseCalendar(wrap(event.replace('DTSTART:20260930T030000Z', 'DTSTART;TZID=Unspecified/Missing:20260930T110000')), 'calendar');
    expect(bad.items).toHaveLength(0); expect(bad.warnings[0]).toContain('时区');
  });
  it('expands recurrence and exceptions without permitting unsafe series writes', () => {
    const recurring = event.replace('END:VEVENT', 'RRULE:FREQ=DAILY;COUNT=3\r\nEXDATE:20261001T030000Z\r\nEND:VEVENT');
    const result = parseCalendar(wrap(recurring), 'calendar', new Date('2026-09-30'));
    expect(result.items).toHaveLength(2);
    expect(result.items.every(i => i.readOnly)).toBe(true);
    expect(result.items.map(i => i.value.start)).toEqual(['2026-09-30T03:00:00.000Z', '2026-10-02T03:00:00.000Z']);
    expect(() => writeCalendar(result.items[0]!.value, 'calendar', 'one', wrap(recurring))).toThrow('重复事项');
  });
  it('retains unknown fields and alarms when updating an existing resource', () => {
    const raw = wrap(event.replace('END:VEVENT', 'LOCATION:会议室\r\nX-EXTERNAL-ID:abc\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\nDESCRIPTION:提醒\r\nEND:VALARM\r\nEND:VEVENT'));
    const result = parseCalendar(raw, 'calendar');
    const written = writeCalendar({ ...result.items[0]!.value, name: '新标题' }, 'calendar', 'one', raw);
    expect(written).toContain('LOCATION:会议室'); expect(written).toContain('BEGIN:VALARM'); expect(written).toContain('X-EXTERNAL-ID:abc');
    expect(parseCalendar(written, 'calendar').items[0]!.value.name).toBe('新标题');
  });
  it('deduplicates UID and rejects malformed input without writes', () => {
    expect(parseCalendar(wrap(`${event}\r\n${event}`), 'calendar').items).toHaveLength(1);
    expect(() => parseCalendar('not ical', 'calendar')).toThrow();
    expect(() => parseCalendar('x'.repeat(5_000_001), 'calendar')).toThrow('5 MB');
  });
  it('preserves floating calendar times and timed task due dates during unrelated edits', () => {
    const raw = wrap(event.replaceAll('0000Z', '0000'));
    const value = parseCalendar(raw, 'calendar').items[0]!.value;
    const written = writeCalendar({ ...value, name: '改标题' }, 'calendar', 'one', raw);
    expect(written).toContain('DTSTART:20260930T030000\r\n');
    expect(written).toContain('DTEND:20260930T040000\r\n');
    const todo = wrap('BEGIN:VTODO\r\nUID:todo\r\nSUMMARY:任务\r\nDUE:20261001T140000Z\r\nSTATUS:IN-PROCESS\r\nEND:VTODO');
    const task = parseCalendar(todo, 'todo').items[0]!.value;
    const renamed = writeCalendar({ ...task, name: '改任务名' }, 'todo', 'todo', todo);
    expect(renamed).toContain('DUE:20261001T140000Z');
    expect(renamed).toContain('STATUS:IN-PROCESS');
  });
});
