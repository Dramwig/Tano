<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { AssistantConnection, AssistantSession } from '@tano/protocol';
import { t, uiLocale } from '../i18n';

const props = defineProps<{ sessions: AssistantSession[]; connections?: AssistantConnection[]; activeSession?: AssistantSession | null; loading?: boolean; demo?: boolean }>();
const days = ref(7);
const model = ref('');
const channel = ref('');
const unknownChannel = '__unrecorded__';
const page = ref(1);
const now = ref(Date.now());
const timer = setInterval(() => { now.value = Date.now(); }, 60_000);
onBeforeUnmount(() => clearInterval(timer));
const number = (value: number) => value.toLocaleString(uiLocale.value);
const date = (value: number, full = false) => new Date(value).toLocaleString(uiLocale.value, full
  ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }
  : { month: 'numeric', day: 'numeric' });
const rows = computed(() => {
  const sessions = new Map(props.sessions.map(session => [session.id, session]));
  if (props.activeSession) sessions.set(props.activeSession.id, props.activeSession);
  return [...sessions.values()].flatMap(session => session.messages.filter(message => message.role === 'assistant').map(message => ({
    ...message, key: `${session.id}:${message.id}`, title: session.title,
    // Older messages without a recorded model must not inherit the session's current selection.
    model: message.model ?? '',
  }))).sort((a, b) => b.createdAt - a.createdAt);
});
const channels = computed(() => {
  const choices = new Map((props.connections ?? []).map(connection => [connection.id, connection.name]));
  for (const row of rows.value) if (row.connectionId && !choices.has(row.connectionId)) choices.set(row.connectionId, row.connectionName || row.connectionId);
  return [...choices].map(([id, name]) => ({ id, name }));
});
const channelRows = computed(() => rows.value.filter(row => !channel.value || (channel.value === unknownChannel ? !row.connectionId : row.connectionId === channel.value)));
const models = computed(() => [...new Set(channelRows.value.map(row => row.model).filter(Boolean))].sort());
const channelName = (id?: string, name?: string) => id ? channels.value.find(channel => channel.id === id)?.name ?? name ?? id : t('未记录渠道');
watch(rows, () => { now.value = Date.now(); });
const start = computed(() => { const value = new Date(now.value); value.setHours(0, 0, 0, 0); value.setDate(value.getDate() - days.value + 1); return value.getTime(); });
const filtered = computed(() => channelRows.value.filter(row => row.createdAt >= start.value && row.createdAt <= now.value && (!model.value || row.model === model.value)));
const totals = computed(() => filtered.value.reduce((sum, row) => ({
  input: sum.input + (row.usage?.input ?? 0), output: sum.output + (row.usage?.output ?? 0), reported: sum.reported + Number(!!row.usage),
}), { input: 0, output: 0, reported: 0 }));
const buckets = computed(() => Array.from({ length: days.value }, (_, index) => {
  const day = new Date(start.value); day.setDate(day.getDate() + index);
  const end = new Date(day); end.setDate(end.getDate() + 1);
  const records = filtered.value.filter(row => row.createdAt >= day.getTime() && row.createdAt < end.getTime());
  return { time: day.getTime(), input: records.reduce((sum, row) => sum + (row.usage?.input ?? 0), 0), output: records.reduce((sum, row) => sum + (row.usage?.output ?? 0), 0) };
}));
const maximum = computed(() => Math.max(1, ...buckets.value.map(day => day.input + day.output)));
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / 10)));
const visibleRows = computed(() => filtered.value.slice((page.value - 1) * 10, page.value * 10));
watch([days, model, channel], () => { page.value = 1; });
watch(channels, values => { if (channel.value && channel.value !== unknownChannel && !values.some(item => item.id === channel.value)) channel.value = ''; });
watch(pages, count => { page.value = Math.min(page.value, count); });
watch(models, values => { if (model.value && !values.includes(model.value)) model.value = ''; });
const states: Record<string, string> = { running: '执行中', waiting: '等待中', completed: '已完成', cancelled: '已取消', failed: '失败', interrupted: '已中断' };
</script>

<template>
  <section class="settings-section assistant-usage" data-settings-key="assistant-usage" aria-labelledby="assistant-usage-title" :aria-busy="loading">
    <h3 id="assistant-usage-title">{{ t('用量概览') }}</h3>
    <p class="settings-section-description">{{ t('统计当前工作区保留的会话，按本地日期汇总；删除会话会移除对应统计。Token 仅计入已报告用量，不代表账单。') }}</p>
    <p v-if="demo" class="usage-note">{{ t('浏览器演示用量为模拟数据。') }}</p>
    <p v-if="loading" role="status" class="usage-note">{{ t('正在加载用量…') }}</p>
    <div class="usage-filters">
      <div class="usage-filter-scope">
        <select v-model="channel" :aria-label="t('筛选连接渠道')"><option value="">{{ t('全部渠道') }}</option><option v-for="item in channels" :key="item.id" :value="item.id">{{ item.name }}</option><option v-if="rows.some(row => !row.connectionId)" :value="unknownChannel">{{ t('未记录渠道') }}</option></select>
        <select v-model="model" :aria-label="t('筛选模型')"><option value="">{{ t('全部模型') }}</option><option v-for="item in models" :key="item" :value="item">{{ item }}</option></select>
      </div>
      <div class="usage-period" role="group" :aria-label="t('统计时间范围')">
        <button v-for="period in [7, 30]" :key="period" type="button" :aria-pressed="days === period" @click="days = period">{{ period === 7 ? t('近 7 天') : t('近 30 天') }}</button>
      </div>
    </div>
    <div class="usage-summary">
    <div class="usage-metrics">
      <div><span>{{ t('助手回复') }}</span><strong>{{ number(filtered.length) }}</strong></div>
      <div><span>{{ t('输入 Token') }}</span><strong>{{ totals.reported ? number(totals.input) : '—' }}</strong></div>
      <div><span>{{ t('输出 Token') }}</span><strong>{{ totals.reported ? number(totals.output) : '—' }}</strong></div>
      <div><span>{{ t('总 Token') }}</span><strong>{{ totals.reported ? number(totals.input + totals.output) : '—' }}</strong></div>
    </div>
    <div class="usage-chart-card">
      <div class="usage-chart-heading"><span>{{ t('每日 Token 用量') }}</span><div class="usage-legend"><span><i class="input-key" />{{ t('输入') }}</span><span><i class="output-key" />{{ t('输出') }}</span></div></div>
      <div class="usage-chart-plot">
      <div class="usage-chart" :aria-label="t('每日 Token 用量')" role="list">
        <div v-for="(day, index) in buckets" :key="day.time" class="usage-day" role="listitem" tabindex="0" :aria-label="`${date(day.time)} · ${t('输入 Token')} ${number(day.input)} · ${t('输出 Token')} ${number(day.output)}`" :title="`${date(day.time)} · ${t('输入')} ${number(day.input)} · ${t('输出')} ${number(day.output)}`">
          <div class="usage-bar-track"><div class="usage-bar output-key" :style="{ height: `${day.output / maximum * 100}%` }" /><div class="usage-bar input-key" :style="{ height: `${day.input / maximum * 100}%` }" /></div>
          <span>{{ days === 7 || index === 0 || index === days - 1 || (index % 7 === 0 && index < days - 3) ? date(day.time) : '\u00a0' }}</span>
        </div>
      </div>
      <p v-if="!totals.reported" class="usage-note usage-chart-empty">{{ t('所选范围暂无已报告的 Token 用量。') }}</p>
      </div>
    </div>
    </div>
  </section>
  <section class="settings-section assistant-usage-details" aria-labelledby="assistant-usage-details-title">
    <h3 id="assistant-usage-details-title">{{ t('使用详情') }}</h3>
    <div class="usage-table-scroll" tabindex="0" :aria-label="t('使用详情')" role="region">
      <table>
        <caption class="usage-sr-only">{{ t('使用详情') }}</caption>
        <thead><tr><th scope="col">{{ t('时间 / 会话') }}</th><th scope="col">{{ t('连接渠道') }}</th><th scope="col">{{ t('模型') }}</th><th scope="col">{{ t('输入 Token') }}</th><th scope="col">{{ t('输出 Token') }}</th><th scope="col">{{ t('耗时') }}</th><th scope="col">{{ t('状态') }}</th></tr></thead>
        <tbody><tr v-for="row in visibleRows" :key="row.key"><td><time :datetime="new Date(row.createdAt).toISOString()">{{ date(row.createdAt, true) }}</time><span class="usage-session" :title="row.title">{{ row.title || t('未命名会话') }}</span></td><td><span class="usage-model" :title="channelName(row.connectionId, row.connectionName)">{{ channelName(row.connectionId, row.connectionName) }}</span></td><td><span class="usage-model" :title="row.model">{{ row.model || t('未报告') }}</span></td><td>{{ row.usage ? number(row.usage.input) : t('未报告') }}</td><td>{{ row.usage ? number(row.usage.output) : t('未报告') }}</td><td>{{ row.timing ? `${number(Math.round(row.timing.totalMs / 100) / 10)} s` : '—' }}</td><td><span class="usage-status" :data-state="row.state">{{ t(states[row.state ?? ''] ?? '未报告') }}</span></td></tr>
        <tr v-if="!visibleRows.length"><td colspan="7" class="usage-empty">{{ loading ? t('正在加载用量…') : t('所选范围暂无使用记录。') }}</td></tr></tbody>
      </table>
    </div>
    <div v-if="filtered.length > 10" class="usage-pagination"><button type="button" :disabled="page <= 1" @click="page--">{{ t('上一页') }}</button><span aria-live="polite">{{ t('第 {0} / {1} 页', [page, pages]) }}</span><button type="button" :disabled="page >= pages" @click="page++">{{ t('下一页') }}</button></div>
  </section>
</template>

<style scoped>
.assistant-usage, .assistant-usage-details { min-width: 0; }
.assistant-usage > h3, .assistant-usage-details > h3 { border-bottom: 0; padding-bottom: 0; margin-bottom: 8px; }
.assistant-usage > .settings-section-description, .assistant-usage-details > .settings-section-description { margin-top: 0; }
.usage-filters { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin: 20px 0 16px; }
.usage-filter-scope { display: flex; gap: 8px; min-width: 0; }
.usage-filter-scope select { width: 144px; max-width: 100%; min-width: 0; height: 32px; padding: 5px 26px 5px 10px; appearance: none; border: 1px solid var(--line); border-radius: 6px; background-color: var(--paper); color: var(--text); font: inherit; font-size: 12px; text-overflow: ellipsis; cursor: pointer; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='none' stroke='%23858b90' stroke-width='1.3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m3 4.5 3 3 3-3'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 9px center; }
.usage-filter-scope select:hover { border-color: var(--control-border); }
.usage-period { display: flex; flex-shrink: 0; gap: 2px; padding: 3px; background: var(--hover); border-radius: 7px; }
.usage-period button { padding: 5px 12px; border: 0; border-radius: 5px; color: var(--muted); background: transparent; font: inherit; font-size: 12px; white-space: nowrap; cursor: pointer; }
.usage-period button[aria-pressed='true'] { background: var(--paper); color: var(--text); box-shadow: 0 1px 3px #00000012; }
.usage-period button:hover { color: var(--text); }
.usage-period button:focus-visible, .usage-filter-scope select:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
.usage-summary { padding: 24px 20px 20px; border: 1px solid var(--line); border-radius: 8px; background: color-mix(in srgb, var(--hover) 30%, var(--paper)); }
.usage-chart-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.usage-pagination button { background: var(--surface); color: inherit; border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; font: inherit; font-size: 12px; }
.usage-note { color: var(--muted); font-size: 12px; line-height: 1.7; }
.usage-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 0 0 24px; }
.usage-metrics > div { min-width: 0; }
.usage-metrics span { display: block; font-size: 12px; color: var(--muted); }
.usage-metrics > div:last-child strong { color: var(--green); }
.usage-metrics strong { display: block; margin-top: 8px; font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.usage-chart-card { padding: 0; }
.usage-chart-heading { font-size: 12px; }
.usage-legend, .usage-legend span { display: flex; align-items: center; gap: 6px; }
.usage-legend { gap: 14px; color: var(--muted); }
.usage-legend i { height: 7px; width: 7px; border-radius: 2px; }
.input-key { background: #39806b; }
.output-key { background: #9fcab9; }
.usage-chart-plot { position: relative; margin-top: 16px; }
.usage-chart { display: flex; gap: 4px; }
.usage-chart-empty { position: absolute; inset: 0 0 auto; height: 100px; margin: 0; padding: 0 12px; display: flex; align-items: center; justify-content: center; text-align: center; pointer-events: none; }
.usage-day { flex: 1; min-width: 0; text-align: center; font-size: 10px; color: var(--muted); }
.usage-day:focus-visible { outline: 2px solid #39806b; outline-offset: 2px; }
.usage-bar-track { height: 100px; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; border-bottom: 1px solid var(--line); margin-bottom: 8px; }
.usage-bar { width: 65%; max-width: 28px; flex-shrink: 0; }
.usage-day > span { white-space: nowrap; }
.usage-table-scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 12px; text-align: left; white-space: nowrap; }
th { color: var(--muted); font-weight: 400; }
th, td { padding: 12px 8px; border-bottom: 1px solid var(--line); font-variant-numeric: tabular-nums; }
th:first-child, td:first-child { padding-left: 0; }
.usage-session { display: block; color: var(--muted); margin-top: 4px; max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
.usage-model { display: block; max-width: 130px; overflow: hidden; text-overflow: ellipsis; }
.usage-status[data-state="completed"] { color: #39806b; }
.usage-status[data-state="failed"] { color: var(--danger, #b34e4e); }
.usage-empty { text-align: center; padding: 28px; color: var(--muted); }
.usage-pagination { display: flex; justify-content: flex-end; align-items: center; gap: 12px; margin-top: 12px; font-size: 12px; }
.usage-pagination button:disabled { opacity: .4; }
.usage-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
@media (max-width: 600px) { .usage-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; } .usage-summary { padding: 20px 12px 16px; } .usage-filter-scope { flex: 1 1 100%; } .usage-filter-scope select { flex: 1; width: 0; } .usage-period { margin-left: auto; } }
</style>
