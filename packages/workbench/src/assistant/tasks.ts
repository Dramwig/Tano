import { referenceKey, referenceUrl, taskReview, validatePath, validEventDate } from '@tano/protocol';
import type { ReferenceIdentity, ReferenceTarget, WorkspaceRelation } from '@tano/protocol';
import type { ContentReference } from '../content-references';
import { localDayKey } from '../calendar';

export interface TaskQuery {
  documentId: string | null;
  directory: string | null;
  state: 'all' | 'unfinished' | 'completed' | 'overdue';
  personId: string | null;
  query: string | null;
}
export const isTaskTarget = (target: ReferenceTarget) => target.type === 'task' ||
  (target.type === 'event' && target.properties?.checkable === true);
export const taskCompleted = (target: ReferenceTarget) => target.properties?.completed === true ||
  (target.type === 'task' && ['done', 'completed'].includes(String(target.properties?.status)));
export function parseTaskQuery(value: unknown): TaskQuery {
  const args = value as TaskQuery;
  const keys = ['documentId', 'directory', 'state', 'personId', 'query'];
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !keys.includes(key)) ||
      keys.some(key => !(key in args)) || !['all', 'unfinished', 'completed', 'overdue'].includes(args.state) ||
      [args.documentId, args.personId].some(id => id !== null && (typeof id !== 'string' || !/^[0-9a-f]{6}$/.test(id))) ||
      (args.query !== null && (typeof args.query !== 'string' || args.query.length > 200)) ||
      (args.directory !== null && (typeof args.directory !== 'string' ||
        (args.directory !== '' && !!validatePath(args.directory)))) ||
      (args.documentId !== null && args.directory !== null)) throw new Error('任务查询范围或筛选无效');
  return args;
}

export function queryTasks(targets: readonly ReferenceTarget[], relations: readonly WorkspaceRelation[],
  edges: readonly ContentReference[], query: TaskQuery, today = localDayKey(new Date())) {
  if (!validEventDate(today)) throw new Error('任务查询日期无效');
  const documents = targets.filter(target => target.type === 'document' && !target.archived);
  if (query.documentId && !documents.some(target => target.id === query.documentId)) throw new Error('来源文档不可用');
  if (query.personId && !targets.some(target => target.type === 'person' && target.id === query.personId && !target.archived))
    throw new Error('负责人不可用');
  const scoped = documents.filter(target => query.documentId ? target.id === query.documentId :
    query.directory !== null ? !query.directory || target.path.startsWith(`${query.directory}/`) : true);
  const scopeKeys = new Set(scoped.map(referenceKey));
  const restricted = query.documentId !== null || query.directory !== null;
  const rows = targets.filter(target => isTaskTarget(target) && !target.archived).map(task => {
    const key = referenceKey(task);
    const evidence = new Map<string, { document: ReferenceIdentity; name: string; path: string; url: string; excerpt: string; kind: string }>();
    const add = (identity: ReferenceIdentity, excerpt: string, kind: string) => {
      const doc = scoped.find(target => referenceKey(target) === referenceKey(identity));
      if (doc) evidence.set(`${referenceKey(doc)}:${kind}`, { document: { type: 'document', id: doc.id },
        name: doc.name, path: doc.path, url: referenceUrl(doc), excerpt, kind });
    };
    for (const edge of edges) {
      if (edge.missing) continue;
      if (referenceKey(edge.target) === key) add(edge.source, edge.excerpt, '文档引用任务');
      if (referenceKey(edge.source) === key) add(edge.target, edge.excerpt, '任务引用文档');
    }
    for (const relation of relations) {
      if (referenceKey(relation.source) === key && scopeKeys.has(referenceKey(relation.target))) add(relation.target, '', `关系:${relation.type}`);
      if (referenceKey(relation.target) === key && scopeKeys.has(referenceKey(relation.source))) add(relation.source, '', `关系:${relation.type}`);
    }
    const assignees = relations.filter(row => row.type === 'assigned' && referenceKey(row.target) === key)
      .flatMap(row => {
        const person = targets.find(target => referenceKey(target) === referenceKey(row.source) && !target.archived);
        return person ? [{ id: person.id, name: person.name, url: referenceUrl(person) }] : [];
      });
    const properties = task.properties ?? {};
    const review = taskReview({ properties });
    const completed = taskCompleted(task);
    const due = validEventDate(properties.due) ? properties.due : null;
    const overdue = !completed && due !== null && due < today;
    const blockedReason = typeof properties.blockedReason === 'string' && properties.blockedReason.trim()
      ? properties.blockedReason.trim() : review?.state === 'changes-requested' ? review.comment : null;
    return { type: task.type, id: task.id, name: task.name, url: referenceUrl(task), description: task.description ?? '',
      completed, status: completed ? '已完成' : overdue ? '逾期' : '待处理', due,
      date: validEventDate(properties.date) ? properties.date : null,
      start: properties.start ?? null, end: properties.end ?? null, assignees,
      blockedReason: blockedReason ?? '未知', review, evidence: [...evidence.values()] };
  }).filter(task => (!restricted || task.evidence.length > 0) &&
    (!query.personId || task.assignees.some(person => person.id === query.personId)) &&
    (!query.query || `${task.name}\n${task.description}`.toLocaleLowerCase().includes(query.query.toLocaleLowerCase())));
  const totals = { completed: rows.filter(task => task.completed).length,
    pending: rows.filter(task => !task.completed && task.status !== '逾期').length,
    overdue: rows.filter(task => task.status === '逾期').length };
  const tasks = rows.filter(task => query.state === 'all' || (query.state === 'unfinished' && !task.completed) ||
    (query.state === 'completed' && task.completed) || (query.state === 'overdue' && task.status === '逾期'))
    .sort((a, b) => Number(a.completed) - Number(b.completed) || (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.name.localeCompare(b.name));
  return { asOf: today, scope: query, totals, tasks };
}

const normalizedName = (name: string) => name.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]/gu, '');
export function possibleDuplicateTasks(targets: readonly ReferenceTarget[], name: string, exceptId?: string) {
  const normalized = normalizedName(name);
  return targets.filter(target => isTaskTarget(target) && !target.archived && target.id !== exceptId).filter(target => {
    const candidate = normalizedName(target.name);
    return normalized === candidate || (Math.min(normalized.length, candidate.length) >= 4 &&
      Math.min(normalized.length, candidate.length) / Math.max(normalized.length, candidate.length) >= 0.6 &&
      (normalized.includes(candidate) || candidate.includes(normalized)));
  });
}
