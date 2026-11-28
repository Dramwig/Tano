<script setup lang="ts">
// SPDX-License-Identifier: MIT
import { computed, onMounted, ref, type Ref } from 'vue';
import { FileCode2, Monitor, MoreHorizontal, Plus, PlugZap, Server, Trash2 } from 'lucide-vue-next';
import { t } from '../../i18n/i18n';
import { useSshStore } from '../store';
import type { RemoteTrashMode, SshHostProfile, SshSettings } from '../types';
import SshConfigImportModal from './SshConfigImportModal.vue';

const ssh = useSshStore();
const error = ref('');
const importOpen = ref(false);

function reportError(reason: unknown) {
  error.value = reason instanceof Error ? reason.message : String(reason);
}

function openManualAdd() {
  importOpen.value = false;
  ssh.openConnectModal(null, { newHost: true });
}

function addServer() {
  if (ssh.importableConfigHosts.length) importOpen.value = true;
  else openManualAdd();
}

async function removeServer(host: SshHostProfile) {
  error.value = '';
  try {
    if (host.source === 'ssh-config') ssh.removeConfigHost(host.id);
    else await ssh.removeHost(host.id);
  } catch (reason) {
    reportError(reason);
  }
}

function hostAddress(host: SshHostProfile) {
  return `${host.username}@${host.host}${host.port === 22 ? '' : `:${host.port}`}`;
}

// ── Connection preferences (saved on change, like other settings pages) ──
const trashMode = ref<RemoteTrashMode>('remote-trash');
const pollIntervalSecs = ref(3);
const keepaliveSecs = ref(15);
const connectTimeoutSecs = ref(15);

interface NumberPref {
  key: 'pollIntervalSecs' | 'keepaliveSecs' | 'connectTimeoutSecs';
  model: Ref<number>;
  min: number;
  max: number;
  fallback: number;
  title: string;
  hint: string;
}

const numberPrefs = computed<NumberPref[]>(() => [
  {
    key: 'pollIntervalSecs',
    model: pollIntervalSecs,
    min: 1,
    max: 60,
    fallback: 3,
    title: t('文件变更轮询间隔'),
    hint: t('服务器不支持 inotify 时，按此间隔检查远端文件变化。'),
  },
  {
    key: 'keepaliveSecs',
    model: keepaliveSecs,
    min: 5,
    max: 300,
    fallback: 15,
    title: t('心跳保活'),
    hint: t('定期发送心跳，防止空闲连接被网络设备断开。'),
  },
  {
    key: 'connectTimeoutSecs',
    model: connectTimeoutSecs,
    min: 5,
    max: 120,
    fallback: 15,
    title: t('连接超时'),
    hint: t('超过此时间仍未建立连接时放弃并报错。'),
  },
]);

function syncPreferenceRefs() {
  trashMode.value = ssh.settings.trashMode;
  pollIntervalSecs.value = ssh.settings.pollIntervalSecs;
  keepaliveSecs.value = ssh.settings.keepaliveSecs;
  connectTimeoutSecs.value = ssh.settings.connectTimeoutSecs;
}

async function reloadAll() {
  error.value = '';
  try {
    await Promise.all([ssh.loadHosts(), ssh.loadSettings()]);
    syncPreferenceRefs();
  } catch (reason) {
    reportError(reason);
  }
}

function clamp(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

async function savePreferences() {
  error.value = '';
  for (const pref of numberPrefs.value) {
    pref.model.value = clamp(Number(pref.model.value), pref.min, pref.max, pref.fallback);
  }
  const next: SshSettings = {
    trashMode: trashMode.value,
    pollIntervalSecs: pollIntervalSecs.value,
    keepaliveSecs: keepaliveSecs.value,
    connectTimeoutSecs: connectTimeoutSecs.value,
  };
  const current = ssh.settings;
  if ((Object.keys(next) as (keyof SshSettings)[]).every((key) => next[key] === current[key])) return;
  try {
    await ssh.saveSettings(next);
  } catch (reason) {
    reportError(reason);
    syncPreferenceRefs();
  }
}

onMounted(() => {
  void reloadAll();
});
</script>

<template>
  <div class="ssh-settings-page">
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>

    <section class="settings-section" :aria-label="t('SSH 服务器')">
      <div class="settings-section-heading ssh-heading">
        <h3>{{ t('SSH 服务器') }}</h3>
        <button v-if="ssh.allHosts.length" type="button" class="secondary-button ssh-inline-btn" @click="addServer">
          <Plus :size="14" /> {{ t('添加') }}
        </button>
      </div>

      <div v-if="ssh.allHosts.length" class="ssh-list-card">
        <div v-for="host in ssh.allHosts" :key="host.id" class="ssh-list-item">
          <span class="ssh-host-icon"><Monitor :size="15" /></span>
          <div class="ssh-item-text">
            <div class="ssh-host-title">
              <strong>{{ host.name }}</strong>
              <span
                v-if="host.source === 'ssh-config'"
                class="ssh-source-pill"
                :title="ssh.configPath ?? '~/.ssh/config'"
              >
                <FileCode2 :size="11" /> ssh config
              </span>
            </div>
            <code>{{ hostAddress(host) }}</code>
          </div>
          <div class="ssh-host-actions">
            <button
              type="button"
              class="icon-button ssh-item-remove"
              :title="host.source === 'ssh-config' ? t('从列表移除') : t('删除服务器')"
              :aria-label="host.source === 'ssh-config' ? t('从列表移除') : t('删除服务器')"
              @click="removeServer(host)"
            >
              <Trash2 :size="14" />
            </button>
            <button type="button" class="secondary-button ssh-inline-btn" @click="ssh.openConnectModal(host.id)">
              <PlugZap :size="13" /> {{ t('连接') }}
            </button>
          </div>
        </div>
      </div>

      <div v-else class="ssh-empty-card">
        <div class="ssh-empty-art" aria-hidden="true">
          <Monitor :size="20" />
          <MoreHorizontal :size="16" />
          <Server :size="20" />
        </div>
        <p>{{ t('通过 SSH 连接到远程设备') }}</p>
        <button type="button" class="primary-button ssh-inline-btn" @click="addServer">
          <Plus :size="14" /> {{ t('添加 SSH 连接') }}
        </button>
      </div>

      <SshConfigImportModal :open="importOpen" @close="importOpen = false" @manual="openManualAdd" />
    </section>

    <section class="settings-section" :aria-label="t('连接与文件行为')">
      <h3>{{ t('连接与文件行为') }}</h3>
      <div class="settings-card" data-surface-role="section">
        <div class="settings-row">
          <div>
            <strong>{{ t('删除远端文件') }}</strong>
            <p>{{ t('推荐移至服务器上的 ~/.tano/trash/，误删后仍可找回。') }}</p>
          </div>
          <select v-model="trashMode" class="ssh-wide-select" :aria-label="t('删除远端文件')" @change="savePreferences">
            <option value="remote-trash">{{ t('移至远端回收目录') }}</option>
            <option value="permanent-delete">{{ t('直接永久删除') }}</option>
          </select>
        </div>
        <div v-for="pref in numberPrefs" :key="pref.key" class="settings-row">
          <div>
            <strong>{{ pref.title }}</strong>
            <p>{{ pref.hint }}</p>
          </div>
          <label class="ssh-number-field">
            <input
              v-model.number="pref.model.value"
              type="number"
              :min="pref.min"
              :max="pref.max"
              :aria-label="pref.title"
              @change="savePreferences"
            />
            <span>{{ t('秒') }}</span>
          </label>
        </div>
      </div>
    </section>

  </div>
</template>

<style scoped>
.ssh-settings-page {
  display: flex;
  flex-direction: column;
}
.ssh-heading {
  justify-content: space-between;
}
.ssh-inline-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.ssh-list-card {
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
}
.ssh-list-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
}
.ssh-list-item:last-child {
  border-bottom: 0;
}
.ssh-list-item:hover {
  background: var(--hover);
}
.ssh-host-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--surface);
  border: 1px solid var(--line);
  color: var(--muted);
}
.ssh-item-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
}
.ssh-host-title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.ssh-item-text strong {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ssh-item-text code {
  font-size: 11.5px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ssh-source-pill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: none;
  font-size: 10.5px;
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid var(--line);
  color: var(--muted);
}
.ssh-host-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}
.ssh-item-remove {
  flex: none;
  opacity: 0;
  transition: opacity 0.12s;
}
.ssh-list-item:hover .ssh-item-remove,
.ssh-item-remove:focus-visible {
  opacity: 0.75;
}
.ssh-item-remove:hover {
  opacity: 1;
}
.ssh-empty-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 32px 16px;
  border: 1px dashed var(--line);
  border-radius: 10px;
  text-align: center;
}
.ssh-empty-card p {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
}
.ssh-empty-art {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
}
.settings-row select.ssh-wide-select {
  width: 188px;
}
.ssh-number-field {
  display: inline-flex;
  align-items: center;
  flex: none;
  width: 108px;
  min-height: 34px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--paper);
  box-shadow: 0 1px 2px #18212b08;
  overflow: hidden;
  cursor: text;
}
.ssh-number-field:focus-within {
  border-color: var(--control-border, var(--text));
}
.ssh-number-field input {
  flex: 1;
  min-width: 0;
  padding: 6px 4px 6px 11px;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.ssh-number-field span {
  padding: 0 10px 0 4px;
  color: var(--muted);
  font-size: 12px;
}
</style>
