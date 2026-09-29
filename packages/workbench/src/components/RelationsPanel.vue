<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ArrowRight, GitFork, Plus, Trash2 } from 'lucide-vue-next';
import { acceptsRelationType, referenceKey, referenceTypeLabel } from '@tano/protocol';
import type { ReferenceIdentity, WorkspaceRelation } from '@tano/protocol';
import { useWorkspaceStore } from '../stores/workspace';
const store = useWorkspaceStore();
const emit = defineEmits<{ openObject: [identity: ReferenceIdentity]; objects: [] }>();
const source = ref(''),
  target = ref(''),
  type = ref('related');
const query = ref(''),
  focus = ref('');
const direction = ref<'both' | 'incoming' | 'outgoing'>('both');
const busy = ref(false),
  error = ref(''),
  status = ref('');
const targets = computed(() => store.referenceTargets.filter((item) => !item.archived));
const disabled = computed(
  () =>
    busy.value ||
    !!store.workspace?.readOnly ||
    !store.capabilities.features.objectReferences ||
    !!store.relationError,
);
const definition = computed(() =>
  store.relationDefinitions.find((item) => item.type === type.value),
);
const sources = computed(() =>
  targets.value.filter((item) =>
    acceptsRelationType(definition.value?.sourceTypes ?? [], item.type),
  ),
);
const destinations = computed(() =>
  targets.value.filter(
    (item) =>
      acceptsRelationType(definition.value?.targetTypes ?? [], item.type) &&
      referenceKey(item) !== source.value,
  ),
);
function name(identity: ReferenceIdentity) {
  return (
    store.referenceTargets.find((item) => referenceKey(item) === referenceKey(identity))?.name ??
    `不可用对象 ${identity.id}`
  );
}
function available(identity: ReferenceIdentity) {
  return store.referenceTargets.some((item) => referenceKey(item) === referenceKey(identity));
}
function label(type: string) {
  return (
    store.relationDefinitions.find((item) => item.type === type)?.label ?? `${type}（插件未启用）`
  );
}
const rows = computed(() => {
  const identity = store.referenceTargets.find((item) => referenceKey(item) === focus.value);
  const connections = identity
    ? store.relationIndex.connections(identity, direction.value)
    : store.relations;
  const text = query.value.toLocaleLowerCase();
  return connections.filter((row) =>
    `${name(row.source)} ${name(row.target)} ${row.source.id} ${row.target.id} ${label(row.type)}`
      .toLocaleLowerCase()
      .includes(text),
  );
});
watch([sources, destinations], () => {
  if (!sources.value.some((item) => referenceKey(item) === source.value)) source.value = '';
  if (!destinations.value.some((item) => referenceKey(item) === target.value)) target.value = '';
});
watch(
  () => store.relationDefinitions,
  (definitions) => {
    if (!definitions.some((item) => item.type === type.value)) type.value = 'related';
  },
);
watch(
  () => store.workspace?.id,
  () => {
    source.value = '';
    target.value = '';
    focus.value = '';
    error.value = '';
    status.value = '';
  },
);
async function save(row?: WorkspaceRelation) {
  if (disabled.value || !store.workspace) return;
  const workspace = store.workspace.id;
  busy.value = true;
  error.value = '';
  status.value = '';
  try {
    if (row) await store.removeRelation(row);
    else {
      const from = targets.value.find((item) => referenceKey(item) === source.value);
      const to = targets.value.find((item) => referenceKey(item) === target.value);
      if (!from || !to) throw new Error('请选择来源和目标对象');
      await store.createRelation(
        type.value,
        { type: from.type, id: from.id },
        { type: to.type, id: to.id },
      );
    }
    if (store.workspace?.id === workspace) status.value = row ? '关系已移除' : '关系已保存';
  } catch (cause) {
    if (store.workspace?.id === workspace) error.value = String(cause);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="tool-content relations-panel">
    <div class="tool-intro">
      <div>
        <h3>连接文档与对象</h3>
        <p>为负责人、项目成员、事件与资产建立有方向的关系。</p>
      </div>
      <button class="tool-secondary" @click="emit('objects')">管理对象 →</button>
    </div>
    <p v-if="store.relationError || error" class="tool-error" role="alert">
      {{ error || store.relationError }}
    </p>
    <p v-if="status" class="tool-success" role="status">{{ status }}</p>
    <form class="relation-composer" @submit.prevent="save()">
      <label
        >来源<select v-model="source" :disabled="disabled" required aria-label="关系来源">
          <option value="" disabled>选择来源对象</option>
          <option v-for="item in sources" :key="referenceKey(item)" :value="referenceKey(item)">
            {{ item.name }} · {{ referenceTypeLabel(item.type) }} · {{ item.id }}
          </option>
        </select></label
      >
      <label
        >关系<select v-model="type" :disabled="disabled" aria-label="关系类型">
          <option v-for="item in store.relationDefinitions" :key="item.type" :value="item.type">
            {{ item.label }}
          </option>
        </select></label
      >
      <label
        >目标<select v-model="target" :disabled="disabled" required aria-label="关系目标">
          <option value="" disabled>选择目标对象</option>
          <option
            v-for="item in destinations"
            :key="referenceKey(item)"
            :value="referenceKey(item)"
          >
            {{ item.name }} · {{ referenceTypeLabel(item.type) }} · {{ item.id }}
          </option>
        </select></label
      >
      <button class="tool-primary" :disabled="disabled || !source || !target">
        <Plus :size="16" />添加关系
      </button>
    </form>
    <div class="relation-filters">
      <input v-model="query" aria-label="搜索关系" placeholder="搜索名称、关系或 ID" /><select
        v-model="focus"
        aria-label="筛选对象"
      >
        <option value="">全部对象</option>
        <option
          v-for="item in store.referenceTargets"
          :key="referenceKey(item)"
          :value="referenceKey(item)"
        >
          {{ item.name }} · {{ referenceTypeLabel(item.type) }} · {{ item.id }}
        </option></select
      ><select v-model="direction" :disabled="!focus" aria-label="关系方向">
        <option value="both">全部方向</option>
        <option value="outgoing">出向关系</option>
        <option value="incoming">入向关系</option>
      </select>
    </div>
    <div class="tool-section-heading">
      <h3>
        关系 <span class="tool-count">{{ rows.length }}</span>
      </h3>
      <span class="tool-note">来源 → 目标</span>
    </div>
    <div v-if="!rows.length" class="tool-empty">
      <GitFork :size="34" />
      <h4>{{ store.relations.length ? '没有匹配的关系' : '从第一条关系开始' }}</h4>
      <p>例如：人物「Alice」负责 任务「发布版本」。</p>
    </div>
    <ul v-else class="relation-list">
      <li v-for="row in rows" :key="row.id">
        <button
          class="relation-endpoint"
          :disabled="!available(row.source)"
          @click="emit('openObject', row.source)"
        >
          <strong>{{ name(row.source) }}</strong
          ><small>{{ referenceTypeLabel(row.source.type) }} · {{ row.source.id }}</small>
        </button>
        <span class="relation-label">{{ label(row.type) }}<ArrowRight :size="16" /></span>
        <button
          class="relation-endpoint"
          :disabled="!available(row.target)"
          @click="emit('openObject', row.target)"
        >
          <strong>{{ name(row.target) }}</strong
          ><small>{{ referenceTypeLabel(row.target.type) }} · {{ row.target.id }}</small>
        </button>
        <button
          class="tool-icon"
          :disabled="disabled"
          :aria-label="`移除关系：${name(row.source)} ${label(row.type)} ${name(row.target)}`"
          title="移除这条关系"
          @click="save(row)"
        >
          <Trash2 :size="16" />
        </button>
      </li>
    </ul>
    <p class="tool-note">重命名和移动不影响关系。对象缺失或插件停用时保留连接，恢复后继续显示。</p>
  </div>
</template>
