<script setup lang="ts">
import { t } from '../i18n';
import { computed, nextTick, ref, watch } from 'vue';
import { objectTypeRegistry, referenceUrl } from '@tano/protocol';
import { objectTypeLabel as referenceTypeLabel } from '../ui-labels';
import type {
  WorkspaceObject,
  ReferenceIdentity,
  ReferenceTarget,
  ObjectField,
} from '@tano/protocol';
import type { ObjectRecord } from '../workspace-objects';
import { useWorkspaceStore } from '../stores/workspace';
import { useWorkbenchRuntime } from '../runtime';
import PlanDateField from './PlanDateField.vue';
import DescriptionEditor from './DescriptionEditor.vue';
import ReferenceConnections from './ReferenceConnections.vue';
import { readPlanDate, writePlanDate } from '../plan-date';
import type { PlanDateValue } from '../plan-date';

const props = defineProps<{
  personal?: {
    id: string;
    records: ObjectRecord[];
    errors: string[];
    writable: boolean;
    createObject: (value: Pick<WorkspaceObject, 'type' | 'name' | 'description' | 'properties' | 'archived'>) => Promise<ObjectRecord>;
    updateObject: (record: ObjectRecord, value: WorkspaceObject, expectedId: string) => Promise<ObjectRecord>;
  };
  selectedId?: string;
  open: boolean;
  canOpenAsset?: boolean;
  canImportAsset?: boolean;
  previewAsset?: (target: ReferenceTarget) => string | null;
}>();
const emit = defineEmits<{
  close: [];
  openResource: [identity: ReferenceIdentity];
  openReference: [identity: ReferenceIdentity];
  createDocument: [];
  importAsset: [];
}>();
const store = useWorkspaceStore();
const objectDetails = useWorkbenchRuntime().extensions?.().objectDetails;
const scopeId = computed(() => props.personal?.id ?? store.workspace?.id);
const scopeKey = computed(() => `${props.personal ? 'personal' : 'workspace'}:${scopeId.value ?? ''}`);
const records = computed(() => props.personal?.records ?? store.objects);
const personalTargets = computed<ReferenceTarget[] | undefined>(() => props.personal?.records.map(({ object, path }) => ({
  workspace: props.personal!.id, type: object.type, id: object.id, name: object.name, path, description: object.description, archived: object.archived,
})));
function openLinked(identity: ReferenceIdentity) {
  if (!props.personal) return emit('openReference', identity);
  const record = records.value.find(record => record.object.type === identity.type && record.object.id === identity.id);
  if (record) select(record);
}
const objectErrors = computed(() => props.personal?.errors ?? store.objectErrors);
interface Draft {
  workspace: string;
  scope: string;
  record?: ObjectRecord;
  value: WorkspaceObject;
  json: string;
  error: string;
}
const drafts = new Map<string, Draft>();
const current = ref<Draft>();
const search = ref('');
const resourceId = ref<string>();
const resource = computed(() =>
  !props.personal ? store.referenceTargets.find(
    (target) => target.id === resourceId.value && ['document', 'asset'].includes(target.type),
  ) : undefined,
);
const previewUrl = computed(() => (resource.value ? props.previewAsset?.(resource.value) : null));
const resourceTypes = computed(() =>
  store.objectDefinitions.filter((type) => type.storage === 'resource'),
);
const recordTypes = computed(() =>
  store.objectDefinitions.filter((type) => type.storage === 'record' && (!props.personal || type.type === 'event')),
);
const selectableTypes = computed(() => recordTypes.value.filter(type => !type.legacy || current.value?.record?.object.type === type.type));
const definition = computed(() =>
  recordTypes.value.find((type) => type.type === current.value?.value.type),
);
const retired = computed(() => objectTypeRegistry.get(current.value?.value.type ?? '')?.retired === true);
const visibleFields = computed(() => definition.value?.fields.filter(field =>
  current.value?.value.type !== 'event' || !['date', 'start', 'end'].includes(field.key)) ?? []);
const planDate = computed<PlanDateValue>(() => {
  try { return readPlanDate(JSON.parse(current.value?.json ?? '{}')); }
  catch { return { date: '', time: '', end: '' }; }
});
function updatePlanDate(value: PlanDateValue) {
  if (!current.value || editDisabled.value) return;
  try {
    const properties = JSON.parse(current.value.json);
    if (!properties || typeof properties !== 'object' || Array.isArray(properties))
      throw new Error(t('请先修正结构化属性 JSON'));
    current.value.json = JSON.stringify(writePlanDate(properties, value), null, 2);
    current.value.error = '';
  } catch (error) { current.value.error = String(error); }
}
const editDisabled = computed(() => disabled.value || !definition.value || current.value?.record?.object.properties.syncReadOnly === true);
const resources = computed(() =>
  props.personal ? [] : store.referenceTargets.filter(
    (target) =>
      ['document', 'asset'].includes(target.type) &&
      `${target.name} ${target.path} ${referenceTypeLabel(target.type)}`
        .toLowerCase()
        .includes(search.value.toLowerCase()),
  ),
);
const busy = ref(false);
const panel = ref<HTMLElement>();
let previousFocus: HTMLElement | null = null;
watch(
  () => props.open,
  async (open) => {
    if (open) {
      previousFocus = document.activeElement as HTMLElement;
      await nextTick();
      panel.value?.focus();
    } else if (previousFocus?.isConnected) previousFocus.focus();
  },
  { immediate: true },
);
function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab' || !panel.value) return;
  const controls = Array.from(
    panel.value.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary',
    ),
  ).filter((el) => el.getClientRects().length);
  const first = controls[0],
    last = controls.at(-1);
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
const disabled = computed(
  () => props.personal ? !props.personal.writable || busy.value :
    !store.workspace ||
    store.workspace.readOnly ||
    !store.capabilities.features.objectReferences ||
    busy.value,
);
const filtered = computed(() =>
  records.value.filter(({ object }) =>
    (props.personal || store.workspaceSettings.showPeopleDirectory || object.type !== 'person') &&
    `${object.name} ${referenceTypeLabel(object.type)}`
      .toLowerCase()
      .includes(search.value.toLowerCase()),
  ),
);
function select(record?: ObjectRecord) {
  const workspace = scopeId.value;
  if (!workspace || busy.value) return;
  resourceId.value = undefined;
  const key = `${scopeKey.value}:${record?.object.id ?? 'new'}`;
  let draft = drafts.get(key);
  if (!draft) {
    const value: WorkspaceObject = record
      ? JSON.parse(JSON.stringify(record.object))
      : {
          version: 1,
          id: '',
          type: props.personal ? 'event' : 'person',
          name: '',
          description: '',
          archived: false,
          properties: props.personal ? { checkable: true, completed: false } : {},
        };
    draft = {
      workspace,
      scope: scopeKey.value,
      record,
      value,
      json: JSON.stringify(value.properties, null, 2),
      error: '',
    };
  }
  current.value = draft;
  // Keep the reactive draft, including its original base hash, when changing selection or closing.
  drafts.set(key, current.value);
}
watch(
  [scopeKey, () => props.selectedId, () => props.open],
  ([workspaceId, , open], previous) => {
    if (!open && workspaceId === previous?.[0]) return;
    current.value = undefined;
    resourceId.value = undefined;
    if (props.selectedId) {
      const record = records.value.find(({ object }) => object.id === props.selectedId);
      if (record) select(record);
      else resourceId.value = props.selectedId;
    }
  },
  { immediate: true },
);
async function save(copy = false) {
  const draft = current.value;
  if (!draft || editDisabled.value || draft.scope !== scopeKey.value) return;
  draft.error = '';
  busy.value = true;
  try {
    const properties = JSON.parse(draft.json);
    if (!properties || typeof properties !== 'object' || Array.isArray(properties))
      throw new Error(t('属性必须是 JSON 对象'));
    const value = { ...draft.value, name: draft.value.name.trim(), properties };
    const saved =
      draft.record && !copy
        ? await (props.personal ?? store).updateObject(draft.record, value, draft.workspace)
        : await (props.personal ?? store).createObject(value);
    if (current.value !== draft || scopeKey.value !== draft.scope) return;
    drafts.delete(`${draft.scope}:${draft.record?.object.id ?? 'new'}`);
    drafts.delete(`${draft.scope}:${saved.object.id}`);
    busy.value = false;
    select(saved);
  } catch (error) {
    draft.error = String(error);
  } finally {
    busy.value = false;
  }
}
function fieldValue(field: ObjectField) {
  try {
    const value = JSON.parse(current.value?.json ?? '{}')[field.key];
    if (field.type === 'datetime' && value) {
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) return '';
      return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    }
    return value ?? '';
  } catch {
    return '';
  }
}
function updateField(field: ObjectField, event: Event) {
  if (!current.value || editDisabled.value) return;
  try {
    const properties = JSON.parse(current.value.json);
    if (!properties || typeof properties !== 'object' || Array.isArray(properties))
      throw new Error(t('请先修正结构化属性 JSON'));
    const input = event.target as HTMLInputElement;
    if (field.type === 'boolean') {
      properties[field.key] = input.checked;
      if (current.value.value.type === 'event' && field.key === 'checkable' && !input.checked)
        properties.completed = false;
    }
    else if (!input.value) delete properties[field.key];
    else
      properties[field.key] =
        field.type === 'datetime'
          ? new Date(input.value).toISOString()
          : field.type === 'number'
            ? Number(input.value)
            : input.value;
    if (current.value.value.type === 'event' && input.value) {
      if (field.key === 'date') {
        delete properties.start;
        delete properties.end;
      } else if (field.key === 'start' || field.key === 'end') delete properties.date;
    }
    current.value.json = JSON.stringify(properties, null, 2);
    current.value.error = '';
  } catch (error) {
    current.value.error = String(error);
  }
}
function selectResource(id: string) {
  if (!busy.value) {
    current.value = undefined;
    resourceId.value = id;
  }
}
function resetDraft() {
  if (!current.value || busy.value) return;
  const record = records.value.find(({ object }) => object.id === current.value?.record?.object.id);
  drafts.delete(`${current.value.scope}:${current.value.record?.object.id ?? 'new'}`);
  select(record);
}
const uri = computed(() =>
  props.personal && current.value?.record ? t('个人事项 · {0}', [current.value.value.id]) : current.value?.record
    ? referenceUrl({
        type: current.value.value.type,
        id: current.value.value.id,
      })
    : t('保存后生成唯一 ID'),
);
</script>

<template>
  <div class="object-panel-backdrop" @click.self="emit('close')">
    <section
      ref="panel"
      class="object-panel"
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      :aria-label="personal ? t('个人事项') : t('工作区对象')"
      @keydown.esc="emit('close')"
      @keydown="trapFocus"
    >
      <header>
        <div>
          <h2>{{ personal ? t('个人事项') : t('工作区对象') }} <small v-if="!personal">{{ t('Level 2 · 核心与插件对象') }}</small></h2>
          <p>{{ personal ? t('个人计划独立保存，不随工作区分享；尚未开启跨设备同步。') : t('内置事件、人物、文档和资产。需要完成的事件就是任务，也可为事件安排时间。') }}</p>
        </div>
        <button :aria-label="personal ? t('关闭个人事项') : t('关闭工作区对象')" @click="emit('close')">{{ t('关闭') }}</button>
      </header>
      <p v-if="!personal && !store.capabilities.features.objectReferences" class="object-notice">
        {{ t('Level 2 已关闭。现有对象和引用仍保留，可在工作区设置中重新启用。') }}
      </p>
      <p v-if="store.isDemo" class="object-notice">{{ t('浏览器演示存储：对象保存在当前浏览器中。') }}</p>
      <p v-for="error in objectErrors" :key="error" role="alert">{{ error }}</p>
      <div class="object-panel-body">
        <aside>
          <input v-model="search" :aria-label="personal ? t('搜索个人事项') : t('搜索工作区对象')" :placeholder="t('搜索对象')" />
          <button :disabled="disabled" @click="select()">{{ personal ? t('＋ 新建个人事件') : t('＋ 新建对象') }}</button>
          <div v-if="!personal" class="object-resource-actions">
            <button :disabled="disabled" @click="emit('createDocument')">{{ t('新建文档') }}</button
            ><button v-if="canImportAsset" :disabled="disabled" @click="emit('importAsset')">
              {{ t('导入资产') }}
            </button>
          </div>
          <button
            v-for="record in filtered"
            :key="record.object.id"
            :class="{ selected: current?.value.id === record.object.id }"
            :disabled="busy"
            @click="select(record)"
          >
            <strong>{{ record.object.name }}</strong
            ><small
              >{{ referenceTypeLabel(record.object.type) }} ·
              {{
                store.objectDefinitions.find((type) => type.type === record.object.type)
                  ?.category === 'core'
                  && !personal
                  ? 'Level 2-A'
                  : personal ? t('个人') : objectTypeRegistry.get(record.object.type)?.retired ? t('旧版记录') : t('插件对象')
              }}{{ record.object.archived ? t(' · 已归档') : '' }}</small
            >
          </button>
          <small v-if="resources.length">{{ t('文件资源 · Level 2-A') }}</small>
          <button
            v-for="target in resources"
            :key="`${target.type}:${target.id}`"
            :disabled="busy"
            :class="{ selected: resourceId === target.id }"
            @click="selectResource(target.id)"
          >
            <strong>{{ target.name }}</strong
            ><small>{{ referenceTypeLabel(target.type) }} · {{ target.path }}</small>
          </button>
          <p v-if="!filtered.length && !resources.length">
            {{ t('暂无对象。创建后，在文档中输入 @ 或 [[ 选择引用。') }}
          </p>
        </aside>
        <form v-if="current" @submit.prevent="save()">
          <label
            >{{ t('类别 ·') }} {{ personal ? t('个人') : retired ? t('旧版记录') : definition?.category === 'plugin' ? t('插件对象') : 'Level 2-A'
            }}<select v-model="current.value.type" :disabled="disabled || !!current.record">
              <option v-if="!definition" :value="current.value.type">
                {{ referenceTypeLabel(current.value.type) }}
              </option>
              <option v-for="type in selectableTypes" :key="type.type" :value="type.type">
                {{ type.category === 'core' ? t(type.label) : type.label }}
              </option>
            </select></label
          >
          <label
            >{{ t('名称') }}<input
              v-model="current.value.name"
              :disabled="editDisabled"
              required
              maxlength="200"
          /></label>
          <DescriptionEditor :key="`${current.scope}:${current.record?.object.id ?? 'new'}`" v-model="current.value.description" :disabled="editDisabled" :targets="personal ? [] : store.referenceTargets.filter(target => target.type !== 'document' || !target.path.startsWith('.tano/'))" />
          <ReferenceConnections :identity="current.value" :draft="current.value.description" :local-targets="personalTargets" :active="open" @open="openLinked" />
          <component
            :is="objectDetails"
            v-if="objectDetails && !personal && current.record"
            :key="`${current.scope}:${current.record.object.id}`"
            :workspace-id="current.workspace"
            :object="current.record.object"
            :disabled="editDisabled"
            @open-reference="openLinked"
          />
          <p v-if="retired" class="object-notice">
            {{ t('项目由工作区文件夹和 Markdown 文档承载。旧项目对象及已有引用只读保留，不再创建、编辑或另存为项目对象。') }}
          </p>
          <p v-else-if="!definition" class="object-notice">
            {{ t('此类型不属于内置核心对象，且未注册对应插件。文件和既有引用已保留，当前只读，不参与引用推荐。') }}
          </p>
          <p v-if="current.record?.object.properties.syncReadOnly" class="object-notice">{{ t('此事项来自只读连接或重复日程系列，请在来源应用中编辑；更新会在同步后显示。') }}</p>
          <div v-if="definition?.fields.length" class="object-fields">
            <label v-for="field in visibleFields" :key="field.key"
              >{{ definition?.category === 'core' ? t(field.label) : field.label }}{{ field.required ? ' *' : ''
              }}<input
                :type="
                  current.value.type === 'event' && field.key === 'date'
                    ? 'date'
                    : field.type === 'datetime'
                    ? 'datetime-local'
                    : field.type === 'boolean'
                      ? 'checkbox'
                      : field.type === 'number'
                        ? 'number'
                        : 'text'
                "
                :step="field.type === 'number' ? 'any' : undefined"
                :value="fieldValue(field)"
                :checked="field.type === 'boolean' && fieldValue(field) === true"
                :required="field.required && field.type !== 'boolean'"
                :disabled="editDisabled || (current.value.type === 'event' && field.key === 'completed' && fieldValue({ key: 'checkable', label: '', type: 'boolean' }) !== true)"
                @input="updateField(field, $event)"
            /></label>
            <PlanDateField v-if="current.value.type === 'event'" :key="`${current.scope}:${current.record?.object.id ?? 'new'}`" class="object-plan-date" :model-value="planDate" :disabled="editDisabled" @update:model-value="updatePlanDate" />
            <small v-if="current.value.type === 'event'"
              >{{ t('计划日期可精确到某天或具体时刻，有起止时间时选择「时间段」。时间按本地时区输入。勾选「需要完成」即可作为任务。') }}</small
            >
          </div>
          <p v-if="current.value.type === 'person' && !objectDetails" class="object-notice">
            {{ t('人物是工作区记录，不代表登录账号或访问权限。') }}
          </p>
          <label class="object-archive"
            ><input
              v-model="current.value.archived"
              type="checkbox"
              :disabled="editDisabled"
            />{{ personal ? t('归档（从计划中隐藏）') : t('归档（保留已有引用，停止推荐）') }}</label
          >
          <details>
            <summary>{{ t('结构化属性（JSON）') }}</summary>
            <label
              >{{ t('属性') }}<textarea
                v-model="current.json"
                :disabled="editDisabled"
                rows="6"
                spellcheck="false"
              /></label
            ><small>{{ t('事件可补充 owner、deadline 等属性；截止日期不等同于计划执行时间。') }}</small>
          </details>
          <code class="object-identity">{{ uri }}</code
          ><small v-if="current.record">{{ current.record.path }}</small>
          <p v-if="current.error" role="alert">{{ current.error }}</p>
          <footer>
            <button type="submit" :disabled="editDisabled">
              {{ busy ? t('保存中…') : t('保存对象') }}</button
            ><button
              v-if="current.record"
              type="button"
              :disabled="editDisabled"
              @click="save(true)"
            >
              {{ t('另存副本') }}</button
            ><button type="button" :disabled="busy" @click="resetDraft">{{ t('放弃草稿并重新读取') }}</button>
          </footer>
        </form>
        <div v-else-if="resource" class="object-panel-empty object-resource">
          <h3>{{ resource.name }}</h3>
          <p>{{ referenceTypeLabel(resource.type) }} {{ t('· Level 2-A · 文件资源') }}</p>
          <img
            v-if="previewUrl"
            class="object-asset-preview"
            :src="previewUrl"
            :alt="resource.name"
          />
          <dl>
            <dt>{{ t('路径') }}</dt>
            <dd>{{ resource.path }}</dd>
            <dt>{{ t('类型（按扩展名）') }}</dt>
            <dd>{{ resource.mime }}</dd>
            <dt>{{ t('大小') }}</dt>
            <dd>{{ resource.size }} {{ t('字节') }}</dd>
            <dt>{{ t('修改时间') }}</dt>
            <dd>{{ new Date(resource.modified ?? 0).toLocaleString() }}</dd>
          </dl>
          <code class="object-identity">{{ referenceUrl(resource) }}</code>
          <ReferenceConnections :identity="resource" :active="open" @open="openLinked" />
          <p>
            {{
              resource.type === 'document'
                ? t('正文仍保存在 Markdown 文件中；这里仅展示文件身份和元数据。')
                : t('原始文件保存在工作区；移动或重命名跟随文件 ID，不重复保存文件内容。')
            }}
          </p>
          <button
            :disabled="
              !store.capabilities.features.objectReferences ||
              (resource.type === 'asset' && !canOpenAsset)
            "
            @click="emit('openResource', resource)"
          >
            {{ resource.type === 'document' ? t('打开文档') : t('导出资产副本') }}
          </button>
          <p v-if="resource.type === 'asset' && !canOpenAsset">
            {{ t('当前模式仅展示资产元数据；打开或导出本地文件请使用桌面版。') }}
          </p>
        </div>
        <div v-else class="object-panel-empty">
          <h3>{{ t('让人与 Agent 引用同一个对象') }}</h3>
          <p>
            {{ t('创建人物或事件。事件勾选「需要完成」即可作为任务。文档和资产自动从工作区文件索引。关闭面板后，未保存的草稿会保留在本次会话中。') }}
          </p>
          <p>
            {{ t('文件资源：') }}{{
              resourceTypes.map((type) => type.category === 'core' ? t(type.label) : type.label).join(' / ')
            }}{{ t('。Paper、Dataset、代码仓库等领域类型由插件注册，不默认内置。') }}
          </p>
          <p>{{ t('在文档输入 @person:名称 可限定类型；使用 / 菜单的“对象引用”插入卡片。') }}</p>
        </div>
      </div>
    </section>
  </div>
</template>
