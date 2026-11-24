<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue';
import { Bot, FileText, RotateCcw, ScrollText, Settings2, X } from 'lucide-vue-next';
import { agentInboxKey, type useAgentInboxController } from '../agent-controller';
import { useWorkspaceStore } from '../../stores/workspace';
import { t } from '../../i18n/i18n';
import type { AssistantSession } from '@tano/protocol';

const inbox = inject<ReturnType<typeof useAgentInboxController> | undefined>(agentInboxKey, undefined);
const workspace = useWorkspaceStore();
const error = ref('');
const execution = ref<AssistantSession>();
const settingsOpen = ref(false);
watch(() => workspace.workspace?.id, () => { execution.value = undefined; error.value = ''; });
const tasks = computed(() => [...inbox?.tasks.value ?? []].reverse());
const names = computed(() => new Map(workspace.objects.map(item => [item.object.id, item.object.name])));
const status = { queued: '排队中', running: '执行中', waiting: '等待回复', succeeded: '已完成', failed: '执行失败', cancelled: '已取消', uncertain: '结果待核对' };
const isActive = (value: string) => ['queued', 'running', 'waiting'].includes(value);
async function configure(personId: string, event: Event) {
  const form = (event.target as HTMLElement).closest('form')!;
  try {
    await inbox!.configure(personId, (form.elements.namedItem('model') as HTMLInputElement).value,
      (form.elements.namedItem('enabled') as HTMLInputElement).checked);
    error.value = '';
  } catch (reason) { error.value = String(reason); }
}
async function cancel(id: string) {
  try { await inbox!.cancelTask(id); } catch (reason) { error.value = String(reason); }
}
async function openDocument(fileId: string) {
  const file = workspace.workspace?.files.find(file => file.id === fileId);
  if (!file) { error.value = t('原文档已移除'); return; }
  try { await workspace.openFile(file); } catch (reason) { error.value = String(reason); }
}
async function showExecution(taskId: string) {
  try {
    execution.value = await inbox!.session(taskId);
    error.value = execution.value ? '' : t('任务尚未开始执行');
  } catch (reason) { error.value = String(reason); }
}
async function retry(taskId: string) {
  try { await inbox!.retryTask(taskId); error.value = ''; } catch (reason) { error.value = String(reason); }
}
</script>

<template>
  <div v-if="inbox?.bindings.value.length" class="agent-inbox panel-scrollbar">
    <div class="agent-inbox-intro">
      <p>{{ t('正文、批注和评论中的 @ 会自动成为任务，同一机器人按顺序处理。') }}</p>
      <button type="button" class="icon-button" :class="{ selected: settingsOpen }" :data-tooltip="t('机器人设置')" :aria-label="t('机器人设置')" :aria-expanded="settingsOpen" @click="settingsOpen = !settingsOpen"><Settings2 :size="16" /></button>
    </div>
    <p v-if="error || inbox.error.value" class="agent-inbox-error" role="alert">{{ error || inbox.error.value }}</p>

    <section v-if="settingsOpen" class="agent-settings" :aria-label="t('机器人设置')">
      <form v-for="binding in inbox.bindings.value" :key="binding.personId" @submit.prevent="configure(binding.personId, $event)">
        <div class="agent-settings-head">
          <strong>{{ names.get(binding.personId) ?? binding.personId }}</strong>
          <label class="agent-switch"><span>{{ t('自动处理') }}</span><input name="enabled" type="checkbox" role="switch" :checked="binding.enabled" /></label>
        </div>
        <div class="agent-settings-row">
          <input name="model" :value="binding.model" :aria-label="t('模型')" :placeholder="t('请选择后台模型')" maxlength="200" required />
          <button type="submit" class="secondary-button">{{ t('保存') }}</button>
        </div>
      </form>
    </section>

    <p v-if="!tasks.length" class="agent-inbox-empty"><Bot :size="22" :stroke-width="1.5" />{{ t('暂无机器人任务') }}</p>
    <ol v-else class="agent-task-list">
      <li v-for="task in tasks" :key="task.id" class="agent-task" :data-status="task.status">
        <header>
          <strong>{{ names.get(task.binding.personId) ?? task.binding.personId }}</strong>
          <span class="agent-status"><i aria-hidden="true" />{{ t(status[task.status]) }}</span>
        </header>
        <p class="agent-task-body">{{ task.continuation?.body ?? task.event.body }}</p>
        <p v-if="task.error" class="agent-task-error">{{ task.error }}</p>
        <p v-if="!task.binding.model" class="agent-task-hint">{{ t('等待配置后台模型') }}</p>
        <div class="agent-task-actions">
          <button type="button" class="icon-button" :data-tooltip="t('查看原文')" :aria-label="t('查看原文')" @click="openDocument(task.event.source.fileId)"><FileText :size="15" /></button>
          <button type="button" class="icon-button" :class="{ selected: execution?.id === task.sessionId }" :data-tooltip="t('执行记录')" :aria-label="t('执行记录')" @click="showExecution(task.id)"><ScrollText :size="15" /></button>
          <button v-if="task.status === 'failed' || task.status === 'uncertain' && task.result" type="button" class="icon-button" :data-tooltip="task.result ? t('补发回复') : t('重试任务')" :aria-label="task.result ? t('补发回复') : t('重试任务')" @click="retry(task.id)"><RotateCcw :size="15" /></button>
          <button v-if="isActive(task.status)" type="button" class="icon-button" :data-tooltip="t('取消任务')" :aria-label="t('取消任务')" @click="cancel(task.id)"><X :size="15" /></button>
        </div>
      </li>
    </ol>

    <section v-if="execution" class="agent-execution" :aria-label="t('执行记录')">
      <header><strong>{{ execution.title }}</strong><button type="button" class="icon-button" :data-tooltip="t('关闭')" :aria-label="t('关闭')" @click="execution = undefined"><X :size="15" /></button></header>
      <article v-for="message in execution.messages" :key="message.id">
        <small>{{ message.role === 'user' ? t('请求') : t('机器人') }}</small>
        <p>{{ message.content }}</p>
        <p v-for="result, index in message.toolResults" :key="index" class="agent-task-hint">{{ result.name }} · {{ result.status }} {{ result.error }}</p>
        <details v-for="proposal in message.proposals" :key="proposal.id">
          <summary>{{ proposal.path }} · {{ proposal.status }}</summary><p>{{ proposal.reason }}</p><pre>{{ proposal.content }}</pre>
          <p v-if="proposal.error" class="agent-task-error">{{ proposal.error }}</p>
        </details>
      </article>
    </section>
  </div>
</template>

<style scoped>
.agent-inbox { flex: 1; min-height: 0; overflow: auto; padding: 4px 16px 20px; font-size: 12px; line-height: 1.55; color: var(--text); }
p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.agent-inbox-intro { display: flex; align-items: flex-start; gap: 8px; padding-bottom: 10px; }
.agent-inbox-intro p { flex: 1; color: var(--muted); }
.agent-inbox-intro .icon-button, .agent-task-actions .icon-button, .agent-execution > header .icon-button { flex: 0 0 26px; width: 26px; height: 26px; border-radius: 6px; color: var(--text-secondary); }
.icon-button.selected { background: var(--surface); color: var(--text); }
.agent-inbox-error { margin-bottom: 10px; padding: 8px 10px; border-radius: 8px; color: var(--danger); background: var(--danger-bg); }

.agent-settings { display: grid; gap: 10px; margin-bottom: 12px; padding: 10px 12px; border-radius: 10px; background: var(--surface); }
.agent-settings form { display: grid; gap: 8px; }
.agent-settings form + form { padding-top: 10px; border-top: 1px solid var(--line); }
.agent-settings-head, .agent-settings-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.agent-settings-row input { flex: 1; min-width: 0; }
.agent-switch { display: inline-flex; align-items: center; gap: 6px; color: var(--text-secondary); cursor: pointer; }

.agent-inbox-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 48px 12px; color: var(--muted); text-align: center; }

.agent-task-list { margin: 0; padding: 0; list-style: none; }
.agent-task { padding: 12px 0; border-top: 1px solid var(--line); }
.agent-task:first-child { border-top: 0; padding-top: 4px; }
.agent-task > header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.agent-task > header strong { font-size: 13px; font-weight: 500; }
.agent-status { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); font-size: 11px; }
.agent-status i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: .5; }
.agent-task[data-status='running'] .agent-status, .agent-task[data-status='queued'] .agent-status, .agent-task[data-status='waiting'] .agent-status { color: var(--text); }
.agent-task[data-status='running'] .agent-status i { opacity: 1; animation: agent-pulse 1.4s ease-in-out infinite; }
.agent-task[data-status='queued'] .agent-status i, .agent-task[data-status='waiting'] .agent-status i { opacity: 1; }
.agent-task[data-status='failed'] .agent-status, .agent-task[data-status='uncertain'] .agent-status { color: var(--danger); }
.agent-task[data-status='failed'] .agent-status i, .agent-task[data-status='uncertain'] .agent-status i { opacity: 1; }
@keyframes agent-pulse { 50% { opacity: .25; } }
@media (prefers-reduced-motion: reduce) { .agent-task[data-status='running'] .agent-status i { animation: none; } }
.agent-task-body { margin-top: 4px; color: var(--text-secondary); display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.agent-task-error { margin-top: 4px; color: var(--danger); }
.agent-task-hint { margin-top: 4px; color: var(--muted); }
.agent-task-actions { display: flex; gap: 2px; margin: 6px 0 0 -6px; }

.agent-execution { margin-top: 8px; padding-top: 12px; border-top: 1px solid var(--line); }
.agent-execution > header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.agent-execution > header strong { font-size: 13px; font-weight: 500; }
.agent-execution article { padding: 8px 0; }
.agent-execution article small { color: var(--muted); font-size: 11px; }
.agent-execution summary { cursor: pointer; color: var(--text-secondary); }
pre { margin: 6px 0 0; padding: 8px 10px; border-radius: 8px; background: var(--surface); white-space: pre-wrap; overflow-wrap: anywhere; font-size: 11px; }
</style>
