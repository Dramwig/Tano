<script setup lang="ts">
import { useWindowContext } from '../../windows/context';
const { document } = useWindowContext();

import { vSurfaceMotion } from '@tano/editor/surface-motion';
import { t } from '../../i18n/i18n';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue';
import {
  Archive,
  Blocks,
  Bot,
  Check,
  CircleDot,
  LoaderCircle,
  Lock,
  Puzzle,
  Save,
  Trash2,
  UserRound,
  X,
} from 'lucide-vue-next';
import { isAgentPerson, referenceUrl } from '@tano/protocol';
import type { ObjectField, ReferenceIdentity, WorkspaceObject } from '@tano/protocol';
import type { ObjectRecord } from '../workspace-objects';
import { objectTypeLabel as referenceTypeLabel } from '../../i18n/ui-labels';
import ModalBackdrop from '../../shell/components/ModalBackdrop.vue';
import { useWorkspaceStore } from '../../stores/workspace';
import { useWorkbenchRuntime } from '../../runtime';
import DescriptionEditor from '../../documents/components/DescriptionEditor.vue';
import ReferenceConnections from './ReferenceConnections.vue';
import ObjectRelationEditor from './ObjectRelationEditor.vue';

const props = defineProps<{
  record?: ObjectRecord;
  objectId?: string;
  initialType?: string;
}>();

const emit = defineEmits<{
  close: [];
  openReference: [identity: ReferenceIdentity];
  saved: [record: ObjectRecord];
  deleted: [id: string];
}>();

const store = useWorkspaceStore();
const objectDetails = useWorkbenchRuntime().extensions?.().objectDetails;
const panel = ref<HTMLElement>();
const nameInput = ref<HTMLTextAreaElement>();
const nameId = useId();
const typeId = useId();
const previousFocus = document.activeElement as HTMLElement | null;

function clone(value: WorkspaceObject): WorkspaceObject {
  return JSON.parse(JSON.stringify(value));
}

const resolvedRecord = computed<ObjectRecord | undefined>(() => {
  if (props.record) {
    return (
      store.objects.find(
        (item) =>
          item.object.id === props.record!.object.id &&
          item.object.type === props.record!.object.type,
      ) ?? props.record
    );
  }
  if (props.objectId) {
    return store.objects.find((item) => item.object.id === props.objectId);
  }
  return undefined;
});

const creatableTypes = computed(() =>
  store.objectDefinitions.filter(
    (type) => type.storage === 'record' && !type.legacy && type.type !== 'event',
  ),
);

function buildDraft(record?: ObjectRecord, initialType?: string): WorkspaceObject {
  if (record) return clone(record.object);
  const preferred =
    initialType && creatableTypes.value.some((type) => type.type === initialType)
      ? initialType
      : (creatableTypes.value[0]?.type ?? initialType ?? 'person');
  return {
    version: 1,
    id: '',
    type: preferred,
    name: '',
    description: '',
    archived: false,
    properties: {},
  };
}

const base = shallowRef<ObjectRecord | undefined>(resolvedRecord.value);
const draft = ref<WorkspaceObject>(buildDraft(resolvedRecord.value, props.initialType));
const rawJson = ref(JSON.stringify(draft.value.properties, null, 2));
const jsonError = ref('');
const busy = ref(false);
const error = ref('');
const confirmDelete = ref(false);
const workspaceScopeId = ref(store.workspace?.id ?? '');

const definition = computed(() =>
  store.objectDefinitions.find((type) => type.type === draft.value.type),
);
const isAgent = computed(() => isAgentPerson(draft.value));
const isPerson = computed(() => draft.value.type === 'person');
const isPluginObject = computed(() => definition.value?.category === 'plugin');
const dirty = computed(() => {
  if (!base.value) {
    return Boolean(
      draft.value.name.trim() ||
        draft.value.description.trim() ||
        Object.keys(draft.value.properties).length > 0,
    );
  }
  return JSON.stringify(draft.value) !== JSON.stringify(base.value.object) || Boolean(jsonError.value);
});
const editDisabled = computed(
  () =>
    busy.value ||
    !store.workspace ||
    store.workspace.id !== workspaceScopeId.value ||
    store.workspace.readOnly ||
    !store.capabilities.features.objectReferences ||
    !definition.value ||
    base.value?.object.properties.syncReadOnly === true,
);
const canSave = computed(
  () => !editDisabled.value && !jsonError.value && Boolean(draft.value.name.trim()) && (!base.value || dirty.value),
);
const typeBadgeLabel = computed(() => {
  if (isAgent.value) return t('AI Agent');
  if (definition.value) {
    return definition.value.category === 'core' ? t(definition.value.label) : definition.value.label;
  }
  return referenceTypeLabel(draft.value.type);
});
const dialogLabel = computed(() => {
  if (!base.value) return t('新建{0}', [typeBadgeLabel.value]);
  return t('{0}详情', [typeBadgeLabel.value]);
});
const referenceTargets = computed(() =>
  store.referenceTargets.filter(
    (target) => target.type !== 'document' || !target.path.startsWith('.tano/'),
  ),
);
const readonlyEntries = computed(() =>
  Object.entries(draft.value.properties).map(([key, value]) => ({
    key,
    value:
      value === null || value === undefined
        ? '—'
        : typeof value === 'boolean'
          ? value
            ? t('是')
            : t('否')
          : typeof value === 'string' || typeof value === 'number'
            ? String(value)
            : Array.isArray(value)
              ? value.every((item) => typeof item !== 'object' || item === null)
                ? value.map((item) => String(item)).join('、')
                : JSON.stringify(value)
              : JSON.stringify(value),
  })),
);
const uri = computed(() =>
  base.value
    ? referenceUrl({ type: base.value.object.type, id: base.value.object.id })
    : t('保存后生成唯一 ID'),
);

watch(resolvedRecord, (next) => {
  if (!next) return;
  if (!base.value || (next.object.id === base.value.object.id && !dirty.value)) {
    base.value = next;
    draft.value = clone(next.object);
    rawJson.value = JSON.stringify(draft.value.properties, null, 2);
    jsonError.value = '';
  }
});

watch(
  () => store.workspace?.id,
  (id) => {
    if (id !== workspaceScopeId.value) emit('close');
  },
);

async function resizeName() {
  await nextTick();
  if (!nameInput.value) return;
  nameInput.value.style.height = 'auto';
  nameInput.value.style.height = `${Math.min(120, Math.max(36, nameInput.value.scrollHeight))}px`;
}
watch(() => draft.value.name, resizeName);

function updateName(event: Event) {
  if (editDisabled.value) return;
  draft.value.name = (event.target as HTMLTextAreaElement).value.replace(/[\r\n]+/g, ' ');
}

function onNameKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.isComposing) event.preventDefault();
}

function fieldValue(field: ObjectField) {
  const value = draft.value.properties[field.key];
  if (field.type === 'datetime' && typeof value === 'string' && value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
  return value ?? '';
}

function updateField(field: ObjectField, event: Event) {
  if (editDisabled.value) return;
  const input = event.target as HTMLInputElement;
  const next = { ...draft.value.properties };
  if (field.type === 'boolean') {
    next[field.key] = input.checked;
  } else if (!input.value) {
    delete next[field.key];
  } else if (field.type === 'datetime') {
    next[field.key] = new Date(input.value).toISOString();
  } else if (field.type === 'number') {
    next[field.key] = Number(input.value);
  } else {
    next[field.key] = input.value;
  }
  draft.value.properties = next;
  rawJson.value = JSON.stringify(next, null, 2);
  jsonError.value = '';
  error.value = '';
}

function updateRawJson(event: Event) {
  const value = (event.target as HTMLTextAreaElement).value;
  rawJson.value = value;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      jsonError.value = t('属性必须是 JSON 对象');
      return;
    }
    draft.value.properties = parsed;
    jsonError.value = '';
  } catch {
    jsonError.value = t('JSON 格式无效，请检查语法');
  }
}

function toggleArchive() {
  if (editDisabled.value) return;
  draft.value.archived = !draft.value.archived;
}

async function save() {
  if (!canSave.value) return;
  error.value = '';
  busy.value = true;
  const scope = workspaceScopeId.value;
  try {
    const value: WorkspaceObject = {
      ...clone(draft.value),
      name: draft.value.name.trim(),
    };
    const saved = base.value
      ? await store.updateObject(base.value, value, scope)
      : await store.createObject(value);
    base.value = saved;
    draft.value = clone(saved.object);
    rawJson.value = JSON.stringify(saved.object.properties, null, 2);
    jsonError.value = '';
    emit('saved', saved);
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    busy.value = false;
  }
}

async function removeCurrent() {
  if (!base.value || editDisabled.value) return;
  busy.value = true;
  error.value = '';
  try {
    const id = base.value.object.id;
    await store.deleteObject(base.value, workspaceScopeId.value);
    confirmDelete.value = false;
    emit('deleted', id);
    emit('close');
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    busy.value = false;
  }
}

function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab' || !panel.value) return;
  const controls = Array.from(
    panel.value.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary',
    ),
  ).filter((el) => el.getClientRects().length);
  const first = controls[0];
  const last = controls.at(-1);
  if (
    event.shiftKey &&
    (document.activeElement === first || document.activeElement === panel.value)
  ) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}

onMounted(async () => {
  await resizeName();
  if (!base.value && nameInput.value) nameInput.value.focus();
  else panel.value?.focus();
});

onBeforeUnmount(() => {
  if (previousFocus?.isConnected) previousFocus.focus();
});
</script>

<template>
  <ModalBackdrop
    v-surface-motion="'ObjectDetailModal:0'"
    class="object-detail-backdrop"
    @close="emit('close')"
  >
    <section
      ref="panel"
      class="object-detail-panel" data-surface-role="dialog"
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      :aria-label="dialogLabel"
      @keydown.esc.stop.prevent="emit('close')"
      @keydown="trapFocus"
    >
      <header class="object-detail-header">
        <div class="object-detail-badges">
          <span class="object-type-pill" :class="{ 'is-agent': isAgent, 'is-plugin': isPluginObject }">
            <Bot v-if="isAgent" :size="14" aria-hidden="true" />
            <UserRound v-else-if="isPerson" :size="14" aria-hidden="true" />
            <Puzzle v-else-if="isPluginObject" :size="14" aria-hidden="true" />
            <Blocks v-else :size="14" aria-hidden="true" />
            <template v-if="!base && creatableTypes.length > 1">
              <label class="sr-only" :for="typeId">{{ t('对象类型') }}</label>
              <select
                :id="typeId"
                v-model="draft.type"
                class="object-type-select"
                :aria-label="t('对象类型')"
                :disabled="busy"
              >
                <option v-for="type in creatableTypes" :key="type.type" :value="type.type">
                  {{ type.category === 'core' ? t(type.label) : type.label }}
                </option>
              </select>
            </template>
            <span v-else>{{ typeBadgeLabel }}</span>
          </span>
          <span v-if="!definition" class="object-meta-pill">
            <Lock :size="12" aria-hidden="true" />{{ t('只读保留') }}
          </span>
          <span v-if="draft.archived" class="object-meta-pill">
            <Archive :size="12" aria-hidden="true" />{{ t('已归档') }}
          </span>
        </div>
        <div class="object-detail-actions">
          <button
            v-if="base && definition"
            type="button"
            class="icon-button"
            :class="{ active: draft.archived }"
            :aria-label="draft.archived ? t('取消归档') : t('归档')"
            :data-tooltip="draft.archived ? t('取消归档') : t('归档（保留引用，停止推荐）')"
            :aria-pressed="draft.archived"
            :disabled="editDisabled"
            @click="toggleArchive"
          >
            <Archive :size="16" />
          </button>
          <button
            v-if="base && definition"
            type="button"
            class="icon-button"
            :class="{ active: confirmDelete }"
            :aria-label="t('删除对象')"
            :data-tooltip="t('删除对象')"
            :disabled="editDisabled"
            @click="confirmDelete = !confirmDelete"
          >
            <Trash2 :size="16" />
          </button>
          <button
            type="button"
            class="icon-button"
            :aria-label="t('关闭')"
            :data-tooltip="t('关闭 · Esc')"
            @click="emit('close')"
          >
            <X :size="17" />
          </button>
        </div>
      </header>

      <div v-if="confirmDelete && base" class="object-confirm-bar" role="alert">
        <span>{{ t('删除后，文档和关系中的既有引用会保留为缺失引用。确认删除？') }}</span>
        <div>
          <button type="button" :disabled="busy" @click="confirmDelete = false">{{ t('取消') }}</button>
          <button
            type="button"
            class="is-danger"
            :disabled="editDisabled"
            @click="removeCurrent"
          >
            {{ busy ? t('删除中…') : t('确认删除') }}
          </button>
        </div>
      </div>

      <div class="object-detail-content">
        <div class="object-detail-name">
          <label class="sr-only" :for="nameId">{{ t('名称') }}</label>
          <textarea
            :id="nameId"
            ref="nameInput"
            :value="draft.name"
            rows="1"
            maxlength="200"
            :aria-label="t('名称')"
            :placeholder="t('输入名称…')"
            :disabled="editDisabled"
            @input="updateName"
            @keydown="onNameKeydown"
          />
        </div>

        <p v-if="!definition" class="detail-callout">
          {{ t('此类型插件未启用，原文件与文档中的既有引用已只读保留，不再参与引用推荐。') }}
        </p>
        <p v-else-if="!store.capabilities.features.objectReferences" class="detail-callout">
          {{ t('「工作区对象与引用」已关闭，当前仅可查看；可在工作区设置中重新启用。') }}
        </p>
        <p v-else-if="isAgent" class="detail-callout">
          {{ t('AI Agent 身份用于在文档和评论中被 @ 提及与派发；模型连接与收件箱设置请在「助手」中管理。') }}
        </p>
        <p v-else-if="isPerson && !objectDetails" class="detail-notice">
          {{ t('人物是工作区记录，不代表登录账号或访问权限。') }}
        </p>
        <p v-if="store.isDemo" class="detail-notice">
          {{ t('浏览器演示存储：修改仅保存在当前浏览器中。') }}
        </p>

        <div
          v-if="
            (objectDetails && base) ||
            (definition?.fields.length ?? 0) > 0 ||
            (!definition && readonlyEntries.length > 0)
          "
          class="object-detail-properties"
        >
          <component
            :is="objectDetails"
            v-if="objectDetails && base"
            :key="`${workspaceScopeId}:${base.object.id}`"
            :workspace-id="workspaceScopeId"
            :object="base.object"
            :disabled="editDisabled || dirty"
            @open-reference="emit('openReference', $event)"
          />

          <template v-if="definition?.fields.length">
            <div v-for="field in definition.fields" :key="field.key" class="object-detail-row">
              <label :for="`object-field-${field.key}`">
                {{ definition.category === 'core' ? t(field.label) : field.label
                }}{{ field.required ? ' *' : '' }}
              </label>
              <div class="object-field-control">
                <input
                  v-if="field.type === 'boolean'"
                  :id="`object-field-${field.key}`"
                  type="checkbox"
                  :checked="fieldValue(field) === true"
                  :disabled="editDisabled"
                  @change="updateField(field, $event)"
                />
                <input
                  v-else
                  :id="`object-field-${field.key}`"
                  :type="
                    field.type === 'datetime'
                      ? 'datetime-local'
                      : field.type === 'number'
                        ? 'number'
                        : 'text'
                  "
                  :step="field.type === 'number' ? 'any' : undefined"
                  :value="fieldValue(field)"
                  :required="field.required"
                  :disabled="editDisabled"
                  @input="updateField(field, $event)"
                />
              </div>
            </div>
          </template>

          <template v-else-if="!definition && readonlyEntries.length">
            <div v-for="entry in readonlyEntries" :key="entry.key" class="object-detail-row">
              <span class="object-detail-label">{{ entry.key }}</span>
              <span class="object-readonly-value">{{ entry.value }}</span>
            </div>
          </template>
        </div>

        <DescriptionEditor
          :key="`${workspaceScopeId}:${base?.object.id ?? `new:${draft.type}`}`"
          v-model="draft.description"
          :disabled="editDisabled"
          :targets="referenceTargets"
          preview
        />

        <ReferenceConnections
          v-if="base"
          class="object-detail-references"
          :identity="base.object"
          :draft="draft.description"
          :active="true"
          @open="emit('openReference', $event)"
        />

        <ObjectRelationEditor
          v-if="base && definition"
          :identity="base.object"
          :workspace-id="workspaceScopeId"
          :disabled="editDisabled"
          @open="emit('openReference', $event)"
        />

        <details v-if="base || isPluginObject" class="object-technical-details">
          <summary>{{ t('更多信息') }}</summary>
          <div class="object-technical-body">
            <div class="object-meta-line">
              <span>{{ t('引用身份') }}</span>
              <code>{{ uri }}</code>
            </div>
            <div v-if="base" class="object-meta-line">
              <span>{{ t('文件位置') }}</span>
              <code>{{ base.path }}</code>
            </div>
            <div v-if="isPluginObject" class="object-json-field">
              <label :for="`object-json-${nameId}`">{{ t('自定义属性（JSON）') }}</label>
              <textarea
                :id="`object-json-${nameId}`"
                :value="rawJson"
                rows="4"
                spellcheck="false"
                :disabled="editDisabled"
                @input="updateRawJson"
              />
              <p v-if="jsonError" class="detail-error" role="alert">{{ jsonError }}</p>
            </div>
          </div>
        </details>

        <p v-if="error" class="detail-error" role="alert">{{ error }}</p>
      </div>

      <footer class="object-detail-footer">
        <span class="detail-save-state" :class="{ 'has-changes': dirty }">
          <LoaderCircle v-if="busy" :size="14" class="detail-spinner" aria-hidden="true" />
          <Lock v-else-if="!definition" :size="14" aria-hidden="true" />
          <CircleDot v-else-if="dirty" :size="14" aria-hidden="true" />
          <Check v-else :size="14" aria-hidden="true" />
          {{
            busy
              ? t('正在保存…')
              : !definition
                ? t('只读保留')
                : dirty
                  ? t('有未保存的更改')
                  : base
                    ? t('已保存')
                    : t('填写名称后保存')
          }}
        </span>
        <div class="object-footer-actions">
          <button type="button" class="detail-close" :disabled="busy" @click="emit('close')">
            {{ t('关闭') }}
          </button>
          <button
            v-if="definition"
            type="button"
            class="detail-save"
            :disabled="!canSave"
            @click="save"
          >
            <Save :size="15" aria-hidden="true" />{{ base ? t('保存') : t('创建') }}
          </button>
        </div>
      </footer>
    </section>
  </ModalBackdrop>
</template>

<style scoped>
@layer components {
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.object-detail-backdrop {
  padding: 20px;
}
.object-detail-panel {
  display: flex;
  flex-direction: column;
  width: min(640px, 100%);
  max-height: min(760px, calc(100dvh - 40px));
  background: var(--paper);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 14px;
  box-shadow: 0 20px 60px rgb(0 0 0 / 18%);
  overflow: hidden;
  outline: none;
}
.object-detail-header,
.object-detail-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 20px;
  flex: none;
}
.object-detail-header {
  border-bottom: 1px solid var(--line);
}
.object-detail-badges,
.object-detail-actions,
.object-footer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.object-type-pill,
.object-meta-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  background: var(--surface);
  color: var(--text-secondary);
  border: 1px solid var(--line);
}
.object-type-pill.is-agent {
  color: var(--green);
  border-color: color-mix(in srgb, var(--green) 35%, var(--line));
  background: color-mix(in srgb, var(--green) 8%, var(--paper));
}
.object-type-select {
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  outline: none;
}
.object-detail-actions .icon-button {
  width: 30px;
  height: 30px;
  border-radius: 7px;
  color: var(--muted);
}
.object-detail-actions .icon-button:hover:not(:disabled),
.object-detail-actions .icon-button.active {
  background: var(--hover);
  color: var(--text);
}
.object-confirm-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 20px;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--danger) 8%, var(--surface));
  font-size: 12px;
  color: var(--text);
}
.object-confirm-bar > div {
  display: flex;
  gap: 8px;
}
.object-confirm-bar button {
  padding: 5px 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--paper);
  color: var(--text);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.object-confirm-bar button.is-danger {
  border-color: var(--danger);
  background: var(--danger);
  color: #fff;
}
.object-detail-content {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 22px 24px 24px;
}
.object-detail-name {
  margin-bottom: 14px;
}
.object-detail-name textarea {
  display: block;
  width: 100%;
  box-sizing: border-box;
  margin: 0;
  padding: 2px 0;
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 24px;
  font-weight: 600;
  line-height: 1.35;
  resize: none;
  outline: none;
}
.object-detail-name textarea::placeholder {
  color: var(--muted);
  font-weight: 500;
}
.detail-callout {
  margin: 0 0 16px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.6;
}
.detail-notice {
  margin: 0 0 14px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
}
.object-detail-properties {
  display: grid;
  gap: 6px;
  padding: 14px 0 16px;
  margin-bottom: 14px;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}
.object-detail-row {
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr);
  column-gap: 12px;
  align-items: center;
  min-width: 0;
}
.object-detail-row > label,
.object-detail-label {
  font-size: 13px;
  color: var(--muted);
  overflow-wrap: anywhere;
}
.object-field-control input:not([type='checkbox']) {
  box-sizing: border-box;
  width: 100%;
  height: 32px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
}
.object-field-control input:not([type='checkbox']):hover:not(:disabled, :focus) {
  background: var(--hover);
}
.object-field-control input:not([type='checkbox']):focus-visible {
  outline: none;
  border-color: color-mix(in srgb, var(--text) 35%, var(--line));
  background: var(--paper);
}
.object-readonly-value {
  font-size: 13px;
  color: var(--text);
  overflow-wrap: anywhere;
  padding: 4px 8px;
}
.object-detail-panel :deep(.description-heading) {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}
.object-detail-panel :deep(.description-preview) {
  min-height: 56px;
  padding: 6px 8px;
  margin: 0 -8px;
  border-radius: 8px;
}
.object-detail-panel :deep(.description-preview:hover) {
  background: var(--hover);
}
.object-detail-panel :deep(.description-editor > textarea) {
  box-sizing: border-box;
  width: 100%;
  padding: 10px 12px;
  line-height: 1.65;
  font-size: 13px;
  border: 1px solid var(--control-border);
  border-radius: 6px;
  background: var(--paper);
  color: var(--text);
  min-height: 110px;
}
.object-detail-panel :deep(.object-detail-references) {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 20px;
  margin-top: 20px;
  padding-top: 16px;
}
.object-detail-panel :deep(.object-detail-references .reference-direction + .reference-direction) {
  margin-top: 0;
}
.object-technical-details {
  margin-top: 18px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
  font-size: 12px;
  color: var(--muted);
}
.object-technical-details summary {
  cursor: pointer;
  user-select: none;
}
.object-technical-body {
  display: grid;
  gap: 10px;
  margin-top: 10px;
}
.object-meta-line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
}
.object-meta-line code {
  font-size: 11px;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
  user-select: all;
}
.object-json-field {
  display: grid;
  gap: 6px;
}
.object-json-field textarea {
  box-sizing: border-box;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  resize: vertical;
}
.detail-error {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--danger);
  overflow-wrap: anywhere;
}
.object-detail-footer {
  border-top: 1px solid var(--line);
  background: var(--surface);
  padding-bottom: max(12px, env(safe-area-inset-bottom));
}
.detail-save-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 12px;
  color: var(--muted);
}
.detail-save-state.has-changes {
  color: var(--text-secondary);
}
.detail-close,
.detail-save {
  border: 0;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
}
.detail-close {
  height: 34px;
  padding: 0 12px;
  border-radius: 7px;
  background: transparent;
  color: var(--text-secondary);
}
.detail-close:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.detail-save {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 34px;
  min-width: 82px;
  padding: 0 14px;
  border-radius: 7px;
  background: var(--green-fill);
  color: var(--on-accent, #fff);
  font-weight: 500;
}
.detail-save:hover:not(:disabled) {
  background: var(--green-fill-hover);
}
.detail-save:disabled {
  background: var(--hover);
  color: var(--muted);
  cursor: not-allowed;
}
.detail-spinner {
  animation: object-detail-spin 1s linear infinite;
}
@keyframes object-detail-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 600px) {
  .object-detail-backdrop {
    padding: 12px;
  }
  .object-detail-panel {
    max-height: calc(100dvh - 24px);
  }
  .object-detail-content {
    padding: 18px 16px 20px;
  }
  .object-detail-row {
    grid-template-columns: minmax(0, 1fr);
    gap: 4px;
  }
  .object-detail-panel :deep(.object-detail-references) {
    grid-template-columns: minmax(0, 1fr);
  }
}
}
</style>
