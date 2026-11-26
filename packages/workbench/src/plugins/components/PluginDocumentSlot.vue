<script setup lang="ts">
import { computed } from 'vue';
import type { PluginRuntimeState } from '../host';
import type { PluginInteraction, PluginWorkbenchView } from '../workbench';
import PluginSurface from './PluginSurface.vue';

const props = defineProps<{
  location: 'documentHeader' | 'documentFooter';
  views: readonly PluginWorkbenchView[];
  runtimes: readonly PluginRuntimeState[];
  workspaceId: string;
  execute: (interaction: PluginInteraction) => Promise<void>;
}>();

const renderedSlots = computed(() =>
  props.views
    .filter((view) => view.location === props.location)
    .map((view) => {
      const runtime = props.runtimes.find((rt) => rt.id === view.pluginId);
      const state = runtime?.views.find((entry) => entry.id === view.id);
      return { view, runtime, hasContent: !!state && (!!state.tree || !!state.custom) };
    })
    .filter((entry) => entry.runtime?.status === 'running' && entry.hasContent),
);
</script>

<template>
  <div
    v-if="renderedSlots.length"
    class="plugin-document-slot"
    :class="`slot-${location}`"
    :data-slot="location"
  >
    <PluginSurface
      v-for="{ view, runtime } in renderedSlots"
      :key="`${workspaceId}:${view.key}`"
      :view="view"
      :workspace-id="workspaceId"
      :runtime="runtime"
      :execute="execute"
      compact
    />
  </div>
</template>

<style scoped>
.plugin-document-slot {
  width: 100%;
  max-width: var(--page-width, 820px);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.plugin-document-slot.slot-documentHeader {
  margin-bottom: 12px;
}
.plugin-document-slot.slot-documentFooter {
  margin-top: 20px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}
</style>
