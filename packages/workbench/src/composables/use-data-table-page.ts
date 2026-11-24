import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type {
  DataAggregate,
  DataField,
  DataFieldType,
  DataRow,
  DataTable,
  DataValue,
  DataView,
} from '@tano/protocol';
import { dataTableName, safeRemoteImage, validDataValue } from '@tano/protocol';
import { t } from '../i18n/i18n';
import { useWorkspaceStore, type OpenDocument } from '../stores/workspace';
import {
  canonicalFormula,
  copyTable,
  dataEvaluator,
  dataValueText,
  dataViewRows,
  displayFormula,
  newDataView,
  tableItemId,
} from '../data-tables/data-tables';
import { nativeAttachments, openExternalUrl } from '../files/attachments';
import { useWorkbenchRuntime } from '../runtime';
import { startColumnPointerReorder, startRowPointerReorder } from '../data-tables/data-table-drag-preview';
import { appearanceText } from '../documents/document-appearance';
import { addDataField, createAndSelectDataOption } from '../data-tables/data-table-properties';
import { useWindowContext } from '../windows/context';
import { useDataTableIo } from './use-data-table-io';

export interface DataTableConfirmAction {
  title: string;
  detail: string;
  run: () => void;
}

export interface DataTablePageProps {
  tableId: string;
}

export function useDataTablePage(props: DataTablePageProps) {
  const { window, document } = useWindowContext();
  const store = useWorkspaceStore();
  const runtime = useWorkbenchRuntime();
  const attachmentService = runtime.attachments ?? (runtime.native ? nativeAttachments : undefined);

  function openLink(url: string) {
    if (!/^https?:\/\//i.test(url)) return;
    if (runtime.native) return openExternalUrl(url);
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  const state = computed(() =>
    store.dataTableRecords.find((record) => record.fileId === props.tableId),
  );
  const table = computed(() => state.value?.draft);
  const file = computed(() => store.workspace?.files.find((item) => item.id === props.tableId));
  const title = computed(() =>
    dataTableName(file.value?.path ?? state.value?.path ?? t('数据表')),
  );
  // Adapt structured metadata to the shared Markdown appearance controls.
  const appearance = computed(
    () =>
      `---\nicon: ${JSON.stringify(table.value?.icon ?? '')}\ncover: ${JSON.stringify(table.value?.cover ?? '')}\n---\n`,
  );

  function updateAppearance(markdown: string) {
    change((draft) => {
      for (const key of ['icon', 'cover'] as const) {
        const value = appearanceText(markdown, key);
        if (value) draft[key] = value;
        else delete draft[key];
      }
    });
  }

  const commentDocument = computed<OpenDocument | undefined>(
    () =>
      state.value && {
        id: props.tableId,
        path: state.value.path,
        content: `${JSON.stringify(table.value, null, 2)}\n`,
        base: state.value.snapshot,
        saving: state.value.saving,
        missing: !!state.value.unavailable,
      },
  );

  function resolveCover(reference: string) {
    return (
      attachmentService?.imageUrl(store.workspace, state.value?.path ?? '', reference) ??
      safeRemoteImage(reference)
    );
  }

  async function uploadCover(coverFile: File) {
    const workspaceId = store.workspace?.id;
    const tableId = props.tableId;
    if (!workspaceId || !attachmentService || readonly.value) {
      throw new Error(t('当前数据表不可编辑'));
    }
    const added = await attachmentService.importAttachment(
      workspaceId,
      state.value!.path,
      coverFile,
      true,
    );
    if (workspaceId !== store.workspace?.id || tableId !== props.tableId) {
      throw new Error(t('工作区已切换'));
    }
    await store.refresh();
    return added;
  }

  async function renameTitle(event: Event) {
    const input = event.target as HTMLInputElement;
    await run(() => store.renameDataTable(props.tableId, input.value));
    input.value = title.value;
  }

  const readonly = computed(
    () =>
      !!store.workspace?.readOnly ||
      !!store.workspace?.files.find((item) => item.path === state.value?.path)?.readOnly ||
      !!state.value?.unavailable ||
      !!state.value?.error,
  );

  const query = ref('');
  const viewId = ref('');
  const settings = ref(false);
  const message = ref('');
  const working = ref(false);
  const selectedRows = ref<string[]>([]);
  const detailId = ref('');
  const fieldDraft = ref<DataField>();
  const fieldBase = ref<DataField>();
  const fieldOptions = ref('');
  const fieldError = ref('');
  const fieldMenu = ref<{ id: string; anchor: HTMLElement }>();
  const menuField = computed(() =>
    table.value?.fields.find((field) => field.id === fieldMenu.value?.id),
  );
  const fieldInsert = ref<{ id: string; side: 'left' | 'right' }>();
  const creatingField = ref(false);
  const confirmAction = ref<DataTableConfirmAction>();
  const root = ref<HTMLElement>();

  const view = computed(
    () => table.value?.views.find((item) => item.id === viewId.value) ?? table.value?.views[0],
  );
  const evaluate = computed(() => (table.value ? dataEvaluator(table.value) : undefined));
  const fields = computed(
    () => table.value?.fields.filter((field) => !view.value?.hiddenFields.includes(field.id)) ?? [],
  );
  const rows = computed(() =>
    table.value && view.value
      ? dataViewRows(table.value, view.value, query.value, evaluate.value)
      : [],
  );
  const pageIndex = ref(0);
  const pageSize = 100;
  const pageCount = computed(() => Math.max(1, Math.ceil(rows.value.length / pageSize)));
  const detail = computed(() => table.value?.rows.find((row) => row.id === detailId.value));
  const allGroups = computed(() => {
    const map = new Map<string, DataRow[]>();
    for (const row of rows.value) {
      const value = view.value?.groupBy ? evaluate.value!(row, view.value.groupBy).value : '';
      const key = view.value?.groupBy ? dataValueText(value) || t('未分组') : '';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    if (!map.size) map.set('', []);
    return [...map].map(([label, groupRows]) => ({ label, rows: groupRows }));
  });
  const orderedRows = computed(() => allGroups.value.flatMap((group) => group.rows));
  const pageRows = computed(() =>
    orderedRows.value.slice(pageIndex.value * pageSize, (pageIndex.value + 1) * pageSize),
  );
  const groups = computed(() => {
    const ids = new Set(pageRows.value.map((row) => row.id));
    const result = allGroups.value
      .map((group) => ({ ...group, rows: group.rows.filter((row) => ids.has(row.id)) }))
      .filter((group) => group.rows.length);
    return result.length ? result : [{ label: '', rows: [] as DataRow[] }];
  });

  const allSelected = computed(
    () =>
      pageRows.value.length > 0 && pageRows.value.every((row) => selectedRows.value.includes(row.id)),
  );
  const saved = computed(
    () => !!state.value && JSON.stringify(state.value.draft) === JSON.stringify(state.value.table),
  );
  const aggregateLabels: Record<DataAggregate, string> = {
    none: '',
    get count() { return t('计数'); },
    get filled() { return t('非空数'); },
    get sum() { return t('求和'); },
    get average() { return t('平均值'); },
    get min() { return t('最小值'); },
    get max() { return t('最大值'); },
  };
  const hasAggregates = computed(() =>
    fields.value.some((field) => (view.value?.aggregates[field.id] ?? 'none') !== 'none'),
  );

  function change(operation: (draft: DataTable) => void) {
    if (!props.tableId) return false;
    try {
      store.editDataTable(props.tableId, operation);
      message.value = '';
      return true;
    } catch (error) {
      message.value = String(error);
      return false;
    }
  }

  function changeView(operation: (targetView: DataView) => void) {
    const id = view.value?.id;
    change((draft) => {
      const target = draft.views.find((item) => item.id === id);
      if (target) operation(target);
    });
  }

  async function run(operation: () => Promise<unknown>) {
    if (working.value) return;
    working.value = true;
    message.value = '';
    try {
      await operation();
    } catch (error) {
      message.value = String(error);
    } finally {
      working.value = false;
    }
  }

  const io = useDataTableIo({
    document,
    table,
    view,
    title,
    query,
    readonly,
    fields,
    orderedRows,
    message,
    change,
  });

  const modalOpen = computed(
    () => !!fieldDraft.value || io.importText.value !== undefined || !!confirmAction.value,
  );
  let modalFocus: HTMLElement | null = null;
  watch(modalOpen, async (open) => {
    if (open) {
      modalFocus = document.activeElement as HTMLElement | null;
      await nextTick();
      root.value
        ?.querySelector<HTMLElement>(
          '.data-modal input:not(:disabled), .data-modal button:not(:disabled)',
        )
        ?.focus();
    } else if (modalFocus?.isConnected) {
      modalFocus.focus();
    }
  });

  watch([query, viewId, () => props.tableId], () => {
    pageIndex.value = 0;
    fieldMenu.value = undefined;
    creatingField.value = false;
  });
  watch(pageCount, (count) => {
    pageIndex.value = Math.min(pageIndex.value, count - 1);
  });
  watch(
    () => props.tableId,
    () => {
      query.value = '';
      viewId.value = '';
      detailId.value = '';
      selectedRows.value = [];
      settings.value = false;
      message.value = '';
    },
  );
  watch(
    () => rows.value.map((row) => row.id),
    (ids) => {
      selectedRows.value = selectedRows.value.filter((id) => ids.includes(id));
    },
  );

  function createField(name: string, type: DataFieldType, formula?: string) {
    if (readonly.value) return t('当前数据表不可编辑');
    let id = '';
    try {
      store.editDataTable(props.tableId, (draft) => {
        id = addDataField(draft, name, type, formula).id;
      });
      message.value = '';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    void nextTick(() => {
      const heading = root.value?.querySelector<HTMLButtonElement>(
        `.data-grid th[data-field="${id}"] .data-field-heading`,
      );
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    return '';
  }

  function openFieldMenu(field: DataField, event: MouseEvent) {
    fieldMenu.value =
      fieldMenu.value?.id === field.id
        ? undefined
        : { id: field.id, anchor: event.currentTarget as HTMLElement };
  }

  function commitFieldMenu(operation: (draft: DataTable) => void) {
    return change(operation) ? '' : message.value;
  }

  function editMenuField(type?: DataFieldType) {
    if (!menuField.value) return;
    editField(menuField.value);
    if (type && fieldDraft.value) fieldDraft.value.type = type;
    fieldMenu.value = undefined;
  }

  function insertField(side: 'left' | 'right') {
    const id = fieldMenu.value?.id;
    editField();
    if (id) fieldInsert.value = { id, side };
    fieldMenu.value = undefined;
  }

  function filterField() {
    const field = menuField.value;
    if (field && !view.value?.filters.some((filter) => filter.field === field.id)) {
      changeView((targetView) =>
        targetView.filters.push({
          id: tableItemId(),
          field: field.id,
          operator: 'contains',
          value: '',
        }),
      );
    }
    settings.value = true;
    fieldMenu.value = undefined;
  }

  function setCell(rowId: string, fieldId: string, value: DataValue, expected: DataValue) {
    change((draft) => {
      const row = draft.rows.find((item) => item.id === rowId);
      if (!row) throw new Error(t('记录已移除'));
      const current = row.values[fieldId] ?? null;
      if (
        JSON.stringify(current) !== JSON.stringify(expected) &&
        JSON.stringify(current) !== JSON.stringify(value)
      ) {
        throw new Error(
          t('此单元格已被外部修改。你的输入为「{0}」，请核对后重新填写。', [dataValueText(value)]),
        );
      }
      row.values[fieldId] = value;
    });
  }

  function createCellOption(rowId: string, fieldId: string, name: string, expected: DataValue) {
    if (readonly.value) return t('当前数据表不可编辑');
    try {
      store.editDataTable(props.tableId, (draft) =>
        createAndSelectDataOption(draft, rowId, fieldId, name, expected),
      );
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  async function addRow() {
    const id = tableItemId();
    const added = change((draft) => {
      const values: Record<string, DataValue> = {};
      for (const filter of view.value?.filters ?? []) {
        const field = draft.fields.find((item) => item.id === filter.field);
        if (filter.operator === 'eq' && field && validDataValue(field, filter.value)) {
          values[field.id] = filter.value;
        }
      }
      draft.rows.push({ id, values });
    });
    if (!added) return;
    const position = orderedRows.value.findIndex((row) => row.id === id);
    if (position >= 0) pageIndex.value = Math.floor(position / pageSize);
    await nextTick();
    const target = root.value?.querySelector<HTMLElement>(
      `[data-row="${id}"] textarea, [data-row="${id}"] input:not([type=checkbox])`,
    );
    if (target) {
      target.focus();
      target.scrollIntoView({ block: 'nearest' });
    } else {
      detailId.value = id;
      message.value = t('新记录已创建；填写符合当前筛选条件的字段后会显示在视图中。');
    }
  }

  function duplicateRows(ids: string[]) {
    change((draft) => {
      for (const id of ids) {
        const index = draft.rows.findIndex((row) => row.id === id);
        if (index >= 0) {
          draft.rows.splice(index + 1, 0, { ...copyTable(draft.rows[index]), id: tableItemId() });
        }
      }
    });
  }

  function deleteRows(ids: string[]) {
    confirmAction.value = {
      title: t('删除 {0} 条记录？', [ids.length]),
      get detail() { return t('关联文档和附件会保留。删除后可以撤销。'); },
      run: () => {
        change((draft) => {
          draft.rows = draft.rows.filter((row) => !ids.includes(row.id));
        });
        selectedRows.value = [];
        detailId.value = '';
      },
    };
  }

  function editField(field?: DataField) {
    fieldInsert.value = undefined;
    fieldBase.value = field ? copyTable(field) : undefined;
    fieldDraft.value = field
      ? { ...copyTable(field), formula: displayFormula(field.formula ?? '', table.value!.fields) }
      : { id: tableItemId(), name: '', type: 'text', options: [] };
    fieldOptions.value = field?.options?.join('\n') ?? '';
    fieldError.value = '';
  }

  function saveField() {
    if (!fieldDraft.value || !table.value) return;
    const field = copyTable(fieldDraft.value);
    field.name = field.name.trim();
    if (
      !field.name ||
      table.value.fields.some((item) => item.id !== field.id && item.name === field.name)
    ) {
      fieldError.value = t('请输入不重复的字段名称');
      return;
    }
    if (['select', 'multiselect'].includes(field.type)) {
      field.options = [
        ...new Set(
          fieldOptions.value
            .split('\n')
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ];
    } else {
      delete field.options;
      delete field.optionColors;
    }
    if (field.optionColors) {
      field.optionColors = Object.fromEntries(
        Object.entries(field.optionColors).filter(([option]) => field.options?.includes(option)),
      );
    }
    try {
      if (field.type === 'formula') {
        field.formula = canonicalFormula(field.formula ?? '', [
          ...table.value.fields.filter((item) => item.id !== field.id),
          field,
        ]);
      } else {
        delete field.formula;
      }
      const before = table.value.fields.find((item) => item.id === field.id);
      if (
        before &&
        before.type !== field.type &&
        table.value.rows.some(
          (row) => row.values[field.id] !== undefined && row.values[field.id] !== null,
        )
      ) {
        throw new Error(t('此字段已有数据。请新建目标类型的字段，再复制或转换数据。'));
      }
      if (
        table.value.rows.some(
          (row) =>
            row.values[field.id] !== undefined && !validDataValue(field, row.values[field.id]),
        )
      ) {
        throw new Error(t('选项仍被记录使用，请先修改这些记录再移除选项。'));
      }
      change((draft) => {
        const index = draft.fields.findIndex((item) => item.id === field.id);
        if (
          fieldBase.value &&
          JSON.stringify(draft.fields[index]) !== JSON.stringify(fieldBase.value)
        ) {
          throw new Error(t('字段已被外部修改，请重新打开设置；当前输入仍保留'));
        }
        if (index >= 0) draft.fields[index] = field;
        else if (fieldInsert.value) {
          const position = draft.fields.findIndex((item) => item.id === fieldInsert.value!.id);
          if (position < 0) throw new Error(t('相邻字段已移除，请重新选择插入位置'));
          draft.fields.splice(position + (fieldInsert.value.side === 'right' ? 1 : 0), 0, field);
        } else {
          draft.fields.push(field);
        }
      });
      if (!message.value) fieldDraft.value = undefined;
      else fieldError.value = message.value;
    } catch (error) {
      fieldError.value = String(error);
    }
  }

  function removeField(field: DataField) {
    confirmAction.value = {
      title: t('删除「{0}」字段？', [field.name]),
      get detail() {
        return t('此列所有单元格和相关筛选将移除；引用此列的公式会显示错误。可以撤销。');
      },
      run: () => {
        change((draft) => {
          if (draft.fields.length === 1) throw new Error(t('至少保留一个字段'));
          draft.fields = draft.fields.filter((item) => item.id !== field.id);
          for (const row of draft.rows) delete row.values[field.id];
          for (const itemView of draft.views) {
            itemView.filters = itemView.filters.filter((filter) => filter.field !== field.id);
            itemView.sorts = itemView.sorts.filter((sort) => sort.field !== field.id);
            if (itemView.groupBy === field.id) itemView.groupBy = '';
            itemView.hiddenFields = itemView.hiddenFields.filter((id) => id !== field.id);
            delete itemView.widths[field.id];
            delete itemView.aggregates[field.id];
            if (itemView.fieldWrap) delete itemView.fieldWrap[field.id];
          }
        });
        fieldDraft.value = undefined;
      },
    };
  }

  function moveField(fieldId: string, offset: number) {
    change((draft) => {
      const index = draft.fields.findIndex((field) => field.id === fieldId);
      const to = index + offset;
      if (to >= 0 && to < draft.fields.length) {
        draft.fields.splice(to, 0, ...draft.fields.splice(index, 1));
      }
    });
  }

  const canReorderRows = computed(() => !readonly.value && !view.value?.sorts.length);
  let stopTableDrag: (() => void) | undefined;
  function endReorder() {
    stopTableDrag?.();
    stopTableDrag = undefined;
  }
  watch(() => props.tableId, endReorder);
  watch(viewId, endReorder);
  watch(readonly, endReorder);
  watch(canReorderRows, endReorder);
  onBeforeUnmount(endReorder);

  function startColumnDrag(event: PointerEvent, id: string) {
    if (readonly.value || !root.value) return;
    endReorder();
    stopTableDrag = startColumnPointerReorder(
      root.value,
      id,
      event,
      (target) => {
        change((draft) => {
          const from = draft.fields.findIndex((field) => field.id === id);
          if (from < 0 || !draft.fields.some((field) => field.id === target.id)) return;
          const [field] = draft.fields.splice(from, 1);
          const to =
            draft.fields.findIndex((item) => item.id === target.id) + Number(target.after);
          draft.fields.splice(to, 0, field);
        });
      },
      () => {
        fieldMenu.value = undefined;
      },
    );
  }

  function startRowDrag(event: PointerEvent, id: string) {
    if (!canReorderRows.value || !root.value) return;
    endReorder();
    stopTableDrag = startRowPointerReorder(
      root.value,
      id,
      event,
      (target) => {
        if (
          !canReorderRows.value ||
          !groups.value.some(
            (group) =>
              group.rows.some((row) => row.id === id) &&
              group.rows.some((row) => row.id === target.id),
          )
        ) {
          return;
        }
        change((draft) => {
          const from = draft.rows.findIndex((row) => row.id === id);
          if (from < 0 || !draft.rows.some((row) => row.id === target.id)) return;
          // Preserve hidden/filtered records and move only the dragged identity.
          const [row] = draft.rows.splice(from, 1);
          const to = draft.rows.findIndex((item) => item.id === target.id) + Number(target.after);
          draft.rows.splice(to, 0, row);
        });
      },
      () => {
        fieldMenu.value = undefined;
      },
    );
  }

  function addView() {
    const next = newDataView(t('视图 {0}', [(table.value?.views.length ?? 0) + 1]));
    change((draft) => draft.views.push(next));
    viewId.value = next.id;
    settings.value = true;
  }

  function duplicateView() {
    if (!view.value) return;
    const next = {
      ...copyTable(view.value),
      id: tableItemId(),
      name: t('{0} 副本', [view.value.name]),
    };
    change((draft) => draft.views.push(next));
    viewId.value = next.id;
  }

  function removeView() {
    const id = view.value?.id;
    change((draft) => {
      if (draft.views.length > 1) draft.views = draft.views.filter((item) => item.id !== id);
    });
  }

  async function keydown(event: KeyboardEvent) {
    if (event.isComposing) return;
    if (modalOpen.value) {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        if (confirmAction.value) confirmAction.value = undefined;
        else if (fieldDraft.value) fieldDraft.value = undefined;
        else io.importText.value = undefined;
      } else if (event.key === 'Tab') {
        const modal = [...(root.value?.querySelectorAll<HTMLElement>('.data-modal') ?? [])].at(-1);
        const focusable = [
          ...(modal?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)',
          ) ?? []),
        ];
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
      return;
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === 'z' &&
      !readonly.value &&
      props.tableId
    ) {
      const target = event.target as HTMLInputElement;
      target.blur?.();
      event.preventDefault();
      event.stopPropagation();
      try {
        store.undoDataTable(props.tableId, event.shiftKey);
      } catch (error) {
        message.value = String(error);
      }
      return;
    }
    if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    const target = event.target as HTMLElement;
    const cell = target.closest<HTMLElement>('[data-field]');
    const row = target.closest<HTMLElement>('[data-row]');
    if (!cell || !row || !['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
    event.preventDefault();
    target.blur();
    const ids = orderedRows.value.map((item) => item.id);
    const position = ids.indexOf(row.dataset.row!) + 1;
    const next = ids[position];
    if (next) {
      pageIndex.value = Math.floor(position / pageSize);
      await nextTick();
      root.value
        ?.querySelector<HTMLElement>(
          `[data-row="${next}"] [data-field="${cell.dataset.field}"] input, [data-row="${next}"] [data-field="${cell.dataset.field}"] textarea`,
        )
        ?.focus();
    } else if (!readonly.value) {
      await addRow();
    }
  }

  const sizing = ref<{ id: string; width: number }>();
  let stopResize: (() => void) | undefined;
  function resize(event: PointerEvent, field: DataField) {
    if (readonly.value) return;
    stopResize?.();
    event.preventDefault();
    const start = event.clientX;
    const initialWidth = view.value?.widths[field.id] ?? 180;
    sizing.value = { id: field.id, width: initialWidth };
    const move = (moveEvent: PointerEvent) => {
      sizing.value = {
        id: field.id,
        width: Math.round(Math.max(80, Math.min(1200, initialWidth + moveEvent.clientX - start))),
      };
    };
    const finish = () => {
      const value = sizing.value?.width;
      cleanup();
      if (value) {
        changeView((targetView) => {
          targetView.widths[field.id] = value;
        });
      }
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cleanup);
      sizing.value = undefined;
      stopResize = undefined;
    };
    stopResize = cleanup;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cleanup);
  }
  onBeforeUnmount(() => stopResize?.());
  const width = (field: DataField) =>
    sizing.value?.id === field.id ? sizing.value.width : (view.value?.widths[field.id] ?? 180);

  function openAttachment(id: string) {
    const targetFile = store.workspace?.files.find((item) => item.id === id);
    if (targetFile && /\.(md|markdown)$/i.test(targetFile.path)) {
      void store.openFileInNewTab(targetFile);
    } else if (targetFile) {
      store.openAttachmentInNewTab(targetFile);
    } else {
      message.value = t('附件已移除或不可访问');
    }
  }

  async function uploadAttachment(rowId: string, fieldId: string, attachmentFile: File) {
    const workspaceId = store.workspace?.id;
    const tableId = props.tableId;
    if (!workspaceId || !tableId || !attachmentService || readonly.value) return;
    await run(async () => {
      const added = await attachmentService.importAttachment(workspaceId, '', attachmentFile, false);
      if (store.workspace?.id !== workspaceId) {
        throw new Error(t('工作区已切换，上传的附件保留在原工作区'));
      }
      await store.refresh();
      if (store.workspace?.id !== workspaceId) throw new Error(t('工作区已切换'));
      const entry = store.workspace.files.find((item) => item.path === added.path);
      if (!entry) throw new Error(t('附件已上传，但暂未找到文件，请刷新后关联'));
      store.editDataTable(tableId, (draft) => {
        const row = draft.rows.find((item) => item.id === rowId);
        if (!row) throw new Error(t('记录已移除，上传的附件仍在工作区'));
        const previous = row.values[fieldId];
        row.values[fieldId] = [
          ...new Set([...(Array.isArray(previous) ? previous : []), entry.id]),
        ];
      });
    });
  }

  return {
    document,
    store,
    attachmentService,
    openLink,
    state,
    table,
    title,
    appearance,
    updateAppearance,
    commentDocument,
    resolveCover,
    uploadCover,
    renameTitle,
    readonly,
    query,
    viewId,
    settings,
    message,
    working,
    selectedRows,
    detailId,
    fieldDraft,
    fieldOptions,
    fieldError,
    fieldMenu,
    menuField,
    creatingField,
    confirmAction,
    root,
    view,
    evaluate,
    fields,
    rows,
    pageIndex,
    pageCount,
    detail,
    pageRows,
    groups,
    allSelected,
    saved,
    aggregateLabels,
    hasAggregates,
    canReorderRows,
    changeView,
    run,
    createField,
    openFieldMenu,
    commitFieldMenu,
    editMenuField,
    insertField,
    filterField,
    setCell,
    createCellOption,
    addRow,
    duplicateRows,
    deleteRows,
    saveField,
    removeField,
    moveField,
    startColumnDrag,
    startRowDrag,
    addView,
    duplicateView,
    removeView,
    keydown,
    resize,
    width,
    openAttachment,
    uploadAttachment,
    ...io,
  };
}
