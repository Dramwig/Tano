<script setup lang="ts">
import { computed, useId } from 'vue';
import { Plus, Trash2 } from 'lucide-vue-next';
import type { AppearancePreset } from '../appearance';
import { t } from '../../i18n/i18n';
import ThemePresetPreview from './ThemePresetPreview.vue';

const props = defineProps<{ preset: AppearancePreset; selected?: boolean; saveable?: boolean; borderless?: boolean; compact?: boolean }>();
const emit = defineEmits<{ select: [preset: AppearancePreset]; save: []; remove: [preset: AppearancePreset] }>();
const missingId = useId();
const labels = { color: '配色主题', icons: '文件与目录图标', layout: '布局风格', material: '材质', shape: '形态与密度' };
const label = computed(() => t(props.preset.label, props.preset.customNumber === undefined ? [] : [props.preset.customNumber]));
const removable = computed(() => props.preset.customNumber !== undefined);
const actionLabel = computed(() => removable.value
  ? t('删除主题「{0}」', [label.value])
  : t('保存当前搭配为自定义主题'));
</script>

<template>
  <div class="theme-preset-entry" :class="{ 'theme-preset-entry-with-action': saveable || removable }">
    <button type="button" class="theme-preset-card" :class="{ 'theme-preset-card-borderless': borderless, 'theme-preset-card-compact': compact }" :data-surface-role="borderless ? undefined : 'card'" :data-preset-id="preset.id" :disabled="preset.unavailable"
      data-press-parent data-no-selection-pop :aria-pressed="!!selected" :aria-describedby="preset.missing?.length ? missingId : undefined"
      :aria-label="`${t('应用预设')}：${label}`" @click="emit('select', preset)">
      <span class="theme-preset-name"><strong>{{ label }}</strong><span v-if="selected" class="theme-preset-current">{{ t('当前') }}</span></span>
      <ThemePresetPreview :preset="preset" />
    </button>
    <button v-if="saveable || removable" type="button" class="theme-preset-action" :class="{ 'theme-preset-remove': removable }"
      data-no-selection-pop :aria-label="actionLabel" :title="actionLabel" @click="removable ? emit('remove', preset) : emit('save')">
      <Trash2 v-if="removable" :size="16" aria-hidden="true" />
      <Plus v-else :size="16" aria-hidden="true" />
    </button>
    <p v-if="preset.missing?.length" :id="missingId" class="theme-preset-missing">{{ t('缺少{0}；请安装或更新宿主。', [preset.missing.map(item => `${t(labels[item.kind])} ${item.id}`).join('、')]) }}</p>
  </div>
</template>

<style scoped>
@layer components {
.theme-preset-entry { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.theme-preset-card { display: flex; flex: 1; flex-direction: column; gap: 6px; min-width: 0; padding: 8px; text-align: start; background: var(--paper); color: var(--text); border: 1px solid var(--control-border); border-radius: 11px; cursor: pointer; transition: border-color .15s, box-shadow .15s; }
.theme-preset-card:not(:disabled):hover { border-color: color-mix(in srgb, var(--green) 55%, var(--control-border)); box-shadow: 0 3px 12px #00000008; }
.theme-preset-card-borderless { border: 0; background: transparent; }
.theme-preset-card-borderless:not(:disabled):hover { background: var(--hover); box-shadow: none; }
.theme-preset-card:focus-visible { outline: 2px solid var(--green); outline-offset: 3px; }
.theme-preset-card:disabled { cursor: default; opacity: .6; }
.theme-preset-name { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 3px 4px 5px; font-size: 13px; line-height: 1.5; }
.theme-preset-name strong { min-width: 0; overflow-wrap: anywhere; }
.theme-preset-entry-with-action { position: relative; }
.theme-preset-action { position: absolute; inset-block-start: 7px; inset-inline-end: 7px; display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--text-secondary); cursor: pointer; }
.theme-preset-action:hover { background: var(--hover); color: var(--text); }
.theme-preset-action:focus-visible { outline: 2px solid var(--green); }
.theme-preset-remove:hover { background: var(--danger-bg); color: var(--danger); }
.theme-preset-current { flex-shrink: 0; padding: 1px 6px; border-radius: 4px; background: var(--surface); color: var(--text-secondary); font-size: 10px; font-weight: 500; line-height: 1.6; }
.theme-preset-card :deep(.theme-preview) { margin-top: auto; }
.theme-preset-card-compact { --theme-preview-height: 88px; gap: 4px; padding: 6px; border-radius: 8px; }
.theme-preset-card-compact .theme-preset-name { margin: 2px 2px 4px; font-size: 12px; }
.theme-preset-entry-with-action .theme-preset-name { margin-inline-end: 30px; }
.theme-preset-card-compact :deep(.theme-preview-scene) { inset: 0 auto auto 0; width: calc(100% / .7); height: calc(100% / .7); transform: scale(.7); transform-origin: top left; }
.theme-preset-missing { margin: 0; font-size: 12px; line-height: 1.6; color: var(--text-secondary); overflow-wrap: anywhere; }
}
</style>
