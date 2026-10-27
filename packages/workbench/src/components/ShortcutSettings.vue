<script setup lang="ts">
import { t } from '../i18n';
import { computed, nextTick, ref } from 'vue';
import { Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-vue-next';
import { defaultShortcutBindings, shortcutBindingError, shortcutBindingFromEvent, shortcutDefinitions, shortcutLabel, shortcutKeys, withShortcutKeys } from '../shortcuts';
import type { ShortcutBindings, ShortcutId } from '../shortcuts';
const props = defineProps<{ bindings: ShortcutBindings }>();
const emit = defineEmits<{ change: [bindings: ShortcutBindings] }>();
const root = ref<HTMLElement>();
const recording = ref<{ id: ShortcutId; index: number } | null>(null);
const error = ref('');
const errorLocation = ref<{ id: ShortcutId; index: number } | null>(null);
function rowError(id: ShortcutId, index: number) { return !!error.value && errorLocation.value?.id === id && errorLocation.value.index === index; }
const groups = computed(() => [...new Set(shortcutDefinitions.map(item => item.group))].map(label => ({ label, items: shortcutDefinitions.filter(item => item.group === label) })));
function keys(id: ShortcutId) { return shortcutKeys(props.bindings[id]); }
function rows(id: ShortcutId) { const values: (string | null)[] = [...keys(id)]; if (!values.length || recording.value?.id === id && recording.value.index === values.length) values.push(null); return values; }
function editing(id: ShortcutId, index: number) { return recording.value?.id === id && recording.value.index === index; }
function cancel() { recording.value = null; error.value = ''; errorLocation.value = null; }
function start(id: ShortcutId, index = 0) { recording.value = { id, index }; error.value = ''; void nextTick(() => root.value?.querySelector<HTMLButtonElement>('.is-recording')?.focus()); }
function capture(event: KeyboardEvent, id: ShortcutId, index: number) {
  if (!editing(id, index)) return;
  if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) { cancel(); return; }
  event.preventDefault(); event.stopPropagation();
  if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    cancel();
    (event.currentTarget as HTMLButtonElement).blur();
    return;
  }
  const binding = shortcutBindingFromEvent(event); if (!binding) return;
  errorLocation.value = { id, index };
  error.value = shortcutBindingError(id, binding, props.bindings);
  if (error.value) return;
  if (keys(id).some((key, i) => i !== index && key === binding)) { error.value = t('此操作已使用该快捷键'); return; }
  const values = keys(id); values[index] = binding;
  emit('change', withShortcutKeys(props.bindings, id, values)); cancel();
}
function clear(id: ShortcutId, index: number) { cancel(); emit('change', withShortcutKeys(props.bindings, id, keys(id).filter((_, i) => i !== index))); }
function reset(id: ShortcutId) {
  cancel(); const values = shortcutKeys(defaultShortcutBindings[id]);
  errorLocation.value = { id, index: 0 };
  error.value = values.map(key => shortcutBindingError(id, key, props.bindings)).find(Boolean) ?? '';
  if (!error.value) emit('change', { ...props.bindings, [id]: defaultShortcutBindings[id] });
}
function changed(id: ShortcutId) { return JSON.stringify(keys(id)) !== JSON.stringify(shortcutKeys(defaultShortcutBindings[id])); }
function resetAll() { cancel(); emit('change', { ...defaultShortcutBindings }); }
</script>
<template>
  <div ref="root" class="shortcut-settings">
    <div class="shortcut-settings-actions">
      <p>{{ t('点击组合键或铅笔图标修改，按 Esc 取消。修改立即生效并保存在当前设备。') }}</p>
      <button type="button" class="shortcut-reset-all" @click="resetAll"><RotateCcw :size="13" />{{ t('恢复全部默认') }}</button>
    </div>
    <section v-for="group in groups" :key="group.label" class="settings-section" :aria-label="group.label + t('快捷键')">
      <h3>{{ group.label }}</h3>
      <p v-if="group.items.every(item => 'readOnly' in item)" class="shortcut-builtin-note">{{ t('以下为系统和编辑器内置按键，按使用场景显示，不在此处修改。') }}</p>
      <div class="shortcut-settings-card">
        <div v-for="item in group.items" :key="item.id" class="shortcut-settings-row" :data-settings-key="'shortcut-' + item.id">
          <div class="shortcut-settings-name"><strong>{{ item.label }}</strong><p v-if="'scope' in item">{{ item.scope }}</p></div>
          <div class="shortcut-settings-variants">
            <div v-for="(binding, index) in rows(item.id)" :key="index" class="shortcut-settings-variant">
              <span v-if="'readOnly' in item" class="shortcut-record"><kbd>{{ shortcutLabel(binding).replaceAll(' + ', '+') }}</kbd></span>
              <div v-else class="shortcut-settings-input">
              <button type="button" class="shortcut-record" :class="{ 'is-recording': editing(item.id, index), 'has-error': rowError(item.id, index) }"
                :aria-invalid="rowError(item.id, index) || undefined" :aria-describedby="rowError(item.id, index) ? `shortcut-error-${item.id}-${index}` : undefined"
                :aria-label="t('设置{0}快捷键', [item.label]) + (index ? ' ' + (index + 1) : '')" :aria-pressed="editing(item.id, index)"
                @click="start(item.id, index)" @keydown="capture($event, item.id, index)" @blur="editing(item.id, index) && cancel()">
                <kbd>{{ editing(item.id, index) ? t('请按下快捷键…') : shortcutLabel(binding).replaceAll(' + ', '+') }}</kbd><Pencil v-if="!editing(item.id, index)" :size="13" :stroke-width="1.5" />
              </button>
              <button v-if="editing(item.id, index)" type="button" class="shortcut-cancel" :aria-label="t('取消编辑')" :data-tooltip="t('取消编辑')" @pointerdown.prevent @click="cancel"><X :size="13" :stroke-width="1.5" /></button>
              </div>
              <div v-if="!('readOnly' in item)" class="shortcut-settings-variant-actions">
                <button v-if="index === 0 && changed(item.id)" type="button" class="shortcut-icon-button" :aria-label="t('恢复{0}默认快捷键', [item.label])" :data-tooltip="t('恢复默认')" @click="reset(item.id)"><RotateCcw :size="14" /></button>
                <button v-if="index === 0" type="button" class="shortcut-icon-button" :aria-label="t('添加{0}快捷键', [item.label])" :data-tooltip="t('添加快捷键')" @click="start(item.id, keys(item.id).length)"><Plus :size="14" :stroke-width="1.5" /></button>
                <button type="button" class="shortcut-icon-button shortcut-clear" :disabled="!binding" :aria-label="t('清除{0}快捷键', [item.label]) + (index ? ' ' + (index + 1) : '')" :data-tooltip="t('清除快捷键')" @click="clear(item.id, index)"><Trash2 :size="14" :stroke-width="1.5" /></button>
              </div>
              <p v-if="rowError(item.id, index)" :id="`shortcut-error-${item.id}-${index}`" class="shortcut-settings-error" role="alert">{{ error }}</p>
            </div>
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
.shortcut-settings-card { padding: 0; border: 0; background: transparent; }
.shortcut-settings-row { display: grid; grid-template-columns: minmax(160px, 0.9fr) minmax(0, 1fr) auto; align-items: center; gap: 16px; min-height: 62px; padding: 13px 0; }
.shortcut-settings-name { min-width: 0; }
.shortcut-settings-name strong { color: var(--text); font-size: 13px; line-height: 1.6; font-weight: 500; overflow-wrap: anywhere; }
.shortcut-settings-name p { margin: 3px 0 0; color: var(--muted); font-size: 11px; line-height: 1.6; }
.shortcut-settings-binding { display: flex; align-items: center; gap: 9px; min-width: 0; }
.shortcut-cancel { display: inline-flex; flex-shrink: 0; align-items: center; justify-content: center; width: 13px; height: 30px; padding: 0; border: 0; border-radius: 0; color: var(--green); background: transparent; }
.shortcut-cancel svg { opacity: 0.75; }
.shortcut-cancel:hover { color: var(--text); background: transparent; }
.shortcut-cancel:hover svg { opacity: 1; }
.shortcut-record { display: inline-flex; align-items: center; gap: 9px; max-width: 100%; min-height: 30px; padding: 3px 0; color: var(--muted); background: transparent; font-variant-numeric: tabular-nums; }
.shortcut-record kbd { min-width: 0; padding: 3px 8px; border: 0; border-radius: 999px; color: inherit; background: var(--surface); box-shadow: none; font: inherit; font-size: 11px; line-height: 1.45; overflow-wrap: anywhere; }
.shortcut-record svg { flex: 0 0 auto; opacity: 0.75; }
.shortcut-record:hover { color: var(--text); }
.shortcut-record:hover svg { opacity: 1; }
.shortcut-record:focus-visible { outline: none; }
.shortcut-record:focus-visible kbd { box-shadow: 0 0 0 2px var(--paper), 0 0 0 3px var(--muted); }
.shortcut-record.is-recording { color: var(--green); }
.shortcut-record.is-recording kbd { background: color-mix(in srgb, var(--green) 10%, var(--paper)); }
/* Reserve both action slots so a custom binding's reset button cannot shift the columns. */
.shortcut-settings-row-actions { display: flex; align-items: center; justify-content: flex-end; gap: 4px; width: 60px; }
.shortcut-icon-button { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 6px; border-radius: 6px; color: var(--muted); background: transparent; }
.shortcut-icon-button:hover:not(:disabled) { color: var(--text); background: var(--surface); }
.shortcut-icon-button:disabled { opacity: 0.3; cursor: default; }
.shortcut-clear:hover:not(:disabled) { color: var(--danger); }
.shortcut-settings-error { grid-column: 1 / -1; margin: 2px 0 0; color: var(--danger); font-size: 11px; line-height: 1.6; }
.shortcut-record.has-error kbd { color: var(--danger); box-shadow: 0 0 0 1px var(--danger); }
@media (max-width: 700px) {
  .shortcut-settings-actions { flex-wrap: wrap; gap: 10px; }
  .shortcut-settings-actions p { flex-basis: 100%; }
  .shortcut-settings-row { grid-template-columns: minmax(0, 1fr) auto; gap: 5px 12px; }
  .shortcut-settings-binding { grid-column: 1; grid-row: 2; }
  .shortcut-settings-row-actions { grid-column: 2; grid-row: 1 / span 2; }
}
.shortcut-settings-variants { grid-column: 2 / -1; min-width: 0; }
.shortcut-builtin-note { color: var(--muted); font-size: 12px; }
.shortcut-settings-variant { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; column-gap: 12px; }
.shortcut-settings-variant > .shortcut-record { justify-self: start; }
.shortcut-settings-input { display: flex; align-items: center; gap: 9px; min-width: 0; justify-self: start; }
.shortcut-settings-variant-actions { display: flex; justify-content: flex-end; align-items: center; gap: 4px; flex-shrink: 0; }
@media (max-width: 700px) { .shortcut-settings-variants { grid-column: 1 / -1; } }
</style>
