import { validEventDate } from './object-types';
import { isShortId } from './short-id';
import { isActionableTask } from './plan-item';

export type TaskRepeatMode = 'after_complete' | 'schedule';

export interface TaskRepeat {
  version: 1;
  mode?: TaskRepeatMode;
  frequency: 'daily' | 'weekly' | 'monthly';
  interval: number;
  anchor: string;
  until?: string;
  exdates?: string[];
}

const ALLOWED_REPEAT_KEYS = new Set([
  'version',
  'mode',
  'frequency',
  'interval',
  'anchor',
  'until',
  'exdates',
]);

export function parseTaskRepeat(value: unknown): TaskRepeat {
  const rule = value as TaskRepeat;
  if (
    !rule ||
    typeof rule !== 'object' ||
    Array.isArray(rule) ||
    rule.version !== 1 ||
    (rule.mode !== undefined && !['after_complete', 'schedule'].includes(rule.mode)) ||
    !['daily', 'weekly', 'monthly'].includes(rule.frequency) ||
    !Number.isInteger(rule.interval) ||
    rule.interval < 1 ||
    rule.interval > 99 ||
    !validEventDate(rule.anchor) ||
    (rule.until !== undefined && (!validEventDate(rule.until) || rule.until < rule.anchor)) ||
    (rule.exdates !== undefined &&
      (!Array.isArray(rule.exdates) ||
        rule.exdates.length > 500 ||
        !rule.exdates.every((day) => validEventDate(day)))) ||
    Object.keys(rule).some((key) => !ALLOWED_REPEAT_KEYS.has(key))
  ) {
    throw new Error('重复任务规则无效');
  }
  return rule;
}

export function validateTaskRepeat(type: string, properties: Record<string, unknown>) {
  if (properties.repeat !== undefined) {
    const rule = parseTaskRepeat(properties.repeat);
    if (rule.mode !== 'schedule' && !isActionableTask({ type, properties })) {
      throw new Error('只有任务可以设置重复规则');
    }
  }
  if (properties.repeatSourceId !== undefined || properties.repeatOccurrence !== undefined) {
    if (
      !isShortId(properties.repeatSourceId) ||
      !validEventDate(properties.repeatOccurrence) ||
      properties.repeat === undefined
    ) {
      throw new Error('重复任务实例身份无效');
    }
  }
}
