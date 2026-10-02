import { parseObject, parseRelations, referenceKey, relationKey, validateObjectProperties, validateRelation, workspaceRelationPath } from '@tano/protocol';
import type { AssistantProposal, AssistantRequest, AssistantToolCall, ReferenceTarget, RelationTypeDefinition, WorkspaceRelation, WorkspaceObject, RelationFile } from '@tano/protocol';

const text = { type: 'string' };
const endpoint = { type: 'object', properties: { type: text, id: text }, required: ['type', 'id'], additionalProperties: false };
const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[]) => ({ type: 'function' as const,
  function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } });
export const structureTools: NonNullable<AssistantRequest['tools']> = [
  tool('read_workspace_objects', '读取用户授权的工作区对象、可引用目标与关系类型；不包含个人计划，不读取附件正文。', {}, []),
  tool('propose_event', '建议创建工作区事件。任务也用事件表示，checkable=true；只提出建议，不发布到个人计划或外部日历。', {
    name: text, description: text, reason: text, properties: { type: 'object', properties: {
      checkable: { type: 'boolean' }, completed: { type: 'boolean' }, due: text, date: text, start: text, end: text,
    }, additionalProperties: false },
  }, ['name', 'description', 'properties', 'reason']),
  tool('propose_relation', '建议在两个已有工作区目标之间新增关系，必须使用读取结果中的 type 和稳定 id；只提出建议。', {
    type: text, source: endpoint, target: endpoint, reason: text,
  }, ['type', 'source', 'target', 'reason']),
  tool('propose_task_update', '基于已读取的任务快照建议修改名称、描述或日期及完成状态。patch 只包含需要修改的字段；属性 null 表示清除。描述保留引用。完成建议须在 reason 中注明验收依据；等待用户确认。', {
    target: endpoint, patch: { type: 'object', properties: { name: text, description: text, properties: { type: 'object', properties: {
      completed: { type: 'boolean' }, due: { type: ['string', 'null'] }, date: { type: ['string', 'null'] },
      start: { type: ['string', 'null'] }, end: { type: ['string', 'null'] },
    }, additionalProperties: false } }, additionalProperties: false }, reason: text,
  }, ['target', 'patch', 'reason']),
  tool('propose_assignment', '建议替换任务负责人或清除分配。target 必须是已读取任务，personId 必须是已读取人物的稳定 ID，null 清除。保留其他任务的负责人；等待用户确认。', {
    target: endpoint, personId: { type: ['string', 'null'] }, reason: text,
  }, ['target', 'personId', 'reason']),
  tool('propose_relation_change', '建议修改或移除已有关系。使用已读 relationId；remove 时 type/source/target 均为 null。修改保留关系身份；等待用户确认。', {
    relationId: text, action: { type: 'string', enum: ['update', 'remove'] }, type: { type: ['string', 'null'] },
    source: { anyOf: [endpoint, { type: 'null' }] }, target: { anyOf: [endpoint, { type: 'null' }] }, reason: text,
  }, ['relationId', 'action', 'type', 'source', 'target', 'reason']),
];

export const structureToolNames = new Set(structureTools.map(item => item.function.name));
export interface StructureSnapshot {
  targets: readonly ReferenceTarget[];
  relationTypes: readonly RelationTypeDefinition[];
  relationContent: string;
  objects: readonly { object: WorkspaceObject; path: string; content: string; fileId: string }[];
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const available = (targets: readonly ReferenceTarget[], identity: { type: string; id: string }) =>
  targets.some(target => referenceKey(target) === referenceKey(identity) && !target.archived);
export function requireTask(object: WorkspaceObject) {
  if (object.archived || !(object.type === 'task' || (object.type === 'event' && object.properties.checkable === true)))
    throw new Error('只能修改可用的已有任务');
}
export function validateTaskUpdate(base: WorkspaceObject, proposed: WorkspaceObject) {
  requireTask(base); requireTask(proposed);
  if (!same({ ...base, name: '', description: '', properties: {} }, { ...proposed, name: '', description: '', properties: {} }))
    throw new Error('任务身份、类型和扩展字段不能修改');
  for (const key of new Set([...Object.keys(base.properties), ...Object.keys(proposed.properties)])) {
    if (!['completed', 'due', 'date', 'start', 'end', ...(base.type === 'task' ? ['status'] : [])].includes(key) && !same(base.properties[key], proposed.properties[key]))
      throw new Error('任务属性修改超出允许范围');
  }
  validateObjectProperties('event', proposed.properties);
}

export function structureProposal(call: AssistantToolCall, context: {
  workspaceId: string; runId: string; id: string; relationContent: string; targets: readonly ReferenceTarget[];
  relationTypes: readonly RelationTypeDefinition[];
  objects?: StructureSnapshot['objects'];
}): AssistantProposal {
  const args = JSON.parse(call.function.arguments);
  const keys = ({ propose_event: ['name', 'description', 'properties', 'reason'],
    propose_relation: ['type', 'source', 'target', 'reason'], propose_task_update: ['target', 'patch', 'reason'],
    propose_assignment: ['target', 'personId', 'reason'], propose_relation_change: ['relationId', 'action', 'type', 'source', 'target', 'reason'],
  } as Record<string, string[]>)[call.function.name];
  if (!keys) throw new Error('工作区工具未授权');
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !keys.includes(key)) ||
      keys.some(key => !(key in args)) || typeof args.reason !== 'string' || !args.reason.trim() || args.reason.length > 4000)
    throw new Error('工作区建议参数无效');
  const common = { id: crypto.randomUUID(), workspaceId: context.workspaceId, runId: context.runId, reason: args.reason, status: 'ready' as const };
  if (call.function.name === 'propose_event') {
    const object = parseObject(JSON.stringify({ version: 1, id: context.id, type: 'event', name: args.name,
      description: args.description, properties: args.properties, archived: false }));
    validateObjectProperties('event', object.properties);
    return { ...common, kind: 'object', path: `.tano/objects/${object.id}.tano.json`, base: '', content: JSON.stringify(object, null, 2) + '\n' };
  }
  if (['propose_task_update', 'propose_assignment'].includes(call.function.name)) {
    if (!args.target || Object.keys(args.target).sort().join() !== 'id,type') throw new Error('任务目标无效');
    const record = context.objects?.find(record => referenceKey(record.object) === referenceKey(args.target));
    if (!record) throw new Error('必须先读取已有任务快照');
    requireTask(record.object);
    if (call.function.name === 'propose_task_update') {
      const patch = args.patch;
      if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length ||
          Object.keys(patch).some(key => !['name', 'description', 'properties'].includes(key))) throw new Error('任务修改字段无效');
      const properties = { ...record.object.properties };
      if ('properties' in patch) {
        if (!patch.properties || typeof patch.properties !== 'object' || Array.isArray(patch.properties) ||
            Object.keys(patch.properties).some(key => !['completed', 'due', 'date', 'start', 'end'].includes(key))) throw new Error('任务属性修改无效');
        for (const [key, value] of Object.entries(patch.properties)) {
          if (value === null && key !== 'completed') delete properties[key];
          else properties[key] = value;
        }
        if (record.object.type === 'task' && 'completed' in patch.properties)
          properties.status = patch.properties.completed ? 'done' : 'open';
      }
      const object = parseObject(JSON.stringify({ ...record.object, ...patch, properties }));
      validateTaskUpdate(record.object, object);
      if (same(record.object, object)) throw new Error('任务没有变化');
      return { ...common, kind: 'object', path: record.path, fileId: record.fileId, base: record.content, content: JSON.stringify(object, null, 2) + '\n' };
    }
  }
  const base = context.relationContent ? parseRelations(context.relationContent) : { version: 1 as const, relations: [] };
  let rows = [...base.relations];
  if (call.function.name === 'propose_assignment') {
    if (args.personId !== null && (typeof args.personId !== 'string' || !available(context.targets, { type: 'person', id: args.personId })))
      throw new Error('负责人不属于可用工作区人物');
    const matches = (row: WorkspaceRelation) => row.type === 'assigned' && referenceKey(row.target) === referenceKey(args.target);
    const existing = rows.find(row => matches(row) && row.source.id === args.personId);
    rows = rows.filter(row => !matches(row));
    if (args.personId !== null) rows.push(existing ?? { id: context.id, type: 'assigned', source: { type: 'person', id: args.personId }, target: args.target });
  } else if (call.function.name === 'propose_relation_change') {
    const previous = rows.find(row => row.id === args.relationId);
    if (!previous) throw new Error('必须使用已读取的关系 ID');
    if (args.action === 'remove') {
      if (args.type !== null || args.source !== null || args.target !== null) throw new Error('移除关系参数无效');
      rows = rows.filter(row => row.id !== previous.id);
    } else if (args.action === 'update') {
      rows = rows.map(row => row.id === previous.id ? { ...previous, type: args.type, source: args.source, target: args.target } : row);
    } else throw new Error('关系维护操作无效');
  } else rows.push({ id: context.id, type: args.type, source: args.source, target: args.target });
  const file = parseRelations(JSON.stringify({ ...base, relations: rows }));
  mergeStructureRelations(base, file, base, context.targets, context.relationTypes);
  return { ...common, kind: 'relation', path: workspaceRelationPath, base: context.relationContent, content: JSON.stringify(file, null, 2) + '\n' };
}

/** Compare changed rows and assignment groups; preserve unrelated concurrent edges. */
export function mergeStructureRelations(base: RelationFile, proposed: RelationFile, current: RelationFile,
  targets: readonly ReferenceTarget[], definitions: readonly RelationTypeDefinition[]): RelationFile | null {
  if (!same({ ...base, relations: [] }, { ...proposed, relations: [] })) throw new Error('关系文件扩展字段不能修改');
  const previous = base.relations.filter(row => !same(row, proposed.relations.find(next => next.id === row.id)));
  const next = proposed.relations.filter(row => !same(row, base.relations.find(old => old.id === row.id)));
  if (!previous.length && !next.length) throw new Error('关系没有变化');
  const changed = [...previous, ...next];
  const assignment = changed.every(row => row.type === 'assigned' && referenceKey(row.target) === referenceKey(changed[0].target));
  if (!assignment && new Set(changed.map(row => row.id)).size > 1) throw new Error('一次只能维护一条关系');
  if (assignment) {
    const matches = (row: WorkspaceRelation) => row.type === 'assigned' && referenceKey(row.target) === referenceKey(changed[0].target);
    const ordered = (rows: WorkspaceRelation[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
    if (!same(ordered(base.relations.filter(matches)), ordered(current.relations.filter(matches)))) return null;
  }
  for (const row of previous) if (!same(row, current.relations.find(old => old.id === row.id))) return null;
  for (const row of next) {
    validateRelation(row, definitions);
    for (const identity of [row.source, row.target])
      if (!available(targets, identity)) throw new Error('关系端点不属于可用工作区目标');
    if (!base.relations.some(old => old.id === row.id) && current.relations.some(old => old.id === row.id)) return null;
  }
  const ids = new Set(previous.map(row => row.id));
  const rows = [...current.relations.filter(row => !ids.has(row.id)), ...next];
  if (new Set(rows.map(relationKey)).size !== rows.length) throw new Error('关系已经存在');
  return parseRelations(JSON.stringify({ ...current, relations: rows }));
}
