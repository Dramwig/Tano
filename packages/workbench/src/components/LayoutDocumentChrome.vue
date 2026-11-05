<script setup lang="ts">
import { computed } from 'vue';
import { basename, type LayoutThemeDefinition } from '@tano/protocol';

const props = defineProps<{
  layout?: LayoutThemeDefinition;
  path: string;
}>();
const filename = computed(() => basename(props.path));
const noteTitle = computed(() => filename.value.replace(/\.(md|markdown)$/i, ''));
</script>

<template>
  <header v-if="layout?.structure === 'notebook' || layout?.structure === 'document'" class="layout-document-chrome">
    <span v-if="layout.structure === 'notebook'" class="notebook-ribbon" aria-hidden="true" />
    <div class="layout-document-caption">
      <span class="layout-document-filename" :title="path">{{ layout.structure === 'notebook' ? noteTitle : filename }}</span>
      <span v-if="layout.structure === 'document'" class="layout-document-format">Markdown</span>
    </div>
  </header>
</template>
