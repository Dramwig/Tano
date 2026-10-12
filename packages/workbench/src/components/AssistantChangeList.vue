<script setup lang="ts">
import { computed, ref } from 'vue';
import { Check, ChevronRight, FileText, Pencil, Search, Undo2, X } from 'lucide-vue-next';
import type { AssistantProposal, ReferenceIdentity } from '@tano/protocol';
import { isDataTableFilePath } from '@tano/protocol';
import ChangeDiff from './ChangeDiff.vue';
import TaskProposalPreview from './TaskProposalPreview.vue';

const props = defineProps<{ proposals: AssistantProposal[]; busy: boolean }>();
const emit = defineEmits<{
  review: [proposal: AssistantProposal, apply?: boolean]; reject: [proposal: AssistantProposal];
  verify: [proposal: AssistantProposal]; undo: [proposal: AssistantProposal];
  suggestions: [proposal: AssistantProposal]; openReference: [identity: ReferenceIdentity];
}>();
const checks = ref<Record<string, boolean>>({});
const expanded = ref<Record<string, boolean>>({});
const statuses = { ready: '', applying: '正在应用', applied: '', rejected: '已放弃', conflicted: '存在冲突', unknown: '结果待核对' };
const labels = { create: '新增', edit: '修改', delete: '删除', rename: '重命名', move: '移动', object: '任务', relation: '关系' };
const isFile = (proposal: AssistantProposal) => !['object', 'relation'].includes(proposal.kind);
const canUndo = (proposal: AssistantProposal) => proposal.status === 'applied' &&
  (proposal.kind === 'edit' || proposal.kind === 'create' && !isDataTableFilePath(proposal.path));
const groups = computed(() => {
  const result = new Map<string, { key: string; file: boolean; proposals: AssistantProposal[] }>();
  for (const proposal of props.proposals) {
    const file = isFile(proposal);
    const key = file ? `file:${proposal.fileId ?? proposal.applied?.fileId ?? proposal.path}` : `${proposal.kind}:${proposal.fileId ?? proposal.path}`;
    if (!result.has(key)) result.set(key, { key, file, proposals: [] });
    result.get(key)!.proposals.push(proposal);
  }
  return [...result.values()];
});
const fileCount = computed(() => groups.value.filter(group => group.file).length);
const groupLabel = (proposals: AssistantProposal[]) => [...new Set(proposals.map(proposal => labels[proposal.kind]))].join('、');
const proposalStatus = (proposal: AssistantProposal) => proposal.suggestionGroupId ? '文档中审阅' : proposal.execution === 'direct' && proposal.status === 'ready' ? '未完成' : statuses[proposal.status];
const groupStatus = (proposals: AssistantProposal[]) => [...new Set(proposals.map(proposalStatus).filter(Boolean))].join(' · ');
</script>

<template>
  <section v-if="proposals.length" class="assistant-change-list" aria-label="本轮文件变更清单">
    <header>
      <div class="change-list-heading">
        <strong>{{ fileCount ? '文件变更' : '工作区变更' }}</strong><span>{{ fileCount }} 个文件 · {{ proposals.length }} 项操作</span>
      </div>
    </header>
    <details v-for="group in groups" :key="group.key" class="assistant-file-change" @toggle="expanded[group.key] = ($event.target as HTMLDetailsElement).open">
      <summary>
        <ChevronRight class="change-chevron" :size="14" /><FileText :size="14" />
        <span class="change-file-heading">
          <span class="change-file-name">{{ group.proposals[0].preview?.path ?? group.proposals[0].path }}<span v-if="group.proposals.some(proposal => proposal.destination)" class="change-destination">→ {{ group.proposals.filter(proposal => proposal.destination).at(-1)?.destination }}</span></span>
          <span class="change-kind" :class="`change-kind-${group.proposals[0].kind}`">{{ groupLabel(group.proposals) }}</span>
          <small v-if="groupStatus(group.proposals)" class="change-file-status">{{ groupStatus(group.proposals) }}</small>
        </span>
        <button v-if="group.proposals.length === 1 && canUndo(group.proposals[0])" class="change-undo-action" :disabled="busy" @click.stop.prevent="emit('undo', group.proposals[0])"><Undo2 :size="14" />撤回内容</button>
      </summary>
      <div v-if="expanded[group.key]" class="change-file-details">
        <section v-for="proposal in group.proposals" :key="proposal.id" class="assistant-proposal" :aria-label="`修改建议 ${proposal.path}`">
          <div class="assistant-proposal-heading">
            <strong>{{ labels[proposal.kind] }} · {{ proposal.preview?.path ?? proposal.path }}</strong><small v-if="group.proposals.length > 1 && proposalStatus(proposal)">{{ proposalStatus(proposal) }}</small>
            <button v-if="group.proposals.length > 1 && canUndo(proposal)" class="change-undo-action" :disabled="busy" @click="emit('undo', proposal)"><Undo2 :size="14" />撤回内容</button>
          </div>
          <p v-if="proposal.destination" class="proposal-path">{{ proposal.preview?.path ?? proposal.path }} → {{ proposal.destination }}</p>
          <p>{{ proposal.reason }}</p>
          <p v-if="proposal.kind === 'delete'" class="delete-note">{{ proposal.status === 'applied' ? '文件已删除。' : '将删除此文件。' }}桌面文件可从回收站恢复；浏览器演示存储会直接删除。</p>
          <TaskProposalPreview v-if="!group.file" :proposal="proposal" @open-reference="emit('openReference', $event)" @ready="checks[proposal.id] = $event" />
          <p v-if="proposal.error" class="assistant-message-error" role="alert">{{ proposal.error }}</p>
          <p v-if="['rename', 'move'].includes(proposal.kind)" class="panel-hint">文件内容保持不变。</p>
          <ChangeDiff v-else :before="proposal.applied?.before ?? proposal.preview?.before ?? proposal.base" :after="proposal.applied?.after ?? proposal.preview?.after ?? proposal.content"
            :before-label="proposal.kind === 'create' ? '尚未创建' : '修改前'" :after-label="proposal.kind === 'delete' ? '文件删除' : '修改后'" />
          <div v-if="['ready', 'conflicted', 'unknown'].includes(proposal.status)" class="assistant-proposal-actions">
            <button v-if="proposal.kind === 'edit' && !isDataTableFilePath(proposal.path) && ['ready', 'conflicted'].includes(proposal.status)" class="secondary-button" :disabled="busy" @click="emit('suggestions', proposal)"><Pencil :size="14" />{{ proposal.suggestionGroupId ? '打开文档建议' : '在文档中逐项审阅' }}</button>
            <template v-if="!proposal.suggestionGroupId && ['ready', 'conflicted'].includes(proposal.status)">
              <button class="secondary-button" :disabled="busy" @click="emit('review', proposal)"><Search :size="14" />查看差异</button>
              <button v-if="proposal.preview && proposal.status === 'ready'" class="primary-button" :class="{ destructive: proposal.kind === 'delete' }" :disabled="busy || checks[proposal.id] === false" @click="emit('review', proposal, true)"><Check :size="14" />{{ proposal.kind === 'delete' ? '删除文件' : proposal.kind === 'rename' ? '应用重命名' : proposal.kind === 'move' ? '应用移动' : '应用修改' }}</button>
              <button class="icon-button" title="放弃建议" aria-label="放弃修改建议" :disabled="busy" @click="emit('reject', proposal)"><X :size="15" /></button>
            </template>
            <button v-if="proposal.status === 'unknown'" class="secondary-button" :disabled="busy" @click="emit('verify', proposal)"><Search :size="14" />核对写入结果</button>
          </div>
        </section>
      </div>
    </details>
  </section>
</template>

<style scoped>
.assistant-change-list { margin-top: 14px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); overflow: hidden; font-size: 12px; }
.assistant-change-list > header { display: flex; align-items: flex-start; gap: 12px; padding: 12px; }
.change-list-heading { display: flex; flex: 1; flex-wrap: wrap; align-items: baseline; gap: 6px 12px; min-width: 0; }
.change-list-heading > span, .change-file-status { color: var(--muted); font-size: 11px; }
.change-undo-action { display: inline-flex; flex-shrink: 0; align-items: center; gap: 5px; margin-left: auto; border: 0; padding: 0; color: var(--text-secondary); background: transparent; font-size: 11px; line-height: 18px; }
.change-undo-action:hover:not(:disabled) { color: var(--green); }
.assistant-file-change { border-top: 1px solid var(--line); }
summary { display: flex; gap: 7px; align-items: center; padding: 11px 12px; cursor: pointer; list-style: none; }
summary::-webkit-details-marker { display: none; }
summary:hover { background: var(--accent); }
summary:focus-visible { outline: 2px solid var(--green); outline-offset: -2px; }
summary > svg { flex-shrink: 0; color: var(--muted); }
details[open] .change-chevron { transform: rotate(90deg); }
.change-file-heading { display: flex; flex: 1; flex-wrap: wrap; align-items: center; gap: 4px 7px; min-width: 0; }
.change-file-name { min-width: 0; max-width: 100%; overflow-wrap: anywhere; }
.change-destination { display: block; color: var(--muted); font-size: 11px; margin-top: 3px; }
.change-kind { font-size: 10px; border-radius: 4px; padding: 2px 5px; background: var(--accent); color: var(--muted); }
.change-kind-create { color: var(--green); }
.change-kind-delete, .delete-note, .assistant-message-error { color: var(--danger); }
.change-file-details { padding: 0 12px 12px; }
.assistant-proposal + .assistant-proposal { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); }
.assistant-proposal-heading { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; }
.assistant-proposal-heading strong { min-width: 0; overflow-wrap: anywhere; }
.assistant-proposal-heading small { color: var(--muted); }
.assistant-proposal > p { line-height: 1.6; margin: 8px 0; overflow-wrap: anywhere; }
.assistant-proposal :deep(.diff-lines) { max-height: min(240px, 60vh); }
.assistant-proposal :deep(.diff-line) { font-size: 10px; }
.assistant-proposal-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.assistant-proposal-actions button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 30px; padding: 5px 8px; font-size: 11px; line-height: 16px; }
.assistant-proposal-actions .icon-button { padding: 0; }
</style>
