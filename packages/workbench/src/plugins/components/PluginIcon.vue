<script setup lang="ts">
import { computed } from 'vue';
import researchIcon from '../../assets/plugins/research.svg';
import readingIcon from '../../assets/plugins/reading.svg';
import extensionIcon from '../../assets/plugins/extension.svg';
import presentationIcon from '../../assets/plugins/presentation-preview.svg';
import wordIcon from '../../assets/plugins/word-preview.svg';
import excalidrawIcon from '../../assets/plugins/excalidraw.svg';

const props = defineProps<{ id: string; compact?: boolean; size?: number }>();
const icons = new Map([
  ['research', researchIcon],
  ['reading', readingIcon],
  ['presentation-preview', presentationIcon],
  ['word-preview', wordIcon],
  ['excalidraw', excalidrawIcon],
]);
const icon = computed(() => icons.get(props.id) ?? extensionIcon);
</script>

<template>
  <span class="plugin-icon" :class="{ compact }" :style="size === undefined ? undefined : { width: `${size}px`, height: `${size}px` }" aria-hidden="true">
    <img :src="icon" alt="" width="128" height="128" draggable="false" />
  </span>
</template>

<style scoped>
.plugin-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 56px;
  height: 56px;
  filter: drop-shadow(0 1px 1px rgb(21 35 29 / 10%));
}
.plugin-icon img {
  display: block;
  width: 100%;
  height: 100%;
  user-select: none;
}
.plugin-icon.compact {
  width: 40px;
  height: 40px;
}
</style>
