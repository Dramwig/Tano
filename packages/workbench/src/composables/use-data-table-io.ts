import { ref, type ComputedRef } from 'vue';
import type { DataField, DataRow, DataTable, DataView } from '@tano/protocol';
import { t } from '../i18n/i18n';
import {
  applyDataPaste,
  copyTable,
  exportDataCsv,
  parseDelimited,
  tableItemId,
} from '../data-tables/data-tables';

export interface DataTableIoOptions {
  document: Document;
  table: ComputedRef<DataTable | undefined>;
  view: ComputedRef<DataView | undefined>;
  title: ComputedRef<string>;
  query: { value: string };
  readonly: ComputedRef<boolean>;
  fields: ComputedRef<DataField[]>;
  orderedRows: ComputedRef<DataRow[]>;
  message: { value: string };
  change: (operation: (table: DataTable) => void) => boolean;
}

export function useDataTableIo(options: DataTableIoOptions) {
  const { document, table, view, title, query, readonly, fields, orderedRows, message, change } =
    options;

  const fileInput = ref<HTMLInputElement>();
  const importText = ref<string>();
  const importError = ref('');

  function paste(event: ClipboardEvent) {
    if (readonly.value || !table.value) return;
    const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-field]');
    const row = cell?.closest<HTMLElement>('[data-row]');
    const text = event.clipboardData?.getData('text/plain');
    if (!cell || !row || !text || !/[\t\r\n]/.test(text)) return;
    event.preventDefault();
    try {
      const ids = orderedRows.value.map((item) => item.id);
      const next = applyDataPaste(
        table.value,
        ids,
        fields.value.map((field) => field.id),
        ids.indexOf(row.dataset.row!),
        fields.value.findIndex((field) => field.id === cell.dataset.field),
        parseDelimited(text, '\t'),
      );
      change((draft) => Object.assign(draft, next));
    } catch (error) {
      message.value = String(error);
    }
  }

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
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
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
      if (names.some((name) => !name) || new Set(names).size !== names.length) {
        throw new Error(t('表头名称不能为空或重复'));
      }
      const next = copyTable(table.value);
      const columns = names.map((name) => {
        const existing = next.fields.find((field) => field.name === name);
        if (existing) return existing.id;
        const field: DataField = { id: tableItemId(), name, type: 'text' };
        next.fields.push(field);
        return field.id;
      });
      const result = applyDataPaste(next, [], columns, 0, 0, grid);
      change((draft) => Object.assign(draft, result));
      if (!message.value) {
        importText.value = undefined;
        message.value = t('已导入 {0} 条记录', [grid.length]);
      } else {
        importError.value = message.value;
      }
    } catch (error) {
      importError.value = String(error);
    }
  }

  return {
    fileInput,
    importText,
    importError,
    paste,
    download,
    chooseImport,
    importCsv,
  };
}
