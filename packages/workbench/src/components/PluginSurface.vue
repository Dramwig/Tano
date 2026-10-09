<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { PluginViewNode as ViewNode } from '@tano/protocol';
import type { PluginRuntimeState } from '../plugins/host';
import type { PluginInteraction, PluginWorkbenchView } from '../plugins/workbench';
import PluginViewNode from './PluginViewNode.vue';
import PluginCustomView from './PluginCustomView.vue';

const props = defineProps<{ view: PluginWorkbenchView; workspaceId: string; runtime?: PluginRuntimeState;
  execute: (interaction: PluginInteraction) => Promise<void> }>();
const tree = computed(() => props.runtime?.views.find(view => view.id === props.view.id)?.tree);
const custom = computed(() => props.runtime?.views.find(view => view.id === props.view.id)?.custom);
const values = ref<Record<string, string>>({});
const error = ref('');
const pending = ref(false);
let generation = 0;
watch([() => props.workspaceId, () => props.view.key, () => props.runtime?.instanceId], () => {
  generation++; values.value = {}; error.value = ''; pending.value = false;
}, { immediate: true });
watch([tree, () => props.workspaceId, () => props.view.key, () => props.runtime?.instanceId], ([current]) => {
  const keys = new Set<string>();
  const visit = (node: ViewNode) => {
    if (node.type === 'input') { keys.add(node.key); values.value[node.key] ??= node.value; }
    if (node.type === 'stack') node.children.forEach(visit);
  };
  if (current) visit(current);
  for (const key of Object.keys(values.value)) if (!keys.has(key)) delete values.value[key];
}, { immediate: true });
async function action(action: string) {
  if (!props.runtime || props.runtime.status !== 'running' || pending.value) return;
  const current = generation;
  pending.value = true; error.value = '';
  try { await props.execute({ workspaceId: props.workspaceId, pluginId: props.view.pluginId, instanceId: props.runtime.instanceId,
    kind: 'action', name: props.view.id, payload: { action, values: { ...values.value } } }); }
  catch (cause) { if (current === generation) error.value = String(cause); }
  finally { if (current === generation) pending.value = false; }
}
</script>
<template>
  <section class="plugin-surface" :aria-label="`${view.pluginName} · ${view.label}`">
    <header><div><h2>{{ view.label }}</h2><span>{{ view.pluginName }}</span></div><span>{{ runtime ? { loading: '加载中', running: '运行中', blocked: '等待授权', error: '已停止' }[runtime.status] : '未运行' }}</span></header>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="runtime?.message" :role="runtime.status === 'error' ? 'alert' : 'status'">{{ runtime.message }}</p>
    <PluginCustomView v-if="custom && runtime?.status === 'running'" :bundle="custom.bundle" :state="custom.state" :workspace-id="workspaceId" :plugin-id="view.pluginId" :instance-id="runtime.instanceId" :view-id="view.id" :execute="execute" />
    <PluginViewNode v-else-if="tree" :node="tree" :values="values" :disabled="pending || runtime?.status !== 'running'"
      @input="(key, value) => values[key] = value" @action="action" />
    <p v-else class="empty">{{ runtime?.status === 'blocked' ? '请在插件中心查看权限并授权此版本。' : '插件尚未提供此视图内容。' }}</p>
  </section>
</template>
<style scoped>
.plugin-surface { flex: 1; min-width: 0; min-height: 0; overflow: auto; padding: 20px; color: var(--text); font-size: 13px; }
header { display: flex; align-items: start; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
h2 { font-size: 18px; margin: 0 0 4px; }
header span, .empty { color: var(--muted); font-size: 12px; }
p { overflow-wrap: anywhere; }
[role="alert"] { color: var(--danger, #b33); }
</style>
