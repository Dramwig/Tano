import { computed, ref, shallowRef, watch, type Ref } from 'vue';
import {
  dataTableName,
  FileRegistry,
  isMarkdown,
  type FileEntry,
  type Workspace,
  type WorkspaceLayout,
} from '@tano/protocol';
import { CALENDAR_TAB_ID } from '../plans/calendar';
import type { createDataTableController } from '../data-tables/data-table-controller';
import { isTableTab, tableFileId, tableTabId } from '../data-tables/data-tables';
import { GRAPH_TAB_ID } from '../documents/document-graph';
import type { useDocumentIndex } from '../documents/document-index';
import { documentDirty as dirty, type OpenDocument } from '../documents/document-session';
import { recordHelpCompleted } from '../help/help-checklist';
import { t } from '../i18n/i18n';
import { dockLayout, layoutPanes, reconcileLayout, type PaneDrop } from '../shell/pane-layout';
import { bundledPluginCatalog } from '../plugins/plugin-catalog';
import { pluginViewKey, type PluginWorkbenchView } from '../plugins/workbench';
import type { WorkbenchViewTab } from '../runtime';
import { useTabNavigation } from '../tabs/tab-navigation';
import {
  closeWindowLayout,
  moveTabToNewWindow,
  moveWindowTab,
  newWindowLayout,
  type WindowLayouts,
} from '../windows/layout';
import { PLUGINS_TAB_ID, type InstalledObjectPlugin } from '../plugins/workspace-plugins';
import type { WorkspaceViewRecord } from '../workspace/workspace-views';
import type { DocumentTab } from './workspace';

export interface WorkspaceTabsLayoutDeps {
  workspace: Ref<Workspace | null>;
  fileRegistry: Ref<FileRegistry | null>;
  documents: Ref<OpenDocument[]>;
  documentIndex: ReturnType<typeof useDocumentIndex>;
  dataTables: ReturnType<typeof createDataTableController>;
  workspaceViews: Ref<WorkspaceViewRecord[]>;
  installedPlugins: Ref<InstalledObjectPlugin[]>;
  pluginViews: Ref<PluginWorkbenchView[]>;
  activePluginSidebar: Ref<string>;
  workspaceLoading: Ref<{
    files: boolean;
    session: boolean;
    settings: boolean;
    tables: boolean;
    plugins: boolean;
    objects: boolean;
    views: boolean;
    relations: boolean;
    capabilities: boolean;
  }>;
  restoringDocuments: Ref<Record<string, string>>;
  tabIds: Ref<string[]>;
  tabAliases: Ref<Map<string, string>>;
  activeId: Ref<string>;
  busy: Ref<boolean>;
  displayPath: (file: Pick<FileEntry, 'id' | 'path'>) => string;
  layoutPending: (doc: OpenDocument) => boolean;
  flush: () => Promise<boolean>;
  close: (id: string) => Promise<void>;
  openAttachment: (
    file: FileEntry,
    options?: { newTab?: boolean; historyIndex?: number },
  ) => Promise<void>;
  openPageTab: (
    id: string,
    options?: { newTab?: boolean; historyIndex?: number; target?: string; current?: () => boolean },
  ) => Promise<boolean>;
  openFile: (file: FileEntry, options?: { historyIndex?: number }) => Promise<void>;
}

export function createWorkspaceTabsLayout(deps: WorkspaceTabsLayoutDeps) {
  const {
    workspace,
    fileRegistry,
    documents,
    documentIndex,
    dataTables,
    workspaceViews,
    installedPlugins,
    pluginViews,
    activePluginSidebar,
    workspaceLoading,
    restoringDocuments,
    tabIds,
    tabAliases,
    activeId,
    busy,
    displayPath,
    layoutPending,
    flush,
    close,
    openAttachment,
    openPageTab,
    openFile,
  } = deps;

  const views = shallowRef<ReadonlyMap<string, WorkbenchViewTab>>(new Map());
  const workspaceViewTabPrefix = 'workspace-view:';
  const workspaceViewTabId = (id: string) => `${workspaceViewTabPrefix}${id}`;
  const workspaceViewId = (id: string) =>
    id.startsWith(workspaceViewTabPrefix) ? id.slice(workspaceViewTabPrefix.length) : undefined;
  const isWorkspaceViewTab = (id: string) => !!workspaceViewId(id);
  const hasWorkspaceViewTab = (id: string) => {
    const viewId = workspaceViewId(id);
    return viewId !== undefined && workspaceViews.value.some((record) => record.view.id === viewId);
  };
  const isDirectoryTab = (id: string) => id.startsWith('directory:');
  function directoryForTab(id: string) {
    if (!isDirectoryTab(id)) return undefined;
    if (id === 'directory:/') return { path: '', name: workspace.value?.name ?? '', missing: false };
    const entry = workspace.value?.files.find(
      (file) => file.id === id.slice('directory:'.length) && file.kind === 'directory',
    );
    return {
      path: entry?.path ?? '',
      name: entry?.name ?? '文件夹不可用',
      missing: entry?.kind !== 'directory',
    };
  }
  const pluginDetailManifest = (id: string) =>
    id.startsWith('plugin:')
      ? (installedPlugins.value.find((item) => `plugin:${item.manifest.id}` === id)?.manifest ??
        bundledPluginCatalog.find((item) => `plugin:${item.manifest.id}` === id)?.manifest)
      : undefined;
  const wordPreviewTab = pluginViewKey('word-preview', 'document');
  const presentationPreviewTab = pluginViewKey('presentation-preview', 'slides');
  const attachmentForTab = (id: string) =>
    id.startsWith('attachment:') ? fileRegistry.value?.get(id.slice('attachment:'.length)) : undefined;
  const isNavigationPage = (id: string) =>
    (isDirectoryTab(id) && !directoryForTab(id)?.missing) ||
    !!pluginDetailManifest(id) ||
    id === GRAPH_TAB_ID ||
    id === PLUGINS_TAB_ID ||
    isTableTab(id) ||
    hasWorkspaceViewTab(id) ||
    id.startsWith('attachment:') ||
    id === wordPreviewTab ||
    id === presentationPreviewTab;
  const isBuiltinTab = (id: string) =>
    isDirectoryTab(id) ||
    id.startsWith('blank:') ||
    id.startsWith('attachment:') ||
    !!pluginDetailManifest(id) ||
    id === GRAPH_TAB_ID ||
    id === PLUGINS_TAB_ID ||
    id === CALENDAR_TAB_ID ||
    isTableTab(id) ||
    hasWorkspaceViewTab(id);
  const isUtilityTab = (id: string) =>
    isBuiltinTab(id) ||
    views.value.has(id) ||
    pluginViews.value.some((view) => view.key === id && view.location === 'tab');

  let activationRevision = 0;
  watch(
    activeId,
    () => {
      activationRevision++;
    },
    { flush: 'sync' },
  );

  const tabTarget = (id: string) => tabAliases.value.get(id) ?? id;
  function newTabAlias(target: string) {
    const id = isTableTab(target)
      ? `${target}:${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
      : `tab:${crypto.randomUUID()}`;
    tabAliases.value = new Map(tabAliases.value).set(id, target);
    return id;
  }
  function removeTabAlias(id: string) {
    if (!tabAliases.value.has(id)) return;
    const next = new Map(tabAliases.value);
    next.delete(id);
    tabAliases.value = next;
  }

  function registerViews(definitions: readonly WorkbenchViewTab[]) {
    const next = new Map<string, WorkbenchViewTab>();
    for (const { id, label, icon, scope, detachable, detachBlockedMessage } of definitions) {
      if (!/^view:[a-z][a-z0-9-]*$/.test(id) || isBuiltinTab(id) || next.has(id) || !label.trim())
        throw new Error(t('无效或重复的扩展视图：{0}', [id]));
      next.set(id, { id, label, icon, scope, detachable, detachBlockedMessage });
    }
    // Register before session restoration. Refuse to strand an already open view.
    if (tabIds.value.some((id) => views.value.has(id) && !next.has(id)))
      throw new Error('请先关闭扩展标签页，再移除视图');
    views.value = next;
  }

  // Split & multi-window pane layouts
  const windowLayouts = ref<WindowLayouts>({ main: newWindowLayout() });
  const layout = computed({
    get: () => windowLayouts.value.main.layout,
    set: (value: WorkspaceLayout) => {
      windowLayouts.value.main.layout = value;
    },
  });
  const panes = computed(() =>
    Object.values(windowLayouts.value).flatMap((state) => layoutPanes(state.layout)),
  );
  const activePaneId = ref(layout.value.id);
  watch(
    activePaneId,
    (id) => {
      const owner = Object.values(windowLayouts.value).find((state) =>
        layoutPanes(state.layout).some((pane) => pane.id === id),
      );
      if (owner) owner.activePaneId = id;
    },
    { flush: 'sync' },
  );
  const paneDrop = ref<PaneDrop>();
  // Presentation only: keep the real tab/session until its new window is ready.
  const detachingTabId = ref('');
  let changingLayout = false;

  watch(
    () => [...tabIds.value],
    (ids, previous) => {
      if (changingLayout) return;
      const owner =
        Object.entries(windowLayouts.value).find(([, state]) =>
          layoutPanes(state.layout).some((pane) => pane.id === activePaneId.value),
        )?.[0] ?? 'main';
      const owned = new Set(panes.value.flatMap((pane) => pane.tabs));
      const additions = ids.filter((id) => !owned.has(id));
      const next: WindowLayouts = {};
      for (const [id, state] of Object.entries(windowLayouts.value)) {
        const priorTabs = layoutPanes(state.layout).flatMap((pane) => pane.tabs);
        const remaining = ids.filter(
          (tab) => priorTabs.includes(tab) || (id === owner && additions.includes(tab)),
        );
        if (id !== 'main' && !remaining.length) continue;
        const updated = reconcileLayout(
          state.layout,
          remaining,
          previous.filter((tab) => priorTabs.includes(tab)),
          state.activePaneId,
        );
        next[id] = {
          layout: updated,
          activePaneId: layoutPanes(updated).some((pane) => pane.id === state.activePaneId)
            ? state.activePaneId
            : layoutPanes(updated)[0].id,
        };
      }
      windowLayouts.value = next;
      if (!panes.value.some((pane) => pane.id === activePaneId.value))
        activePaneId.value = panes.value[0].id;
    },
    { flush: 'sync' },
  );

  watch(
    activeId,
    (id) => {
      const pane = panes.value.find((pane) => pane.tabs.includes(id));
      if (pane) {
        pane.activeId = id;
        activePaneId.value = pane.id;
        const owner = Object.values(windowLayouts.value).find((state) =>
          layoutPanes(state.layout).some((item) => item.id === pane.id),
        );
        if (owner) owner.activePaneId = pane.id;
      }
    },
    { flush: 'sync' },
  );

  function focusPane(id: string) {
    const pane = panes.value.find((pane) => pane.id === id);
    if (!pane) return;
    activePaneId.value = pane.id;
    const owner = Object.values(windowLayouts.value).find((state) =>
      layoutPanes(state.layout).some((item) => item.id === id),
    );
    if (owner) owner.activePaneId = id;
    activeId.value = pane.activeId;
  }

  function applyWindowLayouts(next: WindowLayouts, selected: string) {
    changingLayout = true;
    try {
      windowLayouts.value = next;
      tabIds.value = panes.value.flatMap((pane) => pane.tabs);
      const pane = panes.value.find((pane) => pane.tabs.includes(selected));
      if (pane) {
        activeId.value = selected;
        focusPane(pane.id);
      }
    } finally {
      changingLayout = false;
    }
  }

  function dockTab(id: string, drop: PaneDrop) {
    const owner = Object.entries(windowLayouts.value).find(([, state]) =>
      layoutPanes(state.layout).some((pane) => pane.id === drop.paneId),
    )?.[0];
    const source = Object.entries(windowLayouts.value).find(([, state]) =>
      layoutPanes(state.layout).some((pane) => pane.tabs.includes(id)),
    )?.[0];
    if (owner && (owner !== 'main' || source !== 'main')) {
      applyWindowLayouts(moveWindowTab(windowLayouts.value, id, owner, drop), id);
      paneDrop.value = undefined;
      return;
    }
    const before = layout.value;
    const priorActive = activeId.value;
    const origin = panes.value.find((pane) => pane.tabs.includes(id));
    const next = dockLayout(layout.value, id, drop);
    paneDrop.value = undefined;
    if (next === layout.value) return;
    changingLayout = true;
    layout.value = next;
    tabIds.value = panes.value.flatMap((pane) => pane.tabs);
    const pane = panes.value.find((pane) => pane.tabs.includes(id))!;
    activePaneId.value = pane.id;
    activeId.value = id;
    changingLayout = false;
    const applied = JSON.stringify(layout.value);
    if (layoutPanes(before).length < panes.value.length) recordHelpCompleted('split-view');
    // A receiving window can undo a move if the source fails to close. Never
    // overwrite layout changes made by the user while that acknowledgement ran.
    return () => {
      if (JSON.stringify(layout.value) !== applied) {
        if (origin && panes.value.some((pane) => pane.id === origin.id))
          dockTab(id, { paneId: origin.id, side: 'center', index: origin.tabs.indexOf(id) });
        return;
      }
      changingLayout = true;
      layout.value = before;
      tabIds.value = panes.value.flatMap((pane) => pane.tabs);
      activeId.value = priorActive;
      activePaneId.value =
        panes.value.find((pane) => pane.tabs.includes(priorActive))?.id ?? panes.value[0].id;
      changingLayout = false;
    };
  }

  function resizeSplit(id: string, ratio: number) {
    if (!Number.isFinite(ratio)) return;
    function resize(node: WorkspaceLayout): void {
      if (node.kind !== 'split') return;
      if (node.id === id) node.ratio = Math.max(0.1, Math.min(0.9, ratio));
      else {
        resize(node.first);
        resize(node.second);
      }
    }
    for (const state of Object.values(windowLayouts.value)) resize(state.layout);
  }

  function moveTabToWindow(id: string, targetId: string, drop: PaneDrop) {
    applyWindowLayouts(moveWindowTab(windowLayouts.value, id, targetId, drop), id);
  }

  function moveTabToAuxiliaryWindow(id: string, windowId: string) {
    applyWindowLayouts(moveTabToNewWindow(windowLayouts.value, id, windowId), id);
  }

  async function closeAuxiliaryWindow(id: string) {
    if (id === 'main') return false;
    const state = windowLayouts.value[id];
    if (!state) return true;
    if (!(await flush())) return false;
    for (const tab of layoutPanes(state.layout).flatMap((pane) => pane.tabs)) {
      await close(tab);
      if (tabIds.value.includes(tab)) return false;
    }
    windowLayouts.value = closeWindowLayout(windowLayouts.value, id);
    return true;
  }

  // Tab navigation history
  const {
    ensure: ensureTabNavigation,
    reset: resetTabNavigation,
    record: recordTabNavigation,
    remove: removeTabNavigation,
    touch: touchNavigation,
    canNavigate: canNavigateHistory,
    navigate: navigateHistory,
    canGoBack,
    canGoForward,
  } = useTabNavigation({
    activeId: () => activeId.value,
    busy: () => busy.value,
    available: (id) => {
      if (id.startsWith('attachment:')) return !!attachmentForTab(id);
      if (id === wordPreviewTab || id === presentationPreviewTab)
        return pluginViews.value.some((view) => view.key === id);
      const file = fileRegistry.value?.get(id);
      return (
        isNavigationPage(id) ||
        pluginViews.value.some((view) => view.key === id && view.location === 'tab') ||
        tabIds.value.includes(id) ||
        !!(file && file.kind === 'file' && isMarkdown(file.path))
      );
    },
    focusPane: (id) => {
      if (!panes.value.some((pane) => pane.id === id)) return false;
      focusPane(id);
      return true;
    },
    open: async (id, historyIndex) => {
      const attachment = attachmentForTab(id);
      if (attachment) await openAttachment(attachment, { historyIndex });
      else if (
        isNavigationPage(id) ||
        pluginViews.value.some((view) => view.key === id && view.location === 'tab')
      )
        await openPageTab(id, { historyIndex });
      else {
        const file = fileRegistry.value?.get(id);
        if (file) await openFile(file, { historyIndex });
      }
    },
  });
  watch(() => workspace.value?.id, resetTabNavigation, { flush: 'sync' });

  // Prune tabs whose backing plugin/workspace view disappeared
  watch(installedPlugins, (items, previous) => {
    if (workspaceLoading.value.plugins) return;
    const removed = new Set(
      previous
        .filter((item) => !items.some((next) => next.manifest.id === item.manifest.id))
        .map((item) => `plugin:${item.manifest.id}`),
    );
    for (const id of removed) {
      removeTabNavigation(id);
    }
    tabIds.value = tabIds.value.filter((id) => !removed.has(tabTarget(id)));
    if (removed.has(tabTarget(activeId.value))) activeId.value = tabIds.value[0] ?? '';
  });
  watch(pluginViews, (definitions) => {
    if (workspaceLoading.value.plugins) return;
    const keys = new Set([
      ...definitions.filter((view) => view.location === 'tab').map((view) => view.key),
      ...installedPlugins.value.map((item) => `plugin:${item.manifest.id}`),
      ...bundledPluginCatalog.map((item) => `plugin:${item.manifest.id}`),
    ]);
    const remaining = tabIds.value.filter((id) => !id.startsWith('plugin:') || keys.has(id));
    if (remaining.length !== tabIds.value.length) {
      for (const id of tabIds.value) if (!remaining.includes(id)) removeTabNavigation(id);
      tabIds.value = remaining;
    }
    if (activeId.value.startsWith('plugin:') && !keys.has(activeId.value))
      activeId.value = tabIds.value[0] ?? '';
    if (!definitions.some((view) => view.location === 'sidebar' && view.key === activePluginSidebar.value))
      activePluginSidebar.value = '';
  });
  watch(workspaceViews, (definitions) => {
    if (workspaceLoading.value.views) return;
    const keys = new Set(definitions.map((record) => workspaceViewTabId(record.view.id)));
    const remaining = tabIds.value.filter((id) => !isWorkspaceViewTab(id) || keys.has(id));
    if (remaining.length !== tabIds.value.length) {
      for (const id of tabIds.value) if (!remaining.includes(id)) removeTabNavigation(id);
      tabIds.value = remaining;
      if (isWorkspaceViewTab(activeId.value) && !keys.has(activeId.value))
        activeId.value = tabIds.value[0] ?? '';
    }
  });

  const active = computed(() => documentIndex.byId.value.get(tabTarget(activeId.value)));
  const tabs = computed<DocumentTab[]>(() =>
    tabIds.value.map((id) => {
      const targetId = tabTarget(id);
      const document = documentIndex.byId.value.get(targetId);
      const pendingPath = restoringDocuments.value[targetId];
      const attachmentPreview = id.startsWith('attachment:');
      const attachment = attachmentForTab(id);
      const table = dataTables.records.value.find(
        (record) => tableTabId(record.fileId) === targetId,
      );
      const tableFile = isTableTab(targetId)
        ? fileRegistry.value?.get(tableFileId(targetId))
        : undefined;
      const tablePath = tableFile ? displayPath(tableFile) : table?.path;
      const directory = directoryForTab(targetId);
      const workspaceView = workspaceViews.value.find(
        (record) => workspaceViewTabId(record.view.id) === targetId,
      );
      return {
        id,
        pluginDetail: pluginDetailManifest(targetId),
        directory,
        path: directory
          ? directory.path
          : document
            ? displayPath(document)
            : (pendingPath ??
              (attachment
                ? displayPath(attachment)
                : tableFile
                  ? displayPath(tableFile)
                  : (workspaceView?.path ?? tablePath ?? (attachmentPreview ? '附件不可用' : '')))),
        blank: id.startsWith('blank:'),
        graph: id === GRAPH_TAB_ID,
        plugins: id === PLUGINS_TAB_ID,
        calendar: id === CALENDAR_TAB_ID,
        view: views.value.get(id),
        workspaceView,
        pluginView: pluginViews.value.find((view) => view.key === id && view.location === 'tab'),
        document,
        attachmentPreview,
        attachment,
        ...(isTableTab(targetId)
          ? {
              dataTable: {
                name: tablePath ? dataTableName(tablePath) : '数据表不可用',
                dirty: !!table && dataTables.dirty(table),
                icon: table?.draft.icon,
              },
            }
          : {}),
      };
    }),
  );

  function activateTab(id: string, replaceId?: string, doc?: OpenDocument) {
    if (tabIds.value.includes(id)) {
      const sourcePane = panes.value.find((pane) => pane.tabs.includes(id));
      const targetPane = panes.value.find((pane) => pane.tabs.includes(replaceId ?? ''));
      if (sourcePane && targetPane && sourcePane.id !== targetPane.id) {
        activeId.value = id;
        return;
      }
      const sourceIndex = tabIds.value.indexOf(id);
      const targetIndex = replaceId ? tabIds.value.indexOf(replaceId) : -1;
      if (sourceIndex >= 0 && targetIndex >= 0 && sourceIndex !== targetIndex) {
        const reordered = [...tabIds.value];
        if (replaceId?.startsWith('blank:')) {
          reordered[targetIndex] = id;
          reordered.splice(sourceIndex, 1);
        } else {
          [reordered[targetIndex], reordered[sourceIndex]] = [
            reordered[sourceIndex],
            reordered[targetIndex],
          ];
        }
        const byId = new Map(documents.value.map((entry) => [entry.id, entry]));
        const ordered = reordered
          .map(tabTarget)
          .filter((tabId, index, all) => all.indexOf(tabId) === index)
          .map((tabId) => byId.get(tabId))
          .filter((entry): entry is OpenDocument => !!entry);
        documents.value = [...ordered, ...documents.value.filter((entry) => !ordered.includes(entry))];
        tabIds.value = reordered;
      }
    } else {
      const replaceIndex = replaceId ? tabIds.value.indexOf(replaceId) : -1;
      if (replaceIndex >= 0) {
        const oldDocumentIndex = documents.value.findIndex((entry) => entry.id === replaceId);
        const oldDocument = documents.value[oldDocumentIndex];
        if (
          oldDocument &&
          (dirty(oldDocument) ||
            layoutPending(oldDocument) ||
            oldDocument.conflict ||
            oldDocument.missing)
        )
          throw new Error('当前文档仍有未保存的修改或冲突，标签页未被替换。');
        if (doc) {
          const insertIndex = tabIds.value
            .slice(0, replaceIndex)
            .filter((tabId) => !isUtilityTab(tabId)).length;
          if (oldDocumentIndex >= 0) documents.value.splice(oldDocumentIndex, 1, doc);
          else documents.value.splice(insertIndex, 0, doc);
        } else if (oldDocumentIndex >= 0) documents.value.splice(oldDocumentIndex, 1);
        tabIds.value.splice(replaceIndex, 1, id);
      } else {
        if (doc) documents.value.push(doc);
        tabIds.value.push(id);
      }
    }
    activeId.value = id;
  }

  function moveDocument(id: string, targetId: string, side: 'before' | 'after') {
    if (id === targetId) return;
    if (!tabIds.value.includes(id) || !tabIds.value.includes(targetId)) return;
    const reordered = tabIds.value.filter((tabId) => tabId !== id);
    const targetIndex = reordered.indexOf(targetId);
    reordered.splice(targetIndex + (side === 'after' ? 1 : 0), 0, id);
    if (reordered.every((tabId, index) => tabId === tabIds.value[index])) return;
    const byId = new Map(documents.value.map((doc) => [doc.id, doc]));
    const ordered = reordered
      .map(tabTarget)
      .filter((tabId, index, all) => all.indexOf(tabId) === index)
      .map((tabId) => byId.get(tabId))
      .filter((doc): doc is OpenDocument => !!doc);
    documents.value = [...ordered, ...documents.value.filter((doc) => !ordered.includes(doc))];
    tabIds.value = reordered;
  }

  function placeTab(id: string, index: number) {
    if (!tabIds.value.includes(id)) return;
    const reordered = tabIds.value.filter((tabId) => tabId !== id);
    reordered.splice(Math.max(0, Math.min(index, reordered.length)), 0, id);
    if (reordered.every((tabId, position) => tabId === tabIds.value[position])) return;
    const byId = new Map(documents.value.map((doc) => [doc.id, doc]));
    const ordered = reordered
      .map(tabTarget)
      .filter((tabId, idx, all) => all.indexOf(tabId) === idx)
      .map((tabId) => byId.get(tabId))
      .filter((doc): doc is OpenDocument => !!doc);
    documents.value = [...ordered, ...documents.value.filter((doc) => !ordered.includes(doc))];
    tabIds.value = reordered;
  }

  function createBlankTab() {
    if (!workspace.value) return;
    const id = `blank:${crypto.randomUUID()}`;
    tabIds.value.push(id);
    activeId.value = id;
    ensureTabNavigation(id, id);
    touchNavigation();
    return id;
  }

  function openCalendarTab() {
    if (!workspace.value) return;
    if (!tabIds.value.includes(CALENDAR_TAB_ID)) tabIds.value.push(CALENDAR_TAB_ID);
    activeId.value = CALENDAR_TAB_ID;
    ensureTabNavigation(CALENDAR_TAB_ID);
    touchNavigation();
  }

  function openViewTab(id: string) {
    if (!views.value.has(id)) throw new Error(t('扩展视图未注册：{0}', [id]));
    if (!workspace.value && views.value.get(id)?.scope !== 'account') return;
    if (!tabIds.value.includes(id)) tabIds.value.push(id);
    activeId.value = id;
    ensureTabNavigation(id);
    touchNavigation();
  }

  return {
    views,
    workspaceViewTabId,
    isWorkspaceViewTab,
    pluginDetailManifest,
    wordPreviewTab,
    presentationPreviewTab,
    attachmentForTab,
    isNavigationPage,
    isUtilityTab,
    registerViews,
    tabIds,
    tabAliases,
    activeId,
    getActivationRevision: () => activationRevision,
    tabTarget,
    newTabAlias,
    removeTabAlias,
    windowLayouts,
    layout,
    panes,
    activePaneId,
    paneDrop,
    detachingTabId,
    focusPane,
    dockTab,
    resizeSplit,
    moveTabToWindow,
    moveTabToAuxiliaryWindow,
    closeAuxiliaryWindow,
    ensureTabNavigation,
    resetTabNavigation,
    recordTabNavigation,
    removeTabNavigation,
    touchNavigation,
    canNavigateHistory,
    navigateHistory,
    canGoBack,
    canGoForward,
    active,
    tabs,
    activateTab,
    moveDocument,
    placeTab,
    createBlankTab,
    openCalendarTab,
    openViewTab,
  };
}
