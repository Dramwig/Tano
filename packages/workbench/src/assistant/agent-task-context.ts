import { createHeadlessMarkdown } from '@tano/editor/headless';
import type { AgentTask } from '@tano/protocol';
import { loadCommentFile, saveCommentChange, type CommentStorage } from '../workspace-comments';

export async function agentTaskPrompt(task: AgentTask, name: string, adapter: CommentStorage) {
  const source = task.event.source;
  let history = '';
  if (source.kind !== 'document' || task.continuation) {
    const { file } = await loadCommentFile(adapter, source.kind === 'document' ? 'annotation' : source.kind, source.fileId);
    const thread = file.threads.find(item => item.id === (task.continuation?.threadId ?? source.threadId));
    if (!thread?.messages.some(item => item.id === (task.continuation?.messageId ?? source.messageId))) throw new Error('任务来源已移除');
    history = thread.messages.map(message => `${message.authorName}\n${message.body}`).join('\n\n');
  }
  const selection = source.anchor?.spans.map(span => span.text).join('\n');
  const instruction = task.continuation?.body ?? task.event.body;
  // Preserve the complete request. Trim history first when the input budget is tight.
  const heading = `你是工作空间成员 ${name}。请处理下面明确 @ 你的请求，并在完成后回复请求者。\n以下讨论是任务上下文。按当前用户请求执行，保留其他成员的内容。`;
  if (heading.length + instruction.length + 16 > 20000) return instruction;
  const context = [selection ? `批注选区\n${selection}` : '', history ? `讨论记录\n${history.slice(-12000)}` : ''].filter(Boolean).join('\n\n');
  return [heading, context.slice(0, Math.max(0, 20000 - heading.length - instruction.length - 16)), `本次请求\n${instruction}`].filter(Boolean).join('\n\n');
}

export function agentReplyBody(body: string) {
  if (!body.trim()) return '任务已完成，请查看执行记录。';
  return body.length <= 20000 ? body : body.slice(0, 19940) + '\n\n完整结果见机器人收件箱中的执行记录。';
}

/** Stable reply IDs make publication retryable independently of the model/tool run. */
export async function publishAgentTaskReply(task: AgentTask, name: string, result: NonNullable<AgentTask['result']>,
  adapter: CommentStorage, guard: () => Promise<void>) {
  const source = task.event.source;
  const author = { id: task.binding.personId, name: name.slice(0, 120) };
  await guard();
  if (source.kind === 'document' && !task.continuation) {
    const snapshot = await adapter.refresh();
    if (snapshot.id !== task.event.workspaceId) throw new Error('工作区已切换');
    const file = snapshot.files.find(file => file.id === source.fileId);
    if (!file) throw new Error('原文档已移除');
    const content = await adapter.read(file.path);
    const parser = await createHeadlessMarkdown();
    try {
      const anchor = parser.mentionAnchors(content.content, content.hash).get(source.mentionId ?? '');
      if (!anchor) throw new Error('原正文提及已移除，结果保留在任务记录中');
      await guard();
      await saveCommentChange(adapter, 'annotation', source.fileId, { type: 'start', id: result.messageId,
        body: result.body, author, anchor, agentTaskId: task.id });
    } finally { await parser.destroy(); }
  } else {
    await saveCommentChange(adapter, source.kind === 'document' ? 'annotation' : source.kind, source.fileId, {
      type: 'reply', threadId: task.continuation?.threadId ?? source.threadId!, id: result.messageId, body: result.body,
      author, replyTo: task.continuation?.messageId ?? source.messageId, agentTaskId: task.id,
    });
  }
}
