<script setup lang="ts">
import { t } from '../i18n';
import { startupSkeleton } from '../startup-skeleton';
import '../loading-skeleton.css';
withDefaults(defineProps<{ variant?: 'shell' | 'document' | 'editor' | 'list'; rows?: number; label?: string }>(), { variant: 'list', rows: 4 });
</script>

<template>
  <div class="loading-skeleton" :class="`loading-skeleton-${variant}`" role="status" aria-busy="true" :aria-label="label || t('正在加载…')">
    <div v-if="variant === 'shell'" class="loading-skeleton-shell-content" v-html="startupSkeleton" />
    <div v-else :class="`tano-skeleton-${variant}`" aria-hidden="true"><span v-for="row in rows" :key="row" class="tano-skeleton-bar" /></div>
  </div>
</template>

<style scoped>
.loading-skeleton { color: var(--text, #252820); }
.loading-skeleton-shell, .loading-skeleton-shell-content { display: flex; flex: 1; min-height: 0; width: 100%; }
.loading-skeleton-shell { min-height: 100%; }
.loading-skeleton-document { flex: 1; }
</style>
