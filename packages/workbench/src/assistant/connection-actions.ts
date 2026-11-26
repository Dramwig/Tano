import type { ComputedRef, Ref } from 'vue';
import {
  isAssistantModelId,
  isAssistantReasoningSelection,
  type AssistantConnection,
  type AssistantQuotaConfig,
  type AssistantReasoningSelection,
  type AssistantSession,
  type AssistantTransport,
} from '@tano/protocol';
import { recordHelpCompleted } from '../help/help-checklist';
import type { useWorkspaceStore } from '../stores/workspace';

export interface AssistantConnectionActionDeps {
  transport: AssistantTransport | undefined;
  canConfigure: boolean;
  opened: Ref<boolean>;
  loading: Ref<boolean>;
  busy: Ref<boolean>;
  applying: Ref<boolean>;
  connections: Ref<AssistantConnection[]>;
  connectionId: Ref<string>;
  connection: ComputedRef<AssistantConnection | undefined>;
  modelId: Ref<string>;
  reasoningEffort: Ref<AssistantReasoningSelection>;
  models: Ref<string[]>;
  modelsLoading: Ref<boolean>;
  modelsError: Ref<string>;
  session: Ref<AssistantSession | null>;
  workspace: ReturnType<typeof useWorkspaceStore>;
  getGeneration: () => number;
  newSession: () => void;
  persist: (target?: AssistantSession | null) => Promise<void>;
}

export function createAssistantConnectionActions(deps: AssistantConnectionActionDeps) {
  const {
    transport,
    canConfigure,
    opened,
    loading,
    busy,
    applying,
    connections,
    connectionId,
    connection,
    modelId,
    reasoningEffort,
    models,
    modelsLoading,
    modelsError,
    session,
    workspace,
    getGeneration,
    newSession,
    persist,
  } = deps;

  let modelController: AbortController | undefined;

  function abortModels() {
    modelController?.abort();
  }

  async function reloadConnections() {
    if (!transport) return;
    const epoch = getGeneration();
    const loaded = (await transport.connections()).map(({ managed, ...item }) => ({
      ...item,
      platformProvider: item.platformProvider ?? managed,
    }));
    if (epoch !== getGeneration()) return;
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
    } finally {
      if (modelController === abort) { modelsLoading.value = false; modelController = undefined; }
    }
  }

  async function refreshModels() {
    if (busy.value || applying.value || loading.value) return;
    modelsLoading.value = true; modelsError.value = '';
    try { await reloadConnections(); await reloadModels(); }
    catch (reason) { modelsError.value = reason instanceof Error ? reason.message : String(reason); }
    finally { modelsLoading.value = false; }
  }

  async function readConnectionKey(id: string) {
    if (!canConfigure || !connections.value.some(item => item.id === id && !item.platformProvider && item.hasKey && (!item.kind || item.kind === 'api')))
      throw new Error('此连接无法读取 API 密钥');
    if (!transport?.readConnectionKey) throw new Error('当前环境不支持读取已保存的密钥，请更新并重启桌面版');
    return transport.readConnectionKey(id);
  }

  async function queryQuota(id: string) {
    if (!transport?.quota) throw new Error('当前环境不支持服务商额度查询，请使用桌面版');
    if (!connections.value.some(item => item.id === id && !item.platformProvider)) throw new Error('此连接不支持个人额度查询');
    return transport.quota(id);
  }

  async function saveQuota(id: string, config: AssistantQuotaConfig, key?: string) {
    if (!transport?.saveQuota) throw new Error('当前环境不支持额度配置，请使用桌面版');
    if (!connections.value.some(item => item.id === id && !item.platformProvider)) throw new Error('连接已移除或由平台管理');
    await transport.saveQuota(id, config, key);
    await reloadConnections();
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
    if (!canConfigure || config.platformProvider || previous?.platformProvider) throw new Error('此模型连接由平台管理员配置');
    await transport.saveConnection(config, key);
    recordHelpCompleted('assistant-connection');
    await reloadConnections();
    await selectConnection(
      config.id,
      previous?.endpoint !== config.endpoint ||
        (previous?.kind ?? 'api') !== (config.kind ?? 'api') ||
        previous?.cliPath !== config.cliPath,
    );
  }

  const canImportCcSwitch = canConfigure && !!transport?.scanCcSwitch && !!transport?.importCcSwitch;

  async function scanCcSwitch(path?: string) {
    if (!canImportCcSwitch) throw new Error('当前环境不支持从 CC Switch 导入');
    return transport!.scanCcSwitch!(path);
  }

  async function importCcSwitch(ids: string[], path?: string) {
    if (!canImportCcSwitch || busy.value || applying.value || loading.value) throw new Error('请先等待当前任务完成');
    await transport!.importCcSwitch!(ids, path);
    await reloadConnections();
  }

  async function removeConnection(id: string) {
    if (!transport || busy.value || applying.value || loading.value) throw new Error('请先等待当前任务完成');
    if (!canConfigure || connections.value.find(item => item.id === id)?.platformProvider) throw new Error('此模型连接由平台管理员配置');
    await transport.removeConnection(id);
    await reloadConnections();
  }

  return {
    abortModels,
    canImportCcSwitch,
    reloadConnections,
    reloadModels,
    refreshModels,
    readConnectionKey,
    queryQuota,
    saveQuota,
    checkConnection,
    selectConnection,
    selectModel,
    restoreModelSelection,
    selectReasoningEffort,
    saveConnection,
    scanCcSwitch,
    importCcSwitch,
    removeConnection,
  };
}
