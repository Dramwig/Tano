<script setup lang="ts">
import { useId } from 'vue';
import type { AppearancePreset } from '../appearance';
import { t } from '../i18n';
import ThemePresetPreview from './ThemePresetPreview.vue';

defineProps<{ preset: AppearancePreset; selected?: boolean; borderless?: boolean; compact?: boolean }>();
const emit = defineEmits<{ select: [preset: AppearancePreset] }>();
const missingId = useId();
const labels = { color: '配色主题', icons: '文件与目录图标', layout: '布局风格', shape: '形态与密度' };
</script>

<template>
  <div class="theme-preset-entry">
    <button type="button" class="theme-preset-card" :class="{ 'theme-preset-card-borderless': borderless, 'theme-preset-card-compact': compact }" :data-preset-id="preset.id" :disabled="preset.unavailable"
      :aria-pressed="!!selected" :aria-describedby="preset.missing?.length ? missingId : undefined"
      :aria-label="`${t('应用预设')}：${t(preset.label)}`" @click="emit('select', preset)">
      <span class="theme-preset-name"><strong>{{ t(preset.label) }}</strong><span v-if="selected" class="theme-preset-current">{{ t('当前') }}</span></span>
      <ThemePresetPreview :preset="preset" />
    </button>
    <p v-if="preset.missing?.length" :id="missingId" class="theme-preset-missing">{{ t('缺少{0}；请安装或更新宿主。', [preset.missing.map(item => `${t(labels[item.kind])} ${item.id}`).join('、')]) }}</p>
  </div>
</template>

<style scoped>
.theme-preset-entry { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.theme-preset-card { display: flex; flex: 1; flex-direction: column; gap: 6px; min-width: 0; padding: 8px; text-align: start; background: var(--paper); color: var(--text); border: 1px solid var(--control-border); border-radius: 11px; cursor: pointer; transition: border-color .15s, box-shadow .15s; }
.theme-preset-card:not(:disabled):hover { border-color: color-mix(in srgb, var(--green) 55%, var(--control-border)); box-shadow: 0 3px 12px #00000008; }
.theme-preset-card-borderless { border: 0; background: transparent; }
.theme-preset-card-borderless:not(:disabled):hover { background: var(--hover); box-shadow: none; }
.theme-preset-card:focus-visible { outline: 2px solid var(--green); outline-offset: 3px; }
.theme-preset-card:disabled { cursor: default; opacity: .6; }
.theme-preset-name { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 3px 4px 5px; font-size: 13px; line-height: 1.5; }
.theme-preset-name strong { min-width: 0; overflow-wrap: anywhere; }
.theme-preset-current { flex-shrink: 0; padding: 1px 6px; border-radius: 4px; background: var(--surface); color: var(--text-secondary); font-size: 10px; font-weight: 500; line-height: 1.6; }
.theme-preset-card :deep(.theme-preview) { margin-top: auto; }
.theme-preset-card-compact { --theme-preview-height: 88px; gap: 4px; padding: 6px; border-radius: 8px; }
.theme-preset-card-compact .theme-preset-name { margin: 2px 2px 4px; font-size: 12px; }
.theme-preset-card-compact :deep(.theme-preview-scene) { inset: 0 auto auto 0; width: calc(100% / .7); height: calc(100% / .7); transform: scale(.7); transform-origin: top left; }
.theme-preset-missing { margin: 0; font-size: 12px; line-height: 1.6; color: var(--text-secondary); overflow-wrap: anywhere; }
</style>
