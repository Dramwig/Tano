import { onScopeDispose, ref, watch } from 'vue';
import { commentMentionEvents, isAgentPerson, parseCommentFile, isAssistantModelId } from '@tano/protocol';
import type { AgentBinding, AgentInbox, AgentTask, AssistantSession } from '@tano/protocol';
import { useWorkbenchRuntime } from '../runtime';
import { useWorkspaceStore } from '../stores/workspace';
import { nativeAssistantTransport, demoAssistantTransport } from './transport';
import { AgentTaskQueue } from './inbox';
import { ensureAgentIdentities } from './agent-identities';
import { createAgentTaskRunner } from './agent-runner';
import { documentMentionEvents } from './document-mentions';

export const agentInboxKey = Symbol('agent-inbox');

/** Application lifetime owns the runner. Document tabs and assistant panels are independent. */
export function useAgentInboxController() {
  const workspace = useWorkspaceStore();
  const runtime = useWorkbenchRuntime();
  const transport = runtime.assistant ?? (runtime.native && !runtime.mobile && runtime.adapter.mode === 'desktop'
    ? nativeAssistantTransport() : runtime.adapter.mode === 'demo' ? demoAssistantTransport() : undefined);
  const error = ref('');
  const tasks = ref<import('@tano/protocol').AgentTask[]>([]);
  const bindings = ref<AgentBinding[]>([]);
  let hostedState: AgentInbox | undefined;
  const cancelTask = async (id: string) => {
    if (!transport?.inbox || !workspace.workspace) return;
    if (hostedState?.tasks.some(task => task.id === id)) return transport.hostedInbox!.cancel(workspace.workspace.id, id);
    await new AgentTaskQueue(transport.inbox).cancel(workspace.workspace.id, id);
  };
  const configure = async (personId: string, model: string, enabled: boolean) => {
    if (!transport?.inbox || !workspace.workspace) return;
    if (!isAssistantModelId(model)) throw new Error('请选择有效的模型');
    if (hostedState?.bindings.some(binding => binding.personId === personId))
      return transport.hostedInbox!.configure(workspace.workspace.id, personId, model, enabled);
    await new AgentTaskQueue(transport.inbox).update(workspace.workspace.id, inbox => {
      const binding = inbox.bindings.find(item => item.personId === personId);
      if (!binding) throw new Error('机器人连接已移除');
      binding.model = model; binding.enabled = enabled;
      for (const task of inbox.tasks) if (task.binding.personId === personId && task.status === 'queued') task.binding = { ...binding };
    });
  };
  const session = async (taskId: string) => {
    const task = tasks.value.find(task => task.id === taskId);
    if (!transport || !task || workspace.workspace?.id !== task.event.workspaceId) throw new Error('任务不存在');
    if (hostedState?.tasks.some(task => task.id === taskId)) return transport.hostedInbox!.session(task.event.workspaceId, taskId);
    return (await transport.loadSessions(task.event.workspaceId)).find(session => session.id === task.sessionId);
  };
  const retryTask = async (taskId: string) => {
    const task = tasks.value.find(task => task.id === taskId);
    if (!transport?.inbox || !task || workspace.workspace?.id !== task.event.workspaceId) throw new Error('任务不存在');
    if (hostedState?.tasks.some(task => task.id === taskId)) return transport.hostedInbox!.retry(task.event.workspaceId, taskId, task.updatedAt);
    const previous = await session(taskId);
    if (!task.result && previous?.messages.some(message => message.proposals?.some(proposal => ['unknown', 'applying'].includes(proposal.status))))
      throw new Error('请先核对已有操作回执，当前任务不会自动重做');
    await new AgentTaskQueue(transport.inbox).retry(task.event.workspaceId, taskId, task.updatedAt);
  };
  const state = { error, tasks, bindings, cancelTask, configure, session, retryTask,
    settle: async () => {}, resume: () => {} };
  if (!transport?.inbox) return state;
  const inbox = transport.inbox;
  const queue = new AgentTaskQueue(inbox);
  let lifecycle = new AbortController();
  const run = (task: AgentTask, name: string, restored?: AssistantSession) => createAgentTaskRunner(queue, runtime.adapter,
    { workspace, runtime: { ...runtime, assistant: transport } }, lifecycle.signal)(task, name, restored);
  const owner = crypto.randomUUID();
  const running = new Set<string>();
  const active = new Set<Promise<void>>();
  const documentRevisions = new Map<string, { hash: string; since: number }>();
  let scanning = false, disposed = false, suspended = false, identitiesAt = 0, previousWorkspace = '';
  let scanPromise: Promise<void> | undefined;
  state.settle = async () => {
    suspended = true; lifecycle.abort();
    await scanPromise;
    await Promise.allSettled([...active]);
  };
  state.resume = () => {
    if (disposed) return;
    if (lifecycle.signal.aborted) lifecycle = new AbortController();
    suspended = false;
  };
  watch(() => JSON.stringify([workspace.workspace?.id, workspace.workspace?.path]), () => {
    tasks.value = []; bindings.value = []; hostedState = undefined;
    previousWorkspace = ''; identitiesAt = 0; documentRevisions.clear();
    state.resume();
  });
  watch(() => workspace.openingWorkspace, opening => { if (!opening) state.resume(); });
  async function tick() {
    const current = workspace.workspace;
    if (disposed || suspended || scanning || workspace.openingWorkspace || !current || !workspace.capabilities.features.objectReferences) return;
    scanning = true;
    const valid = () => !disposed && !suspended && workspace.workspace?.id === current.id && workspace.workspace.path === current.path;
    try {
      if (previousWorkspace !== current.id) { identitiesAt = 0; hostedState = undefined; documentRevisions.clear(); previousWorkspace = current.id; }
      if (transport!.hostedInbox) {
        try {
          if (!current.readOnly && Date.now() - identitiesAt > 30_000) await transport!.hostedInbox.connect(current.id);
          const snapshot = await transport!.hostedInbox.list(current.id);
          if (!valid()) return;
          hostedState = snapshot;
        } catch (reason) { error.value = String(reason); }
      }
      if (current.readOnly) {
        tasks.value = hostedState?.tasks ?? []; bindings.value = hostedState?.bindings ?? [];
        return;
      }
      if (Date.now() - identitiesAt > 30_000) {
        const identityErrors = await ensureAgentIdentities(current.id, runtime.adapter, transport!, lifecycle.signal);
        if (!valid()) return;
        if (identityErrors.length) error.value = identityErrors.join('\n');
        await workspace.refresh();
        identitiesAt = Date.now();
      }
      const snapshot = await runtime.adapter.refresh();
      if (!valid() || snapshot.id !== current.id) return;
      const sources = new Set<string>();
      for (const file of snapshot.files) {
        if (file.kind === 'file' && !file.path.startsWith('.tano/') && /\.(md|markdown)$/i.test(file.path)) {
          sources.add(`document:${file.id}`);
          const content = await runtime.adapter.read(file.path);
          if (!valid()) return;
          const previous = documentRevisions.get(file.id);
          if (!previous || previous.hash !== content.hash) {
            documentRevisions.set(file.id, { hash: content.hash, since: Date.now() });
            continue;
          }
          if (Date.now() - previous.since < 2000) continue;
          const actorId = runtime.extensions?.().commentAuthor?.().id ?? 'local';
          await queue.reconcile(current.id, { kind: 'document', fileId: file.id },
            documentMentionEvents(current.id, file.id, content.content, content.hash, actorId, file.modified));
          continue;
        }
        const match = /^\.tano\/(annotations|discussions)\/([0-9a-f]{6})\.tano\.json$/.exec(file.path);
        if (!match) continue;
        const kind = match[1] === 'annotations' ? 'annotation' : 'discussion';
        const content = await runtime.adapter.read(file.path);
        if (!valid()) return;
        const comments = parseCommentFile(content.content, kind, match[2]);
        sources.add(`${kind}:${match[2]}`);
        await queue.reconcile(current.id, { kind, fileId: match[2] }, commentMentionEvents(current.id, comments, content.hash));
        const waiting = (await inbox.load(current.id)).tasks.filter(task => task.status === 'waiting' &&
          task.event.source.fileId === match[2] && task.result &&
          (task.event.source.kind === kind || task.event.source.kind === 'document' && kind === 'annotation'));
        for (const task of waiting) {
          const thread = comments.threads.find(thread => thread.messages.some(message => message.id === task.result!.messageId));
          const index = thread?.messages.findIndex(message => message.id === task.result!.messageId) ?? -1;
          const answer = thread?.messages.slice(index + 1).find(message => !message.agentTaskId &&
            message.authorId === task.event.actorId && message.replyTo === task.result!.messageId);
          if (answer) await queue.resume(current.id, task.id, { messageId: answer.id, body: answer.body, threadId: thread!.id }, task.result!.messageId);
        }
      }
      let state = await inbox.load(current.id);
      for (const task of state.tasks) {
        const source = task.event.source;
        if (!sources.has(`${source.kind}:${source.fileId}`))
          await queue.reconcile(current.id, source, []);
      }
      if (!valid()) return;
      // Bound concurrency also protects transports with a shared connection limit.
      while (running.size < 4 && valid()) {
        const task = await queue.claim(current.id, owner);
        if (!task) break;
        const person = workspace.objects.find(item => item.object.id === task.binding.personId)?.object;
        if (!person || person.archived || !isAgentPerson(person)) {
          await queue.cancel(current.id, task.id); continue;
        }
        running.add(task.id);
        const execute = async () => {
          const restored = task.attempts > 1 && !task.result ? (await transport!.loadSessions(current.id)).find(session => session.id === task.sessionId) : undefined;
          if (task.continuation && !restored) throw new Error('任务会话记录缺失，请核对后重新派发');
          await run(task, person.name, restored);
        };
        const work = execute().catch(async reason => {
          if (valid()) error.value = String(reason);
          try { await queue.settle(current.id, task.id, task.claim!.token, 'uncertain', String(reason)); }
          catch { /* A revoked lease belongs to the next reconciliation. */ }
        }).finally(() => { running.delete(task.id); active.delete(work); });
        active.add(work);
      }
      state = await inbox.load(current.id);
      if (valid()) {
        tasks.value = [...state.tasks, ...hostedState?.tasks ?? []];
        bindings.value = [...state.bindings, ...hostedState?.bindings ?? []];
      }
    } catch (reason) { if (valid()) error.value = String(reason); }
    finally { scanning = false; }
  }
  const timer = setInterval(() => {
    if (!scanPromise) scanPromise = tick().finally(() => { scanPromise = undefined; });
  }, 2000);
  onScopeDispose(() => { disposed = true; lifecycle.abort(); clearInterval(timer); });
  return state;
}
