import type { AssistantProposalStatus, AssistantRequest, AssistantSource } from '@tano/protocol';
import { editDocumentRules } from './tool-rules';

/** Direct tools share validation with proposals; their receipts come from completed storage operations. */
export const directTools: Record<string, { proposal: string; description: string }> = {
  edit_document: { proposal: 'propose_edit', description: `按用户明确指令直接修改已读取的 Markdown 或 .table.json 数据表。\n${editDocumentRules}\n冲突时暂停，只有 written=true 才表示已保存。` },
  create_document: { proposal: 'propose_create', description: '按用户明确指令直接创建 Markdown 文档或 .table.json 数据表（content 为完整表结构 JSON）。父目录须存在，禁止覆盖同名文件。' },
  delete_document: { proposal: 'propose_delete', description: '仅在用户明确要求删除时直接删除完整 Markdown 或 .table.json 文件。读取后内容或路径变化则暂停；桌面文件进入回收站。' },
  rename_document: { proposal: 'propose_rename', description: '按用户明确指令直接重命名 Markdown 或 .table.json 文件。destination 为同目录新路径；保留文件类型、身份和内容，禁止覆盖。' },
  move_document: { proposal: 'propose_move', description: '按用户明确指令直接移动 Markdown 或 .table.json 文件。destination 为已有目录下完整路径；保留文件类型、身份和内容，禁止覆盖。' },
  create_event: { proposal: 'propose_event', description: '按用户明确指令直接创建工作区事件或任务。先读取对象并检查已有任务；可能重复时暂停。不会写入个人计划或外部日历。' },
  create_relation: { proposal: 'propose_relation', description: '按用户明确指令直接新增工作区关系。必须使用已读取目标的稳定 ID。' },
  update_task: { proposal: 'propose_task_update', description: '按用户明确指令直接修改已读取任务的字段。完成任务须有验收证据，日期不明确时先澄清。' },
  update_assignment: { proposal: 'propose_assignment', description: '按用户明确指令直接调整已有任务的负责人。使用已读取的稳定 ID，并发变化时暂停。' },
  change_relation: { proposal: 'propose_relation_change', description: '按用户明确指令直接修改或移除已读取的工作区关系，并发变化时暂停。' },
};
export function directProposalName(name: string) {
  return Object.prototype.hasOwnProperty.call(directTools, name) ? directTools[name].proposal : undefined;
}
export function executionTools(proposals: NonNullable<AssistantRequest['tools']>) {
  return Object.entries(directTools).flatMap(([name, config]) => {
    const source = proposals.find(tool => tool.function.name === config.proposal);
    return source ? [{ ...source, function: { ...source.function, name, description: config.description } }] : [];
  });
}
export interface AssistantExecutionResult {
  status: AssistantProposalStatus;
  written: boolean | null;
  error?: string;
  fileId?: string;
  path?: string;
  source?: AssistantSource;
}
