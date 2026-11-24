import { computed, nextTick, ref, watch, type Ref } from 'vue';
import { storeToRefs } from 'pinia';
import { isMouseEvent } from '@tano/editor/dom-realm';
import {
  basename,
  isDataTableFilePath,
  isMarkdown,
  isWorkspaceInternalPath,
  parentPath,
  validatePath,
  type FileEntry,
  type RecentWorkspace,
  type ReferenceIdentity,
  type WorkspaceAdapter,
} from '@tano/protocol';
import { openWorkspaceEntry, workspaceEntryPath, type AttachmentService } from '../attachments';
import type FileTree from '../components/FileTree.vue';
import { tableFileId } from '../data-tables';
import { appearanceText } from '../document-appearance';
import { fileDragImage, settleFileDragCard } from '../file-drag-image';
import { applyFileMovePreview, planFileMovePreview, type FileMovePreview } from '../file-move';
import { selectTreeEntry, topLevelEntries } from '../file-selection';
import { DROP_PLACEHOLDER_PREFIX } from '../file-tree-model';
import { planFolderConversion, type FolderConversionKind } from '../folder-conversion';
import { indexFolderHomes } from '../folder-home';
import { t } from '../i18n';
import { mobile } from '../platform';
import type { useWorkspaceStore } from '../stores/workspace';
import { pageRouteUrl } from '../web-navigation';
import type { WindowContext } from '../windows/context';

export type WorkspaceEntry = Pick<RecentWorkspace, 'id' | 'name' | 'path' | 'icon'>;

export interface FileTreeControllerDeps {
  store: ReturnType<typeof useWorkspaceStore>;
  workspaceAdapter: WorkspaceAdapter;
  attachments: AttachmentService | undefined;
  localNative: boolean;
  activeWindow: Ref<WindowContext>;
  menu: Ref<boolean>;
  workspaceMenu: Ref<boolean>;
  updateLock: Ref<boolean>;
  showDocumentProperties: Ref<boolean>;
  setPaneSource: (id: string, value: boolean) => void;
  sessionBlocksFileMutation: (id: string) => boolean;
  withFileMutation: <T>(ids: string[], mutation: () => Promise<T>) => Promise<T>;
  fileMutationIds: (entries: FileEntry[]) => string[];
  closePageContextMenu: () => void;
  closeOutlineContextMenu: () => void;
  selectContext: (context: 'home' | 'workspace') => void;
  openEntry: (file: FileEntry, newTab?: boolean) => Promise<void>;
  openImport: () => void;
  showFileObject: (identity: ReferenceIdentity) => void;
  createNewEntry: (kind: 'document' | 'folder', parent?: string) => Promise<void>;
  removeDocument: (target?: FileEntry) => Promise<void>;
  removeDocuments: (entries: FileEntry[]) => Promise<void>;
}

export function useFileTreeController(deps: FileTreeControllerDeps) {
  const {
    store,
    workspaceAdapter,
    attachments,
    localNative,
    activeWindow,
    menu,
    workspaceMenu,
    updateLock,
    showDocumentProperties,
    setPaneSource,
    sessionBlocksFileMutation,
    withFileMutation,
    fileMutationIds,
    closePageContextMenu,
    closeOutlineContextMenu,
    selectContext,
    openEntry,
    openImport,
    showFileObject,
    createNewEntry,
    removeDocument,
    removeDocuments,
  } = deps;
  const { workspace, activeId, busy } = storeToRefs(store);

  const workspaceEntryContextMenu = ref<{ item: WorkspaceEntry; x: number; y: number } | null>(null);
  const workspaceEntryContextMenuElement = ref<HTMLElement>();
  let workspaceEntryContextTrigger: HTMLElement | null = null;
  const fileContextMenu = ref<{ file: FileEntry; x: number; y: number } | null>(null);
  const fileMetadataTarget = ref<{ fileId: string; workspaceId: string } | null>(null);
  const directoryContextMenu = ref<{ parent: string; x: number; y: number } | null>(null);

  const selectedEntryIds = ref<Set<string>>(new Set());
  const selectionAnchorId = ref<string | null>(null);
  const pendingTreeOpenIds = new Set<string>();
  const selectedEntries = computed(
    () => workspace.value?.files.filter((entry) => selectedEntryIds.value.has(entry.id)) ?? [],
  );

  const draggedEntry = ref<{ file: FileEntry; workspaceId: string } | null>(null);
  const draggedSelection = ref<FileEntry[]>([]);
  const tabFileDrag = computed(() =>
    draggedEntry.value
      ? {
          workspaceId: draggedEntry.value.workspaceId,
          ids: draggedSelection.value.map((file) => file.id),
        }
      : undefined,
  );
  const dropFolder = ref<string | null>(null);
  const moveBusy = ref(false);
  const optimisticFileMove = ref<{ workspaceId: string; changes: FileMovePreview[] } | null>(null);
  const fileTree = ref<InstanceType<typeof FileTree>>();
  const revealedHomeId = ref('');
  let fileContextTrigger: HTMLElement | null = null;
  const treeRename = ref<{ fileId: string; workspaceId: string } | null>(null);

  const treeFiles = computed(() => {
    const files = (workspace.value?.files ?? []).filter(
      (file) => !isWorkspaceInternalPath(file.path),
    );
    const preview = optimisticFileMove.value;
    return preview && workspace.value?.id === preview.workspaceId
      ? applyFileMovePreview(files, preview.changes)
      : files;
  });

  const folderHomes = computed(() =>
    indexFolderHomes(treeFiles.value, store.workspaceSettings.folderHomeFileName),
  );
  const homeFolderIds = computed(() => {
    const ids = new Map<string, string>();
    for (const folder of treeFiles.value) {
      const home = folder.kind === 'directory' && folderHomes.value.get(folder.path);
      if (home) ids.set(home.id, folder.id);
    }
    return ids;
  });

  function folderRowId(id: string) {
    return id === revealedHomeId.value ? id : (homeFolderIds.value.get(id) ?? id);
  }

  watch(
    () => [workspace.value?.id, store.workspaceSettings.folderHomeFileName],
    () => {
      revealedHomeId.value = '';
    },
  );
  watch([homeFolderIds, revealedHomeId], () => {
    selectedEntryIds.value = new Set([...selectedEntryIds.value].map(folderRowId));
    if (selectionAnchorId.value) selectionAnchorId.value = folderRowId(selectionAnchorId.value);
  });

  watch(
    () => workspace.value?.files,
    (files, previousFiles) => {
      const available = new Set(files?.map((file) => file.id));
      const hadSelection = selectedEntryIds.value.size > 0;
      selectedEntryIds.value = new Set([...selectedEntryIds.value].filter((id) => available.has(id)));
      if (selectionAnchorId.value && !available.has(selectionAnchorId.value))
        selectionAnchorId.value = null;
      if (
        !selectedEntryIds.value.size &&
        activeId.value &&
        available.has(activeId.value) &&
        (hadSelection || !previousFiles?.some((file) => file.id === activeId.value))
      ) {
        selectedEntryIds.value = new Set([activeId.value]);
        selectionAnchorId.value = activeId.value;
      }
    },
  );

  function selectActiveFileInTree() {
    const activeFileId = activeId.value.startsWith('table:')
      ? tableFileId(activeId.value)
      : activeId.value;
    const id = folderRowId(activeFileId);
    const available = !!id && workspace.value?.files.some((file) => file.id === id);
    selectedEntryIds.value = available ? new Set([id]) : new Set();
    selectionAnchorId.value = available ? id : null;
  }

  const contextEntries = computed(() => (fileContextMenu.value ? selectedEntries.value : []));
  const multipleContextEntries = computed(() => contextEntries.value.length > 1);
  const contextFolderHome = computed(() =>
    fileContextMenu.value?.file.kind === 'directory'
      ? folderHomes.value.get(fileContextMenu.value.file.path)
      : undefined,
  );

  const treeDocumentIcons = computed(() =>
    Object.fromEntries([
      ...store.documents.map((doc) => [doc.id, appearanceText(doc.content, 'icon')]),
      ...store.dataTableRecords.map((record) => [record.fileId, record.draft.icon ?? '']),
    ]),
  );

  let documentIconReads: Promise<void> = Promise.resolve();
  function loadTreeDocumentIcon(file: FileEntry, signal: AbortSignal): Promise<string> {
    const expected = workspace.value && { id: workspace.value.id, path: workspace.value.path };
    // Join the filesystem queue one read at a time so sidebar work cannot hold up opening a page.
    const read = documentIconReads.then(async () => {
      if (
        signal.aborted ||
        !expected ||
        workspace.value?.id !== expected.id ||
        workspace.value.path !== expected.path
      )
        return '';
      const content = await store.readGraphDocument(expected, { id: file.id });
      return appearanceText(content, 'icon');
    });
    documentIconReads = read.then(
      () => {},
      () => {},
    );
    return read;
  }

  const managedFilePaths = computed(
    () =>
      workspace.value?.files
        .filter((entry) => entry.kind === 'file' && sessionBlocksFileMutation(entry.id))
        .map((entry) => entry.path) ?? [],
  );

  function closeFileContextMenu(restoreFocus = false) {
    fileContextMenu.value = null;
    if (restoreFocus) void nextTick(() => fileContextTrigger?.focus({ preventScroll: true }));
  }

  function closeDirectoryContextMenu() {
    directoryContextMenu.value = null;
  }

  function closeWorkspaceEntryContextMenu(restoreFocus = false) {
    workspaceEntryContextMenu.value = null;
    if (restoreFocus)
      void nextTick(() => workspaceEntryContextTrigger?.focus({ preventScroll: true }));
  }

  watch(
    () => workspace.value?.id,
    () => {
      fileContextMenu.value = null;
      selectedEntryIds.value = new Set();
      selectionAnchorId.value = null;
      pendingTreeOpenIds.clear();
      draggedEntry.value = null;
      draggedSelection.value = [];
      dropFolder.value = null;
      optimisticFileMove.value = null;
      treeRename.value = null;
      closeWorkspaceEntryContextMenu();
    },
  );

  function fileMutationDisabled(file: FileEntry) {
    return (
      !!workspace.value?.readOnly ||
      !!file.readOnly ||
      store.busy ||
      updateLock.value ||
      sessionBlocksFileMutation(file.id)
    );
  }

  function canDuplicateEntry(_file: FileEntry) {
    return !mobile && !!workspaceAdapter.duplicate && (localNative || store.isWeb);
  }

  function directoryHasManagedFile(file: FileEntry) {
    return (
      file.kind === 'directory' &&
      managedFilePaths.value.some((path) => path.startsWith(`${file.path}/`))
    );
  }

  function fileDeleteDisabled(file: FileEntry) {
    return (
      fileMutationDisabled(file) ||
      (mobile && file.kind === 'directory') ||
      directoryHasManagedFile(file)
    );
  }

  const selectionDeleteDisabled = computed(() => contextEntries.value.some(fileDeleteDisabled));

  function startTreeRename(file: FileEntry) {
    if (!workspace.value || fileMutationDisabled(file) || directoryHasManagedFile(file)) return;
    closeFileContextMenu();
    treeRename.value = { fileId: file.id, workspaceId: workspace.value.id };
  }

  function finishTreeRename(file: FileEntry) {
    if (treeRename.value?.fileId === file.id) treeRename.value = null;
  }

  async function renameTreeEntry(file: FileEntry, name: string) {
    if (treeRename.value?.workspaceId !== workspace.value?.id)
      throw new Error(t('工作区已切换，请重新选择后重试'));
    const current = workspace.value?.files.find((entry) => entry.id === file.id);
    if (!current || current.path !== file.path)
      throw new Error(t('文件位置已变化，请按 Esc 取消后重新选择'));
    if (fileMutationDisabled(current) || directoryHasManagedFile(current))
      throw new Error(t('当前条目暂时无法重命名，请检查权限或实时协作状态'));
    name = name.trim().normalize('NFC');
    if (!name) throw new Error(t('请填写一个名称'));
    if (/[\/\\]/.test(name)) throw new Error(t('名称不能包含路径分隔符'));
    if (file.kind === 'file' && isMarkdown(file.path) && !isMarkdown(name))
      name += file.name.match(/\.(md|markdown)$/i)?.[0] ?? '.md';
    if (isDataTableFilePath(file.path) && !/\.table\.json$/i.test(name)) name += '.table.json';
    const folder = parentPath(file.path);
    const path = `${folder ? `${folder}/` : ''}${name}`;
    const error = validatePath(path);
    if (error) throw new Error(error);
    if (path !== file.path)
      await withFileMutation(fileMutationIds([file]), () => store.renameEntry(file, path));
  }

  function folderConversionIssue(file: FileEntry, kind: FolderConversionKind) {
    if (!store.canConvertFolderDocuments) return t('当前存储适配器尚不支持安全的文档与文件夹转换');
    if (store.folderConversionBusy) return t('正在转换文档，请稍候');
    try {
      planFolderConversion(treeFiles.value, file, store.workspaceSettings.folderHomeFileName, kind);
      return '';
    } catch (error) {
      return t(error instanceof Error ? error.message : String(error));
    }
  }

  async function convertDocumentStructure(kind: FolderConversionKind) {
    const file = fileContextMenu.value?.file;
    closeFileContextMenu();
    if (!file) return;
    try {
      const created = await store.convertDocumentStructure(file, kind);
      if (created && kind === 'child') startTreeRename(created);
    } catch (error) {
      store.report(error);
    }
  }

  async function openTreeEntry(file: FileEntry) {
    pendingTreeOpenIds.add(file.id);
    try {
      await openEntry(file);
    } finally {
      await nextTick();
      pendingTreeOpenIds.delete(file.id);
    }
  }

  async function folderHomeContextAction(showFile: boolean) {
    const home = contextFolderHome.value;
    if (!home) return;
    const hideFile = showFile && revealedHomeId.value === home.id;
    closeFileContextMenu(hideFile);
    if (showFile) {
      if (hideFile) {
        revealedHomeId.value = '';
        return;
      }
      revealedHomeId.value = home.id;
      selectedEntryIds.value = new Set([home.id]);
      selectionAnchorId.value = home.id;
    } else await openTreeEntry(home);
  }

  // Drag & drop
  // Dragging only needs to be possible so entries can be dropped on tabs, the editor or
  // the assistant (references / open). Whether a drop may *move* files is decided separately.
  function canDragEntry(_file: FileEntry) {
    return !!workspace.value && !updateLock.value;
  }

  function canMoveEntry(file: FileEntry) {
    if (
      !workspace.value ||
      workspace.value.readOnly ||
      busy.value ||
      updateLock.value ||
      moveBusy.value
    )
      return false;
    return file.kind === 'directory'
      ? !managedFilePaths.value.some((path) => path.startsWith(`${file.path}/`))
      : !sessionBlocksFileMutation(file.id);
  }

  function planDropIn(folder: string): FileMovePreview[] | null {
    const drag = draggedEntry.value;
    if (
      !drag ||
      !workspace.value ||
      drag.workspaceId !== workspace.value.id ||
      !draggedSelection.value.length ||
      !draggedSelection.value.every(canMoveEntry)
    )
      return null;
    try {
      return planFileMovePreview(draggedSelection.value, folder, workspace.value.files);
    } catch {
      return null;
    }
  }

  // Slot preview: while a valid folder is hovered, the tree shows where the dragged
  // entries would land as placeholder rows (the real rows stay put so the native
  // drag source is never re-parented mid-drag).
  const dropPlaceholders = computed<FileEntry[]>(() => {
    const folder = dropFolder.value;
    if (folder === null || !draggedEntry.value) return [];
    const changes = planDropIn(folder);
    if (!changes) return [];
    const byId = new Map(changes.map((change) => [change.id, change.to]));
    return draggedSelection.value.flatMap((file) => {
      const path = byId.get(file.id);
      return path
        ? [{ ...file, id: `${DROP_PLACEHOLDER_PREFIX}${file.id}`, path, name: basename(path) }]
        : [];
    });
  });

  // The slot preview changes row layout under a stationary pointer. Retargeting only
  // counts when the pointer itself moved, otherwise the shifted rows would flip the
  // target back and forth.
  let dropPointer: { x: number; y: number } | undefined;
  const pointerMovedSinceTarget = (event: DragEvent) =>
    !dropPointer || Math.hypot(event.clientX - dropPointer.x, event.clientY - dropPointer.y) >= 4;

  function setDropFolder(folder: string | null, event: DragEvent) {
    if (dropFolder.value === folder) return;
    dropFolder.value = folder;
    dropPointer = { x: event.clientX, y: event.clientY };
  }

  // Moving between rows fires dragleave on the old row before the next dragover. Clearing
  // at once would remove the slot placeholder and re-add it a moment later, so its leaving
  // ghost and the arriving row would both claim space. Clear only if no dragover follows.
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  function cancelDropLeave() {
    if (leaveTimer) clearTimeout(leaveTimer);
    leaveTimer = undefined;
  }

  function fileDragStart(file: FileEntry, event: DragEvent) {
    const selection = selectedEntryIds.value.has(file.id)
      ? topLevelEntries(selectedEntries.value)
      : [file];
    if (!selection.every(canDragEntry) || !workspace.value || !event.dataTransfer) {
      event.preventDefault();
      return;
    }
    if (!selectedEntryIds.value.has(file.id)) {
      selectedEntryIds.value = new Set([file.id]);
      selectionAnchorId.value = file.id;
    }
    fileContextMenu.value = null;
    draggedEntry.value = { file, workspaceId: workspace.value.id };
    draggedSelection.value = selection;
    dropFolder.value = null;
    event.dataTransfer.setData(
      'application/x-tano-entry-references',
      JSON.stringify({
        workspace: workspace.value.id,
        ids: store.referenceTargets
          .filter((target) =>
            selection.some(
              (entry) =>
                entry.id === target.id ||
                (entry.kind === 'directory' && target.path.startsWith(`${entry.path}/`)),
            ),
          )
          .map((target) => target.id),
      }),
    );
    event.dataTransfer.effectAllowed = 'copyMove';
    event.dataTransfer.setData(
      'application/x-tano-entry',
      selection.map((entry) => entry.id).join(','),
    );
    // Same card as a dragged tab instead of the browser's row snapshot.
    const row = event.currentTarget as HTMLElement | null;
    if (row) {
      const label =
        selection.length === 1
          ? row.querySelector('.tree-label')?.textContent?.trim() || file.name
          : t('{0} 个文档', [selection.length]);
      const image = fileDragImage(row, label, { x: event.clientX, y: event.clientY });
      if (image) event.dataTransfer.setDragImage(image.canvas, image.x, image.y);
    }
  }

  function fileDragEnd() {
    settleFileDragCard(); // no slot took it (cancelled, or dropped elsewhere): fade in place
    draggedEntry.value = null;
    draggedSelection.value = [];
    dropFolder.value = null;
    dropPointer = undefined;
    cancelDropLeave();
  }

  function fileDragOver(folder: string, event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    cancelDropLeave();
    if (dropFolder.value !== null && dropFolder.value !== folder && !pointerMovedSinceTarget(event))
      folder = dropFolder.value;
    const valid = planDropIn(folder) !== null;
    if (event.dataTransfer) event.dataTransfer.dropEffect = valid ? 'move' : 'none';
    setDropFolder(valid ? folder : null, event);
  }

  function fileDragLeave(folder: string, event: DragEvent) {
    const target = event.currentTarget as HTMLElement | null;
    if (target?.contains(event.relatedTarget as Node | null)) return;
    if (dropFolder.value !== folder || !pointerMovedSinceTarget(event)) return;
    cancelDropLeave();
    const { clientX: x, clientY: y } = event;
    leaveTimer = setTimeout(() => {
      leaveTimer = undefined;
      if (dropFolder.value !== folder) return;
      dropFolder.value = null;
      dropPointer = { x, y };
    }, 120);
  }

  async function fileDrop(folder: string, event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    const drag = draggedEntry.value;
    const entries = draggedSelection.value;
    const preview = planDropIn(folder);
    fileDragEnd();
    if (!preview || !drag) return;
    moveBusy.value = true;
    optimisticFileMove.value = { workspaceId: drag.workspaceId, changes: preview };
    try {
      await withFileMutation(fileMutationIds(entries), async () => {
        for (const entry of entries) await store.moveEntry(entry, folder, drag.workspaceId);
      });
    } catch (error) {
      store.report(error);
    } finally {
      optimisticFileMove.value = null;
      moveBusy.value = false;
    }
  }

  // Context menus (workspace entry, file, directory)
  function openWorkspaceEntryContextMenu(item: WorkspaceEntry, event: MouseEvent) {
    const { window: activeWin, document } = activeWindow.value;
    event.preventDefault();
    closeFileContextMenu();
    closeDirectoryContextMenu();
    closePageContextMenu();
    closeOutlineContextMenu();
    workspaceEntryContextTrigger = event.currentTarget as HTMLElement | null;
    workspaceEntryContextMenu.value = {
      item,
      x: Math.max(8, event.clientX),
      y: Math.max(8, event.clientY),
    };
    void nextTick(() => {
      const contextMenu = document.querySelector<HTMLElement>('.workspace-entry-context-menu');
      if (!contextMenu || !workspaceEntryContextMenu.value) return;
      workspaceEntryContextMenu.value.x = Math.max(
        8,
        Math.min(workspaceEntryContextMenu.value.x, activeWin.innerWidth - contextMenu.offsetWidth - 8),
      );
      workspaceEntryContextMenu.value.y = Math.max(
        8,
        Math.min(
          workspaceEntryContextMenu.value.y,
          activeWin.innerHeight - contextMenu.offsetHeight - 8,
        ),
      );
      contextMenu.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    });
  }

  function workspaceDropdownContextMenu(event: MouseEvent) {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      '[data-workspace-entry-id]',
    );
    const id = target?.dataset.workspaceEntryId;
    const item = id ? store.recent.find((entry) => entry.id === id) : undefined;
    if (item) openWorkspaceEntryContextMenu(item, event);
  }

  function workspaceEntryContextKeydown(event: KeyboardEvent) {
    const { document } = activeWindow.value;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeWorkspaceEntryContextMenu(true);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [
      ...(workspaceEntryContextMenuElement.value?.querySelectorAll<HTMLButtonElement>(
        'button:not(:disabled)',
      ) ?? []),
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
    items[next]?.focus({ preventScroll: true });
  }

  function workspaceEntryContextAction(action: 'open' | 'reveal') {
    const item = workspaceEntryContextMenu.value?.item;
    if (!item) return;
    closeWorkspaceEntryContextMenu();
    if (action === 'open') {
      workspaceMenu.value = false;
      if (item.id === workspace.value?.id) selectContext('workspace');
      else void store.openWorkspace(item.path);
    } else if (action === 'reveal') {
      void store.reveal();
    }
  }

  function selectFileTreeEntry(file: FileEntry, event: MouseEvent) {
    const visibleIds = fileTree.value?.getVisibleIds() ?? [];
    const next = selectTreeEntry(
      { ids: selectedEntryIds.value, anchor: selectionAnchorId.value },
      file.id,
      visibleIds,
      event,
    );
    selectedEntryIds.value = next.ids;
    selectionAnchorId.value = next.anchor;
    closeFileContextMenu();
  }

  function openFileContextMenu(file: FileEntry, event: MouseEvent | KeyboardEvent) {
    const { window: activeWin, document } = activeWindow.value;
    closeDirectoryContextMenu();
    closeOutlineContextMenu();
    closePageContextMenu();
    if (!selectedEntryIds.value.has(file.id)) {
      selectedEntryIds.value = new Set([file.id]);
      selectionAnchorId.value = file.id;
    }
    const trigger = event.currentTarget as HTMLElement | null;
    fileContextTrigger = trigger;
    const rect = trigger?.getBoundingClientRect();
    const x = isMouseEvent(event) ? event.clientX : (rect?.left ?? 0) + 24;
    const y = isMouseEvent(event) ? event.clientY : (rect?.bottom ?? 0);
    menu.value = false;
    workspaceMenu.value = false;
    fileContextMenu.value = {
      file,
      x: Math.max(8, x),
      y: Math.max(8, y),
    };
    void nextTick(() => {
      const contextMenu = document.querySelector<HTMLElement>('.file-context-menu');
      if (!contextMenu || fileContextMenu.value?.file !== file) return;
      fileContextMenu.value.x = Math.max(
        8,
        Math.min(x, activeWin.innerWidth - contextMenu.offsetWidth - 8),
      );
      fileContextMenu.value.y = Math.max(
        8,
        Math.min(y, activeWin.innerHeight - contextMenu.offsetHeight - 8),
      );
      contextMenu.focus({ preventScroll: true });
    });
  }

  function openDirectoryContextMenu(parent: string, event: MouseEvent) {
    const { window: activeWin, document } = activeWindow.value;
    event.preventDefault();
    closeFileContextMenu();
    closeOutlineContextMenu();
    closePageContextMenu();
    const trigger = event.currentTarget as HTMLElement | null;
    const rect = trigger?.getBoundingClientRect();
    const x = event.clientX || (rect?.left ?? 0) + 24;
    const y = event.clientY || (rect?.top ?? 0) + 24;
    directoryContextMenu.value = {
      parent,
      x: Math.max(8, x),
      y: Math.max(8, y),
    };
    void nextTick(() => {
      const contextMenu = document.querySelector<HTMLElement>('.directory-context-menu');
      if (!contextMenu || !directoryContextMenu.value) return;
      directoryContextMenu.value.x = Math.max(
        8,
        Math.min(x, activeWin.innerWidth - contextMenu.offsetWidth - 8),
      );
      directoryContextMenu.value.y = Math.max(
        8,
        Math.min(y, activeWin.innerHeight - contextMenu.offsetHeight - 8),
      );
      contextMenu.focus({ preventScroll: true });
    });
  }

  async function directoryContextAction(
    action: 'document' | 'folder' | 'import' | 'duplicate' | 'copy' | 'rename' | 'delete',
  ) {
    const parent = directoryContextMenu.value?.parent ?? '';
    const target = parent
      ? workspace.value?.files.find((entry) => entry.kind === 'directory' && entry.path === parent)
      : undefined;
    closeDirectoryContextMenu();
    if (action === 'import') {
      openImport();
      return;
    }
    if (parent && !target) return;
    if (action === 'copy') {
      if (!parent) return;
      try {
        await navigator.clipboard.writeText(parent);
      } catch (error) {
        store.report(error);
      }
      return;
    }
    if (action === 'duplicate') {
      if (!target || !canDuplicateEntry(target) || fileMutationDisabled(target)) return;
      try {
        await store.duplicateEntry(target, workspace.value?.id);
      } catch (error) {
        store.report(error);
      }
      return;
    }
    if (action === 'rename') {
      if (!target || fileMutationDisabled(target) || directoryHasManagedFile(target)) return;
      startTreeRename(target);
      return;
    }
    if (action === 'delete') {
      if (!target || fileDeleteDisabled(target)) return;
      void removeDocument(target);
      return;
    }
    void createNewEntry(action, parent);
  }

  function directoryContextRenameDisabled() {
    const target = directoryContextMenu.value?.parent
      ? workspace.value?.files.find(
          (entry) =>
            entry.kind === 'directory' && entry.path === directoryContextMenu.value?.parent,
        )
      : undefined;
    return !target || fileMutationDisabled(target) || directoryHasManagedFile(target);
  }

  function directoryContextDuplicateDisabled() {
    const target = directoryContextMenu.value?.parent
      ? workspace.value?.files.find(
          (entry) =>
            entry.kind === 'directory' && entry.path === directoryContextMenu.value?.parent,
        )
      : undefined;
    return !target || !canDuplicateEntry(target) || fileMutationDisabled(target);
  }

  function directoryContextDeleteDisabled() {
    const target = directoryContextMenu.value?.parent
      ? workspace.value?.files.find(
          (entry) =>
            entry.kind === 'directory' && entry.path === directoryContextMenu.value?.parent,
        )
      : undefined;
    return !target || fileDeleteDisabled(target);
  }

  async function fileContextAction(
    action:
      | 'open'
      | 'open-new-tab'
      | 'document'
      | 'folder'
      | 'rename'
      | 'delete'
      | 'copy'
      | 'copy-link'
      | 'copy-full-path'
      | 'duplicate'
      | 'open-default'
      | 'object'
      | 'metadata'
      | 'export'
      | 'reveal-entry',
  ) {
    const { window: activeWin } = activeWindow.value;
    const file = fileContextMenu.value?.file;
    if (!file) return;
    const entries = contextEntries.value;
    closeFileContextMenu();
    if (entries.length > 1) {
      if (action === 'delete') {
        await removeDocuments(entries);
        return;
      }
      if (action === 'copy' || action === 'copy-full-path') {
        try {
          const paths = await Promise.all(
            entries.map((entry) =>
              action === 'copy-full-path' && workspace.value
                ? workspaceEntryPath(workspace.value.id, entry.path)
                : Promise.resolve(entry.path),
            ),
          );
          await navigator.clipboard.writeText(paths.join('\n'));
        } catch (error) {
          store.report(error);
        }
        return;
      }
      if (action === 'duplicate' && localNative && !mobile) {
        try {
          for (const entry of topLevelEntries(entries))
            await store.duplicateEntry(entry, workspace.value?.id);
        } catch (error) {
          store.report(error);
        }
      }
      return;
    }
    if (action === 'open' || action === 'open-new-tab') {
      await openEntry(file, action === 'open-new-tab');
      return;
    }
    if (action === 'object') {
      if (file.kind === 'file' && !isWorkspaceInternalPath(file.path))
        showFileObject({
          type: isMarkdown(file.path) ? 'document' : 'asset',
          id: file.id,
        });
      return;
    }
    if (action === 'metadata' && workspace.value) {
      if (isMarkdown(file.path)) {
        await store.openFile(file);
        showDocumentProperties.value = true;
        setPaneSource(file.id, false);
      } else fileMetadataTarget.value = { fileId: file.id, workspaceId: workspace.value.id };
      return;
    }
    if (action === 'export' && workspace.value && attachments) {
      try {
        await attachments.exportAttachment(workspace.value.id, file.path);
      } catch (error) {
        store.report(error);
      }
      return;
    }
    if (action === 'open-default' || action === 'reveal-entry') {
      if (!workspace.value || !localNative || mobile) return;
      try {
        await openWorkspaceEntry(workspace.value.id, file.path, action === 'reveal-entry');
      } catch (error) {
        store.report(error);
      }
      return;
    }
    if (action === 'copy' || action === 'copy-full-path') {
      try {
        let path = file.path;
        if (action === 'copy-full-path') {
          if (!workspace.value || !localNative || mobile) return;
          path = await workspaceEntryPath(workspace.value.id, file.path);
        }
        await navigator.clipboard.writeText(path);
        fileContextTrigger?.focus({ preventScroll: true });
      } catch (error) {
        store.report(error);
      }
      return;
    }
    if (action === 'copy-link') {
      if (
        !store.isWeb ||
        !workspace.value ||
        file.kind !== 'file' ||
        (!isMarkdown(file.path) && !isDataTableFilePath(file.path))
      )
        return;
      try {
        await navigator.clipboard.writeText(
          pageRouteUrl(activeWin.location.href, workspace.value.id, file.id),
        );
        fileContextTrigger?.focus({ preventScroll: true });
      } catch (error) {
        store.report(error);
      }
      return;
    }
    if (
      fileMutationDisabled(file) ||
      (action === 'delete' && fileDeleteDisabled(file)) ||
      (action === 'rename' && directoryHasManagedFile(file))
    )
      return;
    if (action === 'duplicate') {
      if (!canDuplicateEntry(file)) return;
      try {
        await store.duplicateEntry(file, workspace.value?.id);
      } catch (error) {
        store.report(error);
      }
      return;
    }
    if (action === 'delete') {
      await removeDocument(file);
      return;
    }
    if (action === 'document' || action === 'folder') {
      await createNewEntry(action, file.path);
      return;
    }
    if (action === 'rename') startTreeRename(file);
  }

  function fileContextKeydown(event: KeyboardEvent) {
    const { document } = activeWindow.value;
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = [
      ...document.querySelectorAll<HTMLButtonElement>('.file-context-menu button:not(:disabled)'),
    ];
    if (!buttons.length) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else if (index === -1) next = event.key === 'ArrowDown' ? 0 : buttons.length - 1;
    else next = (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length;
    buttons[next]?.focus();
  }

  return {
    workspaceEntryContextMenu,
    workspaceEntryContextMenuElement,
    fileContextMenu,
    fileMetadataTarget,
    directoryContextMenu,
    selectedEntryIds,
    selectionAnchorId,
    pendingTreeOpenIds,
    selectedEntries,
    selectActiveFileInTree,
    contextEntries,
    multipleContextEntries,
    draggedEntry,
    tabFileDrag,
    dropFolder,
    dropPlaceholders,
    treeFiles,
    fileTree,
    revealedHomeId,
    folderHomes,
    contextFolderHome,
    folderConversionIssue,
    convertDocumentStructure,
    folderHomeContextAction,
    treeDocumentIcons,
    loadTreeDocumentIcon,
    treeRename,
    closeFileContextMenu,
    closeDirectoryContextMenu,
    closeWorkspaceEntryContextMenu,
    openWorkspaceEntryContextMenu,
    workspaceDropdownContextMenu,
    workspaceEntryContextKeydown,
    workspaceEntryContextAction,
    selectFileTreeEntry,
    openFileContextMenu,
    openDirectoryContextMenu,
    directoryContextAction,
    directoryContextRenameDisabled,
    directoryContextDuplicateDisabled,
    directoryContextDeleteDisabled,
    fileMutationDisabled,
    canDuplicateEntry,
    directoryHasManagedFile,
    startTreeRename,
    finishTreeRename,
    renameTreeEntry,
    fileDeleteDisabled,
    selectionDeleteDisabled,
    canDragEntry,
    fileDragStart,
    fileDragEnd,
    fileDragOver,
    fileDragLeave,
    fileDrop,
    fileContextAction,
    fileContextKeydown,
    openTreeEntry,
  };
}
