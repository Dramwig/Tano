<script setup lang="ts">
import { t } from '../i18n';
import { computed } from 'vue';
import { Download, LoaderCircle, RefreshCw } from 'lucide-vue-next';
import { useUpdatesStore } from '../stores/updates';
import type { SettingsSnapshot } from '../settings-window';
const props = defineProps<{ remote?: boolean; remoteState?: SettingsSnapshot['updates'] }>();
const emit = defineEmits<{ activate: [] }>();
const updates = useUpdatesStore();
const state = computed(() => props.remoteState ?? updates.state);
const downloaded = computed(() => (state.value.progress.downloaded / 1024 / 1024).toFixed(1));
const label = computed(() => {
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
  if (state.value.busy) return;
  if (props.remote) { emit('activate'); return; }
  if (state.value.phase === 'available') void updates.download();
  else if (state.value.phase === 'ready') void updates.install();
  else void updates.check();
}
</script>

<template>
  <div v-if="state.status?.configured" class="update-panel" :aria-busy="state.busy">
    <button
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
    <p v-if="state.phase === 'current'" role="status">{{ t('当前已是最新版本。') }}</p>
    <p v-else-if="state.phase === 'downloading'" role="status">
      {{ t('正在下载并验证签名…') }} {{ downloaded }} MiB
    </p>
    <p v-if="state.error" class="update-error" role="alert">{{ state.error }}</p>
  </div>
</template>

<style scoped>
.update-panel {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  max-width: min(240px, 100%);
  font-size: 12px;
  line-height: 1.7;
}
.update-panel p {
  margin: 6px 0 0;
  color: var(--muted);
  text-align: right;
  overflow-wrap: anywhere;
}
.update-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 28px;
  max-width: 100%;
  padding: 4px 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--text-secondary);
  background: var(--paper);
  font-size: 11px;
  overflow-wrap: anywhere;
}
.update-button:hover:not(:disabled) {
  border-color: var(--control-border);
}
.update-button.has-update {
  color: var(--green);
  border-color: var(--green);
}
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
</style>
