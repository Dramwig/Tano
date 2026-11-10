<script setup lang="ts">
import { computed, inject } from 'vue';
import { fileIconCssColor } from '@tano/protocol';
import { fileIconRegistry, fileIconRegistryKey, type FileIconResource } from '../file-icons/registry';
const props = withDefaults(defineProps<FileIconResource & { size?: number }>(), { size: 16 });
const registry = inject(fileIconRegistryKey, fileIconRegistry);
const resolved = computed(() => registry.resolve(props));
</script>

<template>
  <svg class="resource-icon" :data-file-icon="resolved.id" :data-icon-theme="resolved.themeId"
    :width="size" :height="size" viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false"
    :style="{ color: fileIconCssColor(resolved.icon.color) }" stroke="currentColor" stroke-width="1.33" stroke-linecap="round" stroke-linejoin="round">
    <template v-if="resolved.icon.image">
      <image :href="resolved.icon.image" width="20" height="20" :class="{ 'resource-icon-dark': resolved.icon.lightImage }" />
      <image v-if="resolved.icon.lightImage" :href="resolved.icon.lightImage" width="20" height="20" class="resource-icon-light" />
    </template>
    <template v-else>
      <template v-if="resolved.icon.silhouette === 'folder' || resolved.icon.silhouette === 'folder-open'">
        <path d="M2 6V4.5h6l2 2h8V17H2z" fill="currentColor" fill-opacity=".16" />
        <path v-if="resolved.icon.silhouette === 'folder-open'" d="M2 17l2-8h15l-2 8z" fill="var(--paper, white)" />
      </template>
      <template v-else-if="resolved.icon.silhouette !== 'none'">
        <path d="M4 1.5h8l4 4V18.5H4z" fill="currentColor" fill-opacity=".09" />
        <path d="M12 1.5v4h4" />
      </template>
      <path v-for="(path, index) in resolved.icon.paths" :key="index" :d="path" />
      <text v-if="resolved.icon.label" x="10" y="14.5" text-anchor="middle" fill="currentColor" stroke="none"
        font-family="system-ui, sans-serif" :font-size="resolved.icon.label.length > 2 ? 5 : 7" font-weight="750">{{ resolved.icon.label }}</text>
    </template>
  </svg>
</template>

<style scoped>
.resource-icon { display: inline-block; flex-shrink: 0; vertical-align: middle; }
.resource-icon-dark { display: none; }
:global(:root[data-theme='dark'] .resource-icon-dark) { display: inline; }
:global(:root[data-theme='dark'] .resource-icon-light) { display: none; }
</style>
