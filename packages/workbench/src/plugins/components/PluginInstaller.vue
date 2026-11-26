<script setup lang="ts">
import './plugin-center.css';
import { recordHelpCompleted } from '../../help/help-checklist';
import { usePluginActions, matchesPlugin } from '../use-plugin-actions';
import LoadingSkeleton from '../../shell/components/LoadingSkeleton.vue';
import { retiredSystemPlugin } from '../workspace-plugins';
import { t } from '../../i18n/i18n';
import { vEnterStagger } from '../../shell/enter-stagger';
import { computed, inject, nextTick, ref, useSlots, watch } from 'vue';
import {
  Check,
  ChevronDown,
  Code2,
  Package,
  Plus,
  Search,
  X,
} from 'lucide-vue-next';
import type { PluginManifest, WorkspacePersonalPluginPolicy } from '@tano/protocol';
import { useWorkbenchRuntime } from '../../runtime';
import { workbenchPrefsKey } from '../../shell/workbench-context';
import PluginRuntimePanel from './PluginRuntimePanel.vue';
import PluginCatalogBrowser from './PluginCatalogBrowser.vue';
import PluginConnections from './PluginConnections.vue';
import PluginAutomations from './PluginAutomations.vue';
import PluginImportDialog from './PluginImportDialog.vue';
import PluginDeveloperArea from './PluginDeveloperArea.vue';

import { useWorkspaceStore } from '../../stores/workspace';

import PluginListItem from './PluginListItem.vue';
import { bundledPluginCatalog, type PluginCatalogEntry } from '../plugin-catalog';

const props = withDefaults(
  defineProps<{
    catalog?: readonly PluginCatalogEntry[];
    developerMode?: boolean;
  }>(),
  {
    catalog: () => bundledPluginCatalog,
    developerMode: undefined,
  },
);
const slots = useSlots();
const workbench = inject(workbenchPrefsKey, null);
const runtime = useWorkbenchRuntime();
const store = useWorkspaceStore();
const { error, status, pending, busy, change, installFromCatalog } = usePluginActions(undefined, () => props.catalog);
const emit = defineEmits<{
  createObject: [type: string];
  feedback: [status: string, error: string];
  enableDeveloperMode: [];
}>();

const localDeveloperMode = ref(false);
const isDeveloperMode = computed(
  () => props.developerMode ?? (workbench ? Boolean(workbench.developerMode) : localDeveloperMode.value),
);
const communityAvailable = computed(() => Boolean(store.pluginCatalogSource));
const automationsAvailable = computed(() => Boolean(runtime.plugins?.automations));
const pluginObjectTypes = computed(() =>
  store.objectDefinitions.filter((type) => type.category === 'plugin' && type.storage === 'record'),
);
watch([status, error], ([message, failure]) => emit('feedback', message, failure));

const search = ref<HTMLInputElement>();
type View = 'discover' | 'installed' | 'community' | 'customize' | 'developer';
const view = ref<View>('discover');
const developerOpened = ref(false);
const developerSection = ref<'tools' | 'forge' | 'publishing'>('tools');
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
watch(isDeveloperMode, (enabled) => {
  if (!enabled) {
    developerOpened.value = false;
    if (view.value === 'developer') view.value = 'discover';
  }
});
watch(communityAvailable, (available) => {
  if (!available && view.value === 'community') {
    view.value = 'discover';
  }
});

function chooseView(value: View) {
  if (value === 'community' && !communityAvailable.value) return;
  if (value === 'customize' && !slots.customize) return;
  if (value === 'developer' && !isDeveloperMode.value) return;
  if (value === 'developer') developerOpened.value = true;
  view.value = value;
  query.value = '';
  category.value = 'all';
  installedFilter.value = 'all';
}
function enableDeveloperArea() {
  if (workbench) {
    workbench.developerMode = true;
  } else {
    localDeveloperMode.value = true;
  }
  emit('enableDeveloperMode');
  nextTick(() => {
    if (isDeveloperMode.value) {
      developerSection.value = 'tools';
      chooseView('developer');
    }
  });
}
function updatePersonalPolicy(value: WorkspacePersonalPluginPolicy) {
  if (!store.workspace) return;
  void change({ personalCodePlugins: value });
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
function showDetails(plugin: PluginManifest) {
  recordHelpCompleted('plugins', 'plugin-details');
  void store.openPluginDetail(plugin.id);
}
function openImport() {
  error.value = '';
  status.value = '';
  importing.value = true;
}
defineExpose({ openImport });
watch(
  () => store.workspace?.id,
  () => {
    importing.value = false;
    developerOpened.value = false;
    error.value = '';
    status.value = '';
    chooseView('discover');
  },
);
</script>

<template>
  <div class="plugin-center">
    <LoadingSkeleton v-if="store.workspaceLoading?.plugins" :rows="6" />
    <!-- Hidden behind the skeleton while plugins load: enters when shown. -->
    <div
      v-show="!store.workspaceLoading?.plugins"
      v-enter-stagger="'.center-heading, .catalog-navigation, .catalog-heading, .plugin-list > *, .pc-empty, .catalog-more, .center-footer'"
      class="component-loading-content"
    >
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
          </div>
        </header>
        <div class="catalog-navigation">
          <nav class="center-nav" :aria-label="t('插件中心导航')">
            <button
              :class="{ active: view === 'discover' }"
              :aria-pressed="view === 'discover'"
              @click="chooseView('discover')"
            >
              {{ t('发现') }}
            </button>
            <button
              v-if="communityAvailable"
              :class="{ active: view === 'community' }"
              :aria-pressed="view === 'community'"
              @click="chooseView('community')"
            >
              {{ t('社区目录') }}
            </button>
            <button
              :class="{ active: view === 'installed' }"
              :aria-pressed="view === 'installed'"
              @click="chooseView('installed')"
            >
              {{ t('已安装') }} <span class="nav-count">{{ store.installedPlugins.length }}</span>
            </button>
            <button
              v-if="$slots.customize"
              :class="{ active: view === 'customize' }"
              :aria-pressed="view === 'customize'"
              @click="chooseView('customize')"
            >
              {{ t('工作台微调') }}
            </button>
            <button
              v-if="isDeveloperMode"
              :class="{ active: view === 'developer' }"
              :aria-pressed="view === 'developer'"
              @click="chooseView('developer')"
            >
              <Code2 :size="14" aria-hidden="true" />{{ t('开发者') }}
            </button>
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

      <template v-if="!importing && view !== 'developer'">
        <p v-if="feedbackError" class="pc-feedback error" role="alert">{{ feedbackError }}</p>
        <p v-if="status" class="pc-feedback success" role="status">
          <Check :size="15" />{{ status }}
        </p>
      </template>

      <PluginDeveloperArea
        v-if="developerOpened && isDeveloperMode"
        v-show="view === 'developer'"
        :can-publish="!!$slots.publishing"
        :initial-section="developerSection"
        @open-import="openImport"
      >
        <template v-if="$slots.forge" #forge="slotProps">
          <slot name="forge" v-bind="slotProps" />
        </template>
        <template v-if="$slots.publishing" #publishing="slotProps">
          <slot name="publishing" v-bind="slotProps" />
        </template>
      </PluginDeveloperArea>
      <PluginCatalogBrowser v-if="view === 'community' && communityAvailable" />
      <slot v-else-if="view === 'customize' && $slots.customize" name="customize" :developer-mode="isDeveloperMode" />
      <section
        v-else-if="view === 'discover' || view === 'installed'"
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
          <p>{{ t('去发现适合你的插件，扩展你的工作台能力。') }}</p>
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

        <template v-if="view === 'installed'">
          <p v-if="visiblePlugins.length" class="installed-note">
            {{ t('工作区插件与共享设置跟随工作区；全局插件、个人启用和代码授权保存在此设备，跨工作区生效。卸载后保留已有内容。') }}
          </p>
          <div v-if="store.canManagePlugins && store.workspace" class="workspace-plugin-policy">
            <label>
              <span>{{ t('本工作区对个人代码插件的策略') }}</span>
              <select
                :value="store.personalCodePluginPolicy"
                :disabled="busy"
                :aria-label="t('本工作区对个人代码插件的策略')"
                @change="updatePersonalPolicy(($event.target as HTMLSelectElement).value as WorkspacePersonalPluginPolicy)"
              >
                <option value="allow">{{ t('允许运行（遵循个人授权）') }}</option>
                <option value="read-only">{{ t('仅允许只读访问（禁止写入）') }}</option>
                <option value="block">{{ t('禁止个人代码插件访问本工作区') }}</option>
              </select>
            </label>
          </div>
          <PluginRuntimePanel v-if="store.pluginRuntime.length" />
          <PluginConnections v-if="store.pluginConnectionStorageLabel" />
          <PluginAutomations v-if="automationsAvailable" />
        </template>
      </section>

      <footer v-if="view !== 'developer' && view !== 'customize'" class="center-footer">
        <span v-if="communityAvailable">{{ t('社区目录已接入 · 版本由工作区管理员选择') }}</span>
        <button
          v-if="!isDeveloperMode"
          type="button"
          class="dev-optin-link"
          @click="enableDeveloperArea"
        >
          <Code2 :size="13" aria-hidden="true" />{{ t('开启开发者模式以导入或开发插件') }}
        </button>
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
