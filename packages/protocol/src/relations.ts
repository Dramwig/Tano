import { isShortId } from './short-id';
import { objectTypeRegistry, validObjectType } from './object-types';
import type { ReferenceIdentity } from './objects';

export interface RelationTypeDefinition {
  type: string;
  label: string;
  sourceTypes: readonly string[];
  targetTypes: readonly string[];
  level: 2;
  plugin?: string;
}
export const coreRelationTypes: readonly RelationTypeDefinition[] = [
  { type: 'related', label: '关联', sourceTypes: ['*'], targetTypes: ['*'], level: 2 },
  { type: 'assigned', label: '负责', sourceTypes: ['person'], targetTypes: ['event', 'task'], level: 2 },
  { type: 'authored', label: '撰写', sourceTypes: ['person'], targetTypes: ['document'], level: 2 },
  { type: 'attends', label: '参加', sourceTypes: ['person'], targetTypes: ['event'], level: 2 },
  { type: 'attachment', label: '附有资产', sourceTypes: ['*'], targetTypes: ['asset'], level: 2 },
];
export interface WorkspaceRelation {
  id: string;
  type: string;
  source: ReferenceIdentity;
  target: ReferenceIdentity;
  [key: string]: unknown;
}
export interface RelationFile {
  version: 1;
  relations: WorkspaceRelation[];
  [key: string]: unknown;
}
export { workspaceRelationPath as relationPath } from './workspace-paths';
export const referenceKey = (value: ReferenceIdentity) => `${value.type}/${value.id}`;
export const relationKey = (value: Pick<WorkspaceRelation, 'source' | 'type' | 'target'>) =>
  `${referenceKey(value.source)}:${value.type}:${referenceKey(value.target)}`;
export const acceptsRelationType = (types: readonly string[], type: string) =>
  types.includes('*') || types.includes(type);

/** Validate the envelope without requiring plugins or endpoints to be available. */
export function parseRelations(content: string): RelationFile {
  const file = JSON.parse(content);
  if (
    !file ||
    file.version !== 1 ||
    !Array.isArray(file.relations) ||
    file.relations.length > 50000
  )
    throw new Error('关系文件格式无效');
  const ids = new Set<string>();
  const identity = (value: ReferenceIdentity) =>
    value && validObjectType(value.type) && isShortId(value.id);
  for (const row of file.relations) {
    if (
      !row ||
      !isShortId(row.id) ||
      ids.has(row.id) ||
      !validObjectType(row.type) ||
      !identity(row.source) ||
      !identity(row.target)
    )
      throw new Error('关系 ID、类型或端点无效或重复');
    ids.add(row.id);
  }
  return file;
}
export function validateRelation(
  row: WorkspaceRelation,
  definitions: readonly RelationTypeDefinition[],
) {
  const definition = definitions.find((item) => item.type === row.type);
  if (!definition) throw new Error('关系类型未启用，请先启用对应插件');
  if ([row.source, row.target].some((endpoint) => objectTypeRegistry.get(endpoint.type)?.retired))
    throw new Error('项目对象已停用，不能新增关系；已有关系仍保留');
  if (
    !acceptsRelationType(definition.sourceTypes, row.source.type) ||
    !acceptsRelationType(definition.targetTypes, row.target.type)
  )
    throw new Error('此关系不支持所选的来源或目标类型');
  if (referenceKey(row.source) === referenceKey(row.target))
    throw new Error('来源和目标不能是同一对象');
}

/** Derived, rebuildable graph. Names and paths never participate in identity. */
export class RelationIndex {
  private outgoing = new Map<string, WorkspaceRelation[]>();
  private incoming = new Map<string, WorkspaceRelation[]>();
  constructor(rows: readonly WorkspaceRelation[]) {
    for (const row of rows) {
      for (const [index, key] of [
        [this.outgoing, referenceKey(row.source)],
        [this.incoming, referenceKey(row.target)],
      ] as const) {
        const entries = index.get(key) ?? [];
        entries.push(row);
        index.set(key, entries);
      }
    }
  }
  connections(identity: ReferenceIdentity, direction: 'outgoing' | 'incoming' | 'both' = 'both') {
    const key = referenceKey(identity);
    return [
      ...new Set([
        ...(direction !== 'incoming' ? (this.outgoing.get(key) ?? []) : []),
        ...(direction !== 'outgoing' ? (this.incoming.get(key) ?? []) : []),
      ]),
    ];
  }
  traverse(
    start: ReferenceIdentity,
    depth = 1,
    direction: 'outgoing' | 'incoming' | 'both' = 'outgoing',
  ) {
    const visited = new Map([[referenceKey(start), start]]);
    let frontier = [start];
    for (
      let step = 0;
      step < Math.min(Math.max(Math.floor(depth), 0), 100) && frontier.length;
      step++
    ) {
      const next: ReferenceIdentity[] = [];
      for (const node of frontier)
        for (const row of this.connections(node, direction)) {
          const other = referenceKey(row.source) === referenceKey(node) ? row.target : row.source;
          if (!visited.has(referenceKey(other))) {
            visited.set(referenceKey(other), other);
            next.push(other);
          }
        }
      frontier = next;
    }
    visited.delete(referenceKey(start));
    return [...visited.values()];
  }
}
