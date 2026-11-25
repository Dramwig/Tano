import { expect, it } from 'vitest';
import {
  coreRelationTypes,
  isActionableTask,
  isDoneStatus,
  isPlanCompleted,
  isPlanObject,
  isPlanObjectType,
  submitTaskReview,
  decideTaskReview,
  validateObjectProperties,
  validateRelation,
  withPlanCompleted,
  withPlanStatus,
} from './index';
import type { WorkspaceObject } from './objects';

const makeObject = (
  type: 'event' | 'task',
  properties: Record<string, unknown> = {},
): WorkspaceObject => ({
  version: 1,
  id: 'a00001',
  type,
  name: '统一事项',
  description: '',
  archived: false,
  properties,
});

it('unifies actionable task detection and completion checks across event and legacy task', () => {
  expect(isPlanObjectType('event')).toBe(true);
  expect(isPlanObjectType('task')).toBe(true);
  expect(isPlanObjectType('project')).toBe(false);

  const schedule = makeObject('event', { date: '2026-11-25' });
  const checkableEvent = makeObject('event', { checkable: true, completed: false });
  const completedEvent = makeObject('event', { checkable: true, status: '已完成' });
  const legacyTask = makeObject('task', { status: 'done' });
  const legacyZhTask = makeObject('task', { status: '已完成' });

  expect(isPlanObject(schedule)).toBe(true);
  expect(isActionableTask(schedule)).toBe(false);
  expect(isPlanCompleted(schedule)).toBe(false);

  expect(isActionableTask(checkableEvent)).toBe(true);
  expect(isPlanCompleted(checkableEvent)).toBe(false);
  expect(isPlanCompleted(completedEvent)).toBe(true);

  expect(isActionableTask(legacyTask)).toBe(true);
  expect(isPlanCompleted(legacyTask)).toBe(true);
  expect(isPlanCompleted(legacyZhTask)).toBe(true);
  expect(isDoneStatus('COMPLETED')).toBe(true);
  expect(isDoneStatus('进行中')).toBe(false);
});

it('synchronizes completed and status consistently for both event and legacy task', () => {
  const plainEventTask = makeObject('event', { checkable: true, completed: false });
  const donePlain = withPlanCompleted(plainEventTask, true);
  expect(donePlain.properties).toEqual({ checkable: true, completed: true });

  const statusEventTask = makeObject('event', { checkable: true, completed: false, status: '进行中' });
  expect(withPlanCompleted(statusEventTask, true).properties).toEqual({
    checkable: true,
    completed: true,
    status: '已完成',
  });
  expect(withPlanCompleted(withPlanCompleted(statusEventTask, true), false).properties).toEqual({
    checkable: true,
    completed: false,
    status: '待处理',
  });

  const boardDone = withPlanStatus(plainEventTask, '已完成');
  expect(boardDone.properties).toEqual({ checkable: true, completed: true, status: '已完成' });
  const boardProgress = withPlanStatus(boardDone, '进行中');
  expect(boardProgress.properties).toEqual({ checkable: true, completed: false, status: '进行中' });

  const legacyTask = makeObject('task', { status: 'done' });
  expect(withPlanCompleted(legacyTask, false).properties).toEqual({ completed: false, status: 'todo' });
  expect(withPlanCompleted(makeObject('task', {}), true).properties).toEqual({ completed: true, status: 'done' });
  expect(() => withPlanCompleted(makeObject('event', { date: '2026-11-25' }), true)).toThrow('只有任务');
});

it('enforces delivery review lock on both completed flag and done status', () => {
  const base = makeObject('event', { checkable: true, completed: false, status: '进行中' });
  const pending = submitTaskReview(base, {
    id: '11111111-1111-4111-8111-111111111111',
    documentId: 'b00001',
    documentHash: 'a'.repeat(64),
    criteriaHash: 'b'.repeat(64),
    reviewerId: 'c00001',
    submitterId: 'd00001',
    submittedAt: '2026-11-25T10:00:00Z',
  });
  expect(pending.properties.completed).toBe(false);
  expect(() => withPlanCompleted(pending, true)).toThrow('指定审阅人');
  expect(() => withPlanStatus(pending, '已完成')).toThrow('指定审阅人');
  expect(() => validateObjectProperties('event', { ...pending.properties, status: '已完成' })).toThrow('指定审阅人');

  const approved = decideTaskReview(pending, 'approved', '', '2026-11-25T11:00:00Z');
  expect(approved.properties.completed).toBe(true);
  expect(approved.properties.status).toBe('已完成');
  expect(() => validateObjectProperties('event', approved.properties)).not.toThrow();
});

it('validates extended event fields and allows project contains event relations', () => {
  expect(() =>
    validateObjectProperties('event', {
      checkable: true,
      completed: false,
      status: '进行中',
      priority: 2,
      date: '2026-11-25',
      endDate: '2026-11-27',
      timezone: 'Asia/Shanghai',
      location: '会议室 A',
      reminders: [10, 30],
    }),
  ).not.toThrow();

  expect(() =>
    validateObjectProperties('event', {
      checkable: false,
      date: '2026-11-25',
      repeat: { version: 1, mode: 'schedule', frequency: 'weekly', interval: 1, anchor: '2026-11-25', exdates: ['2026-12-02'] },
    }),
  ).not.toThrow();
  expect(() =>
    validateObjectProperties('event', {
      checkable: false,
      date: '2026-11-25',
      repeat: { version: 1, mode: 'after_complete', frequency: 'weekly', interval: 1, anchor: '2026-11-25' },
    }),
  ).toThrow('只有任务');
  expect(() => validateObjectProperties('event', { reminders: [-5] })).toThrow('提醒设置无效');
  expect(() => validateObjectProperties('event', { reminders: [0, 5, 10, 15, 30, 60] })).toThrow('提醒设置无效');

  expect(() => validateObjectProperties('event', { endDate: '2026-11-27' })).toThrow('计划日期');
  expect(() =>
    validateObjectProperties('event', { date: '2026-11-27', endDate: '2026-11-25' }),
  ).toThrow('早于计划日期');
  expect(() =>
    validateObjectProperties('event', {
      date: '2026-11-25',
      endDate: '2026-11-26',
      start: '2026-11-25T09:00:00Z',
      end: '2026-11-25T10:00:00Z',
    }),
  ).toThrow('只能选择一种');

  expect(() =>
    validateRelation(
      {
        id: 'e00001',
        type: 'contains',
        source: { type: 'project', id: 'a00001' },
        target: { type: 'event', id: 'a00002' },
      },
      coreRelationTypes,
    ),
  ).not.toThrow();
});
