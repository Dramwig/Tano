import { computed, watch, type ComputedRef, type Ref } from 'vue';
import {
  editableDocumentKind,
  type FileEntry,
  type FileRegistry,
  type FileSnapshot,
  type Workspace,
  type WorkspaceAdapter,
  type WorkspaceLayout,
  type WorkspaceSession,
} from '@tano/protocol';
import { isFeatureEnabled } from '../features';
import type { createDataTableController } from '../data-tables/data-table-controller';
import { isTableTab, tableFileId, tableTabId } from '../data-tables/data-tables';
import type { useDocumentIndex } from '../documents/document-index';
import { documentDirty as dirty, type OpenDocument } from '../documents/document-session';
import { layoutPanes, restoreLayout } from '../shell/pane-layout';
import { SessionJournal } from '../shell/session-journal';
import type { createWorkspaceTabsLayout } from './workspace-tabs-layout';
import type { Activity, WorkspaceLoadingState } from './workspace-types';

export interface WorkspaceSessionDeps {
  adapter: WorkspaceAdapter;
  workspace: Ref<Workspace | null>;
  fileRegistry: Ref<FileRegistry | null>;
  documents: Ref<OpenDocument[]>;
  documentIndex: ReturnType<typeof useDocumentIndex>;
  dataTables: ReturnType<typeof createDataTableController>;
  tabsLayout: ReturnType<typeof createWorkspaceTabsLayout>;
  tabIds: Ref<string[]>;
  tabAliases: Ref<Map<string, string>>;
  activeId: Ref<string>;
  workspaceLoading: Ref<WorkspaceLoadingState>;
  restoringDocuments: Ref<Record<string, string>>;
  sessionError: Ref<string>;
  dataTableFileId: (id: string) => string;
  loadWorkspacePart: (part: keyof WorkspaceLoadingState, load: () => Promise<unknown>) => Promise<void>;
  readOpenDocument: (file: FileEntry) => Promise<OpenDocument>;
  openInternal: (file: FileEntry, replaceId?: string, current?: () => boolean) => Promise<void>;
  hydrateDocumentLayout: (doc: OpenDocument) => Promise<void>;
  reconcile: (doc: OpenDocument, snapshot: FileSnapshot) => Promise<void>;
  saveInternal: (doc: OpenDocument) => Promise<void>;
  activity: (label: string, detail: string, kind: Activity['kind'], change?: Activity['change']) => void;
  report: (error: unknown) => void;
}

export function createWorkspaceSession(deps: WorkspaceSessionDeps) {
  const {
    adapter,
    workspace,
    fileRegistry,
    documents,
    documentIndex,
    dataTables,
    tabsLayout,
    tabIds,
    tabAliases,
    activeId,
    workspaceLoading,
    restoringDocuments,
    sessionError,
    dataTableFileId,
    loadWorkspacePart,
    readOpenDocument,
    openInternal,
    hydrateDocumentLayout,
    reconcile,
    saveInternal,
    activity,
    report,
  } = deps;

  let sessionReady = false;
  let sessionBlocked = false;

  const journal = new SessionJournal(
    (id, session) => adapter.saveSession!(id, session),
    (error) => {
      sessionError.value =
        error === undefined
          ? ''
          : `恢复草稿未写入：${String(error)}。文档仍会尝试正常保存。`;
    },
  );

  // Track only recoverable fields. Saving/error flags, undo stacks and plugin
  // state must not traverse/rewrite every open document on the input path.
  const recoveryDocuments = new WeakMap<
    OpenDocument,
    ComputedRef<WorkspaceSession['documents'][number]>
  >();
  const mainTabIds = computed(() =>
    layoutPanes(tabsLayout.layout.value).flatMap((pane) => pane.tabs),
  );
  const sessionDocuments = computed(() =>
    documents.value
      .filter((doc) => mainTabIds.value.some((id) => tabsLayout.tabTarget(id) === doc.id))
      .map((doc) => {
        let snapshot = recoveryDocuments.get(doc);
        if (!snapshot) {
          snapshot = computed(() => ({
            id: doc.id,
            path: doc.path,
            ...(dirty(doc) ? { draft: { content: doc.content, base: { ...doc.base } } } : {}),
          }));
          recoveryDocuments.set(doc, snapshot);
        }
        return snapshot.value;
      }),
  );
  const sessionTables = computed(() =>
    dataTables
      .drafts()
      .filter((draft) =>
        mainTabIds.value.some(
          (id) => tableFileId(tabsLayout.tabTarget(id)) === (draft.fileId ?? draft.id),
        ),
      ),
  );
  const sessionLayout = computed(
    () => JSON.parse(JSON.stringify(tabsLayout.layout.value)) as WorkspaceLayout,
  );
  const sessionPayload = computed<WorkspaceSession>(() => ({
    version: 1,
    activeId:
      layoutPanes(tabsLayout.layout.value).find(
        (pane) => pane.id === tabsLayout.windowLayouts.value.main.activePaneId,
      )?.activeId ?? '',
    tabs: [...new Set(mainTabIds.value.map(tabsLayout.tabTarget))],
    layout: sessionLayout.value,
    dataTables: sessionTables.value,
    documents: sessionDocuments.value,
  }));

  function queueSession() {
    if (!sessionReady || sessionBlocked || !workspace.value || !adapter.saveSession) return;
    journal.enqueue(workspace.value.id, sessionPayload.value);
  }

  const stopSessionWatch = watch(sessionPayload, queueSession, {
    flush: 'sync',
  });

  async function openInitialDocument(file: FileEntry) {
    restoringDocuments.value = { ...restoringDocuments.value, [file.id]: file.path };
    tabIds.value = [file.id];
    activeId.value = file.id;
    workspaceLoading.value.session = false;
    try {
      await openInternal(file);
    } finally {
      delete restoringDocuments.value[file.id];
    }
  }

  async function restoreSession(
    saved: WorkspaceSession,
    tablesReady: Promise<void>,
    objectsReady: Promise<void>,
  ) {
    tabAliases.value = new Map();
    const remapped = new Map<string, string>();
    const pendingDocs = saved.documents.flatMap((tab) => {
      const file = fileRegistry.value?.get(tab.id) ?? fileRegistry.value?.at(tab.path);
      if (!file && !tab.draft) return [];
      const id = file?.id ?? tab.id;
      remapped.set(tab.id, id);
      return [{ tab, file, id }];
    });
    restoringDocuments.value = Object.fromEntries(
      pendingDocs.map(({ tab, file, id }) => [id, file?.path ?? tab.path]),
    );
    const planned = new Set(pendingDocs.map(({ id }) => id));
    const requested = (saved.tabs ?? []).map((id) => remapped.get(id) ?? id);
    tabIds.value = [
      ...new Set([
        ...requested.filter(
          (id) =>
            planned.has(id) ||
            tabsLayout.isUtilityTab(id) ||
            id.startsWith('plugin:'),
        ),
        ...planned,
      ]),
    ];
    const restoredActive = remapped.get(saved.activeId) ?? saved.activeId;
    tabsLayout.layout.value = restoreLayout(saved.layout, tabIds.value, remapped);
    tabsLayout.activePaneId.value =
      tabsLayout.panes.value.find((pane) => pane.tabs.includes(restoredActive))?.id ??
      tabsLayout.panes.value[0].id;
    activeId.value = tabIds.value.includes(restoredActive)
      ? restoredActive
      : (tabIds.value[0] ?? '');
    workspaceLoading.value.session = false;

    const visible = new Set(tabsLayout.panes.value.map((pane) => pane.activeId));
    const tableRecovery = (async () => {
      await tablesReady;
      if (saved.dataTables?.length) {
        workspaceLoading.value.tables = true;
        await loadWorkspacePart('tables', () => dataTables.restore(saved.dataTables!));
      }
    })();

    const restoreDocument = async ({ tab, file, id }: (typeof pendingDocs)[number]) => {
      try {
        if (!tab.draft) {
          if (file) {
            const doc = await readOpenDocument(file);
            if (!documentIndex.byId.value.has(id)) documents.value.push(doc);
          }
          return;
        }
        const restoredPath = file?.path ?? tab.path;
        const restoredKind = editableDocumentKind(restoredPath, isFeatureEnabled('codeFileEditing'));
        const doc: OpenDocument = {
          id: file?.id ?? tab.id,
          path: restoredPath,
          format: restoredKind === 'code' ? 'code' : 'markdown',
          content: tab.draft.content,
          base: tab.draft.base,
          saving: false,
          creating: file?.pendingCreation,
          missing: !file,
        };
        if (!doc.creating && doc.format !== 'code') await hydrateDocumentLayout(doc);
        documents.value.push(doc);
        activity('已恢复未保存草稿', doc.path, 'file');
        if (file) {
          try {
            if (!doc.creating) await reconcile(doc, await adapter.read(file.path));
            await saveInternal(documentIndex.byId.value.get(doc.id)!);
          } catch (error) {
            doc.error = String(error);
            report(error);
          }
        } else doc.error = '原文件已不存在，恢复草稿已保留，请另存副本';
      } catch (error) {
        report(error);
      } finally {
        delete restoringDocuments.value[id];
      }
    };

    const priority = (id: string) => (id === restoredActive ? 2 : Number(visible.has(id)));
    const queue = [...pendingDocs].sort((a, b) => priority(b.id) - priority(a.id));
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) await restoreDocument(next);
    };
    await Promise.all([
      tableRecovery,
      objectsReady,
      ...Array.from({ length: Math.min(4, queue.length) }, worker),
    ]);

    for (const id of saved.tabs ?? [])
      if (isTableTab(id))
        remapped.set(id, tableTabId(dataTableFileId(tableFileId(id))));
    const byId = new Map(documents.value.map((doc) => [doc.id, doc]));
    documents.value = pendingDocs
      .map(({ id }) => byId.get(id))
      .filter((doc): doc is OpenDocument => !!doc);
    const restored = saved.tabs
      ?.map((id) => remapped.get(id) ?? id)
      .filter(
        (id) =>
          tabsLayout.isUtilityTab(id) || documents.value.some((doc) => doc.id === id),
      );
    tabIds.value = [...new Set([...(restored ?? []), ...documents.value.map((doc) => doc.id)])];
    const currentActive = remapped.get(activeId.value) ?? activeId.value;
    tabsLayout.layout.value = restoreLayout(tabsLayout.layout.value, tabIds.value, remapped);
    tabsLayout.activePaneId.value =
      tabsLayout.panes.value.find((pane) => pane.tabs.includes(currentActive))?.id ??
      tabsLayout.panes.value[0].id;
    activeId.value = tabIds.value.includes(currentActive)
      ? currentActive
      : (tabIds.value[0] ?? '');
    for (const tabId of tabIds.value) tabsLayout.ensureTabNavigation(tabId, tabId);
    tabsLayout.touchNavigation();
  }

  return {
    journal,
    isReady: () => sessionReady,
    setReady: (ready: boolean) => { sessionReady = ready; },
    setBlocked: (blocked: boolean) => { sessionBlocked = blocked; },
    queueSession,
    stopSessionWatch,
    openInitialDocument,
    restoreSession,
  };
}
