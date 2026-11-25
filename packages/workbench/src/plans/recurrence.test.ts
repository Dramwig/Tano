import { expect, it } from 'vitest';
import type { ObjectRecord } from '../objects/workspace-objects';
import { expandRecurringPlans, isVirtualOccurrence } from './recurrence';
import { planKey, sourcePlanKey } from './personal-plans';

const make = (id: string, properties: Record<string, unknown>): ObjectRecord => ({
  path: `.tano/objects/${id}.tano.json`,
  snapshot: { hash: `h-${id}`, content: '', modified: 1 },
  source: { scope: 'workspace', id: 'ws', name: '工作区' },
  object: { version: 1, id, type: 'event', name: '每周例会', description: '', archived: false, properties },
});

it('expands schedule-mode recurring events across the window while respecting exdates and materialized overrides', () => {
  const series = make('a00001', {
    checkable: false,
    start: new Date(2026, 9, 1, 10, 0).toISOString(),
    end: new Date(2026, 9, 1, 11, 0).toISOString(),
    repeat: {
      version: 1,
      mode: 'schedule',
      frequency: 'weekly',
      interval: 1,
      anchor: '2026-10-01',
      until: '2026-10-29',
      exdates: ['2026-10-15'],
    },
  });
  const override = make('a00002', {
    checkable: false,
    start: new Date(2026, 9, 22, 14, 0).toISOString(),
    end: new Date(2026, 9, 22, 15, 0).toISOString(),
    repeat: series.object.properties.repeat,
    repeatSourceId: 'a00001',
    repeatOccurrence: '2026-10-22',
  });
  const afterCompleteTask = make('a00003', {
    checkable: true,
    completed: false,
    date: '2026-10-01',
    repeat: { version: 1, mode: 'after_complete', frequency: 'weekly', interval: 1, anchor: '2026-10-01' },
  });

  const expanded = expandRecurringPlans(
    [series, override, afterCompleteTask],
    new Date(2026, 9, 1),
    new Date(2026, 9, 31),
  );

  const virtuals = expanded.filter(isVirtualOccurrence);
  // Base is Oct 1; Oct 15 is exdate; Oct 22 has materialized override; Oct 8 & Oct 29 expand virtually.
  expect(virtuals.map((item) => item.object.properties.repeatOccurrence)).toEqual([
    '2026-10-08',
    '2026-10-29',
  ]);
  expect(virtuals.map((item) => planKey(item))).toEqual(['a00001@2026-10-08', 'a00001@2026-10-29']);
  expect(virtuals.map((item) => sourcePlanKey(item))).toEqual(['a00001', 'a00001']);
  expect(new Date(String(virtuals[0]!.object.properties.start)).getHours()).toBe(10);
});
