<script setup lang="ts">
import { ref, watch } from 'vue';
import type { PluginJson, PluginUiBundle } from '@tano/protocol';
import { createPluginUiSandbox, type PluginUiSandbox } from '../plugins/ui-sandbox';
import type { PluginInteraction } from '../plugins/workbench';
const props = defineProps<{ bundle: PluginUiBundle; state: PluginJson; workspaceId: string; pluginId: string; instanceId: string; viewId: string;
  execute: (interaction: PluginInteraction) => Promise<void> }>();
const container = ref<HTMLElement>();
const error = ref('');
let sandbox: PluginUiSandbox | undefined;
watch([() => container.value, () => props.workspaceId, () => props.pluginId, () => props.instanceId, () => props.viewId,
  () => props.bundle.html, () => props.bundle.css, () => props.bundle.source], (_next, _previous, cleanup) => {
  if (!container.value) return;
  error.value = '';
  const workspaceId = props.workspaceId, pluginId = props.pluginId, instanceId = props.instanceId, name = props.viewId;
  const diagnostic = (level: string, message: string) => {
    void props.execute({ workspaceId, pluginId, instanceId, name, kind: 'diagnostic', payload: { level, message } }).catch(() => {});
  };
  const current = createPluginUiSandbox(container.value, props.bundle, props.state, payload => props.execute({ workspaceId, pluginId, instanceId, name, kind: 'message', payload }),
    cause => { error.value = cause; diagnostic('error', cause); }, diagnostic);
  sandbox = current;
  cleanup(() => { current.dispose(); if (sandbox === current) sandbox = undefined; });
}, { flush: 'post' });
watch(() => props.state, state => sandbox?.update(state), { flush: 'post' });
</script>
<template>
  <div class="plugin-custom-view" :class="{ 'plugin-custom-fill': pluginId === 'excalidraw' || pluginId === 'presentation-preview' || pluginId === 'word-preview' }">
    <p v-if="error" role="alert">{{ error }}</p>
    <div ref="container" class="plugin-custom-container" v-show="!error" />
  </div>
</template>
<style scoped>
.plugin-custom-view { min-height: 320px; height: min(650px, 70vh); }
.plugin-custom-fill { flex: 1; height: 100%; min-height: 320px; }
.plugin-custom-container { height: 100%; }
[role="alert"] { color: var(--danger, #b33); }
</style>
