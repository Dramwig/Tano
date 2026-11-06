<script setup lang="ts">
import { computed } from 'vue';
import { t } from '../i18n';
import type { DocumentFeature } from '@tano/editor/runtime';
import { capabilityPreviewMarkdown } from '../preview-samples';
import RenderedExample from './RenderedExample.vue';
const props = defineProps<{ feature: DocumentFeature }>();
const markdown = computed(() => capabilityPreviewMarkdown(props.feature));
</script>
<template>
  <div class="capability-example" :data-feature="feature">
    <span class="example-caption">{{ t('渲染示例') }}</span>
    <div class="example-rendered"><RenderedExample :markdown="markdown" :editable="feature === 'inlineComment'" /></div>
  </div>
</template>
<style scoped>
.capability-example { --example-scale: .8; display: grid; gap: 6px; width: 224px; max-width: 100%; white-space: normal; }
.example-caption { color: #b8b8b8; font-size: 11px; }
.example-rendered { width: 280px; max-width: calc(100% / var(--example-scale)); zoom: var(--example-scale); padding: 12px; border-radius: 4px; background: var(--paper); color: var(--text); }
@media (forced-colors: active) { .example-caption { color: CanvasText; } }
</style>
