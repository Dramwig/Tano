<script setup lang="ts">
import { t } from '../i18n';
import { computed, ref } from 'vue';
import { ArrowUpCircle, Check, Download, ExternalLink, LoaderCircle, RefreshCw } from 'lucide-vue-next';
import { useUpdatesStore } from '../stores/updates';
import type { SettingsSnapshot } from '../settings-window';
import { openExternalUrl } from '../attachments';
const props = defineProps<{ remote?: boolean; remoteState?: SettingsSnapshot['updates'] }>();
const emit = defineEmits<{ activate: [] }>();
const updates = useUpdatesStore();
const state = computed(() => props.remoteState ?? updates.state);
const downloaded = computed(() => (state.value.progress.downloaded / 1024 / 1024).toFixed(1));
const manual = computed(() => state.value.status?.manual === true);
const unconfigured = computed(() => state.value.status?.configured === false && !manual.value);
const externalError = ref('');
const title = computed(() => {
  if (unconfigured.value) return t('自动更新暂不可用');
  if (state.value.phase === 'current') return t('当前已是最新版本。');
  if (state.value.phase === 'available') return t('发现新版本 {0}', [state.value.candidate?.version ?? '']);
  if (state.value.phase === 'ready') return t('更新已准备就绪');
  if (state.value.phase === 'downloading') return t('正在下载更新');
  if (state.value.phase === 'installing') return t('正在安装更新');
  if (state.value.error) return t('检查更新失败');
  return t('软件更新');
});
const description = computed(() => {
  if (manual.value) return t('Tano Local 仅提示新版，请从公开发行版手动下载安装。');
  if (unconfigured.value) return state.value.status?.reason || t('此安装包未配置更新源，请从官网下载新版安装包。');
  if (state.value.phase === 'downloading') return `${t('正在下载并验证签名…')} ${downloaded.value} MiB`;
  if (state.value.phase === 'ready') return t('安装前会保存文档，随后重新启动 Tano。');
  return t('启动时自动检查更新，也可以在这里手动检查。');
});
const label = computed(() => {
  if (manual.value && state.value.candidate?.manualUrl) return t('查看发行版');
  switch (state.value.phase) {
    case 'checking': return t('正在检查更新');
    case 'available': return t('下载更新 {0}', [state.value.candidate?.version ?? '']).trim();
    case 'downloading': return t('正在下载更新');
    case 'ready': return t('保存并安装 {0}', [state.value.candidate?.version ?? '']).trim();
    case 'installing': return t('正在安装更新');
    default: return t('检查更新');
  }
});
const hint = computed(() =>
  state.value.phase === 'ready'
    ? t('更新包已验证。安装会先保存文档，然后退出并重新打开 Tano；离线协作草稿保留在本机。')
    : state.value.candidate?.notes || label.value,
);
function activate() {
  if (state.value.busy || unconfigured.value) return;
  if (manual.value && state.value.candidate?.manualUrl) {
    void openManualRelease(state.value.candidate.manualUrl);
    return;
  }
  if (props.remote) { emit('activate'); return; }
  if (state.value.phase === 'available') void updates.download();
  else if (state.value.phase === 'ready') void updates.install();
  else void updates.check();
}
async function openManualRelease(url: string) {
  externalError.value = '';
  if (!/^https:\/\/github\.com\/Dramwig\/Tano\/releases\/tag\/core-v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(url)) {
    externalError.value = t('Local 发行版链接无效');
    return;
  }
  try { await openExternalUrl(url); }
  catch (error) { externalError.value = String(error); }
}
async function openDownloads() {
  externalError.value = '';
  const localUrl = 'https://tano.page/zh-cn/download/#local';
  const url = state.value.status?.downloadUrl === localUrl ? localUrl : 'https://tano.page/zh-cn/download/';
  try { await openExternalUrl(url); }
  catch (error) { externalError.value = String(error); }
}
</script>

<template>
  <div class="update-panel" :aria-busy="state.busy">
    <div class="update-status-icon" :class="{ 'has-update': state.candidate }" aria-hidden="true">
      <LoaderCircle v-if="state.busy" :size="18" class="update-spinner" />
      <Check v-else-if="state.phase === 'current' || state.phase === 'ready'" :size="18" />
      <ArrowUpCircle v-else :size="19" />
    </div>
    <div class="update-copy">
      <h4 role="status" aria-live="polite">{{ title }}</h4>
      <p :role="unconfigured ? 'alert' : undefined">{{ description }}</p>
      <p v-if="state.error" class="update-error" role="alert">{{ state.error }}</p>
      <p v-if="externalError" class="update-error" role="alert">{{ externalError }}</p>
      <button v-if="manual" type="button" class="update-manual-link" @click="openDownloads">{{ t('前往官网下载') }}</button>
    </div>
    <button v-if="unconfigured" type="button" class="update-button" @click="openDownloads">
      <span>{{ t('前往官网下载') }}</span><ExternalLink :size="13" />
    </button>
    <button
      v-else
      type="button"
      class="update-button"
      :class="{ 'has-update': state.phase === 'available' || state.phase === 'ready' }"
      :disabled="state.busy"
      :data-tooltip="hint"
      @click="activate"
    >
      <LoaderCircle v-if="state.busy" :size="14" class="update-spinner" />
      <Download v-else-if="state.phase === 'available'" :size="14" />
      <RefreshCw v-else :size="14" />
      <span aria-live="polite">{{ label }}</span>
    </button>
  </div>
</template>

<style scoped>
.update-manual-link { border: 0; padding: 0; background: transparent; color: var(--muted); text-decoration: underline; cursor: pointer; font: inherit; }
.update-panel {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  line-height: 1.6;
}
.update-status-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--line);
  border-radius: 10px;
  color: var(--muted);
  background: var(--paper);
}
.update-status-icon.has-update { color: var(--green); }
.update-copy { min-width: 0; }
.update-copy h4 {
  margin: 0;
  color: var(--text);
  font-size: 13px;
  font-weight: 550;
}
.update-copy p {
  margin: 3px 0 0;
  color: var(--muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.update-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 32px;
  max-width: 100%;
  padding: 6px 11px;
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--text-secondary);
  background: var(--paper);
  font-size: 12px;
  font-family: inherit;
  white-space: nowrap;
  cursor: pointer;
  overflow-wrap: anywhere;
}
.update-button:hover:not(:disabled) {
  border-color: var(--control-border);
}
.update-panel .update-button.has-update {
  color: #fff;
  border-color: var(--green);
  background: var(--green);
}
.update-panel .update-button.has-update:hover:not(:disabled) {
  color: #fff;
  border-color: var(--green-hover);
  background: var(--green-hover);
}
.update-button:disabled { cursor: wait; opacity: .65; }
.update-button:focus-visible { outline: 2px solid var(--green); outline-offset: 3px; }
.update-panel .update-error {
  color: var(--warning);
}
.update-spinner {
  animation: update-spin 1s linear infinite;
}
@keyframes update-spin {
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  .update-spinner { animation: none; }
}
@media (max-width: 600px) {
  .update-panel { grid-template-columns: 32px minmax(0, 1fr); gap: 10px; }
  .update-status-icon { width: 32px; height: 32px; }
  .update-button { grid-column: 2; justify-self: start; }
}
</style>
