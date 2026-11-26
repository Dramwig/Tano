<script setup lang="ts">
import { computed, inject, ref, defineAsyncComponent, onMounted, onBeforeUnmount } from 'vue';
import {
  Settings,
  MoreHorizontal,
  Download,
  LoaderCircle,
  Search,
  ChevronRight,
  Upload,
  Puzzle,
  Power,
  Trash2,
  Info,
} from 'lucide-vue-next';
import { t } from '../../i18n/i18n';
import { useWorkspaceStore } from '../../stores/workspace';
import { bundledPluginCatalog } from '../plugin-catalog';
import { retiredSystemPlugin } from '../workspace-plugins';
import { matchesPlugin, usePluginActions } from '../use-plugin-actions';
import PluginIcon from './PluginIcon.vue';
import { workbenchPrefsKey } from '../../shell/workbench-context';
import { useWindowContext } from '../../windows/context';
const { window } = useWindowContext();
const root = ref<HTMLElement>();
function dismissMenus(event: Event) {
  for (const details of root.value?.querySelectorAll<HTMLDetailsElement>('details[open]') ?? []) {
    if (event.type === 'keydown' && (event as KeyboardEvent).key !== 'Escape') return;
    if (event.type !== 'keydown' && details.contains(event.target as Node)) continue;
    details.open = false;
    if (event.type === 'keydown') details.querySelector('summary')?.focus();
  }
}
function toggleMenu(event: Event) {
  const current = event.target as HTMLDetailsElement;
  if (current.open)
    for (const details of root.value?.querySelectorAll<HTMLDetailsElement>('details[open]') ?? [])
      if (details !== current) details.open = false;
}
onMounted(() => {
  window.addEventListener('pointerdown', dismissMenus);
  window.addEventListener('keydown', dismissMenus);
});
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', dismissMenus);
  window.removeEventListener('keydown', dismissMenus);
});
const PluginImportDialog = defineAsyncComponent(() => import('./PluginImportDialog.vue'));
const props = defineProps<{ developerMode?: boolean }>();
const workbench = inject(workbenchPrefsKey, null);
const isDeveloperMode = computed(() => props.developerMode ?? Boolean(workbench?.developerMode));
const store = useWorkspaceStore();
const query = ref(''),
  importing = ref(false);
const installedOpen = ref(true),
  recommendedOpen = ref(!store.installedPlugins.length);
const { error, status, pending, busy, change, installFromCatalog } = usePluginActions();
const installed = computed(() =>
  store.installedPlugins.filter((item) => matchesPlugin(item.manifest, query.value)),
);
const recommended = computed(() =>
  bundledPluginCatalog.filter(
    (item) =>
      !retiredSystemPlugin(item.manifest.id) &&
      !store.installedPlugins.some((local) => local.manifest.id === item.manifest.id) &&
      matchesPlugin(item.manifest, query.value),
  ),
);
function closeMenu(event: Event) {
  (event.currentTarget as HTMLElement).closest('details')?.removeAttribute('open');
}
function openImport() {
  importing.value = true;
}
</script>
<template>
  <div ref="root" class="plugin-explorer" role="region" :aria-label="t('插件')">
    <header>
      <label class="outline-search"
        ><Search :size="14" aria-hidden="true" /><input
          v-model="query"
          type="search"
          :placeholder="t('搜索插件')"
          :aria-label="t('搜索插件')"
      /></label>
      <details @toggle="toggleMenu">
        <summary class="icon-button" :aria-label="t('更多操作')">
          <MoreHorizontal :size="16" />
        </summary>
        <div class="dropdown compact-action-menu actions-menu" @click="closeMenu">
          <button v-if="isDeveloperMode" @click="openImport"><Upload :size="14" />{{ t('导入插件…') }}</button
          ><button @click="store.openPluginsTab()">
            <Puzzle :size="14" />{{ t('插件中心…') }}
          </button>
        </div>
      </details>
    </header>
    <p v-if="error || store.pluginError" role="alert">{{ error || store.pluginError }}</p>
    <p v-if="status" role="status">{{ status }}</p>
    <p v-if="query && !installed.length && !recommended.length">{{ t('没有找到匹配的插件') }}</p>
    <button
      class="group"
      :aria-expanded="installedOpen || !!query"
      @click="installedOpen = !installedOpen"
    >
      <ChevronRight :size="12" :class="{ expanded: installedOpen || !!query }" />{{ t('已安装') }}
      <span>{{ installed.length }}</span>
    </button>
    <section v-if="installedOpen || query">
      <div
        v-for="item in installed"
        :key="item.manifest.id"
        class="row"
        :class="{ disabled: !item.enabled }"
      >
        <button class="main" @click="store.openPluginDetail(item.manifest.id)">
          <PluginIcon :id="item.manifest.id" /><span
            ><strong
              >{{ item.manifest.name }}
              <small v-if="item.scope === 'user'">{{ t('全局') }}</small>
              <small v-if="!item.enabled">{{ t('已停用') }}</small></strong
            ><span class="description">{{ item.manifest.description }}</span></span
          >
        </button>
        <details @toggle="toggleMenu">
          <summary class="icon-button" :aria-label="t('管理插件')"><Settings :size="16" /></summary>
          <div class="dropdown compact-action-menu actions-menu" @click="closeMenu">
            <button
              :disabled="busy || item.rule?.mode === 'required' || item.rule?.mode === 'disabled'"
              @click="change({ id: item.manifest.id, enabled: !item.enabled })"
            >
              <Power :size="14" />{{ item.enabled ? t('停用插件') : t('启用插件') }}</button
            ><button
              v-if="!item.system"
              :disabled="busy || (item.scope !== 'user' && !store.canManagePlugins)"
              @click="change({ uninstall: item.manifest.id })"
            >
              <Trash2 :size="14" />{{ t('卸载插件') }}</button
            ><button @click="store.openPluginDetail(item.manifest.id)">
              <Info :size="14" />{{ t('查看详情') }}
            </button>
          </div>
        </details>
      </div>
    </section>
    <button
      class="group"
      :aria-expanded="recommendedOpen || !!query"
      @click="recommendedOpen = !recommendedOpen"
    >
      <ChevronRight :size="12" :class="{ expanded: recommendedOpen || !!query }" />{{ t('推荐') }}
      <span>{{ recommended.length }}</span>
    </button>
    <section v-if="recommendedOpen || query">
      <div v-for="item in recommended" :key="item.manifest.id" class="row">
        <button class="main" @click="store.openPluginDetail(item.manifest.id)">
          <PluginIcon :id="item.manifest.id" /><span
            ><strong>{{ item.manifest.name }}</strong
            ><span class="description">{{ item.manifest.description }}</span></span
          ></button
        ><button
          class="icon-button install-action"
          :aria-label="pending === item.manifest.id ? t('正在安装…') : t('安装')"
          :data-tooltip="pending === item.manifest.id ? t('正在安装…') : t('安装')"
          :disabled="busy || !store.canManagePlugins"
          @click="installFromCatalog(item.manifest)"
        >
          <LoaderCircle
            v-if="pending === item.manifest.id"
            class="install-spinner"
            :size="16"
            aria-hidden="true"
          />
          <Download v-else :size="16" aria-hidden="true" />
        </button>
      </div>
    </section>
    <PluginImportDialog
      v-if="importing"
      @close="importing = false"
      @feedback="
        (message, failure) => {
          status = message;
          error = failure;
        }
      "
    />
  </div>
</template>
<style scoped>
.install-action { flex-shrink:0; }
.install-spinner {
  animation: install-spin 1s linear infinite;
}
@keyframes install-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .install-spinner {
    animation: none;
  }
}

.plugin-explorer {
  padding: 8px;
  overflow: auto;
}
header {
  display: flex;
  gap: 6px;
  align-items: center;
}
.outline-search {
  flex: 1;
  min-width: 0;
  margin: 0;
  background: var(--paper);
}
.outline-search:focus-within {
  border-color: var(--control-border);
}
button {
  color: var(--text);
}
.group {
  display: flex;
  width: 100%;
  gap: 8px;
  padding: 10px 4px;
  text-align: left;
}
.row {
  display: flex;
  align-items: center;
  min-height: 54px;
  gap: 4px;
}
.row:hover {
  background: var(--hover);
}
.main {
  display: flex;
  flex: 1;
  min-width: 0;
  gap: 8px;
  align-items: center;
  text-align: left;
}
.main :deep(.plugin-icon) {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
}
.main > span {
  min-width: 0;
}
strong,
.description {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.description,
small {
  color: var(--muted);
  font-size: 12px;
}
.disabled .main {
  opacity: 0.5;
}
details {
  position: relative;
}
/* Floating menus must escape the shared accordion disclosure's clipping. */
.plugin-explorer details::details-content {
  block-size: auto;
  opacity: 1;
  overflow: visible;
  transition: none;
}
summary {
  cursor: pointer;
  list-style: none;
}
details[open] {
  z-index: 5;
}
.actions-menu {
  right: 0;
  top: calc(100% + 4px);
}
.group {
  align-items: center;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
}
.group > svg {
  color: var(--muted);
  transition: transform var(--motion-quick);
}
.group > svg.expanded {
  transform: rotate(90deg);
}
.row {
  border-radius: 5px;
}
strong {
  font-size: 13px;
  font-weight: 500;
}
</style>
