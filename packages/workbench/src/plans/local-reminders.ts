import { validEventDate, validEventTime } from '@tano/protocol';
import type { ObjectRecord } from '../objects/workspace-objects';
import { isEventCompleted } from './calendar';
import { planKey } from './personal-plans';

export const REMINDER_STORAGE_KEY = 'tano.plan-reminders.fired.v1';
export const REMINDER_PRESETS = [0, 10, 30, 60, 1440] as const;
const DEFAULT_GRACE_MS = 5 * 60_000;
const RETENTION_MS = 30 * 86_400_000;

export interface PendingReminder {
  key: string;
  record: ObjectRecord;
  offsetMinutes: number;
  fireAt: number;
  anchorMs: number;
}

export function extractReminders(properties: Record<string, unknown>): number[] {
  if (!Array.isArray(properties.reminders)) return [];
  return [...new Set(
    properties.reminders.filter(
      (item): item is number => typeof item === 'number' && Number.isInteger(item) && item >= 0 && item <= 43200,
    ),
  )].sort((a, b) => a - b);
}

export function reminderAnchorMs(record: ObjectRecord): number | null {
  const p = record.object.properties;
  if (validEventTime(p.start)) {
    if (p.allDay === true) {
      const d = new Date(p.start);
      return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 0, 0).getTime();
    }
    return Date.parse(p.start);
  }
  if (validEventDate(p.date)) {
    return new Date(`${p.date}T09:00:00`).getTime();
  }
  if (validEventDate(p.due)) {
    return new Date(`${p.due}T09:00:00`).getTime();
  }
  return null;
}

export function computePendingReminders(
  records: readonly ObjectRecord[],
  nowMs: number,
  firedKeys: ReadonlySet<string>,
  graceWindowMs = DEFAULT_GRACE_MS,
): PendingReminder[] {
  const due: PendingReminder[] = [];
  for (const record of records) {
    if (record.object.archived || isEventCompleted(record)) continue;
    const offsets = extractReminders(record.object.properties);
    if (!offsets.length) continue;
    const anchorMs = reminderAnchorMs(record);
    if (anchorMs === null) continue;
    const baseKey = planKey(record);
    for (const offsetMinutes of offsets) {
      const fireAt = anchorMs - offsetMinutes * 60_000;
      if (fireAt > nowMs || nowMs - fireAt > graceWindowMs) continue;
      const key = `${baseKey}:${anchorMs}:${offsetMinutes}`;
      if (firedKeys.has(key)) continue;
      due.push({ key, record, offsetMinutes, fireAt, anchorMs });
    }
  }
  return due.sort((a, b) => a.fireAt - b.fireAt);
}

export interface LocalReminderOptions {
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  onRemind?: (item: PendingReminder) => void;
  notify?: (title: string, body: string) => void;
}

/**
 * In-app/app-data local reminder tracker. Fired history stays in localStorage
 * (application data) and never writes back to workspace files.
 */
export class LocalReminderScheduler {
  private fired = new Map<string, number>();
  private storage?: Pick<Storage, 'getItem' | 'setItem'>;
  private onRemind?: (item: PendingReminder) => void;
  private notify?: (title: string, body: string) => void;

  constructor(options: LocalReminderOptions = {}) {
    this.storage = options.storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    this.onRemind = options.onRemind;
    this.notify = options.notify;
    this.load();
  }

  private load() {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(REMINDER_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, number>;
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'number' && Number.isFinite(v)) this.fired.set(k, v);
        }
      }
    } catch {
      /* ignore corrupt reminder cache */
    }
  }

  private save(nowMs: number) {
    for (const [key, firedAt] of this.fired) {
      if (nowMs - firedAt > RETENTION_MS) this.fired.delete(key);
    }
    if (!this.storage) return;
    try {
      this.storage.setItem(REMINDER_STORAGE_KEY, JSON.stringify(Object.fromEntries(this.fired)));
    } catch {
      /* storage quota full — keep in-memory dedupe */
    }
  }

  check(records: readonly ObjectRecord[], nowMs = Date.now()): PendingReminder[] {
    const items = computePendingReminders(records, nowMs, new Set(this.fired.keys()));
    if (!items.length) return [];
    for (const item of items) {
      this.fired.set(item.key, nowMs);
      this.onRemind?.(item);
      const body =
        item.offsetMinutes === 0
          ? '现在开始'
          : item.offsetMinutes >= 1440
            ? `提前 ${Math.round(item.offsetMinutes / 1440)} 天提醒`
            : item.offsetMinutes >= 60
              ? `提前 ${Math.round(item.offsetMinutes / 60)} 小时提醒`
              : `提前 ${item.offsetMinutes} 分钟提醒`;
      if (this.notify) {
        this.notify(item.record.object.name, body);
      } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          new Notification(item.record.object.name, { body });
        } catch {
          /* ignore notification delivery failure */
        }
      }
    }
    this.save(nowMs);
    return items;
  }
}
