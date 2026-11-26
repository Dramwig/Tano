import { computed, nextTick, onBeforeUnmount, ref, shallowReactive, shallowRef, watch, type Ref } from 'vue';
import { storeToRefs } from 'pinia';
import { captureModeViewport, restoreModeViewport, type ModeViewport } from '@tano/editor/editor-mode';
import { frontmatterProperties } from '@tano/editor/frontmatter-display';
import type { EditorPreferences } from '@tano/editor/runtime';
import type { EditorSelectionContext } from '@tano/editor/selection-context';
import { splitFrontmatter } from '@tano/editor/syntax';
import {
  basename,
  isMarkdown,
  relativeWorkspaceReference,
  resolveWorkspaceReference,
  safeRemoteImage,
  type AssistantSource,
  type CommentAnchor,
  type FileEntry,
} from '@tano/protocol';
import { native } from '../workspace/adapter';
import { assistantSourceRange } from '../assistant/source-selection';
import {
  openExternalUrl,
  resourceMarkdown,
  type AttachmentService,
} from '../files/attachments';
import type { DocumentExportFormat, DocumentExportOptions } from '../documents/document-export';
import { documentStarter, templateStarterBody } from '../documents/document-starters';
import { documentStatusItems, type DocumentSyncStatus } from '../documents/document-status';
import { recordHelpCompleted } from '../help/help-checklist';
import { t } from '../i18n/i18n';
import { isBlankPageTarget } from '../shell/page-context-menu';
import { layoutPanes } from '../shell/pane-layout';
import type { WorkbenchExtensions } from '../runtime';
import type { OpenDocument, useWorkspaceStore } from '../stores/workspace';
import { resolveWikiLink } from '../objects/wiki-links';
import type { WindowContext } from '../windows/context';
import type { DocumentComments, MarkdownEditor, SourceEditor } from '../shell/workbench-async-components';
import type PageSearch from '../shell/components/PageSearch.vue';
import { pageLockPreferenceKey, readPreference } from './use-workbench-preferences';

export interface DocumentActionsDeps {
  store: ReturnType<typeof useWorkspaceStore>;
  activeWindow: Ref<WindowContext>;
  editing: WorkbenchExtensions['editing'];
  extensions: WorkbenchExtensions;
  attachments: AttachmentService | undefined;
  localNative: boolean;
  compactPanes: Ref<boolean>;
  sidebar: Ref<boolean>;
  menu: Ref<boolean>;
  updateLock: Ref<boolean>;
  workspaceLocked: Ref<boolean>;
  pageLocked: Ref<boolean>;
  showPageTitle: Ref<boolean>;
  showDocumentProperties: Ref<boolean>;
  showOutline: Ref<boolean>;
  showAllLineNumbers: Ref<boolean>;
  editorPreferences: Ref<EditorPreferences>;
  selectedVisualFontFamily: Ref<string>;
  visualFontSize: Ref<number>;
  defaultSource: Ref<boolean>;
  commandPaletteOpened: Ref<boolean>;
  templateInitialization: Ref<{ title: string; apply: (content: string) => void } | undefined>;
  openTemplateLibrary: () => void;
  openEntry: (file: FileEntry, newTab?: boolean) => Promise<void>;
  closeOtherContextMenus: () => void;
  getOutline: () => { text: string; line: number; level: number }[];
  jumpToHeading: (index: number, userInitiated?: boolean) => void;
}

export function useDocumentActions(deps: DocumentActionsDeps) {
  const {
    store,
    activeWindow,
    editing,
    extensions,
    attachments,
    localNative,
    compactPanes,
    sidebar,
    menu,
    updateLock,
    workspaceLocked,
    pageLocked,
    showPageTitle,
    showDocumentProperties,
    showOutline,
    showAllLineNumbers,
    editorPreferences,
    selectedVisualFontFamily,
    visualFontSize,
    defaultSource,
    commandPaletteOpened,
    templateInitialization,
    openTemplateLibrary,
    openEntry,
    closeOtherContextMenus,
    getOutline,
    jumpToHeading,
  } = deps;
  const { workspace, active } = storeToRefs(store);

  const paneEditors = shallowReactive(new Map<string, InstanceType<typeof MarkdownEditor>>());
  const paneComments = shallowReactive(new Map<string, InstanceType<typeof DocumentComments>>());
  const commentAnchors = shallowReactive<Record<string, { id: string; anchor: CommentAnchor }[]>>({});
  const paneSelections = shallowReactive<Record<string, EditorSelectionContext>>({});
  const paneSourceSelections = shallowReactive<Record<string, boolean>>({});
  const paneScrolls = shallowReactive(new Map<string, HTMLElement>());
  const paneEditorScrolls = shallowReactive(new Map<string, HTMLElement>());
  const paneSourceEditors = shallowReactive(new Map<string, InstanceType<typeof SourceEditor>>());
  const paneSearches = new Map<string, InstanceType<typeof PageSearch>>();
  const paneSearchRevisions = shallowReactive<Record<string, number>>({});
  const sourceModes = shallowReactive<Record<string, boolean>>({});
  const pendingModeViewports = new Map<
    string,
    { fileId: string; source: boolean; viewport: ModeViewport; focus?: boolean }
  >();
  const pendingTransfers = new Map<
    string,
    { source: boolean; state: unknown; viewport: ModeViewport | null }
  >();

  const paneSource = (id: string) => sourceModes[id] ?? defaultSource.value;

  function setPaneSource(id: string, value: boolean, previous = paneSource(id)) {
    if (previous === value) return;
    for (const pane of store.panes.filter((pane) => pane.activeId === id)) {
      const target = previous ? paneSourceEditors.get(pane.id) : paneEditors.get(pane.id);
      const scroll = paneScrolls.get(pane.id);
      const pending = pendingModeViewports.get(pane.id);
      const viewport =
        (target && scroll ? captureModeViewport(target, scroll) : null) ??
        (pending?.fileId === id ? pending.viewport : null);
      if (viewport) pendingModeViewports.set(pane.id, { fileId: id, source: value, viewport });
    }
    sourceModes[id] = value;
    if (store.documentForTab(id)) recordHelpCompleted('source');
  }

  const source = computed({
    get: () => paneSource(store.activeId),
    set: (value) => {
      setPaneSource(store.activeId, value);
    },
  });

  const editorReadonly = computed(
    () =>
      workspaceLocked.value ||
      pageLocked.value ||
      updateLock.value ||
      store.busy ||
      !!workspace.value?.readOnly ||
      !!workspace.value?.files.find((file) => file.id === active.value?.id)?.readOnly ||
      !!active.value?.conflict ||
      editing.activeBusy ||
      !!editing.active?.readOnly,
  );

  function sessionBlocksFileMutation(id: string) {
    const documentId = store.documentForTab(id)?.id ?? id;
    return editing.canMutateFile
      ? !editing.canMutateFile(documentId)
      : editing.isManaging(documentId);
  }

  function withFileMutation<T>(ids: string[], mutation: () => Promise<T>): Promise<T> {
    return editing.withFileMutation ? editing.withFileMutation(ids, mutation) : mutation();
  }

  function fileMutationIds(entries: FileEntry[]): string[] {
    return (workspace.value?.files ?? [])
      .filter(
        (file) =>
          file.kind === 'file' &&
          entries.some(
            (entry) =>
              entry.id === file.id ||
              (entry.kind === 'directory' && file.path.startsWith(`${entry.path}/`)),
          ),
      )
      .map((file) => file.id);
  }

  async function renameDocumentTitle(workspaceId: string, id: string, from: string, to: string) {
    if (workspace.value?.id !== workspaceId)
      throw new Error(t('工作空间已切换，请重新打开文档后重试'));
    if (
      workspaceLocked.value ||
      updateLock.value ||
      store.busy ||
      workspace.value.readOnly ||
      sessionBlocksFileMutation(id)
    )
      throw new Error(t('当前文档暂时无法重命名'));
    const doc = store.documentForTab(id);
    if (!doc || store.displayPath(doc) !== from)
      throw new Error(t('文件位置已变化，请重新输入标题'));
    await withFileMutation([id], () => store.rename(doc, to));
  }

  watch(
    () => [store.activeId, editing.active?.key] as const,
    ([id, epoch], [previousId, previousEpoch]) => {
      if (id === previousId && epoch !== previousEpoch && !paneSource(id)) {
        const paneId = store.activePaneId;
        const target = paneEditors.get(paneId);
        const scroll = paneScrolls.get(paneId);
        const viewport = target && scroll ? captureModeViewport(target, scroll) : null;
        if (viewport)
          pendingModeViewports.set(paneId, {
            fileId: id,
            source: false,
            viewport,
            focus:
              !!scroll?.contains(document.activeElement) &&
              !!document.activeElement?.closest('.ProseMirror'),
          });
      }
      if (epoch && epoch !== 'local') source.value = false;
    },
  );

  // Reference graph popover target
  const referenceGraphOpened = ref(false);
  const referenceGraphTarget = shallowRef<Pick<OpenDocument, 'id' | 'path'>>();
  const referenceGraphAnchor = shallowRef<HTMLElement>();
  watch(
    () => [active.value?.id, active.value?.path] as const,
    ([id, path]) => {
      // Keep the latest document's graph when switching to a non-document tab.
      if (referenceGraphTarget.value && id && path) referenceGraphTarget.value = { id, path };
    },
  );

  const exportBusy = ref(false);
  const printBusy = ref(false);
  const documentMenuButton = ref<HTMLButtonElement>();
  const documentMenuElement = ref<HTMLElement>();
  const pageContextMenu = ref<{ x: number; y: number } | null>(null);
  const pageContextMenuElement = ref<HTMLElement>();

  const editor = computed(() => paneEditors.get(store.activePaneId));
  const documentScroll = computed(() => paneScrolls.get(store.activePaneId));
  const editorScroll = computed(() => paneEditorScrolls.get(store.activePaneId));
  const sourceEditor = computed(() => paneSourceEditors.get(store.activePaneId));

  function setPaneEditor(id: string, value: unknown) {
    // Async component refs may briefly point at their loading placeholder.
    // Only publish the editor after its exposed API is available.
    if (value && typeof (value as { visualSelection?: unknown }).visualSelection === 'function')
      paneEditors.set(id, value as InstanceType<typeof MarkdownEditor>);
    else paneEditors.delete(id);
  }

  function setPaneComments(paneId: string, value: unknown) {
    if (value && typeof (value as { showDiscussion?: unknown }).showDiscussion === 'function')
      paneComments.set(paneId, value as InstanceType<typeof DocumentComments>);
    else paneComments.delete(paneId);
  }

  function setPaneSearch(id: string, value: unknown) {
    if (value) paneSearches.set(id, value as InstanceType<typeof PageSearch>);
    else paneSearches.delete(id);
  }

  function openPaneSearch(id = store.activePaneId, replace = false) {
    menu.value = false;
    if (compactPanes.value) sidebar.value = false;
    void paneSearches.get(id)?.open(replace);
  }

  function setPaneElement(kind: 'scroll' | 'editor' | 'source', id: string, value: unknown) {
    if (kind === 'source') {
      if (value && typeof (value as { commentSelection?: unknown }).commentSelection === 'function')
        paneSourceEditors.set(id, value as InstanceType<typeof SourceEditor>);
      else {
        paneSourceEditors.delete(id);
        delete paneSourceSelections[id];
      }
    } else {
      const map = kind === 'scroll' ? paneScrolls : paneEditorScrolls;
      if (value) map.set(id, value as HTMLElement);
      else map.delete(id);
    }
  }

  function capturePaneCommentSelection(paneId: string, fileId: string) {
    const selection = paneSource(fileId)
      ? paneSourceEditors.get(paneId)?.commentSelection()
      : paneEditors.get(paneId)?.commentSelection();
    return selection
      ? { ...selection, basis: paneSource(fileId) ? ('source' as const) : ('prose' as const) }
      : null;
  }

  function focusPaneComment(paneId: string, fileId: string, anchor: CommentAnchor) {
    if (paneSource(fileId)) paneSourceEditors.get(paneId)?.focusComment(anchor);
    else paneEditors.get(paneId)?.focusComment(anchor);
  }

  function paneCommentGeometry(
    paneId: string,
    fileId: string,
    anchors?: readonly { id: string; anchor: CommentAnchor }[],
  ) {
    return (
      (paneSource(fileId)
        ? paneSourceEditors.get(paneId)
        : paneEditors.get(paneId)
      )?.commentGeometry(anchors) ?? null
    );
  }

  // Pane transfer & plugin editor hook
  watch(
    () => store.windowLayouts,
    (layouts, previous) => {
      const destinations = new Map(
        Object.values(layouts).flatMap((layout) =>
          layoutPanes(layout.layout).flatMap((pane) => pane.tabs.map((id) => [id, pane.id] as const)),
        ),
      );
      for (const layout of Object.values(previous)) {
        for (const pane of layoutPanes(layout.layout)) {
          const destination = destinations.get(pane.activeId);
          if (!destination || destination === pane.id) continue;
          const isSource = paneSource(pane.activeId);
          const ed = isSource ? paneSourceEditors.get(pane.id) : paneEditors.get(pane.id);
          if (!ed) continue;
          const scroll = paneScrolls.get(pane.id);
          pendingTransfers.set(pane.activeId, {
            source: isSource,
            state: ed.captureTransferState(),
            viewport: scroll ? captureModeViewport(ed, scroll) : null,
          });
        }
      }
    },
    { flush: 'sync' },
  );
  watch(
    () => store.documents.map((doc) => doc.id),
    (ids) => {
      for (const id of pendingTransfers.keys()) if (!ids.includes(id)) pendingTransfers.delete(id);
    },
  );
  watch(
    () => store.workspace?.id,
    () => pendingTransfers.clear(),
  );

  store.setPluginEditor({
    applyEdit: async (fileId, before, after) => {
      const pane = store.panes.find((item) => item.activeId === fileId);
      if (!pane) return false;
      const target = paneSource(fileId) ? paneSourceEditors.get(pane.id) : paneEditors.get(pane.id);
      if (!target) return false;
      target.applyPluginEdit(before, after);
      await nextTick();
      return true;
    },
    activeEditor: () => {
      const pane = store.panes.find((item) => item.id === store.activePaneId);
      if (!pane) return null;
      const doc = store.documentForTab(pane.activeId);
      if (!doc) return null;
      const isSource = paneSource(doc.id);
      const target = isSource ? paneSourceEditors.get(pane.id) : paneEditors.get(pane.id);
      const sel = target?.pluginSelection?.();
      if (!sel) return null;
      return {
        fileId: doc.id,
        mode: isSource ? 'source' : 'rich',
        readOnly: paneReadonly(doc),
        selection: { from: sel.from, to: sel.to, empty: sel.empty },
        selectedText: sel.selectedText,
        blockType: sel.blockType,
      };
    },
    applySelectionEdit: async (fileId, text, mode) => {
      const pane = store.panes.find((item) => item.activeId === fileId);
      if (!pane) return false;
      const target = paneSource(fileId) ? paneSourceEditors.get(pane.id) : paneEditors.get(pane.id);
      if (!target?.applyPluginSelectionEdit) return false;
      const ok = target.applyPluginSelectionEdit(text, mode);
      await nextTick();
      return ok;
    },
  });
  onBeforeUnmount(() => store.setPluginEditor());

  let pendingAssistantReveal:
    | { workspaceId: string; paneId: string; tabId: string; fileId: string; from: number; to: number }
    | undefined;

  function revealPendingAssistantSelection() {
    const pending = pendingAssistantReveal;
    if (!pending) return;
    if (
      store.workspace?.id !== pending.workspaceId ||
      store.activePaneId !== pending.paneId ||
      store.activeId !== pending.tabId ||
      store.active?.id !== pending.fileId
    ) {
      pendingAssistantReveal = undefined;
      return;
    }
    const target = paneSource(pending.tabId)
      ? paneSourceEditors.get(pending.paneId)
      : paneEditors.get(pending.paneId);
    if (target?.revealSourceRange(pending)) pendingAssistantReveal = undefined;
  }

  async function revealAssistantSelection(
    selectionSource: Pick<AssistantSource, 'workspaceId' | 'fileId' | 'selection'>,
  ) {
    pendingAssistantReveal = undefined;
    if (store.workspace?.id !== selectionSource.workspaceId || store.active?.id !== selectionSource.fileId)
      return;
    const range = assistantSourceRange(store.active.content, selectionSource.selection);
    if (!range) {
      store.report(t('引用原文已变化或无法唯一定位，请在文档中核对'));
      return;
    }
    pendingAssistantReveal = {
      workspaceId: selectionSource.workspaceId,
      paneId: store.activePaneId,
      tabId: store.activeId,
      fileId: selectionSource.fileId,
      ...range,
    };
    await nextTick();
    revealPendingAssistantSelection();
  }

  async function paneEditorReady(paneId: string, fileId: string, sourceMode: boolean) {
    await nextTick();
    paneSearchRevisions[paneId] = (paneSearchRevisions[paneId] ?? 0) + 1;
    const target = sourceMode ? paneSourceEditors.get(paneId) : paneEditors.get(paneId);
    const scroll = paneScrolls.get(paneId);
    const transfer = pendingTransfers.get(fileId);
    if (transfer && target && scroll) {
      pendingTransfers.delete(fileId);
      if (transfer.source === sourceMode) {
        target.restoreTransferState(transfer.state);
        if (transfer.viewport)
          pendingModeViewports.set(paneId, {
            fileId,
            source: sourceMode,
            viewport: transfer.viewport,
          });
      }
    }
    const pending = pendingModeViewports.get(paneId);
    if (!pending || pending.fileId !== fileId || pending.source !== sourceMode || !target || !scroll) {
      revealPendingAssistantSelection();
      return;
    }
    const current = () =>
      pendingModeViewports.get(paneId) === pending &&
      paneSource(fileId) === sourceMode &&
      store.panes.some((pane) => pane.id === paneId && pane.activeId === fileId) &&
      (sourceMode ? paneSourceEditors.get(paneId) : paneEditors.get(paneId)) === target;
    try {
      await restoreModeViewport(
        target,
        scroll,
        pending.viewport,
        pending.focus ?? paneId === store.activePaneId,
        current,
      );
    } finally {
      if (pendingModeViewports.get(paneId) === pending) pendingModeViewports.delete(paneId);
      revealPendingAssistantSelection();
    }
  }

  function paneReadonly(doc: OpenDocument) {
    return (
      workspaceLocked.value ||
      updateLock.value ||
      store.busy ||
      !!workspace.value?.readOnly ||
      !!workspace.value?.files.find((file) => file.id === doc.id)?.readOnly ||
      !!doc.conflict ||
      (doc.id === store.active?.id
        ? editorReadonly.value
        : readPreference(pageLockPreferenceKey(workspace.value?.id ?? '', doc.id), false) ||
          editing.isManaging(doc.id))
    );
  }

  function paneDocumentStatus(doc: OpenDocument) {
    const locked =
      workspaceLocked.value ||
      (doc.id === store.active?.id
        ? pageLocked.value
        : readPreference(pageLockPreferenceKey(workspace.value?.id ?? '', doc.id), false));
    const sync: DocumentSyncStatus | undefined = extensions.documentStatus?.(doc.id);
    return documentStatusItems({
      document: doc,
      locked,
      preview:
        updateLock.value ||
        !!workspace.value?.readOnly ||
        !!workspace.value?.files.find((file) => file.id === doc.id)?.readOnly,
      sync,
      storage: store.isDemo ? 'demo' : store.isWeb ? 'web' : 'local',
    });
  }

  // Document menu & undo/redo
  const documentUndoAvailable = ref(false);
  const documentRedoAvailable = ref(false);

  function refreshDocumentHistoryAvailability() {
    documentUndoAvailable.value =
      !editorReadonly.value &&
      (source.value ? !!sourceEditor.value?.canUndo() : !!editor.value?.canUndo());
    documentRedoAvailable.value =
      !editorReadonly.value &&
      (source.value ? !!sourceEditor.value?.canRedo() : !!editor.value?.canRedo());
  }
  watch(commandPaletteOpened, (opened) => {
    if (opened) refreshDocumentHistoryAvailability();
  });

  function showReferenceGraph(paneId: string, doc: OpenDocument) {
    referenceGraphTarget.value = { id: doc.id, path: doc.path };
    referenceGraphAnchor.value = paneScrolls.get(paneId);
    referenceGraphOpened.value = true;
    menu.value = false;
  }

  async function toggleDocumentMenu(event: MouseEvent) {
    documentMenuButton.value = event.currentTarget as HTMLButtonElement;
    // Focusing another pane closes its predecessor's menu in the activeId watcher.
    await nextTick();
    menu.value = !menu.value;
    if (!menu.value) {
      documentUndoAvailable.value = false;
      documentRedoAvailable.value = false;
      return;
    }
    await nextTick();
    refreshDocumentHistoryAvailability();
  }

  function documentMenuTriggerKeydown(event: KeyboardEvent) {
    if (!menu.value || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [
      ...(documentMenuElement.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ??
        []),
    ];
    if (!items.length) return;
    event.preventDefault();
    items[event.key === 'ArrowUp' || event.key === 'End' ? items.length - 1 : 0]?.focus();
  }

  function documentMenuKeydown(event: KeyboardEvent) {
    const { document } = activeWindow.value;
    if (event.key === 'Escape') {
      event.preventDefault();
      menu.value = false;
      documentMenuButton.value?.focus({ preventScroll: true });
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [
      ...(documentMenuElement.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ??
        []),
    ];
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : current < 0
            ? event.key === 'ArrowDown'
              ? 0
              : items.length - 1
            : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }

  function undoDocument() {
    if (editorReadonly.value || !documentUndoAvailable.value) return;
    const changed = source.value
      ? sourceEditor.value?.undoLastChange()
      : editor.value?.undoLastChange();
    if (!changed) return;
    menu.value = false;
    documentUndoAvailable.value = false;
    documentRedoAvailable.value = false;
  }

  function redoDocument() {
    if (editorReadonly.value || !documentRedoAvailable.value) return;
    const changed = source.value
      ? sourceEditor.value?.redoLastChange()
      : editor.value?.redoLastChange();
    if (!changed) return;
    menu.value = false;
    documentUndoAvailable.value = false;
    documentRedoAvailable.value = false;
  }

  function insertBlockBelowTitle(workspaceId: string, documentId: string) {
    if (
      workspace.value?.id !== workspaceId ||
      active.value?.id !== documentId ||
      editorReadonly.value ||
      active.value.missing
    )
      return;
    if (source.value) sourceEditor.value?.insertBlockAtStart();
    else editor.value?.insertBlockAtStart();
  }

  // Document initialization & templates
  function initializeDocument(paneId: string, fileId: string, content: string, expected: string) {
    const doc = store.documentForTab(fileId);
    if (
      !doc ||
      paneReadonly(doc) ||
      doc.missing ||
      doc.conflict ||
      doc.error ||
      (editing.isManaging(doc.id) && (doc.id !== store.active?.id || !editing.active?.extension)) ||
      store.panes.find((pane) => pane.id === paneId)?.activeId !== fileId ||
      paneSource(fileId) ||
      doc.content !== expected ||
      !paneEditors.get(paneId)?.initializeBody(content, expected)
    )
      throw new Error(t('文档内容或编辑状态已变化，请回到空白文档后重试。现有内容已保留。'));
    store.focusPane(paneId);
    recordHelpCompleted('use-template');
  }

  function quickInitialize(paneId: string, fileId: string, kind: 'meeting' | 'weekly' | 'todo') {
    const doc = store.documentForTab(fileId);
    if (!doc) return;
    try {
      initializeDocument(paneId, fileId, documentStarter(kind, workspace.value?.name ?? ''), doc.content);
    } catch (reason) {
      store.report(reason);
    }
  }

  function chooseInitialTemplate(paneId: string, fileId: string) {
    const doc = store.documentForTab(fileId);
    if (!doc) return;
    store.focusPane(paneId);
    openTemplateLibrary();
    const expected = doc.content;
    const workspaceId = workspace.value?.id;
    templateInitialization.value = {
      title: basename(doc.path).replace(/\.(md|markdown)$/i, ''),
      apply(content) {
        if (workspace.value?.id !== workspaceId) throw new Error(t('工作区已切换'));
        initializeDocument(paneId, fileId, templateStarterBody(content), expected);
      },
    };
  }

  // Page context menu & document property/discussion actions
  function closePageContextMenu() {
    pageContextMenu.value = null;
  }

  function openPageContextMenu(event: MouseEvent) {
    const { window: activeWin } = activeWindow.value;
    if (event.defaultPrevented || !isBlankPageTarget(event.target)) {
      closePageContextMenu();
      return;
    }
    event.preventDefault();
    closeOtherContextMenus();
    pageContextMenu.value = { x: Math.max(8, event.clientX), y: Math.max(8, event.clientY) };
    void nextTick(() => {
      const element = pageContextMenuElement.value;
      if (!element || !pageContextMenu.value) return;
      pageContextMenu.value = {
        x: Math.min(
          pageContextMenu.value.x,
          Math.max(8, activeWin.innerWidth - element.offsetWidth - 8),
        ),
        y: Math.min(
          pageContextMenu.value.y,
          Math.max(8, activeWin.innerHeight - element.offsetHeight - 8),
        ),
      };
      element.focus({ preventScroll: true });
    });
  }

  function openDocumentDiscussion() {
    menu.value = false;
    closePageContextMenu();
    return paneComments.get(store.activePaneId)?.showDiscussion();
  }

  const canAddDocumentProperty = computed(() => {
    const doc = active.value;
    if (!doc || editorReadonly.value || editing.active || editing.activeBusy) return false;
    const prefix = splitFrontmatter(doc.content).prefix;
    return !prefix || frontmatterProperties(prefix) !== null;
  });

  async function addDocumentProperty() {
    if (!canAddDocumentProperty.value) return;
    const fileId = store.activeId;
    const paneId = store.activePaneId;
    menu.value = false;
    closePageContextMenu();
    showDocumentProperties.value = true;
    setPaneSource(fileId, false);
    // The property input is the destination; restoring the prose caret would dismiss its draft.
    pendingModeViewports.delete(paneId);
    await nextTick();
    if (store.activeId === fileId && store.activePaneId === paneId)
      await paneEditors.get(paneId)?.addDocumentProperty();
  }

  function togglePageOption(
    option: 'title' | 'properties' | 'outline' | 'lineNumbers' | 'autoSpacing',
  ) {
    if (option === 'autoSpacing')
      editorPreferences.value = {
        ...editorPreferences.value,
        autoSpacing: !editorPreferences.value.autoSpacing,
      };
    if (option === 'title') showPageTitle.value = !showPageTitle.value;
    if (option === 'properties') showDocumentProperties.value = !showDocumentProperties.value;
    if (option === 'outline') showOutline.value = !showOutline.value;
    if (option === 'lineNumbers') showAllLineNumbers.value = !showAllLineNumbers.value;
    closePageContextMenu();
  }

  function pageContextKeydown(event: KeyboardEvent) {
    const { document } = activeWindow.value;
    if (event.key === 'Escape') {
      event.preventDefault();
      closePageContextMenu();
      editorScroll.value?.focus({ preventScroll: true });
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [
      ...(pageContextMenuElement.value?.querySelectorAll<HTMLButtonElement>('button') ?? []),
    ];
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : current < 0
            ? event.key === 'ArrowDown'
              ? 0
              : items.length - 1
            : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }

  // Attachments & links
  const attachmentBusy = ref(false);
  const resourceRevision = computed(
    () =>
      `${attachments?.revision ?? 0}:${active.value?.path}:${workspace.value?.files
        .filter((file) => !isMarkdown(file.path))
        .map((file) => `${file.path}:${file.modified}:${file.size}`)
        .join('|')}`,
  );

  async function uploadFile(file: File, requireImage: boolean, doc = active.value) {
    const currentWorkspace = workspace.value;
    if (!attachments || !currentWorkspace || !doc) throw new Error(t('当前工作区不支持导入附件'));
    const result = await attachments.importAttachment(
      currentWorkspace.id,
      doc.path,
      file,
      requireImage,
    );
    if (
      workspace.value?.id !== currentWorkspace.id ||
      !store.documents.some((item) => item.id === doc.id)
    )
      throw new Error(t('附件已保存到原工作空间的 assets；文档已切换，请重新插入链接'));
    await store.refresh();
    if (
      workspace.value?.id !== currentWorkspace.id ||
      !store.documents.some((item) => item.id === doc.id)
    )
      throw new Error(t('附件已导入，原文档已关闭'));
    return { ...result, url: relativeWorkspaceReference(doc.path, result.path) };
  }

  async function insertSourceFiles(
    files: File[],
    position: number,
    requireImage: boolean,
    doc = active.value,
    paneId = store.activePaneId,
  ) {
    if (!doc || doc.conflict || attachmentBusy.value) return;
    const id = doc.id;
    const before = doc.content;
    const targetEditor = paneSourceEditors.get(paneId);
    attachmentBusy.value = true;
    try {
      const links: string[] = [];
      for (const file of files.slice(0, 10))
        links.push(resourceMarkdown(await uploadFile(file, requireImage, doc)));
      if (!store.documents.includes(doc)) return;
      // Preserve typing that happened while the bytes were being imported.
      const content = doc.content;
      const at = content === before ? position : content.length;
      const text = `\n${links.join('\n')}\n`;
      // Local insertions belong to editor history; incoming model updates do not.
      if (
        targetEditor &&
        paneSourceEditors.get(paneId) === targetEditor &&
        store.panes.find((pane) => pane.id === paneId)?.activeId === id
      ) {
        targetEditor.insertText(text, at);
      } else store.editDocument(id, `${content.slice(0, at)}${text}${content.slice(at)}`);
    } catch (error) {
      store.report(error);
    } finally {
      attachmentBusy.value = false;
    }
  }

  async function openDocumentLink(
    reference: string,
    newTab = false,
    documentPath = active.value?.path,
  ) {
    const { window: activeWin } = activeWindow.value;
    if (!workspace.value || documentPath === undefined) return;
    if (/^(?:https?:\/\/|mailto:)/i.test(reference)) {
      if (native) {
        try {
          await openExternalUrl(reference);
        } catch (error) {
          store.report(error);
        }
      } else activeWin.open(reference, '_blank', 'noopener,noreferrer');
      return;
    }
    const path = resolveWorkspaceReference(documentPath, reference);
    const file = workspace.value.files.find((entry) => entry.path === path && entry.kind === 'file');
    if (file) await openEntry(file, newTab);
    else store.report(t('此链接不在当前工作空间；请复制链接到浏览器打开'));
  }

  async function openWikiLink(target: string) {
    if (!workspace.value || !active.value) return;
    const result = resolveWikiLink(workspace.value.files, active.value.path, target);
    if ('error' in result) {
      store.report(
        result.error === 'ambiguous'
          ? t('有多篇同名文档，请在双向链接中写明文件夹路径')
          : result.error === 'invalid'
            ? t('双向链接目标无效')
            : t('当前工作空间中找不到这篇文档'),
      );
      return;
    }
    if (result.file.path !== active.value.path) await openEntry(result.file);
    if (active.value?.path !== result.file.path) return;
    if (!result.heading) return;
    await nextTick();
    const requested = result.heading.toLocaleLowerCase();
    const index = getOutline().findIndex(
      (heading) => heading.text.toLocaleLowerCase() === requested,
    );
    if (index < 0) {
      store.report(t('目标文档中找不到这个标题'));
      return;
    }
    for (let attempt = 0; attempt < 10; attempt++) {
      const ready = source.value
        ? !!editorScroll.value?.querySelector('textarea')
        : !!editorScroll.value?.querySelectorAll(
            '.tano-prose h1, .tano-prose h2, .tano-prose h3, .tano-prose h4, .tano-prose h5, .tano-prose h6',
          )[index];
      if (ready) {
        jumpToHeading(index);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    store.report(t('文档已打开，但暂时无法定位到标题'));
  }

  // Export & print
  function documentOutputOptions(): DocumentExportOptions | undefined {
    const doc = active.value;
    const currentWorkspace = workspace.value;
    if (!doc) return;
    const title = showPageTitle.value
      ? editorScroll.value?.querySelector<HTMLTextAreaElement>('.document-title-wrap textarea')?.value
      : undefined;
    return {
      id: doc.id,
      path: doc.path,
      content: doc.content,
      title,
      capabilities: store.capabilities,
      referenceTargets: store.referenceTargets,
      tableLayouts: doc.tableLayout?.file.tables,
      resolveImage: (reference: string) =>
        attachments
          ? attachments.imageUrl(currentWorkspace, doc.path, reference)
          : safeRemoteImage(reference),
      fontFamily: selectedVisualFontFamily.value,
      fontSize: visualFontSize.value,
    };
  }

  async function printActiveDocument() {
    if (printBusy.value) return;
    const options = documentOutputOptions();
    if (!options) return;
    menu.value = false;
    printBusy.value = true;
    try {
      const { printDocument } = await import('../documents/document-print');
      await printDocument(options);
    } catch (reason) {
      store.report(t('打印失败：{0}', [reason instanceof Error ? reason.message : String(reason)]));
    } finally {
      printBusy.value = false;
    }
  }

  async function exportDocument(format: DocumentExportFormat) {
    if (exportBusy.value) return;
    const options = documentOutputOptions();
    if (!options) return;
    menu.value = false;
    exportBusy.value = true;
    try {
      const { downloadExport, exportFilename, renderDocumentExport } = await import(
        '../documents/document-export'
      );
      const blob = await renderDocumentExport(options, format);
      const filename = exportFilename(options.path, format);
      if (localNative) {
        const { saveDocumentExport } = await import('../documents/native-document-export');
        if (!(await saveDocumentExport(blob, filename, format))) return;
      } else downloadExport(blob, filename);
      recordHelpCompleted('export-document');
    } catch (reason) {
      store.report(reason);
    } finally {
      exportBusy.value = false;
    }
  }

  return {
    paneEditors,
    paneComments,
    commentAnchors,
    paneSelections,
    paneSourceSelections,
    paneScrolls,
    paneEditorScrolls,
    paneSourceEditors,
    paneSearches,
    paneSearchRevisions,
    sourceModes,
    paneSource,
    setPaneSource,
    source,
    editorReadonly,
    sessionBlocksFileMutation,
    withFileMutation,
    fileMutationIds,
    renameDocumentTitle,
    referenceGraphOpened,
    referenceGraphTarget,
    referenceGraphAnchor,
    exportBusy,
    printBusy,
    documentMenuButton,
    documentMenuElement,
    pageContextMenu,
    pageContextMenuElement,
    editor,
    documentScroll,
    editorScroll,
    sourceEditor,
    setPaneEditor,
    setPaneComments,
    setPaneSearch,
    openPaneSearch,
    setPaneElement,
    capturePaneCommentSelection,
    focusPaneComment,
    paneCommentGeometry,
    revealAssistantSelection,
    paneEditorReady,
    paneReadonly,
    paneDocumentStatus,
    documentUndoAvailable,
    documentRedoAvailable,
    refreshDocumentHistoryAvailability,
    showReferenceGraph,
    toggleDocumentMenu,
    documentMenuTriggerKeydown,
    documentMenuKeydown,
    undoDocument,
    redoDocument,
    insertBlockBelowTitle,
    initializeDocument,
    quickInitialize,
    chooseInitialTemplate,
    closePageContextMenu,
    openPageContextMenu,
    openDocumentDiscussion,
    canAddDocumentProperty,
    addDocumentProperty,
    togglePageOption,
    pageContextKeydown,
    attachmentBusy,
    resourceRevision,
    uploadFile,
    insertSourceFiles,
    openDocumentLink,
    openWikiLink,
    printActiveDocument,
    exportDocument,
  };
}
