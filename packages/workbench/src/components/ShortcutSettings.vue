<script setup lang="ts">
import { t } from '../i18n';
import { computed, ref } from 'vue';
import { Pencil, RotateCcw, Trash2 } from 'lucide-vue-next';
import {
  defaultShortcutBindings, shortcutBindingError, shortcutBindingFromEvent,
  shortcutDefinitions, shortcutLabel,
} from '../shortcuts';
import type { ShortcutBindings, ShortcutId } from '../shortcuts';

const props = defineProps<{ bindings: ShortcutBindings }>();
const emit = defineEmits<{ change: [bindings: ShortcutBindings] }>();
const recording = ref<ShortcutId | null>(null);
const error = ref('');
const groups = computed(() => [t('工作台'), t('页内搜索'), t('编辑器')].map(label => ({
  label, items: shortcutDefinitions.filter(item => item.group === label),
})));

function cancel() { recording.value = null; error.value = ''; }
function start(id: ShortcutId) { recording.value = id; error.value = ''; }
function capture(event: KeyboardEvent, id: ShortcutId) {
  if (recording.value !== id) return;
  if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) { cancel(); return; }
  event.preventDefault();
  event.stopPropagation();
  if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) { cancel(); return; }
  const binding = shortcutBindingFromEvent(event);
  if (!binding) return;
  error.value = shortcutBindingError(id, binding, props.bindings);
  if (error.value) return;
  emit('change', { ...props.bindings, [id]: binding });
  cancel();
}
function clear(id: ShortcutId) { cancel(); emit('change', { ...props.bindings, [id]: null }); }
function reset(id: ShortcutId) {
  cancel();
  const binding = defaultShortcutBindings[id]!;
  error.value = shortcutBindingError(id, binding, props.bindings);
  if (!error.value) emit('change', { ...props.bindings, [id]: binding });
}
function resetAll() { cancel(); emit('change', { ...defaultShortcutBindings }); }
</script>

<template>
  <div class="shortcut-settings">
    <div class="shortcut-settings-actions">
      <p>{{ t('点击组合键或铅笔图标修改，按 Esc 取消。修改立即生效并保存在当前设备。') }}</p>
      <button type="button" class="shortcut-reset-all" @click="resetAll"><RotateCcw :size="13" :stroke-width="1.5" />{{ t('恢复全部默认') }}</button>
    </div>
    <p v-if="error" class="settings-notice shortcut-settings-error" role="alert">{{ error }}</p>
    <section v-for="group in groups" :key="group.label" class="settings-section" :aria-label="group.label + t('快捷键')">
      <h3>{{ group.label }}</h3>
      <div class="shortcut-settings-card">
        <div v-for="item in group.items" :key="item.id" class="shortcut-settings-row">
          <div class="shortcut-settings-name">
            <strong>{{ item.label }}</strong>
            <p v-if="'scope' in item">{{ item.scope }}</p>
          </div>
          <div class="shortcut-settings-binding">
            <button
              type="button"
              class="shortcut-record"
              :class="{ 'is-recording': recording === item.id }"
              :aria-label="t('设置{0}快捷键', [item.label])"
              :aria-pressed="recording === item.id"
              :title="t('修改快捷键')"
              @click="start(item.id)"
              @keydown="capture($event, item.id)"
              @blur="recording === item.id && cancel()"
            ><kbd>{{ recording === item.id ? t('请按下快捷键…') : shortcutLabel(bindings[item.id]).replaceAll(' + ', '+') }}</kbd><Pencil :size="13" :stroke-width="1.5" /></button>
          </div>
          <div class="shortcut-settings-row-actions">
            <button v-if="bindings[item.id] !== item.default" type="button" class="shortcut-icon-button" :aria-label="t('恢复{0}默认快捷键', [item.label])" :title="t('恢复默认')" @click="reset(item.id)"><RotateCcw :size="14" :stroke-width="1.5" /></button>
            <button type="button" class="shortcut-icon-button shortcut-clear" :disabled="!bindings[item.id]" :aria-label="t('清除{0}快捷键', [item.label])" :title="t('清除快捷键')" @click="clear(item.id)"><Trash2 :size="14" :stroke-width="1.5" /></button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style>
.shortcut-settings-actions { display: flex; align-items: flex-start; gap: 20px; margin-bottom: 24px; }
.shortcut-settings-actions p { flex: 1; margin: 0; color: var(--muted); font-size: 12px; line-height: 1.8; }
.shortcut-reset-all { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 6px; min-height: 28px; padding: 4px 0; color: var(--muted); background: transparent; font-size: 12px; }
.shortcut-reset-all:hover { color: var(--text); }
.shortcut-settings-card { padding: 0 18px; border: 1px solid var(--line); border-radius: 14px; background: var(--paper); }
.shortcut-settings-row { display: grid; grid-template-columns: minmax(160px, 0.9fr) minmax(0, 1fr) auto; align-items: center; gap: 16px; min-height: 62px; padding: 13px 0; }
.shortcut-settings-row + .shortcut-settings-row { border-top: 1px solid var(--line); }
.shortcut-settings-name { min-width: 0; }
.shortcut-settings-name strong { color: var(--text); font-size: 13px; line-height: 1.6; font-weight: 500; overflow-wrap: anywhere; }
.shortcut-settings-name p { margin: 3px 0 0; color: var(--muted); font-size: 11px; line-height: 1.6; }
.shortcut-settings-binding { min-width: 0; }
.shortcut-record { display: inline-flex; align-items: center; gap: 9px; max-width: 100%; min-height: 30px; padding: 3px 0; color: var(--muted); background: transparent; font-variant-numeric: tabular-nums; }
.shortcut-record kbd { min-width: 0; padding: 3px 8px; border: 0; border-radius: 999px; color: inherit; background: var(--surface); box-shadow: none; font: inherit; font-size: 11px; line-height: 1.45; overflow-wrap: anywhere; }
.shortcut-record svg { flex: 0 0 auto; opacity: 0.75; }
.shortcut-record:hover { color: var(--text); }
.shortcut-record:hover svg { opacity: 1; }
.shortcut-record.is-recording { color: var(--green); }
.shortcut-record.is-recording kbd { background: color-mix(in srgb, var(--green) 10%, var(--paper)); }
.shortcut-settings-row-actions { display: flex; align-items: center; justify-content: flex-end; gap: 4px; }
.shortcut-icon-button { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 6px; border-radius: 6px; color: var(--muted); background: transparent; }
.shortcut-icon-button:hover:not(:disabled) { color: var(--text); background: var(--surface); }
.shortcut-icon-button:disabled { opacity: 0.3; cursor: default; }
.shortcut-clear:hover:not(:disabled) { color: var(--danger); }
.shortcut-settings-error { margin-bottom: 20px; }
@media (max-width: 700px) {
  .shortcut-settings-actions { flex-wrap: wrap; gap: 10px; }
  .shortcut-settings-actions p { flex-basis: 100%; }
  .shortcut-settings-card { padding: 0 14px; }
  .shortcut-settings-row { grid-template-columns: minmax(0, 1fr) auto; gap: 5px 12px; }
  .shortcut-settings-binding { grid-column: 1; grid-row: 2; }
  .shortcut-settings-row-actions { grid-column: 2; grid-row: 1 / span 2; }
}
</style>
