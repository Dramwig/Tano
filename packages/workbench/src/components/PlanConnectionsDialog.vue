<script setup lang="ts">
import { t, uiLocale } from '../i18n';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { CalendarDays, Check, Cloud, FileUp, ListTodo, RefreshCw, X, ArrowLeft, Plus, ChevronRight } from 'lucide-vue-next';
import { invoke } from '@tauri-apps/api/core';
import { usePlanSyncStore } from '../stores/plan-sync';
import { useWorkspaceStore } from '../stores/workspace';
import { usePlanStore } from '../stores/plans';
import { parseCalendar } from '../plan-sync/ical';
import type { ImportPreview } from '../plan-sync/ical';
import { providers } from '../plan-sync/types';
import type { Account, Collection, ProviderId, SyncKind } from '../plan-sync/types';
import { remoteAdapter } from '../plan-sync/providers';

const props = defineProps<{ initialKind: SyncKind }>();
const emit = defineEmits<{ close: [] }>();
const sync = usePlanSyncStore(), workspace = useWorkspaceStore(), plans = usePlanStore();
const kind = ref(props.initialKind), selectedProvider = ref<ProviderId>();
const provider = computed(() => providers.find(p => p.id === selectedProvider.value));
const providerChoices = computed(() => providers.filter(p => p.kinds.includes(kind.value)));
const account = ref<Account>(), collections = ref<Collection[]>([]), collectionId = ref('');
const label = ref(''), server = ref(''), username = ref(''), password = ref(''), clientId = ref(''), clientSecret = ref('');
const target = ref<'personal' | 'workspace'>(plans.defaultScope), direction = ref<'both' | 'pull'>('both'), uploadNew = ref(false);
const selectedWorkspaceId = ref(workspace.workspace?.id);
const working = ref(false), error = ref(''), message = ref('');
const file = ref<HTMLInputElement>(), fileName = ref(''), preview = ref<ImportPreview>(), selectedImports = ref(new Set<string>());
const shownConnections = computed(() => sync.connections.filter(c => c.kind === kind.value));
const savedAccounts = computed(() => sync.accounts.filter(a => providerChoices.value.some(p => p.id === a.provider)));
const selectedCollection = computed(() => collections.value.find(c => c.id === collectionId.value));
const canWriteWorkspace = computed(() => plans.workspaceWritable && workspace.workspace?.id === selectedWorkspaceId.value);
const panel = ref<HTMLElement>();
let previous: HTMLElement | null;
onMounted(async () => { previous = document.activeElement as HTMLElement; await nextTick(); panel.value?.focus(); });
onUnmounted(() => previous?.isConnected && previous.focus());
function keyboard(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.stopPropagation(); if (!working.value) emit('close'); }
  if (event.key !== 'Tab' || !panel.value) return;
  const controls = [...panel.value.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary')].filter(e => e.getClientRects().length);
  if (event.shiftKey && (document.activeElement === controls[0] || document.activeElement === panel.value)) { event.preventDefault(); controls.at(-1)?.focus(); }
  else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
}
watch(kind, () => reset());
function reset() { selectedProvider.value = undefined; account.value = undefined; preview.value = undefined; collections.value = []; username.value = ''; password.value = ''; clientSecret.value = ''; error.value = ''; message.value = ''; uploadNew.value = false; direction.value = 'both'; }
function chooseProvider(id: ProviderId) {
  reset(); selectedProvider.value = id; const p = provider.value!; label.value = p.name; server.value = p.server;
  clientId.value = id === 'google' ? import.meta.env.VITE_GOOGLE_CALENDAR_CLIENT_ID || '' : id === 'microsoft' ? import.meta.env.VITE_MICROSOFT_TODO_CLIENT_ID || '' : '';
  selectedWorkspaceId.value = workspace.workspace?.id;
}
async function run(action: () => Promise<unknown>) {
  working.value = true; error.value = ''; message.value = '';
  try { await action(); } catch (e) { error.value = e instanceof Error ? e.message : String(e); }
  finally { working.value = false; }
}
async function selectAccount(value: Account) {
  reset(); selectedWorkspaceId.value = workspace.workspace?.id;
  selectedProvider.value = value.provider; account.value = value;
  collections.value = await remoteAdapter(value, kind.value).collections();
  if (!collections.value.length) throw new Error(kind.value === 'todo' ? t('此账号未提供可用的任务清单，请确认服务支持 VTODO 或已有任务列表。') : t('此账号没有可用日历，请核对访问权限。'));
  collectionId.value = collections.value[0]!.id;
}
async function connect() {
  if (!provider.value || !sync.available) return;
  await run(async () => {
    let result: Account;
    if (['google', 'microsoft'].includes(provider.value!.id)) result = await invoke<Account>('plan_account_oauth', { provider: provider.value!.id, label: label.value, clientId: clientId.value.trim(), clientSecret: clientSecret.value });
    else result = await invoke<Account>('plan_account_save', {
      account: { id: '', label: label.value, provider: provider.value!.id, server: server.value.trim() },
      credentials: provider.value!.id === 'todoist' ? { accessToken: password.value } : { username: username.value, password: password.value },
    });
    password.value = ''; clientSecret.value = '';
    await sync.refresh(); await selectAccount(result);
  });
}
async function enable() {
  await run(async () => {
    if (!account.value || !selectedCollection.value) return;
    if (target.value === 'workspace' && !canWriteWorkspace.value) throw new Error(t('工作区已切换，请重新选择目标'));
    const connectionId = await sync.addConnection({
      accountId: account.value.id, kind: kind.value, collection: selectedCollection.value,
      scope: target.value, ...(target.value === 'workspace' ? { workspaceId: selectedWorkspaceId.value, workspaceName: workspace.workspace?.name } : {}),
      direction: selectedCollection.value.writable ? direction.value : 'pull', enabled: true,
      uploadNew: selectedCollection.value.writable && direction.value === 'both' && uploadNew.value,
    });
    reset(); await sync.sync(connectionId); plans.view = target.value; message.value = t('连接已启用，首次同步完成。');
  });
}
async function readFile(event: Event) {
  const selected = (event.target as HTMLInputElement).files?.[0];
  if (!selected) return;
  await run(async () => {
    if (selected.size > 5_000_000) throw new Error(t('文件超过 5 MB，请分批导入'));
    reset(); fileName.value = selected.name;
    preview.value = parseCalendar(await selected.text(), kind.value);
    selectedImports.value = new Set(preview.value.items.filter(i => !i.value.archived).map(i => i.id));
    selectedWorkspaceId.value = workspace.workspace?.id;
  });
  (event.target as HTMLInputElement).value = '';
}
function toggleImport(id: string, checked: boolean) { if (checked) selectedImports.value.add(id); else selectedImports.value.delete(id); }
async function importFile() {
  await run(async () => {
    if (!preview.value) return;
    const result = await sync.importItems(preview.value.items.filter(i => selectedImports.value.has(i.id)), kind.value, target.value, selectedWorkspaceId.value);
    preview.value = undefined; message.value = t('已导入 {0} 条，跳过 {1} 条重复或取消的事项。', [result.imported, result.skipped]);
  });
}
const accountName = (id: string) => sync.accounts.find(a => a.id === id)?.label || t('账号不可用');
const time = (value?: string) => value ? new Date(value).toLocaleString(uiLocale.value, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : t('尚未同步');
</script>

<template>
  <Teleport to="body">
    <div class="plan-connections-backdrop" @mousedown.self="!working && emit('close')">
      <section ref="panel" class="plan-connections" role="dialog" aria-modal="true" :aria-label="t('日历与 Todo 连接')" tabindex="-1" @keydown="keyboard">
        <header><div><h2>{{ t('日历与 Todo') }}</h2><p>{{ t('连接常用服务，或从文件导入事项。') }}</p></div><button class="icon-button" :aria-label="t('关闭同步设置')" :disabled="working" @click="emit('close')"><X :size="18" /></button></header>
        <nav class="connection-tabs" :aria-label="t('同步类别')">
          <button :aria-pressed="kind === 'calendar'" :disabled="working" @click="kind = 'calendar'"><CalendarDays :size="16" />{{ t('日历') }}</button>
          <button :aria-pressed="kind === 'todo'" :disabled="working" @click="kind = 'todo'"><ListTodo :size="16" />Todo</button>
        </nav>
        <div class="connection-content">
          <p v-if="error || sync.loadError" class="connection-error" role="alert">{{ error || sync.loadError }}</p>
          <p v-if="message" class="connection-success" role="status"><Check :size="15" />{{ message }}</p>
          <template v-if="!selectedProvider && !preview">
            <section v-if="shownConnections.length" class="connection-section" :aria-label="t('已连接的清单')">
              <h3>{{ t('已连接') }}</h3>
              <article v-for="connection in shownConnections" :key="connection.id" class="connection-row">
                <div class="connection-row-heading"><div><strong>{{ connection.collection.name }}</strong><p>{{ accountName(connection.accountId) }} · {{ connection.scope === 'personal' ? t('个人') : connection.workspaceName }} · {{ connection.direction === 'both' ? t('双向') : t('仅接收') }}</p></div><label class="connection-switch"><input type="checkbox" :checked="connection.enabled" :disabled="!!sync.busy || working" :aria-label="t('{0} 自动同步', [connection.collection.name])" @change="run(() => sync.changeConnection(connection.id, ($event.target as HTMLInputElement).checked))" />{{ t('自动同步') }}</label></div>
                <p v-if="connection.error" class="connection-error">{{ connection.error }}</p>
                <details v-if="connection.conflicts.length" class="connection-conflicts"><summary>{{ connection.conflicts.length }} {{ t('条冲突待处理') }}</summary><article v-for="conflict in connection.conflicts" :key="conflict.remoteId"><strong>{{ conflict.local.name }}</strong><p>{{ conflict.reason }}</p><div class="conflict-versions"><div><small>{{ t('本地') }}</small><p>{{ conflict.local.name }}<br />{{ conflict.local.description }}<br />{{ conflict.local.start || conflict.local.date }} {{ conflict.local.completed ? t('已完成') : '' }}</p></div><div><small>{{ t('远端') }}</small><p>{{ conflict.remote.name }}<br />{{ conflict.remote.description }}<br />{{ conflict.remote.start || conflict.remote.date }} {{ conflict.remote.completed ? t('已完成') : '' }}</p></div></div><button :disabled="working || !!sync.busy" @click="run(() => sync.keepRemote(connection.id, conflict.remoteId))">{{ t('保留本地副本并接收远端版本') }}</button></article></details>
                <footer><span>{{ connection.enabled ? t('上次同步') : t('已暂停') }} · {{ time(connection.lastSync) }}</span><div><button :disabled="working || !!sync.busy" @click="run(() => sync.sync(connection.id))"><RefreshCw :size="13" />{{ sync.busy === connection.id ? t('同步中…') : t('立即同步') }}</button><button :disabled="working || !!sync.busy" @click="run(() => sync.removeConnection(connection.id))">{{ t('断开') }}</button></div></footer>
              </article>
              <p class="connection-note">{{ t('自动同步在应用打开时每 5 分钟进行。断开连接保留已下载的本地事项。') }}</p>
            </section>
            <section class="connection-import-row"><div class="connection-symbol"><FileUp :size="22" /></div><div><strong>{{ t('从文件导入') }}</strong><p>{{ kind === 'calendar' ? t('导入 .ics 日历文件，先预览再保存。') : t('导入 .ics 文件中的 VTODO 任务。') }}</p></div><button class="connection-outline" @click="file?.click()">{{ t('选择文件') }}</button></section>
            <section class="connection-section"><h3>{{ kind === 'calendar' ? t('添加日历') : t('添加任务清单') }}</h3><p v-if="!sync.available" class="connection-note">{{ t('账号同步在桌面版中使用。当前可导入文件，数据仅保存在{0}。', [workspace.isDemo ? t('此浏览器') : t('当前设备')]) }}</p><div class="connection-providers"><button v-for="p in providerChoices" :key="p.id" :disabled="!sync.available || working" @click="chooseProvider(p.id)"><Cloud :size="20" /><span>{{ p.name }}</span><Plus :size="15" /></button></div></section>
            <section v-if="savedAccounts.length" class="connection-section"><h3>{{ t('已授权账号') }}</h3><div v-for="a in savedAccounts" :key="a.id" class="connection-account"><span>{{ a.label }}</span><button :disabled="working || !!sync.busy" @click="run(() => selectAccount(a))">{{ t('选择清单') }}<ChevronRight :size="13" /></button><button :disabled="working || !!sync.busy || sync.connections.some(c => c.accountId === a.id)" @click="run(() => sync.removeAccount(a.id))">{{ t('移除授权') }}</button></div></section>
          </template>
          <template v-else-if="preview">
            <button class="connection-back" @click="reset"><ArrowLeft :size="14" />{{ t('返回') }}</button>
            <h3>{{ fileName }}</h3><p class="connection-note">{{ kind === 'calendar' ? t('找到 {0} 条日历事件。', [preview.items.length]) : t('找到 {0} 条任务。', [preview.items.length]) }} {{ t('同一 UID 再次导入会跳过，文件导入不建立持续同步。') }}</p>
            <details v-if="preview.warnings.length || preview.ignored" class="connection-warnings"><summary>{{ preview.warnings.length }} {{ t('条提示 ·') }} {{ preview.ignored }} {{ t('条未纳入') }}</summary><p v-for="warning in preview.warnings" :key="warning">{{ warning }}</p></details>
            <label class="connection-check"><input type="checkbox" :checked="selectedImports.size === preview.items.length && preview.items.length > 0" @change="selectedImports = ($event.target as HTMLInputElement).checked ? new Set(preview.items.map(i => i.id)) : new Set()" />{{ t('全选（已选') }} {{ selectedImports.size }} {{ t('条）') }}</label>
            <div class="connection-preview"><label v-for="item in preview.items" :key="item.id"><input type="checkbox" :checked="selectedImports.has(item.id)" @change="toggleImport(item.id, ($event.target as HTMLInputElement).checked)" /><span><strong>{{ item.value.name }}</strong><small>{{ item.value.allDay ? t('全天 · ') : '' }}{{ item.value.date || (item.value.start ? new Date(item.value.start).toLocaleString(uiLocale) : t('未安排')) }}</small></span></label></div>
            <label class="connection-field">{{ t('保存到') }}<select v-model="target" :aria-label="t('保存到')"><option value="personal">{{ t('个人') }}</option><option value="workspace" :disabled="!canWriteWorkspace">{{ t('当前工作区 ·') }} {{ workspace.workspace?.name || t('未打开') }}</option></select></label>
            <div class="connection-form-footer"><button class="connection-primary" :disabled="working || !!sync.busy || !selectedImports.size || (target === 'workspace' && !canWriteWorkspace)" @click="importFile">{{ working ? t('正在导入…') : t('导入 {0} 条', [selectedImports.size]) }}</button></div>
          </template>
          <template v-else-if="provider">
            <button class="connection-back" :disabled="working" @click="reset"><ArrowLeft :size="14" />{{ t('返回') }}</button>
            <h3>{{ t('连接') }} {{ provider.name }}</h3><p class="connection-note">{{ provider.hint }}</p>
            <form v-if="!account" class="connection-form" @submit.prevent="connect">
              <label class="connection-field">{{ t('连接名称') }}<input v-model="label" required maxlength="80" autocomplete="off" /></label>
              <template v-if="['google', 'microsoft'].includes(provider.id)">
                <p class="connection-note">{{ t('当前构建需要配置自己的 OAuth 应用。') }}{{ provider.id === 'google' ? t('使用 Google Cloud 的桌面应用客户端，并启用 Calendar API。') : t('使用 Microsoft Entra 公共客户端，允许个人账号，配置桌面应用回调 http://localhost。') }}</p>
                <label class="connection-field">{{ t('应用 Client ID') }}<input v-model="clientId" required autocomplete="off" /></label>
                <label v-if="provider.id === 'google'" class="connection-field">{{ t('Client Secret（若应用提供）') }}<input v-model="clientSecret" type="password" autocomplete="off" /></label>
              </template>
              <template v-else>
                <template v-if="provider.id !== 'todoist'"><label class="connection-field">{{ t('服务器') }}<input v-model="server" type="url" required placeholder="https://calendar.example.com/" autocomplete="url" /></label><label class="connection-field">{{ provider.id === 'icloud' ? t('Apple 账号') : t('用户名') }}<input v-model="username" required autocomplete="username" /></label></template>
                <label class="connection-field">{{ provider.id === 'todoist' ? 'API Token' : provider.id === 'icloud' ? t('App 专用密码') : t('密码 / 应用密码') }}<input v-model="password" type="password" required autocomplete="new-password" /></label>
              </template>
              <p class="connection-note">{{ t('凭据保存在此设备的系统凭据库，不写入工作区文件。') }}</p>
              <div class="connection-form-footer"><span v-if="working">{{ ['google', 'microsoft'].includes(provider.id) ? t('请在浏览器完成授权…') : t('正在读取清单…') }}</span><button class="connection-primary" type="submit" :disabled="working || !!sync.busy">{{ ['google', 'microsoft'].includes(provider.id) ? t('在浏览器中授权') : t('连接并读取清单') }}</button></div>
            </form>
            <form v-else class="connection-form" @submit.prevent="enable">
              <label class="connection-field">{{ kind === 'calendar' ? t('选择日历') : t('选择任务清单') }}<select v-model="collectionId" required><option v-for="c in collections" :key="c.id" :value="c.id">{{ c.name }}{{ c.writable ? '' : t('（只读）') }}</option></select></label>
              <label class="connection-field">{{ t('保存到') }}<select v-model="target" :aria-label="t('保存到')"><option value="personal">{{ t('个人') }}</option><option value="workspace" :disabled="!canWriteWorkspace">{{ t('当前工作区 ·') }} {{ workspace.workspace?.name || t('未打开') }}</option></select></label>
              <fieldset class="connection-direction"><legend>{{ t('同步方式') }}</legend><label><input v-model="direction" type="radio" value="both" :disabled="!selectedCollection?.writable" />{{ t('双向同步') }}</label><label><input v-model="direction" type="radio" value="pull" />{{ t('仅接收远端更新') }}</label></fieldset>
              <label v-if="direction === 'both' && selectedCollection?.writable" class="connection-check"><input v-model="uploadNew" type="checkbox" />{{ t('同时上传此范围内尚未连接的{0}', [kind === 'calendar' ? t('日历事件') : 'Todo']) }}</label>
              <p class="connection-note">{{ uploadNew ? t('首次同步也会上传已有的本地事项。') : t('默认只同步从此清单接收的事项，本地其他内容不会自动上传。') }}{{ t('重复事项在来源应用编辑；删除或归档不会自动永久删除另一端内容。日历读取过去一年至未来两年。') }}</p>
              <div class="connection-form-footer"><button class="connection-primary" type="submit" :disabled="working || !!sync.busy || !selectedCollection || (target === 'workspace' && !canWriteWorkspace)">{{ kind === 'calendar' ? t('启用日历同步') : t('启用 Todo 同步') }}</button></div>
            </form>
          </template>
          <input ref="file" type="file" accept=".ics,text/calendar" class="connection-file-input" :aria-label="t('选择 iCalendar 文件')" @change="readFile" />
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.plan-connections-backdrop { position: fixed; inset: 0; z-index: 95; display: flex; align-items: center; justify-content: center; padding: 20px; background: #11182745; }
.plan-connections { width: 680px; max-width: 100%; max-height: min(860px, 90dvh); display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: 14px; background: var(--paper); color: var(--text); box-shadow: 0 24px 80px #0002; outline: none; }
.plan-connections > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 24px 26px 18px; }
h2 { margin: 0 0 7px; font-size: 19px; font-weight: 600; }
h3 { margin: 0 0 12px; font-size: 14px; font-weight: 600; }
p { margin: 0; }
header p, .connection-note { font-size: 12px; color: var(--muted); line-height: 1.7; }
.connection-tabs { display: flex; gap: 24px; padding: 0 26px; border-bottom: 1px solid var(--line); }
.connection-tabs button { display: flex; align-items: center; gap: 8px; padding: 11px 3px; border-bottom: 2px solid transparent; color: var(--muted); font-size: 13px; }
.connection-tabs button[aria-pressed='true'] { color: var(--green); border-bottom-color: var(--green); }
.connection-content { min-height: 240px; overflow: auto; padding: 22px 26px 26px; }
.connection-section + .connection-section { margin-top: 25px; }
.connection-import-row { display: flex; align-items: center; gap: 13px; margin-bottom: 26px; padding: 17px 16px; border: 1px solid var(--line); border-radius: 9px; }
.connection-symbol { color: var(--green); padding: 8px; border-radius: 8px; background: var(--accent); }
.connection-import-row > div:nth-child(2) { flex: 1; }
.connection-import-row strong { font-size: 13px; font-weight: 500; }
.connection-import-row p { color: var(--muted); margin-top: 5px; font-size: 11px; line-height: 1.6; }
.connection-outline { padding: 7px 11px; border: 1px solid var(--line); border-radius: 6px; font-size: 12px; white-space: nowrap; }
.connection-providers { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
.connection-providers button { display: flex; gap: 11px; align-items: center; padding: 15px; border: 1px solid var(--line); border-radius: 8px; color: var(--text-secondary); }
.connection-providers button span { flex: 1; text-align: left; font-size: 13px; }
.connection-providers button:not(:disabled):hover, .connection-outline:hover { background: var(--hover); }
button:disabled { opacity: 0.5; cursor: not-allowed; }
.connection-row { padding: 14px 0; border-bottom: 1px solid var(--line); }
.connection-row-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.connection-row strong, .connection-preview strong { font-size: 13px; font-weight: 500; }
.connection-row-heading p { font-size: 11px; margin-top: 5px; color: var(--muted); }
.connection-row footer { display: flex; gap: 12px; justify-content: space-between; align-items: center; margin-top: 13px; font-size: 11px; color: var(--muted); }
.connection-row footer div { display: flex; gap: 12px; }
.connection-row footer button, .connection-account button { display: inline-flex; align-items: center; gap: 5px; color: var(--green); }
.connection-section > .connection-note { margin: 12px 0; }
.connection-switch, .connection-check { display: flex; align-items: center; gap: 7px; font-size: 12px; line-height: 1.6; }
input[type='checkbox'], input[type='radio'] { accent-color: var(--green); }
.connection-switch { white-space: nowrap; }
.connection-account { display: flex; gap: 14px; font-size: 12px; padding: 12px 0; }
.connection-account span { flex: 1; }
.connection-back { display: flex; align-items: center; gap: 5px; margin-bottom: 18px; color: var(--muted); font-size: 12px; }
.connection-form { display: grid; gap: 17px; margin-top: 22px; }
.connection-field { display: grid; gap: 8px; font-size: 12px; }
.connection-field input, .connection-field select { width: 100%; min-width: 0; height: 36px; padding: 7px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--text); font: inherit; }
.connection-direction { display: flex; gap: 22px; padding: 0; border: 0; font-size: 12px; }
.connection-direction legend { margin-bottom: 10px; }
.connection-direction label { display: flex; align-items: center; gap: 6px; }
.connection-form-footer { display: flex; justify-content: flex-end; align-items: center; gap: 12px; margin-top: 16px; font-size: 12px; color: var(--muted); }
.connection-primary { color: white; background: var(--green-fill); padding: 9px 16px; border-radius: 7px; font-size: 12px; }
.connection-error { margin-bottom: 14px; padding: 9px 11px; border-radius: 6px; background: #c5555510; color: #b14949; font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.connection-success { display: flex; gap: 7px; color: var(--green); margin-bottom: 16px; font-size: 12px; }
.connection-preview { max-height: 260px; overflow: auto; margin: 10px 0 20px; border: 1px solid var(--line); border-radius: 6px; }
.connection-preview label { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--line); }
.connection-preview small { display: block; color: var(--muted); font-size: 11px; margin-top: 3px; }
.connection-file-input { display: none; }
.connection-warnings, .connection-conflicts { font-size: 12px; margin: 12px 0; line-height: 1.6; color: var(--muted); }
summary { cursor: pointer; }
.connection-conflicts article { margin: 14px 0; padding: 10px; border: 1px solid var(--line); border-radius: 6px; }
.connection-conflicts button { margin-top: 8px; color: var(--green); }
.conflict-versions { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 8px; }
.conflict-versions p { white-space: pre-wrap; overflow-wrap: anywhere; }
button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
@media (max-width: 560px) {
  .plan-connections-backdrop { padding: 12px; }
  .plan-connections > header { padding: 20px 18px 14px; }
  .connection-tabs { padding: 0 18px; }
  .connection-content { padding: 18px; }
  .connection-providers { grid-template-columns: 1fr; }
  .connection-symbol { display: none; }
  .connection-import-row { padding: 13px; gap: 10px; }
  .connection-row-heading, .connection-row footer { flex-wrap: wrap; }
}
</style>
