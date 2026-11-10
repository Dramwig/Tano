<script setup lang="ts">
import SourceEditor from './SourceEditor.vue';
defineProps<{ markdown: string }>();
</script>
<template><div class="source-example" inert data-renderer="source"><SourceEditor :model-value="markdown" readonly :local-native="false" :show-all-line-numbers="false" /></div></template>
<style scoped>
.source-example :deep(.source-editor), .source-example :deep(.cm-editor), .source-example :deep(.cm-scroller), .source-example :deep(.cm-content) { min-height: 0; height: auto; }
.source-example :deep(.cm-scroller) { overflow: visible; }
</style>
