<script setup lang="ts">
import { t } from '../i18n';
import { ref, watch } from 'vue';
import { useWorkspaceStore } from '../stores/workspace';
import PluginViewNode from './PluginViewNode.vue';
import PluginCustomView from './PluginCustomView.vue';
import type { PluginViewNode as ViewNode } from '@tano/protocol';
import type { PluginRuntimeState } from '../plugins/host';
const store = useWorkspaceStore();
const error = ref('');
const pending = ref('');
const values = ref<Record<string, Record<string, string>>>({});
let generation = 0;
watch(() => `${store.workspace?.id}:${store.pluginRuntime.map(plugin => plugin.instanceId).join(',')}`, () => {
  generation++; values.value = {}; error.value = ''; pending.value = '';
});
function inputs(plugin: string, view: string, tree: ViewNode) {
  const key = `${plugin}:${view}`;
  const current = values.value[key] ??= {};
  const visit = (node: ViewNode) => {
    if (node.type === 'input' && !Object.hasOwn(current, node.key)) current[node.key] = node.value;
    if (node.type === 'stack') node.children.forEach(visit);
  };
  visit(tree); return current;
}
async function invoke(plugin: PluginRuntimeState, kind: 'command' | 'action', name: string, payload?: unknown) {
  if (pending.value || !store.workspace) return;
  const current = generation;
  pending.value = plugin.id; error.value = '';
  try { await store.interactWithPlugin({ workspaceId: store.workspace.id, pluginId: plugin.id, instanceId: plugin.instanceId, kind, name,
    payload: payload ?? { workspaceId: store.workspace.id, fileId: store.active?.id } }); }
  catch (cause) { if (current === generation) error.value = String(cause); }
  finally { if (current === generation) pending.value = ''; }
}
</script>
<template>
  <section v-if="store.pluginRuntime.length" class="plugin-runtime" :aria-label="t('插件工具')">
    <h2>{{ t('插件工具') }}</h2>
    <p v-if="error" role="alert">{{ error }}</p>
    <article v-for="plugin in store.pluginRuntime" :key="plugin.id">
      <header><strong>{{ plugin.name }}</strong><span>{{ { loading: t('加载中'), running: t('运行中'), blocked: t('等待授权或运行环境'), error: t('已停止') }[plugin.status] }}</span></header>
      <p v-if="plugin.message" :role="plugin.status === 'error' ? 'alert' : 'status'">{{ plugin.message }}</p>
      <button v-if="plugin.status === 'error'" @click="store.restartPlugin(plugin.id, store.workspace!.id).catch(cause => error = String(cause))">{{ t('重新加载') }}</button>
      <div class="plugin-commands"><button v-for="command in plugin.commands" :key="command.id" :disabled="!!pending || plugin.status !== 'running'" @click="invoke(plugin, 'command', command.id)">{{ command.label }}</button></div>
      <details v-for="view in plugin.views" :key="view.id" open><summary>{{ view.label }}</summary>
        <button v-if="view.location && view.location !== 'panel'" @click="store.openPluginView(plugin.id, view.id)">{{ t('打开') }}{{ { tab: t('标签页'), sidebar: t('侧栏'), settings: t('设置页') }[view.location] }}</button>
        <PluginCustomView v-if="view.custom && plugin.status === 'running' && store.workspace" :bundle="view.custom.bundle" :state="view.custom.state" :workspace-id="store.workspace.id" :plugin-id="plugin.id" :instance-id="plugin.instanceId" :view-id="view.id" :execute="store.interactWithPlugin" />
        <PluginViewNode v-else-if="view.tree" :node="view.tree" :values="inputs(plugin.id, view.id, view.tree)" :disabled="!!pending || plugin.status !== 'running'"
          @input="(key, value) => { values[`${plugin.id}:${view.id}`][key] = value; }"
          @action="action => invoke(plugin, 'action', view.id, { action, values: { ...inputs(plugin.id, view.id, view.tree!) } })" />
      </details>
    </article>
  </section>
</template>
<style scoped>
.plugin-runtime { padding: 20px 0; border-top: 1px solid var(--line); }
h2 { font-size: 15px; }
article { border: 1px solid var(--line); border-radius: 9px; padding: 16px; margin: 12px 0; }
header { display: flex; justify-content: space-between; gap: 12px; }
header span, p { color: var(--muted); font-size: 12px; }
.plugin-commands { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0; }
button { padding: 8px 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--text); font: inherit; }
summary { margin: 12px 0; cursor: pointer; }
</style>
