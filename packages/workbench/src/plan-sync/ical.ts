import ICAL from 'ical.js';
import type { ItemValue, RemoteItem, SyncKind } from './types';

/** DATE values remain calendar days; floating date-times follow this device's timezone. */
function instant(time: ICAL.Time): string {
  if (time.zone === ICAL.Timezone.localTimezone || time.isDate)
    return new Date(time.year, time.month - 1, time.day, time.hour, time.minute, time.second).toISOString();
  return time.toJSDate().toISOString();
}
function ensureZone(property: ICAL.Property | null) {
  const zone = property?.getParameter('tzid');
  if (zone && !ICAL.TimezoneService.has(String(zone))) throw new Error(`缺少时区定义 ${zone}，请导出包含 VTIMEZONE 的文件`);
}
function item(component: ICAL.Component, kind: SyncKind, start?: ICAL.Time, end?: ICAL.Time): ItemValue {
  const name = String(component.getFirstPropertyValue('summary') || '未命名事项').replace(/[\u0000-\u001f]/g, ' ').slice(0, 200);
  const description = String(component.getFirstPropertyValue('description') || '');
  if (description.length > 20000) throw new Error(`${name} 的描述过长`);
  const status = String(component.getFirstPropertyValue('status') || '');
  const value: ItemValue = { name, description, archived: status === 'CANCELLED' };
  if (kind === 'todo') {
    value.completed = status === 'COMPLETED' || !!component.getFirstPropertyValue('completed');
    ensureZone(component.getFirstProperty('due'));
    const due = component.getFirstPropertyValue('due') as ICAL.Time | null;
    if (due) value.date = due.toString().slice(0, 10);
    return value;
  }
  if (!start) throw new Error(`${name} 缺少开始时间`);
  value.start = instant(start);
  value.end = end ? instant(end) : value.start;
  if (start.isDate) value.allDay = true;
  if (Date.parse(value.end) < Date.parse(value.start)) throw new Error(`${name} 的结束时间早于开始时间`);
  return value;
}
export interface ImportPreview { items: RemoteItem[]; warnings: string[]; ignored: number }
export function parseCalendar(text: string, kind: SyncKind, now = new Date()): ImportPreview {
  if (text.length > 5_000_000) throw new Error('文件超过 5 MB，请分批导入');
  let calendar: ICAL.Component;
  try { calendar = new ICAL.Component(ICAL.parse(text)); } catch { throw new Error('无法读取 iCalendar 文件，请选择有效的 .ics 文件'); }
  if (calendar.name !== 'vcalendar') throw new Error('文件缺少 VCALENDAR');
  const zones: string[] = [];
  for (const zone of calendar.getAllSubcomponents('vtimezone')) {
    const tzid = String(zone.getFirstPropertyValue('tzid'));
    ICAL.TimezoneService.register(new ICAL.Timezone({ tzid, component: zone }), tzid);
    zones.push(tzid);
  }
  const items: RemoteItem[] = [], warnings: string[] = [];
  const target = kind === 'calendar' ? 'vevent' : 'vtodo';
  const components = calendar.getAllSubcomponents(target);
  let ignored = calendar.getAllSubcomponents(kind === 'calendar' ? 'vtodo' : 'vevent').length;
  const seen = new Set<string>();
  const add = (id: string, value: ItemValue, raw: string, recurring: boolean) => {
    if (seen.has(id)) { ignored++; return; }
    if (items.length >= 5000) throw new Error('文件中的事项超过 5000 条，请缩小导出范围');
    seen.add(id); items.push({ id, value, version: '', raw, readOnly: recurring });
  };
  try {
    const from = new Date(now.getFullYear() - 1, now.getMonth(), 1).getTime();
    const until = new Date(now.getFullYear() + 2, now.getMonth(), 1).getTime();
    for (const component of components) {
      if (component.hasProperty('recurrence-id')) continue;
      try {
        const uid = String(component.getFirstPropertyValue('uid') || '');
        if (!uid) throw new Error('事项缺少 UID，无法可靠去重');
        ensureZone(component.getFirstProperty('dtstart'));
        ensureZone(component.getFirstProperty('dtend'));
        if (kind === 'todo') {
          if (component.hasProperty('rrule')) { warnings.push(`${uid}：重复任务需要在来源软件中编辑`); }
          add(uid, item(component, kind), text, component.hasProperty('rrule'));
          continue;
        }
        const event = new ICAL.Event(component);
        for (const exception of components.filter(c => c.hasProperty('recurrence-id') && c.getFirstPropertyValue('uid') === uid)) event.relateException(new ICAL.Event(exception));
        if (!event.isRecurring()) { add(uid, item(component, kind, event.startDate, event.endDate), text, false); continue; }
        warnings.push(`${event.summary || uid}：重复日程展示过去一年至未来两年，系列请在来源日历编辑`);
        const iterator = event.iterator();
        let count = 0;
        for (let next = iterator.next(); next; next = iterator.next()) {
          if (++count > 100000) throw new Error('重复规则过于密集，请缩小源日历范围');
          const details = event.getOccurrenceDetails(next);
          const stamp = Date.parse(instant(details.startDate));
          if (stamp >= until) break;
          if (stamp < from) continue;
          add(`${uid}#${next.toString()}`, item(details.item.component, kind, details.startDate, details.endDate), text, true);
        }
      } catch (error) { warnings.push(String(error instanceof Error ? error.message : error)); ignored++; }
    }
  } finally { for (const zone of zones) ICAL.TimezoneService.remove(zone); }
  return { items, warnings: [...new Set(warnings)], ignored };
}
export function writeCalendar(value: ItemValue, kind: SyncKind, uid: string, raw?: string): string {
  const previous = raw ? parseCalendar(raw, kind).items.find(item => item.id === uid)?.value : undefined;
  const calendar = raw ? new ICAL.Component(ICAL.parse(raw)) : new ICAL.Component(['vcalendar', [], []]);
  if (!raw) { calendar.updatePropertyWithValue('version', '2.0'); calendar.updatePropertyWithValue('prodid', '-//Tano//Planning//ZH'); }
  const type = kind === 'calendar' ? 'vevent' : 'vtodo';
  let component = calendar.getAllSubcomponents(type).find(c => c.getFirstPropertyValue('uid') === uid);
  if (!component) { component = new ICAL.Component(type); calendar.addSubcomponent(component); }
  if (component.hasProperty('rrule') || component.hasProperty('recurrence-id')) throw new Error('请在来源应用编辑重复事项');
  component.updatePropertyWithValue('uid', uid);
  component.updatePropertyWithValue('summary', value.name);
  component.updatePropertyWithValue('description', value.description);
  component.updatePropertyWithValue('dtstamp', ICAL.Time.fromJSDate(new Date(), true));
  const setTime = (name: string, date?: string, allDay = false) => {
    component!.removeAllProperties(name);
    if (!date) return;
    const time = allDay ? ICAL.Time.fromDateString(date.length === 10 ? date : new Date(date).toLocaleDateString('sv-SE')) : ICAL.Time.fromJSDate(new Date(date), true);
    component!.addPropertyWithValue(name, time);
  };
  if (kind === 'calendar') {
    if (!value.start || !value.end) throw new Error('同步日历事件需要开始和结束时间');
    if (!previous || previous.start !== value.start || previous.end !== value.end || !!previous.allDay !== !!value.allDay) {
      component.removeAllProperties('duration');
      setTime('dtstart', value.start, value.allDay); setTime('dtend', value.end, value.allDay);
    }
  } else {
    if (!previous || previous.date !== value.date) setTime('due', value.date, true);
    if (!previous || !!previous.completed !== !!value.completed || previous.archived !== value.archived) {
      component.updatePropertyWithValue('status', value.completed ? 'COMPLETED' : 'NEEDS-ACTION');
      setTime('completed', value.completed ? new Date().toISOString() : undefined);
      if (component.hasProperty('percent-complete')) component.updatePropertyWithValue('percent-complete', value.completed ? 100 : 0);
    }
  }
  if (value.archived) component.updatePropertyWithValue('status', 'CANCELLED');
  else if (kind === 'calendar' && previous?.archived) component.updatePropertyWithValue('status', 'CONFIRMED');
  return calendar.toString();
}
