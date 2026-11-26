<script setup lang="ts">
import { useWindowContext } from '../../windows/context';
const { window, document } = useWindowContext();

import { isNode } from '@tano/editor/dom-realm';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { ChevronDown, LayoutGrid } from 'lucide-vue-next';
import { canAnimate, MOTION_DURATION, spring } from '@tano/editor/motion';
import { vSurfaceMotion } from '@tano/editor/surface-motion';
import type { AppearancePreset, AppearanceSelection, AppearanceSnapshot } from '../appearance';
import { t } from '../../i18n/i18n';
import ThemePresetCard from './ThemePresetCard.vue';

const props = defineProps<{ appearance: AppearanceSnapshot }>();
const emit = defineEmits<{ select: [selection: AppearanceSelection] }>();
const picker = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();
const panel = ref<HTMLElement>();
const expanded = ref(false);
const panelId = useId();
const current = computed<AppearancePreset>(() => props.appearance.currentPreset
  ?? props.appearance.presets.find(preset => preset.id === props.appearance.presetId)
  ?? { id: 'current', label: '当前搭配', selected: props.appearance.active });
const previous = computed(() => [
  ...(props.appearance.recentPresetIds ?? []).map(id => props.appearance.presets.find(preset => preset.id === id)),
  props.appearance.presets[1], ...props.appearance.presets,
]
  .find(preset => preset && !preset.unavailable && preset.id !== current.value.id));
const morePresets = computed(() => props.appearance.presets
  .filter(preset => preset.id !== current.value.id && preset.id !== previous.value?.id));
/** When every choice fits in the row, list them in catalog order and skip the collapsed "more" panel. */
const inlinePresets = computed(() => {
  const presets = props.appearance.presets;
  const cards = presets.some(preset => preset.id === current.value.id) ? presets : [current.value, ...presets];
  return cards.length <= 3 ? cards.map(preset => preset.id === current.value.id ? current.value : preset) : undefined;
});

function close(restoreFocus = false) {
  expanded.value = false;
  if (restoreFocus) trigger.value?.focus({ preventScroll: true });
}
function focusCurrent() {
  picker.value?.querySelector<HTMLButtonElement>('.theme-preset-quick-row [aria-pressed="true"]')?.focus({ preventScroll: true });
}
function focusMore() {
  if (!panel.value) return;
  (panel.value.querySelector<HTMLButtonElement>('.theme-preset-card:not(:disabled)') ?? panel.value).focus({ preventScroll: true });
}
async function select(preset: AppearancePreset) {
  if (preset.unavailable || !props.appearance.presets.some(item => item.id === preset.id)) return;
  const restoreFocus = expanded.value;
  const { workspaceId, scope } = props.appearance;
  const previousPresetId = current.value.id;
  emit('select', { workspaceId, kind: 'preset', id: preset.id });
  close(restoreFocus);

  await nextTick();
  if (props.appearance.workspaceId !== workspaceId || props.appearance.scope !== scope || current.value.id === previousPresetId) return;
  const card = picker.value?.querySelector('.theme-preset-quick-row [aria-pressed="true"]')?.closest('.theme-preset-entry');
  if (canAnimate(card)) {
    card.animate([{ scale: '0.94' }, { scale: '1' }], { duration: MOTION_DURATION.bouncy, easing: spring('bouncy') });
  }
}
async function save() {
  emit('select', { workspaceId: props.appearance.workspaceId, kind: 'save-preset' });
  close();
  await nextTick();
  if (!props.appearance.canSavePreset) focusCurrent();
}
async function removePreset(preset: AppearancePreset, fromMore = false) {
  emit('select', { workspaceId: props.appearance.workspaceId, kind: 'remove-preset', id: preset.id });
  await nextTick();
  if (props.appearance.presets.some(item => item.id === preset.id)) return;
  if (fromMore && panel.value) focusMore();
  else focusCurrent();
}
async function toggle() {
  if (expanded.value) { close(true); return; }
  expanded.value = true;
  await nextTick();
  focusMore();
}
function dismiss(event: PointerEvent) {
  if (!expanded.value || !(isNode(event.target))) return;
  // Dragging the settings scrollbar should keep the expanded choices visible.
  if (picker.value?.contains(event.target) || event.target === picker.value?.closest('.settings-main')) return;
  close();
}
watch([() => props.appearance.workspaceId, () => props.appearance.scope, () => !!inlinePresets.value], () => close());
onMounted(() => {
  document.addEventListener('pointerdown', dismiss, true);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', dismiss, true);
});

</script>

<template>
  <div ref="picker" class="theme-preset-picker">
    <div v-if="inlinePresets" class="theme-preset-quick-row" :aria-label="t('常用主题')">
      <ThemePresetCard v-for="preset in inlinePresets" :key="preset.id" :preset="preset" :selected="preset.id === current.id"
        :saveable="preset.id === current.id && appearance.canSavePreset" @select="select" @save="save" @remove="removePreset" />
    </div>
    <div v-else class="theme-preset-quick-row" :aria-label="t('常用主题')">
      <ThemePresetCard :preset="current" selected :saveable="appearance.canSavePreset" @select="select" @save="save" @remove="removePreset" />
      <ThemePresetCard v-if="previous" :preset="previous" @select="select" @remove="removePreset" />
      <button ref="trigger" type="button" class="theme-preset-more" data-surface-role="card" :aria-label="t('更多主题')"
        :aria-expanded="expanded" :aria-controls="expanded ? panelId : undefined" @click="toggle" @keydown.esc.stop.prevent="close(true)">
        <span class="theme-preset-more-heading"><strong>{{ t('更多') }}</strong><ChevronDown :size="14" :class="{ expanded }" aria-hidden="true" /></span>
        <span class="theme-preset-placeholder"><LayoutGrid :size="28" :stroke-width="1.3" aria-hidden="true" /></span>
      </button>
    </div>
    <div v-if="expanded && !inlinePresets" :id="panelId" ref="panel" v-surface-motion="'ThemePresetPicker:0'"
      class="theme-preset-popover" data-surface-role="popover" role="region" :aria-label="t('更多主题')" tabindex="-1"
      @keydown.esc.stop.prevent="close(true)">
      <div class="theme-preset-grid">
        <ThemePresetCard v-for="preset in morePresets" :key="preset.id" :preset="preset" borderless compact
          @select="select" @remove="removePreset($event, true)" />
      </div>
    </div>
  </div>
</template>

<style scoped>
@layer components {
.theme-preset-picker { position: relative; z-index: 1; container-type: inline-size; margin-top: 16px; }
.theme-preset-quick-row { --theme-preview-height: clamp(88px, 19cqi, 132px); display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.theme-preset-more { grid-column: 3; display: flex; flex-direction: column; gap: 6px; min-width: 0; padding: 8px; border: 1px solid var(--control-border); border-radius: 11px; background: var(--paper); color: var(--text-secondary); text-align: start; }
.theme-preset-more-heading { display: flex; align-items: center; justify-content: space-between; gap: 4px; margin: 3px 4px 5px; font-size: 13px; line-height: 1.5; }
.theme-preset-more-heading > svg { flex-shrink: 0; transition: transform .15s; }
.theme-preset-more-heading > svg.expanded { transform: rotate(180deg); }
.theme-preset-more:hover, .theme-preset-more[aria-expanded='true'] { border-color: var(--green); color: var(--text); }
.theme-preset-more:focus-visible { outline: 2px solid var(--green); outline-offset: 3px; }
.theme-preset-placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; height: var(--theme-preview-height); margin-top: auto; border-radius: 7px; background: var(--surface); color: var(--muted); font-size: 11px; line-height: 1.5; text-align: center; }
.theme-preset-popover { position: absolute; top: calc(100% + 10px); inset-inline: 0; z-index: 1; padding: 10px; box-sizing: border-box; border: 1px solid var(--line-strong); border-radius: 12px; background: var(--surface-raised); color: var(--text); box-shadow: var(--overlay-shadow); }
.theme-preset-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 140px), 1fr)); gap: 8px; }
@container (max-width: 480px) {
  .theme-preset-quick-row { gap: 8px; }
}
}
</style>
