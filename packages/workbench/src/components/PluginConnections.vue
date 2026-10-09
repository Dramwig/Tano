<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue';
import { pluginConnectionMethods, type PluginConnection, type PluginConnectionAuthentication, type PluginConnectionMethod } from '@tano/protocol';
import { useWorkspaceStore } from '../stores/workspace';
import PluginOAuthConnection from './PluginOAuthConnection.vue';
const store = useWorkspaceStore();
const entries = ref<PluginConnection[]>([]);
const pluginId = ref(''), origin = ref(''), secret = ref(''), pathPrefix = ref('/');
const authentication = ref<PluginConnectionAuthentication>('bearer');
const methods = ref<PluginConnectionMethod[]>(['GET']);
const busy = ref(false), error = ref(''), status = ref('');
let controller = new AbortController();
const plugins = computed(() => store.installedPlugins.filter(item => item.manifest.manifestVersion === 2 && item.manifest.permissions.includes('connections')));
const installation = computed(() => plugins.value.find(item => item.manifest.id === pluginId.value));
const origins = computed(() => installation.value?.manifest.manifestVersion === 2 ? installation.value.manifest.networkOrigins : []);
const existing = computed(() => entries.value.find(item => item.pluginId === pluginId.value && item.origin === origin.value));
const canSave = computed(() => installation.value?.enabled && installation.value?.authorized && installation.value?.rule?.integrity && origin.value && methods.value.length && (existing.value && !existing.value.oauth || secret.value));
watch(pluginId, () => { origin.value = origins.value[0] ?? ''; });
watch([existing, origin, () => installation.value?.rule?.integrity], () => {
  secret.value = ''; methods.value = [...(existing.value?.methods ?? ['GET'])]; pathPrefix.value = existing.value?.pathPrefix ?? '/'; authentication.value = existing.value?.authentication ?? 'bearer';
});
async function run(operation: (workspace: string, signal: AbortSignal) => Promise<void>) {
  if (busy.value || !store.workspace) return;
  const signal = controller.signal, workspace = store.workspace.id;
  busy.value = true; error.value = ''; status.value = '';
  try { await operation(workspace, signal); }
  catch (cause) { if (!signal.aborted) error.value = String(cause); }
  finally { if (!signal.aborted) busy.value = false; }
}
const load = (workspace: string, signal: AbortSignal) => store.loadPluginConnections(workspace, signal).then(value => { if (!signal.aborted) entries.value = value; });
function save() {
  const input = { pluginId: pluginId.value, origin: origin.value, integrity: installation.value?.rule?.integrity ?? '', methods: [...methods.value],
    pathPrefix: pathPrefix.value, authentication: authentication.value, ...(secret.value ? { secret: secret.value } : {}), ...(existing.value ? { version: existing.value.version } : {}) };
  secret.value = '';
  void run(async (workspace, signal) => { await store.savePluginConnection(workspace, input, signal); await load(workspace, signal); if (!signal.aborted) status.value = '已保存，仅当前用户的此工作区与所选插件版本可使用。'; });
}
function remove(connection: PluginConnection) {
  void run(async (workspace, signal) => { await store.removePluginConnection(workspace, connection.pluginId, connection.origin, connection.version, signal); await load(workspace, signal); if (!signal.aborted) status.value = '连接已撤销，后续调用需要重新配置。'; });
}
watch(() => store.workspace?.id, () => {
  controller.abort(); controller = new AbortController(); entries.value = []; pluginId.value = ''; origin.value = ''; secret.value = ''; busy.value = false; error.value = ''; status.value = '';
  if (store.pluginConnectionStorageLabel) void run(load);
}, { immediate: true });
onScopeDispose(() => { controller.abort(); secret.value = ''; });
</script>
<template>
  <details class="plugin-connections" aria-label="插件服务连接">
    <summary>服务连接与凭据</summary>
    <p v-if="!store.pluginConnectionStorageLabel">当前产品尚未配置插件凭据代理。</p>
    <template v-else>
      <p>{{ store.pluginConnectionStorageLabel }}。连接仅属于当前账号和工作区，不随共享规则分发；插件只能通过代理请求已授权的服务。</p>
      <p v-if="error" role="alert">{{ error }}</p><p v-if="status" role="status">{{ status }}</p>
      <button :disabled="busy" @click="run(load)">刷新服务连接</button>
      <ul><li v-for="entry in entries" :key="`${entry.pluginId}:${entry.origin}`">
        <strong>{{ entry.pluginId }}</strong> · {{ entry.origin }}{{ entry.pathPrefix }} · {{ entry.methods.join('、') }} · {{ entry.oauth ? '已连接账号' : '已保存密钥' }}
        <span v-if="store.installedPlugins.find(plugin => plugin.manifest.id === entry.pluginId)?.rule?.integrity !== entry.integrity"> · 插件版本已变化，需重新授权连接</span>
        <button :disabled="busy" :aria-label="`撤销 ${entry.pluginId} ${entry.origin} 连接`" @click="remove(entry)">撤销连接</button>
      </li></ul>
      <form v-if="plugins.length" autocomplete="off" @submit.prevent="save">
        <label>插件<select v-model="pluginId" :disabled="busy" aria-label="连接插件"><option value="">选择插件</option><option v-for="plugin in plugins" :key="plugin.manifest.id" :value="plugin.manifest.id">{{ plugin.manifest.name }}</option></select></label>
        <template v-if="installation">
          <label>服务来源<select v-model="origin" :disabled="busy" aria-label="连接服务来源"><option v-for="item in origins" :key="item" :value="item">{{ item }}</option></select></label>
          <p>授权版本：{{ installation.manifest.version }} · {{ installation.rule?.integrity?.slice(0, 12) }}</p>
          <p v-if="!installation.enabled || !installation.authorized">先在插件详情启用并授权当前版本，再配置服务连接。</p>
          <label>允许路径前缀<input v-model="pathPrefix" :disabled="busy" aria-label="连接允许路径" placeholder="/api/" /></label>
          <fieldset><legend>允许的方法</legend><label v-for="method in pluginConnectionMethods" :key="method"><input v-model="methods" :value="method" type="checkbox" :disabled="busy" />{{ method }}</label></fieldset>
          <PluginOAuthConnection :input="{ pluginId, origin, integrity: installation.rule?.integrity ?? '', methods, pathPrefix, ...(existing ? { version: existing.version } : {}) }"
            :enabled="!!(installation.enabled && installation.authorized && installation.rule?.integrity && methods.length && !busy)" @connected="run(load)" />
          <label>认证方式<select v-model="authentication" :disabled="busy" aria-label="连接认证方式"><option value="bearer">Authorization: Bearer</option><option value="x-api-key">X-API-Key</option><option value="api-key">API-Key</option><option value="private-token">Private-Token</option></select></label>
          <label>API 密钥<input v-model="secret" type="password" autocomplete="new-password" :disabled="busy" :placeholder="existing && !existing.oauth ? '留空沿用已保存的密钥' : '输入此服务的 API 密钥'" aria-label="插件服务密钥" /></label>
          <p v-if="existing?.oauth">使用下方 API 密钥保存会替换当前账号连接；令牌不能作为普通密钥沿用。</p>
          <p>只授权插件实际需要的方法和路径。写入请求可能修改第三方服务中的数据；撤销不能撤回已发送的请求。</p>
          <button type="submit" :disabled="busy || !canSave">{{ existing ? '更新并授权当前版本' : '保存并授权此连接' }}</button>
        </template>
      </form>
      <p v-else>当前没有声明服务凭据权限的插件。</p>
    </template>
  </details>
</template>
<style scoped>
.plugin-connections { border-top: 1px solid var(--line); margin-top: 20px; padding-top: 12px; font-size: 12px; }
summary { cursor: pointer; padding: 8px 0; font-weight: 600; }
p, li { color: var(--muted); overflow-wrap: anywhere; }
form { display: grid; gap: 12px; max-width: 560px; margin: 16px 0; }
label { display: flex; align-items: center; gap: 10px; }
input:not([type=checkbox]), select { flex: 1; min-width: 0; padding: 7px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--text); }
fieldset { display: flex; flex-wrap: wrap; gap: 12px; border: 1px solid var(--line); border-radius: 6px; }
button { padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px; color: var(--text); background: var(--surface); }
button:disabled { opacity: .5; } li button { margin: 6px; }
[role=alert] { color: var(--danger); }
</style>
