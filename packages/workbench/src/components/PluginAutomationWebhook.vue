<script setup lang="ts">
import { t } from '../i18n';
import { computed, onScopeDispose, ref, watch } from 'vue';
import type { PluginAutomationJob } from '@tano/protocol';
import { useWorkbenchRuntime } from '../runtime';
import { useWorkspaceStore } from '../stores/workspace';

const props = defineProps<{ job: PluginAutomationJob; disabled: boolean }>();
const emit = defineEmits<{ changed: [job: PluginAutomationJob] }>();
const store = useWorkspaceStore(), provider = useWorkbenchRuntime().plugins?.automations?.webhook;
const opened = ref(false), approved = ref(false), busy = ref(false), revealed = ref(false), error = ref(''), status = ref('');
const secret = ref<{ token: string; version: string; workspace: string; jobId: string }>();
let controller = new AbortController();
const canIssue = computed(() => props.job.enabled && !props.job.needsAuthorization);
const endpoint = computed(() => store.workspace && provider ? provider.url(store.workspace.id, props.job.id) : '');
watch(() => JSON.stringify([opened.value, store.workspace?.id, store.canManagePlugins, props.job.id, props.job.version, props.job.enabled, props.job.needsAuthorization]), () => {
  controller.abort(); controller = new AbortController(); busy.value = false; approved.value = false; revealed.value = false; error.value = ''; status.value = '';
  if (!opened.value || !store.canManagePlugins || !canIssue.value || secret.value?.version !== props.job.version || secret.value?.workspace !== store.workspace?.id || secret.value?.jobId !== props.job.id) secret.value = undefined;
}, { flush: 'sync' });
async function change(rotate: boolean) {
  if (!provider || !opened.value || !store.workspace || !store.canManagePlugins || props.disabled || busy.value || rotate && (!approved.value || !canIssue.value)) return;
  const workspace = store.workspace.id, id = props.job.id, version = props.job.version, signal = controller.signal;
  busy.value = true; error.value = ''; status.value = ''; secret.value = undefined;
  try {
    if (rotate) {
      const value = await provider.rotate(workspace, id, version, signal);
      if (signal.aborted) return;
      secret.value = { token: value.token, version: value.job.version, workspace, jobId: id }; emit('changed', value.job);
      status.value = t('新凭据已生成，旧凭据已失效。请保存到调用方的秘密配置中。');
    } else {
      const job = await provider.revoke(workspace, id, version, signal);
      if (signal.aborted) return;
      emit('changed', job); status.value = t('触发凭据已撤销。');
    }
  } catch (cause) { if (!signal.aborted) error.value = t('暂未确认凭据操作结果，请刷新任务后核对；响应丢失时需要重新生成凭据。{0}', [cause instanceof Error ? cause.message : String(cause)]); }
  finally { if (!signal.aborted) { busy.value = false; approved.value = false; } }
}
async function copyToken() {
  if (!secret.value) return;
  const signal = controller.signal;
  try { await navigator.clipboard.writeText(secret.value.token); if (!signal.aborted) status.value = t('触发凭据已复制。'); }
  catch { if (!signal.aborted) error.value = t('无法复制，请显示凭据后手动复制。'); }
}
onScopeDispose(() => { controller.abort(); secret.value = undefined; });
</script>
<template>
  <details v-if="provider" class="automation-webhook" :aria-label="`${job.label} Webhook`" @toggle="opened = ($event.target as HTMLDetailsElement).open">
    <summary>Webhook · {{ job.webhookConfigured ? t('已配置') : t('未配置') }}</summary>
    <p>{{ t('允许外部服务使用独立凭据触发此任务。凭据只允许触发当前任务，不能读取工作区或运行结果。') }}</p>
    <label>{{ t('触发地址') }}<input :value="endpoint" readonly :aria-label="t('Webhook 触发地址')" /></label>
    <p>{{ t('调用方发送 POST，使用') }} <code>{{ t('Authorization: Bearer \u003c触发凭据>') }}</code> {{ t('和') }} <code>Idempotency-Key</code> {{ t('请求头。每个事件使用唯一的 16～128 位字母、数字、下划线或连字符标识；重试同一事件时沿用标识和 JSON 正文。正文最多 16 KiB，禁止在地址中携带凭据。') }}</p>
    <p>{{ t('轮换或撤销会停止此任务当前的待执行和运行中调用，已经完成的操作保留。编辑任务后需要重新生成凭据。') }}</p>
    <p v-if="!canIssue">{{ t('任务启用且授权有效时才能生成凭据。') }}</p>
    <label v-else><input v-model="approved" type="checkbox" :disabled="busy || disabled" />{{ t('允许持有触发凭据的服务运行此任务') }}</label>
    <div class="actions">
      <button :disabled="busy || disabled || !approved || !canIssue" @click="change(true)">{{ job.webhookConfigured ? t('轮换触发凭据') : t('生成触发凭据') }}</button>
      <button v-if="job.webhookConfigured" :disabled="busy || disabled" @click="change(false)">{{ t('撤销触发凭据') }}</button>
    </div>
    <div v-if="secret" class="secret">
      <p>{{ t('凭据仅在此次响应中提供；关闭此区域或离开工作区后无法再次查看。') }}</p>
      <label>{{ t('触发凭据') }}<input :type="revealed ? 'text' : 'password'" :value="secret.token" readonly autocomplete="off" spellcheck="false" :aria-label="t('Webhook 触发凭据')" /></label>
      <div class="actions"><button @click="revealed = !revealed">{{ revealed ? t('隐藏凭据') : t('显示凭据') }}</button><button @click="copyToken">{{ t('复制触发凭据') }}</button></div>
    </div>
    <p v-if="error" role="alert">{{ error }}</p><p v-if="status" role="status">{{ status }}</p>
  </details>
</template>
<style scoped>
.automation-webhook { margin-top: 12px; border-top: 1px solid var(--line); padding-top: 8px; }
summary { cursor: pointer; font-weight: 600; padding: 4px 0; }
p { overflow-wrap: anywhere; line-height: 1.6; }
label { display: flex; align-items: center; gap: 8px; margin: 10px 0; }
input:not([type=checkbox]) { flex: 1; min-width: 0; padding: 7px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--text); font: inherit; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
button { padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px; color: var(--text); background: var(--surface); font: inherit; cursor: pointer; }
button:disabled { opacity: .5; cursor: default; }
.secret { padding: 12px; margin-top: 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
[role=alert] { color: var(--danger); }
</style>
