<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue';
import { canonicalPluginJson, comparePluginVersions, type PluginCatalogRelease, type PluginReleaseCatalog } from '@tano/protocol';
import { useWorkspaceStore } from '../stores/workspace';
import PluginDialog from './PluginDialog.vue';
import PluginChangeSummary from './PluginChangeSummary.vue';

const store = useWorkspaceStore();
const catalog = ref<PluginReleaseCatalog>();
const query = ref('');
const selectedId = ref('');
const selectedHash = ref('');
const loading = ref(false);
const installing = ref(false);
const error = ref('');
const status = ref('');
const visibleLimit = ref(24);
let controller = new AbortController();
let sequence = 0;
const releases = computed(() => catalog.value?.releases ?? []);
const sorted = (items: PluginCatalogRelease[]) => [...items].sort((a, b) => comparePluginVersions(b.manifest.version, a.manifest.version));
const latest = computed(() => {
  const grouped = new Map<string, PluginCatalogRelease[]>();
  for (const release of releases.value) grouped.set(release.manifest.id, [...(grouped.get(release.manifest.id) ?? []), release]);
  return [...grouped.values()].map(items => sorted(items.filter(item => item.status === 'published'))[0] ?? sorted(items)[0]!)
    .filter(item => `${item.manifest.name} ${item.manifest.id} ${item.manifest.description} ${publisher(item)}`.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase()))
    .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name, 'zh-CN'));
});
const versions = computed(() => sorted(releases.value.filter(item => item.manifest.id === selectedId.value)));
const selected = computed(() => versions.value.find(item => item.integrity === selectedHash.value));
const installed = computed(() => store.installedPlugins.find(item => item.manifest.id === selectedId.value));
function isInstalled(release: PluginCatalogRelease) {
  return store.installedPlugins.some(item => item.manifest.id === release.manifest.id && (item.rule?.integrity === release.integrity ||
    release.manifest.manifestVersion === 1 && canonicalPluginJson(item.manifest) === canonicalPluginJson(release.manifest)));
}
const unchanged = computed(() => !!selected.value && isInstalled(selected.value));
const downgrading = computed(() => selected.value && installed.value && comparePluginVersions(selected.value.manifest.version, installed.value.manifest.version) < 0);
const selectedPublisher = computed(() => catalog.value?.publishers.find(item => item.id === selected.value?.publisher));
const permissions = computed(() => selected.value?.manifest.manifestVersion === 2 ? selected.value.manifest.permissions : []);
const addedPermissions = computed(() => permissions.value.filter(permission => installed.value?.manifest.manifestVersion !== 2 || !installed.value.manifest.permissions.includes(permission)));
const labels: Record<string, string> = { 'documents.read': '读取与打开文档', 'documents.write': '创建与修改文档', 'objects.read': '读取对象', 'objects.write': '创建与修改对象', 'relations.read': '读取关系', 'relations.write': '修改关系', storage: '保存插件本机状态', network: '访问指定网络来源', connections: '使用单独授权的服务凭据', native: '调用指定本机能力', ui: '运行自定义界面' };
function publisher(release: PluginCatalogRelease) { return catalog.value?.publishers.find(item => item.id === release.publisher)?.name ?? release.publisher; }
function details(release: PluginCatalogRelease) { selectedId.value = release.manifest.id; selectedHash.value = release.integrity; error.value = ''; status.value = ''; }
async function refresh() {
  const current = ++sequence;
  const signal = controller.signal;
  loading.value = true; error.value = '';
  try {
    const result = await store.loadPluginCatalog(signal);
    if (signal.aborted || current !== sequence) return;
    catalog.value = result;
  } catch (cause) { if (!signal.aborted && current === sequence) error.value = String(cause); }
  finally { if (current === sequence) loading.value = false; }
}
async function install() {
  if (!selected.value || !store.workspace || installing.value) return;
  const release = selected.value;
  const workspace = store.workspace.id;
  const signal = controller.signal;
  installing.value = true; error.value = ''; status.value = '';
  try {
    await store.installCatalogRelease(release, workspace, signal);
    if (!signal.aborted) status.value = release.manifest.manifestVersion === 2
      ? `已安装 ${release.manifest.version}，请在“已安装”详情中核对并授权此版本运行。` : `已安装 ${release.manifest.version}。`;
  } catch (cause) { if (!signal.aborted) error.value = String(cause); }
  finally { if (!signal.aborted) installing.value = false; }
}
watch(query, () => { visibleLimit.value = 24; });
watch(selectedHash, () => { error.value = ''; status.value = ''; });
watch(() => store.workspace?.id, () => {
  controller.abort(); controller = new AbortController(); sequence++;
  selectedId.value = ''; selectedHash.value = ''; catalog.value = undefined; error.value = ''; status.value = ''; installing.value = false;
  if (store.pluginCatalogSource) void refresh();
}, { immediate: true });
onScopeDispose(() => controller.abort());
</script>

<template>
  <section class="community-catalog" aria-label="社区插件目录">
    <header class="community-heading">
      <div><h2>{{ catalog?.name ?? '社区插件目录' }}</h2><p>安装与更新会锁定工作区版本，代码运行需要此设备另行授权。</p></div>
      <button v-if="store.pluginCatalogSource" class="pc-button pc-secondary" :disabled="loading || installing" @click="refresh">{{ loading ? '正在加载…' : '刷新目录' }}</button>
    </header>
    <p v-if="!store.pluginCatalogSource" class="pc-empty">此产品尚未配置社区目录。可以继续使用内置插件或导入插件包。</p>
    <template v-else>
      <p class="catalog-origin">目录来源：{{ store.pluginCatalogSource }}</p>
      <p v-if="!selected && error" class="pc-feedback error" role="alert">{{ error }}</p>
      <label class="community-search">搜索社区插件<input v-model="query" type="search" placeholder="名称、插件 ID 或发布者" /></label>
      <ul class="community-list">
        <li v-for="release in latest.slice(0, visibleLimit)" :key="release.manifest.id">
          <div><strong>{{ release.manifest.name }}</strong><span> {{ release.manifest.version }} · {{ publisher(release) }}</span><p>{{ release.manifest.description }}</p>
            <span v-if="release.status === 'withdrawn'">已撤回</span>
            <span v-else-if="isInstalled(release)">已安装此版本</span>
          </div>
          <button class="pc-button pc-secondary" :aria-label="`查看社区插件 ${release.manifest.name}`" @click="details(release)">查看版本</button>
        </li>
      </ul>
      <p v-if="catalog && !latest.length">没有找到匹配的社区插件。</p>
      <button v-if="latest.length > visibleLimit" class="pc-button pc-secondary" @click="visibleLimit += 24">显示更多</button>
      <p v-if="catalog" class="catalog-origin">目录更新时间：{{ new Date(catalog.updatedAt).toLocaleString() }}。发布者信息由此目录的维护者管理。</p>
    </template>
    <PluginDialog v-if="selected" title="社区插件版本" :busy="installing" @close="selectedId = ''">
      <h3>{{ selected.manifest.name }}</h3><p>{{ selected.manifest.description }}</p>
      <p v-if="error" class="pc-feedback error" role="alert">{{ error }}</p>
      <p v-if="status" class="pc-feedback success" role="status">{{ status }}</p>
      <p>发布者：<a :href="selectedPublisher?.homepage" target="_blank" rel="noopener noreferrer">{{ selectedPublisher?.name }}</a>（{{ selected.publisher }}）</p>
      <p><a :href="selected.source" target="_blank" rel="noopener noreferrer">查看此版本源码</a> · 许可证：{{ selected.license }}</p>
      <label>选择版本 <select v-model="selectedHash" aria-label="目录插件版本" :disabled="installing"><option v-for="release in versions" :key="release.integrity" :value="release.integrity">{{ release.manifest.version }}{{ release.status === 'withdrawn' ? '（已撤回）' : '' }}</option></select></label>
      <p v-if="installed">工作区当前版本：{{ installed.manifest.version }}</p>
      <p v-if="downgrading">所选版本比工作区当前版本更早。安装后可在历史版本中恢复当前版本。</p>
      <p v-if="installed && !unchanged">将替换此工作区同 ID 的插件版本，并保留共享设置和历史版本。请核对来源和发布者。</p>
      <p v-if="selected.status === 'withdrawn'" role="status">此版本已撤回：{{ selected.reason }}。已安装内容不会自动删除。</p>
      <pre class="catalog-notes">{{ selected.notes || '此版本未提供更新说明。' }}</pre>
      <PluginChangeSummary v-if="!unchanged" :before="installed?.manifest" :after="selected.manifest" :workspace="store.workspace?.name" />
      <p>所需权限：{{ permissions.map(permission => labels[permission]).join('、') || '无代码权限' }}</p>
      <p v-if="installed && addedPermissions.length">新增权限：{{ addedPermissions.map(permission => labels[permission]).join('、') }}</p>
      <template v-if="selected.manifest.manifestVersion === 2">
        <p v-if="selected.manifest.networkOrigins.length">网络来源：{{ selected.manifest.networkOrigins.join('、') }}</p>
        <p v-if="selected.manifest.nativeCommands.length">本机能力：{{ selected.manifest.nativeCommands.join('、') }}</p>
      </template>
      <p class="catalog-origin">{{ (selected.bytes / 1024).toFixed(1) }} KiB · SHA-256 {{ selected.integrity }}</p>
      <p v-if="!store.canManagePlugins">需要工作区管理员安装或更新插件。</p>
      <button class="pc-button pc-primary" :disabled="installing || !store.canManagePlugins || selected.status !== 'published' || unchanged" @click="install">{{ installing ? '正在校验并安装…' : unchanged ? '已安装此版本' : '安装所选版本' }}</button>
    </PluginDialog>
  </section>
</template>

<style scoped>
.community-catalog { padding: 20px 0; }
.community-heading, .community-list li { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.community-heading h2 { margin: 0; font-size: 17px; }
.community-heading { flex-wrap: wrap; }
.community-heading p, .community-list p { color: var(--muted); font-size: 13px; }
.catalog-origin { overflow-wrap: anywhere; color: var(--muted); font-size: 12px; }
.community-search { display: flex; align-items: center; gap: 12px; margin: 20px 0; }
.community-search input { flex: 1; min-width: 100px; padding: 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: inherit; }
.community-list { list-style: none; padding: 0; }
.community-list li { border-bottom: 1px solid var(--line); padding: 16px 0; }
.community-list li > div { min-width: 0; overflow-wrap: anywhere; }
.community-list span { color: var(--muted); font-size: 12px; margin-inline-start: 6px; }
.catalog-notes { white-space: pre-wrap; font: inherit; overflow-wrap: anywhere; }
.pc-button { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; min-height: 32px; padding: 6px 12px; border: 1px solid var(--line); border-radius: 6px; font-size: 12px; font-weight: 500; line-height: 1.5; }
.pc-secondary { background: var(--paper); color: var(--text-secondary); }
.pc-secondary:hover:not(:disabled) { background: var(--surface); border-color: var(--control-border); }
.pc-primary { color: #fff; background: var(--green-fill); border-color: transparent; }
.pc-primary:hover:not(:disabled) { background: var(--green-fill-hover); }
.pc-button:disabled { opacity: .5; cursor: default; }
select { padding: 5px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--text); font: inherit; }
.pc-feedback { padding: 8px 10px; border-radius: 6px; }
.pc-feedback.error { background: var(--danger-bg); color: var(--danger); }
.pc-feedback.success { color: var(--green-fill); }
</style>
