<script setup lang="ts">
// SPDX-License-Identifier: MIT
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Copy, FolderOpen, GitBranch, PlugZap, RefreshCw, Server, Terminal, Unplug, X } from 'lucide-vue-next';
import { t } from '../../i18n/i18n';
import { useWorkspaceStore } from '../../stores/workspace';
import { sshClient } from '../client';
import { useSshStore } from '../store';

const GIT_EXCLUDE_KEY_PREFIX = 'tano.ssh.gitExcludeDismissed:';
const GIT_EXCLUDE_SNIPPET = "printf '\\n.tano/\\n' >> .git/info/exclude";

const store = useWorkspaceStore();
const ssh = useSshStore();
const open = ref(false);
const busy = ref(false);
const rootEl = ref<HTMLElement>();
const gitTipVisible = ref(false);
const gitTipCopied = ref(false);

const remote = computed(() =>
  store.workspace?.remote?.kind === 'ssh' ? store.workspace.remote : null,
);
const liveStatus = computed(() =>
  remote.value ? ssh.statuses[remote.value.hostId] : undefined,
);
const phase = computed(() => liveStatus.value?.status ?? remote.value?.status ?? 'connected');
const latencyMs = computed(() => liveStatus.value?.latencyMs ?? remote.value?.latencyMs ?? null);
const capabilities = computed(
  () => liveStatus.value?.capabilities ?? remote.value?.capabilities ?? null,
);

const statusLabel = computed(() => {
  if (phase.value === 'connected') return t('已连接');
  if (phase.value === 'connecting') return t('连接中…');
  if (phase.value === 'reconnecting') return t('重连中…');
  return t('已断开');
});

watch(
  () => [store.workspace?.id, store.workspace?.newlyCreated, remote.value?.gitRepo] as const,
  ([workspaceId, newlyCreated, gitRepo]) => {
    gitTipCopied.value = false;
    if (!workspaceId || !newlyCreated || !gitRepo) {
      gitTipVisible.value = false;
      return;
    }
    try {
      gitTipVisible.value = localStorage.getItem(`${GIT_EXCLUDE_KEY_PREFIX}${workspaceId}`) !== '1';
    } catch {
      gitTipVisible.value = true;
    }
  },
  { immediate: true },
);

function dismissGitTip() {
  gitTipVisible.value = false;
  const id = store.workspace?.id;
  if (!id) return;
  try {
    localStorage.setItem(`${GIT_EXCLUDE_KEY_PREFIX}${id}`, '1');
  } catch {
    /* Optional persistence. */
  }
}

async function copyGitExcludeCommand() {
  try {
    await navigator.clipboard.writeText(GIT_EXCLUDE_SNIPPET);
    gitTipCopied.value = true;
  } catch (reason) {
    store.report(reason);
  }
}

async function handleReconnect() {
  if (!remote.value || busy.value) return;
  busy.value = true;
  try {
    await ssh.reconnect(remote.value.hostId);
    await store.refresh();
  } catch (reason) {
    store.report(reason);
  } finally {
    busy.value = false;
  }
}

async function handleTerminal() {
  if (!remote.value || busy.value) return;
  busy.value = true;
  try {
    await sshClient.openTerminal(remote.value.hostId, remote.value.remotePath);
    open.value = false;
  } catch (reason) {
    store.report(reason);
  } finally {
    busy.value = false;
  }
}

async function handleDisconnect() {
  if (!remote.value || busy.value) return;
  busy.value = true;
  try {
    await ssh.disconnect(remote.value.hostId);
    open.value = false;
  } catch (reason) {
    store.report(reason);
  } finally {
    busy.value = false;
  }
}

function handleSwitchFolder() {
  if (!remote.value) return;
  open.value = false;
  ssh.openConnectModal(remote.value.hostId);
}

function onOutsideClick(event: MouseEvent) {
  if (!open.value) return;
  if (rootEl.value && !rootEl.value.contains(event.target as Node)) {
    open.value = false;
  }
}

onMounted(() => document.addEventListener('pointerdown', onOutsideClick, true));
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutsideClick, true));
</script>

<template>
  <div v-if="remote && ssh.available" ref="rootEl" class="ssh-status-wrap">
    <button
      type="button"
      class="ssh-status-pill"
      :class="`phase-${phase}`"
      :aria-expanded="open"
      :title="`SSH · ${remote.hostLabel} (${remote.remotePath})`"
      @click="open = !open"
    >
      <span class="ssh-dot" aria-hidden="true" />
      <Server :size="13" />
      <span class="ssh-host-name">SSH · {{ remote.hostLabel }}</span>
      <span v-if="phase === 'connected' && latencyMs != null" class="ssh-latency">{{ latencyMs }}ms</span>
    </button>

    <div v-if="open" class="ssh-status-popover" data-surface-role="popover" role="dialog">
      <div class="ssh-popover-head">
        <strong>{{ remote.hostLabel }}</strong>
        <span class="ssh-phase-badge" :class="`phase-${phase}`">{{ statusLabel }}</span>
      </div>
      <code class="ssh-popover-path">{{ remote.remotePath }}</code>
      <p v-if="liveStatus?.error" class="form-error">{{ liveStatus.error }}</p>

      <div v-if="capabilities" class="ssh-cap-chips">
        <span class="cap-chip" :class="{ on: capabilities.fastScan }">
          {{ capabilities.fastScan ? 'Python3 加速' : '纯 SFTP' }}
        </span>
        <span class="cap-chip" :class="{ on: capabilities.inotify }">
          {{ capabilities.inotify ? 'inotify 实时监听' : '自适应轮询' }}
        </span>
        <span v-if="capabilities.git" class="cap-chip on">Git</span>
        <span v-if="capabilities.node" class="cap-chip on">
          Node {{ capabilities.nodeVersion ?? '' }}
        </span>
        <span v-if="capabilities.codexCli" class="cap-chip on">Codex CLI</span>
        <span v-if="capabilities.claudeCli" class="cap-chip on">Claude CLI</span>
      </div>

      <div class="ssh-popover-actions">
        <button type="button" :disabled="busy" @click="handleTerminal">
          <Terminal :size="14" /><span>{{ t('打开远端 SSH 终端') }}</span>
        </button>
        <button type="button" :disabled="busy" @click="handleSwitchFolder">
          <FolderOpen :size="14" /><span>{{ t('切换远端文件夹…') }}</span>
        </button>
        <button type="button" :disabled="busy" @click="handleReconnect">
          <RefreshCw v-if="busy" :size="14" class="spinning" />
          <PlugZap v-else :size="14" />
          <span>{{ t('重新连接') }}</span>
        </button>
        <button type="button" class="danger-action" :disabled="busy" @click="handleDisconnect">
          <Unplug :size="14" /><span>{{ t('断开 SSH 连接') }}</span>
        </button>
      </div>
    </div>

    <div v-if="gitTipVisible" class="ssh-git-exclude-tip" role="status">
      <div class="ssh-git-tip-head">
        <GitBranch :size="14" />
        <strong>{{ t('已在此 Git 仓库初始化 .tano/ 元数据') }}</strong>
        <button type="button" class="icon-button" :aria-label="t('关闭提示')" @click="dismissGitTip">
          <X :size="13" />
        </button>
      </div>
      <p>
        {{ t('Tano 不会自动修改你的 .gitignore。若不想在 git status 中看到 .tano/，可复制下方命令将其加入本地 .git/info/exclude：') }}
      </p>
      <div class="ssh-git-tip-actions">
        <button type="button" class="secondary-button" @click="copyGitExcludeCommand">
          <Copy :size="13" />
          <span>{{ gitTipCopied ? t('已复制命令') : t('复制 .git/info/exclude 忽略命令') }}</span>
        </button>
        <button type="button" class="secondary-button" @click="dismissGitTip">
          {{ t('知道了') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ssh-status-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
}
.ssh-status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--text);
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 12px;
  cursor: pointer;
  max-width: 240px;
}
.ssh-status-pill:hover {
  background: var(--hover);
}
.ssh-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: #22c55e;
  flex: none;
}
.ssh-status-pill.phase-connecting .ssh-dot,
.ssh-status-pill.phase-reconnecting .ssh-dot {
  background: #f59e0b;
}
.ssh-status-pill.phase-disconnected .ssh-dot {
  background: #ef4444;
}
.ssh-host-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ssh-latency {
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.ssh-status-popover {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  width: 280px;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: var(--paper, var(--bg));
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.16);
  z-index: 160;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ssh-popover-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
}
.ssh-phase-badge {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, #22c55e 16%, transparent);
  color: var(--text);
}
.ssh-phase-badge.phase-disconnected {
  background: color-mix(in srgb, #ef4444 16%, transparent);
}
.ssh-popover-path {
  display: block;
  font-size: 11.5px;
  color: var(--muted);
  word-break: break-all;
}
.ssh-cap-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.cap-chip {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--line);
  color: var(--muted);
}
.cap-chip.on {
  background: var(--surface);
  color: var(--text);
}
.ssh-popover-actions {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-top: 1px solid var(--line);
  padding-top: 6px;
}
.ssh-popover-actions button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--text);
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 12.5px;
  cursor: pointer;
  text-align: left;
}
.ssh-popover-actions button:hover {
  background: var(--hover);
}
.ssh-popover-actions button.danger-action {
  color: var(--danger, #d93025);
}
.ssh-git-exclude-tip {
  position: fixed;
  right: 18px;
  bottom: 18px;
  width: min(360px, 90vw);
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: var(--paper, var(--bg));
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
  z-index: 170;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12.5px;
}
.ssh-git-tip-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ssh-git-tip-head strong {
  flex: 1;
  font-size: 13px;
}
.ssh-git-exclude-tip p {
  margin: 0;
  color: var(--muted);
  line-height: 1.5;
}
.ssh-git-tip-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ssh-git-tip-actions button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
}
</style>
