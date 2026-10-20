import type { WorkspaceObject, WorkspaceRelation, ReferenceIdentity } from './index';
import { validObjectType } from './object-types';
import { referenceKey } from './relations';

export type ObjectViewLayout = 'table' | 'board' | 'gallery';
export interface ObjectViewQuery {
  layout: ObjectViewLayout;
  types: string[];
  includeArchived: boolean;
  filters: { field: string; operator: 'contains' | 'equals' | 'empty'; value: string }[];
  sort: { field: string; direction: 'asc' | 'desc' };
  groupBy: string;
  /** Optional relationship query. The endpoint remains an ID, never a copied record. */
  relatedTo?: ReferenceIdentity;
}
export const defaultObjectViewQuery = (): ObjectViewQuery => ({ layout: 'table', types: ['task', 'project', 'experiment'], includeArchived: false,
  filters: [], sort: { field: 'name', direction: 'asc' }, groupBy: 'property:status' });
export function validateObjectViewQuery(query: ObjectViewQuery) {
  const field = (value: unknown) => typeof value === 'string' && /^(name|type|description|archived|property:[\s\S]{1,100})$/.test(value);
  if (!query || !['table', 'board', 'gallery'].includes(query.layout) || !Array.isArray(query.types) || query.types.length > 100 ||
    query.types.some(type => !validObjectType(type)) || new Set(query.types).size !== query.types.length ||
    typeof query.includeArchived !== 'boolean' || !Array.isArray(query.filters) || query.filters.length > 20 ||
    query.filters.some(filter => !filter || !field(filter.field) || !['contains', 'equals', 'empty'].includes(filter.operator) || typeof filter.value !== 'string' || filter.value.length > 2000) ||
    !query.sort || !field(query.sort.field) || !['asc', 'desc'].includes(query.sort.direction) || !field(query.groupBy) ||
    (query.relatedTo !== undefined && (!query.relatedTo || !validObjectType(query.relatedTo.type) || !/^[0-9a-f]{6}$/.test(query.relatedTo.id))))
    throw new Error('对象视图查询格式无效');
  return query;
}
export function objectViewValue(object: WorkspaceObject, field: string): unknown {
  return field.startsWith('property:') ? (Object.hasOwn(object.properties, field.slice(9)) ? object.properties[field.slice(9)] : undefined) : object[field];
}
export const objectViewText = (value: unknown): string => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
/** All layouts consume this single projection. Rows are the original records, not copies. */
export class ViewEngine {
  query(objects: readonly WorkspaceObject[], query: ObjectViewQuery, relations: readonly WorkspaceRelation[] = []) {
    validateObjectViewQuery(query);
    const text = (value: unknown) => objectViewText(value).toLocaleLowerCase();
    const linked = new Set<string>();
    if (query.relatedTo) {
      const key = referenceKey(query.relatedTo);
      for (const edge of relations) {
        if (referenceKey(edge.source) === key) linked.add(referenceKey(edge.target));
        if (referenceKey(edge.target) === key) linked.add(referenceKey(edge.source));
      }
    }
    const seen = new Set<string>();
    const rows = objects.filter(object => {
      const key = referenceKey(object);
      if (seen.has(key)) throw new Error('对象身份重复，无法建立视图');
      seen.add(key);
      return (query.includeArchived || !object.archived) && (!query.types.length || query.types.includes(object.type)) &&
        (!query.relatedTo || linked.has(key)) && query.filters.every(filter => {
          const value = text(objectViewValue(object, filter.field));
          return filter.operator === 'empty' ? !value : filter.operator === 'equals' ? value === text(filter.value) : value.includes(text(filter.value));
        });
    }).sort((a, b) => {
      const av = objectViewValue(a, query.sort.field), bv = objectViewValue(b, query.sort.field);
      const order = typeof av === 'number' && typeof bv === 'number' ? av - bv : text(av).localeCompare(text(bv), 'zh-CN', { numeric: true });
      return (query.sort.direction === 'desc' ? -order : order) || referenceKey(a).localeCompare(referenceKey(b));
    });
    const groups = new Map<string, WorkspaceObject[]>();
    for (const row of rows) {
      const key = objectViewText(objectViewValue(row, query.groupBy));
      const group = groups.get(key); if (group) group.push(row); else groups.set(key, [row]);
    }
    return { rows, groups: [...groups].map(([name, rows]) => ({ name, rows })) };
  }
}
export const viewEngine = new ViewEngine();
