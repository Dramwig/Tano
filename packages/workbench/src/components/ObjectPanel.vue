<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { referenceTypeLabel, referenceUrl } from '@tano/protocol';
import type {
  WorkspaceObject,
  ReferenceIdentity,
  ReferenceTarget,
  ObjectField,
} from '@tano/protocol';
import type { ObjectRecord } from '../workspace-objects';
import { useWorkspaceStore } from '../stores/workspace';

const props = defineProps<{
  selectedId?: string;
  open: boolean;
  canOpenAsset?: boolean;
  canImportAsset?: boolean;
  previewAsset?: (target: ReferenceTarget) => string | null;
}>();
const emit = defineEmits<{
  close: [];
  openResource: [identity: ReferenceIdentity];
  createDocument: [];
  importAsset: [];
}>();
const store = useWorkspaceStore();
interface Draft {
  workspace: string;
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
  store.referenceTargets.find(
    (target) => target.id === resourceId.value && ['document', 'asset'].includes(target.type),
  ),
);
const previewUrl = computed(() => (resource.value ? props.previewAsset?.(resource.value) : null));
const resourceTypes = computed(() =>
  store.objectDefinitions.filter((type) => type.storage === 'resource'),
);
const recordTypes = computed(() =>
  store.objectDefinitions.filter((type) => type.storage === 'record'),
);
const definition = computed(() =>
  recordTypes.value.find((type) => type.type === current.value?.value.type),
);
const editDisabled = computed(() => disabled.value || !definition.value);
const resources = computed(() =>
  store.referenceTargets.filter(
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
  () =>
    !store.workspace ||
    store.workspace.readOnly ||
    !store.capabilities.features.objectReferences ||
    busy.value,
);
const filtered = computed(() =>
  store.objects.filter(({ object }) =>
    `${object.name} ${referenceTypeLabel(object.type)}`
      .toLowerCase()
      .includes(search.value.toLowerCase()),
  ),
);
function select(record?: ObjectRecord) {
  const workspace = store.workspace?.id;
  if (!workspace || busy.value) return;
  resourceId.value = undefined;
  const key = `${workspace}:${record?.object.id ?? 'new'}`;
  let draft = drafts.get(key);
  if (!draft) {
    const value: WorkspaceObject = record
      ? JSON.parse(JSON.stringify(record.object))
      : {
          version: 1,
          id: '',
          type: 'person',
          name: '',
          description: '',
          archived: false,
          properties: {},
        };
    draft = {
      workspace,
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
  [() => store.workspace?.id, () => props.selectedId, () => props.open],
  ([workspaceId, , open], previous) => {
    if (!open && workspaceId === previous?.[0]) return;
    current.value = undefined;
    resourceId.value = undefined;
    if (props.selectedId) {
      const record = store.objects.find(({ object }) => object.id === props.selectedId);
      if (record) select(record);
      else resourceId.value = props.selectedId;
    }
  },
  { immediate: true },
);
async function save(copy = false) {
  const draft = current.value;
  if (!draft || editDisabled.value || draft.workspace !== store.workspace?.id) return;
  draft.error = '';
  busy.value = true;
  try {
    const properties = JSON.parse(draft.json);
    if (!properties || typeof properties !== 'object' || Array.isArray(properties))
      throw new Error('属性必须是 JSON 对象');
    const value = { ...draft.value, name: draft.value.name.trim(), properties };
    const saved =
      draft.record && !copy
        ? await store.updateObject(draft.record, value, draft.workspace)
        : await store.createObject(value);
    if (current.value !== draft || store.workspace?.id !== draft.workspace) return;
    drafts.delete(`${draft.workspace}:${draft.record?.object.id ?? 'new'}`);
    drafts.delete(`${draft.workspace}:${saved.object.id}`);
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
      throw new Error('请先修正结构化属性 JSON');
    const input = event.target as HTMLInputElement;
    if (field.type === 'boolean') properties[field.key] = input.checked;
    else if (!input.value) delete properties[field.key];
    else
      properties[field.key] =
        field.type === 'datetime'
          ? new Date(input.value).toISOString()
          : field.type === 'number'
            ? Number(input.value)
            : input.value;
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
  const record = store.objects.find(({ object }) => object.id === current.value?.record?.object.id);
  drafts.delete(`${current.value.workspace}:${current.value.record?.object.id ?? 'new'}`);
  select(record);
}
const uri = computed(() =>
  current.value?.record
    ? referenceUrl({
        type: current.value.value.type,
        id: current.value.value.id,
      })
    : '保存后生成唯一 ID',
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
      aria-label="工作区对象"
      @keydown.esc="emit('close')"
      @keydown="trapFocus"
    >
      <header>
        <div>
          <h2>工作区对象 <small>Level 2 · 核心与插件对象</small></h2>
          <p>内置任务、项目、人物、文档、日历事件和资产，也可安装领域插件。引用绑定唯一 ID。</p>
        </div>
        <button aria-label="关闭工作区对象" @click="emit('close')">关闭</button>
      </header>
      <p v-if="!store.capabilities.features.objectReferences" class="object-notice">
        Level 2 已关闭。现有对象和引用仍保留，可在工作区设置中重新启用。
      </p>
      <p v-if="store.isDemo" class="object-notice">浏览器演示存储：对象保存在当前浏览器中。</p>
      <p v-for="error in store.objectErrors" :key="error" role="alert">{{ error }}</p>
      <div class="object-panel-body">
        <aside>
          <input v-model="search" aria-label="搜索工作区对象" placeholder="搜索对象" />
          <button :disabled="disabled" @click="select()">＋ 新建对象</button>
          <div class="object-resource-actions">
            <button :disabled="disabled" @click="emit('createDocument')">新建文档</button
            ><button v-if="canImportAsset" :disabled="disabled" @click="emit('importAsset')">
              导入资产
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
                  ? 'Level 2-A'
                  : '插件对象'
              }}{{ record.object.archived ? ' · 已归档' : '' }}</small
            >
          </button>
          <small v-if="resources.length">文件资源 · Level 2-A</small>
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
            暂无对象。创建后，在文档中输入 @ 或 [[ 选择引用。
          </p>
        </aside>
        <form v-if="current" @submit.prevent="save()">
          <label
            >类别 · {{ definition?.category === 'plugin' ? '插件对象' : 'Level 2-A'
            }}<select v-model="current.value.type" :disabled="disabled || !!current.record">
              <option v-if="!definition" :value="current.value.type">
                {{ referenceTypeLabel(current.value.type) }}
              </option>
              <option v-for="type in recordTypes" :key="type.type" :value="type.type">
                {{ type.label }}
              </option>
            </select></label
          >
          <label
            >名称<input
              v-model="current.value.name"
              :disabled="editDisabled"
              required
              maxlength="200"
          /></label>
          <label
            >描述<textarea
              v-model="current.value.description"
              :disabled="editDisabled"
              rows="4"
              maxlength="20000"
            />
          </label>
          <p v-if="!definition" class="object-notice">
            此类型不属于内置核心对象，且未注册对应插件。文件和既有引用已保留，当前只读，不参与引用推荐。
          </p>
          <div v-if="definition?.fields.length" class="object-fields">
            <label v-for="field in definition.fields" :key="field.key"
              >{{ field.label }}{{ field.required ? ' *' : ''
              }}<input
                :type="
                  field.type === 'datetime'
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
                :disabled="editDisabled"
                @input="updateField(field, $event)"
            /></label>
            <small v-if="current.value.type === 'event'"
              >按本地时区输入，保存时包含时区。可从侧栏日历查看；提醒和重复事件尚未实现。</small
            >
          </div>
          <p v-if="current.value.type === 'person'" class="object-notice">
            人物是工作区记录，不代表登录账号或访问权限。
          </p>
          <label class="object-archive"
            ><input
              v-model="current.value.archived"
              type="checkbox"
              :disabled="editDisabled"
            />归档（保留已有引用，停止推荐）</label
          >
          <details>
            <summary>结构化属性（JSON）</summary>
            <label
              >属性<textarea
                v-model="current.json"
                :disabled="editDisabled"
                rows="6"
                spellcheck="false"
              /></label
            ><small>任务可记录 status、owner、deadline 等属性。</small>
          </details>
          <code class="object-identity">{{ uri }}</code
          ><small v-if="current.record">{{ current.record.path }}</small>
          <p v-if="current.error" role="alert">{{ current.error }}</p>
          <footer>
            <button type="submit" :disabled="editDisabled">
              {{ busy ? '保存中…' : '保存对象' }}</button
            ><button
              v-if="current.record"
              type="button"
              :disabled="editDisabled"
              @click="save(true)"
            >
              另存副本</button
            ><button type="button" :disabled="busy" @click="resetDraft">放弃草稿并重新读取</button>
          </footer>
        </form>
        <div v-else-if="resource" class="object-panel-empty object-resource">
          <h3>{{ resource.name }}</h3>
          <p>{{ referenceTypeLabel(resource.type) }} · Level 2-A · 文件资源</p>
          <img
            v-if="previewUrl"
            class="object-asset-preview"
            :src="previewUrl"
            :alt="resource.name"
          />
          <dl>
            <dt>路径</dt>
            <dd>{{ resource.path }}</dd>
            <dt>类型（按扩展名）</dt>
            <dd>{{ resource.mime }}</dd>
            <dt>大小</dt>
            <dd>{{ resource.size }} 字节</dd>
            <dt>修改时间</dt>
            <dd>{{ new Date(resource.modified ?? 0).toLocaleString() }}</dd>
          </dl>
          <code class="object-identity">{{ referenceUrl(resource) }}</code>
          <p>
            {{
              resource.type === 'document'
                ? '正文仍保存在 Markdown 文件中；这里仅展示文件身份和元数据。'
                : '原始文件保存在工作区；移动或重命名跟随文件 ID，不重复保存文件内容。'
            }}
          </p>
          <button
            :disabled="
              !store.capabilities.features.objectReferences ||
              (resource.type === 'asset' && !canOpenAsset)
            "
            @click="emit('openResource', resource)"
          >
            {{ resource.type === 'document' ? '打开文档' : '导出资产副本' }}
          </button>
          <p v-if="resource.type === 'asset' && !canOpenAsset">
            当前模式仅展示资产元数据；打开或导出本地文件请使用桌面版。
          </p>
        </div>
        <div v-else class="object-panel-empty">
          <h3>让人与 Agent 引用同一个对象</h3>
          <p>
            创建人物、任务、项目或日历事件。文档和资产自动从工作区文件索引，正文和文件内容保持原样。关闭面板后，未保存的草稿会保留在本次会话中。
          </p>
          <p>
            文件资源：{{
              resourceTypes.map((type) => type.label).join('、')
            }}。Paper、Dataset、代码仓库等领域类型由插件注册，不默认内置。
          </p>
          <p>在文档输入 @person:名称 可限定类型；使用 / 菜单的“对象引用”插入卡片。</p>
        </div>
      </div>
    </section>
  </div>
</template>
