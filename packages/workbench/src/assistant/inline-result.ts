import type { AssistantMessage, AssistantProposal } from '@tano/protocol';

export interface InlineAssistantResult {
  state: 'completed' | 'response' | 'error';
  message: string;
  proposal?: AssistantProposal;
}

/** A successful reply is not necessarily an edit; only storage receipts prove an update. */
export function inlineAssistantResult(reply?: AssistantMessage, error = ''): InlineAssistantResult {
  const proposals = reply?.proposals ?? [];
  const applied = proposals.filter(item => item.execution === 'direct' && item.status === 'applied');
  if (reply?.state === 'cancelled') return { state: 'response', message: applied.length ? '已停止，已完成的修改已保留' : '已停止，未修改原文' };
  const blocked = proposals.find(item => item.status === 'conflicted' || item.status === 'unknown' || item.status === 'applying' || item.error);
  const failure = error || reply?.error || blocked?.error ||
    (blocked ? '修改存在冲突或结果待核对，请在对话中查看' : '') ||
    (!applied.length ? reply?.toolResults?.find(item => item.status === 'failed')?.error : '');
  if (failure || reply?.state === 'failed') return {
    state: 'error', message: `${applied.length ? '部分修改已保存；' : ''}${failure || '请求失败，请在对话中查看详情'}`,
  };
  if (proposals.some(item => item.status === 'ready')) return { state: 'response', message: '已生成修改建议，请在对话中审阅' };
  if (applied.length) return { state: 'completed', message: reply?.content.trim() || '我已完成更新。', proposal: applied[0] };
  if (reply?.content.trim()) return { state: 'response', message: reply.content.trim() };
  return { state: 'response', message: '助手未返回内容，可在对话中重试' };
}
