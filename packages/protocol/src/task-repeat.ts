import { validEventDate } from './object-types';
import { isShortId } from './short-id';
export interface TaskRepeat { version: 1; frequency: 'daily' | 'weekly' | 'monthly'; interval: number; anchor: string; until?: string }
export function parseTaskRepeat(value: unknown): TaskRepeat {
  const rule = value as TaskRepeat;
  if (!rule || typeof rule !== 'object' || Array.isArray(rule) || rule.version !== 1 ||
      !['daily', 'weekly', 'monthly'].includes(rule.frequency) || !Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > 99 ||
      !validEventDate(rule.anchor) || (rule.until !== undefined && (!validEventDate(rule.until) || rule.until < rule.anchor)) ||
      Object.keys(rule).some(key => !['version', 'frequency', 'interval', 'anchor', 'until'].includes(key))) throw new Error('重复任务规则无效');
  return rule;
}
export function validateTaskRepeat(type: string, properties: Record<string, unknown>) {
  if (properties.repeat !== undefined) {
    if (!(type === 'task' || type === 'event' && properties.checkable === true)) throw new Error('只有任务可以设置重复规则');
    parseTaskRepeat(properties.repeat);
  }
  if (properties.repeatSourceId !== undefined || properties.repeatOccurrence !== undefined) {
    if (!isShortId(properties.repeatSourceId) || !validEventDate(properties.repeatOccurrence) || properties.repeat === undefined)
      throw new Error('重复任务实例身份无效');
  }
}
