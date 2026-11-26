<script setup lang="ts">
// SPDX-License-Identifier: MIT
import { onMounted, ref } from 'vue';
import { PlugZap, RefreshCw, Server, ShieldCheck, Trash2 } from 'lucide-vue-next';
import { t } from '../../i18n/i18n';
import { useSshStore } from '../store';
import type { RemoteTrashMode } from '../types';

const ssh = useSshStore();
const saving = ref(false);
const notice = ref('');
const error = ref('');

const trashMode = ref<RemoteTrashMode>('remote-trash');
const pollIntervalSecs = ref(3);
const keepaliveSecs = ref(15);
const connectTimeoutSecs = ref(15);

async function reloadAll() {
  error.value = '';
  try {
    await Promise.all([ssh.loadHosts(), ssh.loadKnownHosts(), ssh.loadSettings()]);
    trashMode.value = ssh.settings.trashMode;
    pollIntervalSecs.value = ssh.settings.pollIntervalSecs;
    keepaliveSecs.value = ssh.settings.keepaliveSecs;
    connectTimeoutSecs.value = ssh.settings.connectTimeoutSecs;
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  }
}

async function savePreferences() {
  saving.value = true;
  error.value = '';
  notice.value = '';
  try {
    await ssh.saveSettings({
      trashMode: trashMode.value,
      pollIntervalSecs: Number(pollIntervalSecs.value) || 3,
      keepaliveSecs: Number(keepaliveSecs.value) || 15,
      connectTimeoutSecs: Number(connectTimeoutSecs.value) || 15,
    });
    notice.value = t('SSH 远端偏好设置已保存。');
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    saving.value = false;
  }
}

async function removeKnownHost(id: string) {
  error.value = '';
  try {
    await ssh.removeKnownHost(id);
    notice.value = t('已移除该主机指纹，下次连接将重新确认。');
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  }
}

onMounted(() => {
  void reloadAll();
});
</script>

<template>
  <div class="ssh-settings-page">
    <div class="ssh-settings-section">
      <div class="ssh-section-head">
        <div>
          <h3><Server :size="16" /> {{ t('SSH 服务器列表') }}</h3>
          <p class="panel-hint">
            {{
              ssh.configPath
                ? t('自动读取本机 OpenSSH 配置：{0}（只读），也可单独添加服务器。', [ssh.configPath])
                : t('管理已保存的 SSH 服务器，或打开连接弹窗浏览远端文件夹。')
            }}
          </p>
        </div>
        <div class="ssh-section-btns">
          <button type="button" class="secondary-button" @click="reloadAll">
            <RefreshCw :size="14" /> {{ t('刷新') }}
          </button>
          <button type="button" class="primary-button" @click="ssh.openConnectModal()">
            <PlugZap :size="14" /> {{ t('管理并连接服务器…') }}
          </button>
        </div>
      </div>

      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <p v-if="notice" class="panel-hint" role="status">{{ notice }}</p>

      <div v-if="ssh.allHosts.length" class="ssh-list-card">
        <div v-for="host in ssh.allHosts" :key="host.id" class="ssh-list-row">
          <div class="ssh-list-info">
            <strong>{{ host.name }}</strong>
            <code>{{ host.username }}@{{ host.host }}:{{ host.port }}</code>
            <span class="ssh-source-pill">
              {{ host.source === 'ssh-config' ? '~/.ssh/config' : t('已保存') }}
            </span>
          </div>
          <div class="ssh-list-actions">
            <button type="button" class="secondary-button" @click="ssh.openConnectModal(host.id)">
              {{ t('连接') }}
            </button>
            <button
              v-if="host.source === 'saved'"
              type="button"
              class="icon-button"
              :title="t('删除服务器')"
              @click="ssh.removeHost(host.id)"
            >
              <Trash2 :size="14" />
            </button>
          </div>
        </div>
      </div>
      <p v-else class="panel-hint">{{ t('暂未发现或保存任何 SSH 服务器。') }}</p>
    </div>

    <div class="ssh-settings-section">
      <h3>{{ t('连接与文件行为') }}</h3>
      <div class="ssh-pref-grid">
        <label>
          <span>{{ t('远端文件删除策略') }}</span>
          <select v-model="trashMode">
            <option value="remote-trash">{{ t('移至远端回收目录（~/.tano/trash/，推荐）') }}</option>
            <option value="permanent-delete">{{ t('直接永久删除') }}</option>
          </select>
        </label>
        <label>
          <span>{{ t('无 inotify 时的轮询间隔（秒）') }}</span>
          <input v-model.number="pollIntervalSecs" type="number" min="1" max="60" />
        </label>
        <label>
          <span>{{ t('SSH 心跳保活（秒）') }}</span>
          <input v-model.number="keepaliveSecs" type="number" min="5" max="300" />
        </label>
        <label>
          <span>{{ t('连接超时（秒）') }}</span>
          <input v-model.number="connectTimeoutSecs" type="number" min="5" max="120" />
        </label>
      </div>
      <div class="ssh-pref-actions">
        <button type="button" class="primary-button" :disabled="saving" @click="savePreferences">
          {{ saving ? t('正在保存…') : t('保存 SSH 偏好') }}
        </button>
      </div>
    </div>

    <div class="ssh-settings-section">
      <h3><ShieldCheck :size="16" /> {{ t('已信任的主机指纹（known_hosts）') }}</h3>
      <p class="panel-hint">
        {{ t('首次连接确认的主机密钥保存在 Tano 应用数据目录。如果服务器重装更换了密钥，可在此移除旧记录。') }}
      </p>
      <div v-if="ssh.knownHosts.length" class="ssh-list-card">
        <div v-for="item in ssh.knownHosts" :key="item.id" class="ssh-list-row">
          <div class="ssh-list-info">
            <strong>{{ item.hostPattern }}</strong>
            <code>{{ item.algorithm }} · {{ item.fingerprint }}</code>
            <span class="ssh-source-pill">
              {{ item.source === 'openssh' ? '~/.ssh/known_hosts' : 'Tano' }}
            </span>
          </div>
          <button
            v-if="item.source === 'tano'"
            type="button"
            class="icon-button"
            :title="t('移除已信任指纹')"
            @click="removeKnownHost(item.id)"
          >
            <Trash2 :size="14" />
          </button>
        </div>
      </div>
      <p v-else class="panel-hint">{{ t('尚无已记录的主机指纹。') }}</p>
    </div>
  </div>
</template>

<style scoped>
.ssh-settings-page {
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.ssh-settings-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ssh-settings-section h3 {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 15px;
}
.ssh-section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.ssh-section-btns {
  display: flex;
  gap: 8px;
}
.ssh-list-card {
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
}
.ssh-list-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
}
.ssh-list-row:last-child {
  border-bottom: 0;
}
.ssh-list-info {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
  font-size: 13px;
}
.ssh-list-info code {
  font-size: 12px;
  color: var(--muted);
  word-break: break-all;
}
.ssh-source-pill {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--line);
  color: var(--muted);
}
.ssh-list-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}
.ssh-pref-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
@media (max-width: 640px) {
  .ssh-pref-grid {
    grid-template-columns: 1fr;
  }
}
.ssh-pref-grid label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
}
.ssh-pref-grid input,
.ssh-pref-grid select {
  padding: 6px 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
}
.ssh-pref-actions {
  display: flex;
  justify-content: flex-start;
}
</style>
