<script setup lang="ts">
import { Folder, FileText } from 'lucide-vue-next';
</script>

<template>
  <span class="folder-home-icon" aria-hidden="true">
    <Folder :size="16" :stroke-width="1.6" />
    <FileText class="folder-home-page" :size="10" :stroke-width="1.6" />
  </span>
</template>

<style scoped>
.folder-home-icon { position: relative; display: inline-flex; width: 16px; height: 16px; }
.folder-home-page { position: absolute; bottom: 0; right: 0; fill: var(--paper); }
</style>
