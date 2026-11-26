import { computed, nextTick, ref, watch, type Ref } from 'vue';
import { storeToRefs } from 'pinia';
import {
  isMarkdown,
  validatePath,
  type FileEntry,
  type WorkspaceAdapter,
} from '@tano/protocol';
import { native } from '../workspace/adapter';
import type { AttachmentService } from '../files/attachments';
import { topLevelEntries } from '../files/file-selection';
import { recordHelpCompleted } from '../help/help-checklist';
import { t } from '../i18n/i18n';
import { mobile } from '../platform/platform';
import { nativeMonitorFromPoint as monitorFromPoint } from '../platform/native-bridge';
import type { WorkbenchExtensions } from '../runtime';
import type { DocumentTab, useWorkspaceStore } from '../stores/workspace';
import { documentTabLabel } from '../tabs/tab-label';
import type { WindowContext } from '../windows/context';
import type { useAuxiliaryWindows } from '../windows/manager';
import { detachedWindowPosition, type DetachedDropPoint } from '../windows/position';
import type { SourceEditor } from '../shell/workbench-async-components';
import { useWorkspaceSearch } from '../workspace/workspace-search';
import { workspaceArchive, workspaceArchiveName } from '../workspace/workspace-export';

export interface WorkbenchModalsDeps {
  store: ReturnType<typeof useWorkspaceStore>;
  workspaceAdapter: WorkspaceAdapter;
  attachments: AttachmentService | undefined;
  editing: WorkbenchExtensions['editing'];
  auxiliaryWindows: ReturnType<typeof useAuxiliaryWindows>;
  activeWindow: Ref<WindowContext>;
  compactPanes: Ref<boolean>;
  sidebar: Ref<boolean>;
  sidebarView: Ref<string>;
  menu: Ref<boolean>;
  workspaceMenu: Ref<boolean>;
  settingsPanel: Ref<boolean>;
  updateLock: Ref<boolean>;
  editorReadonly: Ref<boolean>;
  source: Ref<boolean>;
  sourceEditor: Ref<InstanceType<typeof SourceEditor> | undefined>;
  editorScroll: Ref<HTMLElement | undefined>;
  assistantTab: Ref<{ id: string; title: string } | undefined>;
  selectedEntryIds: Ref<Set<string>>;
  selectedEntries: Ref<FileEntry[]>;
  fileContextMenu: Ref<{ file: FileEntry; x: number; y: number } | null>;
  directoryContextMenu: Ref<{ parent: string; x: number; y: number } | null>;
  selectActiveFileInTree: () => void;
  fileDeleteDisabled: (file: FileEntry) => boolean;
  sessionBlocksFileMutation: (id: string) => boolean;
  withFileMutation: <T>(ids: string[], mutation: () => Promise<T>) => Promise<T>;
  fileMutationIds: (entries: FileEntry[]) => string[];
  markInitialPageRouteSuperseded: () => void;
}

export function useWorkbenchModals(deps: WorkbenchModalsDeps) {
  const {
    store,
    workspaceAdapter,
    attachments,
    editing,
    auxiliaryWindows,
    activeWindow,
    compactPanes,
    sidebar,
    sidebarView,
    menu,
    workspaceMenu,
    settingsPanel,
    updateLock,
    editorReadonly,
    source,
    sourceEditor,
    editorScroll,
    assistantTab,
    selectedEntryIds,
    selectedEntries,
    fileContextMenu,
    directoryContextMenu,
    selectActiveFileInTree,
    fileDeleteDisabled,
    sessionBlocksFileMutation,
    withFileMutation,
    fileMutationIds,
    markInitialPageRouteSuperseded,
  } = deps;
  const { workspace, active, activeId } = storeToRefs(store);

  const modal = ref<'' | 'newTab' | 'search' | 'delete' | 'saveAs'>('');
  const modalTarget = ref<FileEntry | null>(null);
  const modalDeleteEntries = ref<FileEntry[]>([]);
  const modalDeleteContents = ref<FileEntry[]>([]);
  const modalDeleteWorkspaceId = ref<string>();
  const input = ref('');
  const modalError = ref('');
  const modalBusy = ref(false);
  const inputEl = ref<HTMLInputElement | null>(null);

  function setModalInputElement(value: unknown) {
    inputEl.value = value instanceof HTMLInputElement ? value : null;
  }

  watch(
    () => workspace.value?.files,
    (files) => {
      if (modal.value !== 'delete' || modalBusy.value || !files) return;
      const roots = topLevelEntries(modalDeleteEntries.value);
      if (!roots.length) return;
      const withinSelection = (path: string) =>
        roots.some(
          (root) =>
            path === root.path || (root.kind === 'directory' && path.startsWith(`${root.path}/`)),
        );
      const previous = modalDeleteContents.value.filter((entry) => withinSelection(entry.path));
      const current = files.filter((entry) => withinSelection(entry.path));
      if (
        roots.every((root) =>
          files.some((entry) => entry.id === root.id && entry.path === root.path),
        ) &&
        previous.length === current.length &&
        current.every((entry) =>
          previous.some(
            (old) =>
              old.id === entry.id &&
              old.path === entry.path &&
              (entry.kind === 'directory' ||
                (old.modified === entry.modified && old.size === entry.size)),
          ),
        )
      )
        return;
      modalDeleteEntries.value = roots.flatMap(
        (root) => files.find((entry) => entry.id === root.id) ?? [],
      );
      modalDeleteContents.value = [...files];
      modalError.value = modalDeleteEntries.value.length
        ? t('目录已自动更新，请核对所选条目后再次确认。')
        : t('所选条目已移除，目录已自动更新。请关闭此窗口后重新选择。');
    },
  );

  // Workspace search
  const { hits: searchHits, busy: searching, error: searchError } = useWorkspaceSearch({
    query: input,
    enabled: () => modal.value === 'search',
    workspace,
    search: (query, signal) => store.search(query, signal),
  });

  const searchResults = computed(() => {
    const files = workspace.value?.files.filter((f) => f.kind === 'file' && isMarkdown(f.path)) ?? [];
    const query = input.value.trim().toLocaleLowerCase();
    if (!query) return [];
    return searchHits.value.flatMap((hit) => {
      const file = files.find((file) => file.id === hit.id && file.path === hit.path);
      if (!file) return [];
      const excerpt = hit.excerpt.replace(/\s+/g, ' ').trim();
      const preview = excerpt.toLocaleLowerCase().includes(query)
        ? excerpt
        : hit.path.toLocaleLowerCase().includes(query)
          ? hit.path
          : excerpt || hit.path;
      return [{ ...file, preview }];
    });
  });

  function searchResultLocation(path: string) {
    return [workspace.value?.name ?? t('工作区'), ...path.split('/').slice(0, -1)].join(' › ');
  }

  async function openSearchResult(file: FileEntry) {
    modal.value = '';
    await store.openFile(file);
    if (store.active?.id === file.id) recordHelpCompleted('find');
  }

  function searchHighlightParts(text: string) {
    const query = input.value.trim();
    if (!query) return [{ text, matched: false }];
    const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
    const parts: { text: string; matched: boolean }[] = [];
    let cursor = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index > cursor) parts.push({ text: text.slice(cursor, match.index), matched: false });
      parts.push({ text: match[0], matched: true });
      cursor = match.index + match[0].length;
    }
    if (cursor < text.length) parts.push({ text: text.slice(cursor), matched: false });
    return parts.length ? parts : [{ text, matched: false }];
  }

  const modalTitle = computed(() => {
    const titles = {
      newTab: t('打开文件'),
      search: t('找到那一页'),
      delete: `${store.isDemo ? t('删除') : store.isWeb ? t('删除在线文档') : mobile ? t('移入手机回收站') : t('移入回收站')}${modalDeleteEntries.value.length > 1 ? t(' · {0} 项', [modalDeleteEntries.value.length]) : ''}`,
      saveAs: t('另存为新文档'),
    };
    return modal.value ? titles[modal.value] : '';
  });

  function showModal(kind: Exclude<typeof modal.value, ''>, target?: FileEntry) {
    if (store.busy || (workspace.value?.readOnly && ['delete', 'saveAs'].includes(kind))) return;
    menu.value = false;
    workspaceMenu.value = false;
    fileContextMenu.value = null;
    directoryContextMenu.value = null;
    settingsPanel.value = false;
    modalTarget.value = target ?? null;
    modalDeleteEntries.value =
      kind === 'delete'
        ? target && selectedEntryIds.value.has(target.id)
          ? [...selectedEntries.value]
          : target
            ? [target]
            : active.value
              ? [workspace.value?.files.find((file) => file.id === active.value?.id)].filter(
                  (file): file is FileEntry => !!file,
                )
              : []
        : [];
    modalDeleteContents.value = kind === 'delete' ? [...(workspace.value?.files ?? [])] : [];
    modalDeleteWorkspaceId.value = kind === 'delete' ? workspace.value?.id : undefined;
    modalError.value = '';
    input.value =
      kind === 'saveAs'
        ? (active.value?.path.replace(/\.(md|markdown)$/i, '-副本.md') ?? '')
        : '';
    modal.value = kind;
    void nextTick(() => {
      inputEl.value?.focus();
    });
  }

  async function removeDocuments(entries: FileEntry[]) {
    if (!entries.length || entries.some(fileDeleteDisabled)) return;
    if (store.isDemo || store.isWeb) {
      showModal('delete', entries[0]);
      return;
    }
    menu.value = false;
    try {
      await store.removeEntries(entries, workspace.value?.id, [...(workspace.value?.files ?? [])]);
      selectActiveFileInTree();
    } catch (error) {
      store.report(error);
    }
  }

  async function removeDocument(target?: FileEntry) {
    if (
      !target &&
      (editorReadonly.value ||
        sessionBlocksFileMutation(active.value?.id ?? activeId.value) ||
        editing.activeBusy)
    )
      return;
    const entries = target
      ? [target]
      : active.value
        ? [workspace.value?.files.find((file) => file.id === active.value?.id)].filter(
            (file): file is FileEntry => !!file,
          )
        : [];
    await removeDocuments(entries);
  }

  async function createNewEntry(kind: 'document' | 'folder' | 'table', parent = '') {
    if (store.busy || workspace.value?.readOnly || updateLock.value) return;
    markInitialPageRouteSuperseded();
    menu.value = false;
    workspaceMenu.value = false;
    fileContextMenu.value = null;
    directoryContextMenu.value = null;
    modal.value = '';
    try {
      if (kind === 'folder') {
        await store.createUntitledFolder(parent);
        return;
      }
      if (kind === 'table') {
        await store.createDataTable('blank', parent);
        if (compactPanes.value) sidebar.value = false;
        return;
      }
      await store.createUntitledDocument(parent);
      if (compactPanes.value) sidebar.value = false;
      await nextTick();
      for (let attempt = 0; attempt < 10; attempt++) {
        const target = source.value
          ? sourceEditor.value
          : editorScroll.value?.querySelector<HTMLElement>('[contenteditable="true"]');
        if (target) {
          target.focus();
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
    } catch (error) {
      store.report(error);
    }
  }

  async function createNewDocument() {
    await createNewEntry('document');
  }

  async function submitModal() {
    if (modalBusy.value) return;
    modalError.value = '';
    modalBusy.value = true;
    try {
      const kind = modal.value;
      if (
        modalTarget.value &&
        kind === 'delete' &&
        sessionBlocksFileMutation(modalTarget.value.id)
      )
        throw new Error(t('请先结束此文档的实时协作'));
      if (kind === 'delete') {
        if (modalDeleteEntries.value.some(fileDeleteDisabled))
          throw new Error(t('所选条目中有无法移除的文件，请检查权限或实时协作状态'));
        await withFileMutation(fileMutationIds(modalDeleteEntries.value), () =>
          store.removeEntries(
            modalDeleteEntries.value,
            modalDeleteWorkspaceId.value,
            modalDeleteContents.value,
          ),
        );
        selectActiveFileInTree();
      } else {
        let path = input.value.trim();
        if (!isMarkdown(path)) path += '.md';
        const error = validatePath(path);
        if (error) throw new Error(error);
        if (!input.value.trim()) throw new Error(t('请填写一个名称'));
        if (kind === 'saveAs' && active.value) await store.saveCopy(active.value, path);
      }
      modal.value = '';
    } catch (e) {
      if (modal.value === 'delete') {
        const files = workspace.value?.files ?? [];
        modalDeleteEntries.value = modalDeleteEntries.value.flatMap(
          (file) => files.find((entry) => entry.id === file.id) ?? [],
        );
        modalDeleteContents.value = [...files];
      }
      modalError.value = e instanceof Error ? e.message : String(e);
    } finally {
      modalBusy.value = false;
    }
  }

  // Tab detachment into auxiliary window
  let detachingTab = false;
  function detachedTitle(tab: DocumentTab) {
    return assistantTab.value?.id === tab.id ? assistantTab.value.title : documentTabLabel(tab);
  }

  async function detachTab(id: string, drop?: DetachedDropPoint, settled?: () => void) {
    if (
      !native ||
      mobile ||
      detachingTab ||
      !workspace.value ||
      store.busy ||
      drop?.insideSourceWindow
    ) {
      settled?.();
      return;
    }
    const tab = store.tabs.find((item) => item.id === id);
    if (!tab) {
      settled?.();
      return;
    }
    detachingTab = true;
    try {
      await editing.flush();
      let position: { x: number; y: number } | undefined;
      if (drop) {
        const monitor = await monitorFromPoint(drop.x, drop.y);
        const scale = monitor?.scaleFactor ?? (await activeWindow.value.native!.scaleFactor());
        position = detachedWindowPosition(drop, scale, 1100, 760, monitor?.workArea);
      }
      const windowId = crypto.randomUUID();
      await auxiliaryWindows.open(
        windowId,
        'tab',
        detachedTitle(tab) + ' — Tano / 同页',
        position,
        (entry) => {
          activeWindow.value = entry.context;
          store.moveTabToAuxiliaryWindow(id, windowId);
        },
      );
    } catch (error) {
      store.report(error);
    } finally {
      detachingTab = false;
      settled?.();
    }
  }

  // Workspace export, deletion, creation, leaving & home navigation
  const workspaceExporting = ref(false);
  const workspaceExportError = ref('');
  const workspaceDeleting = ref(false);
  const workspaceDeletionError = ref('');
  watch(
    () => workspace.value?.id,
    () => {
      workspaceDeletionError.value = '';
    },
  );

  async function deleteWorkspace(workspaceId: string) {
    if (
      workspaceDeleting.value ||
      store.busy ||
      workspaceExporting.value ||
      store.workspaceSettingsSaving
    )
      return;
    workspaceDeleting.value = true;
    workspaceDeletionError.value = '';
    try {
      if (workspace.value?.id !== workspaceId) throw new Error(t('工作区已切换，请重新确认删除'));
      await editing.flush();
      if (!(await store.deleteWorkspace(workspaceId)))
        throw new Error(store.fatal || t('无法删除工作区，请稍后重试'));
      settingsPanel.value = false;
      workspaceMenu.value = false;
      if (native && !mobile) await auxiliaryWindows.close('settings');
    } catch (error) {
      workspaceDeletionError.value = error instanceof Error ? error.message : String(error);
    } finally {
      workspaceDeleting.value = false;
    }
  }

  async function exportWorkspace(workspaceId: string) {
    if (workspaceExporting.value || workspaceDeleting.value) return;
    workspaceExporting.value = true;
    workspaceExportError.value = '';
    const assertCurrent = () => {
      if (workspace.value?.id !== workspaceId) throw new Error(t('工作区已切换，请重新导出'));
    };
    try {
      assertCurrent();
      await editing.flush();
      if (!(await store.flush()))
        throw new Error(t('还有未保存的修改，请处理保存错误后再导出'));
      assertCurrent();
      await store.refresh();
      assertCurrent();
      const current = workspace.value!;
      const blob = await workspaceArchive(
        current,
        workspaceAdapter,
        attachments?.readAttachment,
        assertCurrent,
      );
      const filename = workspaceArchiveName(current.name);
      if (native) {
        const { saveDocumentExport } = await import('../documents/native-document-export');
        await saveDocumentExport(blob, filename, 'zip');
      } else {
        const { downloadExport } = await import('../documents/document-export');
        downloadExport(blob, filename);
      }
    } catch (error) {
      workspaceExportError.value = String(error instanceof Error ? error.message : error);
    } finally {
      workspaceExporting.value = false;
    }
  }

  async function createNewWorkspace() {
    if (store.busy) return;
    menu.value = false;
    workspaceMenu.value = false;
    fileContextMenu.value = null;
    directoryContextMenu.value = null;
    settingsPanel.value = false;
    modal.value = '';
    await store.createWorkspace();
    if (workspace.value) sidebarView.value = 'repository';
  }

  async function leaveWorkspace() {
    if (store.busy || !workspace.value) return;
    try {
      await editing.flush();
      if (await store.leaveWorkspace()) workspaceMenu.value = false;
    } catch (error) {
      store.report(error);
    }
  }

  let returningHome = false;
  async function returnHome(event: MouseEvent) {
    const { window: activeWin } = activeWindow.value;
    if (
      native ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    if (store.busy || returningHome) return;
    returningHome = true;
    try {
      if (!(await store.flush())) {
        store.report(t('还有未保存的修改，请保存或另存副本后再返回首页。'));
        return;
      }
      await editing.flush();
      activeWin.location.assign('/');
    } catch (error) {
      store.report(error);
    } finally {
      returningHome = false;
    }
  }

  return {
    modal,
    modalTarget,
    modalDeleteEntries,
    input,
    modalError,
    modalBusy,
    inputEl,
    setModalInputElement,
    searchResults,
    searching,
    searchError,
    searchResultLocation,
    openSearchResult,
    searchHighlightParts,
    modalTitle,
    showModal,
    removeDocuments,
    removeDocument,
    createNewEntry,
    createNewDocument,
    submitModal,
    detachedTitle,
    detachTab,
    workspaceExporting,
    workspaceExportError,
    workspaceDeleting,
    workspaceDeletionError,
    deleteWorkspace,
    exportWorkspace,
    createNewWorkspace,
    leaveWorkspace,
    returnHome,
  };
}
