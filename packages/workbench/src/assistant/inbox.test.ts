import { describe, expect, it } from 'vitest';
import { commentMentionEvents, emptyAgentInbox, parseCommentFile } from '@tano/protocol';
import type { AgentInboxStorage, CommentFile, MentionEvent } from '@tano/protocol';
import { AgentTaskQueue } from './inbox';

function fixture() {
  let state = emptyAgentInbox('workspace');
  let now = 1000;
  state.bindings = ['a00001', 'a00002'].map(personId => ({ personId, connectionId: personId, model: 'test', enabled: true }));
  const storage: AgentInboxStorage = {
    load: async () => structuredClone(state),
    compareExchange: async (next, revision) => {
      if (state.revision !== revision) return false;
      state = structuredClone(next); return true;
    },
  };
  return { queue: new AgentTaskQueue(storage, () => now), storage, state: () => state,
    advance: (ms: number) => { now += ms; } };
}

function event(id: string, personId = 'a00001'): MentionEvent {
  return { id, workspaceId: 'workspace', personId, actorId: 'user', source: { kind: 'discussion', fileId: 'f00001', threadId: 'thread-0001', messageId: 'message-0001' },
    body: '@AI 请检查', revision: 'one', createdAt: 1 };
}
const source = { kind: 'discussion', fileId: 'f00001' } as const;

describe('durable agent inbox', () => {
  it('retains mentions received while automatic processing is paused', async () => {
    const f = fixture();
    await f.queue.update('workspace', inbox => { inbox.bindings[0].enabled = false; });
    await f.queue.reconcile('workspace', source, [event('paused')]);
    expect(f.state().tasks).toHaveLength(1);
    expect(await f.queue.claim('workspace', 'runner')).toBeUndefined();
    await f.queue.update('workspace', inbox => { inbox.bindings[0].enabled = true; });
    expect((await f.queue.claim('workspace', 'runner'))?.event.id).toBe('paused');
  });
  it('waits for committed document input to settle and resets the delay on further edits', async () => {
    const f = fixture();
    const mention = { ...event('one'), source: { kind: 'document' as const, fileId: 'f00001' } };
    await f.queue.reconcile('workspace', mention.source, [mention]);
    expect(await f.queue.claim('workspace', 'runner')).toBeUndefined();
    f.advance(1500);
    await f.queue.reconcile('workspace', mention.source, [{ ...mention, revision: 'two', body: '@AI 完整请求' }]);
    f.advance(1500);
    expect(await f.queue.claim('workspace', 'runner')).toBeUndefined();
    f.advance(501);
    expect((await f.queue.claim('workspace', 'runner'))?.event.body).toBe('@AI 完整请求');
  });
  it('deduplicates replay and updates a queued snapshot without adding another task', async () => {
    const f = fixture();
    await f.queue.reconcile('workspace', source, [event('one'), event('two')]);
    await f.queue.reconcile('workspace', source, [event('one'), { ...event('two'), revision: 'two', body: 'Updated' }]);
    expect(f.state().tasks).toHaveLength(2);
    expect(f.state().tasks[1].event.body).toBe('Updated');
    const task = (await f.queue.claim('workspace', 'runner'))!;
    await f.queue.reconcile('workspace', source, [{ ...event('one'), revision: 'three', body: 'Later' }, event('two')]);
    expect(f.state().tasks.find(item => item.id === task.id)?.event.body).toBe('@AI 请检查');
  });

  it('serializes one agent across runners while allowing another agent to run', async () => {
    const f = fixture();
    await f.queue.reconcile('workspace', source, [event('one'), event('two'), event('three', 'a00002')]);
    const other = new AgentTaskQueue(f.storage, () => 1000);
    const claims = await Promise.all([f.queue.claim('workspace', 'first'), other.claim('workspace', 'second')]);
    expect(claims.map(task => task?.event.id).sort()).toEqual(['one', 'three']);
    expect(await other.claim('workspace', 'third')).toBeUndefined();
    const task = claims[0]!;
    await f.queue.recordResult('workspace', task.id, task.claim!.token, '完成');
    await f.queue.settle('workspace', task.id, task.claim!.token, 'succeeded');
    expect((await other.claim('workspace', 'next'))?.event.id).toBe('two');
  });

  it('recovers expired leases as uncertain and fences stale writers', async () => {
    const f = fixture();
    await f.queue.reconcile('workspace', source, [event('one')]);
    const task = (await f.queue.claim('workspace', 'runner', 1000))!;
    f.advance(1001);
    expect(await f.queue.claim('workspace', 'new')).toBeUndefined();
    expect(f.state().tasks[0].status).toBe('uncertain');
    await expect(f.queue.recordResult('workspace', task.id, task.claim!.token, '完成')).rejects.toThrow('执行权');
  });

  it('keeps a reply receipt stable across publication retries', async () => {
    const f = fixture();
    await f.queue.reconcile('workspace', source, [event('one')]);
    const task = (await f.queue.claim('workspace', 'runner'))!;
    const first = await f.queue.recordResult('workspace', task.id, task.claim!.token, '完成');
    expect(await f.queue.recordResult('workspace', task.id, task.claim!.token, '重复')).toEqual(first);
    await f.queue.settle('workspace', task.id, task.claim!.token, 'succeeded');
    await f.queue.reconcile('workspace', source, [event('one')]);
    expect(await f.queue.claim('workspace', 'runner')).toBeUndefined();
  });

  it('cancels removed mentions only within the reconciled source', async () => {
    const f = fixture();
    await f.queue.reconcile('workspace', source, [event('one')]);
    const second = { ...event('two'), source: { ...source, fileId: 'f00002' } };
    await f.queue.reconcile('workspace', second.source, [second]);
    await f.queue.reconcile('workspace', source, []);
    expect(f.state().tasks.map(task => task.status)).toEqual(['cancelled', 'queued']);
    await expect(f.queue.reconcile('workspace', source, [second])).rejects.toThrow('来源');
  });

  it('releases the serial slot while waiting and rejects revoked bindings', async () => {
    const f = fixture();
    await f.queue.reconcile('workspace', source, [event('one'), event('two')]);
    const first = (await f.queue.claim('workspace', 'runner'))!;
    await f.queue.settle('workspace', first.id, first.claim!.token, 'waiting');
    const second = (await f.queue.claim('workspace', 'runner'))!;
    await f.queue.update('workspace', inbox => { inbox.bindings[0].enabled = false; });
    await expect(f.queue.renew('workspace', second.id, second.claim!.token)).rejects.toThrow('停用');
  });
});

it('reads legacy mentions, preserves occurrence IDs and excludes generated replies', () => {
  const file: CommentFile = { version: 1, kind: 'discussion', fileId: 'f00001', threads: [{
    id: 'thread-0001', resolved: false, detached: false, createdAt: 1, messages: [
      { id: 'message-0001', authorId: 'human', authorName: '用户', body: '@AI @AI', createdAt: 1,
        mentions: [{ personId: 'a00001', text: '@AI' }, { id: 'mention-0002', personId: 'a00001', text: '@AI' }] },
      { id: 'message-0002', authorId: 'a00001', authorName: 'AI', body: '@AI 完成', createdAt: 1,
        agentTaskId: 'task-00001', mentions: [{ personId: 'a00001', text: '@AI' }] },
    ],
  }] };
  const parsed = parseCommentFile(JSON.stringify(file), 'discussion', 'f00001');
  const events = commentMentionEvents('workspace', parsed, 'hash');
  expect(events).toHaveLength(2);
  expect(new Set(events.map(item => item.id)).size).toBe(2);
  expect(events[0].source.messageId).toBe('message-0001');
  file.threads[0].messages[0].mentions![1].id = '../invalid';
  expect(() => parseCommentFile(JSON.stringify(file), 'discussion', 'f00001')).toThrow();
});
