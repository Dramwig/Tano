<script setup lang="ts">
import ResourceIcon from './ResourceIcon.vue';
withDefaults(defineProps<{ path?: string; expanded?: boolean }>(), { path: '' });
</script>

<template>
  <ResourceIcon class="folder-home-icon" :path="path" kind="directory" :folder-home="true" :expanded="expanded" />
</template>

<style scoped>
.folder-home-icon { position: relative; display: inline-flex; width: 16px; height: 16px; }
</style>
