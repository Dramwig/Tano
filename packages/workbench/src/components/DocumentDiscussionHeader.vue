<script setup lang="ts">
import { t } from '../i18n';
defineProps<{ count: number }>();
</script>
<template>
  <header class="document-discussion-header"><h2>{{ t('文档讨论') }}</h2><span v-if="count">{{ count }}</span><slot /></header>
</template>
<style scoped>
.document-discussion-header { display: flex; align-items: baseline; gap: 10px; padding-bottom: 8px; }
.document-discussion-header h2 { font-size: 19px; font-weight: 500; line-height: 28px; margin: 0; }
.document-discussion-header > span { color: var(--muted); font-size: 13px; }
</style>
