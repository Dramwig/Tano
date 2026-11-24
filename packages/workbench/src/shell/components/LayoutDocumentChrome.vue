<script setup lang="ts">
import { computed } from 'vue';
import { basename, type LayoutThemeDefinition } from '@tano/protocol';

const props = defineProps<{
  layout?: LayoutThemeDefinition;
  path: string;
}>();
const filename = computed(() => basename(props.path));
</script>

<template>
  <header v-if="layout?.structure === 'document'" class="layout-document-chrome">
    <div class="layout-document-caption">
      <span class="layout-document-filename" :title="path">{{ filename }}</span>
    </div>
  </header>
</template>
