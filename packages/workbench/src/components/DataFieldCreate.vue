<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { CSSProperties } from 'vue';
import { ArrowLeft, Plus, Search, X } from 'lucide-vue-next';
import { dataFieldTypes } from '@tano/protocol';
import type { DataFieldType } from '@tano/protocol';
import { dataFieldIcons } from '../data-table-properties';

const props = defineProps<{
  readonly: boolean;
  create: (name: string, type: DataFieldType, formula?: string) => string;
}>();
const open = defineModel<boolean>('open', { default: false });
const host = ref<HTMLElement>(),
  panel = ref<HTMLElement>(),
  input = ref<HTMLInputElement>();
const name = ref(''),
  query = ref(''),
  formula = ref(''),
  error = ref('');
const selectedType = ref<DataFieldType>('text');
const formulaStep = ref(false);
const style = ref<CSSProperties>({});
const types: DataFieldType[] = [
  'text',
  'number',
  'select',
  'multiselect',
  'date',
  'checkbox',
  'url',
  'attachment',
  'formula',
];
const filteredTypes = computed(() =>
  types.filter((type) =>
    `${dataFieldTypes[type]} ${type}`.toLowerCase().includes(query.value.trim().toLowerCase()),
  ),
);

function position() {
  if (!open.value || !host.value || !panel.value) return;
  const rect = host.value.getBoundingClientRect();
  const width = Math.min(320, window.innerWidth - 16);
  const height = Math.min(panel.value.scrollHeight + 2, window.innerHeight - 16);
  style.value = {
    width: `${width}px`,
    left: `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`,
    top: `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - height - 8))}px`,
    maxHeight: `${window.innerHeight - 16}px`,
  };
}
function close(restoreFocus = false) {
  open.value = false;
  if (restoreFocus) void nextTick(() => host.value?.querySelector('button')?.focus());
}
function outside(event: Event) {
  if (![host.value, panel.value].some((element) => element?.contains(event.target as Node)))
    close();
}
function listeners(add: boolean) {
  if (add) {
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
  } else {
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('focusin', outside);
    window.removeEventListener('resize', position);
    window.removeEventListener('scroll', position, true);
  }
}
watch(open, async (value) => {
  listeners(value);
  if (!value) return;
  name.value = query.value = formula.value = error.value = '';
  selectedType.value = 'text';
  formulaStep.value = false;
  await nextTick();
  if (!open.value) return;
  host.value?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  position();
  input.value?.focus({ preventScroll: true });
});
watch([query, formulaStep, error], async () => {
  await nextTick();
  position();
});
watch(
  () => props.readonly,
  (value) => {
    if (value) close();
  },
);
onBeforeUnmount(() => listeners(false));

function submit(type: DataFieldType) {
  if (props.readonly) return;
  error.value = props.create(name.value, type, type === 'formula' ? formula.value : undefined);
  if (!error.value) close();
}
async function choose(type: DataFieldType) {
  selectedType.value = type;
  error.value = '';
  if (type !== 'formula') return submit(type);
  formulaStep.value = true;
  await nextTick();
  panel.value?.querySelector('textarea')?.focus();
}
async function back() {
  formulaStep.value = false;
  error.value = '';
  await nextTick();
  panel.value?.querySelector<HTMLInputElement>('.field-type-search input')?.focus();
}
function focusFirstType() {
  panel.value?.querySelector<HTMLButtonElement>('.field-type-grid button')?.focus();
}
function nameKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.key !== 'Enter') return;
  event.preventDefault();
  submit(selectedType.value);
}
function keydown(event: KeyboardEvent) {
  if (event.isComposing) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    if (formulaStep.value) void back();
    else close(true);
    return;
  }
  const target = event.target as HTMLElement;
  if (!target.matches('.field-type-grid button')) return;
  const buttons = [
    ...(panel.value?.querySelectorAll<HTMLButtonElement>('.field-type-grid button') ?? []),
  ];
  const index = buttons.indexOf(target as HTMLButtonElement);
  const offsets: Record<string, number> = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -2,
    ArrowDown: 2,
  };
  const offset = offsets[event.key];
  if (offset !== undefined) {
    event.preventDefault();
    buttons[Math.max(0, Math.min(buttons.length - 1, index + offset))]?.focus();
  }
}
</script>

<template>
  <div ref="host" class="field-create" :class="{ 'is-open': open }" @keydown.stop="keydown">
    <button
      v-if="!open"
      class="field-create-trigger"
      type="button"
      aria-label="添加属性"
      title="添加属性"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :disabled="readonly"
      @click="open = true"
    >
      <Plus :size="15" />
    </button>
    <template v-else>
      <component :is="dataFieldIcons[selectedType]" :size="14" />
      <input
        ref="input"
        v-model="name"
        class="field-create-name"
        aria-label="新属性名称"
        placeholder="输入属性名称…"
        maxlength="200"
        autocomplete="off"
        @input="error = ''"
        @keydown="nameKeydown"
        @keydown.down.prevent="focusFirstType"
      />
      <button
        class="field-create-cancel"
        type="button"
        aria-label="取消添加属性"
        title="取消"
        @click="close(true)"
      >
        <X :size="14" />
      </button>
    </template>
  </div>
  <Teleport to="body">
    <section
      v-if="open"
      ref="panel"
      class="field-create-panel panel-scrollbar"
      :style="style"
      role="dialog"
      aria-label="添加属性"
      @keydown.stop="keydown"
    >
      <template v-if="!formulaStep">
        <label class="field-type-search">
          <Search :size="13" /><input
            v-model="query"
            aria-label="搜索属性类型"
            placeholder="选择属性类型"
            @keydown.down.prevent="focusFirstType"
          />
        </label>
        <div class="field-type-grid">
          <button
            v-for="type in filteredTypes"
            :key="type"
            type="button"
            :class="{ 'field-type-formula': type === 'formula' && !query.trim() }"
            @click="choose(type)"
          >
            <component :is="dataFieldIcons[type]" :size="15" /><span>{{
              dataFieldTypes[type]
            }}</span>
          </button>
        </div>
        <p v-if="!filteredTypes.length" class="field-create-hint">没有匹配的属性类型</p>
      </template>
      <template v-else>
        <button class="field-formula-back" type="button" @click="back">
          <ArrowLeft :size="14" />公式
        </button>
        <textarea
          v-model="formula"
          aria-label="新属性公式"
          rows="4"
          placeholder="例如：[价格] * 2"
          @input="error = ''"
          @keydown.ctrl.enter.prevent="submit('formula')"
          @keydown.meta.enter.prevent="submit('formula')"
        />
        <p class="field-create-hint">用 [属性名称] 引用列，支持四则运算和 IF、SUM 等函数。</p>
        <button
          class="field-create-submit"
          type="button"
          :disabled="!formula.trim()"
          @click="submit('formula')"
        >
          创建公式属性
        </button>
      </template>
      <p v-if="error" class="field-create-error" role="alert">{{ error }}</p>
    </section>
  </Teleport>
</template>

<style scoped>
.field-create {
  display: flex;
  align-items: center;
  height: 32px;
  color: var(--muted);
}
.field-create.is-open {
  width: 240px;
  max-width: 100%;
  gap: 6px;
  padding: 0 6px 0 9px;
}
.field-create > svg {
  flex: none;
}
.field-create .field-create-trigger {
  padding: 6px;
}
.field-create .field-create-name {
  width: 0;
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  padding: 4px 0;
  background: transparent;
  color: var(--text);
  font: inherit;
}
.field-create .field-create-cancel {
  padding: 4px;
  color: var(--muted);
}
.field-create-panel {
  position: fixed;
  z-index: 160;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 7px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--paper);
  color: var(--text);
  font-size: 12px;
  box-shadow:
    0 4px 18px #00000012,
    0 1px 4px #0000000a;
}
.field-type-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 7px 8px;
  color: var(--muted);
}
.field-type-search input {
  min-width: 0;
  flex: 1;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
}
.field-type-search:focus-within {
  color: var(--green);
}
.field-type-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px 4px;
}
.field-create-panel button {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 31px;
  padding: 6px 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.field-create-panel button > svg {
  flex: none;
  color: var(--muted);
}
.field-create-panel button:hover,
.field-create-panel button:focus-visible {
  background: var(--sidebar);
}
.field-create-panel button:focus-visible {
  outline: 2px solid var(--green);
  outline-offset: -2px;
}
.field-type-grid .field-type-formula {
  grid-column: 1 / -1;
  margin-top: 5px;
  padding-top: 11px;
  border-top: 1px solid var(--line);
  border-radius: 0 0 4px 4px;
}
.field-create-panel textarea {
  display: block;
  box-sizing: border-box;
  width: 100%;
  margin-top: 5px;
  padding: 8px;
  border: 1px solid var(--control-border);
  border-radius: 5px;
  background: transparent;
  color: var(--text);
  font: inherit;
  resize: vertical;
}
.field-create-panel textarea:focus {
  outline: 1px solid var(--green);
  border-color: var(--green);
}
.field-create-hint {
  margin: 8px;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.6;
}
.field-create-panel .field-create-submit {
  justify-content: center;
  width: 100%;
  background: var(--green-fill);
  color: white;
}
.field-create-panel .field-create-submit:hover {
  background: var(--green-fill-hover);
}
.field-create-panel button:disabled {
  opacity: 0.45;
  cursor: default;
}
.field-create-error {
  margin: 8px;
  color: var(--danger);
  font-size: 12px;
  line-height: 1.5;
}
</style>
