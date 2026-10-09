<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { PluginPackageUsage } from '@tano/protocol';
import { useWorkspaceStore } from '../stores/workspace';
const props = defineProps<{ pluginId?: string }>();
const store = useWorkspaceStore(), usage = ref<PluginPackageUsage>(), pending = ref(false), error = ref(''), status = ref('');
const entries = computed(() => usage.value?.entries.filter(entry => !props.pluginId || entry.pluginId === props.pluginId) ?? []);
const size = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MiB` : `${(bytes / 1024).toFixed(1)} KiB`;
let generation = 0;
async function load(current: number) {
  if (current !== generation) return;
  if (!store.pluginRepositoryAvailable || !store.canManagePlugins || !store.workspace) return;
  const result = await store.loadPluginPackageUsage(store.workspace.id);
  if (current === generation) usage.value = result;
}
watch([() => props.pluginId, () => store.workspace?.id, () => store.canManagePlugins,
  () => JSON.stringify(store.installedPlugins.map(plugin => plugin.rule))], async (_current, _previous, cleanup) => {
  const current = ++generation; cleanup(() => { generation++; }); usage.value = undefined; error.value = ''; status.value = ''; pending.value = false;
  try { await load(current); } catch (cause) { if (current === generation) error.value = String(cause); }
}, { immediate: true });
async function run(integrity?: string) {
  if (pending.value || !store.workspace) return;
  const current = generation, workspace = store.workspace.id; pending.value = true; error.value = ''; status.value = '';
  try {
    if (integrity) await store.removePluginPackage(integrity, workspace);
    await load(current);
    if (current === generation) status.value = integrity ? '已回收云端版本' : '云端容量已刷新';
  } catch (cause) { if (current === generation) error.value = String(cause); }
  finally { if (current === generation) pending.value = false; }
}
</script>
<template>
  <details v-if="store.pluginRepositoryAvailable && store.canManagePlugins" class="plugin-repository-storage">
    <summary>工作区云端包存储</summary>
    <p v-if="error" role="alert">{{ error }}</p><p v-if="status" role="status">{{ status }}</p>
    <button :disabled="pending" @click="run()">刷新云端容量</button>
    <template v-if="usage">
      <p>已用 {{ size(usage.used) }} / {{ size(usage.limit) }} · {{ usage.entries.length }} / {{ usage.entryLimit }} 个版本</p>
      <p>容量包括所有插件和未完成上传的预留空间。当前及历史引用的版本受保护；回收其他版本不会删除工作区内容。</p>
      <p>未完成上传的预留需等待两分钟，之后刷新列表即可回收。</p>
      <ul><li v-for="entry in entries" :key="entry.integrity">
        <strong>{{ entry.pluginId }}</strong> · {{ entry.version }} · {{ size(entry.bytes) }} · <code>{{ entry.integrity.slice(0, 12) }}</code>
        <span>{{ entry.state === 'pending' ? '上传未完成，可重新导入相同版本重试' : entry.state === 'deleting' ? '回收中，可重试' : entry.pinned ? '当前或历史版本' : '未被规则引用' }}</span>
        <button v-if="store.canRemovePluginPackage" :disabled="pending || !entry.removable"
          :aria-label="`回收 ${entry.pluginId} ${entry.version} ${entry.integrity.slice(0, 8)}`" @click="run(entry.integrity)">回收此版本</button>
      </li></ul>
      <p v-if="!entries.length">暂无云端包记录。</p>
    </template>
  </details>
</template>
<style scoped>
.plugin-repository-storage { border-top: 1px solid var(--line); margin-top: 16px; padding: 10px 0; font-size: 12px; color: var(--muted); }
summary { cursor: pointer; color: var(--text); } ul { padding-left: 20px; max-height: 320px; overflow: auto; } li { margin: 8px 0; } li span { display: block; }
button { color: var(--text); background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 5px 9px; margin: 4px 0; font: inherit; }
button:disabled { opacity: .5; } [role="alert"] { color: var(--danger, #b33); }
</style>
