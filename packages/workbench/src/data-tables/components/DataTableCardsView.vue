<script setup lang="ts">
import type { DataField, DataRow, DataTable, DataValue, DataView, FileEntry } from '@tano/protocol';
import { t } from '../../i18n/i18n';
import { dataValueText } from '../data-tables';

defineProps<{
  table: DataTable;
  view: DataView;
  fields: DataField[];
  groups: Array<{ label: string; rows: DataRow[] }>;
  evaluate: (row: DataRow, fieldId: string) => { value: DataValue; error?: string };
  files: FileEntry[];
}>();

const emit = defineEmits<{
  'select-row': [rowId: string];
}>();
</script>

<template>
  <div class="data-card-groups" :class="{ 'data-board': view.type === 'board' }">
    <section v-for="group in groups" :key="group.label">
      <h3 v-if="group.label || view.type === 'board'">
        {{ group.label || t('全部记录') }} <span>{{ group.rows.length }}</span>
      </h3>
      <div class="data-cards">
        <button
          v-for="row in group.rows"
          :key="row.id"
          class="data-card"
          @click="emit('select-row', row.id)"
        >
          <strong>{{
            dataValueText(evaluate(row, table.fields[0].id).value) || t('未命名记录')
          }}</strong>
          <dl>
            <template
              v-for="field in fields.filter((item) => item.id !== table.fields[0].id)"
              :key="field.id"
            >
              <dt>{{ field.name }}</dt>
              <dd>
                {{
                  evaluate(row, field.id).error
                    ? t('#错误')
                    : field.type === 'attachment'
                      ? ((row.values[field.id] as string[]) || [])
                          .map(
                            (id) =>
                              files.find((file) => file.id === id)?.name ?? t('附件不可用'),
                          )
                          .join('、')
                      : dataValueText(evaluate(row, field.id).value) || '—'
                }}
              </dd>
            </template>
          </dl>
        </button>
      </div>
      <p v-if="!group.rows.length" class="data-empty">{{ t('没有符合条件的记录') }}</p>
    </section>
  </div>
</template>

<style scoped>
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
.data-card {
  display: block;
  text-align: left;
  border: 1px solid var(--line);
  padding: 18px;
  border-radius: 8px;
  background: var(--paper);
  font: inherit;
  cursor: pointer;
}
.data-card:hover {
  background: var(--hover);
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
.data-empty {
  padding: 45px 20px !important;
  text-align: center !important;
  color: var(--muted);
}
</style>
