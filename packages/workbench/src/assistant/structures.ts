import { parseObject, parseRelations, referenceKey, relationKey, validateObjectProperties, validateRelation, workspaceRelationPath } from '@tano/protocol';
import type { AssistantProposal, AssistantRequest, AssistantToolCall, ReferenceTarget, RelationTypeDefinition, WorkspaceRelation } from '@tano/protocol';

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
];

export function structureProposal(call: AssistantToolCall, context: {
  workspaceId: string; runId: string; id: string; relationContent: string; targets: readonly ReferenceTarget[];
  relationTypes: readonly RelationTypeDefinition[];
}): AssistantProposal {
  const args = JSON.parse(call.function.arguments);
  const keys = call.function.name === 'propose_event' ? ['name', 'description', 'properties', 'reason'] : ['type', 'source', 'target', 'reason'];
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
  if (call.function.name !== 'propose_relation') throw new Error('工作区工具未授权');
  const row: WorkspaceRelation = { id: context.id, type: args.type, source: args.source, target: args.target };
  const base = context.relationContent ? parseRelations(context.relationContent) : { version: 1 as const, relations: [] };
  const file = parseRelations(JSON.stringify({ ...base, relations: [...base.relations, row] }));
  validateRelation(row, context.relationTypes);
  for (const identity of [row.source, row.target])
    if (!context.targets.some(target => referenceKey(target) === referenceKey(identity) && !target.archived)) throw new Error('关系端点不属于可用工作区目标');
  if (base.relations.some(existing => relationKey(existing) === relationKey(row))) throw new Error('关系已经存在');
  return { ...common, kind: 'relation', path: workspaceRelationPath, base: context.relationContent, content: JSON.stringify(file, null, 2) + '\n' };
}
