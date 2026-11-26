<script setup lang="ts">
import './plugin-center.css';
import { recordHelpCompleted } from '../../help/help-checklist';
import { usePluginActions, matchesPlugin } from '../use-plugin-actions';
import LoadingSkeleton from '../../shell/components/LoadingSkeleton.vue';
import { retiredSystemPlugin } from '../workspace-plugins';
import { t } from '../../i18n/i18n';
import { computed, nextTick, ref, watch } from 'vue';
import {
  Check,
  ChevronDown,
  Download,
  LoaderCircle,
  Package,
  Plus,
  Search,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-vue-next';
import type { PluginManifest } from '@tano/protocol';
import PluginRuntimePanel from './PluginRuntimePanel.vue';

import PluginRepositoryStorage from './PluginRepositoryStorage.vue';
import PluginCatalogBrowser from './PluginCatalogBrowser.vue';
import PluginConnections from './PluginConnections.vue';
import PluginAutomations from './PluginAutomations.vue';
import PluginImportDialog from './PluginImportDialog.vue';

import { useWorkspaceStore } from '../../stores/workspace';

import PluginListItem from './PluginListItem.vue';
import { bundledPluginCatalog, type PluginCatalogEntry } from '../plugin-catalog';

const props = withDefaults(defineProps<{ catalog?: readonly PluginCatalogEntry[] }>(), {
  catalog: () => bundledPluginCatalog,
});
const store = useWorkspaceStore();
const { error, status, pending, busy, change, installFromCatalog } = usePluginActions(undefined, () => props.catalog);
defineExpose({ openImport });
const emit = defineEmits<{ createObject: [type: string]; feedback: [status: string, error: string] }>();
const pluginObjectTypes = computed(() =>
  store.objectDefinitions.filter((type) => type.category === 'plugin' && type.storage === 'record'),
);
watch([status, error], ([message, failure]) => emit('feedback', message, failure));
const search = ref<HTMLInputElement>();
type View = 'discover' | 'installed' | 'community' | 'forge' | 'publishing';
const view = ref<View>('discover');
const publishingOpened = ref(false);
const query = ref('');
const category = ref('all');
const installedFilter = ref('all');
const importing = ref(false);

const pageSize = 24;
const visibleLimit = ref(pageSize);
const categories = computed(() => {
  const groups = new Map<string, { id: string; label: string; count: number }>();
  for (const { category } of props.catalog) {
    const group = groups.get(category.id);
    if (group) group.count++;
    else groups.set(category.id, { ...category, count: 1 });
  }
  return [...groups.values()];
});
const installedById = computed(
  () => new Map(store.installedPlugins.map((item) => [item.manifest.id, item])),
);
const feedbackError = computed(() => error.value || store.pluginError);

const matches = (plugin: PluginManifest) => matchesPlugin(plugin, query.value);
const catalog = computed(() =>
  props.catalog.filter(entry => !retiredSystemPlugin(entry.manifest.id))
    .filter(
      (entry) =>
        (category.value === 'all' || entry.category.id === category.value) &&
        matches(entry.manifest),
    )
    .map((entry) => entry.manifest),
);
const installed = computed(() =>
  store.installedPlugins.filter(
    (item) =>
      matches(item.manifest) &&
      (installedFilter.value === 'all' || item.enabled === (installedFilter.value === 'enabled')),
  ),
);
const resultCount = computed(() =>
  view.value === 'discover' ? catalog.value.length : installed.value.length,
);
const visiblePlugins = computed(() =>
  (view.value === 'discover' ? catalog.value : installed.value.map((item) => item.manifest)).slice(
    0,
    visibleLimit.value,
  ),
);
const remaining = computed(() => Math.max(0, resultCount.value - visibleLimit.value));
const resultsTitle = computed(() =>
  query.value.trim()
    ? t('搜索结果')
    : view.value === 'installed'
      ? t('我的插件')
      : (categories.value.find((item) => item.id === category.value)?.label ?? t('全部插件')),
);
watch([view, query, category, installedFilter, () => props.catalog], () => {
  visibleLimit.value = pageSize;
});

function chooseView(value: View) {
  if (value === 'publishing') publishingOpened.value = true;
  view.value = value;
  query.value = '';
  category.value = 'all';
  installedFilter.value = 'all';
}
function clearFilters() {
  query.value = '';
  category.value = 'all';
  installedFilter.value = 'all';
  search.value?.focus();
}
function browse() {
  chooseView('discover');
  nextTick(() => search.value?.focus());
}
function showDetails(plugin: PluginManifest) { recordHelpCompleted('plugins', 'plugin-details'); void store.openPluginDetail(plugin.id); }
function openImport() {
  error.value = '';
  status.value = '';
  importing.value = true;
}
watch(
  () => store.workspace?.id,
  () => {
    importing.value = false;
    error.value = '';
    status.value = '';
    chooseView('discover');
  },
);
</script>

<template>
  <div class="plugin-center">
    <LoadingSkeleton v-if="store.workspaceLoading?.plugins" :rows="6" />
    <div v-show="!store.workspaceLoading?.plugins" class="component-loading-content">
    <div class="catalog-controls">
      <header class="center-heading">
        <div class="center-title">
          <h1>{{ t('插件') }}</h1>
          <p>{{ t('发现、安装和管理你的同页扩展。') }}</p>
        </div>
        <div class="heading-actions">
          <label v-if="view === 'discover' || view === 'installed'" class="plugin-search"
            ><Search :size="15" aria-hidden="true" />
            <input
              ref="search"
              v-model="query"
              type="search"
              :aria-label="t('查找插件')"
              :placeholder="view === 'discover' ? t('搜索插件') : t('搜索已安装插件')"
            />
            <button
              v-if="query"
              :aria-label="t('清空搜索')"
              @click="
                query = '';
                search?.focus();
              "
            >
              <X :size="14" />
            </button>
          </label>
          <button v-if="view === 'community' && $slots.publishing" class="pc-button pc-primary" @click="chooseView('publishing')">
            <Upload :size="15" />{{ t('发布插件') }}
          </button>
          <button v-if="view !== 'publishing'" class="pc-button pc-add" :aria-label="t('导入插件')" @click="openImport">
            <Upload :size="15" />{{ t('导入') }}
          </button>
        </div>
      </header>
      <div class="catalog-navigation">
        <nav class="center-nav" :aria-label="t('插件中心导航')">
          <button :class="{ active: view === 'community' }" :aria-pressed="view === 'community'" @click="chooseView('community')">{{ t('社区目录') }}</button>
          <button
            :class="{ active: view === 'discover' }"
            :aria-pressed="view === 'discover'"
            @click="chooseView('discover')"
          >
            {{ t('发现') }}
          </button>
          <button
            :class="{ active: view === 'installed' }"
            :aria-pressed="view === 'installed'"
            @click="chooseView('installed')"
          >
            {{ t('已安装') }} <span class="nav-count">{{ store.installedPlugins.length }}</span>
          </button>
          <button
            v-if="$slots.forge"
            :class="{ active: view === 'forge' }"
            :aria-pressed="view === 'forge'"
            @click="chooseView('forge')"
          >
            {{ t('工坊与微调') }}
          </button>
          <button v-if="$slots.publishing" :class="{ active: view === 'publishing' }" :aria-pressed="view === 'publishing'" @click="chooseView('publishing')">{{ t('我的投稿') }}</button>
        </nav>
        <label v-if="view === 'discover' || view === 'installed'" class="catalog-filter">
          <select v-if="view === 'discover'" v-model="category" :aria-label="t('插件分类')">
            <option value="all">{{ t('全部分类') }}</option>
            <option v-for="group in categories" :key="group.id" :value="group.id">
              {{ group.label }} · {{ group.count }}
            </option>
          </select>
          <select v-else v-model="installedFilter" :aria-label="t('安装状态')">
            <option value="all">{{ t('全部状态') }}</option>
            <option value="enabled">{{ t('已启用') }}</option>
            <option value="disabled">{{ t('已停用') }}</option>
          </select>
          <ChevronDown :size="13" aria-hidden="true" />
        </label>
      </div>
    </div>

    <template v-if="!importing && view !== 'publishing'">
      <p v-if="feedbackError" class="pc-feedback error" role="alert">{{ feedbackError }}</p>
      <p v-if="status" class="pc-feedback success" role="status">
        <Check :size="15" />{{ status }}
      </p>
    </template>

    <PluginCatalogBrowser v-if="view === 'community'" />
    <slot
      v-else-if="view === 'forge' && $slots.forge"
      name="forge"
      :can-publish="!!$slots.publishing"
      :open-publishing="() => chooseView('publishing')"
    />
    <section v-else-if="view !== 'publishing'"
      class="catalog-results"
      :aria-label="view === 'discover' ? t('可安装插件') : t('已安装插件')"
    >
      <div class="catalog-heading">
        <h2>{{ resultsTitle }}</h2>
        <span class="result-count" role="status" :aria-label="t('{0} 款插件', [resultCount])">{{
          resultCount
        }}</span>
      </div>
      <div v-if="visiblePlugins.length" class="plugin-list">
        <PluginListItem
          v-for="plugin in visiblePlugins"
          :key="plugin.id"
          :plugin="plugin"
          :installed="installedById.has(plugin.id)"
          :enabled="installedById.get(plugin.id)?.enabled"
          :scope="installedById.get(plugin.id)?.scope"
          :show-state="view === 'installed'"
          :busy="busy || !store.canManagePlugins"
          :pending="pending === plugin.id"
          @details="showDetails(plugin)"
          @install="installFromCatalog(plugin)"
        />
      </div>
      <div v-else-if="view === 'installed' && !store.installedPlugins.length" class="pc-empty">
        <Package :size="28" :stroke-width="1.4" />
        <h3>{{ t('还没有安装插件') }}</h3>
        <p>{{ t('去发现适合你的插件，或导入自己的插件。') }}</p>
        <button class="pc-button pc-secondary" @click="browse">{{ t('浏览插件') }}</button>
      </div>
      <div v-else class="pc-empty">
        <Search :size="28" :stroke-width="1.4" />
        <h3>{{ t('没有找到匹配的插件') }}</h3>
        <p>{{ t('试试其他关键词，或调整筛选条件。') }}</p>
        <button class="pc-button pc-secondary" @click="clearFilters">{{ t('重置筛选') }}</button>
      </div>
      <div v-if="remaining" class="catalog-more">
        <button class="pc-button pc-secondary" @click="visibleLimit += pageSize">
          {{ t('显示更多') }} <ChevronDown :size="14" /></button
        ><span>{{ t('已显示') }} {{ visiblePlugins.length }} / {{ resultCount }}</span>
      </div>
      <p v-if="view === 'installed' && visiblePlugins.length" class="installed-note">
        {{ t('工作区插件与共享设置跟随工作区；全局插件、个人启用和代码授权保存在此设备，跨工作区生效。卸载后保留已有内容。') }}
      </p>
    </section>

    <div v-if="publishingOpened && $slots.publishing" v-show="view === 'publishing'">
      <slot name="publishing" />
    </div>
    <template v-if="view !== 'publishing'">
      <PluginRuntimePanel />
      <PluginConnections />
      <PluginAutomations />
      <PluginRepositoryStorage />
    </template>
    <footer v-if="view !== 'publishing'" class="center-footer">
      <span>{{ store.pluginCatalogSource ? t('社区目录已接入 · 版本由工作区管理员选择') : t('当前提供内置插件与文件导入 · 社区目录尚未配置') }}</span>
      <button
        v-if="pluginObjectTypes.length"
        :disabled="!store.workspace || store.workspace.readOnly || !store.capabilities.features.objectReferences"
        @click="emit('createObject', pluginObjectTypes[0]!.type)"
      >
        <Plus :size="13" />{{ t('新建插件对象') }}
      </button>
    </footer>
    <PluginImportDialog
      v-if="importing"
      @close="importing = false"
      @installed="chooseView('installed')"
      @feedback="(message, failure) => { status = message; error = failure; }"
    />
    </div>
  </div>
</template>
