<script setup lang="ts">
import { X } from 'lucide-vue-next';
import { vSurfaceMotion } from '@tano/editor/surface-motion';
import type { DataField, DataTable } from '@tano/protocol';
import { localizedDataFieldTypes as dataFieldTypes } from '../../i18n/ui-labels';
import { t } from '../../i18n/i18n';
import type { DataTableConfirmAction } from '../../composables/use-data-table-page';

defineProps<{
  table?: DataTable;
  readonly: boolean;
  fieldDraft?: DataField;
  fieldOptions: string;
  fieldError: string;
  importText?: string;
  importError: string;
  confirmAction?: DataTableConfirmAction;
}>();

const emit = defineEmits<{
  'update:fieldDraft': [value: DataField | undefined];
  'update:fieldOptions': [value: string];
  'update:importText': [value: string | undefined];
  'update:confirmAction': [value: DataTableConfirmAction | undefined];
  'move-field': [fieldId: string, offset: number];
  'remove-field': [field: DataField];
  'save-field': [];
  'import-csv': [];
}>();
</script>

<template>
  <div
    v-if="fieldDraft"
    v-surface-motion="'DataTablePage:0'"
    class="data-modal-backdrop"
    @keydown.esc.stop="emit('update:fieldDraft', undefined)"
  >
    <section
      class="data-modal panel-scrollbar"
      role="dialog"
      aria-modal="true"
      :aria-label="t('字段设置')"
    >
      <header>
        <h2>{{ t('字段设置') }}</h2>
        <button
          class="data-icon"
          :aria-label="t('关闭字段设置')"
          @click="emit('update:fieldDraft', undefined)"
        >
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
            :value="fieldOptions"
            :aria-label="t('字段选项')"
            rows="5"
            @input="emit('update:fieldOptions', ($event.target as HTMLTextAreaElement).value)"
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
          <button @click="emit('move-field', fieldDraft.id, -1)">{{ t('左移一列') }}</button
          ><button @click="emit('move-field', fieldDraft.id, 1)">{{ t('右移一列') }}</button
          ><button
            :disabled="table.fields.length === 1"
            class="data-danger"
            @click="emit('remove-field', fieldDraft)"
          >
            {{ t('删除字段') }}
          </button>
        </div>
      </fieldset>
      <p v-if="fieldError" class="data-field-error" role="alert">{{ fieldError }}</p>
      <footer>
        <button @click="emit('update:fieldDraft', undefined)">{{ t('取消') }}</button
        ><button class="data-primary" :disabled="readonly" @click="emit('save-field')">
          {{ t('保存字段') }}
        </button>
      </footer>
    </section>
  </div>
  <div
    v-if="importText !== undefined"
    v-surface-motion="'DataTablePage:1'"
    class="data-modal-backdrop"
  >
    <section
      class="data-modal panel-scrollbar"
      role="dialog"
      aria-modal="true"
      :aria-label="t('导入 CSV')"
    >
      <header>
        <h2>{{ t('导入 CSV') }}</h2>
        <button
          class="data-icon"
          :aria-label="t('关闭导入')"
          @click="emit('update:importText', undefined)"
        >
          <X :size="17" />
        </button>
      </header>
      <p>
        {{ t('首行作为字段名称。同名字段按原类型读取，新字段使用文本类型。记录追加到表尾，公式列重新计算。') }}
      </p>
      <pre>{{ importText.slice(0, 600) }}</pre>
      <p v-if="importError" role="alert" class="data-field-error">{{ importError }}</p>
      <footer>
        <button @click="emit('update:importText', undefined)">{{ t('取消') }}</button
        ><button class="data-primary" :disabled="readonly" @click="emit('import-csv')">
          {{ t('导入记录') }}
        </button>
      </footer>
    </section>
  </div>
  <div
    v-if="confirmAction"
    v-surface-motion="'DataTablePage:2'"
    class="data-modal-backdrop"
  >
    <section
      class="data-modal panel-scrollbar"
      role="alertdialog"
      aria-modal="true"
      :aria-label="confirmAction.title"
    >
      <h2>{{ confirmAction.title }}</h2>
      <p>{{ confirmAction.detail }}</p>
      <footer>
        <button @click="emit('update:confirmAction', undefined)">{{ t('取消') }}</button
        ><button
          class="data-primary"
          @click="
            confirmAction.run();
            emit('update:confirmAction', undefined);
          "
        >
          {{ t('确认') }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
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
.data-modal fieldset {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.data-modal button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 9px;
  border-radius: 5px;
  font: inherit;
  cursor: pointer;
}
.data-modal button:hover {
  background: var(--hover);
}
.data-modal button:disabled {
  opacity: 0.45;
  cursor: default;
}
.data-modal .data-primary {
  background: var(--green-fill);
  color: var(--on-accent, white);
  white-space: nowrap;
}
.data-modal .data-primary:hover {
  background: var(--green-fill-hover);
}
.data-modal .data-icon {
  padding: 6px;
  flex: none;
}
.data-modal label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 12px 0;
  font-size: 12px;
}
.data-modal input,
.data-modal select,
.data-modal textarea {
  font: inherit;
  color: inherit;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 5px;
  padding: 7px 9px;
  min-width: 0;
  width: 100%;
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
.data-modal .data-danger {
  color: var(--danger);
}
.data-field-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
  font-size: 12px;
}
</style>
