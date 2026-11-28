<script setup lang="ts">
// SPDX-License-Identifier: MIT
import { computed, nextTick, ref, watch } from 'vue';
import { Check, Monitor, Plus, RefreshCw, Search, X } from 'lucide-vue-next';
import { t } from '../../i18n/i18n';
import { useSshStore } from '../store';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; manual: [] }>();

const ssh = useSshStore();
const selected = ref<Set<string>>(new Set());
const query = ref('');
const searchInput = ref<HTMLInputElement | null>(null);

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return ssh.importableConfigHosts;
  return ssh.importableConfigHosts.filter((host) =>
    [host.name, host.host, host.username, host.configAlias ?? '']
      .some((value) => value.toLowerCase().includes(q)),
  );
});
const allFilteredSelected = computed(
  () => filtered.value.length > 0 && filtered.value.every((host) => selected.value.has(host.id)),
);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    selected.value = new Set();
    query.value = '';
    void ssh.loadHosts();
    void nextTick(() => searchInput.value?.focus());
  },
  { immediate: true },
);

function toggle(id: string) {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}

function toggleAll() {
  const next = new Set(selected.value);
  const select = !allFilteredSelected.value;
  for (const host of filtered.value) {
    if (select) next.add(host.id);
    else next.delete(host.id);
  }
  selected.value = next;
}

function confirm() {
  if (!selected.value.size) return;
  ssh.importConfigHosts([...selected.value]);
  emit('close');
}
</script>

<template>
  <div
    v-if="open"
    class="modal-backdrop ssh-import-backdrop"
    data-surface-role="backdrop"
    @mousedown.self="emit('close')"
    @keydown.esc="emit('close')"
  >
    <section
      class="modal ssh-import-modal"
      data-surface-role="dialog"
      role="dialog"
      aria-modal="true"
      :aria-label="t('添加 SSH 连接')"
    >
      <header class="ssh-import-header">
        <div>
          <h2>{{ t('添加 SSH 连接') }}</h2>
          <p :title="ssh.configPath ?? undefined">
            {{ t('选择要添加到同页的 ~/.ssh/config 主机，配置文件本身不会被修改。') }}
          </p>
        </div>
        <button type="button" class="icon-button" :aria-label="t('关闭')" @click="emit('close')">
          <X :size="16" />
        </button>
      </header>

      <div v-if="ssh.importableConfigHosts.length > 6" class="ssh-import-search">
        <Search :size="14" />
        <input
          ref="searchInput"
          v-model="query"
          type="text"
          spellcheck="false"
          autocomplete="off"
          :placeholder="t('搜索主机')"
        />
      </div>

      <div class="ssh-import-list" role="listbox" aria-multiselectable="true">
        <button
          v-for="host in filtered"
          :key="host.id"
          type="button"
          role="option"
          class="ssh-import-row"
          :class="{ selected: selected.has(host.id) }"
          :aria-selected="selected.has(host.id)"
          @click="toggle(host.id)"
        >
          <span class="ssh-import-icon"><Monitor :size="15" /></span>
          <span class="ssh-import-text">
            <strong>{{ host.name }}</strong>
            <small>{{ host.username }}@{{ host.host }}{{ host.port === 22 ? '' : `:${host.port}` }}</small>
          </span>
          <span class="ssh-import-check" aria-hidden="true"><Check :size="12" :stroke-width="3" /></span>
        </button>

        <div v-if="!filtered.length" class="ssh-import-empty">
          <template v-if="ssh.hostsLoading">{{ t('正在读取 SSH 配置…') }}</template>
          <template v-else-if="query.trim()">{{ t('没有匹配的主机。') }}</template>
          <template v-else-if="ssh.configHosts.length">{{ t('~/.ssh/config 中的主机都已添加。') }}</template>
          <template v-else>{{ t('未在 ~/.ssh/config 中找到主机。') }}</template>
        </div>
      </div>
      <p v-if="ssh.configParseError" class="form-error">{{ ssh.configParseError }}</p>

      <footer class="ssh-import-footer">
        <div class="ssh-import-footer-start">
          <button type="button" class="ghost-link" @click="emit('manual')">
            <Plus :size="14" /> {{ t('手动添加') }}
          </button>
          <button
            v-if="filtered.length > 1"
            type="button"
            class="ghost-link"
            @click="toggleAll"
          >
            {{ allFilteredSelected ? t('取消全选') : t('全选') }}
          </button>
          <button
            type="button"
            class="icon-button"
            :disabled="ssh.hostsLoading"
            :title="t('重新读取 ~/.ssh/config')"
            @click="ssh.loadHosts()"
          >
            <RefreshCw :size="13" :class="{ spinning: ssh.hostsLoading }" />
          </button>
        </div>
        <button type="button" class="primary-button" :disabled="!selected.size" @click="confirm">
          {{ selected.size ? t('添加 {0} 台', [String(selected.size)]) : t('添加') }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.ssh-import-backdrop {
  z-index: 240;
}
.ssh-import-modal {
  width: min(440px, 94vw);
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  border-radius: 14px;
}
.ssh-import-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin: 0;
}
.ssh-import-header h2 {
  margin: 0;
  font-size: 17px;
}
.ssh-import-header p {
  margin: 4px 0 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--muted);
}
.ssh-import-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  height: 32px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg);
  color: var(--muted);
}
.ssh-import-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
  font-size: 13px;
}
.ssh-import-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: min(340px, 50vh);
  overflow-y: auto;
  margin: 0 -6px;
  padding: 0 6px;
}
.ssh-import-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}
.ssh-import-row:hover {
  background: var(--hover);
}
.ssh-import-row:focus-visible {
  outline: 2px solid var(--accent, currentColor);
  outline-offset: -2px;
}
.ssh-import-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: var(--surface);
  border: 1px solid var(--line);
  color: var(--muted);
}
.ssh-import-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1;
  min-width: 0;
}
.ssh-import-text strong {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ssh-import-text small {
  font-size: 11.5px;
  font-family: var(--font-mono);
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ssh-import-check {
  display: grid;
  place-items: center;
  flex: none;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  border: 1.5px solid var(--line);
  color: transparent;
  transition: background-color 0.12s, border-color 0.12s;
}
.ssh-import-row.selected .ssh-import-check {
  background: var(--text);
  border-color: var(--text);
  color: var(--paper);
}
.ssh-import-empty {
  padding: 28px 12px;
  text-align: center;
  font-size: 13px;
  color: var(--muted);
}
.ssh-import-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}
.ssh-import-footer-start {
  display: flex;
  align-items: center;
  gap: 4px;
}
.ghost-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary, var(--muted));
  font-size: 13px;
  cursor: pointer;
}
.ghost-link:hover {
  background: var(--hover);
  color: var(--text);
}
</style>
