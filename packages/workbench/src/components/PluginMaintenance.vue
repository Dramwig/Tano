<script setup lang="ts">
import { t } from '../i18n';
import { computed, ref, watch } from 'vue';
import { pluginCacheLimit, pluginPackageLimit } from '@tano/protocol';
import PluginRepositoryStorage from './PluginRepositoryStorage.vue';
import { useWorkspaceStore } from '../stores/workspace';
import { PluginPackageCache } from '../plugins/packages';
import type { PluginCacheEntry } from '../plugins/cache-storage';
const props = defineProps<{ id: string }>();
const store = useWorkspaceStore(), cache = new PluginPackageCache();
const entries = ref<PluginCacheEntry[]>([]), pending = ref(false), error = ref(''), status = ref('');
const developmentUrl = ref(''), trustBuilds = ref(false);
const appOrigin = typeof location === 'undefined' ? '' : location.origin;
watch([() => props.id, () => store.workspace?.id], () => { developmentUrl.value = ''; trustBuilds.value = false; });
function startDevelopment() {
  error.value = '';
  try { if (!trustBuilds.value) throw new Error(t('请先确认信任此开发会话')); store.startPluginDevelopment(props.id, developmentUrl.value); }
  catch (cause) { error.value = String(cause); }
}
const installation = computed(() => store.installedPlugins.find(plugin => plugin.manifest.id === props.id));
const runtime = computed(() => store.pluginRuntime.find(plugin => plugin.id === props.id));
const used = computed(() => entries.value.reduce((sum, entry) => sum + entry.bytes, 0));
const localEntries = computed(() => entries.value.filter(entry => entry.pluginId === props.id));
const state = computed(() => { runtime.value; return store.pluginStorageUsage(props.id); });
const size = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MiB` : `${(bytes / 1024).toFixed(1)} KiB`;
let generation = 0;
async function refreshUsage(current: number) {
  const next = await cache.entries();
  if (current === generation) entries.value = next;
}
watch([() => props.id, () => store.workspace?.id, () => installation.value?.rule?.integrity, () => store.canManagePlugins], async (_value, _previous, cleanup) => {
  const current = ++generation; cleanup(() => { generation++; }); error.value = ''; status.value = ''; pending.value = false;
  try { await refreshUsage(current); } catch (cause) { if (current === generation) error.value = String(cause); }
}, { immediate: true });
async function run(action: () => Promise<unknown>, message: string) {
  if (pending.value) return;
  const current = generation; pending.value = true; error.value = ''; status.value = '';
  try { await action(); await refreshUsage(current); if (current === generation) status.value = message; }
  catch (cause) { if (current === generation) error.value = String(cause); }
  finally { if (current === generation) pending.value = false; }
}
</script>
<template>
  <section class="plugin-maintenance" :aria-label="t('插件版本与维护')">
    <h4>{{ t('版本与维护') }}</h4>
    <p role="status">{{ t('当前设备：') }}{{ runtime ? { loading: t('加载中'), running: t('运行中'), blocked: t('等待授权或运行环境'), error: t('运行失败') }[runtime.status] : installation?.enabled ? t('尚未启动') : t('已停用') }}</p>
    <p v-if="runtime?.message" :role="runtime.status === 'error' ? 'alert' : 'status'">{{ runtime.message }}</p>
    <p v-if="error" role="alert">{{ error }}</p><p v-if="status" role="status">{{ status }}</p>
    <button :disabled="pending || !installation?.enabled" @click="run(() => store.restartPlugin(id, store.workspace!.id), t('已重新加载当前版本'))">{{ t('重新加载当前版本') }}</button>
    <p>{{ t('单包上限') }} {{ size(pluginPackageLimit) }} {{ t('· 设备代码缓存') }} {{ size(used) }} / {{ size(pluginCacheLimit) }}</p>
    <p>{{ t('此插件本机状态') }} {{ size(state.used) }} / {{ size(state.limit) }}{{ t('。缓存清理不会删除工作区内容。') }}</p>
    <PluginRepositoryStorage :plugin-id="id" />
    <details>
      <summary>{{ t('开发模式') }}</summary>
      <p>{{ t('先安装并授权一个初始构建，然后运行：') }}</p>
      <pre>npm run plugin -- watch ./my-plugin --origin {{ appOrigin }}</pre>
      <p>{{ t('新构建会更新当前工作区的共享插件规则，请使用测试工作区。权限声明变化时停止自动应用。') }}</p>
      <label>{{ t('本机开发地址') }}<input v-model="developmentUrl" type="url" :aria-label="t('插件开发地址')" :placeholder="t('http://127.0.0.1:端口/…/package.json')" /></label>
      <label><input v-model="trustBuilds" type="checkbox" />{{ t('信任此开发会话中权限不变的新构建') }}</label>
      <button :disabled="!trustBuilds || !installation?.authorized || !installation?.enabled || !store.canManagePlugins" @click="startDevelopment">{{ t('开始自动重载') }}</button>
      <template v-if="store.pluginDevelopment.pluginId === id">
        <p role="status">{{ store.pluginDevelopment.message }}</p>
        <button v-if="store.pluginDevelopment.active" @click="store.stopPluginDevelopment()">{{ t('停止自动重载') }}</button>
      </template>
    </details>
    <details>
      <summary>{{ t('历史版本（') }}{{ installation?.rule?.history?.length ?? 0 }}）</summary>
      <p>{{ t('保留最近 10 个版本引用。移除引用后，该版本不再受云端回收保护，日后恢复需重新导入。回滚沿用当前共享设置，运行前仍需核对并授权版本。') }}</p>
      <ul>
        <li v-for="version in installation?.rule?.history" :key="version.integrity ?? version.recordedAt">
          <strong>{{ version.manifest.version }}</strong> · {{ new Date(version.recordedAt).toLocaleString() }}
          <code>{{ version.integrity?.slice(0, 12) }}</code>
          <button v-if="version.integrity" :disabled="pending || !store.canManagePlugins" @click="run(() => store.rollbackPlugin(id, version.integrity!, store.workspace!.id), t('已恢复所选版本'))">{{ t('恢复版本') }} {{ version.manifest.version }}</button>
          <button v-if="version.integrity" :disabled="pending || !store.canManagePlugins"
            @click="run(() => store.changePlugin({ id, forgetVersion: version.integrity! }, store.workspace!.id), t('已移除历史版本引用'))">{{ t('移除版本') }} {{ version.manifest.version }} {{ t('引用') }}</button>
        </li>
      </ul>
    </details>
    <details>
      <summary>{{ t('此插件的设备缓存（') }}{{ localEntries.length }}）</summary>
      <ul><li v-for="entry in localEntries" :key="entry.integrity">{{ entry.version }} · {{ size(entry.bytes) }} · <code>{{ entry.integrity.slice(0, 12) }}</code>
        <button :disabled="pending || entry.integrity === installation?.rule?.integrity" @click="run(() => cache.remove(entry.integrity), t('已清理所选代码缓存'))">{{ t('清理缓存') }}</button>
      </li></ul>
      <p>{{ t('清理旧缓存后，回滚可能需要联网下载或重新导入对应包。') }}</p>
    </details>
    <details>
      <summary>{{ t('运行日志（') }}{{ runtime?.logs?.length ?? 0 }}）</summary>
      <p>{{ t('仅保留本次工作区会话最近 100 条，重新加载插件后仍可查看。') }}</p>
      <button @click="store.clearPluginLogs(id)">{{ t('清空日志') }}</button>
      <ol class="plugin-logs"><li v-for="(log, index) in runtime?.logs" :key="index"><time>{{ new Date(log.time).toLocaleTimeString() }}</time> {{ log.level }} <pre>{{ log.message }}</pre></li></ol>
    </details>
  </section>
</template>
<style scoped>
.plugin-maintenance { border-top: 1px solid var(--line); padding-top: 16px; margin-top: 16px; }
p, li { font-size: 12px; color: var(--muted); }
label { display: block; margin: 8px 0; font-size: 12px; } input[type="url"] { display: block; width: 100%; box-sizing: border-box; margin-top: 5px; } pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 11px; }
button { font: inherit; color: var(--text); background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 5px 9px; margin: 4px; }
button:disabled { opacity: .5; }
summary { padding: 10px 0; cursor: pointer; }
ul, ol { padding-left: 20px; } li { margin: 6px 0; }
.plugin-logs { max-height: 260px; overflow: auto; } pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 4px 0; }
[role="alert"] { color: var(--danger, #b33); }
</style>
