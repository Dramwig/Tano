import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue';
import { defineStore } from 'pinia';
import { isAssistantModelId, parseAssistantSession } from '@tano/protocol';
import type { AssistantConnection, AssistantMessage, AssistantProposal, AssistantSession, AssistantSource } from '@tano/protocol';
import { useWorkspaceStore } from '../stores/workspace';
import { useWorkbenchRuntime } from '../runtime';
import { demoAssistantTransport, nativeAssistantTransport } from './transport';
import { runAssistant } from './engine';

export const useAssistantStore = defineStore('assistant', () => {
  const workspace = useWorkspaceStore();
  const runtime = useWorkbenchRuntime();
  const transport = runtime.assistant ?? (runtime.native && !runtime.mobile && runtime.adapter.mode === 'desktop'
    ? nativeAssistantTransport() : runtime.adapter.mode === 'demo' ? demoAssistantTransport() : undefined);
  const available = !!transport;
  const demo = !!transport?.demo;
  const opened = ref(false), loading = ref(false), busy = ref(false), applying = ref(false);
  const connections = ref<AssistantConnection[]>([]);
  const connectionId = ref('');
  const modelId = ref('');
  const models = ref<string[]>([]);
  const modelsLoading = ref(false), modelsError = ref('');
  const sessions = ref<AssistantSession[]>([]);
  const externalSessions = ref<AssistantSession[]>([]);
  const session = ref<AssistantSession | null>(null);
  const files = ref<string[]>([]);
  const selection = ref<{ fileId: string; text: string; from?: number; to?: number } | null>(null);
  const prompt = ref(''), error = ref(''), progress = ref('');
  const allowSearch = ref(false);
  const allowStructures = ref(false);
  const replyTarget = shallowRef<{ label: string; draft: (body: string) => Promise<void> } | null>(null);
  const connection = computed(() => connections.value.find(item => item.id === connectionId.value));
  let controller: AbortController | undefined;
  let modelController: AbortController | undefined;
  let generation = 0;
  let persistTask = Promise.resolve();
  let managed: (fileId: string) => boolean = () => false;
  const scope = () => {
    if (!workspace.workspace) throw new Error('请先打开工作区');
    return { id: workspace.workspace.id, path: workspace.workspace.path, epoch: workspace.assistantEpoch };
  };
  function stop() { controller?.abort(); }
  async function settle() {
    stop(); modelController?.abort();
    if (busy.value || applying.value) {
      await new Promise<void>(resolve => {
        const unwatch = watch([busy, applying], ([running, writing]) => {
          if (!running && !writing) { unwatch(); resolve(); }
        });
      });
    }
    await persistTask.catch(() => {});
  }
  function newSession() {
    if (busy.value || applying.value) return;
    const now = Date.now();
    session.value = { version: 1, id: crypto.randomUUID(), workspaceId: scope().id,
      title: '新会话', createdAt: now, updatedAt: now, revision: 0, messages: [],
      ...(connectionId.value ? { connectionId: connectionId.value } : {}),
      ...(modelId.value ? { model: modelId.value } : {}) };
    prompt.value = ''; error.value = '';
    replyTarget.value = null;
  }
  async function persist(target = session.value) {
    if (!target || !transport) return;
    const epoch = generation;
    const saved = persistTask.catch(() => {}).then(async () => {
      if (epoch !== generation || workspace.workspace?.id !== target.workspaceId) throw new Error('工作区会话已变化，旧记录未写入当前工作区');
      const snapshot = parseAssistantSession(JSON.parse(JSON.stringify(target)));
      const revision = await transport.saveSession(snapshot);
      target.revision = revision;
      if (epoch !== generation) return;
      const index = sessions.value.findIndex(item => item.id === target.id);
      if (index >= 0) sessions.value[index] = target;
      else sessions.value.unshift(target);
    });
    persistTask = saved;
    await saved;
  }
  async function reloadConnections() {
    if (!transport) return;
    const epoch = generation;
    const loaded = await transport.connections();
    if (epoch !== generation) return;
    connections.value = loaded;
    if (!connectionId.value && !session.value?.connectionId)
      connectionId.value = connections.value.length === 1 ? connections.value[0].id : '';
  }
  async function reloadModels() {
    modelController?.abort();
    models.value = []; modelsError.value = ''; modelsLoading.value = false;
    const selected = connection.value;
    if (!transport || !selected || !opened.value) return;
    const abort = new AbortController(); modelController = abort;
    modelsLoading.value = true;
    try {
      const values = await transport.models(selected.id, abort.signal);
      if (abort.signal.aborted || modelController !== abort || connectionId.value !== selected.id || !opened.value) return;
      if (!Array.isArray(values) || values.length > 1000 || values.some(value => !isAssistantModelId(value)))
        throw new Error('模型列表格式无效');
      models.value = [...new Set(values)];
      if (!models.value.length) modelsError.value = '服务未返回可用模型';
    } catch (reason) {
      if (!abort.signal.aborted && modelController === abort) modelsError.value = String(reason);
    } finally { if (modelController === abort) { modelsLoading.value = false; modelController = undefined; } }
  }
  async function selectConnection(id: string, reset = false) {
    if (busy.value || applying.value || loading.value) return;
    if (!connections.value.some(item => item.id === id)) throw new Error('模型连接已移除');
    if (id === connectionId.value && !reset) return;
    connectionId.value = id; modelId.value = '';
    // Connection settings are personal and can be edited from the standalone
    // settings window, where no workspace conversation is loaded.
    if (!session.value && workspace.workspace) newSession();
    if (session.value) {
      session.value.connectionId = id; delete session.value.model;
      await persist();
    }
  }
  async function selectModel(id: string) {
    if (busy.value || applying.value || loading.value) return;
    const selected = id.trim();
    if (!connection.value) throw new Error('请先选择模型连接');
    if (!isAssistantModelId(selected)) throw new Error('模型 ID 无效');
    if (!session.value) newSession();
    modelId.value = selected; session.value!.model = selected; session.value!.connectionId = connectionId.value;
    await persist();
  }
  function restoreModelSelection(target: AssistantSession | null) {
    connectionId.value = target?.connectionId ?? (connections.value.length === 1 ? connections.value[0].id : '');
    const previous = target ? [...target.messages].reverse().find(message => message.role === 'assistant' && message.model)?.model : undefined;
    modelId.value = target?.model ?? (isAssistantModelId(previous) ? previous : '');
  }
  async function saveConnection(config: Omit<AssistantConnection, 'hasKey'>, key?: string) {
    if (!transport || busy.value || applying.value || loading.value) throw new Error('请先等待当前任务完成');
    const previous = connections.value.find(item => item.id === config.id);
    await transport.saveConnection(config, key);
    await reloadConnections(); await selectConnection(config.id, previous?.endpoint !== config.endpoint ||
      (previous?.kind ?? 'api') !== (config.kind ?? 'api') || previous?.cliPath !== config.cliPath);
  }
  async function removeConnection(id: string) {
    if (!transport || busy.value || applying.value || loading.value) throw new Error('请先等待当前任务完成');
    await transport.removeConnection(id);
    await reloadConnections();
  }
  function open(fileId?: string, selected?: { text: string; from?: number; to?: number }) {
    if (!available) return;
    opened.value = true;
    if (fileId && !busy.value) {
      if (!files.value.includes(fileId)) files.value.push(fileId);
      selection.value = selected ? { fileId, ...selected } : null;
    }
  }
  async function send() {
    if (!transport || busy.value || applying.value || loading.value || !prompt.value.trim()) return;
    if (!connection.value) { error.value = '请先配置模型连接'; return; }
    if (!isAssistantModelId(modelId.value)) { error.value = '请为当前对话选择模型'; return; }
    if (!session.value) newSession();
    const target = session.value!;
    if (target.messages.length >= 290) { error.value = '会话已达到消息上限，请新建会话'; return; }
    const expected = scope();
    const epoch = generation;
    const config = { ...connection.value };
    const model = modelId.value;
    target.connectionId = config.id; target.model = model;
    const question = prompt.value.trim();
    if (question.length > 20_000) { error.value = '问题超过 20,000 字，请缩短后发送'; return; }
    busy.value = true; error.value = ''; progress.value = '正在读取参考文档';
    const startedAt = performance.now();
    let firstContentMs: number | undefined;
    const abort = new AbortController(); controller = abort;
    let reply: AssistantMessage | undefined;
    try {
      const sources: AssistantSource[] = [];
      const rules = await workspace.assistantRules(expected);
      for (const id of [...new Set(files.value)]) {
        abort.signal.throwIfAborted();
        const source = await workspace.assistantSnapshot(expected, id);
        source.id = `S${sources.length + 1}`;
        if (selection.value?.fileId === id) {
          const selected = { text: selection.value.text, from: selection.value.from, to: selection.value.to };
          if (selected.from !== undefined && source.content.slice(selected.from, selected.to) !== selected.text)
            throw new Error('选区内容已变化，请重新选择后发送');
          if (selected.from === undefined) {
            const from = source.content.indexOf(selected.text);
            if (from >= 0 && source.content.indexOf(selected.text, from + 1) < 0) {
              selected.from = from; selected.to = from + selected.text.length;
            }
          }
          source.selection = selected;
        }
        sources.push(source);
      }
      abort.signal.throwIfAborted();
      if (epoch !== generation) return;
      const history = target.messages.slice(-16).filter(message => message.state !== 'failed' && message.state !== 'cancelled')
        .map(message => ({ role: message.role, content: message.content }));
      const now = Date.now();
      target.messages.push({ id: crypto.randomUUID(), role: 'user', content: question, createdAt: now });
      reply = { id: crypto.randomUUID(), role: 'assistant', content: '', createdAt: now, sources,
        proposals: [], rules: rules.map(rule => rule.path), state: 'running', model };
      target.messages.push(reply);
      // Use the reactive instance for streaming; the plain object pushed above is not reactive.
      reply = target.messages[target.messages.length - 1];
      target.title = target.messages.find(message => message.role === 'user')!.content.slice(0, 50);
      target.updatedAt = now; prompt.value = '';
      await persist(target);
      let structureSnapshot: Awaited<ReturnType<typeof workspace.assistantStructures>> | undefined;
      reply.usage = await runAssistant({ transport, connectionId: config.id, model, tools: config.tools,
        workspaceId: expected.id, runId: reply.id, sources: reply.sources!, history, rules, prompt: question, signal: abort.signal,
        ...(allowSearch.value && allowStructures.value ? { references: (identity: import('@tano/protocol').ReferenceIdentity) => workspace.assistantReferenceContext(expected, identity) } : {}),
        ...(allowSearch.value && allowStructures.value ? { tasks: async (query: import('./tasks').TaskQuery) => {
          structureSnapshot ??= await workspace.assistantStructures(expected);
          return workspace.assistantTaskQuery(expected, query, structureSnapshot);
        } } : {}),
        ...(allowStructures.value ? { structures: {
          read: async () => {
            structureSnapshot ??= await workspace.assistantStructures(expected);
            return { targets: structureSnapshot.targets, relations: structureSnapshot.relations, relationTypes: structureSnapshot.relationTypes };
          },
          propose: (call: import('@tano/protocol').AssistantToolCall) => workspace.proposeAssistantStructure(expected, reply!.id, call, structureSnapshot),
        } } : {}),
        ...(allowSearch.value ? { lookup: {
          search: async (query: string) => {
            if (workspace.workspace?.id !== expected.id || workspace.workspace.path !== expected.path || workspace.assistantEpoch !== expected.epoch) throw new Error('工作区已切换');
            const hits = await workspace.search(query);
            return hits.filter(hit => workspace.workspace?.files.some(file => file.id === hit.id && /\.(md|markdown)$/i.test(file.path) && !file.path.startsWith('.tano/')))
              .slice(0, 20).map(hit => ({ fileId: hit.id, path: hit.path, excerpt: hit.excerpt }));
          },
          read: (fileId: string) => workspace.assistantSnapshot(expected, fileId),
        } } : {}),
        delta: text => {
          if (epoch !== generation) return;
          if (text.trim() && firstContentMs === undefined) firstContentMs = Math.round(performance.now() - startedAt);
          reply!.content += text;
        },
        proposal: proposal => { if (epoch === generation) reply!.proposals!.push(proposal); },
        progress: text => { if (epoch === generation) progress.value = text; },
      });
      reply.state = 'completed';
      if (!reply.content.trim() && !reply.proposals?.length) reply.content = '模型没有返回正文。';
    } catch (reason) {
      const cancelled = abort.signal.aborted;
      if (reply) {
        reply.state = cancelled ? 'cancelled' : 'failed';
        reply.error = cancelled ? '已停止生成，已有建议仍可审阅' : String(reason);
      } else if (epoch === generation) error.value = String(reason);
    } finally {
      if (reply && epoch === generation) {
        reply.timing = { totalMs: Math.round(performance.now() - startedAt),
          ...(firstContentMs === undefined ? {} : { firstContentMs }) };
        target.updatedAt = Date.now();
        try { await persist(target); } catch (reason) { error.value = `会话保存失败：${String(reason)}`; }
      }
      if (epoch === generation) { busy.value = false; progress.value = ''; controller = undefined; }
    }
  }
  async function review(proposal: AssistantProposal, apply = false) {
    if (busy.value || applying.value || !transport) return;
    const expected = scope();
    if (proposal.status === 'applied' || proposal.status === 'rejected') return;
    if (proposal.status === 'unknown' || proposal.status === 'applying') { error.value = '请先核对待确认的写入结果'; return; }
    if (proposal.fileId && managed(proposal.fileId)) { error.value = '此文档正由协作会话管理，暂时只能进行问答'; return; }
    applying.value = true; error.value = '';
    const target = session.value;
    const originalStatus = proposal.status;
    let submitting = false;
    try {
      const acceptance = apply ? proposal.preview : undefined;
      if (apply && !acceptance) throw new Error('请先查看最新差异');
      if (apply) {
        proposal.status = 'applying';
        await persist(target);
        submitting = true;
      }
      const result = await workspace.reviewAssistantProposal(expected, proposal, acceptance);
      if (result.status === 'saved') {
        proposal.status = 'applied'; proposal.applied = result.applied; proposal.error = undefined;
      } else {
        proposal.preview = result.preview;
        proposal.status = result.status === 'conflict' ? 'conflicted' : 'ready';
        proposal.error = result.status === 'stale' ? (result.preview ? '文档已变化，请审阅更新后的差异再应用' : '文档在保存时变化，请重新查看差异')
          : result.status === 'conflict' ? '修改存在重叠，原文与建议均已保留' : undefined;
      }
      await persist(target);
      if (target?.external && proposal.id === target.id) await transport.recordExternalResult?.(target);
    } catch (reason) {
      if (proposal.applied) {
        proposal.status = 'applied';
        proposal.error = `内容已保存，会话记录保存失败：${String(reason)}`;
      } else {
        proposal.status = submitting ? 'unknown' : originalStatus;
        proposal.error = String(reason);
      }
      error.value = proposal.error;
      try { await persist(target); } catch { /* Keep the in-memory result visible. */ }
    } finally { applying.value = false; }
  }
  async function verify(proposal: AssistantProposal) {
    if (applying.value || busy.value || !proposal.preview) return;
    applying.value = true; error.value = '';
    const target = session.value;
    try {
      const expected = scope();
      if (expected.id !== proposal.workspaceId) throw new Error('工作区已切换');
      const current = await runtime.adapter.refresh();
      const file = current.files.find(file => proposal.kind === 'edit' ? file.id === proposal.fileId : file.path === proposal.path);
      if (!file || current.id !== expected.id || current.path !== expected.path) throw new Error('原目标不存在，请保留建议并核对工作区');
      const disk = await runtime.adapter.read(file.path);
      if (disk.content === proposal.preview.after) {
        proposal.applied = { before: proposal.preview.before, after: disk.content, hash: disk.hash, fileId: file.id };
        proposal.status = 'applied'; proposal.error = undefined;
      } else if (proposal.kind === 'edit' && disk.hash === proposal.preview.diskHash) {
        proposal.status = 'ready'; proposal.preview = undefined; proposal.error = '未发现此次写入，请重新审阅';
      } else throw new Error('磁盘内容与写入前后均不同，请打开文档人工核对；不自动重试');
      await persist(target);
      if (target?.external && proposal.id === target.id) await transport?.recordExternalResult?.(target);
    } catch (reason) { error.value = String(reason); }
    finally { applying.value = false; }
  }
  async function reject(proposal: AssistantProposal) {
    if (applying.value || busy.value || !['ready', 'conflicted'].includes(proposal.status)) return;
    proposal.status = 'rejected';
    const target = session.value;
    try { await persist(target); if (target?.external && proposal.id === target.id) await transport?.recordExternalResult?.(target); }
    catch (reason) { error.value = String(reason); }
  }
  async function undo(proposal: AssistantProposal) {
    if (!proposal.applied || applying.value || busy.value || ['object', 'relation'].includes(proposal.kind)) return;
    const reply = session.value?.messages.find(message => message.id === proposal.runId);
    if (!reply) return;
    const reversed: AssistantProposal = { id: crypto.randomUUID(), runId: reply.id, workspaceId: proposal.workspaceId,
      kind: 'edit', fileId: proposal.applied.fileId, path: proposal.path, base: proposal.applied.after,
      content: proposal.applied.before, reason: `撤回内容：${proposal.reason}`, status: 'ready' };
    reply.proposals!.push(reversed); await review(reversed);
  }
  async function deleteSession(id: string) {
    if (!transport || busy.value || applying.value) return;
    await persistTask.catch(() => {});
    const target = sessions.value.find(item => item.id === id);
    if (!target) return;
    await transport.deleteSession(scope().id, id, target.revision);
    sessions.value = sessions.value.filter(item => item.id !== id);
    if (session.value?.id === id) newSession();
  }
  function selectSession(id: string) {
    if (busy.value || applying.value) return;
    session.value = sessions.value.find(item => item.id === id) ?? null;
    restoreModelSelection(session.value);
    files.value = []; selection.value = null; prompt.value = ''; error.value = '';
    replyTarget.value = null;
    allowStructures.value = false;
  }
  async function loadExternal() {
    if (!transport?.loadExternalSessions || busy.value || applying.value || loading.value) return;
    const epoch = generation;
    try {
      const loaded = await transport.loadExternalSessions(scope().id);
      if (epoch === generation) externalSessions.value = loaded.filter(item => !sessions.value.some(local => local.id === item.id));
    } catch (reason) { if (epoch === generation) error.value = String(reason); }
  }
  async function importExternal(target: AssistantSession) {
    if (busy.value || applying.value || loading.value || target.workspaceId !== scope().id) return;
    const parsed = parseAssistantSession(JSON.parse(JSON.stringify(target)));
    if (!parsed.external || parsed.messages.length !== 1 || parsed.messages[0].proposals?.length !== 1 || parsed.messages[0].proposals[0].id !== parsed.id)
      throw new Error('外部提案封装无效');
    await persist(parsed);
    session.value = parsed; opened.value = true; files.value = []; selection.value = null; replyTarget.value = null;
    restoreModelSelection(parsed);
    externalSessions.value = externalSessions.value.filter(item => item.id !== target.id);
  }
  watch(() => workspace.workspace ? `${workspace.workspace.id}:${workspace.workspace.path}:${workspace.assistantEpoch}` : '', async key => {
    stop(); modelController?.abort(); const epoch = ++generation;
    busy.value = false; prompt.value = ''; files.value = []; selection.value = null; session.value = null; sessions.value = []; allowSearch.value = false;
    replyTarget.value = null;
    connectionId.value = ''; modelId.value = ''; models.value = []; modelsError.value = ''; modelsLoading.value = false;
    if (!key || !transport) return;
    externalSessions.value = [];
    allowStructures.value = false;
    const expected = scope(); loading.value = true; error.value = '';
    try {
      await reloadConnections();
      const loaded = await transport.loadSessions(expected.id);
      if (epoch !== generation) return;
      for (const target of loaded) for (const message of target.messages) {
        if (message.state === 'running') message.state = 'interrupted';
        for (const proposal of message.proposals ?? []) if (proposal.status === 'applying') proposal.status = 'unknown';
      }
      sessions.value = loaded.sort((a, b) => b.updatedAt - a.updatedAt);
      session.value = sessions.value[0] ?? null;
      restoreModelSelection(session.value);
      if (!session.value) newSession();
    } catch (reason) { if (epoch === generation) error.value = String(reason); }
    finally { if (epoch === generation) loading.value = false; }
  }, { immediate: true });
  watch([connection, opened], () => { void reloadModels(); });
  onScopeDispose(() => { stop(); modelController?.abort(); });
  return { available, demo, opened, loading, busy, applying, connections, connectionId, connection, modelId, models, modelsLoading, modelsError, reloadModels, selectModel, selectConnection, sessions, session, externalSessions, loadExternal, importExternal,
    files, selection, prompt, error, progress, allowSearch, allowStructures, replyTarget, open, stop, settle, send, newSession, selectSession, deleteSession, review, verify,
    undo, reject, saveConnection, removeConnection, reloadConnections, setManaged: (check: (id: string) => boolean) => { managed = check; } };
});
