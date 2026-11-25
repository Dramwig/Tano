import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue';
import type { WorkspaceCapabilities } from '@tano/editor/runtime';
import { mergeMarkdown } from '@tano/markdown';
import {
  FileRegistry,
  isMarkdown,
  isWorkspaceInternalPath,
  matchesPluginPathScopes,
  objectDirectory,
  parseObject,
  parsePluginAttachmentWrite,
  parsePluginConnectionInput,
  pluginRecord,
  referenceKey,
  validateObjectProperties,
  validatePath,
  validateRelation,
  type FileEntry,
  type FileSnapshot,
  type PluginConnectionInput,
  type PluginHostEnvironment,
  type PluginOAuthInput,
  type PluginUiConfirmOptions,
  type PluginUiPickOptions,
  type PluginUiPromptOptions,
  type PluginUiTone,
  type ReferenceTarget,
  type RelationTypeDefinition,
  type Workspace,
  type WorkspaceAdapter,
  type WorkspacePersonalPluginPolicy,
  type WorkspaceRelation,
} from '@tano/protocol';
import workbenchPackage from '../../package.json';
import { assistantHash } from '../assistant/hash';
import { nativeAttachments } from '../files/attachments';
import type { useDocumentIndex } from '../documents/document-index';
import { documentDirty as dirty, type OpenDocument } from '../documents/document-session';
import { t } from '../i18n/i18n';
import { PluginAttachmentReader } from '../plugins/attachment-reader';
import { listActivePluginContextProviders } from '../plugins/assistant-bridge';
import type {
  PluginAiCompleteRequest,
  PluginAiCompleteResult,
  PluginAiStructuredRequest,
  PluginAiStructuredResult,
} from '@tano/protocol';
import { PluginQueryPager, pluginChanges } from '../plugins/data';
import type { PluginDevelopmentState } from '../plugins/development';
import type { PluginRuntimeState } from '../plugins/host';
import { canManageWorkspacePlugins } from '../plugins/policy';
import { queryPluginData } from '../plugins/queries';
import {
  pluginViewKey,
  pluginWorkbenchCodeBlockRenderers,
  pluginWorkbenchCommands,
  pluginWorkbenchDecorations,
  pluginWorkbenchFileHandlers,
  pluginWorkbenchSlashCommands,
  pluginWorkbenchStatusBarItems,
  pluginWorkbenchViews,
  type PluginInteraction,
} from '../plugins/workbench';
import type { WorkbenchOverlaySnapshot, WorkbenchRuntime } from '../runtime';
import { mergeObject, saveObject, type ObjectRecord } from '../objects/workspace-objects';
import { WorkspacePluginRuntime } from '../plugins/workspace-plugin-runtime';
import { PLUGINS_TAB_ID, type InstalledObjectPlugin } from '../plugins/workspace-plugins';
import { saveRelationChange } from '../objects/workspace-relations';

export type PluginUiDialogRequest =
  | {
      id: string;
      kind: 'pick';
      pluginId: string;
      pluginName: string;
      options: PluginUiPickOptions;
    }
  | {
      id: string;
      kind: 'prompt';
      pluginId: string;
      pluginName: string;
      options: PluginUiPromptOptions;
    }
  | {
      id: string;
      kind: 'confirm';
      pluginId: string;
      pluginName: string;
      options: PluginUiConfirmOptions;
    };

export interface PluginUiToastItem {
  id: string;
  pluginId: string;
  pluginName: string;
  message: string;
  tone: PluginUiTone;
}

export interface PluginEditorBridge {
  applyEdit(id: string, before: string, after: string): Promise<boolean>;
  activeEditor?(): {
    fileId: string;
    mode: 'rich' | 'source';
    readOnly: boolean;
    selection: { from: number; to: number; empty: boolean };
    selectedText: string;
    blockType?: string;
  } | null;
  applySelectionEdit?(id: string, text: string, mode: 'insert' | 'replace'): Promise<boolean>;
}

export interface WorkspacePluginsStateDeps {
  adapter: WorkspaceAdapter;
  runtime: WorkbenchRuntime;
  workspace: Ref<Workspace | null>;
  fileRegistry: Ref<FileRegistry | null>;
  documents: Ref<OpenDocument[]>;
  documentIndex: ReturnType<typeof useDocumentIndex>;
  capabilities: Ref<WorkspaceCapabilities>;
  objects: Ref<ObjectRecord[]>;
  relations: Ref<WorkspaceRelation[]>;
  relationError: Ref<string>;
  getRelationBase: () => FileSnapshot | null;
  relationDefinitions: Ref<RelationTypeDefinition[]>;
  referenceTargets: Ref<ReferenceTarget[]>;
  tabIds: Ref<string[]>;
  activeId: Ref<string>;
  installedPlugins: Ref<InstalledObjectPlugin[]>;
  activePluginSidebar: Ref<string>;
  serial: <T>(task: () => Promise<T>) => Promise<T>;
  writable: () => void;
  scheduleRefresh: () => void;
  refreshObjects: () => Promise<void>;
  openInternal: (file: FileEntry, replaceId?: string, current?: () => boolean) => Promise<void>;
  saveInternal: (doc: OpenDocument) => Promise<void>;
  ensureTabNavigation: (tabId: string, targetId?: string) => void;
  touchNavigation: () => void;
}

export function createWorkspacePluginsState(deps: WorkspacePluginsStateDeps) {
  const {
    adapter,
    runtime,
    workspace,
    fileRegistry,
    documents,
    documentIndex,
    capabilities,
    objects,
    relations,
    relationError,
    getRelationBase,
    relationDefinitions,
    referenceTargets,
    tabIds,
    activeId,
    installedPlugins,
    activePluginSidebar,
    serial,
    writable,
    scheduleRefresh,
    refreshObjects,
    openInternal,
    saveInternal,
    ensureTabNavigation,
    touchNavigation,
  } = deps;

  const pluginAttachmentReader = new PluginAttachmentReader();
  let pluginEditorBridge: PluginEditorBridge | undefined;
  const pluginRuntime = shallowRef<PluginRuntimeState[]>([]);
  watch(
    [
      () => workspace.value?.id,
      () => pluginRuntime.value.map((plugin) => `${plugin.instanceId}:${plugin.status}`).join(','),
    ],
    () => pluginAttachmentReader.clear(),
  );
  const pluginQueryPager = new PluginQueryPager();
  const canManagePlugins = computed(
    () => !!workspace.value && canManageWorkspacePlugins(adapter, workspace.value),
  );
  const pluginStorageChanged = (event: StorageEvent) => {
    if (
      event.key?.startsWith('tano.object-plugins.v1.') ||
      event.key?.startsWith('tano.plugin-') ||
      event.key?.startsWith('tano.user-plugins.v1.')
    )
      scheduleRefresh();
  };
  if (typeof window !== 'undefined') window.addEventListener('storage', pluginStorageChanged);
  onScopeDispose(() => {
    if (typeof window !== 'undefined') window.removeEventListener('storage', pluginStorageChanged);
  });

  const installedPluginWorkspace = ref('');
  const personalCodePluginPolicy = ref<WorkspacePersonalPluginPolicy>('allow');
  const overlayExtension = () => runtime.extensions?.().overlay;
  const overlaySnapshot = computed<WorkbenchOverlaySnapshot>(
    () => overlayExtension()?.snapshot ?? { safeMode: false },
  );
  type PluginAiRunner = (options: {
    pluginId: string;
    pluginName: string;
    structured: boolean;
    request: PluginAiCompleteRequest | PluginAiStructuredRequest;
    signal: AbortSignal;
  }) => Promise<PluginAiCompleteResult | PluginAiStructuredResult>;
  let pluginAiRunner: PluginAiRunner | undefined;
  const pluginDevelopment = shallowRef<PluginDevelopmentState>({
    pluginId: '',
    active: false,
    message: '',
  });
  const pluginHostEnvironment: PluginHostEnvironment = runtime.plugins?.host ?? {
    coreVersion: workbenchPackage.version,
    platform: runtime.mobile
      ? 'mobile'
      : adapter.mode === 'desktop'
        ? 'desktop-local'
        : runtime.native
          ? 'desktop-online'
          : 'web',
  };
  const pluginServices = new WorkspacePluginRuntime({
    adapter,
    services: {
      ...runtime.plugins,
      host: pluginHostEnvironment,
    },
    serial,
    refresh: refreshObjects,
    call: pluginCall,
    workspace: () => workspace.value,
    setWorkspace: (current) => {
      workspace.value = current;
    },
    installed: () => installedPlugins.value,
    canManage: () => canManagePlugins.value,
    changed: (states) => {
      pluginRuntime.value = states;
    },
    developmentChanged: (state) => {
      pluginDevelopment.value = state;
    },
  });
  const { policy: pluginHost, executor: pluginExecutor, developer: pluginDeveloper } = pluginServices;
  onScopeDispose(() => pluginServices.dispose());

  const pluginViews = computed(() => pluginWorkbenchViews(installedPlugins.value));
  const pluginCommands = computed(() => pluginWorkbenchCommands(pluginRuntime.value));
  const pluginFileHandlers = computed(() =>
    pluginWorkbenchFileHandlers(installedPlugins.value, pluginRuntime.value),
  );
  const pluginSlashCommands = computed(() =>
    pluginWorkbenchSlashCommands(installedPlugins.value, pluginRuntime.value),
  );
  const pluginCodeBlockRenderers = computed(() =>
    pluginWorkbenchCodeBlockRenderers(installedPlugins.value, pluginRuntime.value),
  );
  const pluginDecorationsFor = (fileId: string) =>
    pluginWorkbenchDecorations(pluginRuntime.value, fileId);
  const pluginStatusBarItems = computed(() => pluginWorkbenchStatusBarItems(pluginRuntime.value));
  const activeDocumentPluginSidebar = ref('');
  const activePluginDialog = shallowRef<PluginUiDialogRequest | null>(null);
  const pluginToasts = shallowRef<PluginUiToastItem[]>([]);
  const toastTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let activeDialogControl: {
    id: string;
    resolve: (value: string | boolean | null) => void;
    reject: (error: Error) => void;
    cleanup: () => void;
  } | null = null;
  function cancelActivePluginDialog(reason = '插件交互已取消') {
    const current = activeDialogControl;
    if (!current) return;
    activeDialogControl = null;
    activePluginDialog.value = null;
    current.cleanup();
    current.reject(new Error(reason));
  }
  function resolvePluginDialog(id: string, value: string | boolean | null) {
    const current = activeDialogControl;
    if (!current || current.id !== id) return;
    activeDialogControl = null;
    activePluginDialog.value = null;
    current.cleanup();
    current.resolve(value);
  }
  function dismissPluginToast(id: string) {
    const timer = toastTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimers.delete(id);
    }
    pluginToasts.value = pluginToasts.value.filter((item) => item.id !== id);
  }
  function showPluginToast(params: Record<string, unknown>) {
    const id = crypto.randomUUID();
    const item: PluginUiToastItem = {
      id,
      pluginId: String(params.pluginId ?? ''),
      pluginName: String(params.pluginName ?? ''),
      message: String(params.message ?? ''),
      tone: (params.tone as PluginUiTone | undefined) ?? 'info',
    };
    const next = [...pluginToasts.value, item];
    while (next.length > 3) {
      const removed = next.shift();
      if (removed) {
        const timer = toastTimers.get(removed.id);
        if (timer) {
          clearTimeout(timer);
          toastTimers.delete(removed.id);
        }
      }
    }
    pluginToasts.value = next;
    toastTimers.set(
      id,
      setTimeout(() => dismissPluginToast(id), 4500),
    );
  }
  function openPluginDialog(
    method: 'ui.pick' | 'ui.prompt' | 'ui.confirm',
    params: Record<string, unknown>,
  ): Promise<string | boolean | null> {
    if (activeDialogControl) {
      return Promise.reject(new Error('当前已有插件交互弹窗正在等待响应，请稍后重试'));
    }
    const id = crypto.randomUUID();
    const signal = params.signal instanceof AbortSignal ? params.signal : undefined;
    if (signal?.aborted) return Promise.reject(new Error('插件已停止'));
    return new Promise<string | boolean | null>((resolve, reject) => {
      const onAbort = () => cancelActivePluginDialog('插件已停止');
      signal?.addEventListener('abort', onAbort, { once: true });
      const cleanup = () => signal?.removeEventListener('abort', onAbort);
      activeDialogControl = { id, resolve, reject, cleanup };
      const pluginId = String(params.pluginId ?? '');
      const pluginName = String(params.pluginName ?? '');
      if (method === 'ui.pick') {
        activePluginDialog.value = {
          id,
          kind: 'pick',
          pluginId,
          pluginName,
          options: params.options as PluginUiPickOptions,
        };
      } else if (method === 'ui.prompt') {
        activePluginDialog.value = {
          id,
          kind: 'prompt',
          pluginId,
          pluginName,
          options: params.options as PluginUiPromptOptions,
        };
      } else {
        activePluginDialog.value = {
          id,
          kind: 'confirm',
          pluginId,
          pluginName,
          options: params.options as PluginUiConfirmOptions,
        };
      }
    });
  }
  const pluginSettingsRequest = shallowRef<{ key: string; sequence: number }>();
  const pluginSettingsPages = computed(() =>
    pluginViews.value
      .filter((view) => view.location === 'settings')
      .map((view) => ({
        view,
        workspaceId: workspace.value?.id ?? '',
        runtime: pluginRuntime.value.find((rt) => rt.id === view.pluginId),
      })),
  );
  const pluginError = ref('');

  watch(
    () => workspace.value?.id,
    () => {
      activePluginSidebar.value = '';
      activeDocumentPluginSidebar.value = '';
      pluginSettingsRequest.value = undefined;
      cancelActivePluginDialog('工作区已切换');
      for (const timer of toastTimers.values()) clearTimeout(timer);
      toastTimers.clear();
      pluginToasts.value = [];
    },
  );
  watch(pluginViews, (views) => {
    if (
      activeDocumentPluginSidebar.value &&
      !views.some(
        (view) => view.location === 'documentSidebar' && view.key === activeDocumentPluginSidebar.value,
      )
    ) {
      activeDocumentPluginSidebar.value = '';
    }
  });
  watch(
    () => {
      const id = activeId.value;
      const entry = id ? fileRegistry.value?.get(id) : undefined;
      return entry && isMarkdown(entry.path) && !isWorkspaceInternalPath(entry.path) ? entry.id : '';
    },
    (docId, prevDocId) => {
      if (!docId || docId === prevDocId || !workspace.value) return;
      for (const view of pluginViews.value) {
        if (view.location === 'documentHeader' || view.location === 'documentFooter') {
          if (pluginRuntime.value.some((rt) => rt.id === view.pluginId && rt.status === 'idle')) {
            void pluginExecutor.ensureActivated(view.pluginId).catch(() => {});
          }
        }
      }
      pluginExecutor.notify({ type: 'workspace.changed', fileId: docId });
    },
  );

  let pluginEventTimer: ReturnType<typeof setTimeout> | undefined;
  onScopeDispose(() => clearTimeout(pluginEventTimer));

  const pluginDataRevision = computed(
    () =>
      [
        workspace.value?.id,
        workspace.value?.files
          .filter(
            (file) =>
              file.kind === 'file' && isMarkdown(file.path) && !isWorkspaceInternalPath(file.path),
          )
          .map((file) => {
            const draft = documentIndex.byId.value.get(file.id);
            return [
              file.id,
              JSON.stringify([
                file.path,
                file.size,
                file.modified,
                !!(workspace.value?.readOnly || file.readOnly),
                draft ? documentIndex.draftRevision(draft) : 0,
                !!draft?.conflict,
                !!draft?.missing,
              ]),
            ] as [string, string];
          }) ?? [],
        objects.value.map((record) => [record.object.id, record.snapshot.hash] as [string, string]),
        relations.value.map(
          (relation) => [relation.id, JSON.stringify(relation)] as [string, string],
        ),
      ] as const,
  );
  let pluginEventScope: string | undefined;
  let pluginPrevious = [
    new Map<string, string>(),
    new Map<string, string>(),
    new Map<string, string>(),
  ];
  watch(
    pluginDataRevision,
    (revision) => {
      clearTimeout(pluginEventTimer);
      const [scope, ...values] = revision;
      const next = values.map((rows) => new Map(rows));
      if (scope !== pluginEventScope) {
        pluginEventScope = scope;
        pluginPrevious = next;
        pluginQueryPager.clear();
        pluginDeveloper.stop();
        return;
      }
      pluginEventTimer = setTimeout(() => {
        if (workspace.value?.id !== scope) return;
        const types = ['documents.changed', 'objects.changed', 'relations.changed'] as const;
        let changed = false;
        for (let index = 0; index < types.length; index++) {
          const event = pluginChanges(types[index]!, pluginPrevious[index]!, next[index]!);
          if (event) {
            changed = true;
            pluginExecutor.notify(event);
          }
        }
        pluginPrevious = next;
        if (changed) pluginExecutor.notify({ type: 'workspace.changed' });
      }, 150);
    },
    { immediate: true },
  );

  watch(
    () => overlaySnapshot.value.safeMode,
    (safeMode) => {
      if (workspace.value) {
        pluginExecutor.sync(workspace.value, installedPlugins.value, safeMode);
      }
    },
  );

  watch(
    () => {
      const id = activeId.value;
      const entry = id ? fileRegistry.value?.get(id) : undefined;
      return entry && !isWorkspaceInternalPath(entry.path) ? entry.path : '';
    },
    (docPath) => {
      if (workspace.value) overlayExtension()?.syncContext?.(workspace.value.id, docPath);
    },
    { immediate: true },
  );

  async function refreshPlugins(current: Workspace) {
    try {
      const activeEntry = activeId.value ? fileRegistry.value?.get(activeId.value) : undefined;
      overlayExtension()?.syncContext?.(current.id, activeEntry?.path ?? '');
      const installed = await pluginHost.loadWorkspace(adapter, current, runtime.plugins?.repository);
      if (workspace.value?.id !== current.id) return;
      installedPlugins.value = installed;
      installedPluginWorkspace.value = current.id;
      personalCodePluginPolicy.value = pluginHost.personalCodePluginPolicy();
      pluginExecutor.sync(current, installedPlugins.value, overlaySnapshot.value.safeMode);
      pluginError.value = '';
    } catch (error) {
      pluginExecutor.dispose();
      pluginHost.dispose();
      installedPlugins.value = [];
      pluginError.value = `无法加载插件：${String(error)}。安装记录已保留。`;
    }
  }

  function openPluginView(pluginId: string, viewId: string) {
    const view = pluginViews.value.find((view) => view.key === pluginViewKey(pluginId, viewId));
    if (!workspace.value || !view) throw new Error('插件视图已停用或不存在');
    if (pluginRuntime.value.some((rt) => rt.id === pluginId && rt.status === 'idle')) {
      void pluginExecutor.ensureActivated(pluginId).catch(() => {});
    }
    if (view.location === 'tab' || view.location === 'homeTab' || view.location === 'newTab') {
      if (!tabIds.value.includes(view.key)) tabIds.value.push(view.key);
      activeId.value = view.key;
      ensureTabNavigation(view.key);
      touchNavigation();
    } else if (view.location === 'sidebar') activePluginSidebar.value = view.key;
    else if (view.location === 'documentSidebar') activeDocumentPluginSidebar.value = view.key;
    else if (view.location === 'documentHeader' || view.location === 'documentFooter') {
      // Document header/footer slots render automatically on the active document.
    } else if (view.location === 'settings')
      pluginSettingsRequest.value = {
        key: view.key,
        sequence: (pluginSettingsRequest.value?.sequence ?? 0) + 1,
      };
    else {
      if (!tabIds.value.includes(PLUGINS_TAB_ID)) tabIds.value.push(PLUGINS_TAB_ID);
      activeId.value = PLUGINS_TAB_ID;
      ensureTabNavigation(PLUGINS_TAB_ID);
      touchNavigation();
    }
  }

  const pluginContextProviders = computed(() =>
    listActivePluginContextProviders(installedPlugins.value, pluginRuntime.value),
  );
  const pluginHomeTabView = computed(() => {
    if (overlaySnapshot.value.safeMode) return null;
    const pinnedKey = overlaySnapshot.value.homeTabViewKey;
    if (pinnedKey) {
      return pluginViews.value.find((view) => view.key === pinnedKey && view.location === 'homeTab') ?? null;
    }
    return pluginViews.value.find((view) => view.location === 'homeTab') ?? null;
  });
  const pluginNewTabView = computed(() => {
    if (overlaySnapshot.value.safeMode) return null;
    const pinnedKey = overlaySnapshot.value.newTabViewKey;
    if (pinnedKey) {
      return pluginViews.value.find((view) => view.key === pinnedKey && view.location === 'newTab') ?? null;
    }
    return pluginViews.value.find((view) => view.location === 'newTab') ?? null;
  });
  function invokePluginAssistantTool(pluginId: string, toolName: string, args: Record<string, unknown>) {
    if (!workspace.value) return Promise.reject(new Error('请先打开工作区'));
    const entry = activeId.value ? fileRegistry.value?.get(activeId.value) : undefined;
    const activeFileId = entry && isMarkdown(entry.path) && !isWorkspaceInternalPath(entry.path) ? entry.id : undefined;
    return pluginExecutor.invokeAssistantTool(pluginId, toolName, args, {
      workspaceId: workspace.value.id,
      ...(activeFileId ? { activeFileId } : {}),
    });
  }
  function queryPluginAssistantContext(pluginId: string, providerId: string, query: string) {
    if (!workspace.value) return Promise.reject(new Error('请先打开工作区'));
    const entry = activeId.value ? fileRegistry.value?.get(activeId.value) : undefined;
    const activeFileId = entry && isMarkdown(entry.path) && !isWorkspaceInternalPath(entry.path) ? entry.id : undefined;
    return pluginExecutor.queryAssistantContext(pluginId, providerId, query, {
      workspaceId: workspace.value.id,
      ...(activeFileId ? { activeFileId } : {}),
    });
  }

  function interactWithPlugin(interaction: PluginInteraction) {
    if (workspace.value?.id !== interaction.workspaceId)
      return Promise.reject(new Error('工作区已切换，请重新打开插件界面'));
    return pluginExecutor.invoke(
      interaction.pluginId,
      interaction.kind,
      interaction.name,
      interaction.payload,
      interaction.instanceId,
    );
  }

  async function pluginCall(
    method: string,
    params: Record<string, unknown>,
    assertInstance: () => void,
  ): Promise<unknown> {
    const expected = workspace.value?.id;
    if (method === 'ui.pick' || method === 'ui.prompt' || method === 'ui.confirm') {
      assertInstance();
      if (!expected || workspace.value?.id !== expected) throw new Error(t('工作区已切换'));
      return openPluginDialog(method, params);
    }
    if (method === 'ui.toast') {
      assertInstance();
      if (!expected || workspace.value?.id !== expected) throw new Error(t('工作区已切换'));
      showPluginToast(params);
      return null;
    }
    if (method === 'ai.complete' || method === 'ai.structured') {
      assertInstance();
      if (!expected || workspace.value?.id !== expected) throw new Error(t('工作区已切换'));
      if (!pluginAiRunner) throw new Error('当前环境尚未配置同页助手模型连接');
      const signal = params.signal instanceof AbortSignal ? params.signal : new AbortController().signal;
      return pluginAiRunner({
        pluginId: String(params.pluginId ?? ''),
        pluginName: String(params.pluginName ?? ''),
        structured: method === 'ai.structured',
        request: params.request as PluginAiCompleteRequest | PluginAiStructuredRequest,
        signal,
      });
    }
    const pathScopes = Array.isArray(params.pathScopes) ? (params.pathScopes as string[]) : undefined;
    if (method === 'editor.active') {
      assertInstance();
      if (!expected || workspace.value?.id !== expected) throw new Error(t('工作区已切换'));
      const snapshot = pluginEditorBridge?.activeEditor?.();
      if (!snapshot) return null;
      const entry = fileRegistry.value?.get(snapshot.fileId);
      if (!entry || !isMarkdown(entry.path) || isWorkspaceInternalPath(entry.path)) return null;
      if (!matchesPluginPathScopes(entry.path, pathScopes)) return null;
      const doc = documentIndex.byId.value.get(entry.id);
      const content = doc ? doc.content : (await adapter.read(entry.path)).content;
      assertInstance();
      return {
        fileId: entry.id,
        path: entry.path,
        mode: snapshot.mode,
        readOnly: !!(workspace.value?.readOnly || entry.readOnly || snapshot.readOnly),
        selection: snapshot.selection,
        selectedText: snapshot.selectedText,
        ...(snapshot.blockType ? { blockType: snapshot.blockType } : {}),
        hash: await assistantHash(content),
      };
    }
    if (method === 'editor.insert' || method === 'editor.replaceSelection') {
      return serial(async () => {
        assertInstance();
        if (!expected || workspace.value?.id !== expected) throw new Error(t('工作区已切换'));
        writable();
        const snapshot = pluginEditorBridge?.activeEditor?.();
        if (!snapshot || !pluginEditorBridge?.applySelectionEdit)
          throw new Error('当前没有可编辑的活动文档');
        const entry = fileRegistry.value?.get(snapshot.fileId);
        if (!entry || !isMarkdown(entry.path) || isWorkspaceInternalPath(entry.path))
          throw new Error('当前没有可编辑的活动文档');
        if (!matchesPluginPathScopes(entry.path, pathScopes))
          throw new Error('文档路径不在插件授权目录范围内');
        if (entry.readOnly || snapshot.readOnly) throw new Error('你对这篇文档只有阅读权限');
        const doc = documentIndex.byId.value.get(entry.id);
        if (doc?.conflict || doc?.missing) throw new Error('请先处理文档已有冲突');
        const editing = runtime.extensions?.()?.editing;
        if (editing?.isManaging(entry.id)) {
          throw new Error('当前协作会话暂不支持直接插入选区，请使用 documents.edit');
        }
        const ok = await pluginEditorBridge.applySelectionEdit(
          entry.id,
          String(params.text ?? ''),
          method === 'editor.insert' ? 'insert' : 'replace',
        );
        if (!ok) throw new Error('当前编辑器无法应用选区修改');
        assertInstance();
        const updated = documentIndex.byId.value.get(entry.id);
        const content = updated ? updated.content : (await adapter.read(entry.path)).content;
        return {
          fileId: entry.id,
          hash: await assistantHash(content),
          status: 'applied',
        };
      });
    }
    return serial(async () => {
      const assertCurrent = () => {
        assertInstance();
        if (!expected || workspace.value?.id !== expected) throw new Error(t('工作区已切换'));
      };
      assertCurrent();
      const attachmentService =
        runtime.attachments ??
        (runtime.native && adapter.mode === 'desktop' ? nativeAttachments : undefined);
      if (method === 'attachments.read')
        return pluginAttachmentReader.read(
          workspace.value!,
          params,
          attachmentService,
          assertCurrent,
        );
      if (method === 'attachments.write') {
        writable();
        if (!attachmentService?.importAttachment)
          throw new Error('当前宿主不支持写入附件');
        const parsed = parsePluginAttachmentWrite(params.request);
        const targetDocPath = parsed.documentPath || (pathScopes?.length ? `${pathScopes[0]!}note.md` : '');
        if (pathScopes?.length && !matchesPluginPathScopes(targetDocPath, pathScopes))
          throw new Error('附件目标目录不在插件授权目录范围内');
        const fileBytes = new Uint8Array(parsed.bytes);
        const uploadFile = new File([fileBytes], parsed.name, { type: parsed.mimeType });
        assertCurrent();
        const imported = await attachmentService.importAttachment(
          workspace.value!.id,
          targetDocPath,
          uploadFile,
          parsed.image,
        );
        assertCurrent();
        workspace.value = await adapter.refresh();
        return imported;
      }
      workspace.value = await adapter.refresh();
      await refreshObjects();
      assertCurrent();
      const current = workspace.value!;
      if (method === 'views.open') {
        await openPluginView(String(params.pluginId), String(params.viewId));
        return null;
      }
      if (method.endsWith('.query') || method === 'documents.search')
        return queryPluginData(method, params, pluginQueryPager, {
          workspace: current,
          objects: objects.value,
          relations: relations.value,
          drafts: documents.value,
          read: (path) => adapter.read(path),
          assertCurrent,
        });
      const file = () => {
        const entry = fileRegistry.value?.get(String(params.fileId));
        if (!entry || !isMarkdown(entry.path) || isWorkspaceInternalPath(entry.path))
          throw new Error('文档不存在或不可访问');
        if (!matchesPluginPathScopes(entry.path, pathScopes))
          throw new Error('文档路径不在插件授权目录范围内');
        return entry;
      };
      const text = (value: unknown) => {
        if (typeof value !== 'string' || value.length > 512000)
          throw new Error('插件文档内容无效或过大');
        return value;
      };
      if (method === 'documents.list')
        return current.files
          .filter(
            (row) =>
              row.kind === 'file' &&
              isMarkdown(row.path) &&
              !isWorkspaceInternalPath(row.path) &&
              matchesPluginPathScopes(row.path, pathScopes),
          )
          .map(({ id, path, name, readOnly }) => ({
            id,
            path,
            name,
            readOnly: current.readOnly || readOnly || false,
          }));
      if (method === 'documents.read') {
        const entry = file();
        const disk = await adapter.read(entry.path);
        const doc = documentIndex.byId.value.get(entry.id);
        if (doc?.conflict || doc?.missing) throw new Error('文档存在冲突，请先处理');
        const content = text(doc?.content ?? disk.content);
        return { id: entry.id, path: entry.path, content, hash: await assistantHash(content) };
      }
      if (method === 'documents.open') {
        await openInternal(file());
        ensureTabNavigation(String(params.fileId), String(params.fileId));
        touchNavigation();
        return null;
      }
      if (method === 'objects.list')
        return objects.value.map((record) => ({
          id: record.object.id,
          object: JSON.parse(JSON.stringify(record.object)),
          hash: record.snapshot.hash,
        }));
      if (method === 'objects.read') {
        const record = objects.value.find((row) => row.object.id === params.objectId);
        if (!record) throw new Error('对象不存在或不可访问');
        return {
          id: record.object.id,
          object: JSON.parse(JSON.stringify(record.object)),
          hash: record.snapshot.hash,
        };
      }
      if (method === 'relations.list') return JSON.parse(JSON.stringify(relations.value));
      writable();
      if (method === 'documents.create') {
        const path = text(params.path);
        if (!isMarkdown(path) || validatePath(path)) throw new Error('新文档路径无效');
        if (!matchesPluginPathScopes(path, pathScopes))
          throw new Error('新文档路径不在插件授权目录范围内');
        assertCurrent();
        await adapter.create(path, text(params.content));
        workspace.value = await adapter.refresh();
        const entry = fileRegistry.value?.at(path)!;
        return { id: entry.id, path };
      }
      if (method === 'documents.move') {
        const entry = file();
        if (entry.readOnly) throw new Error('你对这篇文档只有阅读权限');
        const destination = text(params.destination);
        if (!isMarkdown(destination) || validatePath(destination) || isWorkspaceInternalPath(destination))
          throw new Error('目标文档路径无效');
        if (!matchesPluginPathScopes(destination, pathScopes))
          throw new Error('目标路径不在插件授权目录范围内');
        if (destination === entry.path) return { id: entry.id, path: entry.path };
        if (current.files.some((row) => row.path === destination))
          throw new Error('目标路径已存在同名文件');
        if (!pluginRecord(params.base) || params.base.id !== entry.id || typeof params.base.content !== 'string')
          throw new Error('文档版本无效');
        const doc = documentIndex.byId.value.get(entry.id);
        if (doc?.conflict || doc?.missing) throw new Error('请先处理文档已有冲突');
        if (doc && dirty(doc)) throw new Error('文档存在未保存修改，请先保存后再移动');
        const disk = await adapter.read(entry.path);
        if (disk.content !== params.base.content)
          throw new Error('文档内容已变化，请重新读取后再移动');
        assertCurrent();
        if (adapter.changeFile) {
          const result = await adapter.changeFile({
            workspaceId: current.id,
            fileId: entry.id,
            path: entry.path,
            expectedHash: disk.hash,
            destination,
          });
          if (result.status !== 'saved') throw new Error('文档内容已变化或不存在，请重新读取后再移动');
        } else {
          await adapter.move(entry.path, destination, 'file');
        }
        assertCurrent();
        workspace.value = await adapter.refresh();
        if (doc) doc.path = destination;
        return { id: entry.id, path: destination };
      }
      if (method === 'documents.trash') {
        const entry = file();
        if (entry.readOnly) throw new Error('你对这篇文档只有阅读权限');
        if (!pluginRecord(params.base) || params.base.id !== entry.id || typeof params.base.content !== 'string')
          throw new Error('文档版本无效');
        const doc = documentIndex.byId.value.get(entry.id);
        if (doc?.conflict || doc?.missing) throw new Error('请先处理文档已有冲突');
        if (doc && dirty(doc)) throw new Error('文档存在未保存修改，请先保存后再移入回收站');
        const disk = await adapter.read(entry.path);
        if (disk.content !== params.base.content)
          throw new Error('文档内容已变化，请重新读取后再移入回收站');
        assertCurrent();
        if (adapter.changeFile) {
          const result = await adapter.changeFile({
            workspaceId: current.id,
            fileId: entry.id,
            path: entry.path,
            expectedHash: disk.hash,
          });
          if (result.status !== 'saved') throw new Error('文档内容已变化或不存在，请重新读取后再移入回收站');
        } else {
          await adapter.remove(entry.path);
        }
        assertCurrent();
        workspace.value = await adapter.refresh();
        if (doc) doc.missing = true;
        return { id: entry.id, path: entry.path, trashed: true };
      }
      if (method === 'documents.write') {
        const entry = file();
        if (entry.readOnly) throw new Error('你对这篇文档只有阅读权限');
        if (!pluginRecord(params.base) || params.base.id !== entry.id)
          throw new Error('文档版本无效');
        const base = text(params.base.content);
        const desired = text(params.content);
        const disk = await adapter.read(entry.path);
        const doc = documentIndex.byId.value.get(entry.id);
        if (doc?.conflict || doc?.missing) throw new Error('请先处理文档已有冲突');
        const live = doc
          ? mergeMarkdown(doc.base.content, doc.content, disk.content)
          : { clean: true, content: disk.content };
        const merged = mergeMarkdown(base, desired, live.content);
        if (!live.clean || !merged.clean) {
          const copyPath = entry.path.replace(
            /\.(md|markdown)$/i,
            `.plugin-conflict-${crypto.randomUUID().slice(0, 8)}.md`,
          );
          assertCurrent();
          await adapter.create(copyPath, desired);
          throw new Error(t('文档有重叠修改，插件版本已保存在 {0}', [copyPath]));
        }
        const editing = runtime.extensions?.()?.editing;
        if (editing?.isManaging(entry.id)) {
          if (!editing.applyPluginEdit)
            throw new Error('当前协作会话不支持插件编辑，请退出协作后重试');
          assertCurrent();
          const applied = await editing.applyPluginEdit(entry.id, live.content, merged.content);
          assertCurrent();
          return {
            id: entry.id,
            hash: await assistantHash(applied ?? merged.content),
            status: 'applied',
          };
        }
        if (doc && pluginEditorBridge && (await pluginEditorBridge.applyEdit(entry.id, doc.content, merged.content))) {
          return { id: entry.id, hash: await assistantHash(doc.content), status: 'applied' };
        }
        if (doc) {
          // The editor observes this value and applies a transaction through its existing bridge.
          doc.content = merged.content;
          doc.base = disk;
          assertCurrent();
          await saveInternal(doc);
          if (doc.error || doc.conflict || dirty(doc))
            throw new Error(doc.error ?? '插件修改已保留为草稿，请处理冲突后保存');
          return { id: entry.id, hash: await assistantHash(doc.content), status: 'saved' };
        }
        assertCurrent();
        const result = await adapter.write(entry.path, merged.content, disk.hash);
        if (result.status !== 'saved') {
          const copyPath = entry.path.replace(
            /\.(md|markdown)$/i,
            `.plugin-conflict-${crypto.randomUUID().slice(0, 8)}.md`,
          );
          await adapter.create(copyPath, desired);
          throw new Error(t('保存时文件发生变化，插件版本已保存在 {0}', [copyPath]));
        }
        return { id: entry.id, hash: await assistantHash(result.snapshot.content), status: 'saved' };
      }
      if (!capabilities.value.features.objectReferences) throw new Error('工作区对象功能已关闭');
      if (method === 'objects.create' || method === 'objects.update') {
        if (!pluginRecord(params.object)) throw new Error('对象无效');
        const draft = JSON.parse(JSON.stringify(params.object));
        if (method === 'objects.create') {
          if (!adapter.reserveObjectId) throw new Error('存储适配器不支持对象身份分配');
          const id = await adapter.reserveObjectId(objects.value.map((row) => row.object.id));
          const object = parseObject(JSON.stringify({ ...draft, version: 1, id }));
          validateObjectProperties(object.type, object.properties);
          assertCurrent();
          await adapter.create(
            `${objectDirectory}/${id}.tano.json`,
            JSON.stringify(object, null, 2) + '\n',
          );
          workspace.value = await adapter.refresh();
          await refreshObjects();
          return object;
        }
        if (!pluginRecord(params.base) || !pluginRecord(params.base.object))
          throw new Error('对象版本无效');
        const record = objects.value.find((row) => row.object.id === draft.id);
        if (!record) throw new Error('对象不存在');
        if (current.files.find((row) => row.path === record.path)?.readOnly)
          throw new Error('对象只读');
        const object = parseObject(JSON.stringify(draft));
        validateObjectProperties(object.type, object.properties);
        const merged = mergeObject(
          parseObject(JSON.stringify(params.base.object)),
          object,
          record.object,
        );
        const preserve = async () => {
          const path = `.tano/conflicts/plugin-object-${crypto.randomUUID()}.json`;
          assertCurrent();
          await adapter.create(
            path,
            JSON.stringify({ version: 1, pluginProposal: object, base: params.base }, null, 2) + '\n',
          );
          return path;
        };
        if (!merged)
          throw new Error(t('对象已有重叠修改，插件版本已保存在 {0}', [await preserve()]));
        let saved: ObjectRecord;
        try {
          assertCurrent();
          saved = await saveObject(adapter, record, merged);
        } catch (error) {
          throw new Error(t('{0} 插件版本已保存在 {1}', [String(error), await preserve()]));
        }
        workspace.value = await adapter.refresh();
        await refreshObjects();
        return saved.object;
      }
      if (method === 'relations.add' || method === 'relations.remove') {
        if (relationError.value) throw new Error(relationError.value);
        const relation = params.relation as WorkspaceRelation;
        validateRelation(relation, relationDefinitions.value);
        for (const endpoint of [relation.source, relation.target])
          if (!referenceTargets.value.some((target) => referenceKey(target) === referenceKey(endpoint)))
            throw new Error('关系端点不存在或不可访问');
        assertCurrent();
        await saveRelationChange(
          adapter,
          getRelationBase(),
          method === 'relations.add' ? { add: relation } : { remove: relation },
        );
        workspace.value = await adapter.refresh();
        await refreshObjects();
        return null;
      }
      throw new Error('不支持此插件 API');
    });
  }

  // OAuth, connections & package repository helpers
  async function startPluginOAuth(
    workspaceId: string,
    input: PluginOAuthInput,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    const installation = installedPlugins.value.find((item) => item.manifest.id === input.pluginId);
    const oauth = runtime.plugins?.connections?.oauth;
    if (
      workspace.value?.id !== workspaceId ||
      !oauth ||
      !installation?.enabled ||
      !installation.authorized ||
      installation.rule?.integrity !== input.integrity ||
      installation.manifest.manifestVersion !== 2 ||
      !installation.manifest.permissions.includes('connections') ||
      !installation.manifest.networkOrigins.includes(input.origin)
    )
      throw new Error('请先启用并授权此插件的当前版本');
    const flow = await oauth.start(workspaceId, input, signal);
    signal.throwIfAborted();
    if (workspace.value?.id !== workspaceId) throw new Error(t('工作区已切换'));
    return flow;
  }

  async function loadPluginConnections(workspaceId: string, signal: AbortSignal) {
    if (workspace.value?.id !== workspaceId || !runtime.plugins?.connections)
      throw new Error('当前工作区未提供凭据连接');
    const connections = await runtime.plugins.connections.list(workspaceId, signal);
    signal.throwIfAborted();
    if (workspace.value?.id !== workspaceId) throw new Error(t('工作区已切换'));
    return connections;
  }

  async function savePluginConnection(
    workspaceId: string,
    input: PluginConnectionInput,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    const installation = installedPlugins.value.find((item) => item.manifest.id === input.pluginId);
    if (
      workspace.value?.id !== workspaceId ||
      !runtime.plugins?.connections ||
      !installation?.enabled ||
      !installation.authorized ||
      installation.rule?.integrity !== input.integrity ||
      installation.manifest.manifestVersion !== 2 ||
      !installation.manifest.permissions.includes('connections') ||
      !installation.manifest.networkOrigins.includes(input.origin)
    )
      throw new Error('请先启用并授权此插件的当前版本');
    const connection = await runtime.plugins.connections.save(
      workspaceId,
      parsePluginConnectionInput(input),
      signal,
    );
    signal.throwIfAborted();
    if (workspace.value?.id !== workspaceId) throw new Error(t('工作区已切换'));
    return connection;
  }

  async function removePluginConnection(
    workspaceId: string,
    pluginId: string,
    origin: string,
    version: string,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    if (workspace.value?.id !== workspaceId || !runtime.plugins?.connections)
      throw new Error(t('工作区已切换'));
    await runtime.plugins.connections.remove(workspaceId, pluginId, origin, version, signal);
    signal.throwIfAborted();
  }

  const removePluginPackage = (integrity: string, expectedWorkspace: string) =>
    serial(async () => {
      if (workspace.value?.id !== expectedWorkspace || !canManagePlugins.value)
        throw new Error('工作区或管理权限已变化');
      if (!runtime.plugins?.repository?.remove) throw new Error('当前环境不支持云端包回收');
      await runtime.plugins.repository.remove(expectedWorkspace, integrity);
    });

  async function loadPluginPackageUsage(expectedWorkspace: string) {
    if (workspace.value?.id !== expectedWorkspace || !canManagePlugins.value)
      throw new Error('工作区或管理权限已变化');
    const usage = await runtime.plugins?.repository?.usage?.(expectedWorkspace);
    if (workspace.value?.id !== expectedWorkspace || !canManagePlugins.value)
      throw new Error('工作区或管理权限已变化');
    return usage;
  }

  function disposePlugins() {
    cancelActivePluginDialog('工作区已关闭');
    for (const timer of toastTimers.values()) clearTimeout(timer);
    toastTimers.clear();
    pluginToasts.value = [];
    pluginAttachmentReader.clear();
    clearTimeout(pluginEventTimer);
    overlayExtension()?.dispose?.();
    pluginServices.dispose();
    if (typeof window !== 'undefined') window.removeEventListener('storage', pluginStorageChanged);
  }

  return {
    pluginRuntime,
    pluginHostEnvironment,
    canManagePlugins,
    installedPlugins,
    installedPluginWorkspace,
    personalCodePluginPolicy,
    overlaySnapshot,
    setSafeMode: (enabled: boolean) => overlayExtension()?.setSafeMode(enabled),
    pluginHomeTabView,
    pluginNewTabView,
    pluginDevelopment,
    pluginServices,
    pluginHost,
    pluginExecutor,
    pluginDeveloper,
    pluginViews,
    pluginCommands,
    pluginFileHandlers,
    pluginSlashCommands,
    pluginCodeBlockRenderers,
    pluginDecorationsFor,
    pluginStatusBarItems,
    pluginContextProviders,
    activePluginSidebar,
    activeDocumentPluginSidebar,
    activePluginDialog,
    resolvePluginDialog,
    pluginToasts,
    dismissPluginToast,
    pluginSettingsRequest,
    pluginSettingsPages,
    pluginError,
    refreshPlugins,
    openPluginView,
    interactWithPlugin,
    invokePluginAssistantTool,
    queryPluginAssistantContext,
    setPluginAiRunner: (runner?: PluginAiRunner) => {
      pluginAiRunner = runner;
    },
    startPluginOAuth,
    loadPluginConnections,
    savePluginConnection,
    removePluginConnection,
    removePluginPackage,
    loadPluginPackageUsage,
    clearPluginLogs: (id: string) => pluginExecutor.clearLogs(id),
    userPluginIntegrities: () => pluginHost.userPluginIntegrities(),
    setPluginEditor: (
      bridge?:
        | PluginEditorBridge
        | ((id: string, before: string, after: string) => Promise<boolean>),
    ) => {
      pluginEditorBridge =
        typeof bridge === 'function' ? { applyEdit: bridge } : bridge;
    },
    disposePlugins,
  };
}
