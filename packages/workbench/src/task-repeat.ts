import ICAL from 'ical.js';
import { parseTaskRepeat, referenceKey, validateObjectProperties, validEventDate } from '@tano/protocol';
import type { WorkspaceObject, WorkspaceRelation } from '@tano/protocol';
import type { ObjectRecord } from './workspace-objects';
import { assistantHash } from './assistant/hash';

export interface RepeatPreview { sourceId: string; sourceHash: string; seriesId: string; seriesHash: string; relationBase: string; object: WorkspaceObject; relations: WorkspaceRelation[] }
export function nextRepeatDate(object: WorkspaceObject) {
  const rule = parseTaskRepeat(object.properties.repeat);
  const from = object.properties.repeatOccurrence ?? object.properties.date ?? object.properties.due ?? rule.anchor;
  if (!validEventDate(from)) throw new Error('重复任务需使用全天计划日期或截止日期');
  const frequency = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY' }[rule.frequency];
  const recur = ICAL.Recur.fromString(`FREQ=${frequency};INTERVAL=${rule.interval}`);
  const iterator = recur.iterator(ICAL.Time.fromDateString(rule.anchor));
  for (let count = 0; count < 100_000; count++) {
    const occurrence = iterator.next();
    if (!occurrence) return null;
    const date = occurrence.toString();
    if (rule.until && date > rule.until) return null;
    if (date > from) return date;
  }
  throw new Error('重复规则超出支持范围');
}
export const repeatRelations = (object: WorkspaceObject, relations: WorkspaceRelation[]) => relations.filter(row =>
  referenceKey(row.source) === referenceKey(object) || referenceKey(row.target) === referenceKey(object));
export async function previewTaskRepeat(record: ObjectRecord, relations: WorkspaceRelation[], series = record): Promise<RepeatPreview | null> {
  if (series.object.archived || series.object.properties.repeat === undefined) throw new Error('来源任务已停止重复或归档');
  const base: WorkspaceObject = { ...record.object, properties: { ...record.object.properties, repeat: series.object.properties.repeat } };
  validateObjectProperties(base.type, base.properties);
  if (base.archived || base.properties.syncReadOnly === true || base.properties.completed !== true) throw new Error('请先完成当前任务，再创建下一次');
  const date = nextRepeatDate(base);
  if (!date) return null;
  const sourceId = String(base.properties.repeatSourceId ?? base.id);
  const id = (await assistantHash(`tano-repeat:${sourceId}:${date}`)).slice(0, 6);
  const properties = { ...base.properties, completed: false, repeatSourceId: sourceId, repeatOccurrence: date };
  for (const key of ['syncConnection', 'syncRemoteId', 'syncReadOnly', 'syncConflictCopy', 'deliveryReview', 'start', 'end']) delete (properties as Record<string, unknown>)[key];
  if (base.properties.date) (properties as Record<string, unknown>).date = date;
  else (properties as Record<string, unknown>).due = date;
  if (base.properties.date && base.properties.due) {
    const offset = Date.parse(`${base.properties.due}T00:00:00Z`) - Date.parse(`${base.properties.date}T00:00:00Z`);
    (properties as Record<string, unknown>).due = new Date(Date.parse(`${date}T00:00:00Z`) + offset).toISOString().slice(0, 10);
  }
  if (base.type === 'task') (properties as Record<string, unknown>).status = 'todo';
  const object = { ...base, id, properties };
  validateObjectProperties(object.type, object.properties);
  const linked = repeatRelations(base, relations);
  const copied: WorkspaceRelation[] = [];
  for (const row of linked) copied.push({ ...row, id: (await assistantHash(`tano-repeat-relation:${id}:${row.id}`)).slice(0, 6),
    source: referenceKey(row.source) === referenceKey(base) ? { type: object.type, id } : row.source,
    target: referenceKey(row.target) === referenceKey(base) ? { type: object.type, id } : row.target });
  return { sourceId: base.id, sourceHash: record.snapshot.hash, seriesId: series.object.id, seriesHash: series.snapshot.hash,
    relationBase: JSON.stringify(linked), object, relations: copied };
}
