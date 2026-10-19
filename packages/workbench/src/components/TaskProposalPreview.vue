<script setup lang="ts">
import { t } from '../i18n';
import { computed, ref, watch } from 'vue';
import { ArrowRight, ExternalLink } from 'lucide-vue-next';
import { parseObject } from '@tano/protocol';
import type { AssistantProposal, ReferenceIdentity } from '@tano/protocol';
import { useWorkspaceStore } from '../stores/workspace';
import { isTaskTarget, possibleDuplicateTasks, taskCompleted } from '../assistant/tasks';
import { readPlanDate } from '../plan-date';

const props = defineProps<{ proposal: AssistantProposal }>();
const emit = defineEmits<{ openReference: [identity: ReferenceIdentity]; ready: [value: boolean] }>();
const workspace = useWorkspaceStore();
const confirmed = ref(false);
const data = computed(() => {
  if (props.proposal.kind !== 'object') return;
  try {
    const after = parseObject(props.proposal.preview?.after ?? props.proposal.content);
    if (!isTaskTarget({ ...after, workspace: '', path: '' })) return;
    const before = props.proposal.preview?.before ?? props.proposal.base;
    return { before: before ? parseObject(before) : null, after };
  } catch { return; }
});
const duplicates = computed(() => data.value && !props.proposal.base && props.proposal.status !== 'applied'
  ? possibleDuplicateTasks(workspace.referenceTargets, data.value.after.name, data.value.after.id) : []);
watch(() => JSON.stringify([duplicates.value.map(target => [target.id, target.name]), props.proposal.preview]), () => { confirmed.value = false; });
watch([duplicates, confirmed], () => emit('ready', !duplicates.value.length || confirmed.value), { immediate: true });
function planned(properties: Record<string, unknown>) {
  const value = readPlanDate(properties);
  return value.date ? `${value.date}${value.time ? ` ${value.time}` : ''}${value.end ? t(' 至 {0}', [value.end]) : ''}` : t('未安排');
}
const fields = computed(() => {
  if (!data.value) return [];
  const { before, after } = data.value;
  const status = (object: typeof after) => taskCompleted({ ...object, workspace: '', path: '' }) ? t('已完成') : t('待处理');
  const values = [
    [t('名称'), before?.name ?? t('未创建'), after.name],
    [t('计划日期'), before ? planned(before.properties) : t('未安排'), planned(after.properties)],
    [t('截止日期'), String(before?.properties.due ?? t('未设置')), String(after.properties.due ?? t('未设置'))],
    [t('状态'), before ? status(before) : t('未创建'), status(after)],
  ];
  return values.filter(([, old, next]) => !before || old !== next).map(([label, old, next]) => ({ label, old, next }));
});
</script>

<template>
  <div v-if="data" class="task-proposal-preview">
    <div class="task-proposal-title"><strong>{{ proposal.base ? t('更新已有任务') : duplicates.length ? t('可能重复的新增任务') : t('新增任务') }}</strong><button v-if="proposal.base" type="button" :data-tooltip="t('打开原任务')" @click="emit('openReference', data.after)"><ExternalLink :size="13" />{{ t('原任务') }}</button></div>
    <dl><template v-for="field in fields" :key="field.label"><dt>{{ field.label }}</dt><dd><span>{{ field.old }}</span><ArrowRight :size="13" /><strong>{{ field.next }}</strong></dd></template></dl>
    <div v-if="duplicates.length" class="task-duplicates" role="status"><p>{{ t('可能重复') }}</p><button v-for="task in duplicates" :key="task.id" type="button" @click="emit('openReference', task)"><ExternalLink :size="13" />{{ task.name }} · {{ taskCompleted(task) ? t('已完成') : t('未完成') }}</button><label v-if="proposal.preview && proposal.status === 'ready'"><input v-model="confirmed" type="checkbox" />{{ t('仍然创建新任务') }}</label></div>
  </div>
</template>

<style scoped>
.task-proposal-preview { margin: 10px 0; padding: 10px 0; border-block: 1px solid var(--line); font-size: 12px; }
.task-proposal-title { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
button { display: inline-flex; align-items: center; gap: 5px; color: var(--green); text-align: left; overflow-wrap: anywhere; }
dl { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 8px 10px; margin: 12px 0 0; }
dt { color: var(--muted); }
dd { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; margin: 0; overflow-wrap: anywhere; }
dd span { color: var(--muted); }
dd svg { flex-shrink: 0; }
.task-duplicates { display: grid; gap: 7px; margin-top: 12px; }
.task-duplicates p { margin: 0; color: var(--warning); }
.task-duplicates label { display: flex; align-items: center; gap: 6px; }
</style>
