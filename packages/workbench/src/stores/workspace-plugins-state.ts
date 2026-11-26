import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue';
import type { WorkspaceCapabilities } from '@tano/editor/runtime';
import {
  FileRegistry,
  isMarkdown,
  isWorkspaceInternalPath,
  parsePluginConnectionInput,
  type FileEntry,
  type FileSnapshot,
  type PluginConnectionInput,
  type PluginHostEnvironment,
  type PluginOAuthInput,
  type ReferenceTarget,
  type RelationTypeDefinition,
  type Workspace,
  type WorkspaceAdapter,
  type WorkspacePersonalPluginPolicy,
  type WorkspaceRelation,
} from '@tano/protocol';
import workbenchPackage from '../../package.json';
import type { useDocumentIndex } from '../documents/document-index';
import type { OpenDocument } from '../documents/document-session';
import { t } from '../i18n/i18n';
import { PluginAttachmentReader } from '../plugins/attachment-reader';
import { listActivePluginContextProviders } from '../plugins/assistant-bridge';
import { PluginQueryPager, pluginChanges } from '../plugins/data';
import type { PluginDevelopmentState } from '../plugins/development';
import type { PluginRuntimeState } from '../plugins/host';
import { canManageWorkspacePlugins } from '../plugins/policy';
import {
  dispatchPluginRpcCall,
  type PluginAiRunner,
  type PluginEditorBridge,
} from '../plugins/plugin-rpc-router';
import {
  createPluginUiDialogs,
  type PluginUiDialogRequest,
  type PluginUiToastItem,
} from '../plugins/plugin-ui-dialogs';
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
import { resolveOverlayExtension, type WorkbenchOverlaySnapshot, type WorkbenchRuntime } from '../runtime';
import type { ObjectRecord } from '../objects/workspace-objects';
import { WorkspacePluginRuntime } from '../plugins/workspace-plugin-runtime';
import { PLUGINS_TAB_ID, type InstalledObjectPlugin } from '../plugins/workspace-plugins';

export type { PluginUiDialogRequest, PluginUiToastItem, PluginEditorBridge };

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
  let pluginAiRunner: PluginAiRunner | undefined;
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
  const overlayExtension = () => resolveOverlayExtension(runtime);
  const overlaySnapshot = computed<WorkbenchOverlaySnapshot>(
    () => overlayExtension()?.snapshot ?? { safeMode: false },
  );
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

  const uiDialogs = createPluginUiDialogs();
  const {
    activePluginDialog,
    pluginToasts,
    cancelActivePluginDialog,
    resolvePluginDialog,
    dismissPluginToast,
    clearPluginToasts,
    showPluginToast,
    openPluginDialog,
  } = uiDialogs;

  const pluginCall = (
    method: string,
    params: Record<string, unknown>,
    assertInstance: () => void,
  ) =>
    dispatchPluginRpcCall(
      {
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
        pluginAttachmentReader,
        pluginQueryPager,
        getPluginEditorBridge: () => pluginEditorBridge,
        getPluginAiRunner: () => pluginAiRunner,
        openPluginDialog,
        showPluginToast,
        openPluginView,
        serial,
        writable,
        refreshObjects,
        openInternal,
        saveInternal,
        ensureTabNavigation,
        touchNavigation,
      },
      method,
      params,
      assertInstance,
    );

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
      clearPluginToasts();
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
    () => (workspace.value ? ([workspace.value.id, overlaySnapshot.value.safeMode] as const) : null),
    (current, previous) => {
      if (current && previous && current[0] === previous[0] && current[1] !== previous[1] && workspace.value) {
        pluginExecutor.sync(workspace.value, installedPlugins.value, current[1]);
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
    clearPluginToasts();
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
