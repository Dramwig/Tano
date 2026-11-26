<script setup lang="ts">
// SPDX-License-Identifier: MIT
import { computed, onMounted, ref, watch } from 'vue';
import {
  CheckCircle2,
  LoaderCircle,
  Pencil,
  PlugZap,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  Wifi,
  X,
} from 'lucide-vue-next';
import { formatRemoteWorkspaceUri } from '@tano/protocol';
import { t } from '../../i18n/i18n';
import { useWorkspaceStore } from '../../stores/workspace';
import { useSshStore } from '../store';
import type { SshAuthMethod, SshConnectResult, SshHostInput, SshHostProfile } from '../types';
import RemoteFolderBrowser from './RemoteFolderBrowser.vue';

const ssh = useSshStore();
const store = useWorkspaceStore();

const quickConnect = ref('');
const quickBusy = ref(false);
const selectedHostId = ref<string | null>(null);
const connectedInfo = ref<SshConnectResult | null>(null);
const initialBrowsePath = ref<string | null>(null);
const connecting = ref(false);
const testingHostId = ref<string | null>(null);
const openingWorkspace = ref(false);
const error = ref('');
const notice = ref('');

// Host editor drawer state
const editingHost = ref(false);
const savingHost = ref(false);
const hostForm = ref<SshHostInput>({
  id: null,
  name: '',
  host: '',
  port: 22,
  username: '',
  authMethod: 'auto',
  identityFile: '',
  proxyJump: '',
  proxyCommand: '',
  forwardAgent: false,
  password: '',
  passphrase: '',
  clearPassword: false,
  clearPassphrase: false,
});

const selectedHost = computed<SshHostProfile | null>(() =>
  ssh.allHosts.find((h) => h.id === selectedHostId.value) ?? null,
);

function startAddHost() {
  editingHost.value = true;
  error.value = '';
  notice.value = '';
  hostForm.value = {
    id: null,
    name: '',
    host: '',
    port: 22,
    username: '',
    authMethod: 'auto',
    identityFile: '',
    proxyJump: '',
    proxyCommand: '',
    forwardAgent: false,
    password: '',
    passphrase: '',
    clearPassword: false,
    clearPassphrase: false,
  };
}

function startEditHost(profile: SshHostProfile) {
  if (profile.source === 'ssh-config') return;
  editingHost.value = true;
  error.value = '';
  notice.value = '';
  hostForm.value = {
    id: profile.id,
    name: profile.name,
    host: profile.host,
    port: profile.port,
    username: profile.username,
    authMethod: profile.authMethod,
    identityFile: profile.identityFile ?? '',
    proxyJump: profile.proxyJump ?? '',
    proxyCommand: profile.proxyCommand ?? '',
    forwardAgent: profile.forwardAgent,
    password: '',
    passphrase: '',
    clearPassword: false,
    clearPassphrase: false,
  };
}

function buildHostPayload(): SshHostInput {
  return {
    ...hostForm.value,
    name: hostForm.value.name.trim() || hostForm.value.host.trim(),
    host: hostForm.value.host.trim(),
    username: hostForm.value.username.trim(),
    port: Number(hostForm.value.port) || 22,
    identityFile: hostForm.value.identityFile?.trim() || null,
    proxyJump: hostForm.value.proxyJump?.trim() || null,
    proxyCommand: hostForm.value.proxyCommand?.trim() || null,
    password: hostForm.value.password ? hostForm.value.password : null,
    passphrase: hostForm.value.passphrase ? hostForm.value.passphrase : null,
  };
}

async function submitHostForm() {
  savingHost.value = true;
  error.value = '';
  try {
    const saved = await ssh.saveHost(buildHostPayload());
    editingHost.value = false;
    notice.value = t('已保存服务器配置「{0}」', [saved.name]);
    await selectAndConnect(saved.id);
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    savingHost.value = false;
  }
}

async function testFormHost() {
  if (savingHost.value || testingHostId.value) return;
  savingHost.value = true;
  error.value = '';
  notice.value = '';
  try {
    const saved = await ssh.saveHost(buildHostPayload());
    hostForm.value.id = saved.id;
    testingHostId.value = saved.id;
    const res = await ssh.testHost(saved.id);
    const caps = [
      res.capabilities.fastScan ? 'Python3' : 'SFTP',
      res.capabilities.git ? 'Git' : '',
      res.capabilities.node ? `Node ${res.capabilities.nodeVersion ?? ''}`.trim() : '',
    ]
      .filter(Boolean)
      .join(' · ');
    notice.value = t('连接测试成功：{0}（{1}ms，{2}）', [res.hostLabel, String(res.latencyMs), caps]);
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    savingHost.value = false;
    testingHostId.value = null;
  }
}

async function testSavedOrConfigHost(profile: SshHostProfile) {
  if (testingHostId.value) return;
  testingHostId.value = profile.id;
  error.value = '';
  notice.value = '';
  try {
    const res = await ssh.testHost(profile.id);
    notice.value = t('连接测试成功：{0}（{1}ms，主目录 {2}）', [
      res.hostLabel,
      String(res.latencyMs),
      res.homeDir,
    ]);
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    testingHostId.value = null;
  }
}

async function deleteHost(profile: SshHostProfile) {
  if (profile.source === 'ssh-config') return;
  error.value = '';
  try {
    await ssh.removeHost(profile.id);
    if (selectedHostId.value === profile.id) {
      selectedHostId.value = null;
      connectedInfo.value = null;
    }
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  }
}

async function selectAndConnect(hostId: string, browsePath?: string | null) {
  selectedHostId.value = hostId;
  editingHost.value = false;
  connectedInfo.value = null;
  initialBrowsePath.value = browsePath ?? null;
  connecting.value = true;
  error.value = '';
  notice.value = '';
  try {
    const res = await ssh.connect(hostId);
    if (selectedHostId.value !== hostId) return;
    connectedInfo.value = res;
    if (!initialBrowsePath.value) {
      initialBrowsePath.value = res.recentPaths[0] ?? res.homeDir;
    }
  } catch (reason) {
    if (selectedHostId.value === hostId) {
      error.value = reason instanceof Error ? reason.message : String(reason);
    }
  } finally {
    if (selectedHostId.value === hostId) connecting.value = false;
  }
}

async function handleQuickConnect() {
  const raw = quickConnect.value.trim();
  if (!raw || quickBusy.value) return;
  quickBusy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const configMatch = ssh.configHosts.find(
      (h) =>
        h.configAlias?.toLowerCase() === raw.toLowerCase() ||
        h.name.toLowerCase() === raw.toLowerCase(),
    );
    if (configMatch) {
      await selectAndConnect(configMatch.id);
      quickConnect.value = '';
      return;
    }
    const [profile, remotePath] = await ssh.parseQuickConnect(raw);
    quickConnect.value = '';
    await selectAndConnect(profile.id, remotePath);
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    quickBusy.value = false;
  }
}

async function openRemoteFolder(remotePath: string) {
  if (!selectedHostId.value || openingWorkspace.value) return;
  openingWorkspace.value = true;
  error.value = '';
  try {
    const uri = formatRemoteWorkspaceUri(selectedHostId.value, remotePath);
    await store.openWorkspace(uri);
    ssh.closeConnectModal();
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    openingWorkspace.value = false;
  }
}

onMounted(() => {
  void ssh.loadHosts().then(() => {
    if (ssh.preselectedHostId) {
      void selectAndConnect(ssh.preselectedHostId);
    }
  });
});

watch(
  () => ssh.preselectedHostId,
  (hostId) => {
    if (hostId && ssh.connectModalOpen) {
      void selectAndConnect(hostId);
    }
  },
);
</script>

<template>
  <div
    v-if="ssh.connectModalOpen"
    class="modal-backdrop ssh-connect-backdrop"
    data-surface-role="backdrop"
    @mousedown.self="!openingWorkspace && ssh.closeConnectModal()"
  >
    <section
      class="modal ssh-connect-modal"
      data-surface-role="dialog"
      role="dialog"
      aria-modal="true"
      :aria-label="t('连接 SSH 服务器')"
    >
      <header class="ssh-modal-header">
        <div class="ssh-modal-title">
          <Server :size="19" />
          <h2>{{ t('连接 SSH 服务器') }}</h2>
        </div>
        <button
          type="button"
          class="icon-button"
          :disabled="openingWorkspace"
          :aria-label="t('关闭')"
          @click="ssh.closeConnectModal()"
        >
          <X :size="18" />
        </button>
      </header>

      <form class="ssh-quick-bar" @submit.prevent="handleQuickConnect">
        <input
          v-model="quickConnect"
          type="text"
          :placeholder="t('快速连接：user@host[:port][:/path] 或 ~/.ssh/config 主机别名')"
          spellcheck="false"
          autocomplete="off"
        />
        <button type="submit" class="primary-button" :disabled="quickBusy || !quickConnect.trim()">
          <LoaderCircle v-if="quickBusy" :size="14" class="spinning" />
          <PlugZap v-else :size="14" />
          <span>{{ t('连接') }}</span>
        </button>
      </form>

      <div class="ssh-modal-body">
        <aside class="ssh-host-sidebar">
          <div class="ssh-sidebar-actions">
            <button type="button" class="secondary-button ssh-add-btn" @click="startAddHost">
              <Plus :size="14" /><span>{{ t('添加服务器') }}</span>
            </button>
            <button
              type="button"
              class="icon-button"
              :disabled="ssh.hostsLoading"
              :title="t('刷新服务器列表')"
              @click="ssh.loadHosts()"
            >
              <RefreshCw :size="14" :class="{ spinning: ssh.hostsLoading }" />
            </button>
          </div>

          <div v-if="ssh.savedHosts.length" class="ssh-host-group">
            <div class="ssh-group-label">{{ t('已保存的服务器') }}</div>
            <div
              v-for="item in ssh.savedHosts"
              :key="item.id"
              class="ssh-host-row"
              :class="{ active: selectedHostId === item.id && !editingHost }"
            >
              <button type="button" class="ssh-host-main" @click="selectAndConnect(item.id)">
                <strong>{{ item.name }}</strong>
                <small>{{ item.username }}@{{ item.host }}:{{ item.port }}</small>
              </button>
              <button
                type="button"
                class="icon-button ssh-row-act"
                :disabled="testingHostId === item.id"
                :aria-label="t('测试连接')"
                :title="t('测试连接')"
                @click.stop="testSavedOrConfigHost(item)"
              >
                <LoaderCircle v-if="testingHostId === item.id" :size="13" class="spinning" />
                <Wifi v-else :size="13" />
              </button>
              <button
                type="button"
                class="icon-button ssh-row-act"
                :title="t('编辑')"
                @click.stop="startEditHost(item)"
              >
                <Pencil :size="13" />
              </button>
              <button
                type="button"
                class="icon-button ssh-row-act"
                :title="t('删除')"
                @click.stop="deleteHost(item)"
              >
                <Trash2 :size="13" />
              </button>
            </div>
          </div>

          <div v-if="ssh.configHosts.length" class="ssh-host-group">
            <div class="ssh-group-label" :title="ssh.configPath ?? undefined">
              ~/.ssh/config
            </div>
            <div
              v-for="item in ssh.configHosts"
              :key="item.id"
              class="ssh-host-row"
              :class="{ active: selectedHostId === item.id && !editingHost }"
            >
              <button type="button" class="ssh-host-main" @click="selectAndConnect(item.id)">
                <strong>{{ item.name }}</strong>
                <small>{{ item.username }}@{{ item.host }}:{{ item.port }}</small>
              </button>
              <button
                type="button"
                class="icon-button ssh-row-act"
                :disabled="testingHostId === item.id"
                :aria-label="t('测试连接')"
                :title="t('测试连接')"
                @click.stop="testSavedOrConfigHost(item)"
              >
                <LoaderCircle v-if="testingHostId === item.id" :size="13" class="spinning" />
                <Wifi v-else :size="13" />
              </button>
            </div>
          </div>

          <p v-if="!ssh.hostsLoading && !ssh.allHosts.length" class="ssh-empty-hint">
            {{ t('尚未配置 SSH 服务器。上方输入快速连接地址或点击「添加服务器」。') }}
          </p>
          <p v-if="ssh.configParseError" class="form-error">{{ ssh.configParseError }}</p>
        </aside>

        <main class="ssh-modal-main">
          <p v-if="error" class="form-error" role="alert">{{ error }}</p>
          <p v-if="notice" class="ssh-notice" role="status">{{ notice }}</p>

          <form v-if="editingHost" class="ssh-host-form" @submit.prevent="submitHostForm">
            <h3>{{ hostForm.id ? t('编辑 SSH 服务器') : t('新建 SSH 服务器') }}</h3>
            <div class="ssh-form-grid">
              <label>
                <span>{{ t('显示名称') }}</span>
                <input v-model="hostForm.name" type="text" :placeholder="t('例如：GPU 研发机')" />
              </label>
              <label>
                <span>{{ t('主机地址 / IP') }}</span>
                <input v-model="hostForm.host" type="text" required placeholder="10.0.0.5" />
              </label>
              <label>
                <span>{{ t('端口') }}</span>
                <input v-model.number="hostForm.port" type="number" min="1" max="65535" />
              </label>
              <label>
                <span>{{ t('用户名') }}</span>
                <input v-model="hostForm.username" type="text" required placeholder="ubuntu" />
              </label>
              <label>
                <span>{{ t('认证方式') }}</span>
                <select v-model="hostForm.authMethod as SshAuthMethod">
                  <option value="auto">{{ t('自动（Agent → 密钥 → 密码）') }}</option>
                  <option value="agent">{{ t('仅 SSH Agent') }}</option>
                  <option value="key">{{ t('私钥文件') }}</option>
                  <option value="password">{{ t('密码 / 交互验证') }}</option>
                </select>
              </label>
              <label>
                <span>{{ t('私钥路径（可选）') }}</span>
                <input v-model="hostForm.identityFile" type="text" placeholder="~/.ssh/id_ed25519" />
              </label>
              <label>
                <span>{{ t('跳板机 ProxyJump（可选）') }}</span>
                <input v-model="hostForm.proxyJump" type="text" placeholder="bastion.example.com" />
              </label>
              <label>
                <span>{{ t('ProxyCommand（可选）') }}</span>
                <input v-model="hostForm.proxyCommand" type="text" placeholder="ssh -W %h:%p jump" />
              </label>
            </div>
            <label v-if="hostForm.authMethod === 'password' || hostForm.authMethod === 'auto'" class="ssh-secret-row">
              <span>{{ t('密码（可选，将安全保存到系统凭据库）') }}</span>
              <input v-model="hostForm.password" type="password" autocomplete="new-password" />
            </label>
            <div class="ssh-form-actions">
              <button type="button" class="secondary-button" @click="editingHost = false">
                {{ t('取消') }}
              </button>
              <button
                type="button"
                class="secondary-button"
                :disabled="savingHost || !!testingHostId || !hostForm.host.trim() || !hostForm.username.trim()"
                @click="testFormHost"
              >
                <LoaderCircle v-if="!!testingHostId" :size="14" class="spinning" />
                <Wifi v-else :size="14" />
                <span>{{ testingHostId ? t('测试中…') : t('测试连接') }}</span>
              </button>
              <button type="submit" class="primary-button" :disabled="savingHost || !!testingHostId">
                {{ savingHost ? t('正在保存…') : t('保存并连接') }}
              </button>
            </div>
          </form>

          <div v-else-if="connecting" class="ssh-connecting-state">
            <LoaderCircle :size="24" class="spinning" />
            <p>{{ t('正在通过 SSH 连接到 {0}…', [selectedHost?.name ?? selectedHostId ?? '']) }}</p>
          </div>

          <template v-else-if="connectedInfo">
            <div class="ssh-connected-banner">
              <CheckCircle2 :size="16" class="ok-icon" />
              <strong>{{ connectedInfo.hostLabel }}</strong>
              <span class="ssh-latency-tag">{{ connectedInfo.latencyMs }}ms</span>
              <span class="ssh-cap-tag">
                {{ connectedInfo.capabilities.fastScan ? 'Python3' : 'SFTP' }}
              </span>
              <span v-if="connectedInfo.capabilities.git" class="ssh-cap-tag">Git</span>
              <span v-if="connectedInfo.capabilities.node" class="ssh-cap-tag">
                Node {{ connectedInfo.capabilities.nodeVersion ?? '' }}
              </span>
              <span v-if="connectedInfo.capabilities.codexCli" class="ssh-cap-tag">Codex</span>
              <span v-if="connectedInfo.capabilities.claudeCli" class="ssh-cap-tag">Claude</span>
            </div>

            <RemoteFolderBrowser
              :host-id="connectedInfo.hostId"
              :initial-path="initialBrowsePath"
              :home-dir="connectedInfo.homeDir"
              :recent-paths="connectedInfo.recentPaths"
              :opening="openingWorkspace"
              @open="openRemoteFolder"
            />
          </template>

          <div v-else class="ssh-placeholder-state">
            <Server :size="32" />
            <h3>{{ t('选择一台 SSH 服务器开始浏览远端工作区') }}</h3>
            <p>
              {{ t('支持直接复用 ~/.ssh/config、系统 SSH Agent、私钥与跳板机；无需在服务器安装服务端即可预览和编辑 Markdown、代码、数据表与附件。') }}
            </p>
          </div>
        </main>
      </div>
    </section>
  </div>
</template>

<style scoped>
.ssh-connect-backdrop {
  z-index: 220;
}
.ssh-connect-modal {
  width: min(860px, 94vw);
  max-height: 86vh;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ssh-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.ssh-modal-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ssh-modal-title h2 {
  margin: 0;
  font-size: 17px;
}
.ssh-quick-bar {
  display: flex;
  gap: 8px;
}
.ssh-quick-bar input {
  flex: 1;
  padding: 7px 10px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 13px;
}
.ssh-modal-body {
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: 14px;
  min-height: 360px;
  overflow: hidden;
}
@media (max-width: 720px) {
  .ssh-modal-body {
    grid-template-columns: 1fr;
  }
}
.ssh-host-sidebar {
  border-right: 1px solid var(--line);
  padding-right: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: auto;
}
.ssh-sidebar-actions {
  display: flex;
  gap: 6px;
}
.ssh-add-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
}
.ssh-host-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ssh-group-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  text-transform: uppercase;
  padding: 2px 4px;
}
.ssh-host-row {
  display: flex;
  align-items: center;
  gap: 2px;
  border-radius: 7px;
  padding: 2px;
}
.ssh-host-row.active,
.ssh-host-row:hover {
  background: var(--hover);
}
.ssh-host-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  text-align: left;
  border: 0;
  background: transparent;
  color: var(--text);
  padding: 5px 6px;
  cursor: pointer;
}
.ssh-host-main strong {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ssh-host-main small {
  font-size: 11px;
  color: var(--muted);
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ssh-row-act {
  opacity: 0.7;
}
.ssh-row-act:hover {
  opacity: 1;
}
.ssh-empty-hint {
  font-size: 12px;
  color: var(--muted);
  margin: 8px 4px;
}
.ssh-modal-main {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  min-height: 0;
  overflow: auto;
}
.ssh-notice {
  margin: 0;
  font-size: 12.5px;
  color: var(--muted);
}
.ssh-connected-banner {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 7px 10px;
  border-radius: 8px;
  background: var(--surface);
  border: 1px solid var(--line);
  font-size: 12.5px;
}
.ok-icon {
  color: #22c55e;
}
.ssh-latency-tag,
.ssh-cap-tag {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--line);
  color: var(--muted);
}
.ssh-connecting-state,
.ssh-placeholder-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 10px;
  padding: 32px 24px;
  color: var(--muted);
}
.ssh-placeholder-state h3 {
  margin: 0;
  color: var(--text);
  font-size: 15px;
}
.ssh-placeholder-state p {
  margin: 0;
  font-size: 13px;
  max-width: 420px;
  line-height: 1.6;
}
.ssh-host-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ssh-host-form h3 {
  margin: 0;
  font-size: 15px;
}
.ssh-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.ssh-form-grid label,
.ssh-secret-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12.5px;
}
.ssh-form-grid input,
.ssh-form-grid select,
.ssh-secret-row input {
  padding: 6px 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-size: 13px;
}
.ssh-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
