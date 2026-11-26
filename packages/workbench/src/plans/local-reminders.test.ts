import { expect, it, vi } from 'vitest';
import type { ObjectRecord } from '../objects/workspace-objects';
import { computePendingReminders, LocalReminderScheduler, REMINDER_STORAGE_KEY } from './local-reminders';

const make = (id: string, name: string, properties: Record<string, unknown>, archived = false): ObjectRecord => ({
  path: `.tano/objects/${id}.tano.json`,
  snapshot: { hash: `h-${id}`, content: '', modified: 1 },
  object: { version: 1, id, type: 'event', name, description: '', archived, properties },
});

it('computes due reminders within the grace window and skips completed or archived items', () => {
  const start = new Date(2026, 9, 5, 10, 0, 0);
  const now = new Date(2026, 9, 5, 9, 52, 0).getTime(); // 8 minutes before start -> 10m reminder fired 2m ago
  const active = make('a00001', '架构评审', {
    checkable: false,
    start: start.toISOString(),
    end: new Date(2026, 9, 5, 11, 0, 0).toISOString(),
    reminders: [10, 30],
  });
  const doneTask = make('a00002', '已完成任务', {
    checkable: true,
    completed: true,
    start: start.toISOString(),
    end: new Date(2026, 9, 5, 11, 0, 0).toISOString(),
    reminders: [10],
  });
  const archived = make('a00003', '已归档', {
    checkable: false,
    start: start.toISOString(),
    end: new Date(2026, 9, 5, 11, 0, 0).toISOString(),
    reminders: [10],
  }, true);

  const pending = computePendingReminders([active, doneTask, archived], now, new Set());
  expect(pending).toHaveLength(1);
  expect(pending[0]!.record.object.id).toBe('a00001');
  expect(pending[0]!.offsetMinutes).toBe(10);
});

it('deduplicates fired reminders across checks and persists state in app storage', () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
  };
  const onRemind = vi.fn();
  const notify = vi.fn();
  const scheduler = new LocalReminderScheduler({ storage, onRemind, notify });
  const record = make('b00001', '发版截止', { checkable: true, completed: false, due: '2026-10-05', reminders: [0] });
  const now = new Date(2026, 9, 5, 9, 1, 0).getTime();

  expect(scheduler.check([record], now)).toHaveLength(1);
  expect(onRemind).toHaveBeenCalledTimes(1);
  expect(notify).toHaveBeenCalledWith('发版截止', '现在开始');
  expect(store.has(REMINDER_STORAGE_KEY)).toBe(true);

  // Second check and fresh scheduler instance both skip already-fired reminder
  expect(scheduler.check([record], now + 30_000)).toHaveLength(0);
  const reloaded = new LocalReminderScheduler({ storage, onRemind, notify });
  expect(reloaded.check([record], now + 60_000)).toHaveLength(0);
  expect(onRemind).toHaveBeenCalledTimes(1);
});
