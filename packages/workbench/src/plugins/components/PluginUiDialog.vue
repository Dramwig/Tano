<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { Puzzle, Search, X } from 'lucide-vue-next';
import { t } from '../../i18n/i18n';
import type { PluginUiDialogRequest, PluginUiToastItem } from '../../stores/workspace-plugins-state';

const props = defineProps<{
  dialog: PluginUiDialogRequest | null;
  toasts: readonly PluginUiToastItem[];
}>();
const emit = defineEmits<{
  resolve: [id: string, value: string | boolean | null];
  dismissToast: [id: string];
}>();

const query = ref('');
const selectedIndex = ref(0);
const promptValue = ref('');
const inputRef = ref<HTMLInputElement>();

const filteredItems = computed(() => {
  if (props.dialog?.kind !== 'pick') return [];
  const q = query.value.trim().toLowerCase();
  if (!q) return props.dialog.options.items;
  return props.dialog.options.items.filter(
    (item) =>
      item.label.toLowerCase().includes(q) ||
      item.description?.toLowerCase().includes(q) ||
      item.detail?.toLowerCase().includes(q),
  );
});

watch(
  () => props.dialog?.id,
  async () => {
    query.value = '';
    selectedIndex.value = 0;
    promptValue.value = props.dialog?.kind === 'prompt' ? (props.dialog.options.defaultValue ?? '') : '';
    if (props.dialog) {
      await nextTick();
      inputRef.value?.focus();
    }
  },
  { immediate: true },
);

watch(filteredItems, (items) => {
  if (selectedIndex.value >= items.length) selectedIndex.value = 0;
});

function cancel() {
  if (!props.dialog) return;
  emit('resolve', props.dialog.id, props.dialog.kind === 'confirm' ? false : null);
}

function confirmPrompt() {
  if (props.dialog?.kind !== 'prompt') return;
  emit('resolve', props.dialog.id, promptValue.value);
}

function choosePick(id: string) {
  if (props.dialog?.kind !== 'pick') return;
  emit('resolve', props.dialog.id, id);
}

function handleKeydown(event: KeyboardEvent) {
  if (!props.dialog) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    cancel();
    return;
  }
  if (props.dialog.kind === 'pick') {
    const items = filteredItems.value;
    if (!items.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selectedIndex.value = (selectedIndex.value + 1) % items.length;
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      selectedIndex.value = (selectedIndex.value - 1 + items.length) % items.length;
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = items[selectedIndex.value];
      if (target) choosePick(target.id);
    }
  }
}
</script>

<template>
  <div
    v-if="dialog"
    class="plugin-ui-backdrop"
    role="presentation"
    @mousedown.self="cancel"
    @keydown="handleKeydown"
  >
    <section
      class="plugin-ui-dialog" data-surface-role="dialog"
      role="dialog"
      aria-modal="true"
      :aria-label="dialog.options.title"
    >
      <header class="plugin-ui-header">
        <div class="plugin-ui-source">
          <Puzzle :size="13" aria-hidden="true" />
          <span>{{ t('插件：{0}', [dialog.pluginName]) }}</span>
        </div>
        <button type="button" class="plugin-ui-close" :aria-label="t('取消')" @click="cancel">
          <X :size="15" />
        </button>
      </header>
      <h3 class="plugin-ui-title">{{ dialog.options.title }}</h3>

      <template v-if="dialog.kind === 'pick'">
        <div class="plugin-ui-search">
          <Search :size="14" aria-hidden="true" />
          <input
            ref="inputRef"
            v-model="query"
            type="text"
            :placeholder="dialog.options.placeholder || t('输入关键词筛选…')"
            :aria-label="dialog.options.placeholder || dialog.options.title"
            autocomplete="off"
          />
        </div>
        <ul v-if="filteredItems.length" class="plugin-ui-list" role="listbox">
          <li
            v-for="(item, index) in filteredItems"
            :key="item.id"
            role="option"
            :aria-selected="index === selectedIndex"
          >
            <button
              type="button"
              class="plugin-ui-option"
              :class="{ active: index === selectedIndex }"
              @mouseenter="selectedIndex = index"
              @click="choosePick(item.id)"
            >
              <div class="plugin-ui-option-head">
                <strong>{{ item.label }}</strong>
                <span v-if="item.description" class="plugin-ui-option-desc">{{ item.description }}</span>
              </div>
              <p v-if="item.detail" class="plugin-ui-option-detail">{{ item.detail }}</p>
            </button>
          </li>
        </ul>
        <p v-else class="plugin-ui-empty">{{ t('没有匹配的选项') }}</p>
      </template>

      <form v-else-if="dialog.kind === 'prompt'" class="plugin-ui-form" @submit.prevent="confirmPrompt">
        <p v-if="dialog.options.message" class="plugin-ui-message">{{ dialog.options.message }}</p>
        <input
          ref="inputRef"
          v-model="promptValue"
          type="text"
          class="plugin-ui-input"
          :placeholder="dialog.options.placeholder"
          :aria-label="dialog.options.title"
          autocomplete="off"
        />
        <div class="plugin-ui-actions">
          <button type="button" class="plugin-ui-btn" @click="cancel">{{ t('取消') }}</button>
          <button type="submit" class="plugin-ui-btn primary">
            {{ dialog.options.confirmLabel || t('确定') }}
          </button>
        </div>
      </form>

      <div v-else class="plugin-ui-form">
        <p v-if="dialog.options.message" class="plugin-ui-message">{{ dialog.options.message }}</p>
        <div class="plugin-ui-actions">
          <button type="button" class="plugin-ui-btn" @click="cancel">
            {{ dialog.options.cancelLabel || t('取消') }}
          </button>
          <button
            type="button"
            class="plugin-ui-btn"
            :class="dialog.options.danger ? 'danger' : 'primary'"
            @click="emit('resolve', dialog.id, true)"
          >
            {{ dialog.options.confirmLabel || t('确认') }}
          </button>
        </div>
      </div>
    </section>
  </div>

  <div v-if="toasts.length" class="plugin-toast-stack" role="status" aria-live="polite">
    <div
      v-for="toast in toasts"
      :key="toast.id"
      class="plugin-toast"
      :class="`tone-${toast.tone}`"
    >
      <div class="plugin-toast-body">
        <strong>{{ toast.pluginName }}</strong>
        <span>{{ toast.message }}</span>
      </div>
      <button
        type="button"
        class="plugin-toast-close"
        :aria-label="t('关闭提示')"
        @click="emit('dismissToast', toast.id)"
      >
        <X :size="13" />
      </button>
    </div>
  </div>
</template>

<style scoped>
@layer components {
.plugin-ui-backdrop {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: min(14vh, 108px) 16px 24px;
  background: rgb(0 0 0 / 32%);
}
.plugin-ui-dialog {
  width: min(480px, 100%);
  max-height: 72vh;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius-dialog, 12px);
  background: var(--paper);
  color: var(--text);
  box-shadow: var(--dialog-shadow, 0 20px 56px rgb(0 0 0 / 26%));
}
.plugin-ui-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.plugin-ui-source {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--muted);
}
.plugin-ui-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: var(--muted);
}
.plugin-ui-close:hover {
  background: var(--hover);
  color: var(--text);
}
.plugin-ui-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
}
.plugin-ui-message {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--muted);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.plugin-ui-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  height: 36px;
  border: 1px solid var(--control-border, var(--line));
  border-radius: var(--radius-control, 8px);
  background: var(--surface, var(--paper));
  color: var(--muted);
}
.plugin-ui-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  outline: none;
}
.plugin-ui-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  max-height: 300px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.plugin-ui-option {
  width: 100%;
  text-align: left;
  padding: 8px 10px;
  border-radius: 7px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  color: var(--text);
}
.plugin-ui-option:hover,
.plugin-ui-option.active {
  background: var(--selected, var(--hover));
}
.plugin-ui-option-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.plugin-ui-option-head strong {
  font-size: 13px;
  font-weight: 500;
}
.plugin-ui-option-desc,
.plugin-ui-option-detail {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
  overflow-wrap: anywhere;
}
.plugin-ui-empty {
  margin: 6px 0;
  font-size: 12px;
  color: var(--muted);
  text-align: center;
}
.plugin-ui-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.plugin-ui-input {
  width: 100%;
  box-sizing: border-box;
  height: 36px;
  padding: 0 10px;
  border: 1px solid var(--control-border, var(--line));
  border-radius: var(--radius-control, 8px);
  background: var(--surface, var(--paper));
  color: var(--text);
  font-size: 13px;
}
.plugin-ui-input:focus {
  outline: 2px solid var(--green);
  outline-offset: -1px;
}
.plugin-ui-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.plugin-ui-btn {
  height: 32px;
  padding: 0 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius-control, 7px);
  background: var(--surface, var(--paper));
  color: var(--text);
  font-size: 13px;
}
.plugin-ui-btn:hover {
  background: var(--hover);
}
.plugin-ui-btn.primary {
  border-color: var(--green);
  background: var(--green);
  color: #fff;
}
.plugin-ui-btn.danger {
  border-color: var(--danger, #c4483d);
  background: var(--danger, #c4483d);
  color: #fff;
}
.plugin-toast-stack {
  position: fixed;
  right: 18px;
  bottom: 34px;
  z-index: 115;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: min(360px, calc(100vw - 32px));
  pointer-events: none;
}
.plugin-toast {
  pointer-events: auto;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-left: 3px solid var(--muted);
  border-radius: 9px;
  background: var(--paper);
  color: var(--text);
  box-shadow: 0 8px 24px rgb(0 0 0 / 16%);
  font-size: 12px;
}
.plugin-toast.tone-success {
  border-left-color: var(--brand-green, var(--green));
}
.plugin-toast.tone-warning {
  border-left-color: #d9822b;
}
.plugin-toast.tone-error {
  border-left-color: var(--danger, #c4483d);
}
.plugin-toast-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.plugin-toast-body strong {
  font-size: 11px;
  color: var(--muted);
  font-weight: 500;
}
.plugin-toast-body span {
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.plugin-toast-close {
  color: var(--muted);
  padding: 2px;
  border-radius: 4px;
}
.plugin-toast-close:hover {
  background: var(--hover);
  color: var(--text);
}
}
</style>
