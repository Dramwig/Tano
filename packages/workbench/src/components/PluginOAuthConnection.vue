<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue';
import type { PluginOAuthFlow, PluginOAuthInput, PluginOAuthProvider } from '@tano/protocol';
import { useWorkbenchRuntime } from '../runtime';
import { useWorkspaceStore } from '../stores/workspace';
import { openExternalUrl } from '../attachments';
const props = defineProps<{ input: Omit<PluginOAuthInput, 'providerId'>; enabled: boolean }>();
const emit = defineEmits<{ connected: [] }>();
const runtime = useWorkbenchRuntime(), store = useWorkspaceStore(), oauth = runtime.plugins?.connections?.oauth;
const providers = ref<PluginOAuthProvider[]>([]), providerId = ref('');
const available = computed(() => providers.value.filter(item => item.origin === props.input.origin));
const selected = computed(() => available.value.find(item => item.id === providerId.value));
const flow = ref<PluginOAuthFlow>(), busy = ref(false), error = ref(''), status = ref('');
let controller = new AbortController(), timer: ReturnType<typeof setTimeout> | undefined;
let pending: { workspace: string; id: string } | undefined;
function reset() {
  controller.abort(); controller = new AbortController(); clearTimeout(timer);
  if (pending) void oauth?.cancel(pending.workspace, pending.id, AbortSignal.timeout(5000)).catch(() => {});
  pending = undefined; flow.value = undefined; busy.value = false; error.value = ''; status.value = '';
}
watch(() => store.workspace?.id, async workspace => {
  reset(); providers.value = [];
  if (!workspace || !oauth) return;
  const signal = controller.signal;
  try { const values = await oauth.providers(workspace, signal); if (!signal.aborted) providers.value = values; }
  catch (reason) { if (!signal.aborted) error.value = String(reason); }
}, { immediate: true });
watch(() => JSON.stringify([props.input, props.enabled]), () => { reset(); });
watch(available, values => { if (!values.some(item => item.id === providerId.value)) providerId.value = values[0]?.id ?? ''; });
watch(providerId, () => { reset(); });
async function poll(workspace: string, value: PluginOAuthFlow, signal: AbortSignal) {
  if (signal.aborted || !oauth) return;
  if (Date.now() >= Date.parse(value.expiresAt)) { reset(); status.value = '登录授权已过期，请重新连接。'; return; }
  try {
    const result = await oauth.status(workspace, value.id, signal);
    if (signal.aborted) return;
    if (result.status === 'completed') { pending = undefined; flow.value = undefined; status.value = '账号已连接，插件可使用此服务。'; emit('connected'); return; }
    if (result.status === 'failed' || result.status === 'cancelled' || result.status === 'expired') {
      pending = undefined; flow.value = undefined; status.value = '登录授权未完成，请重新连接。'; return;
    }
    timer = setTimeout(() => { void poll(workspace, value, signal); }, 2000);
  } catch (reason) {
    if (!signal.aborted) { reset(); error.value = String(reason); status.value = '暂时无法确认登录结果，连接可能已保存，请刷新服务连接查看。'; }
  }
}
async function start() {
  if (!store.workspace || !selected.value || !props.enabled || busy.value || flow.value) return;
  const workspace = store.workspace.id, signal = controller.signal;
  busy.value = true; error.value = ''; status.value = '';
  try {
    const value = await store.startPluginOAuth(workspace, { ...props.input, providerId: selected.value.id }, signal);
    if (signal.aborted) return;
    pending = { workspace, id: value.id };
    const url = new URL(value.authorizationUrl);
    if (url.protocol !== 'https:' || url.username || url.password || !Number.isFinite(Date.parse(value.expiresAt))) throw new Error('账号登录地址无效');
    flow.value = value; void poll(workspace, value, signal);
  } catch (reason) { if (!signal.aborted) { reset(); error.value = String(reason); } }
  finally { if (!signal.aborted) busy.value = false; }
}
function open(event: MouseEvent) {
  if (!runtime.native || !flow.value) return;
  event.preventDefault(); void openExternalUrl(flow.value.authorizationUrl).catch(reason => { error.value = String(reason); });
}
function cancel() { reset(); status.value = '已取消等待。若连接刚刚完成，请在连接列表中撤销。'; }
onScopeDispose(reset);
</script>
<template>
  <fieldset v-if="oauth && (available.length || error)" class="plugin-oauth">
    <legend>连接服务账号</legend>
    <p v-if="error" role="alert">{{ error }}</p><p v-if="status" role="status">{{ status }}</p>
    <template v-if="available.length">
      <label>登录服务<select v-model="providerId" :disabled="busy || !!flow" aria-label="插件账号登录服务"><option v-for="provider in available" :key="provider.id" :value="provider.id">{{ provider.label }}</option></select></label>
      <p v-if="selected">服务请求的权限：{{ selected.scopes.join('、') || '服务默认权限' }}。仍受上方的方法、路径与插件版本限制。</p>
      <template v-if="flow">
        <a :href="flow.authorizationUrl" target="_blank" rel="noopener noreferrer" @click="open">前往服务登录</a>
        <p>{{ oauth.loginHint ?? '请在打开的浏览器中使用发起授权的同一同页账号。登录后返回此处。' }} 最长等待 10 分钟。</p>
        <button type="button" @click="cancel">取消本次连接</button>
      </template>
      <button v-else type="button" :disabled="busy || !enabled || !selected" @click="start">使用账号登录</button>
    </template>
  </fieldset>
</template>
<style scoped>
.plugin-oauth { display: grid; gap: 10px; }
p { margin: 0; }
label { display: flex; align-items: center; gap: 10px; }
select { flex: 1; min-width: 0; padding: 7px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--text); }
a, button { justify-self: start; padding: 7px 12px; border: 1px solid var(--line); border-radius: 6px; color: var(--text); background: var(--surface); }
a { color: var(--green); background: var(--accent); text-decoration: underline; text-underline-offset: 3px; }
button:disabled { opacity: .5; } [role=alert] { color: var(--danger); }
</style>
