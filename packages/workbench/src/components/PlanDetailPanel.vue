<script setup lang="ts">
import { t } from '../i18n';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue';
import { Archive, CalendarDays, Check, Circle, CircleCheck, Copy, Flag, ListTodo, LoaderCircle, RotateCcw, Save, X } from 'lucide-vue-next';
import type { ReferenceIdentity, ReferenceTarget, WorkspaceObject } from '@tano/protocol';
import { resolveWorkspaceReference, taskReview } from '@tano/protocol';
import type { ObjectRecord } from '../workspace-objects';
import { isCheckableEvent, isEventCompleted } from '../calendar';
import { readPlanDate, writePlanDate } from '../plan-date';
import type { PlanDateValue } from '../plan-date';
import { usePlanStore } from '../stores/plans';
import { useWorkspaceStore } from '../stores/workspace';
import { openExternalUrl } from '../attachments';
import { resolveWikiLink } from '../wiki-links';
import DescriptionEditor from './DescriptionEditor.vue';
import PlanDateField from './PlanDateField.vue';
import ReferenceConnections from './ReferenceConnections.vue';
import TaskRepeatControls from './TaskRepeatControls.vue';
import { useWorkbenchRuntime } from '../runtime';
import { planDocumentSource } from '../selection-todo';

const props = defineProps<{ record: ObjectRecord }>();
const emit = defineEmits<{ close: []; openReference: [identity: ReferenceIdentity]; openRecord: [record: ObjectRecord] }>();
const store = useWorkspaceStore();
const plans = usePlanStore();
const objectDetails = useWorkbenchRuntime().extensions?.().objectDetails;
const personal = props.record.source?.scope === 'personal';
const scopeId = props.record.source?.id ?? store.workspace?.id;
const workspacePath = store.workspace?.path;
const panel = ref<HTMLElement>();
const nameId = useId();
const nameField = ref<HTMLTextAreaElement>();
let nameResize: ResizeObserver | undefined;
const dueId = useId();
const base = shallowRef(props.record);
const draft = ref<WorkspaceObject>(clone(props.record.object));
const busy = ref(false);
const error = ref('');
const saveFailed = ref(false);
type Navigation = { kind: 'close' } | { kind: 'reference'; identity: ReferenceIdentity };
const pending = shallowRef<Navigation>();
const previousFocus = document.activeElement as HTMLElement | null;
function clone(value: WorkspaceObject): WorkspaceObject { return JSON.parse(JSON.stringify(value)); }
const inScope = computed(() => personal ? plans.personalId === scopeId
  : !!store.workspace && store.workspace.id === scopeId && store.workspace.path === workspacePath);
const latest = computed(() => {
  if (!inScope.value) return;
  const matches = (personal ? plans.personal : store.objects)
    .filter(record => record.object.id === base.value.object.id && record.object.type === base.value.object.type);
  return matches.length === 1 ? matches[0] : undefined;
});
const disabled = computed(() => busy.value || !latest.value || !plans.canEdit(latest.value));
const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(base.value.object));
const checkable = computed(() => isCheckableEvent({ ...base.value, object: draft.value }));
const completed = computed(() => isEventCompleted({ ...base.value, object: draft.value }));
const completionLocked = computed(() => { const review = taskReview(draft.value); return !!review && review.state !== 'approved'; });
const title = computed(() => checkable.value ? t('任务详情') : t('事件详情'));
const planDate = computed(() => readPlanDate(draft.value.properties));
const canCopy = computed(() => !busy.value && inScope.value && (personal ? plans.personalWritable : plans.workspaceWritable));
const changedExternally = computed(() => latest.value && latest.value.snapshot.hash !== base.value.snapshot.hash);
const targets = computed(() => personal ? [] : store.referenceTargets.filter(target =>
  target.type !== 'document' || !target.path.startsWith('.tano/')));
const personalTargets = computed<ReferenceTarget[] | undefined>(() => personal ? plans.personal.map(({ object, path }) => ({
  workspace: scopeId!, type: object.type, id: object.id, name: object.name, path,
  description: object.description, archived: object.archived,
})) : undefined);
const previewTargets = computed(() => personal ? personalTargets.value ?? [] : targets.value);
const documentSource = computed(() => {
  const source = planDocumentSource(draft.value.properties.documentSource);
  return !personal && source?.workspaceId === scopeId ? source : undefined;
});
async function resizeName() {
  await nextTick();
  if (!nameField.value) return;
  nameField.value.style.height = 'auto';
  nameField.value.style.height = `${Math.min(136, Math.max(38, nameField.value.scrollHeight))}px`;
}
function updateName(event: Event) {
  if (disabled.value) return;
  draft.value.name = (event.target as HTMLTextAreaElement).value.replace(/[\r\n]+/g, ' ');
}
function nameKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.isComposing) event.preventDefault();
}
watch(() => draft.value.name, resizeName);

function accept(record: ObjectRecord) {
  base.value = { ...record, source: base.value.source };
  draft.value = clone(record.object);
  error.value = ''; saveFailed.value = false;
}
watch(() => latest.value?.snapshot.hash, () => {
  if (latest.value && !busy.value && !dirty.value) accept(latest.value);
});
function setCompleted(value: boolean) {
  if (disabled.value) return;
  draft.value.properties.completed = value;
  if (draft.value.type === 'task') draft.value.properties.status = value ? 'done' : 'todo';
}
function setCheckable(value: boolean) {
  if (disabled.value || draft.value.type === 'task') return;
  draft.value.properties.checkable = value;
  if (!value) draft.value.properties.completed = false;
}
function updatePlanDate(value: PlanDateValue) {
  if (disabled.value) return;
  try { draft.value.properties = writePlanDate(draft.value.properties, value); error.value = ''; }
  catch (reason) { error.value = String(reason); }
}
function updateDue(event: Event) {
  if (disabled.value) return;
  const value = (event.target as HTMLInputElement).value;
  if (value) draft.value.properties.due = value;
  else delete draft.value.properties.due;
}
function navigate(action: Navigation) {
  pending.value = undefined;
  if (action.kind === 'close') emit('close');
  else emit('openReference', action.identity);
}
function requestNavigation(action: Navigation) {
  if (busy.value) return;
  if (dirty.value) pending.value = action;
  else navigate(action);
}
async function openDescriptionLink(reference: string) {
  if (/^https?:\/\//i.test(reference)) {
    try { await openExternalUrl(reference); } catch (reason) { error.value = String(reason); }
    return;
  }
  const path = resolveWorkspaceReference(base.value.path, reference);
  const target = inScope.value && !personal && store.referenceTargets.find(target => target.path === path);
  if (target) requestNavigation({ kind: 'reference', identity: target });
  else error.value = t('引用目标不可用');
}
function openDescriptionWiki(target: string) {
  if (!inScope.value || personal || !store.workspace) { error.value = t('引用目标不可用'); return; }
  const resolved = resolveWikiLink(store.workspace.files, base.value.path, target);
  if ('file' in resolved) requestNavigation({ kind: 'reference', identity: { type: 'document', id: resolved.file.id } });
  else error.value = t('引用目标不可用');
}
async function save(copy = false) {
  if (copy ? !canCopy.value : disabled.value) return;
  busy.value = true; error.value = ''; saveFailed.value = false;
  try {
    const value = clone(draft.value);
    value.name = value.name.trim();
    if (copy) {
      value.name = t('{0}（副本）', [value.name.slice(0, 180)]);
      for (const key of ['syncConnection', 'syncRemoteId', 'syncReadOnly', 'deliveryReview']) delete value.properties[key];
      for (const key of ['repeat', 'repeatSourceId', 'repeatOccurrence']) delete value.properties[key];
      value.properties.syncConflictCopy = true;
      const saved = await plans.create(value, personal ? 'personal' : 'workspace', scopeId);
      emit('openRecord', { ...saved, source: base.value.source });
    } else {
      const saved = await plans.update(base.value, value);
      accept(saved);
      if (pending.value) navigate(pending.value);
    }
  } catch (reason) { error.value = String(reason); saveFailed.value = true; }
  finally { busy.value = false; }
}
async function reload() {
  if (busy.value || !inScope.value) return;
  busy.value = true;
  try {
    if (personal) await plans.refreshPersonal();
    else await store.refresh();
    if (!latest.value) throw new Error(t('事项已不存在，请保留当前内容为副本'));
    accept(latest.value); pending.value = undefined;
  } catch (reason) { error.value = String(reason); }
  finally { busy.value = false; }
}
function keyboard(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation(); event.preventDefault();
    if (pending.value) pending.value = undefined;
    else requestNavigation({ kind: 'close' });
  }
  if (event.key !== 'Tab' || !panel.value) return;
  const controls = [...panel.value.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)')]
    .filter(element => element.getClientRects().length);
  if (!controls.length) { event.preventDefault(); panel.value.focus(); return; }
  if (event.shiftKey && (document.activeElement === controls[0] || document.activeElement === panel.value)) {
    event.preventDefault(); controls.at(-1)?.focus();
  } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
    event.preventDefault(); controls[0]?.focus();
  }
}
onMounted(async () => {
  await resizeName(); panel.value?.focus();
  if (typeof ResizeObserver !== 'undefined' && nameField.value) {
    let width = nameField.value.clientWidth;
    nameResize = new ResizeObserver(() => {
      if (nameField.value && width !== nameField.value.clientWidth) { width = nameField.value.clientWidth; void resizeName(); }
    });
    nameResize.observe(nameField.value);
  }
});
onBeforeUnmount(() => { nameResize?.disconnect(); if (previousFocus?.isConnected) previousFocus.focus(); });
</script>

<template>
  <div class="plan-detail-backdrop" @mousedown.self="requestNavigation({ kind: 'close' })">
    <form ref="panel" class="plan-detail-panel" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1" @submit.prevent="save()" @keydown="keyboard">
      <header>
        <div class="plan-detail-heading"><component :is="checkable ? ListTodo : CalendarDays" :size="18" /><h2>{{ title }}</h2><span>{{ personal ? t('个人') : base.source?.name ?? store.workspace?.name }}</span></div>
        <div class="plan-detail-actions">
          <button type="button" class="icon-button" :class="{ 'is-archived': draft.archived }" :aria-label="draft.archived ? t('取消归档') : t('归档')" :data-tooltip="draft.archived ? t('取消归档') : t('归档')" :disabled="disabled" @click="draft.archived = !draft.archived"><Archive :size="17" /></button>
          <button type="button" class="icon-button" :aria-label="t('关闭{0}', [title])" :data-tooltip="t('关闭')" :disabled="busy" @click="requestNavigation({ kind: 'close' })"><X :size="18" /></button>
        </div>
      </header>
      <div class="plan-detail-content">
        <button v-if="documentSource" type="button" :disabled="busy || !inScope" @click="requestNavigation({ kind: 'reference', identity: { type: 'document', id: documentSource.fileId } })">{{ t('返回原文选区') }}</button>
        <p v-if="!inScope" class="detail-notice" role="alert">{{ t('事项所属空间已切换，当前草稿仍保留。请返回原空间后保存。') }}</p>
        <p v-else-if="!latest" class="detail-notice" role="alert">{{ t('事项已移除或身份不唯一，当前内容仍保留。') }}</p>
        <p v-else-if="latest.object.properties.syncReadOnly" class="detail-notice" role="status">{{ t('此事项来自只读连接，请在来源应用中编辑。') }}</p>
        <p v-else-if="!plans.canEdit(latest)" class="detail-notice" role="status">{{ t('当前事项只读。') }}</p>
        <p v-else-if="changedExternally" class="detail-notice" role="status">{{ t('事项已被外部修改，保存时将尝试合并。') }}</p>
        <label class="detail-sr-only" :for="nameId">{{ t('名称') }}</label>
        <div class="plan-detail-name" :class="{ 'is-completed': completed && checkable }">
          <label v-if="checkable" class="detail-completion" :class="{ 'is-disabled': disabled }" :title="completed ? t('标记未完成') : t('标记完成')">
            <input type="checkbox" :checked="completed" :aria-label="t('已完成')" :disabled="disabled || completionLocked" @change="setCompleted(($event.target as HTMLInputElement).checked)" />
            <CircleCheck v-if="completed" :size="25" :stroke-width="1.6" /><Circle v-else :size="25" :stroke-width="1.6" />
          </label>
          <textarea :id="nameId" ref="nameField" :value="draft.name" :aria-label="t('名称')" rows="1" maxlength="200" required :disabled="disabled" @input="updateName" @keydown="nameKeydown" />
        </div>
        <div class="plan-detail-meta">
          <span class="detail-status" :class="{ 'is-completed': completed && checkable }"><span class="detail-status-dot" />{{ draft.archived ? t('已归档') : checkable ? completed ? t('已完成') : t('待完成') : t('日程') }}</span>
          <label v-if="draft.type === 'event'" class="detail-check"><input type="checkbox" :checked="checkable" :disabled="disabled" @change="setCheckable(($event.target as HTMLInputElement).checked)" />{{ t('需要完成') }}</label>
        </div>
        <div class="plan-detail-schedule">
          <PlanDateField :model-value="planDate" :disabled="disabled" compact @update:model-value="updatePlanDate" />
          <div class="plan-detail-due"><label :for="dueId"><Flag :size="14" />{{ t('截止日期') }}</label><input :id="dueId" type="date" :value="draft.properties.due ?? ''" :disabled="disabled" @input="updateDue" /></div>
        </div>
        <DescriptionEditor v-model="draft.description" :disabled="disabled" :targets="previewTargets" preview @open-reference="requestNavigation({ kind: 'reference', identity: $event })" @open-link="openDescriptionLink" @open-wiki-link="openDescriptionWiki" />
        <TaskRepeatControls v-if="checkable && !personal && scopeId" :object="draft" :record="base" :workspace-id="scopeId" :disabled="disabled" :dirty="dirty" @change="value => { if (value === undefined) { delete draft.properties.repeat; delete draft.properties.repeatSourceId; delete draft.properties.repeatOccurrence; } else draft.properties.repeat = value; }" @open-record="emit('openRecord', $event)" />
        <component :is="objectDetails" v-if="objectDetails && !personal && latest && scopeId" :workspace-id="scopeId" :object="latest.object" :disabled="disabled || dirty" @open-reference="requestNavigation({ kind: 'reference', identity: $event })" />
        <ReferenceConnections class="plan-detail-references" :identity="draft" :draft="draft.description" :local-targets="personalTargets" :active="inScope" @open="requestNavigation({ kind: 'reference', identity: $event })" />
        <p v-if="error" class="detail-error" role="alert">{{ error }}</p>
        <div v-if="saveFailed" class="plan-detail-recovery">
          <button type="button" :disabled="!canCopy" @click="save(true)"><Copy :size="15" />{{ t('另存副本') }}</button>
          <button type="button" :disabled="busy || !inScope" @click="reload"><RotateCcw :size="15" />{{ t('放弃修改并重新读取') }}</button>
        </div>
      </div>
      <div v-if="pending" class="plan-detail-unsaved" role="alert">
        <strong>{{ t('有未保存的修改') }}</strong>
        <div><button type="button" :disabled="disabled || !draft.name.trim()" @click="save()">{{ t('保存并继续') }}</button><button type="button" :disabled="busy" @click="navigate(pending)">{{ t('放弃修改') }}</button><button type="button" :disabled="busy" @click="pending = undefined">{{ t('继续编辑') }}</button></div>
      </div>
      <footer>
        <span class="detail-save-state" :class="{ 'has-changes': dirty }" role="status"><LoaderCircle v-if="busy" :size="14" class="detail-spinner" /><Circle v-else-if="dirty" :size="12" /><Check v-else :size="14" />{{ busy ? t('保存中') : dirty ? t('有未保存的修改') : disabled ? t('只读') : t('已保存') }}</span>
        <button type="button" class="detail-close" :disabled="busy" @click="requestNavigation({ kind: 'close' })">{{ t('关闭') }}</button>
        <button type="submit" class="detail-save" :disabled="disabled || !dirty || !draft.name.trim()"><LoaderCircle v-if="busy" :size="16" class="detail-spinner" /><Save v-else :size="16" />{{ t('保存') }}</button>
      </footer>
    </form>
  </div>
</template>

<style scoped>
.plan-detail-backdrop { position: fixed; inset: 0; z-index: 85; display: flex; align-items: center; justify-content: center; padding: 28px; box-sizing: border-box; background: #161a2238; backdrop-filter: blur(3px); }
.plan-detail-panel { display: flex; flex-direction: column; width: min(720px, 100%); height: min(740px, calc(100dvh - 56px)); min-height: 0; margin: 0; overflow: hidden; background: var(--paper); color: var(--text); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 20px 80px #12182026, 0 2px 8px #12182012; outline: none; }
header, footer { display: flex; align-items: center; gap: 10px; padding: 12px 24px; flex-shrink: 0; }
header { justify-content: space-between; border-bottom: 1px solid var(--line); }
.plan-detail-heading { display: flex; align-items: center; gap: 8px; min-width: 0; }
h2 { font-size: 12px; font-weight: 500; margin: 0; flex-shrink: 0; color: var(--text-secondary); }
.plan-detail-heading > svg { color: var(--muted); flex-shrink: 0; width: 16px; height: 16px; }
.plan-detail-heading > span { padding-left: 12px; margin-left: 4px; border-left: 1px solid var(--line); font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.plan-detail-actions { display: flex; gap: 6px; flex-shrink: 0; }
.plan-detail-actions .icon-button { width: 28px; height: 28px; color: var(--muted); }
.plan-detail-actions .is-archived { color: var(--green); background: var(--accent); }
.plan-detail-content { flex: 1; min-height: 0; overflow: auto; padding: 28px 36px; }
.detail-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.plan-detail-name { display: flex; align-items: flex-start; gap: 12px; min-width: 0; }
.detail-completion { position: relative; display: grid; place-items: center; width: 28px; height: 38px; flex: none; color: var(--muted); }
.detail-completion input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.detail-completion svg { pointer-events: none; }
.detail-completion:has(input:checked) { color: var(--green); }
.detail-completion:has(input:focus-visible) { outline: 2px solid var(--green); outline-offset: 2px; border-radius: 4px; }
.detail-completion.is-disabled input { cursor: not-allowed; }
.plan-detail-name textarea { display: block; flex: 1; min-width: 0; width: 100%; min-height: 38px; max-height: 136px; padding: 0; margin: 0; resize: none; background: transparent; border: 0; border-radius: 3px; font: inherit; font-size: 24px; font-weight: 600; line-height: 1.55; color: var(--text); overflow-wrap: anywhere; }
.plan-detail-name textarea:hover:not(:disabled) { background: var(--surface); }
.plan-detail-name.is-completed textarea { color: var(--muted); text-decoration: line-through; }
.plan-detail-meta { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 8px 0 22px; }
.detail-status { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: var(--text-secondary); }
.detail-status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); }
.detail-status.is-completed { color: var(--green); }
.detail-status.is-completed .detail-status-dot { background: var(--green); }
.detail-check { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }
.detail-check input { width: 12px; height: 12px; accent-color: var(--green); margin: 0; }
.plan-detail-schedule { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: start; gap: 24px; padding: 16px 0 20px; margin-bottom: 24px; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.plan-detail-due { display: grid; gap: 8px; min-width: 0; }
.plan-detail-due label { display: flex; align-items: center; gap: 7px; min-height: 28px; font-size: 12px; color: var(--text-secondary); }
.plan-detail-due label svg { color: var(--muted); }
.plan-detail-due input { box-sizing: border-box; width: 100%; min-width: 0; height: 36px; padding: 7px 9px; font: inherit; font-size: 13px; background: var(--paper); color: var(--text); border: 1px solid var(--line); border-radius: 6px; }
.plan-detail-panel :deep(.description-heading) { font-size: 13px; font-weight: 500; color: var(--text-secondary); }
.plan-detail-panel :deep(.description-actions .icon-button) { width: 26px; height: 26px; color: var(--muted); }
.plan-detail-panel :deep(.description-editor > textarea) { box-sizing: border-box; width: 100%; padding: 12px; line-height: 1.7; font-size: 13px; border: 1px solid var(--control-border); border-radius: 6px; background: var(--paper); color: var(--text); min-height: 150px; }
.plan-detail-panel :deep(.description-search input) { padding: 8px; border: 1px solid var(--line); border-radius: 5px; background: var(--paper); color: var(--text); }
.plan-detail-panel :deep(.plan-detail-references) { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; margin-top: 24px; padding-top: 20px; }
.plan-detail-panel :deep(.plan-detail-references .reference-direction + .reference-direction) { margin-top: 0; }
.plan-detail-panel :deep(.plan-detail-references h3) { margin-bottom: 10px; font-size: 12px; color: var(--text-secondary); font-weight: 500; }
.plan-detail-panel :deep(.plan-detail-references h3 small) { font-size: 11px; }
.plan-detail-panel :deep(.plan-detail-references button) { padding: 8px; margin-left: -8px; width: calc(100% + 8px); border-radius: 5px; }
.plan-detail-panel :deep(.plan-detail-references button:hover:not(:disabled)) { background: var(--surface); }
.plan-detail-panel :deep(.plan-detail-references button > svg) { color: var(--muted); width: 14px; height: 14px; }
.plan-detail-panel :deep(.plan-detail-references button strong) { font-size: 12px; }
.plan-detail-panel :deep(.plan-detail-references button small:not(.reference-excerpt)) { display: inline; margin-left: 6px; font-size: 10px; }
.plan-detail-panel :deep(.plan-detail-references .reference-excerpt) { margin-top: 4px; line-height: 1.6; }
.plan-detail-panel :deep(.plan-detail-references [role=alert]) { grid-column: 1 / -1; }
.detail-notice, .detail-error { font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; margin: 0 0 16px; }
.detail-notice { color: var(--muted); }
.detail-error { color: var(--danger); margin-top: 16px; }
.plan-detail-recovery { display: flex; flex-wrap: wrap; gap: 8px; }
.plan-detail-recovery button, .plan-detail-unsaved button { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--line); border-radius: 6px; padding: 7px 10px; font-size: 12px; }
.plan-detail-unsaved { border-top: 1px solid var(--line); padding: 14px 24px; background: var(--surface); }
.plan-detail-unsaved strong { display: block; font-size: 13px; font-weight: 500; margin-bottom: 10px; }
.plan-detail-unsaved > div { display: flex; flex-wrap: wrap; gap: 8px; }
footer { border-top: 1px solid var(--line); padding-bottom: max(12px, env(safe-area-inset-bottom)); background: var(--surface); }
.detail-save-state { display: inline-flex; align-items: center; gap: 7px; flex: 1; min-width: 0; font-size: 12px; color: var(--muted); }
.detail-save-state.has-changes { color: var(--text-secondary); }
.detail-close { padding: 8px 12px; height: 36px; font-size: 13px; color: var(--text-secondary); border-radius: 5px; }
.detail-close:hover:not(:disabled) { background: var(--hover); }
.detail-save { display: inline-flex; align-items: center; justify-content: center; gap: 7px; flex-shrink: 0; min-width: 90px; height: 36px; border-radius: 6px; color: #fff; background: var(--green-fill); font-size: 13px; }
.detail-save:hover:not(:disabled) { background: var(--green-fill-hover); }
.plan-detail-panel button:disabled { opacity: .55; cursor: not-allowed; }
.plan-detail-panel :is(input, textarea):disabled { cursor: not-allowed; }
.plan-detail-panel :is(input, textarea, button):focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
.detail-spinner { animation: detail-spin 1s linear infinite; }
@keyframes detail-spin { to { transform: rotate(360deg); } }
@media (max-width: 600px) { .plan-detail-backdrop { padding: 12px; } .plan-detail-panel { height: min(740px, calc(100dvh - 24px)); } header, footer { padding-left: 16px; padding-right: 16px; } .plan-detail-content { padding: 24px 20px; } .plan-detail-schedule { gap: 16px; } .plan-detail-name textarea { font-size: 22px; } .plan-detail-panel :deep(.plan-detail-references) { gap: 16px; } .detail-save-state { font-size: 11px; } }
@media (max-width: 420px) { .plan-detail-schedule { grid-template-columns: minmax(0, 1fr); gap: 16px; } .plan-detail-panel :deep(.plan-detail-references) { grid-template-columns: minmax(0, 1fr); gap: 20px; } .detail-save-state.has-changes { max-width: 98px; line-height: 1.5; } .detail-close { padding: 8px; } .detail-save { min-width: 76px; } }
</style>
