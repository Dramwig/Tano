<script setup lang="ts">
import { localizedDataFieldTypes as dataFieldTypes } from '../ui-labels';
import { t } from '../i18n';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import {
  Plus,
  Table2,
  LayoutGrid,
  Columns3,
  Search,
  SlidersHorizontal,
  Undo2,
  Redo2,
  Download,
  Upload,
  X,
  Copy,
  Trash2,
  GripVertical,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
} from 'lucide-vue-next';
import type {
  DataAggregate,
  DataField,
  DataFieldType,
  DataRow,
  DataTable,
  DataValue,
  DataView,
} from '@tano/protocol';
import { dataTableName, parentPath, validDataValue } from '@tano/protocol';
import { useWorkspaceStore } from '../stores/workspace';
import {
  aggregateData,
  applyDataPaste,
  canonicalFormula,
  copyTable,
  dataEvaluator,
  dataValueText,
  dataViewRows,
  displayFormula,
  exportDataCsv,
  newDataView,
  parseDelimited,
  tableItemId,
} from '../data-tables';
import { nativeAttachments, openExternalUrl } from '../attachments';
import { useWorkbenchRuntime } from '../runtime';
import DataTableCell from './DataTableCell.vue';
import DataFieldMenu from './DataFieldMenu.vue';
import DataFieldCreate from './DataFieldCreate.vue';
import { addDataField, createAndSelectDataOption, dataFieldIcons } from '../data-table-properties';

const props = defineProps<{ tableId: string; controlsTarget?: string }>();
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
const file = computed(() => store.workspace?.files.find((file) => file.id === props.tableId));
const title = computed(() => dataTableName(file.value?.path ?? state.value?.path ?? t('数据表')));
async function renameTitle(event: Event) {
  const input = event.target as HTMLInputElement;
  await run(() => store.renameDataTable(props.tableId, input.value));
  input.value = title.value;
}
const readonly = computed(
  () =>
    !!store.workspace?.readOnly ||
    !!store.workspace?.files.find((file) => file.path === state.value?.path)?.readOnly ||
    !!state.value?.unavailable ||
    !!state.value?.error,
);
const query = ref(''),
  viewId = ref(''),
  settings = ref(false),
  message = ref(''),
  working = ref(false),
  selectedRows = ref<string[]>([]),
  detailId = ref('');
const fieldDraft = ref<DataField>(),
  fieldBase = ref<DataField>(),
  fieldOptions = ref(''),
  fieldError = ref('');
const fieldMenu = ref<{ id: string; anchor: HTMLElement }>();
const menuField = computed(() =>
  table.value?.fields.find((field) => field.id === fieldMenu.value?.id),
);
const fieldInsert = ref<{ id: string; side: 'left' | 'right' }>();
const creatingField = ref(false);
function createField(name: string, type: DataFieldType, formula?: string) {
  if (readonly.value) return t('当前数据表不可编辑');
  let id = '';
  try {
    store.editDataTable(props.tableId, (table) => {
      id = addDataField(table, name, type, formula).id;
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
function commitFieldMenu(operation: (table: DataTable) => void) {
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
  if (field && !view.value?.filters.some((filter) => filter.field === field.id))
    changeView((view) =>
      view.filters.push({ id: tableItemId(), field: field.id, operator: 'contains', value: '' }),
    );
  settings.value = true;
  fieldMenu.value = undefined;
}
const confirmAction = ref<{ title: string; detail: string; run: () => void }>();
const fileInput = ref<HTMLInputElement>(),
  root = ref<HTMLElement>();
const importText = ref<string>(),
  importError = ref('');
const modalOpen = computed(
  () => !!fieldDraft.value || importText.value !== undefined || !!confirmAction.value,
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
  } else if (modalFocus?.isConnected) modalFocus.focus();
});
const view = computed(
  () => table.value?.views.find((view) => view.id === viewId.value) ?? table.value?.views[0],
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
const pageIndex = ref(0),
  pageSize = 100;
const pageCount = computed(() => Math.max(1, Math.ceil(rows.value.length / pageSize)));
const detail = computed(() => table.value?.rows.find((row) => row.id === detailId.value));
const allGroups = computed(() => {
  const groups = new Map<string, DataRow[]>();
  for (const row of rows.value) {
    const value = view.value?.groupBy ? evaluate.value!(row, view.value.groupBy).value : '';
    const key = view.value?.groupBy ? dataValueText(value) || t('未分组') : '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  if (!groups.size) groups.set('', []);
  return [...groups].map(([label, rows]) => ({ label, rows }));
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
watch([query, viewId, () => props.tableId], () => {
  pageIndex.value = 0;
  fieldMenu.value = undefined;
  creatingField.value = false;
});
watch(pageCount, (count) => {
  pageIndex.value = Math.min(pageIndex.value, count - 1);
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
function change(operation: (table: DataTable) => void) {
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
function changeView(operation: (view: DataView) => void) {
  const id = view.value?.id;
  change((table) => {
    const view = table.views.find((view) => view.id === id);
    if (view) operation(view);
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
function setCell(rowId: string, fieldId: string, value: DataValue, expected: DataValue) {
  change((table) => {
    const row = table.rows.find((row) => row.id === rowId);
    if (!row) throw new Error(t('记录已移除'));
    const current = row.values[fieldId] ?? null;
    if (
      JSON.stringify(current) !== JSON.stringify(expected) &&
      JSON.stringify(current) !== JSON.stringify(value)
    )
      throw new Error(
        t('此单元格已被外部修改。你的输入为「{0}」，请核对后重新填写。', [dataValueText(value)]),
      );
    row.values[fieldId] = value;
  });
}
function createCellOption(rowId: string, fieldId: string, name: string, expected: DataValue) {
  if (readonly.value) return t('当前数据表不可编辑');
  try {
    store.editDataTable(props.tableId, (table) =>
      createAndSelectDataOption(table, rowId, fieldId, name, expected),
    );
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
async function addRow() {
  const id = tableItemId();
  const added = change((table) => {
    const values: Record<string, DataValue> = {};
    for (const filter of view.value?.filters ?? []) {
      const field = table.fields.find((field) => field.id === filter.field);
      if (filter.operator === 'eq' && field && validDataValue(field, filter.value))
        values[field.id] = filter.value;
    }
    table.rows.push({ id, values });
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
  change((table) => {
    for (const id of ids) {
      const index = table.rows.findIndex((row) => row.id === id);
      if (index >= 0)
        table.rows.splice(index + 1, 0, { ...copyTable(table.rows[index]), id: tableItemId() });
    }
  });
}
function deleteRows(ids: string[]) {
  confirmAction.value = {
    title: t('删除 {0} 条记录？', [ids.length]),
    get detail() { return t('关联文档和附件会保留。删除后可以撤销。'); },
    run: () => {
      change((table) => {
        table.rows = table.rows.filter((row) => !ids.includes(row.id));
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
  if (['select', 'multiselect'].includes(field.type))
    field.options = [
      ...new Set(
        fieldOptions.value
          .split('\n')
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ];
  else {
    delete field.options;
    delete field.optionColors;
  }
  if (field.optionColors)
    field.optionColors = Object.fromEntries(
      Object.entries(field.optionColors).filter(([option]) => field.options?.includes(option)),
    );
  try {
    if (field.type === 'formula')
      field.formula = canonicalFormula(field.formula ?? '', [
        ...table.value.fields.filter((item) => item.id !== field.id),
        field,
      ]);
    else delete field.formula;
    const before = table.value.fields.find((item) => item.id === field.id);
    if (
      before &&
      before.type !== field.type &&
      table.value.rows.some(
        (row) => row.values[field.id] !== undefined && row.values[field.id] !== null,
      )
    )
      throw new Error(t('此字段已有数据。请新建目标类型的字段，再复制或转换数据。'));
    if (
      table.value.rows.some(
        (row) => row.values[field.id] !== undefined && !validDataValue(field, row.values[field.id]),
      )
    )
      throw new Error(t('选项仍被记录使用，请先修改这些记录再移除选项。'));
    change((table) => {
      const index = table.fields.findIndex((item) => item.id === field.id);
      if (
        fieldBase.value &&
        JSON.stringify(table.fields[index]) !== JSON.stringify(fieldBase.value)
      )
        throw new Error(t('字段已被外部修改，请重新打开设置；当前输入仍保留'));
      if (index >= 0) table.fields[index] = field;
      else if (fieldInsert.value) {
        const position = table.fields.findIndex((item) => item.id === fieldInsert.value!.id);
        if (position < 0) throw new Error(t('相邻字段已移除，请重新选择插入位置'));
        table.fields.splice(position + (fieldInsert.value.side === 'right' ? 1 : 0), 0, field);
      } else table.fields.push(field);
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
    get detail() { return t('此列所有单元格和相关筛选将移除；引用此列的公式会显示错误。可以撤销。'); },
    run: () => {
      change((table) => {
        if (table.fields.length === 1) throw new Error(t('至少保留一个字段'));
        table.fields = table.fields.filter((item) => item.id !== field.id);
        for (const row of table.rows) delete row.values[field.id];
        for (const view of table.views) {
          view.filters = view.filters.filter((filter) => filter.field !== field.id);
          view.sorts = view.sorts.filter((sort) => sort.field !== field.id);
          if (view.groupBy === field.id) view.groupBy = '';
          view.hiddenFields = view.hiddenFields.filter((id) => id !== field.id);
          delete view.widths[field.id];
          delete view.aggregates[field.id];
          if (view.fieldWrap) delete view.fieldWrap[field.id];
        }
      });
      fieldDraft.value = undefined;
    },
  };
}
function moveField(fieldId: string, offset: number) {
  change((table) => {
    const index = table.fields.findIndex((field) => field.id === fieldId),
      to = index + offset;
    if (to >= 0 && to < table.fields.length)
      table.fields.splice(to, 0, ...table.fields.splice(index, 1));
  });
}
function addView() {
  const next = newDataView(t('视图 {0}', [(table.value?.views.length ?? 0) + 1]));
  change((table) => table.views.push(next));
  viewId.value = next.id;
  settings.value = true;
}
function duplicateView() {
  if (!view.value) return;
  const next = { ...copyTable(view.value), id: tableItemId(), name: t('{0} 副本', [view.value.name]) };
  change((table) => table.views.push(next));
  viewId.value = next.id;
}
function removeView() {
  const id = view.value?.id;
  change((table) => {
    if (table.views.length > 1) table.views = table.views.filter((view) => view.id !== id);
  });
}
function paste(event: ClipboardEvent) {
  if (readonly.value || !table.value) return;
  const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-field]');
  const row = cell?.closest<HTMLElement>('[data-row]');
  const text = event.clipboardData?.getData('text/plain');
  if (!cell || !row || !text || !/[\t\r\n]/.test(text)) return;
  event.preventDefault();
  try {
    const ids = orderedRows.value.map((row) => row.id);
    const next = applyDataPaste(
      table.value,
      ids,
      fields.value.map((field) => field.id),
      ids.indexOf(row.dataset.row!),
      fields.value.findIndex((field) => field.id === cell.dataset.field),
      parseDelimited(text, '\t'),
    );
    change((table) => Object.assign(table, next));
  } catch (error) {
    message.value = String(error);
  }
}
async function keydown(event: KeyboardEvent) {
  if (event.isComposing) return;
  if (modalOpen.value) {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      if (confirmAction.value) confirmAction.value = undefined;
      else if (fieldDraft.value) fieldDraft.value = undefined;
      else importText.value = undefined;
    } else if (event.key === 'Tab') {
      const modal = [...(root.value?.querySelectorAll<HTMLElement>('.data-modal') ?? [])].at(-1);
      const focusable = [
        ...(modal?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)',
        ) ?? []),
      ];
      const first = focusable[0],
        last = focusable.at(-1);
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
  if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey)
    return;
  const target = event.target as HTMLElement,
    cell = target.closest<HTMLElement>('[data-field]'),
    row = target.closest<HTMLElement>('[data-row]');
  if (!cell || !row || !['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
  event.preventDefault();
  target.blur();
  const ids = orderedRows.value.map((row) => row.id);
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
  } else if (!readonly.value) await addRow();
}
const sizing = ref<{ id: string; width: number }>();
let stopResize: (() => void) | undefined;
function resize(event: PointerEvent, field: DataField) {
  if (readonly.value) return;
  stopResize?.();
  event.preventDefault();
  const start = event.clientX,
    width = view.value?.widths[field.id] ?? 180;
  sizing.value = { id: field.id, width };
  const move = (event: PointerEvent) => {
    sizing.value = {
      id: field.id,
      width: Math.round(Math.max(80, Math.min(1200, width + event.clientX - start))),
    };
  };
  const finish = () => {
    const value = sizing.value?.width;
    cleanup();
    if (value)
      changeView((view) => {
        view.widths[field.id] = value;
      });
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
function download() {
  if (!table.value || !view.value) return;
  const url = URL.createObjectURL(
    new Blob([exportDataCsv(table.value, view.value, false, query.value)], {
      type: 'text/csv;charset=utf-8',
    }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `${title.value.replace(/[<>:"/\\|?*]/g, '-')}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function chooseImport(event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    message.value = t('CSV 文件需小于 10 MiB');
    return;
  }
  try {
    importText.value = await file.text();
    importError.value = '';
  } catch (error) {
    message.value = String(error);
  }
}
function importCsv() {
  if (!table.value || importText.value === undefined) return;
  try {
    const grid = parseDelimited(importText.value);
    if (grid.length < 2) throw new Error(t('CSV 需要表头和至少一条记录'));
    const names = grid.shift()!.map((name) => name.trim());
    if (names.some((name) => !name) || new Set(names).size !== names.length)
      throw new Error(t('表头名称不能为空或重复'));
    const next = copyTable(table.value);
    const columns = names.map((name) => {
      const existing = next.fields.find((field) => field.name === name);
      if (existing) return existing.id;
      const field: DataField = { id: tableItemId(), name, type: 'text' };
      next.fields.push(field);
      return field.id;
    });
    const result = applyDataPaste(next, [], columns, 0, 0, grid);
    change((table) => Object.assign(table, result));
    if (!message.value) {
      importText.value = undefined;
      message.value = t('已导入 {0} 条记录', [grid.length]);
    } else importError.value = message.value;
  } catch (error) {
    importError.value = String(error);
  }
}
function openAttachment(id: string) {
  const file = store.workspace?.files.find((file) => file.id === id);
  if (file && /\.(md|markdown)$/i.test(file.path)) void store.openFileInNewTab(file);
  else if (file) store.openAttachmentInNewTab(file);
  else message.value = t('附件已移除或不可访问');
}
async function uploadAttachment(rowId: string, fieldId: string, file: File) {
  const workspaceId = store.workspace?.id,
    tableId = props.tableId;
  if (!workspaceId || !tableId || !attachmentService || readonly.value) return;
  await run(async () => {
    const added = await attachmentService.importAttachment(workspaceId, '', file, false);
    if (store.workspace?.id !== workspaceId)
      throw new Error(t('工作区已切换，上传的附件保留在原工作区'));
    await store.refresh();
    if (store.workspace?.id !== workspaceId) throw new Error(t('工作区已切换'));
    const entry = store.workspace.files.find((entry) => entry.path === added.path);
    if (!entry) throw new Error(t('附件已上传，但暂未找到文件，请刷新后关联'));
    store.editDataTable(tableId, (table) => {
      const row = table.rows.find((row) => row.id === rowId);
      if (!row) throw new Error(t('记录已移除，上传的附件仍在工作区'));
      const previous = row.values[fieldId];
      row.values[fieldId] = [...new Set([...(Array.isArray(previous) ? previous : []), entry.id])];
    });
  });
}
const filterOperators = [
  { id: 'eq', get label() { return t('等于'); } },
  { id: 'ne', get label() { return t('不等于'); } },
  { id: 'contains', get label() { return t('包含'); } },
  { id: 'gt', get label() { return t('大于'); } },
  { id: 'lt', get label() { return t('小于'); } },
  { id: 'empty', get label() { return t('为空'); } },
  { id: 'notEmpty', get label() { return t('不为空'); } },
];
</script>

<template>
  <section ref="root" class="data-page" :aria-label="t('数据表工作区')" @paste="paste" @keydown="keydown">
    <template v-if="table && view && state">
      <header class="data-heading">
        <Table2 :size="20" /><input
          class="data-title"
          :aria-label="t('数据表名称')"
          :readonly="readonly || working"
          :value="title"
          @change="renameTitle"
        />
        <Teleport :to="controlsTarget ?? 'body'" :disabled="!controlsTarget" defer>
          <div
            class="data-table-controls"
            role="group"
            :aria-label="t('数据表工具')"
            @keydown.stop="keydown"
          >
            <span class="data-save-state">{{
              state.saving ? t('保存中…') : state.error ? t('保存暂停') : saved ? t('已保存') : t('未保存')
            }}</span
            ><span v-if="store.workspace?.readOnly" class="data-save-state">{{ t('只读') }}</span
            ><button
              class="icon-button"
              :aria-label="t('撤销数据表修改')"
              :title="t('撤销数据表修改')"
              :disabled="readonly || !state.undo.length"
              @click="store.undoDataTable(tableId)"
            >
              <Undo2 :size="16" /></button
            ><button
              class="icon-button"
              :aria-label="t('重做数据表修改')"
              :title="t('重做数据表修改')"
              :disabled="readonly || !state.redo.length"
              @click="store.undoDataTable(tableId, true)"
            >
              <Redo2 :size="16" />
            </button>
            <details class="data-table-menu">
              <summary class="icon-button" :aria-label="t('数据表操作')" :title="t('数据表操作')">
                <MoreHorizontal :size="19" />
              </summary>
              <div>
                <button @click="download"><Download :size="14" />{{ t('导出当前视图 CSV') }}</button
                ><button :disabled="readonly" @click="fileInput?.click()">
                  <Upload :size="14" />{{ t('导入 CSV') }}</button
                ><button
                  :disabled="store.workspace?.readOnly || working"
                  @click="
                    run(() =>
                      store.copyDataTable({ ...table!, name: title }, parentPath(state!.path)),
                    )
                  "
                >
                  <Copy :size="14" />{{ t('另存副本') }}
                </button>
              </div>
            </details>
          </div>
        </Teleport>
      </header>
      <div v-if="state.error || state.unavailable" class="data-notice" role="alert">
        <span>{{ state.error || t('数据表已被移除或格式无效，当前内容仍保留。') }}</span
        ><button @click="run(() => store.retryDataTable(tableId!))">{{ t('重试保存') }}</button
        ><button
          @click="
            run(() => store.copyDataTable({ ...table!, name: title }, parentPath(state!.path)))
          "
          :disabled="store.workspace?.readOnly"
        >
          {{ t('另存副本') }}</button
        ><button @click="run(() => store.discardDataTable(tableId!))">
          {{ t('保留恢复文件并重新载入') }}
        </button>
      </div>
      <div class="data-view-bar">
        <div class="data-view-tabs panel-scrollbar" role="tablist" :aria-label="t('数据表视图')">
          <button
            v-for="item in table.views"
            :key="item.id"
            role="tab"
            :aria-selected="view.id === item.id"
            @click="
              viewId = item.id;
              selectedRows = [];
            "
          >
            <component
              :is="item.type === 'cards' ? LayoutGrid : item.type === 'board' ? Columns3 : Table2"
              :size="14"
            />{{ item.name }}</button
          ><button v-if="!readonly" class="data-icon" :aria-label="t('新增视图')" @click="addView">
            <Plus :size="14" />
          </button>
        </div>
        <div class="data-tools">
          <nav v-if="pageCount > 1" class="data-pagination" :aria-label="t('记录分页')">
            <button
              class="data-icon"
              :disabled="pageIndex === 0"
              :aria-label="t('上一页记录')"
              :title="t('上一页记录')"
              @click="pageIndex--"
            >
              <ChevronLeft :size="15" />
            </button>
            <span>{{ pageIndex + 1 }} / {{ pageCount }}</span>
            <button
              class="data-icon"
              :disabled="pageIndex + 1 >= pageCount"
              :aria-label="t('下一页记录')"
              :title="t('下一页记录')"
              @click="pageIndex++"
            >
              <ChevronRight :size="15" />
            </button>
          </nav>
          <label class="data-search"
            ><Search :size="14" /><input
              v-model="query"
              :aria-label="t('搜索记录')"
              :placeholder="t('搜索记录')" /></label
          ><button :class="{ active: settings }" @click="settings = !settings">
            <SlidersHorizontal :size="14" />{{ t('视图设置') }}<span
              v-if="view.filters.length"
              class="data-filter-count"
              >{{ view.filters.length }}</span
            ></button
          ><button
            v-if="view.type !== 'table'"
            class="data-primary"
            :disabled="readonly"
            @click="addRow"
          >
            <Plus :size="14" />{{ t('新记录') }}
          </button>
        </div>
      </div>
      <div v-if="selectedRows.length" class="data-selection">
        <span>{{ t('已选择') }} {{ selectedRows.length }} {{ t('条') }}</span
        ><button :disabled="readonly" @click="duplicateRows(selectedRows)">
          <Copy :size="13" />{{ t('复制记录') }}</button
        ><button :disabled="readonly" @click="deleteRows(selectedRows)">
          <Trash2 :size="13" />{{ t('删除记录') }}</button
        ><button @click="selectedRows = []">{{ t('取消选择') }}</button>
      </div>
      <div class="data-body">
        <div class="data-grid-scroll panel-scrollbar">
          <table
            v-if="view.type === 'table'"
            class="data-grid"
            :class="{ 'data-frozen': view.freeze }"
            :style="{
              width: `max(100%, ${fields.reduce((sum, field) => sum + width(field), 0) + 44 + (creatingField ? 240 : 60)}px)`,
            }"
            :aria-label="t('数据表记录')"
          >
            <colgroup>
              <col style="width: 44px" />
              <col
                v-for="field in fields"
                :key="field.id"
                :style="{ width: `${width(field)}px` }"
              />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th class="data-row-tools">
                  <input
                    type="checkbox"
                    :aria-label="t('选择当前页记录')"
                    :checked="allSelected"
                    @change="selectedRows = allSelected ? [] : pageRows.map((row) => row.id)"
                  />
                </th>
                <th
                  v-for="(field, index) in fields"
                  :key="field.id"
                  :data-field="field.id"
                  :class="{ 'data-first': index === 0 }"
                >
                  <button
                    class="data-field-heading"
                    :class="{ active: fieldMenu?.id === field.id }"
                    aria-haspopup="dialog"
                    :aria-expanded="fieldMenu?.id === field.id"
                    @click="openFieldMenu(field, $event)"
                  >
                    <component
                      :is="dataFieldIcons[field.type]"
                      class="data-field-type"
                      :size="14"
                    />
                    <span>{{ field.name }}</span
                    ><ChevronDown :size="12" /></button
                  ><button
                    v-if="!readonly"
                    class="data-column-resize"
                    :aria-label="t('调整 {0} 列宽', [field.name])"
                    @pointerdown="resize($event, field)"
                    @keydown.left.prevent="
                      changeView((view) => {
                        view.widths[field.id] = Math.max(80, width(field) - 10);
                      })
                    "
                    @keydown.right.prevent="
                      changeView((view) => {
                        view.widths[field.id] = Math.min(1200, width(field) + 10);
                      })
                    "
                  />
                </th>
                <th>
                  <DataFieldCreate
                    v-model:open="creatingField"
                    :readonly="readonly"
                    :create="createField"
                    @update:open="fieldMenu = undefined"
                  />
                </th>
              </tr>
            </thead>
            <tbody v-for="group in groups" :key="group.label">
              <tr v-if="group.label" class="data-group-row">
                <td :colspan="fields.length + 2">
                  <strong>{{ group.label }}</strong
                  ><span>{{ group.rows.length }} {{ t('条') }}</span>
                </td>
              </tr>
              <tr
                v-for="row in group.rows"
                :key="row.id"
                :data-row="row.id"
                :class="{ selected: selectedRows.includes(row.id) }"
              >
                <td class="data-row-tools">
                  <input
                    v-model="selectedRows"
                    type="checkbox"
                    :value="row.id"
                    :aria-label="t('选择记录 {0}', [dataValueText(evaluate!(row, table.fields[0].id).value) || row.id])"
                  />
                </td>
                <td
                  v-for="(field, index) in fields"
                  :key="field.id"
                  :data-field="field.id"
                  :class="{ 'data-first': index === 0 }"
                >
                  <DataTableCell
                    :field="field"
                    :create-option="
                      (name, expected) => createCellOption(row.id, field.id, name, expected)
                    "
                    :can-upload="!!attachmentService && !store.isDemo && !working"
                    @upload="uploadAttachment(row.id, field.id, $event)"
                    :value="evaluate!(row, field.id).value"
                    :error="evaluate!(row, field.id).error"
                    :readonly="readonly"
                    :wrap="view.fieldWrap?.[field.id] ?? view.wrap"
                    :files="store.workspace?.files ?? []"
                    @change="(value, expected) => setCell(row.id, field.id, value, expected)"
                    @edit-field="fieldMenu = { id: field.id, anchor: $event }"
                    @error="message = $event"
                    @open="openAttachment"
                    @link="openLink($event)"
                  />
                </td>
                <td>
                  <button
                    class="data-row-open"
                    :aria-label="t('展开记录 {0}', [dataValueText(evaluate!(row, table.fields[0].id).value) || row.id])"
                    @click="detailId = row.id"
                  >
                    {{ t('展开') }}
                  </button>
                </td>
              </tr>
            </tbody>
            <tbody>
              <tr v-if="!rows.length">
                <td :colspan="fields.length + 2" class="data-empty">
                  {{
                    table.rows.length
                      ? t('没有符合当前筛选条件的记录')
                      : t('从第一条记录开始，也可以直接粘贴多行多列数据')
                  }}
                </td>
              </tr>
              <tr>
                <td :colspan="fields.length + 2" class="data-add-record-cell">
                  <button class="data-add-row" :disabled="readonly" @click="addRow">
                    <Plus :size="12" />{{ t('添加记录') }}
                  </button>
                </td>
              </tr>
            </tbody>
            <tfoot v-if="hasAggregates">
              <tr>
                <td />
                <td v-for="field in fields" :key="field.id">
                  <div
                    v-if="(view.aggregates[field.id] ?? 'none') !== 'none'"
                    class="data-aggregate"
                    :aria-label="t('{0} 汇总', [field.name])"
                  >
                    <span>{{ aggregateLabels[view.aggregates[field.id]!] }}</span>
                    <span class="data-aggregate-value">{{
                      aggregateData(rows, field.id, view.aggregates[field.id] ?? 'none', evaluate!)
                    }}</span>
                  </div>
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
          <div v-else class="data-card-groups" :class="{ 'data-board': view.type === 'board' }">
            <section v-for="group in groups" :key="group.label">
              <h3 v-if="group.label || view.type === 'board'">
                {{ group.label || t('全部记录') }} <span>{{ group.rows.length }}</span>
              </h3>
              <div class="data-cards">
                <button
                  v-for="row in group.rows"
                  :key="row.id"
                  class="data-card"
                  @click="detailId = row.id"
                >
                  <strong>{{
                    dataValueText(evaluate!(row, table.fields[0].id).value) || t('未命名记录')
                  }}</strong>
                  <dl>
                    <template
                      v-for="field in fields.filter((field) => field.id !== table!.fields[0].id)"
                      :key="field.id"
                      ><dt>{{ field.name }}</dt>
                      <dd>
                        {{
                          evaluate!(row, field.id).error
                            ? t('#错误')
                            : field.type === 'attachment'
                              ? ((row.values[field.id] as string[]) || [])
                                  .map(
                                    (id) =>
                                      store.workspace?.files.find((file) => file.id === id)?.name ??
                                      t('附件不可用'),
                                  )
                                  .join('、')
                              : dataValueText(evaluate!(row, field.id).value) || '—'
                        }}
                      </dd></template
                    >
                  </dl>
                </button>
              </div>
              <p v-if="!group.rows.length" class="data-empty">{{ t('没有符合条件的记录') }}</p>
            </section>
          </div>
        </div>
        <aside v-if="settings" class="data-settings panel-scrollbar" :aria-label="t('视图设置')">
          <header>
            <strong>{{ t('视图设置') }}</strong
            ><button class="data-icon" :aria-label="t('关闭视图设置')" @click="settings = false">
              <X :size="16" />
            </button>
          </header>
          <fieldset :disabled="readonly">
            <label
              >{{ t('视图名称') }}<input
                :value="view.name"
                @change="
                  changeView((view) => {
                    view.name = ($event.target as HTMLInputElement).value;
                  })
                " /></label
            ><label
              >{{ t('显示方式') }}<select
                :aria-label="t('显示方式')"
                :value="view.type"
                @change="
                  changeView((view) => {
                    view.type = ($event.target as HTMLSelectElement).value as DataView['type'];
                  })
                "
              >
                <option value="table">{{ t('表格') }}</option>
                <option value="cards">{{ t('卡片') }}</option>
                <option value="board">{{ t('看板') }}</option>
              </select></label
            ><label
              >{{ t('分组') }}<select
                :aria-label="t('分组字段')"
                :value="view.groupBy"
                @change="
                  changeView((view) => {
                    view.groupBy = ($event.target as HTMLSelectElement).value;
                  })
                "
              >
                <option value="">{{ t('不分组') }}</option>
                <option v-for="field in table.fields" :key="field.id" :value="field.id">
                  {{ field.name }}
                </option>
              </select></label
            ><label class="data-check-label"
              ><input
                type="checkbox"
                :checked="view.wrap"
                @change="
                  changeView((view) => {
                    view.wrap = !view.wrap;
                    delete view.fieldWrap;
                  })
                "
              />{{ t('单元格自动换行') }}</label
            ><label class="data-check-label"
              ><input
                type="checkbox"
                :checked="view.freeze"
                @change="
                  changeView((view) => {
                    view.freeze = !view.freeze;
                  })
                "
              />{{ t('冻结第一列') }}</label
            >
            <h4>{{ t('排序') }}</h4>
            <div v-for="(sort, index) in view.sorts" :key="index" class="data-rule">
              <select
                :aria-label="t('排序字段')"
                :value="sort.field"
                @change="
                  changeView((view) => {
                    view.sorts[index].field = ($event.target as HTMLSelectElement).value;
                  })
                "
              >
                <option v-for="field in table.fields" :key="field.id" :value="field.id">
                  {{ field.name }}
                </option></select
              ><select
                :aria-label="t('排序方向')"
                :value="sort.direction"
                @change="
                  changeView((view) => {
                    view.sorts[index].direction = ($event.target as HTMLSelectElement).value as
                      'asc' | 'desc';
                  })
                "
              >
                <option value="asc">{{ t('升序') }}</option>
                <option value="desc">{{ t('降序') }}</option></select
              ><button
                :aria-label="t('移除排序')"
                @click="
                  changeView((view) => {
                    view.sorts.splice(index, 1);
                  })
                "
              >
                <X :size="13" />
              </button>
            </div>
            <button
              @click="
                changeView((view) =>
                  view.sorts.push({ field: table!.fields[0].id, direction: 'asc' }),
                )
              "
            >
              <Plus :size="13" />{{ t('添加排序') }}
            </button>
            <h4>{{ t('筛选 · 满足全部条件') }}</h4>
            <div v-for="(filter, index) in view.filters" :key="filter.id" class="data-filter-rule">
              <div class="data-rule">
                <select
                  :aria-label="t('筛选字段')"
                  :value="filter.field"
                  @change="
                    changeView((view) => {
                      view.filters[index].field = ($event.target as HTMLSelectElement).value;
                    })
                  "
                >
                  <option v-for="field in table.fields" :key="field.id" :value="field.id">
                    {{ field.name }}
                  </option></select
                ><select
                  :aria-label="t('筛选条件')"
                  :value="filter.operator"
                  @change="
                    changeView((view) => {
                      view.filters[index].operator = ($event.target as HTMLSelectElement)
                        .value as typeof filter.operator;
                    })
                  "
                >
                  <option v-for="op in filterOperators" :key="op.id" :value="op.id">
                    {{ op.label }}
                  </option></select
                ><button
                  :aria-label="t('移除筛选')"
                  @click="
                    changeView((view) => {
                      view.filters.splice(index, 1);
                    })
                  "
                >
                  <X :size="13" />
                </button>
              </div>
              <input
                v-if="!['empty', 'notEmpty'].includes(filter.operator)"
                :aria-label="t('筛选值')"
                :value="filter.value"
                :placeholder="t('输入匹配值')"
                @change="
                  changeView((view) => {
                    view.filters[index].value = ($event.target as HTMLInputElement).value;
                  })
                "
              />
            </div>
            <button
              @click="
                changeView((view) =>
                  view.filters.push({
                    id: tableItemId(),
                    field: table!.fields[0].id,
                    operator: 'contains',
                    value: '',
                  }),
                )
              "
            >
              <Plus :size="13" />{{ t('添加筛选') }}
            </button>
            <h4>{{ t('显示字段') }}</h4>
            <label v-for="field in table.fields" :key="field.id" class="data-check-label"
              ><input
                type="checkbox"
                :checked="!view.hiddenFields.includes(field.id)"
                @change="
                  changeView((view) => {
                    view.hiddenFields = view.hiddenFields.includes(field.id)
                      ? view.hiddenFields.filter((id) => id !== field.id)
                      : [...view.hiddenFields, field.id];
                  })
                "
              />{{ field.name }}</label
            >
            <div class="data-settings-footer">
              <button @click="duplicateView">{{ t('复制视图') }}</button
              ><button :disabled="table.views.length < 2" @click="removeView">{{ t('删除视图') }}</button>
            </div>
          </fieldset>
        </aside>
        <aside v-if="detail" class="data-detail panel-scrollbar" :aria-label="t('记录详情')">
          <header>
            <strong>{{ t('记录详情') }}</strong
            ><button class="data-icon" :aria-label="t('关闭记录详情')" @click="detailId = ''">
              <X :size="16" />
            </button>
          </header>
          <div v-for="field in table.fields" :key="field.id" class="data-detail-field">
            <label>{{ field.name }}</label
            ><DataTableCell
              :field="field"
              :create-option="
                (name, expected) => createCellOption(detail!.id, field.id, name, expected)
              "
              :can-upload="!!attachmentService && !store.isDemo && !working"
              @upload="uploadAttachment(detail!.id, field.id, $event)"
              :value="evaluate!(detail, field.id).value"
              :error="evaluate!(detail, field.id).error"
              :readonly="readonly"
              wrap
              :files="store.workspace?.files ?? []"
              @change="(value, expected) => setCell(detail!.id, field.id, value, expected)"
              @edit-field="fieldMenu = { id: field.id, anchor: $event }"
              @error="message = $event"
              @open="openAttachment"
              @link="openLink($event)"
            />
          </div>
          <footer>
            <button :disabled="readonly" @click="duplicateRows([detail.id])">
              <Copy :size="14" />{{ t('复制记录') }}</button
            ><button :disabled="readonly" @click="deleteRows([detail.id])">
              <Trash2 :size="14" />{{ t('删除记录') }}
            </button>
          </footer>
        </aside>
      </div>
    </template>
    <div v-else class="data-empty">
      <h2>{{ t('数据表不可用') }}</h2>
      <p>{{ t('它可能已被移除，或文件格式需要修复。') }}</p>
      <p v-for="error in store.dataTableErrors" :key="error">{{ error }}</p>
      <button @click="run(() => store.refresh())">{{ t('重新载入') }}</button>
    </div>
    <p v-if="message" class="data-notice" role="status">
      {{ message
      }}<button class="data-icon" :aria-label="t('关闭提示')" @click="message = ''">
        <X :size="14" />
      </button>
    </p>
    <DataFieldMenu
      v-if="table && view && fieldMenu && menuField"
      :key="menuField.id"
      :table="table"
      :field="menuField"
      :view="view"
      :anchor="fieldMenu.anchor"
      :readonly="readonly"
      :commit="commitFieldMenu"
      @close="fieldMenu = undefined"
      @edit="editMenuField"
      @insert="insertField"
      @remove="
        removeField(menuField);
        fieldMenu = undefined;
      "
      @filter="filterField"
    />
    <input ref="fileInput" type="file" accept=".csv,text/csv" hidden @change="chooseImport" />
    <div v-if="fieldDraft" class="data-modal-backdrop" @keydown.esc.stop="fieldDraft = undefined">
      <section
        class="data-modal panel-scrollbar"
        role="dialog"
        aria-modal="true"
        :aria-label="t('字段设置')"
      >
        <header>
          <h2>{{ t('字段设置') }}</h2>
          <button class="data-icon" :aria-label="t('关闭字段设置')" @click="fieldDraft = undefined">
            <X :size="17" />
          </button>
        </header>
        <fieldset :disabled="readonly">
          <label
            >{{ t('字段名称') }}<input
              v-model="fieldDraft.name"
              :aria-label="t('字段名称')"
              maxlength="200"
              autofocus /></label
          ><label
            >{{ t('字段类型') }}<select v-model="fieldDraft.type" :aria-label="t('字段类型')">
              <option v-for="(label, type) in dataFieldTypes" :key="type" :value="type">
                {{ label }}
              </option>
            </select></label
          ><label v-if="['select', 'multiselect'].includes(fieldDraft.type)"
            >{{ t('选项（每行一个）') }}<textarea
              v-model="fieldOptions"
              :aria-label="t('字段选项')"
              rows="5"
            /></label
          ><label v-if="fieldDraft.type === 'formula'"
            >{{ t('公式') }}<textarea
              v-model="fieldDraft.formula"
              :aria-label="t('字段公式')"
              rows="4"
              :placeholder="t('IF([状态] = \u0022选择\u0022, [价格], 0)')"
            /><small
              >{{ t('用 [字段名称] 引用列。支持 + − * /、比较、IF、ROUND、ABS、MIN、MAX、SUM、AND、OR、NOT。') }}</small
            ></label
          >
          <div
            v-if="table?.fields.some((field) => field.id === fieldDraft!.id)"
            class="data-field-actions"
          >
            <button @click="moveField(fieldDraft.id, -1)">{{ t('左移一列') }}</button
            ><button @click="moveField(fieldDraft.id, 1)">{{ t('右移一列') }}</button
            ><button
              :disabled="table.fields.length === 1"
              class="data-danger"
              @click="removeField(fieldDraft)"
            >
              {{ t('删除字段') }}
            </button>
          </div>
        </fieldset>
        <p v-if="fieldError" class="data-field-error" role="alert">{{ fieldError }}</p>
        <footer>
          <button @click="fieldDraft = undefined">{{ t('取消') }}</button
          ><button class="data-primary" :disabled="readonly" @click="saveField">{{ t('保存字段') }}</button>
        </footer>
      </section>
    </div>
    <div v-if="importText !== undefined" class="data-modal-backdrop">
      <section
        class="data-modal panel-scrollbar"
        role="dialog"
        aria-modal="true"
        :aria-label="t('导入 CSV')"
      >
        <header>
          <h2>{{ t('导入 CSV') }}</h2>
          <button class="data-icon" :aria-label="t('关闭导入')" @click="importText = undefined">
            <X :size="17" />
          </button>
        </header>
        <p>
          {{ t('首行作为字段名称。同名字段按原类型读取，新字段使用文本类型。记录追加到表尾，公式列重新计算。') }}
        </p>
        <pre>{{ importText.slice(0, 600) }}</pre>
        <p v-if="importError" role="alert" class="data-field-error">{{ importError }}</p>
        <footer>
          <button @click="importText = undefined">{{ t('取消') }}</button
          ><button class="data-primary" :disabled="readonly" @click="importCsv">{{ t('导入记录') }}</button>
        </footer>
      </section>
    </div>
    <div v-if="confirmAction" class="data-modal-backdrop">
      <section
        class="data-modal panel-scrollbar"
        role="alertdialog"
        aria-modal="true"
        :aria-label="confirmAction.title"
      >
        <h2>{{ confirmAction.title }}</h2>
        <p>{{ confirmAction.detail }}</p>
        <footer>
          <button @click="confirmAction = undefined">{{ t('取消') }}</button
          ><button
            class="data-primary"
            @click="
              confirmAction.run();
              confirmAction = undefined;
            "
          >
            {{ t('确认') }}
          </button>
        </footer>
      </section>
    </div>
  </section>
</template>

<style scoped>
.data-page {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  flex: 1;
  overflow: hidden;
  background: var(--paper);
  color: var(--text);
  font-size: 13px;
}
.data-page button,
.data-table-menu button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 9px;
  border-radius: 5px;
  font: inherit;
  cursor: pointer;
}
.data-page button:hover,
.data-table-menu button:hover {
  background: var(--hover);
}
.data-page button:disabled,
.data-table-controls button:disabled {
  opacity: 0.45;
  cursor: default;
}
.data-page .data-primary {
  background: var(--green-fill);
  color: white;
  white-space: nowrap;
}
.data-page .data-primary:hover {
  background: var(--green-fill-hover);
}
.data-page input,
.data-page select,
.data-page textarea {
  font: inherit;
  color: inherit;
}
.data-page .data-icon {
  padding: 6px;
  flex: none;
}
.data-home-heading {
  padding: 48px 48px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}
.data-eyebrow {
  color: var(--muted);
  font-size: 12px;
}
.data-home-heading h1 {
  font-size: 28px;
  letter-spacing: -1px;
  margin: 8px 0;
}
.data-home-heading p {
  color: var(--muted);
  margin: 0;
}
.data-starters {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  padding: 0 48px 32px;
}
.data-starters button {
  display: grid;
  grid-template-columns: 30px 1fr 16px;
  text-align: left;
  border: 1px solid var(--line);
  padding: 20px;
  background: var(--sidebar);
  column-gap: 12px;
}
.data-starters button > svg:first-child {
  grid-row: 1/3;
  color: var(--green);
}
.data-starters strong {
  font-size: 14px;
}
.data-starters span {
  grid-column: 2;
  font-size: 12px;
  color: var(--muted);
}
.data-starters button > svg:last-child {
  grid-column: 3;
  grid-row: 1/3;
  color: var(--muted);
}
.data-list-heading {
  display: flex;
  justify-content: space-between;
  margin: 0 48px 10px;
  align-items: center;
}
.data-list-heading h2 {
  font-size: 13px;
  margin: 0;
}
.data-list-heading span {
  font-size: 12px;
  color: var(--muted);
}
.data-table-list {
  padding: 0 48px;
  overflow: auto;
}
.data-table-list > button {
  width: 100%;
  justify-content: flex-start;
  padding: 18px 10px;
  border-bottom: 1px solid var(--line);
  border-radius: 0;
  gap: 12px;
}
.data-table-list > button > svg {
  color: var(--green);
}
.data-table-list strong {
  font-weight: 500;
}
.data-table-list span {
  color: var(--muted);
  margin-left: auto;
  font-size: 12px;
}
.data-list-arrow {
  transform: rotate(180deg);
}
.data-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 22px 28px 12px;
}
.data-heading > svg {
  color: var(--green);
  flex: none;
}
.data-title {
  font-size: 23px !important;
  font-weight: 650 !important;
  border: 0;
  padding: 3px;
  background: transparent;
  min-width: 100px;
  flex: 1;
  width: 100%;
}
.data-save-state {
  color: var(--muted);
  white-space: nowrap;
  font-size: 11px;
}
.data-table-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}
.data-table-controls > .icon-button {
  padding: 0;
  flex: none;
}
.data-view-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 0 28px 6px;
  flex-wrap: wrap;
}
.data-view-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: auto;
}
.data-view-tabs > button {
  border-radius: 16px;
  white-space: nowrap;
  padding: 6px 10px;
  color: var(--muted);
}
.data-view-tabs > button[aria-selected='true'] {
  color: var(--text);
  background: var(--sidebar);
}
.data-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  flex-wrap: wrap;
}
.data-pagination {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--muted);
  font-size: 11px;
  white-space: nowrap;
}
.data-tools .active {
  background: var(--accent);
  color: var(--green);
}
.data-search {
  display: flex;
  align-items: center;
  color: var(--muted);
  gap: 6px;
}
.data-search input {
  background: transparent;
  border: 0;
  width: 115px;
  padding: 5px 0;
  outline: none;
}
.data-filter-count {
  background: var(--accent);
  border-radius: 4px;
  padding: 0 4px;
}
.data-body {
  flex: 1;
  display: flex;
  min-height: 0;
  min-width: 0;
  position: relative;
}
.data-grid-scroll {
  flex: 1;
  min-width: 0;
  overflow: auto;
  padding: 0 28px 24px;
}
.data-grid {
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
  font-size: 12px;
}
.data-grid th,
.data-grid td {
  padding: 0;
  border-bottom: 1px solid var(--line);
  border-right: 1px solid color-mix(in srgb, var(--line) 65%, transparent);
  vertical-align: top;
  text-align: left;
  font-weight: 400;
}
.data-grid td:last-child,
.data-grid th:last-child {
  border-right: 0;
}
.data-grid thead {
  position: sticky;
  top: 0;
  z-index: 10;
}
.data-grid th {
  height: 32px;
  background: var(--paper);
  position: relative;
  color: var(--muted);
}
.data-field-heading {
  width: 100%;
  justify-content: flex-start !important;
  padding: 8px 9px !important;
  overflow: hidden;
  white-space: nowrap;
  border-radius: 0 !important;
}
.data-field-heading > span {
  overflow: hidden;
  text-overflow: ellipsis;
}
.data-field-heading > svg:last-child {
  margin-left: auto;
  flex: none;
  opacity: 0;
}
.data-field-heading:hover > svg:last-child,
.data-field-heading:focus-visible > svg:last-child,
.data-field-heading.active > svg:last-child {
  opacity: 1;
}
.data-field-heading.active {
  background: var(--sidebar);
}
.data-field-type {
  font-size: 11px;
  color: var(--muted);
  flex: none;
}
.data-column-resize {
  position: absolute;
  padding: 0 !important;
  top: 0;
  right: -3px;
  height: 100%;
  width: 6px;
  cursor: col-resize !important;
  z-index: 2;
  border-radius: 0 !important;
}
.data-column-resize:hover {
  background: var(--green) !important;
}
.data-row-tools {
  text-align: center !important;
  width: 44px;
  padding: 8px 0 !important;
  background: var(--paper);
}
.data-row-tools input {
  accent-color: var(--green);
  margin: 0;
}
.data-frozen .data-row-tools {
  position: sticky;
  left: 0;
  z-index: 3;
}
.data-frozen .data-first {
  position: sticky;
  left: 44px;
  background: var(--paper);
  z-index: 3;
}
.data-grid tr:hover > td:not(.data-add-record-cell) {
  background: var(--sidebar);
}
.data-grid tr.selected > td {
  background: var(--accent);
}
.data-page .data-row-open {
  color: var(--muted);
  font-size: 10px;
  margin-top: 3px;
}
.data-grid .data-add-record-cell {
  padding: 4px 0;
}
.data-page .data-add-row {
  width: auto;
  gap: 4px;
  color: var(--muted);
  padding: 3px 6px;
  line-height: 16px;
}
.data-group-row td {
  background: var(--surface) !important;
  padding: 12px 10px !important;
}
.data-group-row span {
  color: var(--muted);
  margin-left: 12px;
  font-size: 11px;
}
.data-grid tfoot td {
  border: 0;
}
.data-aggregate {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
  align-items: center;
  min-height: 36px;
  padding: 8px 9px;
  color: var(--muted);
  font-size: 11px;
  white-space: nowrap;
}
.data-aggregate-value {
  font-variant-numeric: tabular-nums;
}
.data-empty {
  padding: 45px 20px !important;
  text-align: center !important;
  color: var(--muted);
}
.data-empty h2 {
  font-size: 18px;
}
.data-selection {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 5px 32px;
  background: var(--accent);
  font-size: 12px;
}
.data-settings,
.data-detail {
  flex: 0 0 300px;
  border-left: 1px solid var(--line);
  padding: 18px;
  overflow: auto;
  background: var(--paper);
}
.data-detail {
  flex-basis: 360px;
}
.data-settings header,
.data-detail header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.data-page fieldset {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.data-settings label,
.data-modal label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 12px 0;
  font-size: 12px;
}
.data-settings input:not([type='checkbox']),
.data-settings select,
.data-modal input,
.data-modal select,
.data-modal textarea {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 5px;
  padding: 7px 9px;
  min-width: 0;
  width: 100%;
}
.data-settings .data-check-label {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}
.data-check-label input {
  accent-color: var(--green);
}
.data-settings h4 {
  margin: 24px 0 10px;
  font-size: 12px;
  font-weight: 600;
}
.data-rule {
  display: flex;
  gap: 5px;
  margin: 8px 0;
}
.data-rule select {
  width: 42%;
  padding: 5px;
}
.data-rule button {
  padding: 4px;
}
.data-filter-rule {
  margin-bottom: 12px;
}
.data-settings-footer {
  display: flex;
  justify-content: space-between;
  margin-top: 24px;
  border-top: 1px solid var(--line);
  padding-top: 12px;
}
.data-detail-field {
  margin: 0 0 16px;
  border-bottom: 1px solid var(--line);
}
.data-detail-field > label {
  display: block;
  color: var(--muted);
  font-size: 11px;
  margin: 0 0 5px;
}
.data-detail footer {
  display: flex;
  justify-content: space-between;
  margin-top: 24px;
}
.data-card-groups {
  padding-top: 20px;
}
.data-card-groups h3 {
  font-size: 13px;
  margin: 5px 0 14px;
}
.data-card-groups h3 span {
  color: var(--muted);
  margin-left: 8px;
  font-weight: 400;
}
.data-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 14px;
  margin-bottom: 24px;
}
.data-page .data-card {
  display: block;
  text-align: left;
  border: 1px solid var(--line);
  padding: 18px;
  border-radius: 8px;
  background: var(--paper);
}
.data-card strong {
  display: block;
  font-size: 15px;
  margin-bottom: 14px;
  overflow-wrap: anywhere;
}
.data-card dl {
  display: grid;
  grid-template-columns: 70px 1fr;
  gap: 8px;
  margin: 0;
  font-size: 12px;
}
.data-card dt {
  color: var(--muted);
}
.data-card dd {
  margin: 0;
  overflow-wrap: anywhere;
  max-height: 60px;
  overflow: hidden;
}
.data-board {
  display: flex;
  gap: 20px;
}
.data-board > section {
  flex: 0 0 280px;
}
.data-board .data-cards {
  display: flex;
  flex-direction: column;
}
.data-notice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  background: var(--warning-bg);
  color: var(--warning);
  padding: 10px 24px;
  margin: 0;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.data-notice > span {
  flex: 1;
}
.data-notice > .data-icon {
  margin-left: auto;
}
.data-table-menu {
  position: relative;
}
.data-table-menu summary {
  list-style: none;
  cursor: pointer;
}
.data-table-menu > div {
  position: absolute;
  right: 0;
  top: 32px;
  z-index: 40;
  display: flex;
  flex-direction: column;
  min-width: 190px;
  padding: 6px;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: 0 8px 24px #0002;
}
.data-table-menu button {
  justify-content: flex-start;
  text-align: left;
}
.data-archived {
  margin: 20px 48px;
  font-size: 12px;
  color: var(--muted);
}
.data-archived div {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px;
}
.data-archived div span {
  flex: 1;
}
.data-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 110;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0004;
  padding: 24px;
}
.data-modal {
  width: 440px;
  max-width: 100%;
  max-height: 85vh;
  overflow: auto;
  background: var(--paper);
  padding: 24px;
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: 0 20px 60px #0003;
}
.data-modal header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.data-modal h2 {
  margin: 0;
  font-size: 17px;
}
.data-modal footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 24px;
}
.data-modal p,
.data-modal small {
  color: var(--muted);
  line-height: 1.6;
}
.data-modal pre {
  max-height: 220px;
  overflow: auto;
  background: var(--surface);
  padding: 12px;
  font-size: 11px;
}
.data-modal .data-field-error,
.data-page .data-danger {
  color: var(--danger);
}
.data-field-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
  font-size: 12px;
}
@media (max-width: 760px) {
  .data-heading {
    padding: 16px 12px;
    gap: 6px;
  }
  .data-title {
    font-size: 18px !important;
  }
  .data-table-controls .data-save-state {
    display: none;
  }
  .data-view-bar {
    padding: 0 12px;
    gap: 0;
  }
  .data-tools {
    flex: 1;
    justify-content: space-between;
  }
  .data-grid-scroll {
    padding: 0 12px 20px;
  }
  .data-settings,
  .data-detail {
    position: absolute;
    inset: 0 0 0 auto;
    width: min(100%, 340px);
    z-index: 30;
    box-shadow: -8px 0 24px #0001;
  }
  .data-home-heading {
    padding: 28px 20px 20px;
    align-items: flex-start;
  }
  .data-home-heading h1 {
    font-size: 24px;
  }
  .data-home-heading p {
    font-size: 12px;
  }
  .data-starters {
    padding: 0 20px 24px;
    grid-template-columns: 1fr;
  }
  .data-table-list {
    padding: 0 20px;
  }
  .data-list-heading {
    margin: 0 20px 10px;
  }
  .data-table-list span {
    font-size: 10px;
  }
  .data-selection {
    padding: 5px 12px;
    gap: 5px;
  }
  .data-selection button {
    font-size: 11px;
  }
}
</style>
