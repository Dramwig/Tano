import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue';
import { defineStore } from 'pinia';
import { isAssistantModelId, isAssistantReasoningSelection, parseAssistantSession, parseAssistantAnswers, isDataTableFilePath } from '@tano/protocol';
import type { AssistantQuestion, AssistantQuestionAnswer, AssistantUserInput } from '@tano/protocol';
import type { AssistantActivity, AssistantConnection, AssistantMessage, AssistantProposal, AssistantReasoningSelection, AssistantSession, AssistantSource } from '@tano/protocol';
import type { AssistantExecutionResult } from './execution';
import { useWorkspaceStore } from '../stores/workspace';
import { useWorkbenchRuntime } from '../runtime';
import { demoAssistantTransport, nativeAssistantTransport } from './transport';
import { runAssistant } from './engine';
import { AssistantRunError } from './completion';
import type { AssistantTextPhase } from './completion';
import { assistantHistory } from './results';
import { useSuggestionStore } from '../stores/suggestions';
import { uiLocale } from '../i18n';
import { assistantCopy, assistantTaskPrompts, formatAssistantText } from './language';

export type AssistantDisplayMode = 'sidebar' | 'floating' | 'fullscreen';

export const useAssistantStore = defineStore('assistant', () => createAssistantState());
export const useInlineAssistantStore = defineStore('inline-assistant', () => createAssistantState(true));

/** Separate task controllers and sessions, with the same guarded execution path. */
function createAssistantState(inline = false) {
  const workspace = useWorkspaceStore();
  const runtime = useWorkbenchRuntime();
  const transport = runtime.assistant ?? (runtime.native && !runtime.mobile && runtime.adapter.mode === 'desktop'
    ? nativeAssistantTransport() : runtime.adapter.mode === 'demo' ? demoAssistantTransport() : undefined);
  const available = !!transport;
  const demo = !!transport?.demo;
  const canConfigure = transport?.canConfigure !== false;
  const opened = ref(false), loading = ref(false), busy = ref(false), applying = ref(false);
  const displayMode = ref<AssistantDisplayMode>('sidebar');
  const fullscreenTabId = ref('');
  const fullscreenPaneId = computed(() => workspace.panes.find(pane => pane.tabs.includes(fullscreenTabId.value))?.id);
  function isFullscreenTab(id: string) {
    return opened.value && displayMode.value === 'fullscreen' && fullscreenTabId.value === id;
  }
  function setDisplayMode(mode: AssistantDisplayMode) {
    if (mode === 'fullscreen' && !workspace.activeId) workspace.createBlankTab();
    fullscreenTabId.value = mode === 'fullscreen' ? workspace.activeId : '';
    displayMode.value = mode;
  }
  const connections = ref<AssistantConnection[]>([]);
  const connectionId = ref('');
  const modelId = ref('');
  const reasoningEffort = ref<AssistantReasoningSelection>('medium');
  const models = ref<string[]>([]);
  const modelsLoading = ref(false), modelsError = ref('');
  const sessions = ref<AssistantSession[]>([]);
  const externalSessions = ref<AssistantSession[]>([]);
  const session = ref<AssistantSession | null>(null);
  const files = ref<string[]>([]);
  const selection = ref<{ fileId: string; text: string; from?: number; to?: number } | null>(null);
  const prompt = ref(''), error = ref(''), progress = ref('');
  let builtInPrompt: string | undefined;
  watch(prompt, value => { if (value !== builtInPrompt) builtInPrompt = undefined; }, { flush: 'sync' });
  function setBuiltInPrompt(value: string) {
    builtInPrompt = value;
    prompt.value = value;
  }
  const pendingUserInput = ref<{ request: AssistantUserInput; step: number; values: string[]; submitting: boolean } | null>(null);
  let answerUserInput: ((id: string, answers: AssistantQuestionAnswer[]) => Promise<void>) | undefined;
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
      ...(modelId.value ? { model: modelId.value } : {}),
      ...(connection.value?.kind === 'codex-cli' ? { reasoningEffort: reasoningEffort.value } : {}) };
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
  async function refreshModels() {
    if (busy.value || applying.value || loading.value) return;
    modelsLoading.value = true; modelsError.value = '';
    try { await reloadConnections(); await reloadModels(); }
    catch (reason) { modelsError.value = reason instanceof Error ? reason.message : String(reason); }
    finally { modelsLoading.value = false; }
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
  async function checkConnection(id: string, signal: AbortSignal) {
    signal.throwIfAborted();
    if (!transport) throw new Error('当前运行环境未提供助手连接配置');
    if (!connections.value.some(item => item.id === id)) throw new Error('模型连接已移除');
    const values = await transport.models(id, signal);
    signal.throwIfAborted();
    if (!Array.isArray(values) || values.length > 1000 || values.some(value => !isAssistantModelId(value)))
      throw new Error('模型列表格式无效');
    return new Set(values).size;
  }
  async function selectConnection(id: string, reset = false) {
    if (busy.value || applying.value || loading.value) return;
    if (!connections.value.some(item => item.id === id)) throw new Error('模型连接已移除');
    if (id === connectionId.value && !reset) return;
    connectionId.value = id; modelId.value = '';
    reasoningEffort.value = connection.value?.reasoningEffort ?? 'medium';
    // Connection settings are personal and can be edited from the standalone
    // settings window, where no workspace conversation is loaded.
    if (!session.value && workspace.workspace) newSession();
    if (session.value) {
      session.value.connectionId = id; delete session.value.model;
      if (connection.value?.kind === 'codex-cli') session.value.reasoningEffort = reasoningEffort.value;
      else delete session.value.reasoningEffort;
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
    reasoningEffort.value = target?.reasoningEffort ?? connection.value?.reasoningEffort ?? (target ? 'cli-default' : 'medium');
  }
  async function selectReasoningEffort(value: AssistantReasoningSelection) {
    if (busy.value || applying.value || loading.value) return;
    if (connection.value?.kind !== 'codex-cli') throw new Error('当前连接不支持选择推理强度');
    if (!isAssistantReasoningSelection(value)) throw new Error('推理强度无效');
    if (!session.value) newSession();
    reasoningEffort.value = value;
    session.value!.reasoningEffort = value;
    session.value!.connectionId = connectionId.value;
    await persist();
  }
  async function saveConnection(config: Omit<AssistantConnection, 'hasKey'>, key?: string) {
    if (!transport || busy.value || applying.value || loading.value) throw new Error('请先等待当前任务完成');
    const previous = connections.value.find(item => item.id === config.id);
    if (!canConfigure || config.managed || previous?.managed) throw new Error('此模型连接由平台管理员配置');
    await transport.saveConnection(config, key);
    await reloadConnections(); await selectConnection(config.id, previous?.endpoint !== config.endpoint ||
      (previous?.kind ?? 'api') !== (config.kind ?? 'api') || previous?.cliPath !== config.cliPath);
  }
  async function removeConnection(id: string) {
    if (!transport || busy.value || applying.value || loading.value) throw new Error('请先等待当前任务完成');
    if (!canConfigure || connections.value.find(item => item.id === id)?.managed) throw new Error('此模型连接由平台管理员配置');
    await transport.removeConnection(id);
    await reloadConnections();
  }
  function open(fileId?: string, selected?: { text: string; from?: number; to?: number }) {
    if (!available) return;
    if (displayMode.value === 'fullscreen') setDisplayMode('fullscreen');
    opened.value = true;
    if (fileId && !busy.value) {
      if (!files.value.includes(fileId)) files.value.push(fileId);
      selection.value = selected ? { fileId, ...selected } : null;
    }
  }
  async function startDocumentDraft(fileId: string) {
    if (!available || busy.value || applying.value || loading.value) return;
    const doc = workspace.documents.find(item => item.id === fileId);
    if (!doc || workspace.workspace?.files.find(file => file.id === fileId)?.readOnly || workspace.workspace?.readOnly || doc.missing || doc.conflict || doc.error) return;
    newSession();
    files.value = [fileId]; selection.value = null;
    setDisplayMode('floating');
    open(fileId);
    setBuiltInPrompt(assistantTaskPrompts.startDraft);
    await send();
  }
  async function askUser(questions: AssistantQuestion[], target: AssistantSession, reply: AssistantMessage, signal: AbortSignal) {
    signal.throwIfAborted();
    if ((reply.userInputs?.length ?? 0) >= 8) throw new Error('本轮提问次数已达上限，请在下一条消息继续');
    reply.userInputs ??= [];
    reply.userInputs.push({ id: crypto.randomUUID(), questions, status: 'pending', contentOffset: reply.content.length });
    const request = reply.userInputs.at(-1)!;
    reply.state = 'waiting';
    reply.activity?.push({ kind: 'input', inputId: request.id });
    try { await persist(target); signal.throwIfAborted(); }
    catch (reason) { request.status = 'cancelled'; throw reason; }
    return new Promise<AssistantQuestionAnswer[]>((resolve, reject) => {
      const clear = () => {
        signal.removeEventListener('abort', cancel);
        if (pendingUserInput.value?.request.id === request.id) { pendingUserInput.value = null; answerUserInput = undefined; }
      };
      const cancel = () => {
        request.status = 'cancelled'; delete request.answers;
        clear(); reject(signal.reason ?? new DOMException('已停止', 'AbortError'));
      };
      pendingUserInput.value = { request, step: 0, values: questions.map(() => ''), submitting: false };
      signal.addEventListener('abort', cancel, { once: true });
      answerUserInput = async (id, answers) => {
        const pending = pendingUserInput.value;
        if (id !== request.id || pending?.request.id !== id || pending.submitting || signal.aborted || session.value?.id !== target.id) return;
        pending.submitting = true;
        request.answers = answers; request.status = 'answered';
        try {
          await persist(target); signal.throwIfAborted();
          reply.state = 'running';
          error.value = ''; clear(); resolve(answers);
        } catch (reason) {
          if (signal.aborted) return;
          request.status = 'pending'; delete request.answers;
          pending.submitting = false;
          error.value = `回答保存失败，请重试：${String(reason)}`;
        }
      };
      if (signal.aborted) cancel();
    });
  }
  async function submitUserInput(id: string) {
    const pending = pendingUserInput.value;
    if (!pending || pending.request.id !== id || pending.submitting || !answerUserInput) return;
    try {
      const answers = parseAssistantAnswers(pending.request.questions.map((question, index) => ({
        questionId: question.id, answer: pending.values[index]?.trim() || null,
      })), pending.request.questions);
      await answerUserInput(id, answers);
    } catch (reason) { error.value = String(reason); }
  }
  async function send() {
    if (!transport || busy.value || applying.value || loading.value || !prompt.value.trim()) return;
    const requestLocale = uiLocale.value;
    const promptOrigin = prompt.value === builtInPrompt ? 'builtin' : 'user';
    if (!connection.value) { error.value = '请先配置模型连接'; return; }
    if (!isAssistantModelId(modelId.value)) { error.value = '请为当前对话选择模型'; return; }
    if (!session.value) newSession();
    const target = session.value!;
    if (target.messages.length >= 290) { error.value = '会话已达到消息上限，请新建会话'; return; }
    const expected = scope();
    const epoch = generation;
    const config = { ...connection.value };
    const objectContext = workspace.capabilities.features.objectReferences;
    const model = modelId.value;
    const effort = config.kind === 'codex-cli' ? reasoningEffort.value : undefined;
    target.connectionId = config.id; target.model = model;
    if (effort !== undefined) target.reasoningEffort = effort;
    const question = prompt.value.trim();
    if (question.length > 20_000) { error.value = '问题超过 20,000 字，请缩短后发送'; return; }
    busy.value = true; error.value = ''; progress.value = assistantCopy(requestLocale).progress.reading;
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
          if (selected.from !== undefined && source.content.slice(selected.from, selected.to).replace(/\r\n?/g, '\n') !== selected.text.replace(/\r\n?/g, '\n'))
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
      const history = assistantHistory(target.messages);
      const now = Date.now();
      target.messages.push({ id: crypto.randomUUID(), role: 'user', content: question, createdAt: now });
      reply = { id: crypto.randomUUID(), role: 'assistant', content: '', createdAt: now, sources,
        attachedSourceIds: sources.map(source => source.id), proposals: [], toolResults: [], activity: [], rules: rules.map(rule => rule.path), state: 'running', model };
      target.messages.push(reply);
      // Use the reactive instance for streaming; the plain object pushed above is not reactive.
      reply = target.messages[target.messages.length - 1];
      target.title = target.messages.find(message => message.role === 'user')!.content.slice(0, 50);
      target.updatedAt = now; prompt.value = '';
      await persist(target);
      let structureSnapshot: Awaited<ReturnType<typeof workspace.assistantStructures>> | undefined;
      let structureChanged = false;
      let responseActivity: Extract<AssistantActivity, { kind: 'text' }> | undefined;
      let textPhase: AssistantTextPhase = 'pending';
      let responseStart = 0, activityStart = 0, runCompleted = false;
      let toolActivity: Extract<AssistantActivity, { kind: 'tool' }> | undefined;
      reply.usage = await runAssistant({ transport, connectionId: config.id, model, reasoningEffort: effort, tools: config.tools,
        mode: inline ? 'inline' : 'sidebar', locale: requestLocale, promptOrigin,
        workspaceId: expected.id, runId: reply.id, sources: reply.sources!, history, rules, prompt: question, signal: abort.signal,
        ...(inline ? {} : { askUser: (questions: AssistantQuestion[]) => askUser(questions, target, reply!, abort.signal) }),
        execute: async (proposal: AssistantProposal) => {
          const result = await executeChange(reply!.proposals!.find(item => item.id === proposal.id)!, target, expected, abort.signal);
          if (result.written === true) structureChanged = true;
          return result;
        },
        ...(objectContext ? {
          references: (identity: import('@tano/protocol').ReferenceIdentity) => workspace.assistantReferenceContext(expected, identity),
          tasks: async (query: import('./tasks').TaskQuery) => {
            if (!structureSnapshot || structureChanged) { structureSnapshot = await workspace.assistantStructures(expected); structureChanged = false; }
            return workspace.assistantTaskQuery(expected, query, structureSnapshot);
          },
          structures: {
            read: async () => {
              if (!structureSnapshot || structureChanged) { structureSnapshot = await workspace.assistantStructures(expected); structureChanged = false; }
              return { targets: structureSnapshot.targets, relations: structureSnapshot.relations, relationTypes: structureSnapshot.relationTypes };
            },
            propose: (call: import('@tano/protocol').AssistantToolCall) => workspace.proposeAssistantStructure(expected, reply!.id, call, structureSnapshot),
          },
        } : {}),
        lookup: {
          search: (query: string) => workspace.assistantSearch(expected, query),
          read: (fileId: string) => workspace.assistantSnapshot(expected, fileId),
        },
        delta: text => {
          if (epoch !== generation) return;
          if (text.trim() && firstContentMs === undefined) firstContentMs = Math.round(performance.now() - startedAt);
          if (!responseActivity && !text.trim()) { reply!.content += text; return; }
          if (!responseActivity || responseActivity.phase !== textPhase) {
            reply!.activity!.push({ kind: 'text', start: reply!.content.length, end: reply!.content.length, phase: textPhase });
            responseActivity = reply!.activity!.at(-1) as typeof responseActivity;
          }
          reply!.content += text;
          responseActivity!.end = reply!.content.length;
        },
        activity: event => {
          if (epoch !== generation) return;
          if (event.type === 'response-start') {
            responseStart = reply!.content.length; activityStart = reply!.activity!.length;
            responseActivity = undefined; textPhase = 'pending';
          } else if (event.type === 'response-end') {
            reply!.activity!.splice(activityStart, reply!.activity!.length - activityStart, ...event.segments
              .filter(segment => segment.end > segment.start)
              .map(segment => ({ kind: 'text' as const, start: responseStart + segment.start, end: responseStart + segment.end, phase: segment.phase })));
            responseActivity = undefined; textPhase = 'working';
          } else if (event.type === 'text-phase') {
            textPhase = event.phase;
          } else if (event.type === 'run-complete') {
            runCompleted = true;
          } else {
            reply!.activity!.push({ kind: 'tool', name: event.name, status: 'running' });
            toolActivity = reply!.activity!.at(-1) as typeof toolActivity;
            progress.value = formatAssistantText(assistantCopy(requestLocale).progress.executing,
              [(assistantCopy(requestLocale).tools as Record<string, string>)[event.name] ?? assistantCopy(requestLocale).result.toolCall]);
          }
        },
        proposal: proposal => { if (epoch === generation) reply!.proposals!.push(proposal); },
        toolResult: result => {
          if (epoch !== generation) return;
          reply!.toolResults!.push(result);
          if (toolActivity) {
            toolActivity.status = result.status;
            toolActivity.resultIndex = reply!.toolResults!.length - 1;
            toolActivity = undefined;
          }
        },
        progress: text => { if (epoch === generation) progress.value = text; },
      });
      abort.signal.throwIfAborted();
      if (!runCompleted || reply.userInputs?.some(input => input.status === 'pending') || reply.activity?.some(item => item.kind === 'tool' && item.status === 'running'))
        throw new AssistantRunError('incomplete', '助手运行尚未完成');
      reply.state = 'completed';
      reply.termination = { reason: 'completed' };
    } catch (reason) {
      const cancelled = abort.signal.aborted;
      if (reply) {
        reply.state = cancelled ? 'cancelled' : 'failed';
        reply.termination = { reason: cancelled ? 'cancelled' : reason instanceof AssistantRunError ? reason.reason : 'error' };
        for (const item of reply.activity ?? []) if (item.kind === 'text') item.phase = 'working';
        reply.error = cancelled ? '已停止，已完成的修改保留在变更清单中，未完成的操作不会继续执行' : String(reason);
      } else if (epoch === generation) error.value = String(reason);
    } finally {
      if (reply && epoch === generation) {
        for (const item of reply.activity ?? []) if (item.kind === 'tool' && item.status === 'running') item.status = 'interrupted';
        reply.timing = { totalMs: Math.round(performance.now() - startedAt),
          ...(firstContentMs === undefined ? {} : { firstContentMs }) };
        target.updatedAt = Date.now();
        try { await persist(target); } catch (reason) { error.value = `会话保存失败：${String(reason)}`; }
      }
      if (epoch === generation) { busy.value = false; progress.value = ''; controller = undefined; }
    }
  }
  async function executeChange(proposal: AssistantProposal, target: AssistantSession, expected: ReturnType<typeof scope>, signal: AbortSignal): Promise<AssistantExecutionResult> {
    let submitted = false;
    applying.value = true;
    const assertCurrent = () => {
      signal.throwIfAborted();
      if (workspace.workspace?.id !== expected.id || workspace.workspace.path !== expected.path || workspace.assistantEpoch !== expected.epoch)
        throw new Error('工作区已切换，停止执行');
      if (proposal.fileId && managed(proposal.fileId)) throw new Error('此文档正由协作会话管理，暂时不能直接修改');
    };
    try {
      assertCurrent();
      if (target.messages.some(message => message.proposals?.some(item => item.id !== proposal.id &&
          ['unknown', 'applying'].includes(item.status) && (item.path === proposal.path || !!proposal.fileId && item.fileId === proposal.fileId))))
        throw new Error('此目标有结果待核对的操作，请先核对，不自动重试');
      progress.value = formatAssistantText(assistantCopy(uiLocale.value).progress.executing, [proposal.path]);
      const preview = await workspace.reviewAssistantProposal(expected, proposal, undefined, true, signal);
      if (preview.status === 'saved') {
        proposal.applied = preview.applied; proposal.status = 'applied';
      } else {
        proposal.preview = preview.preview;
        if (preview.status !== 'preview' || !preview.preview) {
          proposal.status = preview.status === 'conflict' ? 'conflicted' : 'ready';
          throw new Error('修改存在冲突或文档已变化，已暂停此项操作，请核对原文与建议');
        }
        proposal.status = 'applying';
        await persist(target); // A crash must leave a durable intent, never an invisible write.
        assertCurrent();
        submitted = true;
        const result = await workspace.reviewAssistantProposal(expected, proposal, proposal.preview, true, signal);
        if (result.status === 'saved') {
          proposal.applied = result.applied; proposal.status = 'applied'; proposal.error = undefined;
        } else {
          proposal.preview = result.preview;
          proposal.status = result.status === 'conflict' ? 'conflicted' : 'ready';
          proposal.error = '执行前文档发生变化，已暂停此项操作，请核对后处理';
        }
      }
      await persist(target);
    } catch (reason) {
      if (proposal.applied) {
        proposal.status = 'applied';
        proposal.error = `修改已完成，记录或刷新失败：${String(reason)}`;
      } else {
        if (proposal.status === 'applying') proposal.status = submitted ? 'unknown' : 'ready';
        proposal.error = String(reason);
      }
      try { await persist(target); } catch { /* Preserve the in-memory outcome; never retry the write. */ }
    } finally { applying.value = false; }
    const written = proposal.status === 'applied' ? true : proposal.status === 'unknown' ? null : false;
    const result: AssistantExecutionResult = { status: proposal.status, written, ...(proposal.error ? { error: proposal.error } : {}) };
    if (written && proposal.applied) {
      result.fileId = proposal.applied.fileId;
      result.path = proposal.preview?.destination ?? proposal.preview?.path ?? proposal.path;
      // Return committed bytes as a new immutable source; never widen an original selection.
      if (['edit', 'create', 'rename', 'move'].includes(proposal.kind) && !target.messages.some(message => message.id === proposal.runId &&
          message.sources?.some(source => source.fileId === proposal.fileId && source.selection)))
        result.source = { id: '', workspaceId: expected.id, fileId: result.fileId, path: result.path,
          content: proposal.applied.after, hash: proposal.applied.hash, origin: 'disk' };
    }
    return result;
  }
  async function review(proposal: AssistantProposal, apply = false) {
    if (busy.value || applying.value || !transport) return;
    if (proposal.suggestionGroupId) { error.value = '此提案已转为文档建议，请在文档中逐项审阅'; return; }
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
      const result = await workspace.reviewAssistantProposal(expected, proposal, acceptance, false, undefined, !!target?.external);
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
  async function publishSuggestions(proposal: AssistantProposal) {
    if (busy.value || applying.value || proposal.kind !== 'edit' || !['ready', 'conflicted'].includes(proposal.status)) return;
    if (isDataTableFilePath(proposal.path)) { error.value = '数据表修改请在助手中查看差异并应用'; return; }
    if (proposal.fileId && managed(proposal.fileId)) { error.value = '此文档正由协作会话管理，暂不支持建议模式'; return; }
    applying.value = true;
    const target = session.value;
    try {
      await useSuggestionStore().publish(proposal);
      proposal.suggestionGroupId = proposal.id;
      await persist(target);
      error.value = '';
    } catch (reason) { error.value = String(reason); }
    finally { applying.value = false; }
  }
  async function verify(proposal: AssistantProposal) {
    if (applying.value || busy.value || !proposal.preview) return;
    applying.value = true; error.value = '';
    const target = session.value;
    try {
      const expected = scope();
      if (expected.id !== proposal.workspaceId) throw new Error('工作区已切换');
      const current = await runtime.adapter.refresh();
      if (current.id !== expected.id || current.path !== expected.path) throw new Error('工作区已切换');
      if (['delete', 'rename', 'move'].includes(proposal.kind)) {
        const file = current.files.find(file => file.id === proposal.fileId);
        if (!file) throw new Error('原文件已不存在，无法确认是否由此次操作移除；请核对回收站，保留此记录');
        const disk = await runtime.adapter.read(file.path);
        if (proposal.kind !== 'delete' && file.path === proposal.preview.destination && disk.hash === proposal.preview.diskHash) {
          proposal.applied = { before: proposal.preview.before, after: disk.content, hash: disk.hash, fileId: file.id };
          proposal.status = 'applied'; proposal.error = undefined;
        } else if (file.path === proposal.preview.path && disk.hash === proposal.preview.diskHash) {
          proposal.status = 'ready'; proposal.preview = undefined; proposal.error = '未发现此次文件操作，请重新审阅';
        } else throw new Error('文件位置或内容已变化，请人工核对；不自动重试');
        await persist(target);
        if (target?.external && proposal.id === target.id) await transport?.recordExternalResult?.(target);
        return;
      }
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
    if (!proposal.applied || applying.value || busy.value || !['edit', 'create'].includes(proposal.kind)) return;
    if (proposal.kind === 'create' && isDataTableFilePath(proposal.path)) return;
    const reply = session.value?.messages.find(message => message.id === proposal.runId);
    if (!reply) return;
    const reversed: AssistantProposal = { id: crypto.randomUUID(), runId: reply.id, workspaceId: proposal.workspaceId,
      kind: 'edit', fileId: proposal.applied.fileId, path: proposal.path, base: proposal.applied.after,
      content: proposal.applied.before, reason: `撤回内容：${proposal.reason}`, status: 'ready' };
    reply.proposals!.push(reversed);
    const current = reply.proposals!.at(-1)!;
    current.execution = 'direct';
    await executeChange(current, session.value!, scope(), new AbortController().signal);
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
    if (displayMode.value === 'fullscreen') setDisplayMode('sidebar');
    busy.value = false; prompt.value = ''; files.value = []; selection.value = null; session.value = null; sessions.value = [];
    replyTarget.value = null;
    connectionId.value = ''; modelId.value = ''; models.value = []; modelsError.value = ''; modelsLoading.value = false;
    if (!key || !transport) return;
    externalSessions.value = [];
    const expected = scope(); loading.value = true; error.value = '';
    try {
      await reloadConnections();
      const loaded = inline ? [] : await transport.loadSessions(expected.id);
      if (epoch !== generation) return;
      for (const target of loaded) for (const message of target.messages) {
        if (message.state === 'running' || message.state === 'waiting') {
          message.state = 'interrupted'; message.termination = { reason: 'interrupted' };
          for (const item of message.activity ?? []) if (item.kind === 'text') item.phase = 'working';
        }
        for (const item of message.activity ?? []) if (item.kind === 'tool' && item.status === 'running') item.status = 'interrupted';
        for (const input of message.userInputs ?? []) if (input.status === 'pending') input.status = 'cancelled';
        for (const proposal of message.proposals ?? []) if (proposal.status === 'applying') proposal.status = 'unknown';
      }
      sessions.value = loaded.sort((a, b) => b.updatedAt - a.updatedAt);
      session.value = sessions.value[0] ?? null;
      restoreModelSelection(session.value);
      if (!session.value) newSession();
    } catch (reason) { if (epoch === generation) error.value = String(reason); }
    finally { if (epoch === generation) loading.value = false; }
  }, { immediate: true });
  watch(() => workspace.tabs.map(tab => tab.id), ids => {
    if (fullscreenTabId.value && !ids.includes(fullscreenTabId.value)) setDisplayMode('sidebar');
  });
  watch([connection, opened], () => { void reloadModels(); });
  onScopeDispose(() => { stop(); modelController?.abort(); });
  return { available, demo, canConfigure, opened, displayMode, fullscreenTabId, fullscreenPaneId, isFullscreenTab, setDisplayMode, loading, busy, applying, connections, connectionId, connection, modelId, models, modelsLoading, modelsError, reloadModels, refreshModels, selectModel, selectConnection, sessions, session, externalSessions, loadExternal, importExternal,
    files, selection, prompt, setBuiltInPrompt, error, progress, pendingUserInput, startDocumentDraft, submitUserInput, reasoningEffort, selectReasoningEffort, replyTarget, open, stop, settle, send, newSession, selectSession, deleteSession, review, verify,
    undo, reject, publishSuggestions, saveConnection, removeConnection, reloadConnections, checkConnection, setManaged: (check: (id: string) => boolean) => { managed = check; } };
}
