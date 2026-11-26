<script setup lang="ts">
// SPDX-License-Identifier: MIT
import { computed, ref, watch } from 'vue';
import {
  ArrowUp,
  ChevronRight,
  Eye,
  EyeOff,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Home,
  LoaderCircle,
  RefreshCw,
} from 'lucide-vue-next';
import { t } from '../../i18n/i18n';
import { sshClient } from '../client';
import type { RemoteDirEntry } from '../types';

const props = defineProps<{
  hostId: string;
  initialPath?: string | null;
  homeDir?: string;
  recentPaths?: string[];
  opening?: boolean;
}>();

const emit = defineEmits<{
  open: [remotePath: string];
}>();

const currentPath = ref(props.initialPath || props.homeDir || '/');
const pathInput = ref(currentPath.value);
const parentPath = ref<string | null>(null);
const entries = ref<RemoteDirEntry[]>([]);
const includeHidden = ref(false);
const loading = ref(false);
const error = ref('');
const creatingFolder = ref(false);
const newFolderName = ref('');
const mkdirBusy = ref(false);

const breadcrumbs = computed(() => {
  const parts = currentPath.value.split('/').filter(Boolean);
  const crumbs: Array<{ label: string; path: string }> = [{ label: '/', path: '/' }];
  let acc = '';
  for (const part of parts) {
    acc += `/${part}`;
    crumbs.push({ label: part, path: acc });
  }
  return crumbs;
});

async function loadDir(targetPath?: string | null) {
  loading.value = true;
  error.value = '';
  try {
    const res = await sshClient.listDir(props.hostId, targetPath ?? currentPath.value, includeHidden.value);
    currentPath.value = res.path;
    pathInput.value = res.path;
    parentPath.value = res.parent ?? null;
    entries.value = res.entries;
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    loading.value = false;
  }
}

function submitPath() {
  const target = pathInput.value.trim();
  if (!target) return;
  void loadDir(target);
}

async function createFolder() {
  const name = newFolderName.value.trim();
  if (!name || name.includes('/') || name === '.' || name === '..') {
    error.value = t('请输入有效的文件夹名称');
    return;
  }
  mkdirBusy.value = true;
  error.value = '';
  try {
    const full = currentPath.value === '/' ? `/${name}` : `${currentPath.value}/${name}`;
    const created = await sshClient.mkdir(props.hostId, full);
    creatingFolder.value = false;
    newFolderName.value = '';
    await loadDir(created);
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    mkdirBusy.value = false;
  }
}

watch(
  () => [props.hostId, props.initialPath, props.homeDir] as const,
  ([, initial, home]) => {
    const start = initial || home || null;
    void loadDir(start);
  },
  { immediate: true },
);

watch(includeHidden, () => {
  void loadDir(currentPath.value);
});
</script>

<template>
  <div class="remote-browser">
    <form class="remote-path-bar" @submit.prevent="submitPath">
      <button
        type="button"
        class="icon-button"
        :disabled="!parentPath || loading"
        :aria-label="t('上一级目录')"
        :title="t('上一级目录')"
        @click="parentPath && loadDir(parentPath)"
      >
        <ArrowUp :size="15" />
      </button>
      <button
        type="button"
        class="icon-button"
        :disabled="loading"
        :aria-label="t('主目录')"
        :title="t('主目录')"
        @click="loadDir(homeDir || '~')"
      >
        <Home :size="15" />
      </button>
      <input
        v-model="pathInput"
        type="text"
        class="remote-path-input"
        :aria-label="t('远端目录路径')"
        :placeholder="t('输入远端 POSIX 路径，如 /srv/project 或 ~')"
        spellcheck="false"
        autocomplete="off"
      />
      <button type="submit" class="secondary-button remote-go-btn" :disabled="loading">
        {{ t('前往') }}
      </button>
      <button
        type="button"
        class="icon-button"
        :class="{ active: includeHidden }"
        :aria-pressed="includeHidden"
        :title="includeHidden ? t('隐藏点文件目录') : t('显示隐藏文件夹')"
        @click="includeHidden = !includeHidden"
      >
        <Eye v-if="includeHidden" :size="15" />
        <EyeOff v-else :size="15" />
      </button>
      <button
        type="button"
        class="icon-button"
        :title="t('新建远端文件夹')"
        @click="creatingFolder = !creatingFolder"
      >
        <FolderPlus :size="15" />
      </button>
      <button
        type="button"
        class="icon-button"
        :disabled="loading"
        :title="t('刷新目录')"
        @click="loadDir(currentPath)"
      >
        <RefreshCw :size="15" :class="{ spinning: loading }" />
      </button>
    </form>

    <nav class="remote-breadcrumbs" :aria-label="t('远端路径导航')">
      <template v-for="(crumb, index) in breadcrumbs" :key="crumb.path">
        <ChevronRight v-if="index > 0" :size="12" class="crumb-sep" />
        <button
          type="button"
          class="crumb-btn"
          :class="{ current: index === breadcrumbs.length - 1 }"
          @click="loadDir(crumb.path)"
        >
          {{ crumb.label }}
        </button>
      </template>
    </nav>

    <div v-if="recentPaths?.length" class="remote-recent-paths">
      <span class="recent-paths-label">{{ t('最近路径') }}</span>
      <button
        v-for="item in recentPaths.slice(0, 5)"
        :key="item"
        type="button"
        class="recent-path-chip"
        :title="item"
        @click="loadDir(item)"
      >
        {{ item }}
      </button>
    </div>

    <form v-if="creatingFolder" class="remote-mkdir-bar" @submit.prevent="createFolder">
      <input
        v-model="newFolderName"
        type="text"
        :placeholder="t('新文件夹名称')"
        :disabled="mkdirBusy"
        autocomplete="off"
      />
      <button type="submit" class="primary-button" :disabled="mkdirBusy || !newFolderName.trim()">
        {{ t('创建') }}
      </button>
      <button type="button" class="secondary-button" :disabled="mkdirBusy" @click="creatingFolder = false">
        {{ t('取消') }}
      </button>
    </form>

    <p v-if="error" class="form-error" role="alert">{{ error }}</p>

    <div class="remote-dir-list" role="listbox" :aria-label="t('远端目录内容')">
      <div v-if="loading && !entries.length" class="remote-dir-empty">
        <LoaderCircle :size="18" class="spinning" />
        <span>{{ t('正在读取远端目录…') }}</span>
      </div>
      <div v-else-if="!entries.length" class="remote-dir-empty">
        <span>{{ t('此目录为空') }}</span>
      </div>
      <template v-else>
        <button
          v-for="entry in entries"
          :key="entry.path"
          type="button"
          class="remote-dir-item"
          :class="{ 'is-dir': entry.kind === 'dir', 'is-file': entry.kind !== 'dir' }"
          :disabled="entry.kind !== 'dir'"
          @click="entry.kind === 'dir' && loadDir(entry.path)"
        >
          <Folder v-if="entry.kind === 'dir'" :size="15" class="dir-icon" />
          <FileText v-else :size="15" class="file-icon" />
          <span class="entry-name">{{ entry.name }}</span>
          <span v-if="entry.isSymlink" class="entry-tag">{{ t('链接') }}</span>
        </button>
      </template>
    </div>

    <footer class="remote-browser-footer">
      <div class="remote-selected-summary" :title="currentPath">
        <FolderOpen :size="15" />
        <code>{{ currentPath }}</code>
      </div>
      <button
        type="button"
        class="primary-button"
        :disabled="loading || opening || !currentPath"
        @click="emit('open', currentPath)"
      >
        <LoaderCircle v-if="opening" :size="14" class="spinning" />
        <span>{{ opening ? t('正在打开工作区…') : t('打开此文件夹') }}</span>
      </button>
    </footer>
  </div>
</template>

<style scoped>
.remote-browser {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  flex: 1;
}
.remote-path-bar {
  display: flex;
  align-items: center;
  gap: 6px;
}
.remote-path-input {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 12.5px;
  padding: 5px 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
}
.remote-go-btn {
  padding: 4px 10px;
  font-size: 12px;
}
.remote-breadcrumbs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  font-size: 12px;
  color: var(--muted);
}
.crumb-btn {
  border: 0;
  background: transparent;
  color: var(--muted);
  padding: 2px 5px;
  border-radius: 4px;
  cursor: pointer;
  font-family: var(--font-mono);
}
.crumb-btn:hover,
.crumb-btn.current {
  background: var(--hover);
  color: var(--text);
}
.remote-recent-paths {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12px;
}
.recent-paths-label {
  color: var(--muted);
}
.recent-path-chip {
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--text);
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 11.5px;
  font-family: var(--font-mono);
  cursor: pointer;
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.recent-path-chip:hover {
  background: var(--hover);
}
.remote-mkdir-bar {
  display: flex;
  gap: 6px;
}
.remote-mkdir-bar input {
  flex: 1;
  padding: 5px 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
}
.remote-dir-list {
  flex: 1;
  min-height: 200px;
  max-height: 300px;
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg);
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.remote-dir-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--muted);
  font-size: 13px;
  padding: 40px 12px;
}
.remote-dir-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  border: 0;
  background: transparent;
  color: var(--text);
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}
.remote-dir-item.is-dir:hover {
  background: var(--hover);
}
.remote-dir-item.is-file {
  color: var(--muted);
  cursor: default;
}
.entry-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.entry-tag {
  font-size: 11px;
  color: var(--muted);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 0 4px;
}
.remote-browser-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
}
.remote-selected-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--muted);
  font-size: 12px;
}
.remote-selected-summary code {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}
</style>
