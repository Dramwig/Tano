<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue';
import { Bot } from 'lucide-vue-next';
import { agentInboxKey, type useAgentInboxController } from '../assistant/agent-controller';
import { useWorkspaceStore } from '../stores/workspace';
import { t } from '../i18n';
import type { AssistantSession } from '@tano/protocol';

const inbox = inject<ReturnType<typeof useAgentInboxController> | undefined>(agentInboxKey, undefined);
const workspace = useWorkspaceStore();
const error = ref('');
const execution = ref<AssistantSession>();
watch(() => workspace.workspace?.id, () => { execution.value = undefined; error.value = ''; });
const tasks = computed(() => [...inbox?.tasks.value ?? []].reverse());
const names = computed(() => new Map(workspace.objects.map(item => [item.object.id, item.object.name])));
const status = { queued: '排队中', running: '执行中', waiting: '等待回复', succeeded: '已完成', failed: '执行失败', cancelled: '已取消', uncertain: '结果待核对' };
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
  <details v-if="inbox?.bindings.value.length" class="agent-inbox">
    <summary><Bot :size="15" />{{ t('机器人收件箱') }} <span>{{ tasks.filter(task => ['queued', 'running', 'waiting'].includes(task.status)).length }}</span></summary>
    <p>{{ t('正文、批注和评论中的 @ 会自动成为任务，同一机器人按顺序处理。') }}</p>
    <p v-if="error || inbox.error.value" role="alert">{{ error || inbox.error.value }}</p>
    <details><summary>{{ t('机器人设置') }}</summary>
      <form v-for="binding in inbox.bindings.value" :key="binding.personId" @submit.prevent="configure(binding.personId, $event)">
        <strong>{{ names.get(binding.personId) ?? binding.personId }}</strong>
        <label>{{ t('自动处理') }}<input name="enabled" type="checkbox" :checked="binding.enabled" /></label>
        <label>{{ t('模型') }}<input name="model" :value="binding.model" :placeholder="t('请选择后台模型')" maxlength="200" required /></label>
        <button type="submit">{{ t('保存') }}</button>
      </form>
    </details>
    <ol>
      <li v-for="task in tasks" :key="task.id">
        <header><strong>{{ names.get(task.binding.personId) ?? task.binding.personId }}</strong><span>{{ t(status[task.status]) }}</span></header>
        <p>{{ task.continuation?.body ?? task.event.body }}</p>
        <p v-if="task.error">{{ task.error }}</p>
        <p v-if="!task.binding.model">{{ t('等待配置后台模型') }}</p>
        <button type="button" @click="openDocument(task.event.source.fileId)">{{ t('查看原文') }}</button>
        <button type="button" @click="showExecution(task.id)">{{ t('执行记录') }}</button>
        <button v-if="['queued', 'running', 'waiting'].includes(task.status)" type="button" @click="cancel(task.id)">{{ t('取消任务') }}</button>
        <button v-if="task.status === 'failed' || task.status === 'uncertain' && task.result" type="button" @click="retry(task.id)">{{ task.result ? t('补发回复') : t('重试任务') }}</button>
      </li>
    </ol>
    <section v-if="execution" class="agent-execution" :aria-label="t('执行记录')">
      <header><strong>{{ execution.title }}</strong><button type="button" @click="execution = undefined">{{ t('关闭') }}</button></header>
      <article v-for="message in execution.messages" :key="message.id">
        <strong>{{ message.role === 'user' ? t('请求') : t('机器人') }}</strong>
        <p>{{ message.content }}</p>
        <p v-for="result, index in message.toolResults" :key="index">{{ result.name }} · {{ result.status }} {{ result.error }}</p>
        <details v-for="proposal in message.proposals" :key="proposal.id">
          <summary>{{ proposal.path }} · {{ proposal.status }}</summary><p>{{ proposal.reason }}</p><pre>{{ proposal.content }}</pre>
          <p v-if="proposal.error">{{ proposal.error }}</p>
        </details>
      </article>
    </section>
  </details>
</template>

<style scoped>
.agent-inbox { margin: 0 0 16px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; font-size: 12px; }
summary { cursor: pointer; }
.agent-inbox > summary { display: flex; align-items: center; gap: 6px; }
p { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--muted); }
ol { list-style: none; padding: 0; max-height: 320px; overflow: auto; }
li { padding: 10px 0; border-top: 1px solid var(--line); }
header { display: flex; justify-content: space-between; gap: 8px; }
form { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-block: 10px; }
label { display: flex; align-items: center; gap: 5px; }
input[name=model] { width: 130px; }
button { margin-right: 8px; }
.agent-execution { max-height: 420px; overflow: auto; border-top: 1px solid var(--line); padding-top: 10px; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
