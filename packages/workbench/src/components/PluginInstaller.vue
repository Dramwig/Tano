<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Download,
  LoaderCircle,
  Package,
  Search,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-vue-next';
import { parseObjectPlugin } from '@tano/protocol';
import type { ObjectPluginManifest } from '@tano/protocol';
import type { PluginChange } from '../workspace-plugins';
import { useWorkspaceStore } from '../stores/workspace';
import PluginDialog from './PluginDialog.vue';
import PluginIcon from './PluginIcon.vue';
import PluginListItem from './PluginListItem.vue';
import { bundledPluginCatalog, type PluginCatalogEntry } from '../plugin-catalog';

const props = withDefaults(defineProps<{ catalog?: readonly PluginCatalogEntry[] }>(), {
  catalog: () => bundledPluginCatalog,
});
const store = useWorkspaceStore();
const emit = defineEmits<{ objects: [] }>();
const input = ref<HTMLInputElement>();
const search = ref<HTMLInputElement>();
const manifestText = ref('');
const preview = ref<ObjectPluginManifest>();
const error = ref('');
const status = ref('');
const pending = ref('');
const busy = computed(() => !!pending.value);
const view = ref<'discover' | 'installed'>('discover');
const query = ref('');
const category = ref('all');
const installedFilter = ref('all');
const importing = ref(false);
const selected = ref<ObjectPluginManifest>();
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
const selectedInstallation = computed(
  () => selected.value && installedById.value.get(selected.value.id),
);
// Installed details always describe the actual local version, including imported updates.
const detail = computed(() => selectedInstallation.value?.manifest ?? selected.value);
const feedbackError = computed(() => error.value || store.pluginError);
const hasDialog = computed(() => importing.value || !!selected.value);
let importSequence = 0;

function matches(plugin: ObjectPluginManifest) {
  const terms =
    `${plugin.name} ${plugin.id} ${plugin.description ?? ''} ${plugin.objectTypes.map((type) => `${type.label} ${type.type}`).join(' ')} ${plugin.relationTypes.map((type) => type.label).join(' ')}`.toLocaleLowerCase();
  return terms.includes(query.value.trim().toLocaleLowerCase());
}
const catalog = computed(() =>
  props.catalog
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
    ? '搜索结果'
    : view.value === 'installed'
      ? '我的插件'
      : (categories.value.find((item) => item.id === category.value)?.label ?? '全部插件'),
);
watch([view, query, category, installedFilter, () => props.catalog], () => {
  visibleLimit.value = pageSize;
});

function chooseView(value: 'discover' | 'installed') {
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
function showDetails(plugin: ObjectPluginManifest) {
  status.value = '';
  error.value = '';
  selected.value = plugin;
}
function openImport() {
  error.value = '';
  status.value = '';
  importing.value = true;
}
function closeDialog() {
  if (busy.value) return;
  importSequence++;
  selected.value = undefined;
  importing.value = false;
  manifestText.value = '';
  preview.value = undefined;
  error.value = '';
}
watch(
  () => store.workspace?.id,
  () => {
    importSequence++;
    importing.value = false;
    selected.value = undefined;
    manifestText.value = '';
    preview.value = undefined;
    error.value = '';
    status.value = '';
    chooseView('discover');
  },
);
watch(manifestText, () => {
  preview.value = undefined;
});
function inspect() {
  error.value = '';
  status.value = '';
  preview.value = undefined;
  try {
    preview.value = parseObjectPlugin(manifestText.value);
  } catch (cause) {
    error.value =
      cause instanceof SyntaxError
        ? 'JSON 格式有误，请检查引号、逗号和括号后重试。'
        : String(cause);
  }
}
async function importFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  (event.target as HTMLInputElement).value = '';
  if (!file) return;
  preview.value = undefined;
  error.value = '';
  status.value = '';
  const workspace = store.workspace?.id;
  const sequence = ++importSequence;
  try {
    if (file.size > 256 * 1024) throw new Error('插件清单不能超过 256 KB');
    const content = await file.text();
    if (store.workspace?.id !== workspace || sequence !== importSequence) return;
    manifestText.value = content;
    // Watch invalidation must finish before publishing the inspected preview.
    await nextTick();
    if (store.workspace?.id === workspace && sequence === importSequence) inspect();
  } catch (cause) {
    if (store.workspace?.id === workspace && sequence === importSequence)
      error.value = String(cause);
  }
}
async function change(value: PluginChange) {
  if (busy.value || !store.workspace) return;
  const workspace = store.workspace.id;
  pending.value =
    'install' in value ? value.install.id : 'uninstall' in value ? value.uninstall : value.id;
  error.value = '';
  status.value = '';
  try {
    await store.changePlugin(value, workspace);
    if (store.workspace?.id === workspace) {
      status.value =
        'install' in value
          ? `${value.install.name} 已安装并启用`
          : 'uninstall' in value
            ? '插件已卸载，对象和关系文件已保留'
            : value.enabled
              ? '插件已启用'
              : '插件已停用，对象和关系文件已保留';
      if ('install' in value) {
        preview.value = undefined;
        manifestText.value = '';
        if (importing.value) {
          importing.value = false;
          chooseView('installed');
        }
      }
      if ('uninstall' in value) selected.value = undefined;
    }
  } catch (cause) {
    if (store.workspace?.id === workspace) error.value = String(cause);
  } finally {
    pending.value = '';
  }
}
</script>

<template>
  <div class="plugin-center">
    <div class="catalog-controls">
      <header class="center-heading">
        <div class="center-title">
          <h1>插件</h1>
          <p>发现、安装和管理你的同页扩展。</p>
        </div>
        <div class="heading-actions">
          <label class="plugin-search"
            ><Search :size="15" aria-hidden="true" />
            <input
              ref="search"
              v-model="query"
              type="search"
              aria-label="查找插件"
              :placeholder="view === 'discover' ? '搜索插件' : '搜索已安装插件'"
            />
            <button
              v-if="query"
              aria-label="清空搜索"
              @click="
                query = '';
                search?.focus();
              "
            >
              <X :size="14" />
            </button>
          </label>
          <button class="pc-button pc-add" aria-label="导入插件" @click="openImport">
            <Upload :size="15" />导入
          </button>
        </div>
      </header>
      <div class="catalog-navigation">
        <nav class="center-nav" aria-label="插件中心导航">
          <button
            :class="{ active: view === 'discover' }"
            :aria-pressed="view === 'discover'"
            @click="chooseView('discover')"
          >
            发现
          </button>
          <button
            :class="{ active: view === 'installed' }"
            :aria-pressed="view === 'installed'"
            @click="chooseView('installed')"
          >
            已安装 <span class="nav-count">{{ store.installedPlugins.length }}</span>
          </button>
        </nav>
        <label class="catalog-filter">
          <select v-if="view === 'discover'" v-model="category" aria-label="插件分类">
            <option value="all">全部分类</option>
            <option v-for="group in categories" :key="group.id" :value="group.id">
              {{ group.label }} · {{ group.count }}
            </option>
          </select>
          <select v-else v-model="installedFilter" aria-label="安装状态">
            <option value="all">全部状态</option>
            <option value="enabled">已启用</option>
            <option value="disabled">已停用</option>
          </select>
          <ChevronDown :size="13" aria-hidden="true" />
        </label>
      </div>
    </div>

    <template v-if="!hasDialog">
      <p v-if="feedbackError" class="pc-feedback error" role="alert">{{ feedbackError }}</p>
      <p v-if="status" class="pc-feedback success" role="status">
        <Check :size="15" />{{ status }}
      </p>
    </template>

    <section
      class="catalog-results"
      :aria-label="view === 'discover' ? '可安装插件' : '已安装插件'"
    >
      <div class="catalog-heading">
        <h2>{{ resultsTitle }}</h2>
        <span class="result-count" role="status" :aria-label="`${resultCount} 款插件`">{{
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
          :show-state="view === 'installed'"
          :busy="busy"
          :pending="pending === plugin.id"
          @details="showDetails(plugin)"
          @install="change({ install: plugin })"
        />
      </div>
      <div v-else-if="view === 'installed' && !store.installedPlugins.length" class="pc-empty">
        <Package :size="28" :stroke-width="1.4" />
        <h3>还没有安装插件</h3>
        <p>去发现适合你的插件，或导入自己的插件。</p>
        <button class="pc-button pc-secondary" @click="browse">浏览插件</button>
      </div>
      <div v-else class="pc-empty">
        <Search :size="28" :stroke-width="1.4" />
        <h3>没有找到匹配的插件</h3>
        <p>试试其他关键词，或调整筛选条件。</p>
        <button class="pc-button pc-secondary" @click="clearFilters">重置筛选</button>
      </div>
      <div v-if="remaining" class="catalog-more">
        <button class="pc-button pc-secondary" @click="visibleLimit += pageSize">
          显示更多 <ChevronDown :size="14" /></button
        ><span>已显示 {{ visiblePlugins.length }} / {{ resultCount }}</span>
      </div>
      <p v-if="view === 'installed' && visiblePlugins.length" class="installed-note">
        仅在此设备的当前工作区启用。停用或卸载后，已有对象与关系会保留。
      </p>
    </section>

    <footer class="center-footer">
      <span>在线商店尚未开放 · 当前为随应用提供的插件</span
      ><button @click="emit('objects')">管理工作区对象 <ArrowUpRight :size="13" /></button>
    </footer>
    <PluginDialog
      v-if="hasDialog"
      :title="importing ? '导入插件' : '插件详情'"
      :busy="busy"
      @close="closeDialog"
    >
      <p v-if="feedbackError" class="pc-feedback error" role="alert">{{ feedbackError }}</p>
      <p v-if="status" class="pc-feedback success" role="status">
        <Check :size="16" />{{ status }}
      </p>
      <template v-if="importing">
        <p class="dialog-intro">导入插件 JSON 清单，为工作区添加对象字段和关系类型。</p>
        <input
          ref="input"
          type="file"
          accept=".json,application/json"
          hidden
          @change="importFile"
        />
        <button class="import-file" :disabled="busy" @click="input?.click()">
          <Upload :size="25" /><strong>选择 JSON 文件</strong
          ><span>支持 .json 文件，最大 256 KB</span>
        </button>
        <label class="manifest-label" for="plugin-manifest">或粘贴插件清单</label>
        <textarea
          id="plugin-manifest"
          v-model="manifestText"
          aria-label="插件 JSON 清单"
          :disabled="busy"
          spellcheck="false"
          placeholder="在此粘贴 JSON 内容…"
          rows="6"
        />
        <div class="import-check">
          <span>清单只声明对象与关系，不执行脚本。</span
          ><button
            class="pc-button pc-secondary"
            :disabled="!manifestText.trim() || busy"
            @click="inspect"
          >
            检查清单
          </button>
        </div>
        <div v-if="preview" class="plugin-preview">
          <div>
            <Check :size="17" /><strong>{{ preview.name }}</strong
            ><span>v{{ preview.version }}</span>
          </div>
          <p>{{ preview.description }}</p>
          <p>
            {{ preview.objectTypes.map((item) => item.label).join('、') || '无新增对象类型' }} ·
            {{ preview.relationTypes.length }} 种关系
          </p>
          <button
            class="pc-button pc-primary"
            :disabled="busy"
            @click="change({ install: preview })"
          >
            <Download :size="15" />{{
              installedById.has(preview.id) ? '更新并启用插件' : '安装此插件'
            }}
          </button>
        </div>
      </template>
      <template v-else-if="detail">
        <div class="detail-heading">
          <PluginIcon :id="detail.id" />
          <div>
            <h3>{{ detail.name }}</h3>
            <p>v{{ detail.version }} · {{ detail.id }}</p>
          </div>
          <span
            v-if="selectedInstallation"
            class="plugin-state"
            :class="{ enabled: selectedInstallation.enabled }"
            >{{ selectedInstallation.enabled ? '已启用' : '已停用' }}</span
          >
        </div>
        <p class="detail-description">
          {{ detail.description || '为当前工作区添加自定义对象与关系。' }}
        </p>
        <section class="detail-section">
          <h4>
            扩展对象 <span>{{ detail.objectTypes.length }}</span>
          </h4>
          <div v-for="type in detail.objectTypes" :key="type.type" class="detail-type">
            <strong>{{ type.label }}</strong>
            <p>{{ type.fields?.map((field) => field.label).join('、') || '无额外字段' }}</p>
          </div>
          <p v-if="!detail.objectTypes.length" class="dialog-intro">此插件没有新增对象类型。</p>
        </section>
        <section class="detail-section">
          <h4>
            连接关系 <span>{{ detail.relationTypes.length }}</span>
          </h4>
          <div class="detail-relations">
            <span v-for="relation in detail.relationTypes" :key="relation.type">{{
              relation.label
            }}</span
            ><span v-if="!detail.relationTypes.length">无新增关系类型</span>
          </div>
        </section>
        <p class="detail-scope">
          <ShieldCheck :size="17" /><span
            >安装与启用状态保存在此设备，按工作区生效。<br />当前支持对象与关系扩展，不执行脚本。</span
          >
        </p>
        <footer class="detail-footer">
          <template v-if="selectedInstallation"
            ><button
              class="pc-button pc-text uninstall"
              :disabled="busy"
              @click="change({ uninstall: detail.id })"
            >
              卸载插件</button
            ><button
              class="pc-button pc-secondary"
              :disabled="busy"
              @click="change({ id: detail.id, enabled: !selectedInstallation.enabled })"
            >
              {{ selectedInstallation.enabled ? '停用插件' : '启用插件' }}</button
            ><button
              class="pc-button pc-primary"
              :disabled="busy"
              @click="
                closeDialog();
                emit('objects');
              "
            >
              管理对象 <ArrowUpRight :size="15" /></button></template
          ><button
            v-else
            class="pc-button pc-primary"
            :disabled="busy"
            @click="change({ install: detail })"
          >
            <Download v-if="!busy" :size="15" /><LoaderCircle v-else class="pc-spin" :size="15" />{{
              busy ? '正在安装…' : '安装插件'
            }}
          </button>
        </footer>
      </template>
    </PluginDialog>
  </div>
</template>

<style scoped src="./plugin-center.css"></style>
