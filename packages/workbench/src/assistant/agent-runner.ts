import { effectScope, watch } from 'vue';
import { agentTaskPrompt, publishAgentTaskReply, agentReplyBody } from './agent-task-context';
import type { AgentTask, AssistantSession, WorkspaceAdapter } from '@tano/protocol';

import { createAssistantState, type BackgroundAssistantHooks } from './store';
import { AssistantWaitingError } from './engine';
import { assistantAnswerText } from './results';
import type { AgentTaskQueue } from './inbox';

/** Uses the same session persistence, tools, conflict handling and receipts as interactive chat. */
export function createAgentTaskRunner(queue: AgentTaskQueue, adapter: WorkspaceAdapter,
  context: Pick<BackgroundAssistantHooks, 'workspace' | 'runtime'>, signal?: AbortSignal) {
  return async (task: AgentTask, name: string, restored?: AssistantSession) => {
    const scope = effectScope();
    const token = task.claim!.token;
    const workspaceId = task.event.workspaceId;
    let question = '';
    let enteredExecution = false;
    const guard = () => { signal?.throwIfAborted(); return queue.renew(workspaceId, task.id, token); };
    const runner = scope.run(() => createAssistantState(false, {
      ...context,
      guard,
      askUser: async questions => {
        question = questions.map(item => `${item.question}${item.options?.length ? '\n' + item.options.map(option => `- ${option}`).join('\n') : ''}`).join('\n\n');
        throw new AssistantWaitingError('等待原讨论中的回复');
      },
    }))!;
    const stop = () => runner.stop();
    signal?.addEventListener('abort', stop, { once: true });
    const heartbeat = setInterval(() => { void guard().catch(() => runner.stop()); }, 20_000);
    try {
      if (runner.loading.value) await new Promise<void>(resolve => {
        const stop = watch(runner.loading, loading => { if (!loading) { stop(); resolve(); } });
      });
      await guard();
      if (task.result) {
        enteredExecution = true;
        await publishAgentTaskReply(task, name, task.result, adapter, guard);
        await queue.settle(workspaceId, task.id, token, task.result.outcome ?? 'succeeded');
        return;
      }
      if (runner.error.value) throw new Error(runner.error.value);
      if (!runner.connections.value.some(item => item.id === task.binding.connectionId)) throw new Error('模型连接已移除');
      runner.connectionId.value = task.binding.connectionId;
      // Background bindings have an explicit model and never depend on the active panel.
      runner.modelId.value = task.binding.model;
      runner.reasoningEffort.value = task.binding.reasoningEffort ?? 'medium';
      runner.newSession();
      if (restored) {
        runner.session.value = restored;
        // The next turn contains the exact discussion reply. Retain the old question as context.
        for (const message of restored.messages) for (const input of message.userInputs ?? [])
          if (input.status === 'pending') input.status = 'cancelled';
      }
      runner.session.value!.id = task.sessionId;
      runner.files.value = [task.event.source.fileId];
      runner.prompt.value = await agentTaskPrompt(task, name, adapter);
      enteredExecution = true;
      await runner.send();
      await guard();
      const reply = runner.session.value?.messages.at(-1);
      if (!reply || reply.role !== 'assistant') throw new Error(runner.error.value || '机器人未开始执行');
      if (reply.state !== 'completed' && reply.state !== 'waiting') {
        const uncertain = reply.proposals?.some(item => ['unknown', 'applying'].includes(item.status));
        await queue.settle(workspaceId, task.id, token, uncertain ? 'uncertain' : 'failed', reply.error);
        return;
      }
      const body = agentReplyBody(question || assistantAnswerText(reply));
      const uncertain = reply.proposals?.some(proposal => ['unknown', 'applying'].includes(proposal.status));
      const outcome = uncertain ? 'uncertain' : question ? 'waiting' : 'succeeded';
      const result = await queue.recordResult(workspaceId, task.id, token, body, outcome);
      await guard();
      await publishAgentTaskReply(task, name, result, adapter, guard);
      await queue.settle(workspaceId, task.id, token, outcome);
    } catch (error) {
      if (signal?.aborted && !enteredExecution) await queue.releaseUnstarted(workspaceId, task.id, token);
      else throw error;
    } finally {
      clearInterval(heartbeat);
      signal?.removeEventListener('abort', stop);
      scope.stop();
    }
  };
}
