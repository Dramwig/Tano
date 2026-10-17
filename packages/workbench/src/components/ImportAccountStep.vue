<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { Check, ChevronRight, Globe2, LoaderCircle, Unplug } from 'lucide-vue-next';
import { useWorkbenchRuntime } from '../runtime';
import { createAccountImportService } from '../account-import/service';
import { nativeImportHost } from '../account-import/native';
import type { ImportAccount, ImportCapability, ImportProviderId, ImportResource } from '../account-import/types';
import type { PreparedImport } from '../document-import';

const props = defineProps<{ provider: { id: ImportProviderId; name: string; detail: string; icon: string; color: string; accept: string } }>();
const emit = defineEmits<{ file: []; prepared: [result: PreparedImport, sourceCount: number] }>();
const runtime = useWorkbenchRuntime();
const host = runtime.accountImports ?? (runtime.native && !runtime.mobile ? nativeImportHost() : undefined);
const service = host ? createAccountImportService(host) : undefined;
const mode = ref<'account' | 'file'>(props.provider.id === 'obsidian' ? 'file' : 'account');
const accounts = shallowRef<ImportAccount[]>([]), resources = shallowRef<ImportResource[]>([]);
const capability = shallowRef<ImportCapability>();
const accountId = ref(''), token = ref(''), context = ref(''), apiKey = ref(''), label = ref('');
const selected = ref<string[]>([]), working = ref(false), connecting = ref(false), error = ref(''), progress = ref('');
const useToken = ref(false);
const account = computed(() => accounts.value.find(value => value.id === accountId.value));
const controller = new AbortController();
let flowId = '', generation = 0, disposed = false;
const message = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);
async function run(action: () => Promise<void>) {
  if (working.value) return;
  working.value = true; error.value = '';
  try { await action(); }
  catch (reason) { if (!disposed && !controller.signal.aborted) error.value = message(reason); }
  finally { if (!disposed) { working.value = false; progress.value = ''; } }
}
async function loadResources() {
  resources.value = []; selected.value = [];
  if (!account.value || !service) return;
  const result = await service.resources(account.value, controller.signal);
  if (disposed) return;
  resources.value = result;
}
async function changeAccount() { await run(loadResources); }
async function connect() {
  if (!host || !service) return;
  await run(async () => {
    connecting.value = true;
    const attempt = ++generation;
    flowId = crypto.randomUUID();
    let connected: ImportAccount | undefined;
    try {
      const credential = token.value;
      token.value = '';
      connected = await host.connect({ provider: props.provider.id, label: label.value.trim() || props.provider.name,
        token: credential, context: context.value.trim(), apiKey: apiKey.value.trim(), oauth: !useToken.value, flowId });
      if (disposed || attempt !== generation) { await host.disconnect(connected.id); return; }
      // A connection becomes selectable only after its actual content can be read.
      const items = await service.resources(connected, controller.signal);
      if (disposed || attempt !== generation) { await host.disconnect(connected.id); return; }
      accounts.value = [...accounts.value, connected]; accountId.value = connected.id;
      resources.value = items; selected.value = [];
    } catch (reason) { if (connected) await host.disconnect(connected.id).catch(() => {}); throw reason; }
    finally { connecting.value = false; flowId = ''; }
  });
}
async function cancel() {
  ++generation;
  if (flowId) await host?.cancel(flowId).catch(() => {});
}
async function disconnect() {
  if (!account.value || !host) return;
  const id = account.value.id;
  await run(async () => {
    await host.disconnect(id); accounts.value = accounts.value.filter(account => account.id !== id);
    accountId.value = ''; resources.value = []; selected.value = [];
  });
}
async function prepare() {
  if (!account.value || !service) return;
  const connected = account.value;
  const chosen = resources.value.filter(item => selected.value.includes(item.id));
  await run(async () => {
    const result = await service.prepare(connected, chosen, controller.signal, name => { progress.value = name; });
    if (!disposed) emit('prepared', result, chosen.length);
  });
}
onMounted(() => run(async () => {
  if (!host || props.provider.id === 'obsidian') return;
  const [available, saved] = await Promise.all([host.capabilities(), host.accounts()]);
  if (disposed) return;
  capability.value = available.find(value => value.provider === props.provider.id);
  useToken.value = !capability.value?.oauth;
  accounts.value = saved.filter(value => value.provider === props.provider.id);
}));
onBeforeUnmount(() => { disposed = true; controller.abort(); void cancel(); token.value = ''; apiKey.value = ''; });
</script>

<template>
  <div class="account-import" :aria-busy="working">
    <div class="account-import-brand" :style="{ color: provider.color }" aria-hidden="true" v-html="provider.icon" />
    <h3>导入 {{ provider.name }}</h3>
    <p>连接账号，选择想要导入的内容，预览后保存到工作区。</p>
    <div class="account-import-tabs" role="tablist" aria-label="导入方式">
      <button type="button" role="tab" :aria-selected="mode === 'account'" :disabled="working || provider.id === 'obsidian'" @click="mode = 'account'"><Globe2 :size="16" />通过账号导入</button>
      <button type="button" role="tab" :aria-selected="mode === 'file'" :disabled="working" @click="mode = 'file'">通过文件导入</button>
    </div>
    <p v-if="error" class="account-import-error" role="alert">{{ error }}</p>
    <div v-if="mode === 'file'" class="account-import-file">
      <p v-if="provider.id === 'obsidian'">Obsidian 没有公开的账号内容 API。请选择本地仓库的 Markdown 或 Vault ZIP。</p>
      <p v-else>在 {{ provider.name }} 导出文件，然后选择文件导入。</p>
      <small>{{ provider.detail }}</small>
      <button class="account-import-primary" type="button" @click="emit('file')">选择导出文件<ChevronRight :size="16" /></button>
    </div>
    <template v-else>
      <p v-if="!host" class="account-import-note">当前客户端尚未接入账号授权服务。请使用桌面版连接账号，或切换到文件导入。</p>
      <template v-else>
        <label v-if="accounts.length">选择账号<select v-model="accountId" :disabled="working" @change="changeAccount"><option value="">连接其他账号</option><option v-for="item in accounts" :key="item.id" :value="item.id">{{ item.label }}</option></select></label>
        <template v-if="!account">
          <label>连接名称<input v-model="label" :placeholder="provider.name" :disabled="working" maxlength="200" /></label>
          <p v-if="capability && !capability.oauth && !['workflowy', 'roam'].includes(provider.id)" class="account-import-note">此平台的浏览器授权尚未配置。<template v-if="capability.token">你也可以使用该平台提供的 API 令牌连接。</template></p>
          <label v-if="capability?.oauth && capability.token" class="account-import-toggle"><input v-model="useToken" type="checkbox" :disabled="working" />使用 API 令牌</label>
          <template v-if="useToken && capability?.token">
            <label v-if="provider.id === 'roam'">Graph 名称<input v-model="context" autocomplete="off" :disabled="working" /></label>
            <label v-if="provider.id === 'evernote'">NoteStore URL（可选）<input v-model="context" placeholder="由 Evernote 开发者页面提供" autocomplete="off" :disabled="working" /></label>
            <label v-if="provider.id === 'trello'">应用 API Key<input v-model="apiKey" autocomplete="off" :disabled="working" /></label>
            <label>API 令牌<input v-model="token" type="password" autocomplete="off" spellcheck="false" :disabled="working" /></label>
          </template>
          <button class="account-import-primary" type="button" :disabled="working || !capability || (useToken ? !capability.token || !token.trim() : !capability.oauth)" @click="connect"><LoaderCircle v-if="connecting" :size="16" class="account-import-spin" /><Globe2 v-else :size="16" />{{ connecting ? '等待浏览器授权或连接结果…' : `连接 ${provider.name} 账号` }}</button>
          <button v-if="connecting" class="account-import-cancel" type="button" @click="cancel">取消连接</button>
        </template>
        <template v-else>
          <div class="account-import-connected"><span><Check :size="16" />已连接 {{ account.label }}</span><button type="button" :disabled="working" @click="disconnect"><Unplug :size="14" />断开连接</button></div>
          <div class="account-import-resource-heading"><strong>选择导入内容</strong><button type="button" :disabled="working || !resources.length" @click="selected = selected.length === resources.length ? [] : resources.map(item => item.id)">{{ selected.length === resources.length && resources.length ? '取消全选' : '全选' }}</button></div>
          <div class="account-import-resources panel-scrollbar"><label v-for="item in resources" :key="item.id"><input v-model="selected" type="checkbox" :value="item.id" :disabled="working" /><span>{{ item.name }}</span></label><p v-if="!resources.length && !working">账号中没有可读取的内容。请检查应用授权范围或共享页面后重试。</p></div>
          <button class="account-import-primary" type="button" :disabled="working || !selected.length" @click="prepare"><LoaderCircle v-if="working" :size="16" class="account-import-spin" />{{ working ? '正在读取内容…' : `继续，预览 ${selected.length} 项内容` }}</button>
        </template>
        <p v-if="working && !connecting" role="status">{{ progress || '正在读取账号内容…' }}</p>
        <small class="account-import-note">连接仅在本次桌面会话中保留。导入只读取内容，不会修改第三方账号。</small>
      </template>
    </template>
  </div>
</template>

<style scoped>
.account-import{max-width:560px;margin:8px auto 20px}.account-import-brand{width:36px;height:36px;margin:0 auto 16px;fill:currentColor}.account-import-brand :deep(svg){width:100%;height:100%}.account-import h3{font-size:24px;text-align:center;margin:0 0 8px}.account-import>p{color:var(--muted);text-align:center;font-size:13px;line-height:1.7}.account-import-tabs{display:flex;background:var(--surface);border:1px solid var(--line);border-radius:9px;padding:3px;margin:24px 0 18px}.account-import-tabs button{flex:1;display:flex;justify-content:center;align-items:center;gap:6px;padding:10px 8px;border-radius:6px;font-size:13px}.account-import-tabs [aria-selected=true]{background:var(--paper);box-shadow:0 1px 4px #0001}.account-import label{display:block;color:var(--text-secondary);font-size:12px;margin-top:14px}.account-import label>input:not([type=checkbox]),.account-import select{display:block;box-sizing:border-box;width:100%;margin-top:7px;border:1px solid var(--control-border);border-radius:7px;padding:10px 12px;color:var(--text);background:var(--paper);font:inherit}.account-import-primary{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;border-radius:8px;padding:12px;margin-top:20px;color:white;background:var(--green-fill);font-size:13px}.account-import-primary:disabled{opacity:.5;cursor:not-allowed}.account-import-note{display:block;color:var(--muted);font-size:11px;line-height:1.7;margin-top:14px}.account-import-error{color:var(--danger)!important;background:var(--danger-bg);padding:10px;border-radius:7px;text-align:left!important}.account-import-toggle{display:flex!important;align-items:center;gap:8px}.account-import-file{text-align:center;padding:10px 0}.account-import-file p{font-size:13px;line-height:1.8}.account-import-file small{color:var(--muted)}.account-import-connected,.account-import-connected span{display:flex;align-items:center;gap:7px}.account-import-connected{justify-content:space-between;font-size:12px;margin-top:20px}.account-import-connected button{display:flex;align-items:center;gap:5px;color:var(--muted);font-size:11px}.account-import-resource-heading{display:flex;justify-content:space-between;margin-top:24px;font-size:12px}.account-import-resource-heading button{color:var(--green)}.account-import-resources{max-height:220px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:6px 12px;margin-top:10px}.account-import-resources label{display:flex;gap:8px;align-items:center;margin:0;min-height:36px;overflow-wrap:anywhere}.account-import-resources p{font-size:12px;color:var(--muted);line-height:1.8}.account-import-cancel{display:block;margin:12px auto;font-size:12px;color:var(--muted)}.account-import-spin{animation:import-spin 1s linear infinite}@keyframes import-spin{to{transform:rotate(360deg)}}
</style>
