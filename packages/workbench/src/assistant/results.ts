import type { AssistantMessage, AssistantWireMessage } from '@tano/protocol';

/** Keep the model's prose separate from the application's current review state. */
export function assistantHistory(messages: readonly AssistantMessage[]): AssistantWireMessage[] {
  return messages.slice(-16).map(message => message.role === 'user'
    ? { role: 'user', content: message.content }
    : { role: 'assistant', content: JSON.stringify({ answer: message.content, execution: {
      state: message.state ?? 'unknown',
      ...(message.error ? { error: message.error.slice(0, 2000) } : {}),
      // Null distinguishes old conversations without receipts from a verified empty list.
      tools: message.toolResults ?? null,
      proposals: (message.proposals ?? []).map(proposal => ({
        id: proposal.id, kind: proposal.kind, path: proposal.path, status: proposal.status,
        ...(proposal.execution ? { execution: proposal.execution } : {}),
        ...(proposal.destination ? { destination: proposal.destination } : {}),
        review: proposal.suggestionGroupId ? 'document' : 'conversation',
        written: proposal.suggestionGroupId || ['applying', 'unknown'].includes(proposal.status)
          ? null : proposal.status === 'applied',
      })),
    } }) });
}

export function assistantResultNotice(message: AssistantMessage) {
  if (message.role !== 'assistant' || message.state === 'running') return '';
  if (!message.proposals?.length) return '本轮未生成修改建议，未写入文件。';
  return '';
}

const toolLabels: Record<string, string> = {
  propose_create: '创建文档建议', propose_edit: '修改文档建议',
  propose_delete: '删除文档建议', propose_rename: '重命名文档建议', propose_move: '移动文档建议',
  edit_document: '修改文档', create_document: '创建文档', delete_document: '删除文档', rename_document: '重命名文档', move_document: '移动文档',
  create_event: '创建事件', create_relation: '新增关系', update_task: '修改任务', update_assignment: '调整负责人', change_relation: '维护关系',
  search_documents: '搜索文档', read_document: '读取文档',
  read_workspace_objects: '读取工作区对象', read_reference_context: '读取引用', query_tasks: '查询任务',
  propose_event: '创建事件建议', propose_relation: '创建关系建议',
  propose_task_update: '修改任务建议', propose_assignment: '调整负责人建议', propose_relation_change: '维护关系建议',
};
export function assistantToolLabel(name: string) {
  return Object.prototype.hasOwnProperty.call(toolLabels, name) ? toolLabels[name] : '工具调用';
}
