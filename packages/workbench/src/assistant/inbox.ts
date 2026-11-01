import type { AgentInbox, AgentInboxStorage, AgentTask, MentionEvent, MentionSource } from '@tano/protocol';
import { isAssistantModelId } from '@tano/protocol';

/** All transitions use the host's CAS, including claims from another window/device. */
export class AgentTaskQueue {
  constructor(private readonly storage: AgentInboxStorage, private readonly now = Date.now) {}

  async update<T>(workspaceId: string, change: (inbox: AgentInbox) => T): Promise<T> {
    for (let attempt = 0; attempt < 12; attempt++) {
      const current = await this.storage.load(workspaceId);
      const next = structuredClone(current);
      const result = change(next);
      if (JSON.stringify(current) === JSON.stringify(next)) return result;
      next.revision = current.revision + 1;
      if (await this.storage.compareExchange(next, current.revision)) return result;
    }
    throw new Error('机器人收件箱正在其他窗口更新，请稍后重试');
  }

  /** Supply a complete, committed snapshot of this source, including an empty deleted source. */
  async reconcile(workspaceId: string, source: Pick<MentionSource, 'kind' | 'fileId'>, events: MentionEvent[],
    accept: (event: MentionEvent) => boolean = () => true) {
    if (events.some(event => event.workspaceId !== workspaceId || event.source.fileId !== source.fileId || event.source.kind !== source.kind) ||
        new Set(events.map(event => event.id)).size !== events.length) throw new Error('提及事件来源无效');
    await this.update(workspaceId, inbox => {
      const now = this.now();
      for (const event of events) {
        if (!accept(event)) continue;
        const binding = inbox.bindings.find(item => item.personId === event.personId);
        if (!binding) continue;
        const task = inbox.tasks.find(item => item.event.id === event.id && item.event.personId === event.personId);
        if (task) {
          if (task.status === 'queued' && !task.continuation && task.event.revision !== event.revision) {
            task.event = structuredClone(event);
            task.updatedAt = now;
            if (event.source.kind === 'document') task.readyAt = now + 2000;
          }
          continue;
        }
        inbox.tasks.push({ id: crypto.randomUUID(), event: structuredClone(event), binding: { ...binding },
          status: 'queued', sessionId: crypto.randomUUID(), createdAt: now, updatedAt: now, attempts: 0,
          ...(event.source.kind === 'document' ? { readyAt: now + 2000 } : {}) });
      }
      for (const task of inbox.tasks) {
        if (task.event.source.kind !== source.kind || task.event.source.fileId !== source.fileId ||
            !['queued', 'running', 'waiting'].includes(task.status)) continue;
        if (!events.some(event => event.id === task.event.id && event.personId === task.event.personId)) {
          task.status = 'cancelled'; task.updatedAt = now;
          task.error = '原提及已移除'; delete task.claim;
        }
      }
    });
  }

  async claim(workspaceId: string, owner: string, leaseMs = 60_000): Promise<AgentTask | undefined> {
    if (!owner || !Number.isFinite(leaseMs) || leaseMs < 1000) throw new Error('任务租约无效');
    return this.update(workspaceId, inbox => {
      const now = this.now();
      for (const task of inbox.tasks) {
        if (task.status === 'running' && (!task.claim || task.claim.until <= now)) {
          task.status = 'uncertain'; task.error = '执行进程中断，请核对操作回执';
          task.updatedAt = now; delete task.claim;
        }
      }
      const busy = new Set(inbox.tasks.filter(task => task.status === 'running').map(task => task.binding.personId));
      const firstQueued = new Map<string, AgentTask>();
      for (const item of inbox.tasks) if (item.status === 'queued' && !firstQueued.has(item.binding.personId)) firstQueued.set(item.binding.personId, item);
      const task = [...firstQueued.values()].find(item => (item.readyAt ?? 0) <= now && isAssistantModelId(item.binding.model) && !busy.has(item.binding.personId) &&
        inbox.bindings.some(binding => binding.personId === item.binding.personId && binding.enabled && binding.connectionId === item.binding.connectionId));
      if (!task) return;
      task.status = 'running'; task.attempts++; task.updatedAt = now;
      task.claim = { owner, token: crypto.randomUUID(), until: now + leaseMs };
      return structuredClone(task);
    });
  }

  async renew(workspaceId: string, taskId: string, token: string, leaseMs = 60_000) {
    if (!Number.isFinite(leaseMs) || leaseMs < 1000) throw new Error('任务租约无效');
    await this.update(workspaceId, inbox => {
      const task = this.owned(inbox, taskId, token);
      task.claim!.until = this.now() + leaseMs;
    });
  }

  async recordResult(workspaceId: string, taskId: string, token: string, body: string,
    outcome: 'succeeded' | 'waiting' | 'uncertain' = 'succeeded') {
    if (!body.trim() || body.length > 20_000) throw new Error('机器人回复长度无效');
    return this.update(workspaceId, inbox => {
      const task = this.owned(inbox, taskId, token);
      task.result ??= { messageId: crypto.randomUUID(), body, outcome };
      task.updatedAt = this.now();
      return { ...task.result };
    });
  }

  async settle(workspaceId: string, taskId: string, token: string,
    status: 'succeeded' | 'failed' | 'waiting' | 'uncertain', error?: string) {
    await this.update(workspaceId, inbox => {
      const task = this.owned(inbox, taskId, token);
      if (status === 'succeeded' && !task.result) throw new Error('任务尚未记录回复');
      task.status = status; task.error = error; task.updatedAt = this.now(); delete task.claim;
    });
  }

  async cancel(workspaceId: string, taskId: string) {
    await this.update(workspaceId, inbox => {
      const task = inbox.tasks.find(item => item.id === taskId);
      if (!task || !['queued', 'running', 'waiting'].includes(task.status)) return;
      task.status = 'cancelled'; task.updatedAt = this.now(); delete task.claim;
    });
  }

  async resume(workspaceId: string, taskId: string, reply: NonNullable<AgentTask['continuation']>, questionId: string) {
    await this.update(workspaceId, inbox => {
      const task = inbox.tasks.find(item => item.id === taskId);
      if (!task || task.status !== 'waiting' || task.result?.messageId !== questionId) return;
      task.continuation = { ...reply };
      task.status = 'queued'; task.updatedAt = this.now();
      delete task.result; delete task.error;
    });
  }

  async retry(workspaceId: string, taskId: string, updatedAt: number) {
    await this.update(workspaceId, inbox => {
      const task = inbox.tasks.find(task => task.id === taskId);
      if (!task || task.updatedAt !== updatedAt || !(task.status === 'failed' || task.status === 'uncertain' && task.result))
        throw new Error('任务已变化或执行结果待核对，请先查看执行记录');
      task.status = 'queued'; task.updatedAt = this.now(); delete task.error;
    });
  }

  /** Only the runner may release a claim before entering its persisted execution path. */
  async releaseUnstarted(workspaceId: string, taskId: string, token: string) {
    await this.update(workspaceId, inbox => {
      const task = this.owned(inbox, taskId, token);
      task.status = 'queued'; task.updatedAt = this.now(); delete task.claim;
    });
  }

  private owned(inbox: AgentInbox, taskId: string, token: string): AgentTask {
    const task = inbox.tasks.find(item => item.id === taskId);
    if (!task || task.status !== 'running' || task.claim?.token !== token || task.claim.until <= this.now())
      throw new Error('任务执行权已失效');
    if (!inbox.bindings.some(binding => binding.personId === task.binding.personId && binding.enabled &&
        binding.connectionId === task.binding.connectionId)) throw new Error('机器人连接已停用或更换');
    return task;
  }
}
