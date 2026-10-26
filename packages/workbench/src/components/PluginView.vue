<script setup lang="ts">
import { t } from '../i18n';
import { computed } from 'vue';
import { useWorkspaceStore } from '../stores/workspace';
import PluginSurface from './PluginSurface.vue';
import LoadingSkeleton from './LoadingSkeleton.vue';
const props = defineProps<{ viewKey: string }>();
const store = useWorkspaceStore();
const view = computed(() => store.pluginViews.find(view => view.key === props.viewKey));
</script>
<template>
  <LoadingSkeleton v-if="store.workspaceLoading?.plugins" variant="document" :rows="6" />
  <PluginSurface v-else-if="view && store.workspace" :key="`${store.workspace.id}:${view.key}`" :view="view" :workspace-id="store.workspace.id"
    :runtime="store.pluginRuntime.find(runtime => runtime.id === view!.pluginId)" :execute="store.interactWithPlugin" />
  <p v-else role="status">{{ t('插件视图已关闭。') }}</p>
</template>
