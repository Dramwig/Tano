<script setup lang="ts">
import { t } from '../i18n';
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue';
import { canonicalPluginJson, parsePluginAutomationJob, type PluginAutomationJob, type PluginAutomationRun, type PluginPermission } from '@tano/protocol';
import { useWorkbenchRuntime } from '../runtime';
import { useWorkspaceStore } from '../stores/workspace';
import { AutomationSubmissions } from '../plugins/automation-submissions';
import { assistantHash } from '../assistant/hash';
import PluginAutomationWebhook from './PluginAutomationWebhook.vue';

const runtime = useWorkbenchRuntime(), store = useWorkspaceStore(), provider = runtime.plugins?.automations;
const opened = ref(false), busy = ref(false), error = ref(''), status = ref('');
const jobs = shallowRef<PluginAutomationJob[]>([]), history = shallowRef<PluginAutomationRun[]>([]), historyId = ref('');
const editor = ref(false), jobId = ref(''), version = ref<string>(), pluginId = ref(''), automationId = ref('');
const label = ref(''), enabled = ref(true), schedule = ref('manual'), interval = ref(1440), payload = ref('{}'), approved = ref(false);
const deleting = ref(''), pending = ref<Record<string, boolean>>({}), reviewed = ref(false);
let controller = new AbortController(), timer: ReturnType<typeof setTimeout> | undefined;
const plugins = computed(() => store.installedPlugins.filter(item => item.manifest.manifestVersion === 2 && item.manifest.automations?.length && item.rule?.mode !== 'disabled' && item.rule?.integrity));
const installation = computed(() => plugins.value.find(item => item.manifest.id === pluginId.value));
const manifest = computed(() => installation.value?.manifest.manifestVersion === 2 ? installation.value.manifest : undefined);
const canSave = computed(() => !!(approved.value && manifest.value?.automations?.some(item => item.id === automationId.value) && label.value.trim() && installation.value?.rule?.integrity));
const permissions: Partial<Record<PluginPermission, string>> = { get 'documents.read'() { return t('读取文档'); }, get 'documents.write'() { return t('创建与修改文档'); }, get 'objects.read'() { return t('读取对象'); }, get 'objects.write'() { return t('创建与修改对象'); }, get 'relations.read'() { return t('读取关系'); }, get 'relations.write'() { return t('修改关系'); }, get network() { return t('访问指定网络来源'); }, get connections() { return t('使用单独授权的服务凭据'); } };
const statuses: Record<PluginAutomationRun['status'], string> = { get queued() { return t('等待执行'); }, get running() { return t('执行中'); }, get succeeded() { return t('已完成'); }, get failed() { return t('失败'); }, get cancelled() { return t('已停止'); }, get uncertain() { return t('结果不确定'); }, get expired() { return t('已过期'); } };
const date = (value: string | null) => value ? new Date(value).toLocaleString() : '—';
const format = (value: unknown) => JSON.stringify(value, null, 2);
function submissions(workspace: string) { return new AutomationSubmissions(runtime.plugins?.principal ?? 'device', workspace); }
function readPending(workspace: string) {
  const saved = submissions(workspace);
  pending.value = Object.fromEntries(jobs.value.map(job => [job.id, !!saved.pending(job.id, job.version)]));
}
function selectJob(job?: PluginAutomationJob) {
  editor.value = true; jobId.value = job?.id ?? crypto.randomUUID(); version.value = job?.version;
  pluginId.value = job?.pluginId ?? ''; automationId.value = job?.automationId ?? '';
  label.value = job?.label ?? ''; enabled.value = job?.enabled ?? true;
  schedule.value = job?.intervalMinutes ? 'interval' : 'manual'; interval.value = job?.intervalMinutes ?? 1440;
  payload.value = format(job?.payload ?? {}); approved.value = false; deleting.value = ''; reviewed.value = false;
}
function choosePlugin() { automationId.value = manifest.value?.automations?.[0]?.id ?? ''; chooseAutomation(); }
function chooseAutomation() { label.value = manifest.value?.automations?.find(item => item.id === automationId.value)?.label ?? ''; }
watch([pluginId, automationId, label, enabled, schedule, interval, payload], () => { approved.value = false; }, { flush: 'sync' });
async function load(workspace: string, signal: AbortSignal) {
  const values = await provider!.list(workspace, signal);
  if (signal.aborted) return;
  jobs.value = values; readPending(workspace);
  if (editor.value && version.value) {
    const latest = values.find(job => job.id === jobId.value);
    if (!latest) { editor.value = false; approved.value = false; }
    else if (latest.version !== version.value) { selectJob(latest); status.value = t('任务已被修改，已载入最新设置，请重新核对授权。'); }
  }
  if (historyId.value) {
    if (!values.some(job => job.id === historyId.value)) { historyId.value = ''; history.value = []; }
    else {
      const id = historyId.value, runs = await provider!.runs(workspace, id, signal);
      if (!signal.aborted && historyId.value === id) history.value = runs;
    }
  }
}
function poll() {
  clearTimeout(timer);
  if (opened.value && store.canManagePlugins && provider && !error.value)
    timer = setTimeout(() => { void operation(load, true); }, 5000);
}
async function operation(action: (workspace: string, signal: AbortSignal) => Promise<void>, quiet = false) {
  if (busy.value || !opened.value || !store.workspace || !store.canManagePlugins || !provider) return;
  const signal = controller.signal, workspace = store.workspace.id;
  busy.value = true; error.value = ''; if (!quiet) status.value = ''; clearTimeout(timer);
  try { await action(workspace, signal); }
  catch (cause) { if (!signal.aborted) error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { if (!signal.aborted) { busy.value = false; poll(); } }
}
function save() {
  if (!canSave.value) return;
  let input: ReturnType<typeof parsePluginAutomationJob>;
  try { input = parsePluginAutomationJob({ pluginId: pluginId.value, automationId: automationId.value, integrity: installation.value!.rule!.integrity,
    label: label.value.trim(), enabled: enabled.value, intervalMinutes: schedule.value === 'manual' ? null : Number(interval.value), payload: JSON.parse(payload.value), ...(version.value ? { version: version.value } : {}) }); }
  catch { error.value = t('请检查任务名称、执行间隔（15～43200 分钟）和参数 JSON（最多 16 KiB）。'); return; }
  const id = jobId.value, reviewedRule = canonicalPluginJson(installation.value!.rule);
  void operation(async (workspace, signal) => {
    input.expectedRuleHash = await assistantHash(reviewedRule);
    if (signal.aborted) return;
    const saved = await provider!.save(workspace, id, input, signal);
    if (signal.aborted) return;
    selectJob(saved); await load(workspace, signal);
    if (!signal.aborted) status.value = saved.enabled ? t('已授权后台执行。手动任务需点击运行，定时任务从保存时间开始计算间隔。') : t('已保存为停用状态，旧的待执行和运行中任务已停止。');
  });
}
function run(job: PluginAutomationJob) {
  void operation(async (workspace, signal) => {
    const saved = submissions(workspace), key = saved.begin(job.id, job.version); readPending(workspace);
    const accepted = await provider!.run(workspace, job.id, job.version, key, signal);
    // A confirmed response can clear only this attempt, even after the panel has closed.
    saved.clear(job.id, job.version, key);
    if (signal.aborted) return;
    historyId.value = job.id; history.value = []; reviewed.value = false;
    await load(workspace, signal);
    if (!signal.aborted) status.value = t('已确认提交：{0}。实际执行结果请查看运行记录。', [accepted.id]);
  });
}
function showHistory(job: PluginAutomationJob) {
  historyId.value = job.id; history.value = []; reviewed.value = false; deleting.value = '';
  void operation(load);
}
function cancel(job: string, runId: string) {
  void operation(async (workspace, signal) => {
    await provider!.cancel(workspace, job, runId, signal); if (signal.aborted) return;
    await load(workspace, signal); if (!signal.aborted) status.value = t('已停止后续执行；已经生成的内容和发出的第三方请求不会撤回。');
  });
}
function remove(job: PluginAutomationJob) {
  void operation(async (workspace, signal) => {
    await provider!.remove(workspace, job.id, job.version, signal); submissions(workspace).clear(job.id, job.version);
    if (signal.aborted) return;
    deleting.value = ''; await load(workspace, signal); if (!signal.aborted) status.value = t('任务与运行记录已删除，已经生成的内容保留。');
  });
}
function finishConfirmation(job: PluginAutomationJob) {
  if (!reviewed.value || !store.workspace || !store.canManagePlugins) return;
  try { submissions(store.workspace.id).clear(job.id, job.version); readPending(store.workspace.id); reviewed.value = false; }
  catch (cause) { error.value = String(cause); }
}
function webhookChanged(job: PluginAutomationJob) {
  jobs.value = jobs.value.map(item => item.id === job.id ? job : item);
  if (editor.value && jobId.value === job.id) selectJob(job);
  if (store.workspace) readPending(store.workspace.id);
  if (historyId.value === job.id) void operation(load);
}
// Any portable rule change invalidates the backend authorization, including unrelated rule edits.
watch(() => canonicalPluginJson([opened.value, store.workspace?.id ?? null, store.canManagePlugins,
  store.installedPlugins.map(item => item.rule ?? null)]), () => {
  controller.abort(); controller = new AbortController(); clearTimeout(timer);
  jobs.value = []; history.value = []; historyId.value = ''; editor.value = false; approved.value = false;
  busy.value = false; error.value = ''; status.value = ''; deleting.value = ''; pending.value = {}; reviewed.value = false;
  if (opened.value) void operation(load);
}, { immediate: true, flush: 'sync' });
onScopeDispose(() => { controller.abort(); clearTimeout(timer); });
</script>
<template>
  <details class="plugin-automations" :aria-label="t('后台自动化')" @toggle="opened = ($event.target as HTMLDetailsElement).open">
    <summary>{{ t('后台自动化') }}</summary>
    <p v-if="!provider">{{ t('当前环境没有后台任务服务。本地工作区与浏览器演示暂不支持后台自动化。') }}</p>
    <p v-else-if="!store.canManagePlugins">{{ t('后台任务由工作区所有者配置和授权。') }}</p>
    <template v-else>
      <p>{{ t('任务在在线服务中执行，关闭页面后继续运行。执行权限与服务连接属于保存授权的工作区所有者；工作区规则或插件版本变化后需要重新授权。') }}</p>
      <p v-if="error" role="alert">{{ error }}</p><p v-if="status" role="status">{{ status }}</p>
      <div class="actions"><button :disabled="busy" @click="operation(load)">{{ t('刷新后台任务') }}</button><button :disabled="busy || !plugins.length" @click="selectJob()">{{ t('新建后台任务') }}</button></div>
      <p v-if="!jobs.length && !busy">{{ t('还没有后台任务。') }}</p>
      <ul class="jobs"><li v-for="job in jobs" :key="job.id">
        <strong>{{ job.label }}</strong><span> · {{ job.needsAuthorization ? t('需要重新授权') : job.enabled ? t('已启用') : t('已停用') }}</span>
        <p>{{ job.pluginId }} · {{ job.automationId }} · {{ job.intervalMinutes ? t('每 {0} 分钟', [job.intervalMinutes]) : t('手动执行') }}<br />{{ t('下次执行：') }}{{ job.needsAuthorization ? t('等待重新授权') : date(job.nextAt) }}<br />{{ t('当前授权账号：') }}{{ job.authorizedBy }}</p>
        <div class="actions">
          <button :disabled="busy || !job.enabled || job.needsAuthorization" :aria-label="`${pending[job.id] ? t('确认上次提交') : t('运行')} ${job.label}`" @click="run(job)">{{ pending[job.id] ? t('确认上次提交') : t('运行一次') }}</button>
          <button :disabled="busy" :aria-label="t('编辑 {0}', [job.label])" @click="selectJob(job)">{{ t('编辑与授权') }}</button>
          <button :disabled="busy" :aria-label="t('查看 {0} 运行记录', [job.label])" @click="showHistory(job)">{{ t('运行记录') }}</button>
          <button :disabled="busy" :aria-label="t('删除 {0}', [job.label])" @click="deleting = job.id">{{ t('删除') }}</button>
        </div>
        <p v-if="pending[job.id]">{{ t('上次提交尚未确认。再次确认沿用同一提交标识，避免网络中断后重复入队。') }}</p>
        <div v-if="deleting === job.id" class="notice"><p>{{ t('删除任务会停止后续执行并删除运行记录，已经生成的文档会保留。') }}</p><button :disabled="busy" @click="remove(job)">{{ t('删除任务与记录') }}</button><button :disabled="busy" @click="deleting = ''">{{ t('保留任务') }}</button></div>
        <PluginAutomationWebhook :job="job" :disabled="busy" @changed="webhookChanged" />
      </li></ul>
      <form v-if="editor" @submit.prevent="save">
        <h4>{{ version ? t('编辑后台任务') : t('新建后台任务') }}</h4>
        <label>{{ t('插件') }}<select v-model="pluginId" :disabled="busy" :aria-label="t('自动化插件')" @change="choosePlugin"><option value="">{{ t('选择插件') }}</option><option v-for="plugin in plugins" :key="plugin.manifest.id" :value="plugin.manifest.id">{{ plugin.manifest.name }}</option></select></label>
        <p v-if="pluginId && !installation">{{ t('此插件已停用、移除或不再提供后台入口。请重新选择插件，或删除旧任务。') }}</p>
        <template v-if="manifest">
          <label>{{ t('自动化入口') }}<select v-model="automationId" :disabled="busy" :aria-label="t('自动化入口')" @change="chooseAutomation"><option v-for="entry in manifest.automations" :key="entry.id" :value="entry.id">{{ entry.label }}</option></select></label>
          <label>{{ t('任务名称') }}<input v-model="label" :disabled="busy" maxlength="80" required :aria-label="t('后台任务名称')" /></label>
          <label>{{ t('执行方式') }}<select v-model="schedule" :disabled="busy" :aria-label="t('自动化执行方式')"><option value="manual">{{ t('手动执行') }}</option><option value="interval">{{ t('按间隔执行') }}</option></select></label>
          <label v-if="schedule === 'interval'">{{ t('间隔（分钟）') }}<input v-model="interval" :disabled="busy" type="number" min="15" max="43200" step="1" required :aria-label="t('自动化间隔分钟')" /></label>
          <p v-if="schedule === 'interval'">{{ t('从每次保存开始计时；停机期间错过的次数不会逐次补跑。服务暂停时任务延后至恢复；部署管理员可配置外部调度唤醒。') }}</p>
          <label><input v-model="enabled" :disabled="busy" type="checkbox" />{{ t('启用此后台任务') }}</label>
          <details><summary>{{ t('任务参数') }}</summary><p>{{ t('按插件说明填写 JSON，最多 16 KiB。密钥请在「服务连接与凭据」中配置。') }}</p><textarea v-model="payload" :disabled="busy" rows="5" spellcheck="false" :aria-label="t('自动化参数 JSON')" /></details>
          <div class="notice">
            <p>{{ t('授权版本：') }}{{ manifest.version }} · <code>{{ installation?.rule?.integrity?.slice(0, 12) }}</code></p>
            <p>{{ t('后台权限：') }}{{ manifest.permissions.map(item => permissions[item]).filter(Boolean).join('、') || t('无数据或网络权限') }}</p>
            <p v-if="manifest.networkOrigins.length">{{ t('网络来源：') }}{{ manifest.networkOrigins.join('、') }}</p>
            <details><summary>{{ t('核对共享设置与代码摘要') }}</summary><pre>{{ format(installation?.rule?.settings) }}</pre><code>{{ installation?.rule?.integrity }}</code></details>
            <p>{{ t('保存后由当前账号授权执行；已有任务的待执行和运行中调用会停止。授权后台执行与设备上的插件授权分别管理。') }}</p>
            <label><input v-model="approved" :disabled="busy" type="checkbox" />{{ t('我已核对版本与权限，授权按以上设置执行') }}</label>
          </div>
          <div class="actions"><button type="submit" :disabled="busy || !canSave">{{ t('保存并授权后台任务') }}</button><button type="button" :disabled="busy" @click="editor = false; approved = false">{{ t('关闭编辑') }}</button></div>
        </template>
      </form>
      <section v-if="historyId" class="history" :aria-label="t('自动化运行记录')">
        <h4>{{ jobs.find(job => job.id === historyId)?.label }} {{ t('· 最近运行') }}</h4>
        <p>{{ t('停止不会撤回已完成的写入。结果不确定时先核对文档和第三方服务，系统不会自动重跑。') }}</p>
        <template v-for="job in jobs.filter(item => item.id === historyId && pending[item.id])" :key="job.id">
          <label><input v-model="reviewed" type="checkbox" :disabled="busy" />{{ t('我已核对运行记录，结束此次提交确认；之后点击运行将创建新执行') }}</label>
          <button :disabled="busy || !reviewed" @click="finishConfirmation(job)">{{ t('结束本次提交确认') }}</button>
        </template>
        <p v-if="!history.length && !busy">{{ t('暂无运行记录。') }}</p>
        <ol><li v-for="run in history" :key="run.id">
          <strong>{{ statuses[run.status] }}</strong> · {{ { manual: t('手动'), schedule: t('定时'), webhook: 'Webhook' }[run.trigger] }} · {{ date(run.createdAt) }}
          <button v-if="run.status === 'queued' || run.status === 'running'" :disabled="busy" :aria-label="t('停止执行 {0}', [run.id])" @click="cancel(historyId, run.id)">{{ t('停止执行') }}</button>
          <details><summary>{{ t('执行详情') }}</summary><p>{{ t('执行标识：') }}{{ run.id }}<br />{{ t('开始：') }}{{ date(run.startedAt) }} {{ t('· 结束：') }}{{ date(run.finishedAt) }}</p><p v-if="run.errorCode">{{ t('错误代码：') }}{{ run.errorCode }}</p><pre v-if="run.result !== null">{{ format(run.result) }}</pre></details>
        </li></ol>
      </section>
      <p v-if="!plugins.length">{{ t('当前没有提供后台入口的插件。安装带有自动化入口的插件后，可在这里配置任务。') }}</p>
    </template>
  </details>
</template>
<style scoped>
.plugin-automations { border-top: 1px solid var(--line); margin-top: 20px; padding-top: 12px; font-size: 12px; scroll-margin-top: 180px; }
summary { cursor: pointer; padding: 8px 0; font-weight: 600; }
p, li { color: var(--muted); overflow-wrap: anywhere; line-height: 1.6; }
strong, h4 { color: var(--text); }
.jobs { list-style: none; padding: 0; display: grid; gap: 12px; }
.jobs > li, form, .history { border: 1px solid var(--line); border-radius: 8px; padding: 14px; margin: 12px 0; }
form { display: grid; gap: 12px; max-width: 620px; }
label { display: flex; align-items: center; gap: 10px; }
input:not([type=checkbox]), select, textarea { flex: 1; min-width: 0; padding: 7px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--text); font: inherit; }
textarea { width: 100%; box-sizing: border-box; } code, pre { overflow-wrap: anywhere; white-space: pre-wrap; font-size: 11px; } pre { max-height: 220px; overflow: auto; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
button { padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px; color: var(--text); background: var(--surface); font: inherit; cursor: pointer; }
button:disabled { opacity: .5; cursor: default; }
.notice { padding: 12px; background: var(--surface); border: 1px solid var(--line); border-radius: 6px; }
.history li { border-bottom: 1px solid var(--line); padding: 10px 0; }
[role=alert] { color: var(--danger); }
</style>
