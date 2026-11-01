<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { connectionIcon, type ConnectionIdentity } from '../assistant/connection-icons';
const props = withDefaults(defineProps<{ connection: ConnectionIdentity; size?: number }>(), { size: 32 });
const icon = computed(() => connectionIcon(props.connection));
const failed = ref(false);
watch(() => icon.value.favicon, () => { failed.value = false; });
</script>

<template>
  <span class="connection-avatar" :style="{ width: `${size}px`, height: `${size}px` }" :data-brand="icon.brand" aria-hidden="true">
    <!-- Only bundled SVGs are rendered as markup. -->
    <span v-if="icon.svg" class="connection-avatar-svg" v-html="icon.svg" />
    <img v-else-if="icon.favicon && !failed" :key="icon.favicon" :src="icon.favicon" alt="" referrerpolicy="no-referrer" @error="failed = true" />
    <span v-else>{{ icon.initials }}</span>
  </span>
</template>

<style scoped>
.connection-avatar { display: inline-flex; flex: none; align-items: center; justify-content: center; border-radius: 8px; background: var(--hover); color: var(--text); font-size: 12px; font-weight: 600; overflow: hidden; }
.connection-avatar-svg, .connection-avatar img { display: block; width: 72%; height: 72%; object-fit: contain; }
.connection-avatar-svg :deep(svg) { display: block; width: 100%; height: 100%; }
.connection-avatar[data-brand^='agent-color-'] .connection-avatar-svg { width: 88%; height: 88%; }
.connection-avatar[data-brand='kimi'], .connection-avatar[data-brand='openrouter'] { background: #18181b; }
.connection-avatar[data-brand='grok'] { background: #dbeafe; color: #172554; }
</style>
