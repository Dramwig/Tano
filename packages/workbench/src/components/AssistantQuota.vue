<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import AssistantConnectionStatus from './AssistantConnectionStatus.vue';
import { Gauge, LoaderCircle, TriangleAlert } from 'lucide-vue-next';
import type { AssistantConnection, AssistantQuotaResult } from '@tano/protocol';
import { useAssistantStore } from '../assistant/store';
const props = defineProps<{ connection: AssistantConnection; request?: number }>();
const emit = defineEmits<{ loading: [boolean] }>();
const assistant = useAssistantStore();
const cached = assistant.connectionQuotaResults[props.connection.id];
const result = ref<AssistantQuotaResult | undefined>(cached?.fingerprint === JSON.stringify(props.connection) ? cached.result : undefined);
const error = ref('');
const loading = ref(false);
const primary = computed(() => result.value?.items.find(item => item.remaining != null));
const summary = computed(() => {
  if (primary.value) return `剩余 ${primary.value.remaining!.toLocaleString()}${primary.value.unit === '%' ? '%' : ` ${primary.value.unit ?? ''}`}`;
  if (loading.value) return '查询中';
  if (error.value) return '查询失败';
  return '查看额度';
});
watch(loading, value => emit('loading', value));
watch(() => props.request, () => { void refresh(); });
let generation = 0;
let timer: ReturnType<typeof setInterval> | undefined;
watch(() => JSON.stringify(props.connection), () => {
  clearInterval(timer);
  const minutes = props.connection.quota?.intervalMinutes ?? 0;
  if (!props.connection.managed && props.connection.quota?.mode !== 'disabled' && minutes > 0 && minutes <= 1440) {
    timer = setInterval(() => { if (!document.hidden) void refresh(); }, minutes * 60000);
  }
}, { immediate: true });
onBeforeUnmount(() => { clearInterval(timer); generation++; });
watch(() => JSON.stringify(props.connection), () => { generation++; result.value = undefined; error.value = ''; loading.value = false; });
async function refresh() {
  if (loading.value) return;
  const epoch = ++generation;
  loading.value = true; error.value = '';
  try {
    const value = await assistant.queryQuota(props.connection.id);
    if (epoch === generation) {
      result.value = value;
      assistant.connectionQuotaResults[props.connection.id] = { fingerprint: JSON.stringify(props.connection), result: value };
    }
  }
  catch (cause) { if (epoch === generation) error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { if (epoch === generation) loading.value = false; }
}
function resetTime(value: string) {
  const date = new Date(/^\d+$/.test(value) ? Number(value) * 1000 : value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
</script>
<template>
  <AssistantConnectionStatus class="connection-quota" :key="JSON.stringify(connection)" :label="'额度详情'" :summary="summary" :checked-at="result?.checkedAt" :refreshing="loading" :failed="!!error" v-if="(loading || result || error) && !connection.managed && connection.quota?.mode !== 'disabled' && (connection.kind === 'codex-cli' || connection.kind === 'claude-cli' || connection.quota)">
    <template #icon>
      <LoaderCircle v-if="loading" :size="14" class="spinning" aria-hidden="true" />
      <TriangleAlert v-else-if="error" :size="14" aria-hidden="true" />
      <Gauge v-else :size="14" aria-hidden="true" />
    </template>
      <p v-if="loading" role="status">正在查询额度…</p>
      <p v-if="error" class="quota-error" role="alert">{{ error }}{{ result ? '（保留上次结果）' : '' }}</p>
      <template v-if="result">
        <section v-for="(item, index) in result.items" :key="index" class="quota-item">
          <strong>{{ item.label }}</strong>
          <dl>
            <div v-if="item.remaining != null"><dt>剩余</dt><dd>{{ item.remaining.toLocaleString() }} {{ item.unit }}</dd></div>
            <div v-if="item.used != null"><dt>已用</dt><dd>{{ item.used.toLocaleString() }} {{ item.unit }}</dd></div>
            <div v-if="item.total != null"><dt>总额</dt><dd>{{ item.total.toLocaleString() }} {{ item.unit }}</dd></div>
          </dl>
          <small v-if="item.resetsAt">重置：{{ resetTime(item.resetsAt) }}</small>
        </section>
        <footer>查询于 {{ new Date(result.checkedAt).toLocaleString() }}</footer>
      </template>
  </AssistantConnectionStatus>
</template>
<style scoped>
.quota-item + .quota-item { border-top: 1px solid var(--line); margin-top: 12px; padding-top: 12px; }
.quota-item strong { font-size: 12px; font-weight: 500; }
.quota-item dl { display: grid; gap: 7px; margin: 10px 0; }
.quota-item dl div { display: flex; justify-content: space-between; gap: 16px; }
.quota-item dt, .quota-item small, footer { color: var(--muted); }
.quota-item dd { margin: 0; font-variant-numeric: tabular-nums; text-align: right; }
footer { margin-top: 14px; font-size: 11px; }
.quota-error { color: var(--danger); }
</style>
