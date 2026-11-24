<script setup lang="ts">
import { Copy, Trash2, X } from 'lucide-vue-next';
import type { DataRow, DataTable, DataValue, FileEntry } from '@tano/protocol';
import { t } from '../../i18n/i18n';
import DataTableCell from './DataTableCell.vue';

defineProps<{
  table: DataTable;
  detail: DataRow;
  evaluate: (row: DataRow, fieldId: string) => { value: DataValue; error?: string };
  readonly: boolean;
  canUpload: boolean;
  files: FileEntry[];
  createCellOption: (rowId: string, fieldId: string, name: string, expected: DataValue) => string;
}>();

const emit = defineEmits<{
  close: [];
  upload: [rowId: string, fieldId: string, file: File];
  change: [rowId: string, fieldId: string, value: DataValue, expected: DataValue];
  'edit-field': [fieldId: string, anchor: HTMLElement];
  error: [message: string];
  open: [fileId: string];
  link: [url: string];
  duplicate: [rowId: string];
  delete: [rowId: string];
}>();
</script>

<template>
  <aside class="data-detail panel-scrollbar" :aria-label="t('记录详情')">
    <header>
      <strong>{{ t('记录详情') }}</strong>
      <button class="data-icon" :aria-label="t('关闭记录详情')" @click="emit('close')">
        <X :size="16" />
      </button>
    </header>
    <div v-for="field in table.fields" :key="field.id" class="data-detail-field">
      <label>{{ field.name }}</label>
      <DataTableCell
        :field="field"
        :create-option="(name, expected) => createCellOption(detail.id, field.id, name, expected)"
        :can-upload="canUpload"
        :value="evaluate(detail, field.id).value"
        :error="evaluate(detail, field.id).error"
        :readonly="readonly"
        wrap
        :files="files"
        @upload="emit('upload', detail.id, field.id, $event)"
        @change="(value, expected) => emit('change', detail.id, field.id, value, expected)"
        @edit-field="emit('edit-field', field.id, $event)"
        @error="emit('error', $event)"
        @open="emit('open', $event)"
        @link="emit('link', $event)"
      />
    </div>
    <footer>
      <button :disabled="readonly" @click="emit('duplicate', detail.id)">
        <Copy :size="14" />{{ t('复制记录') }}
      </button>
      <button :disabled="readonly" @click="emit('delete', detail.id)">
        <Trash2 :size="14" />{{ t('删除记录') }}
      </button>
    </footer>
  </aside>
</template>

<style scoped>
.data-detail {
  flex: 0 0 360px;
  border-left: 1px solid var(--line);
  padding: 18px;
  overflow: auto;
  background: var(--paper);
}
.data-detail header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.data-detail button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 9px;
  border-radius: 5px;
  font: inherit;
  cursor: pointer;
}
.data-detail button:hover {
  background: var(--hover);
}
.data-detail button:disabled {
  opacity: 0.45;
  cursor: default;
}
.data-detail .data-icon {
  padding: 6px;
  flex: none;
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
@media (max-width: 760px) {
  .data-detail {
    position: absolute;
    inset: 0 0 0 auto;
    width: min(100%, 340px);
    z-index: 30;
    box-shadow: -8px 0 24px #0001;
  }
}
</style>
