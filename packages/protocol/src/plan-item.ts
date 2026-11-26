import type { WorkspaceObject } from './objects';
import { taskReview } from './task-review';

export interface PlanObjectLike {
  type: string;
  archived?: boolean;
  properties?: Record<string, unknown>;
}

const DONE_STATUS_VALUES = new Set(['done', 'completed', '已完成']);
const CHINESE_STATUS_VALUES = new Set(['待处理', '进行中', '已阻塞', '已完成']);

export function isPlanObjectType(type: string): boolean {
  return type === 'event' || type === 'task';
}

export function isPlanObject(item: PlanObjectLike): boolean {
  return isPlanObjectType(item.type);
}

export function isActionableTask(item: PlanObjectLike): boolean {
  return item.type === 'task' || (item.type === 'event' && item.properties?.checkable === true);
}

export function isDoneStatus(status: unknown): boolean {
  return typeof status === 'string' && DONE_STATUS_VALUES.has(status.trim().toLowerCase());
}

export function isPlanCompleted(item: PlanObjectLike): boolean {
  if (!isActionableTask(item)) return false;
  return item.properties?.completed === true || isDoneStatus(item.properties?.status);
}

export function isPlanCompletionLocked(item: Pick<WorkspaceObject, 'properties'>): boolean {
  const review = taskReview(item);
  return !!review && review.state !== 'approved';
}

function nextSyncedStatus(
  type: string,
  previousStatus: unknown,
  completed: boolean,
): string | undefined {
  const current = typeof previousStatus === 'string' ? previousStatus.trim() : '';
  if (!current) {
    return type === 'task' ? (completed ? 'done' : 'todo') : undefined;
  }
  const chinese = CHINESE_STATUS_VALUES.has(current);
  if (completed) return chinese ? '已完成' : 'done';
  if (isDoneStatus(current)) return chinese ? '待处理' : 'todo';
  return current;
}

export function withPlanCompleted<T extends WorkspaceObject>(object: T, completed: boolean): T {
  if (!isActionableTask(object)) throw new Error('只有任务可以标记完成状态');
  if (completed && isPlanCompletionLocked(object)) {
    throw new Error('此任务需由指定审阅人确认通过后完成');
  }
  const properties: Record<string, unknown> = { ...object.properties, completed };
  const status = nextSyncedStatus(object.type, object.properties.status, completed);
  if (status !== undefined) properties.status = status;
  return { ...object, properties };
}

export function withPlanStatus<T extends WorkspaceObject>(object: T, status: string): T {
  const trimmed = status.trim();
  const properties: Record<string, unknown> = { ...object.properties };
  if (trimmed) properties.status = trimmed;
  else delete properties.status;
  if (isActionableTask(object) && trimmed) {
    const completed = isDoneStatus(trimmed);
    if (completed && isPlanCompletionLocked(object)) {
      throw new Error('此任务需由指定审阅人确认通过后完成');
    }
    properties.completed = completed;
  }
  return { ...object, properties };
}
