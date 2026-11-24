import { ref, type Ref } from 'vue';
import {
  FileRegistry,
  isDataTableFilePath,
  isMarkdown,
  pathKey,
  validatePath,
  type FileEntry,
  type FileSnapshot,
  type Workspace,
  type WorkspaceAdapter,
} from '@tano/protocol';
import type { createDataTableController } from '../data-table-controller';
import { isTableTab, tableFileId, tableTabId } from '../data-tables';
import type { PreparedImport } from '../document-import';
import type { useDocumentIndex } from '../document-index';
import { documentDirty as dirty, type OpenDocument } from '../document-session';
import { planFileMove } from '../file-move';
import { topLevelEntries } from '../file-selection';
import { convertFolderDocument, type FolderConversionKind } from '../folder-conversion';
import { recordHelpCompleted } from '../help-checklist';
import { t } from '../i18n';
import type { FileMutationPreview, optimisticFiles } from '../optimistic-files';
import { writeWorkspaceImport } from '../workspace-import';
import type { WorkspaceSettings } from '../workspace-settings';
import type { Activity } from './workspace';

export interface WorkspaceFileOpsDeps {
  adapter: WorkspaceAdapter;
  mobile: boolean;
  isDemo: boolean;
  isWeb: boolean;
  workspace: Ref<Workspace | null>;
  visibleWorkspace: Ref<Workspace | null>;
  fileRegistry: Ref<FileRegistry | null>;
  fileMutations: ReturnType<typeof optimisticFiles>;
  documents: Ref<OpenDocument[]>;
  documentIndex: ReturnType<typeof useDocumentIndex>;
  dataTables: ReturnType<typeof createDataTableController>;
  workspaceSettings: Ref<WorkspaceSettings>;
  tabIds: Ref<string[]>;
  tabAliases: Ref<Map<string, string>>;
  activeId: Ref<string>;
  active: Ref<OpenDocument | undefined>;
  busy: Ref<boolean>;
  isDisposed: () => boolean;
  getActivationRevision: () => number;
  tabTarget: (id: string) => string;
  isUtilityTab: (id: string) => boolean;
  removeTabAlias: (id: string) => void;
  removeTabNavigation: (id: string) => void;
  ensureTabNavigation: (tabId: string, targetId?: string) => void;
  recordTabNavigation: (fromId: string, toId: string, historyIndex?: number, target?: string) => void;
  displayPath: (file: Pick<FileEntry, 'id' | 'path'>) => string;
  serial: <T>(task: () => Promise<T>) => Promise<T>;
  writable: () => void;
  report: (error: unknown) => void;
  activity: (
    label: string,
    detail: string,
    kind: Activity['kind'],
    change?: Activity['change'],
  ) => void;
  flush: () => Promise<boolean>;
  flushDocuments: () => Promise<boolean>;
  openInternal: (file: FileEntry, replaceId?: string, current?: () => boolean) => Promise<void>;
  reconcile: (doc: OpenDocument, latest: FileSnapshot) => Promise<void>;
  hydrateDocumentLayout: (doc: OpenDocument) => Promise<void>;
}

export function createWorkspaceFileOps(deps: WorkspaceFileOpsDeps) {
  const {
    adapter,
    mobile,
    isDemo,
    isWeb,
    workspace,
    visibleWorkspace,
    fileRegistry,
    fileMutations,
    documents,
    documentIndex,
    dataTables,
    workspaceSettings,
    tabIds,
    tabAliases,
    activeId,
    active,
    busy,
    isDisposed,
    getActivationRevision,
    tabTarget,
    isUtilityTab,
    removeTabAlias,
    removeTabNavigation,
    ensureTabNavigation,
    recordTabNavigation,
    displayPath,
    serial,
    writable,
    report,
    activity,
    flush,
    flushDocuments,
    openInternal,
    reconcile,
    hydrateDocumentLayout,
  } = deps;

  let creationChain: Promise<unknown> = Promise.resolve();
  let creationRevision = 0;
  const creationTasks = new Map<string, Promise<boolean>>();

  async function createInternal(
    path: string,
    folder = false,
    content?: string,
    expectedWorkspaceId?: string,
  ) {
    writable();
    if (expectedWorkspaceId && workspace.value?.id !== expectedWorkspaceId)
      throw new Error('工作空间已切换，请在原工作空间中恢复历史内容');
    const created = folder
      ? await adapter.createFolder(path)
      : await adapter.create(path, content ?? '');
    workspace.value = created ?? (await adapter.refresh());
    activity(folder ? '文件夹已创建' : '文档已创建', path, 'file');
    const file = workspace.value.files.find((f) => f.path === path);
    if (file?.kind === 'directory' && folder) recordHelpCompleted('create-folder');
    else if (file?.kind === 'file' && isMarkdown(file.path)) recordHelpCompleted('create-document');
    if (file && !folder) {
      const replaceId = activeId.value.startsWith('blank:') ? activeId.value : undefined;
      await openInternal(file, replaceId);
      if (active.value?.id === file.id) recordHelpCompleted('welcome');
      if (replaceId) recordTabNavigation(replaceId, file.id);
      else ensureTabNavigation(file.id, file.id);
    }
  }

  function confirmCreation(doc: OpenDocument): Promise<boolean> {
    const workspaceId = workspace.value?.id;
    if (!doc.creating || !workspaceId || !adapter.commitCreate) return Promise.resolve(!doc.creating);
    const key = `${workspaceId}:${doc.id}`;
    const pending = creationTasks.get(key);
    if (pending) return pending;
    doc.saving = true;
    doc.error = undefined;
    const task = (async () => {
      try {
        const confirmed = await adapter.commitCreate!(doc.id);
        if (isDisposed() || workspace.value?.id !== workspaceId || !documents.value.includes(doc))
          return false;
        doc.path = confirmed.file.path;
        doc.base = confirmed.snapshot;
        doc.creating = false;
        workspace.value.files = workspace.value.files.map((file) =>
          file.id === doc.id ? confirmed.file : file,
        );
        activity('文档已创建', doc.path, 'file');
        recordHelpCompleted('create-document');
        await hydrateDocumentLayout(doc);
        return true;
      } catch (error) {
        if (!isDisposed() && workspace.value?.id === workspaceId) {
          doc.error = `创建未完成：${error instanceof Error ? error.message : String(error)}。草稿已保留，可重试或另存副本。`;
        }
        return false;
      } finally {
        doc.saving = false;
        creationTasks.delete(key);
      }
    })();
    creationTasks.set(key, task);
    return task;
  }

  async function stageDocument(path: string, content = '', expectedWorkspaceId?: string) {
    writable();
    if (busy.value || !workspace.value) throw new Error('工作区正在切换，请稍后重试');
    if (expectedWorkspaceId && workspace.value.id !== expectedWorkspaceId)
      throw new Error(t('工作区已切换'));
    const staged = await adapter.stageCreate!(path, content);
    creationRevision++;
    workspace.value = staged.workspace;
    const replaceId = activeId.value.startsWith('blank:') ? activeId.value : undefined;
    await openInternal(staged.file, replaceId);
    const doc = documentIndex.byId.value.get(staged.file.id)!;
    if (replaceId) recordTabNavigation(replaceId, doc.id);
    else ensureTabNavigation(doc.id, doc.id);
  }

  function stageSerial(task: () => Promise<void>) {
    // Only local preparation is serialized. Remote confirmation never blocks the
    // next click, even while an autosave is waiting for another creation.
    const next = creationChain.then(task, task);
    creationChain = next.catch(() => {});
    return next;
  }

  async function create(
    path: string,
    folder = false,
    content?: string,
    expectedWorkspaceId?: string,
  ) {
    if (!folder && isMarkdown(path) && adapter.stageCreate && adapter.commitCreate)
      return stageSerial(() => stageDocument(path, content, expectedWorkspaceId));
    await serial(() => createInternal(path, folder, content, expectedWorkspaceId));
  }

  async function createUntitledEntry(parent: string, folder: boolean) {
    const optimistic = !folder && !!adapter.stageCreate && !!adapter.commitCreate;
    await (optimistic ? stageSerial : serial)(async () => {
      writable();
      if (!workspace.value) throw new Error('请先打开一个工作空间');
      if (!optimistic) workspace.value = await adapter.refresh();
      if (
        parent &&
        !workspace.value.files.some((file) => file.kind === 'directory' && file.path === parent)
      )
        throw new Error('目标文件夹不存在，请重新选择后重试');
      const paths = new Set(workspace.value.files.map((file) => pathKey(file.path)));
      const prefix = `${parent ? `${parent}/` : ''}${folder ? '新建文件夹' : '新建文档'}`;
      const extension = folder ? '' : '.md';
      let path = `${prefix}${extension}`;
      for (let index = 2; paths.has(pathKey(path)); index++)
        path = `${prefix} ${index}${extension}`;
      if (optimistic) await stageDocument(path);
      else await createInternal(path, folder);
    });
  }

  async function createUntitledDocument(parent = '') {
    await createUntitledEntry(parent, false);
  }

  async function createUntitledFolder(parent = '') {
    await createUntitledEntry(parent, true);
  }

  async function importDocuments(
    prepared: PreparedImport,
    folder: string,
    workspaceId: string,
    options: Parameters<typeof writeWorkspaceImport>[4] = {},
  ) {
    return serial(async () => {
      writable();
      if (workspace.value?.id !== workspaceId) throw new Error('工作区已切换，请重新选择导入文件');
      const receipt = await writeWorkspaceImport(adapter, prepared, folder, workspaceId, options);
      if (receipt.paths.length) recordHelpCompleted('import-document');
      activity('内容已导入', `${receipt.folder} · ${receipt.paths.length} 个页面`, 'file');
      try {
        workspace.value = await adapter.refresh();
        const first = workspace.value.files.find((file) => file.path === receipt.paths[0]);
        if (first) {
          try {
            await openInternal(first);
          } catch (error) {
            receipt.issues.push({
              name: first.path,
              message: `文件已导入，打开失败：${error instanceof Error ? error.message : String(error)}`,
            });
          }
        }
      } catch (error) {
        receipt.issues.push({
          name: receipt.folder,
          message: `文件已导入，刷新工作区失败：${error instanceof Error ? error.message : String(error)}`,
        });
      }
      return receipt;
    });
  }

  function prepareFileMutation(
    files: Pick<FileEntry, 'id' | 'path' | 'kind'>[],
    expectedWorkspaceId?: string,
  ) {
    writable();
    const current = visibleWorkspace.value;
    if (!current || busy.value || (expectedWorkspaceId && current.id !== expectedWorkspaceId))
      throw new Error('工作空间已切换或正在加载，请重新选择文件');
    for (const file of files) {
      const entry = current.files.find((item) => item.id === file.id && item.path === file.path);
      if (!entry) throw new Error('文件位置已变化，请重新选择文件');
      if (entry.readOnly) throw new Error('你对此条目只有阅读权限');
    }
    const affected = current.files.filter((entry) =>
      files.some(
        (file) =>
          entry.id === file.id || (file.kind === 'directory' && entry.path.startsWith(`${file.path}/`)),
      ),
    );
    const ids = new Set(affected.map((file) => file.id));
    if (affected.some((file) => file.readOnly)) throw new Error('所选范围内有只读条目');
    if (documents.value.some((doc) => ids.has(doc.id) && (doc.conflict || doc.missing)))
      throw new Error('请先处理所选文档的冲突或缺失');
    const preview: FileMutationPreview = {
      workspaceId: current.id,
      paths: new Map(),
      expected: new Map(
        workspace.value!.files
          .filter((file) => ids.has(file.id))
          .map((file) => [file.id, { ...file }]),
      ),
    };
    return { current, affected, preview };
  }

  function confirmedEntry(
    file: Pick<FileEntry, 'id' | 'path' | 'kind'>,
    affected: FileEntry[],
  ) {
    if (file.kind === 'file') {
      const current = fileRegistry.value?.get(file.id);
      if (!current) throw new Error('文件已不存在，请刷新工作区');
      return current;
    }
    // Online folders have path-based virtual IDs. Follow a descendant's stable
    // identity when an earlier queued folder move has already been confirmed.
    const child = affected.find(
      (entry) => entry.kind === 'file' && entry.path.startsWith(`${file.path}/`),
    );
    const current = child && fileRegistry.value?.get(child.id);
    const path =
      current && child
        ? current.path.slice(0, -child.path.slice(file.path.length).length)
        : file.path;
    const entry = workspace.value?.files.find(
      (entry) => entry.kind === 'directory' && entry.path === path,
    );
    if (!entry) throw new Error('文件夹已不存在，请刷新工作区');
    return entry;
  }

  async function confirmFileMutation(scope: string, run: () => Promise<void>) {
    if (isDisposed() || workspace.value?.id !== scope) throw new Error(t('工作区已切换'));
    try {
      await run();
    } catch (error) {
      // A response can fail after the server committed. Recover its actual state
      // without replacing editor content or a newer optimistic presentation.
      try {
        const refreshed = await adapter.refresh();
        if (!isDisposed() && workspace.value?.id === scope && refreshed.id === scope) {
          workspace.value = refreshed;
          for (const doc of documents.value) {
            const file = refreshed.files.find((file) => file.id === doc.id);
            if (file) doc.path = file.path;
          }
        }
      } catch {
        /* Keep the last confirmed state and the user's draft. */
      }
      throw error;
    }
  }

  async function renameEntry(file: Pick<FileEntry, 'id' | 'path' | 'kind'>, path: string) {
    if (!isWeb) return renameEntryConfirmed(file, path);
    const invalid = validatePath(path);
    if (invalid) throw new Error(invalid);
    const { current, affected, preview } = prepareFileMutation([file]);
    if (
      current.files.some((entry) => entry.id !== file.id && pathKey(entry.path) === pathKey(path))
    )
      throw new Error(t('已经存在一个同名文件'));
    if (file.path === path) return;
    preview.paths.set(file.id, path);
    fileMutations.enqueue('重命名', preview, () =>
      confirmFileMutation(preview.workspaceId, () =>
        renameEntryConfirmed(confirmedEntry(file, affected), path),
      ),
    );
  }

  async function renameEntryConfirmed(
    file: Pick<FileEntry, 'id' | 'path' | 'kind'>,
    path: string,
  ) {
    writable();
    const creating = documents.value.some((doc) => doc.id === file.id && doc.creating);
    if (!(await flushDocuments())) throw new Error('请先处理未保存的修改');
    if (creating) file = workspace.value?.files.find((entry) => entry.id === file.id) ?? file;
    await serial(async () => {
      workspace.value = await adapter.refresh();
      if (
        !workspace.value?.files.some((entry) => entry.id === file.id && entry.path === file.path)
      )
        throw new Error('文件位置已变化，目录已自动更新，请重新选择后重试');
      if (
        workspace.value.files.some(
          (entry) => entry.id !== file.id && pathKey(entry.path) === pathKey(path),
        )
      )
        throw new Error(t('已经存在一个同名文件'));
      const withinSource = (entryPath: string) =>
        entryPath === file.path ||
        (file.kind === 'directory' && entryPath.startsWith(`${file.path}/`));
      const affected = workspace.value.files.filter(
        (entry) => entry.kind === 'file' && withinSource(entry.path),
      );
      const affectedIds = new Set(affected.map((entry) => entry.id));
      if (documents.value.some((doc) => affectedIds.has(doc.id) && (doc.conflict || doc.missing)))
        throw new Error('请先处理重命名范围内文档的冲突或缺失');
      if (file.kind === 'file' && isMarkdown(file.path)) await adapter.rename(file.path, path);
      else await adapter.move(file.path, path, file.kind);
      workspace.value = await adapter.refresh();
      await dataTables.reload();
      for (const doc of documents.value.filter((entry) => affectedIds.has(entry.id))) {
        const current = fileRegistry.value?.get(doc.id);
        if (!current) {
          doc.missing = true;
          continue;
        }
        doc.path = current.path;
        await reconcile(doc, await adapter.read(current.path));
      }
      activity('条目已重命名', `${file.path} → ${path}`, 'file');
      if (file.kind === 'file' && isMarkdown(file.path) && file.path !== path)
        recordHelpCompleted('rename-document');
    });
  }

  async function rename(doc: OpenDocument, path: string) {
    return renameEntry({ id: doc.id, path: displayPath(doc), kind: 'file' }, path);
  }

  const folderConversionBusy = ref(false);
  const canConvertFolderDocuments = !!adapter.changeFile && !!adapter.removeEmptyFolder;

  async function convertDocumentStructure(file: FileEntry, kind: FolderConversionKind) {
    writable();
    if (folderConversionBusy.value) throw new Error(t('正在转换文档，请稍候'));
    const scope = workspace.value?.id;
    if (!scope) throw new Error('请先打开一个工作空间');
    folderConversionBusy.value = true;
    try {
      if (!(await flush()) || documents.value.some((doc) => doc.conflict || doc.missing))
        throw new Error('请先处理未保存的修改、冲突或缺失文档');
      return await serial(async () => {
        writable();
        if (workspace.value?.id !== scope) throw new Error(t('工作区已切换'));
        let result: Awaited<ReturnType<typeof convertFolderDocument>> | undefined;
        try {
          result = await convertFolderDocument(
            adapter,
            scope,
            file,
            workspaceSettings.value.folderHomeFileName,
            kind,
          );
        } finally {
          // Reconcile all open references, including unsaved edits made during the operation.
          const current = await adapter.refresh();
          if (current.id === scope && workspace.value?.id === scope) {
            workspace.value = current;
            for (const doc of documents.value) {
              const entry = current.files.find((entry) => entry.id === doc.id);
              if (!entry) {
                doc.missing = true;
                continue;
              }
              doc.path = entry.path;
              doc.missing = false;
              await reconcile(doc, await adapter.read(entry.path));
            }
          }
        }
        const opened = workspace.value?.files.find((entry) => entry.id === result!.openId);
        if (opened) await openInternal(opened);
        activity(
          kind === 'child' ? '已新建子文档' : '已转为普通文档',
          `${file.path} → ${result.plan.destination}`,
          'file',
        );
        recordHelpCompleted(kind === 'child' ? 'child-document' : 'flatten-folder');
        return opened;
      });
    } finally {
      folderConversionBusy.value = false;
    }
  }

  async function moveEntry(file: FileEntry, folder: string, expectedWorkspaceId?: string) {
    if (!isWeb) return moveEntryConfirmed(file, folder, expectedWorkspaceId);
    const { current, affected, preview } = prepareFileMutation([file], expectedWorkspaceId);
    const plan = planFileMove(file, folder, current.files);
    for (const item of plan.moved) preview.paths.set(item.entry.id, item.path);
    fileMutations.enqueue('移动', preview, () =>
      confirmFileMutation(preview.workspaceId, async () => {
        const entry = confirmedEntry(file, affected);
        // Keep the destination selected at click time, including its filename.
        await renameEntryConfirmed(entry, plan.destination);
      }),
    );
  }

  async function moveEntryConfirmed(file: FileEntry, folder: string, expectedWorkspaceId?: string) {
    writable();
    if (!(await flushDocuments())) throw new Error('请先处理未保存的修改');
    await serial(async () => {
      if (!workspace.value || (expectedWorkspaceId && workspace.value.id !== expectedWorkspaceId))
        throw new Error('工作空间已切换，请重新拖动');
      workspace.value = await adapter.refresh();
      const { destination, moved } = planFileMove(file, folder, workspace.value.files);
      const movedIds = new Set(
        moved.filter((item) => item.entry.kind === 'file').map((item) => item.entry.id),
      );
      if (documents.value.some((doc) => movedIds.has(doc.id) && (doc.conflict || doc.missing)))
        throw new Error('请先处理移动范围内文档的冲突或缺失');
      let moveError: unknown;
      try {
        await adapter.move(file.path, destination, file.kind);
      } catch (error) {
        moveError = error;
      }
      try {
        workspace.value = await adapter.refresh();
        await dataTables.reload();
        for (const doc of documents.value.filter((entry) => movedIds.has(entry.id))) {
          const current = fileRegistry.value?.get(doc.id);
          if (!current) {
            doc.missing = true;
            continue;
          }
          doc.path = current.path;
          doc.missing = false;
          await reconcile(doc, await adapter.read(current.path));
        }
      } catch (error) {
        if (!moveError) throw error;
        report(error);
      }
      if (moveError) throw moveError;
      if (file.kind === 'file' && isMarkdown(file.path) && file.path !== destination)
        recordHelpCompleted('move-document');
      activity(
        file.kind === 'directory' ? '文件夹已移动' : '文件已移动',
        `${file.path} → ${destination}`,
        'file',
      );
    });
  }

  async function duplicateEntry(file: FileEntry, expectedWorkspaceId?: string) {
    writable();
    if (!adapter.duplicate) throw new Error('当前工作区不支持创建副本');
    if (!(await flush())) throw new Error('请先处理未保存的修改');
    return serial(async () => {
      if (!workspace.value || (expectedWorkspaceId && workspace.value.id !== expectedWorkspaceId))
        throw new Error('工作空间已切换，请重新创建副本');
      workspace.value = await adapter.refresh();
      if (
        !workspace.value.files.some((entry) => entry.id === file.id && entry.path === file.path)
      )
        throw new Error('文件位置已变化，目录已自动更新，请重新选择后重试');
      const withinSource = (path: string) =>
        path === file.path || (file.kind === 'directory' && path.startsWith(`${file.path}/`));
      if (documents.value.some((doc) => withinSource(doc.path) && (doc.conflict || doc.missing)))
        throw new Error('请先处理复制范围内文档的冲突或缺失');
      let destination: string | undefined;
      let duplicateError: unknown;
      try {
        destination = await adapter.duplicate!(workspace.value.id, file.path);
      } catch (error) {
        duplicateError = error;
      }
      workspace.value = await adapter.refresh();
      if (duplicateError) throw duplicateError;
      await dataTables.reload();
      if (!destination) throw new Error('创建副本没有返回目标路径');
      activity('已创建副本', `${file.path} → ${destination}`, 'file');
      if (file.kind === 'file' && isMarkdown(file.path)) recordHelpCompleted('duplicate-document');
      return destination;
    });
  }

  async function saveCopy(doc: OpenDocument, path: string) {
    const content = doc.content;
    await create(path, false, content);
    if (doc.missing && doc.content === content) {
      documents.value = documents.value.filter((d) => d.id !== doc.id);
      tabIds.value = tabIds.value.filter((id) => tabTarget(id) !== doc.id);
      for (const id of [...tabAliases.value.keys()])
        if (tabTarget(id) === doc.id) {
          removeTabAlias(id);
          removeTabNavigation(id);
        }
      if (!tabIds.value.includes(activeId.value)) activeId.value = tabIds.value.at(-1) ?? '';
    }
  }

  async function removeEntries(
    files: Pick<FileEntry, 'id' | 'path' | 'kind'>[],
    expectedWorkspaceId?: string,
    expectedContents?: FileEntry[],
  ) {
    if (!isWeb) return removeEntriesConfirmed(files, expectedWorkspaceId, expectedContents);
    if (!files.length) return;
    const { affected, preview } = prepareFileMutation(files, expectedWorkspaceId);
    // Preserve the confirmation dialog's snapshot, rather than silently deleting
    // an external edit which arrived while the dialog was open.
    if (expectedContents)
      for (const file of affected) {
        const expected = expectedContents.find((entry) => entry.id === file.id);
        if (!expected || expected.modified !== file.modified || expected.size !== file.size)
          throw new Error('所选条目内容已变化，请核对后重试');
      }
    const ids = new Set(affected.map((file) => file.id));
    const removedTabs = tabIds.value
      .map((id, index) => ({ id, index }))
      .filter(
        ({ id }) =>
          ids.has(tabTarget(id)) ||
          (isTableTab(id) && ids.has(tableFileId(id))) ||
          (id.startsWith('attachment:') && ids.has(id.slice(11))),
      );
    const removedIds = new Set(removedTabs.map((tab) => tab.id));
    const previousActive = activeId.value;
    tabIds.value = tabIds.value.filter((id) => !removedIds.has(id));
    if (removedIds.has(activeId.value)) activeId.value = tabIds.value.at(-1) ?? '';
    const fallbackActive = activeId.value;
    const activationAtRemoval = getActivationRevision();
    for (const file of affected) preview.paths.set(file.id, null);
    fileMutations.enqueue(
      '删除',
      preview,
      () =>
        confirmFileMutation(preview.workspaceId, async () => {
          const current = files.map((file) => confirmedEntry(file, affected));
          const expected = current.map((file) => ({
            ...(preview.expected.get(file.id) ?? file),
            path: file.path,
          }));
          await removeEntriesConfirmed(current, preview.workspaceId, expected);
        }),
      () => {
        if (isDisposed()) return;
        for (const tab of removedTabs) {
          const id = tab.id.replace(/^(table:|attachment:)/, '');
          if (workspace.value?.files.some((file) => file.id === id) && !tabIds.value.includes(tab.id))
            tabIds.value.splice(Math.min(tab.index, tabIds.value.length), 0, tab.id);
        }
        if (
          getActivationRevision() === activationAtRemoval &&
          activeId.value === fallbackActive &&
          tabIds.value.includes(previousActive)
        )
          activeId.value = previousActive;
      },
    );
  }

  async function removeEntriesConfirmed(
    files: Pick<FileEntry, 'id' | 'path' | 'kind'>[],
    expectedWorkspaceId?: string,
    expectedContents?: FileEntry[],
  ) {
    writable();
    if (!files.length) return;
    if (files.some((file) => mobile && file.kind === 'directory'))
      throw new Error('手机回收站暂不支持文件夹');
    const locallyModified = new Set(
      documents.value.filter((doc) => dirty(doc)).map((doc) => doc.id),
    );
    const creating = new Set(documents.value.filter((doc) => doc.creating).map((doc) => doc.id));
    if (!(await flushDocuments())) throw new Error('请先处理未保存的修改');
    files = files.map((file) =>
      creating.has(file.id)
        ? (workspace.value?.files.find((entry) => entry.id === file.id) ?? file)
        : file,
    );
    expectedContents = expectedContents?.map((file) =>
      creating.has(file.id)
        ? (workspace.value?.files.find((entry) => entry.id === file.id) ?? file)
        : file,
    );
    await serial(async () => {
      workspace.value = await adapter.refresh();
      if (!workspace.value || (expectedWorkspaceId && workspace.value.id !== expectedWorkspaceId))
        throw new Error('工作空间已切换，请重新选择文件');
      const roots = topLevelEntries(files);
      for (const file of roots) {
        if (!workspace.value.files.some((entry) => entry.id === file.id && entry.path === file.path))
          throw new Error('文件位置已变化，目录已自动更新，请重新选择后重试');
      }
      const withinRoots = (path: string) =>
        roots.some(
          (file) =>
            path === file.path || (file.kind === 'directory' && path.startsWith(`${file.path}/`)),
        );
      if (expectedContents) {
        const expected = expectedContents.filter((entry) => withinRoots(entry.path));
        const current = workspace.value.files.filter((entry) => withinRoots(entry.path));
        if (
          expected.length !== current.length ||
          current.some(
            (entry) =>
              !expected.some(
                (old) =>
                  old.id === entry.id &&
                  old.path === entry.path &&
                  (entry.kind === 'directory' ||
                    locallyModified.has(entry.id) ||
                    (old.modified === entry.modified && old.size === entry.size)),
              ),
          )
        )
          throw new Error('所选条目内容已变化，目录已自动更新，请核对后重试');
      }
      if (documents.value.some((doc) => withinRoots(doc.path) && (doc.conflict || doc.missing)))
        throw new Error('请先处理所选文档的冲突或缺失');
      let removed = 0;
      for (const file of roots) {
        try {
          await adapter.remove(file.path);
        } catch (error) {
          workspace.value = await adapter.refresh();
          throw new Error(
            t('{0}处理「{1}」失败：{2}', [
              removed ? t('已移除 {0} 项；', [removed]) : '',
              file.path,
              error instanceof Error ? error.message : String(error),
            ]),
          );
        }
        removed++;
        documents.value = documents.value.filter(
          (doc) =>
            doc.path !== file.path &&
            !(file.kind === 'directory' && doc.path.startsWith(`${file.path}/`)),
        );
        const previousTabIds = [...tabIds.value];
        const remainingIds = new Set(documents.value.map((doc) => doc.id));
        const removedTableIds = new Set(
          workspace.value.files
            .filter(
              (entry) =>
                isDataTableFilePath(entry.path) &&
                (entry.path === file.path ||
                  (file.kind === 'directory' && entry.path.startsWith(`${file.path}/`))),
            )
            .map((entry) => tableTabId(entry.id)),
        );
        tabIds.value = tabIds.value.filter(
          (id) =>
            !removedTableIds.has(tabTarget(id)) &&
            (isUtilityTab(id) || remainingIds.has(tabTarget(id))),
        );
        for (const tabId of previousTabIds)
          if (!tabIds.value.includes(tabId)) {
            removeTabAlias(tabId);
            removeTabNavigation(tabId);
          }
        if (activeId.value && !tabIds.value.includes(activeId.value))
          activeId.value = tabIds.value.at(-1) ?? '';
        workspace.value = await adapter.refresh();
        await dataTables.reload();
        activity(
          isDemo
            ? '演示条目已删除'
            : isWeb
              ? file.kind === 'directory'
                ? '在线文件夹已删除'
                : '在线文档已删除'
              : '条目已移入回收站',
          file.path,
          'file',
        );
      }
    });
  }

  async function removeEntry(file: Pick<FileEntry, 'id' | 'path' | 'kind'>) {
    return removeEntries([file]);
  }

  async function remove(doc: OpenDocument) {
    return removeEntry({ id: doc.id, path: displayPath(doc), kind: 'file' });
  }

  async function preserveDraft(id: string, content: string) {
    return serial(async () => {
      const doc = documentIndex.byId.value.get(id);
      if (!doc || !workspace.value) throw new Error('原文档已关闭');
      const path = doc.path.replace(
        /\.(md|markdown)$/i,
        `.recovered-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.md`,
      );
      await adapter.create(path, content);
      workspace.value = await adapter.refresh();
      activity('恢复副本已保留', path, 'conflict');
      return path;
    });
  }

  return {
    getCreationRevision: () => creationRevision,
    awaitCreationChain: () => creationChain,
    confirmCreation,
    create,
    createUntitledDocument,
    createUntitledFolder,
    importDocuments,
    rename,
    renameEntry,
    canConvertFolderDocuments,
    folderConversionBusy,
    convertDocumentStructure,
    moveEntry,
    duplicateEntry,
    saveCopy,
    remove,
    removeEntry,
    removeEntries,
    preserveDraft,
  };
}
