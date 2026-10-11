import { onScopeDispose, ref } from 'vue';
import {
  dataTablePath,
  dataTableName,
  isDataTablePath,
  isLegacyDataTablePath,
  newDataTablePath,
  newShortId,
  parseDataTable,
} from '@tano/protocol';
import type { DataTable, Workspace, WorkspaceAdapter, WorkspaceSession } from '@tano/protocol';
import { copyTable, newDataTable } from './data-tables';
import { loadDataTables, mergeDataTable, saveDataTable } from './workspace-data-tables';
import type { DataTableRecord } from './workspace-data-tables';

export interface DataTableState extends DataTableRecord {
  draft: DataTable;
  saving: boolean;
  error: string;
  unavailable: boolean;
  undo: { before: DataTable; after: DataTable }[];
  redo: { before: DataTable; after: DataTable }[];
}
export function createDataTableController(options: {
  adapter: WorkspaceAdapter;
  workspace: () => Workspace | null;
  serial: <T>(operation: () => Promise<T>) => Promise<T>;
  refresh: () => Promise<void>;
}) {
  const records = ref<DataTableState[]>([]),
    errors = ref<string[]>([]);
  const { adapter } = options;
  let scope = '',
    timer: ReturnType<typeof setTimeout> | undefined;
  const dirty = (state: DataTableState) =>
    JSON.stringify(state.draft) !== JSON.stringify(state.table);
  function reset() {
    clearTimeout(timer);
    records.value = [];
    errors.value = [];
    scope = '';
  }
  onScopeDispose(() => clearTimeout(timer));
  const assertWrite = (workspaceId: string, id?: string) => {
    const workspace = options.workspace();
    if (!workspace || workspace.id !== workspaceId) throw new Error('工作区已切换');
    if (workspace.readOnly || (id && workspace.files.find((file) => file.id === id)?.readOnly))
      throw new Error('此数据表为只读');
    return workspace;
  };
  async function reload() {
    const workspace = options.workspace();
    if (!workspace) {
      reset();
      return;
    }
    if (scope !== workspace.id) {
      reset();
      scope = workspace.id;
    }
    const migrationErrors: string[] = [];
    if (!workspace.readOnly) {
      for (const file of workspace.files.filter(
        (file) => isLegacyDataTablePath(file.path) && !file.readOnly,
      )) {
        try {
          const snapshot = await adapter.read(file.path);
          const table = parseDataTable(snapshot.content);
          const path = newDataTablePath(
            table.name,
            '',
            options.workspace()!.files.map((file) => file.path),
          );
          // Keep the original bytes before moving the file, including previously archived tables.
          await adapter.create(
            `.tano/conflicts/table-migration-${file.id}-${crypto.randomUUID()}.tano.json`,
            snapshot.content,
          );
          await adapter.move(file.path, path, 'file');
          await options.refresh();
        } catch (error) {
          migrationErrors.push(`${file.path}：无法迁移到仓库目录，原文件已保留。${String(error)}`);
        }
      }
    }
    const loaded = await loadDataTables(adapter, options.workspace()!);
    if (options.workspace()?.id !== workspace.id) return;
    errors.value = [...migrationErrors, ...loaded.errors];
    for (const current of records.value)
      current.unavailable = !loaded.records.some((record) => record.fileId === current.fileId);
    for (const record of loaded.records) {
      const existing = records.value.find((state) => state.fileId === record.fileId);
      if (!existing)
        records.value.push({
          ...record,
          draft: copyTable(record.table),
          saving: false,
          error: '',
          unavailable: false,
          undo: [],
          redo: [],
        });
      else {
        existing.path = record.path;
        if (existing.snapshot.hash !== record.snapshot.hash && !dirty(existing)) {
          Object.assign(existing, record, {
            draft: copyTable(record.table),
            undo: [],
            redo: [],
            error: '',
          });
        }
      }
    }
  }
  function edit(id: string, change: (table: DataTable) => void, history = true) {
    assertWrite(scope, id);
    const state = records.value.find((state) => state.fileId === id);
    if (!state || state.unavailable || state.error)
      throw new Error(state?.error || '数据表不可用，请重新载入或另存副本');
    const before = copyTable(state.draft),
      after = copyTable(before);
    change(after);
    const validated = parseDataTable(JSON.stringify(after), state.table.id);
    if (JSON.stringify(before) === JSON.stringify(validated)) return;
    if (history) {
      state.undo.push({ before, after: copyTable(validated) });
      if (state.undo.length > 50) state.undo.shift();
      state.redo = [];
    }
    state.draft = validated;
    clearTimeout(timer);
    timer = setTimeout(() => {
      void options.serial(persistAll);
    }, 350);
  }
  async function persistAll() {
    clearTimeout(timer);
    if (records.value.some((state) => dirty(state) && !state.error)) {
      try { await options.refresh(); }
      catch (error) {
        for (const state of records.value) if (dirty(state) && !state.error) state.error = String(error);
        return false;
      }
    }
    for (const state of records.value) {
      if (!dirty(state) || state.error) continue;
      state.saving = true;
      try {
        const workspace = assertWrite(scope, state.fileId);
        const file = workspace.files.find(
          (file) => file.id === state.fileId && isDataTablePath(file.path),
        );
        if (!file) {
          state.unavailable = true;
          const copyPath = `.tano/conflicts/table-${state.table.id}-${crypto.randomUUID()}.tano.json`;
          await adapter.create(copyPath, JSON.stringify(state.draft, null, 2) + '\n');
          throw new Error(`原数据表文件已不存在，编辑已保留到 ${copyPath}；请另存副本`);
        }
        state.path = file.path;
        const before = copyTable(state.draft);
        const saved = await saveDataTable(adapter, state, before);
        // Keystrokes arriving during IO are rebased on the confirmed saved result.
        const rebased = mergeDataTable(before, copyTable(state.draft), saved.table);
        if (!rebased) throw new Error('保存期间有重叠修改，编辑仍保留；请另存副本后重新载入');
        if (JSON.stringify(before) !== JSON.stringify(saved.table)) {
          state.undo = [];
          state.redo = [];
        }
        Object.assign(state, saved, { draft: rebased });
      } catch (error) {
        state.error = String(error);
      } finally {
        state.saving = false;
      }
    }
    if (records.value.some((state) => dirty(state) && !state.error))
      timer = setTimeout(() => {
        void options.serial(persistAll);
      }, 350);
    return records.value.every((state) => !dirty(state));
  }
  async function create(template: 'blank' | 'parts' = 'blank', source?: DataTable, parent = '') {
    const expected = options.workspace()?.id;
    if (!expected) throw new Error('请先打开工作区');
    return options.serial(async () => {
      await options.refresh();
      const workspace = assertWrite(expected);
      if (
        parent &&
        !workspace.files.some((file) => file.kind === 'directory' && file.path === parent)
      )
        throw new Error('目标文件夹不存在，请重新选择');
      const occupied = [
        ...workspace.files.map((file) => file.id),
        ...records.value.map((state) => state.table.id),
      ];
      const id = adapter.reserveObjectId
        ? await adapter.reserveObjectId(occupied)
        : newShortId(new Set(occupied));
      const table = source
        ? { ...copyTable(source), id, name: `${source.name} 副本`, archived: false }
        : newDataTable(id, template);
      assertWrite(expected);
      const path = newDataTablePath(
        table.name,
        parent,
        workspace.files.map((file) => file.path),
      );
      table.name = dataTableName(path);
      await adapter.create(path, JSON.stringify(table, null, 2) + '\n');
      await options.refresh();
      await reload();
      return options.workspace()!.files.find((file) => file.path === path)!.id;
    });
  }
  function undo(id: string, redo = false) {
    const state = records.value.find((state) => state.fileId === id);
    const from = redo ? state?.redo : state?.undo,
      to = redo ? state?.undo : state?.redo;
    const action = from?.at(-1);
    if (!state || !action || !from || !to) return;
    const next = mergeDataTable(
      redo ? action.before : action.after,
      redo ? action.after : action.before,
      copyTable(state.draft),
    );
    if (!next) throw new Error('其他修改与这一步重叠，无法撤销');
    edit(id, (table) => Object.assign(table, next), false);
    from.pop();
    to.push(action);
  }
  async function retry(id: string) {
    const state = records.value.find((state) => state.fileId === id);
    if (state) state.error = '';
    await options.serial(persistAll);
  }
  async function discard(id: string) {
    await options.serial(async () => {
      const state = records.value.find((state) => state.fileId === id);
      if (!state) return;
      // Preserve an explicit recovery copy even when the failure was an IO error, not a conflict.
      if (dirty(state)) {
        assertWrite(scope, id);
        await adapter.create(
          `.tano/conflicts/table-${id}-${crypto.randomUUID()}.tano.json`,
          JSON.stringify(state.draft, null, 2) + '\n',
        );
      }
      state.draft = copyTable(state.table);
      state.error = '';
      state.undo = [];
      state.redo = [];
      await options.refresh();
      await reload();
    });
  }
  function drafts(): NonNullable<WorkspaceSession['dataTables']> {
    return records.value.filter(dirty).map((state) => ({
      id: state.table.id,
      fileId: state.fileId,
      path: state.path,
      content: JSON.stringify(state.draft),
      base: copyTable(state.snapshot),
    }));
  }
  async function restore(drafts: NonNullable<WorkspaceSession['dataTables']>) {
    const validated = drafts.map((draft) => {
      const existing = records.value.find((state) =>
        draft.fileId ? state.fileId === draft.fileId : state.table.id === draft.id,
      );
      return {
        table: parseDataTable(draft.base.content, draft.id),
        draft: parseDataTable(draft.content, draft.id),
        snapshot: draft.base,
        fileId: existing?.fileId ?? draft.fileId ?? draft.id,
        path: existing?.path ?? draft.path ?? dataTablePath(draft.id),
      };
    });
    for (const item of validated) {
      const existing = records.value.find((state) => state.fileId === item.fileId);
      if (existing) Object.assign(existing, item, { undo: [], redo: [], error: '' });
      else
        records.value.push({
          ...item,
          saving: false,
          error: '',
          unavailable: true,
          undo: [],
          redo: [],
        });
    }
    await persistAll();
  }
  return {
    records,
    errors,
    reload,
    reset,
    edit,
    persistAll,
    create,
    undo,
    retry,
    discard,
    dirty,
    drafts,
    restore,
  };
}
