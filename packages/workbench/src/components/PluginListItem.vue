<script setup lang="ts">
import { LoaderCircle, MoreHorizontal, Plus } from 'lucide-vue-next';
import type { PluginManifest } from '@tano/protocol';
import PluginIcon from './PluginIcon.vue';

defineProps<{
  plugin: PluginManifest;
  installed?: boolean;
  enabled?: boolean;
  showState?: boolean;
  busy?: boolean;
  pending?: boolean;
}>();
const emit = defineEmits<{ details: []; install: [] }>();
</script>

<template>
  <article class="plugin-entry" :aria-label="plugin.name">
    <button class="entry-main" :aria-label="`查看${plugin.name}详情`" @click="emit('details')">
      <PluginIcon :id="plugin.id" compact />
      <span class="entry-copy">
        <strong :title="plugin.name">{{ plugin.name }}</strong>
        <span class="entry-description" :title="plugin.description">{{ plugin.description }}</span>
      </span>
    </button>
    <span v-if="showState && installed" class="entry-state" :class="{ enabled }">{{
      enabled ? '已启用' : '已停用'
    }}</span>
    <button
      v-if="installed"
      class="entry-action"
      :aria-label="`管理${plugin.name}`"
      :title="`管理${plugin.name}`"
      @click="emit('details')"
    >
      <MoreHorizontal :size="18" :stroke-width="1.6" />
    </button>
    <button
      v-else
      class="entry-action"
      :disabled="busy"
      :aria-label="`${pending ? '正在安装' : '安装'}${plugin.name}`"
      :title="`安装${plugin.name}`"
      @click="emit('install')"
    >
      <LoaderCircle v-if="pending" class="entry-spinner" :size="17" /><Plus
        v-else
        :size="20"
        :stroke-width="1.5"
      />
    </button>
  </article>
</template>

<style scoped>
.plugin-entry {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  min-height: 76px;
  padding: 10px 8px;
  border-radius: 8px;
}
.plugin-entry:hover,
.plugin-entry:focus-within {
  background: var(--surface);
}
.entry-main {
  display: flex;
  align-items: center;
  gap: 13px;
  flex: 1;
  min-width: 0;
  padding: 0;
  text-align: left;
  background: transparent;
  border-radius: 4px;
}
.entry-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.entry-copy strong,
.entry-description {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.entry-copy strong {
  color: var(--text);
  font-size: 13px;
  font-weight: 550;
  line-height: 20px;
}
.entry-description {
  color: var(--muted);
  font-size: 12px;
  line-height: 19px;
}
.entry-action {
  display: grid;
  place-items: center;
  flex: none;
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 6px;
  color: var(--text-secondary);
}
.entry-action:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.entry-state {
  flex: none;
  font-size: 11px;
  color: var(--muted);
}
.entry-state.enabled {
  color: var(--green);
}
.entry-spinner {
  animation: plugin-loading 1s linear infinite;
}
@keyframes plugin-loading {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 480px) {
  .plugin-entry {
    gap: 6px;
    padding-inline: 4px;
  }
  .entry-main {
    gap: 11px;
  }
  .entry-state {
    font-size: 10px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .entry-spinner {
    animation: none;
  }
}
</style>
