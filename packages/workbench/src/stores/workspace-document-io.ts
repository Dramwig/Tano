import type { Ref } from 'vue';
import {
  documentLayoutPath,
  isDataTableFilePath,
  isMarkdown,
  parentPath,
  parseDocumentLayout,
  validatePath,
  type FileEntry,
  type FileRegistry,
  type ReferenceTarget,
  type TableLayout,
  type Workspace,
  type WorkspaceAdapter,
} from '@tano/protocol';
import type { WorkspaceSettings } from '../workspace/workspace-settings';
import type { createWorkspaceAssistantBridge } from '../assistant/workspace-bridge';
import type { createDataTableController } from '../data-tables/data-table-controller';
import { isTableTab, tableTabId } from '../data-tables/data-tables';
import { GRAPH_TAB_ID } from '../documents/document-graph';
import type { useDocumentIndex } from '../documents/document-index';
import { documentDirty as dirty, type OpenDocument } from '../documents/document-session';
import { indexFolderHomes } from '../files/folder-home';
import type { optimisticFiles } from '../files/optimistic-files';
import { recordHelpCompleted } from '../help/help-checklist';
import type { createHelpEditQueue } from '../help/help-edit-queue';
import {
  resolvePluginFileHandler,
  type PluginWorkbenchFileHandler,
} from '../plugins/workbench';
import { PLUGINS_TAB_ID } from '../plugins/workspace-plugins';
import type { SessionJournal } from '../shell/session-journal';
import {
  DocumentLayoutConflict,
  layoutDirty,
  loadDocumentLayout,
  saveDocumentLayout,
} from '../workspace/workspace-document-layout';
import type { createWorkspaceFileOps } from './workspace-file-ops';
import type { createWorkspacePluginsState } from './workspace-plugins-state';
import type { createWorkspaceTabsLayout } from './workspace-tabs-layout';
import type { WorkspaceLifecycleHooks } from './workspace-types';

export interface WorkspaceDocumentIODeps {
  adapter: WorkspaceAdapter;
  workspace: Ref<Workspace | null>;
  fileRegistry: Ref<FileRegistry | null>;
  fileMutations: ReturnType<typeof optimisticFiles>;
  documents: Ref<OpenDocument[]>;
  documentIndex: ReturnType<typeof useDocumentIndex>;
  dataTables: ReturnType<typeof createDataTableController>;
  workspaceSettings: Ref<WorkspaceSettings>;
  referenceTargets: Ref<ReferenceTarget[]>;
  tabIds: Ref<string[]>;
  activeId: Ref<string>;
  busy: Ref<boolean>;
  openingDocuments: Ref<Record<string, { request: number; tabId: string }>>;
  plugins: ReturnType<typeof createWorkspacePluginsState>;
  tabsLayout: ReturnType<typeof createWorkspaceTabsLayout>;
  assistantBridge: ReturnType<typeof createWorkspaceAssistantBridge>;
  fileOps: ReturnType<typeof createWorkspaceFileOps>;
  helpEdits: ReturnType<typeof createHelpEditQueue>;
  journal: SessionJournal;
  hooks: WorkspaceLifecycleHooks;
  isDisposed: () => boolean;
  layoutPending: (doc: OpenDocument) => boolean;
  serial: <T>(task: () => Promise<T>) => Promise<T>;
  saveInternal: (doc: OpenDocument) => Promise<void>;
  report: (error: unknown) => void;
}

export function createWorkspaceDocumentIO(deps: WorkspaceDocumentIODeps) {
  const {
    adapter,
    workspace,
    fileRegistry,
    fileMutations,
    documents,
    documentIndex,
    dataTables,
    workspaceSettings,
    referenceTargets,
    tabIds,
    activeId,
    busy,
    openingDocuments,
    plugins,
    tabsLayout,
    assistantBridge,
    fileOps,
    helpEdits,
    journal,
    hooks,
    isDisposed,
    layoutPending,
    serial,
    saveInternal,
    report,
  } = deps;

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let fileOpenRevision = 0;

  function dataTableFileId(id: string) {
    if (workspace.value?.files.some((file) => file.id === id && isDataTableFilePath(file.path)))
      return id;
    return dataTables.records.value.find((record) => record.table.id === id)?.fileId ?? id;
  }

  async function openDataTable(
    id?: string,
    options?: { newTab?: boolean; historyIndex?: number },
  ) {
    if (!id) {
      tabsLayout.createBlankTab();
      return;
    }
    await openPageTab(tableTabId(dataTableFileId(id)), options);
  }

  async function createDataTable(template: 'blank' | 'parts' = 'blank', parent = '') {
    const id = await dataTables.create(template, undefined, parent);
    recordHelpCompleted('data-table');
    await openDataTable(id);
    return id;
  }

  async function renameDataTable(id: string, name: string) {
    const file = workspace.value?.files.find(
      (file) => file.id === id && isDataTableFilePath(file.path),
    );
    if (!file) throw new Error('数据表文件已不存在');
    const path = `${parentPath(file.path) ? `${parentPath(file.path)}/` : ''}${name.trim().normalize('NFC')}.table.json`;
    if (!name.trim() || /[\\/]/.test(name)) throw new Error('请输入有效的文件名称');
    const error = validatePath(path);
    if (error) throw new Error(error);
    if (path !== file.path) await fileOps.renameEntry(file, path);
  }

  async function hydrateDocumentLayout(doc: OpenDocument) {
    if (!workspace.value || !/^[0-9a-f]{6}$/.test(doc.id)) return;
    try {
      doc.tableLayout = await loadDocumentLayout(adapter, workspace.value, doc.id);
    } catch (error) {
      report(`无法读取表格布局，原文件已保留：${String(error)}`);
    }
  }

  async function saveTableLayout(doc: OpenDocument) {
    const state = doc.tableLayout;
    if (!state || !layoutDirty(state) || doc.missing || doc.conflict) return;
    const draft = JSON.stringify(state.file);
    if (state.conflict?.draft === draft) return;
    try {
      const saved = await saveDocumentLayout(adapter, state);
      state.base = saved.base;
      if (JSON.stringify(state.file) === draft) state.file = saved.file;
      state.error = undefined;
      state.conflict = undefined;
    } catch (error) {
      if (error instanceof DocumentLayoutConflict) state.conflict = { path: error.path, draft };
      state.error = String(error);
      report(error);
    }
  }

  function isMarkdownEntry(file: FileEntry): boolean {
    return file.kind === 'file' && isMarkdown(file.path);
  }

  async function readOpenDocument(file: FileEntry): Promise<OpenDocument> {
    const snapshot = await adapter.read(file.path);
    const doc: OpenDocument = {
      id: file.id,
      path: file.path,
      content: snapshot.content,
      base: snapshot,
      saving: false,
      creating: file.pendingCreation,
      missing: false,
    };
    if (!doc.creating) await hydrateDocumentLayout(doc);
    return doc;
  }

  async function openInternal(file: FileEntry, replaceId?: string, current = () => true) {
    file = workspace.value?.files.find((entry) => entry.id === file.id) ?? file;
    if (file.kind === 'file' && isDataTableFilePath(file.path)) {
      tabsLayout.activateTab(tableTabId(file.id), replaceId);
      return;
    }
    if (!isMarkdownEntry(file)) return;
    let doc = documentIndex.byId.value.get(file.id);
    if (!doc) doc = await readOpenDocument(file);
    if (!current()) return;
    if (tabIds.value.includes(doc.id) && !documentIndex.byId.value.has(doc.id))
      documents.value.push(doc);
    tabsLayout.activateTab(doc.id, replaceId, doc);
    const opened = documentIndex.byId.value.get(doc!.id)!;
    if (opened.creating)
      void fileOps.confirmCreation(opened).then((confirmed) => {
        if (confirmed && !isDisposed() && dirty(opened)) void flush();
      });
  }

  async function prepareTabReplacement(id?: string) {
    if (id && isTableTab(id) && !(await flush())) {
      report('此数据表尚未保存，请先处理保存错误。');
      return false;
    }
    if (assistantBridge.suggestionPersistence.value?.pending() && !(await flush())) return false;
    const current = documentIndex.byId.value.get(tabsLayout.tabTarget(id ?? ''));
    if (!current) return true;
    if ((dirty(current) || layoutPending(current)) && !(await flush())) {
      report('此文档尚未保存，请先处理保存错误。');
      return false;
    }
    if (current.conflict || current.missing) {
      report('请先处理当前文档的冲突或缺失，再替换标签页。');
      return false;
    }
    await hooks.beforeCloseDocument?.(current.id);
    if ((dirty(current) || layoutPending(current)) && !(await flush())) {
      report('此文档尚未保存，请先处理保存错误。');
      return false;
    }
    if (current.conflict || current.missing) {
      report('请先处理当前文档的冲突或缺失，再替换标签页。');
      return false;
    }
    return true;
  }

  function prefetchFile(file: FileEntry) {
    if (!adapter.prefetch || busy.value || isDisposed() || !isMarkdownEntry(file))
      return;
    const entry = fileRegistry.value?.get(file.id);
    if (!entry || entry.pendingCreation) return;
    void adapter.prefetch(entry.path).catch(() => {});
    if (/^[0-9a-f]{6}$/.test(entry.id)) {
      const path = documentLayoutPath(entry.id);
      if (fileRegistry.value?.at(path)) void adapter.prefetch(path).catch(() => {});
    }
  }

  function openCached(file: FileEntry, replaceId?: string) {
    if (fileMutations.pending.value) return false;
    const existing = documentIndex.byId.value.get(file.id);
    if (existing) {
      tabsLayout.activateTab(existing.id, replaceId, existing);
      return true;
    }
    const entry = fileRegistry.value?.get(file.id);
    if (!entry || entry.pendingCreation) return false;
    if (!isMarkdownEntry(entry)) return false;
    const snapshot = adapter.readCached?.(entry.path);
    if (!snapshot) return false;
    const doc: OpenDocument = {
      id: entry.id,
      path: entry.path,
      content: snapshot.content,
      base: snapshot,
      saving: false,
      missing: false,
    };
    if (/^[0-9a-f]{6}$/.test(entry.id)) {
      const path = documentLayoutPath(entry.id);
      const exists = !!fileRegistry.value?.at(path);
      const base = exists ? adapter.readCached?.(path) : null;
      if (exists && !base) return false;
      try {
        doc.tableLayout = {
          base: base ?? null,
          file: base
            ? parseDocumentLayout(base.content, entry.id)
            : { version: 1, fileId: entry.id, tables: [] },
        };
      } catch {
        return false;
      }
    }
    tabsLayout.activateTab(doc.id, replaceId, doc);
    return true;
  }

  function recordOpenedDocument(file: FileEntry) {
    recordHelpCompleted('welcome');
    if (
      workspace.value &&
      indexFolderHomes(
        workspace.value.files,
        workspaceSettings.value.folderHomeFileName,
      ).get(parentPath(file.path))?.id === file.id
    )
      recordHelpCompleted('folder-home');
  }

  function fileEditorHandler(file: FileEntry) {
    if (file.kind !== 'file' || !workspace.value || !isMarkdown(file.path)) return undefined;
    return resolvePluginFileHandler(file.path, 'editor', plugins.pluginFileHandlers.value);
  }

  function filePreviewHandler(file: FileEntry) {
    if (
      file.kind !== 'file' ||
      !workspace.value ||
      isMarkdown(file.path) ||
      isDataTableFilePath(file.path)
    )
      return undefined;
    return resolvePluginFileHandler(file.path, 'preview', plugins.pluginFileHandlers.value);
  }

  async function openFileWithEditorHandler(file: FileEntry, handler: PluginWorkbenchFileHandler) {
    const currentWorkspace = workspace.value;
    if (!currentWorkspace) return false;
    try {
      await plugins.pluginExecutor.invoke(handler.pluginId, 'command', handler.command, {
        workspaceId: currentWorkspace.id,
        fileId: file.id,
      });
      return true;
    } catch (error) {
      report(error);
      return false;
    }
  }

  function hasMarkdownFileHandler(file: FileEntry) {
    return !!fileEditorHandler(file);
  }

  async function openFile(
    file: FileEntry,
    options?: { historyIndex?: number; rawSource?: boolean },
  ) {
    if (filePreviewHandler(file)) return openAttachment(file, options);
    const editorHandler = options?.rawSource ? undefined : fileEditorHandler(file);
    if (editorHandler && (await openFileWithEditorHandler(file, editorHandler))) return;
    const creationAtRequest = fileOps.getCreationRevision();
    const request = ++fileOpenRevision;
    const paneId = tabsLayout.activePaneId.value;
    const epoch = assistantBridge.assistantEpoch.value;
    const activation = tabsLayout.getActivationRevision();
    const workspaceId = workspace.value?.id;
    const current = () =>
      !isDisposed() &&
      !busy.value &&
      request === fileOpenRevision &&
      creationAtRequest === fileOps.getCreationRevision() &&
      epoch === assistantBridge.assistantEpoch.value &&
      workspaceId === workspace.value?.id &&
      activation === tabsLayout.getActivationRevision();
    try {
      if (file.kind === 'file' && isDataTableFilePath(file.path))
        return openDataTable(file.id, options);
      if (!documentKindForEntry(file)) return;
      const replaceId =
        tabsLayout.isUtilityTab(activeId.value) &&
        !activeId.value.startsWith('blank:') &&
        !tabsLayout.isNavigationPage(activeId.value)
          ? undefined
          : activeId.value;
      const wasOpen = documents.value.some((doc) => doc.id === file.id);
      prefetchFile(file);
      if (!wasOpen && !(await prepareTabReplacement(replaceId))) return;
      if (!current()) return;
      if (!wasOpen) openingDocuments.value[paneId] = { request, tabId: activeId.value };
      if (!openCached(file, replaceId))
        await serial(async () => {
          if (!current()) return;
          await openInternal(file, replaceId, current);
        });
      if (!wasOpen && replaceId && activeId.value === file.id)
        tabsLayout.recordTabNavigation(replaceId, file.id, options?.historyIndex);
      else if (!replaceId && activeId.value === file.id)
        tabsLayout.ensureTabNavigation(file.id, file.id);
      if (tabsLayout.active.value?.id === file.id) recordOpenedDocument(file);
    } catch (e) {
      if (current()) report(e);
    } finally {
      if (openingDocuments.value[paneId]?.request === request) delete openingDocuments.value[paneId];
    }
  }

  async function openFileInNewTab(file: FileEntry, options?: { rawSource?: boolean }) {
    try {
      if (filePreviewHandler(file)) return openAttachmentInNewTab(file);
      const editorHandler = options?.rawSource ? undefined : fileEditorHandler(file);
      if (editorHandler && (await openFileWithEditorHandler(file, editorHandler))) return;
      await serial(async () => {
        if (file.kind === 'file' && isDataTableFilePath(file.path)) {
          const target = tableTabId(dataTableFileId(file.id));
          if (tabIds.value.includes(target)) {
            const alias = tabsLayout.newTabAlias(target);
            tabIds.value.push(alias);
            activeId.value = alias;
            tabsLayout.ensureTabNavigation(alias, target);
            tabsLayout.touchNavigation();
          } else await openDataTable(file.id, { newTab: true });
          return;
        }
        const target = file.id;
        if (tabIds.value.includes(target)) {
          const alias = tabsLayout.newTabAlias(target);
          tabIds.value.push(alias);
          activeId.value = alias;
          tabsLayout.ensureTabNavigation(alias, target);
          tabsLayout.touchNavigation();
          return;
        }
        await openInternal(file);
        if (activeId.value === file.id) tabsLayout.ensureTabNavigation(file.id, file.id);
      });
      if (tabsLayout.active.value?.id === file.id) recordOpenedDocument(file);
    } catch (error) {
      report(error);
    }
  }

  async function openAttachment(
    file: FileEntry,
    options?: { newTab?: boolean; historyIndex?: number },
  ) {
    const currentWorkspace = workspace.value;
    if (
      !currentWorkspace ||
      file.kind !== 'file' ||
      isMarkdown(file.path) ||
      isDataTableFilePath(file.path) ||
      !currentWorkspace.files.some((entry) => entry.id === file.id && entry.path === file.path)
    )
      return;
    const workspaceId = currentWorkspace.id;
    const request = ++fileOpenRevision;
    const activation = tabsLayout.getActivationRevision();
    const current = () => request === fileOpenRevision && !busy.value && !isDisposed();
    const target = `attachment:${file.id}`;
    const handler = filePreviewHandler(file);
    const usePlugin =
      !!handler && plugins.pluginViews.value.some((view) => view.key === handler.viewKey);
    const id = usePlugin && handler ? handler.viewKey : target;
    const opened = await openPageTab(id, {
      ...options,
      target,
      current: () => current() && tabsLayout.getActivationRevision() === activation,
    });
    if (
      !opened ||
      !usePlugin ||
      !handler ||
      !current() ||
      activeId.value !== id ||
      workspace.value?.id !== workspaceId
    )
      return;
    const previewActivation = tabsLayout.getActivationRevision();
    try {
      await plugins.pluginExecutor.invoke(handler.pluginId, 'command', handler.command, {
        workspaceId,
        fileId: file.id,
        viewAlreadyOpen: true,
      });
    } catch (error) {
      if (
        !current() ||
        tabsLayout.getActivationRevision() !== previewActivation ||
        workspace.value?.id !== workspaceId
      )
        return;
      report(error);
      await openPageTab(target, {
        target,
        current: () => current() && tabsLayout.getActivationRevision() === previewActivation,
      });
    }
  }

  function openAttachmentInNewTab(file: FileEntry) {
    return openAttachment(file, { newTab: true });
  }

  async function openFilesInNewTabsAt(
    ids: readonly string[],
    index: number,
    workspaceId: string,
  ) {
    try {
      await serial(async () => {
        if (workspace.value?.id !== workspaceId) return;
        const files = [...new Set(ids)].map((id) =>
          workspace.value!.files.find((file) => file.id === id),
        );
        if (
          !files.length ||
          files.some(
            (file) =>
              !file ||
              file.kind !== 'file' ||
              !(documentKindForEntry(file) || isDataTableFilePath(file.path)),
          )
        )
          return;
        const moving = new Set(
          files.map((file) => (isDataTableFilePath(file!.path) ? tableTabId(file!.id) : file!.id)),
        );
        const following = tabIds.value.slice(Math.max(0, index)).filter((id) => !moving.has(id));
        for (const file of files) {
          await openInternal(file!);
          if (tabsLayout.active.value?.id === file!.id) recordHelpCompleted('welcome');
          const id = isDataTableFilePath(file!.path) ? tableTabId(file!.id) : file!.id;
          tabsLayout.ensureTabNavigation(id, id);
          const target = following.find((tabId) => tabIds.value.includes(tabId));
          if (target) tabsLayout.moveDocument(id, target, 'before');
          else tabsLayout.placeTab(id, tabIds.value.length);
        }
      });
    } catch (error) {
      report(error);
    }
  }

  async function openPageTab(
    id: string,
    options?: { newTab?: boolean; historyIndex?: number; target?: string; current?: () => boolean },
  ) {
    if (!workspace.value) return false;
    if (options?.newTab) {
      tabsLayout.activateTab(id);
      tabsLayout.ensureTabNavigation(id, options.target);
      if (options.target) tabsLayout.recordTabNavigation(id, id, undefined, options.target);
      else tabsLayout.touchNavigation();
      return true;
    }
    const workspaceId = workspace.value.id;
    const epoch = assistantBridge.assistantEpoch.value;
    const replaceId = activeId.value;
    const wasOpen = tabIds.value.includes(id);
    try {
      if (!wasOpen && !(await prepareTabReplacement(replaceId))) return false;
      return await serial(async () => {
        if (
          workspace.value?.id !== workspaceId ||
          assistantBridge.assistantEpoch.value !== epoch ||
          (options?.current && (!options.current() || activeId.value !== replaceId))
        )
          return false;
        const targetId = activeId.value === replaceId ? replaceId : undefined;
        tabsLayout.activateTab(id, targetId);
        if (!wasOpen && targetId)
          tabsLayout.recordTabNavigation(targetId, id, options?.historyIndex, options?.target);
        else if (options?.target) {
          tabsLayout.ensureTabNavigation(id, options.target);
          tabsLayout.recordTabNavigation(
            id,
            id,
            targetId === id ? options.historyIndex : undefined,
            options.target,
          );
        } else {
          tabsLayout.ensureTabNavigation(id);
          tabsLayout.touchNavigation();
        }
        return true;
      });
    } catch (error) {
      report(error);
      return false;
    }
  }

  async function openGraphTab(options?: { newTab?: boolean; historyIndex?: number }) {
    await openPageTab(GRAPH_TAB_ID, options);
    if (workspace.value && activeId.value === GRAPH_TAB_ID) recordHelpCompleted('graph');
  }

  async function openDirectory(
    path: string,
    options?: { newTab?: boolean; historyIndex?: number },
  ) {
    if (!workspace.value) return;
    const entry = workspace.value.files.find(
      (file) => file.kind === 'directory' && file.path === path,
    );
    if (path && !entry) return;
    await openPageTab(path ? `directory:${entry!.id}` : 'directory:/', options);
  }

  async function openPluginDetail(
    pluginId: string,
    options?: { newTab?: boolean; historyIndex?: number },
  ) {
    if (tabsLayout.pluginDetailManifest(`plugin:${pluginId}`))
      await openPageTab(`plugin:${pluginId}`, options);
  }

  async function openPluginsTab(options?: { newTab?: boolean; historyIndex?: number }) {
    await openPageTab(PLUGINS_TAB_ID, options);
    if (workspace.value && activeId.value === PLUGINS_TAB_ID) recordHelpCompleted('plugins');
  }

  function readGraphDocument(
    expectedWorkspace: Pick<Workspace, 'id' | 'path'>,
    file: Pick<FileEntry, 'id'> & Partial<Pick<FileEntry, 'path'>>,
  ) {
    return serial(async () => {
      if (
        workspace.value?.id !== expectedWorkspace.id ||
        workspace.value.path !== expectedWorkspace.path
      )
        throw new Error('工作区已切换');
      const entry = fileRegistry.value?.get(file.id);
      if (
        !entry ||
        (file.path !== undefined && entry.path !== file.path) ||
        entry.kind !== 'file' ||
        !isMarkdown(entry.path)
      )
        throw new Error('文档已移动或删除');
      const draft = documentIndex.byId.value.get(file.id);
      if (draft) return draft.content;
      const snapshot = await adapter.read(entry.path);
      return documentIndex.byId.value.get(file.id)?.content ?? snapshot.content;
    });
  }

  function edit(content: string) {
    if (tabsLayout.active.value) editDocument(tabsLayout.active.value.id, content);
  }

  function editDocument(id: string, content: string, options: { origin?: 'local' | 'remote' } = {}) {
    const doc = documentIndex.byId.value.get(id);
    if (!doc || doc.conflict || workspace.value?.readOnly || fileRegistry.value?.get(id)?.readOnly)
      return;
    const before = doc.content;
    doc.content = content;
    if (!doc.creating) doc.error = undefined;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void flush();
    }, 600);
    if (options.origin !== 'remote')
      helpEdits.record(id, before, content, referenceTargets.value);
  }

  function receiveDocument(
    id: string,
    content: string,
    options: { origin?: 'local' | 'remote' } = {},
  ) {
    const doc = documentIndex.byId.value.get(id);
    if (!doc || doc.conflict || doc.missing) return;
    const before = doc.content;
    doc.content = content;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void flush();
    }, 600);
    if (options.origin === 'local')
      helpEdits.record(id, before, content, referenceTargets.value);
  }

  function editTableLayout(id: string, tables: TableLayout[]) {
    const doc = documentIndex.byId.value.get(id);
    if (!doc?.tableLayout || doc.conflict || doc.missing || workspace.value?.readOnly) return;
    doc.tableLayout.file = {
      ...doc.tableLayout.file,
      tables: JSON.parse(JSON.stringify(tables)),
    };
    doc.tableLayout.error = undefined;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void flush();
    }, 300);
  }

  async function flush(): Promise<boolean> {
    await fileMutations.flush();
    return flushDocuments();
  }

  async function flushDocuments(): Promise<boolean> {
    await fileOps.awaitCreationChain();
    try {
      await assistantBridge.suggestionPersistence.value?.flush();
    } catch (error) {
      report(error);
      return false;
    }
    clearTimeout(saveTimer);
    const saved = await serial(async () => {
      const tablesSaved = await dataTables.persistAll();
      for (const doc of documents.value) {
        await saveInternal(doc);
        await saveTableLayout(doc);
      }
      return (
        tablesSaved &&
        documents.value.every((doc) => (!dirty(doc) || !!doc.conflict) && !layoutPending(doc))
      );
    });
    await journal.flush();
    return saved;
  }

  async function close(id: string) {
    if (isTableTab(id) && !(await flush())) {
      report('数据表尚有未保存的修改，请先处理保存错误。');
      return;
    }
    const pane = tabsLayout.panes.value.find((pane) => pane.tabs.includes(id));
    const nextTab = () => {
      const candidate = tabsLayout.panes.value
        .find((item) => item.id === pane?.id)
        ?.tabs.find((tabId) => tabId !== id && tabIds.value.includes(tabId));
      return candidate ?? tabIds.value.find((tabId) => tabId !== id) ?? '';
    };
    if (tabsLayout.isUtilityTab(id)) {
      tabIds.value = tabIds.value.filter((tabId) => tabId !== id);
      tabsLayout.removeTabAlias(id);
      tabsLayout.removeTabNavigation(id);
      if (activeId.value === id) activeId.value = nextTab();
      return;
    }
    if (!(await flush())) {
      report('此文档尚有未保存的修改或建议，请先处理保存错误。');
      return;
    }
    try {
      await hooks.beforeCloseDocument?.(tabsLayout.tabTarget(id));
    } catch (error) {
      report(error);
      return;
    }
    const target = tabsLayout.tabTarget(id);
    const doc = documentIndex.byId.value.get(target);
    if (doc && ((dirty(doc) && !doc.conflict) || layoutPending(doc))) {
      report('此文档尚未保存，请先另存副本或解决保存错误。');
      return;
    }
    tabIds.value = tabIds.value.filter((tabId) => tabId !== id);
    tabsLayout.removeTabAlias(id);
    tabsLayout.removeTabNavigation(id);
    if (!tabIds.value.some((tabId) => tabsLayout.tabTarget(tabId) === target))
      documents.value = documents.value.filter((d) => d.id !== target);
    if (activeId.value === id) activeId.value = nextTab();
  }

  async function resolveConflict(doc: OpenDocument, openCopy: boolean) {
    await serial(async () => {
      if (!doc.conflict) return;
      const copy = doc.conflict.copyPath;
      const latest = await adapter.read(doc.path);
      doc.base = latest;
      doc.content = latest.content;
      doc.conflict = undefined;
      doc.missing = false;
      doc.error = undefined;
      if (openCopy) {
        workspace.value = await adapter.refresh();
        const file = fileRegistry.value?.at(copy);
        if (file) {
          await openInternal(file);
          tabsLayout.ensureTabNavigation(file.id, file.id);
          tabsLayout.touchNavigation();
        }
      }
    }).catch(report);
  }

  function clearSaveTimer() {
    clearTimeout(saveTimer);
  }

  return {
    dataTableFileId,
    openDataTable,
    createDataTable,
    renameDataTable,
    hydrateDocumentLayout,
    saveTableLayout,
    readOpenDocument,
    openInternal,
    prefetchFile,
    hasMarkdownFileHandler,
    openFile,
    openFileInNewTab,
    openAttachment,
    openAttachmentInNewTab,
    openFilesInNewTabsAt,
    openPageTab,
    openGraphTab,
    openDirectory,
    openPluginDetail,
    openPluginsTab,
    readGraphDocument,
    edit,
    editDocument,
    receiveDocument,
    editTableLayout,
    flush,
    flushDocuments,
    close,
    resolveConflict,
    clearSaveTimer,
  };
}
