<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { ArrowDown, ArrowUp, Cloud, Ellipsis, Folder, FolderOpen, LayoutGrid, Search, Settings2 } from 'lucide-vue-next';
import type { RecentWorkspace } from '@tano/protocol';
import { t, uiLocale } from '../i18n';
import WorkspaceIcon from './WorkspaceIcon.vue';
import '../loading-skeleton.css';

const logoUrl = '/favicon-green.svg?v=3';

export type DashboardWorkspace = RecentWorkspace & { source: 'local' | 'cloud' | 'demo' };
type DashboardView = 'recent' | 'owned' | 'shared' | 'favorites';
const props = defineProps<{ workspaces: DashboardWorkspace[]; currentUserId?: string; busy?: boolean; loading?: boolean; loadingSources?: DashboardWorkspace['source'][]; demo?: boolean }>();
const emit = defineEmits<{
  open: [item: DashboardWorkspace];
  settings: [];
}>();
const query = ref('');
const source = ref('all');
const view = ref<DashboardView>('recent');
const descending = ref(true);
const menuId = useId();
const menu = ref<HTMLElement>();
const menuItem = ref<DashboardWorkspace | null>(null);
const hoveredWorkspace = ref<string | null>(null);
const menuPosition = ref({ x: 0, y: 0 });
let menuTrigger: HTMLElement | null = null;
const isMenuOpen = (item: DashboardWorkspace) => menuItem.value?.id === item.id && menuItem.value?.source === item.source;
function closeMenu(restoreFocus = false) {
  menuItem.value = null;
  if (restoreFocus) menuTrigger?.focus({ preventScroll: true });
}
async function showMenu(item: DashboardWorkspace, event: MouseEvent | KeyboardEvent, context = false) {
  if (props.busy) return;
  if (!context && isMenuOpen(item)) { closeMenu(true); return; }
  const target = event.currentTarget as HTMLElement;
  menuTrigger = context
    ? [...(target.closest('.workspace-dashboard')?.querySelectorAll<HTMLButtonElement>('.dashboard-more') ?? [])]
      .find(button => button.dataset.workspaceKey === `${item.source}:${item.id}`) ?? null
    : target;
  const anchor = menuTrigger?.getBoundingClientRect();
  menuItem.value = item;
  await nextTick();
  if (!menu.value || !isMenuOpen(item)) return;
  const { offsetWidth: width, offsetHeight: height } = menu.value;
  const x = context && event instanceof MouseEvent ? event.clientX : (anchor?.right ?? 8) - width;
  const y = context && event instanceof MouseEvent ? event.clientY : (anchor?.bottom ?? 8) + 4;
  menuPosition.value = {
    x: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
    y: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
  };
  menu.value.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
}
function menuKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' || event.key === 'Tab') {
    event.preventDefault(); closeMenu(true);
  } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault(); menu.value?.querySelector<HTMLButtonElement>('button')?.focus();
  }
}
function outsideMenu(event: Event) {
  if (event.target instanceof Node && (menu.value?.contains(event.target) || menuTrigger?.contains(event.target))) return;
  closeMenu();
}
function dismissMenu() { closeMenu(); }
function openFromMenu() {
  const item = menuItem.value;
  closeMenu();
  if (item && !props.busy) emit('open', item);
}
onMounted(() => {
  window.addEventListener('pointerdown', outsideMenu, true);
  window.addEventListener('focusin', outsideMenu);
  window.addEventListener('scroll', dismissMenu, true);
  window.addEventListener('resize', dismissMenu);
});
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', outsideMenu, true);
  window.removeEventListener('focusin', outsideMenu);
  window.removeEventListener('scroll', dismissMenu, true);
  window.removeEventListener('resize', dismissMenu);
});
const pendingSources = computed(() => props.loadingSources ?? (props.loading ? ['local', 'cloud'] : []));
const pendingRows = computed(() => pendingSources.value.filter(item => source.value === 'all' || source.value === item));
const filters = computed(() => [
  { id: 'all', label: t('全部工作区'), icon: LayoutGrid },
  ...(!props.demo ? [
    { id: 'cloud', label: t('在线工作区'), icon: Cloud },
    { id: 'local', label: t('本地工作区'), icon: Folder },
  ].filter(item => props.workspaces.some(space => space.source === item.id) || pendingSources.value.includes(item.id)) : []),
]);
const tabs = computed(() => [
  { id: 'recent' as const, label: t('最近访问') },
  { id: 'owned' as const, label: t('归我所有') },
  { id: 'shared' as const, label: t('与我共享') },
  { id: 'favorites' as const, label: t('收藏') },
]);
function ownerId(item: DashboardWorkspace) {
  return item.ownerUserId ?? item.ownerProfile?.userId;
}
function isOwned(item: DashboardWorkspace) {
  if (item.source === 'local' || item.source === 'demo') return true;
  const current = props.currentUserId?.trim().toLocaleLowerCase();
  const owner = ownerId(item)?.trim().toLocaleLowerCase();
  return !!current && !!owner && current === owner;
}
function isShared(item: DashboardWorkspace) {
  if (item.shared !== undefined) return item.shared;
  if (item.source !== 'cloud') return false;
  const current = props.currentUserId?.trim().toLocaleLowerCase();
  const owner = ownerId(item)?.trim().toLocaleLowerCase();
  return !!current && !!owner && current !== owner;
}
function matchesView(item: DashboardWorkspace) {
  if (view.value === 'recent') return item.openedAt > 0;
  if (view.value === 'owned') return isOwned(item);
  if (view.value === 'shared') return isShared(item);
  return item.favorite === true;
}
const scoped = computed(() => props.workspaces.filter(item => source.value === 'all' || source.value === item.source));
const visible = computed(() => {
  const search = query.value.trim().toLocaleLowerCase();
  return props.workspaces.filter(item =>
    (source.value === 'all' || source.value === item.source) &&
    matchesView(item) &&
    (!search || `${item.name}\n${item.source === 'local' ? item.path : ''}`.toLocaleLowerCase().includes(search)),
  ).sort((a, b) => (descending.value ? b.openedAt - a.openedAt : a.openedAt - b.openedAt) || a.name.localeCompare(b.name, uiLocale.value));
});
const title = computed(() => filters.value.find(item => item.id === source.value)?.label ?? t('全部工作区'));
const emptyTitle = computed(() => query.value.trim()
  ? t('没有找到匹配的工作区')
  : view.value === 'favorites'
    ? t('还没有收藏的工作区')
    : view.value === 'shared'
      ? t('还没有与我共享的工作区')
      : view.value === 'owned'
        ? t('还没有归我所有的工作区')
        : t('还没有最近访问的工作区'));
const emptyDescription = computed(() => query.value.trim()
  ? t('试试其他名称或路径。')
  : view.value === 'favorites'
    ? t('收藏的工作区会显示在这里。')
    : view.value === 'shared'
      ? t('别人共享给你的工作区会显示在这里。')
      : view.value === 'owned'
        ? t('你创建或拥有的工作区会显示在这里。')
        : t('打开一个工作区后，它会显示在这里。'));
watch([visible, () => props.busy], () => { dismissMenu(); hoveredWorkspace.value = null; });
function sourceLabel(item: DashboardWorkspace) {
  return item.source === 'cloud' ? t('在线工作区') : item.source === 'demo' ? t('浏览器演示') : t('本地工作区');
}
function formatTime(value: number | null | undefined, fallback = '—') {
  if (value == null) return fallback;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || value <= 0) return fallback;
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  const today = sameYear && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  const time = `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
  if (today) return `${t('今天')} ${time}`;
  if (uiLocale.value === 'zh-CN') {
    return `${sameYear ? '' : `${date.getFullYear()}年`}${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
  }
  const day = new Intl.DateTimeFormat(uiLocale.value, {
    month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' as const }),
  }).format(date);
  return `${day} ${time}`;
}
function ownerLabel(item: DashboardWorkspace) {
  return item.ownerProfile?.name || item.owner || (item.source === 'cloud' ? '—' : t('本机用户'));
}
</script>

<template>
  <main class="workspace-dashboard" :aria-label="t('工作区仪表盘')">
    <aside class="dashboard-sidebar">
      <div class="dashboard-brand"><img :src="logoUrl" alt="" /><span>{{ uiLocale === 'en-US' ? 'Tano' : '同页' }}</span></div>
      <nav :aria-label="t('工作区分类')">
        <button v-for="filter in filters" :key="filter.id" type="button" :aria-current="source === filter.id ? 'page' : undefined" @click="source = filter.id">
          <component :is="filter.icon" :size="17" aria-hidden="true" /><span>{{ filter.label }}</span>
          <small v-if="filter.id === 'all' ? pendingSources.length : pendingSources.includes(filter.id)" class="tano-skeleton-bar dashboard-count-skeleton" :aria-label="t('正在加载…')" />
          <small v-else>{{ filter.id === 'all' ? workspaces.length : workspaces.filter(item => item.source === filter.id).length }}</small>
        </button>
      </nav>
      <div class="dashboard-sidebar-bottom">
        <slot name="account" />
        <button type="button" @click="emit('settings')"><Settings2 :size="17" aria-hidden="true" />{{ t('设置') }}</button>
      </div>
    </aside>
    <section class="dashboard-main">
      <header class="dashboard-heading"><div><h1>{{ title }}</h1><p>{{ t('从这里开始，回到你的文档与协作。') }}</p></div></header>
      <div v-if="demo" class="dashboard-demo-note">{{ t('浏览器演示 · 内容仅保存在当前浏览器，不会同步到服务器。') }}</div>
      <div class="dashboard-toolbar">
        <label class="dashboard-search"><Search :size="17" aria-hidden="true" /><input v-model="query" type="search" :placeholder="t('搜索工作区…')" :aria-label="t('搜索工作区')" /></label>
        <div class="dashboard-actions"><slot name="actions" /></div>
      </div>
      <nav class="dashboard-tabs" :aria-label="t('工作区视图')">
        <button v-for="tab in tabs" :key="tab.id" type="button" :aria-current="view === tab.id ? 'page' : undefined" @click="view = tab.id">{{ tab.label }}</button>
      </nav>
      <slot name="status" />
      <div class="dashboard-table-wrap" :aria-busy="!!pendingRows.length">
        <div class="dashboard-table-scroll" tabindex="0" :aria-label="t('工作区列表')">
        <table class="dashboard-table">
          <thead><tr><th scope="col">{{ t('工作区名称') }}</th><th scope="col" class="dashboard-source">{{ t('存储位置') }}</th><th scope="col">{{ t('所有者') }}</th><th scope="col">{{ t('创建时间') }}</th><th scope="col" :aria-sort="descending ? 'descending' : 'ascending'"><button type="button" @click="descending = !descending">{{ t('最近打开') }}<component :is="descending ? ArrowDown : ArrowUp" :size="14" aria-hidden="true" /></button></th></tr></thead>
          <tbody>
            <tr v-for="item in visible" :key="`${item.source}:${item.id}`" :class="{ 'dashboard-row-hover': hoveredWorkspace === `${item.source}:${item.id}` }" @mouseenter="hoveredWorkspace = `${item.source}:${item.id}`" @mouseleave="hoveredWorkspace = null" @contextmenu.prevent="showMenu(item, $event, true)">
              <td><button type="button" class="dashboard-workspace" :disabled="busy" @click="emit('open', item)">
                <span class="dashboard-workspace-icon"><WorkspaceIcon :icon="item.icon" :mode="item.source === 'cloud' ? 'web' : item.source" :size="19" /></span>
                <span class="dashboard-workspace-name"><strong>{{ item.name }}</strong><small>{{ item.source === 'local' ? item.path : sourceLabel(item) }}</small></span>
              </button></td>
              <td class="dashboard-source"><span class="dashboard-source-label">{{ sourceLabel(item) }}</span></td>
              <td class="dashboard-owner" :title="ownerLabel(item)"><slot name="owner" :item="item"><span>{{ ownerLabel(item) }}</span></slot></td>
              <td class="dashboard-date dashboard-created">{{ formatTime(item.createdAt) }}</td>
              <td class="dashboard-date dashboard-opened">{{ formatTime(item.openedAt, t('尚未打开')) }}</td>
            </tr>
            <template v-for="pendingSource in pendingRows" :key="pendingSource">
              <tr v-for="row in 2" :key="`${pendingSource}:${row}`" class="dashboard-skeleton-row" :aria-label="t('正在读取工作区…')">
                <td><div class="dashboard-workspace"><span class="tano-skeleton-bar dashboard-skeleton-icon" /><span class="dashboard-workspace-name"><span class="tano-skeleton-bar" /><span class="tano-skeleton-bar dashboard-skeleton-path" /></span></div></td>
                <td class="dashboard-source"><span class="dashboard-source-label">{{ pendingSource === 'cloud' ? t('在线工作区') : t('本地工作区') }}</span></td>
                <td><span class="tano-skeleton-bar" /></td><td><span class="tano-skeleton-bar" /></td>
                <td><span class="tano-skeleton-bar" /></td>
              </tr>
            </template>
          </tbody>
        </table>
        </div>
        <div class="dashboard-operations" role="group" :aria-label="t('操作')">
          <div class="dashboard-operations-heading" aria-hidden="true"></div>
          <div v-for="item in visible" :key="`${item.source}:${item.id}`" class="dashboard-operation-row" :class="{ 'dashboard-row-hover': hoveredWorkspace === `${item.source}:${item.id}` }" @mouseenter="hoveredWorkspace = `${item.source}:${item.id}`" @mouseleave="hoveredWorkspace = null">
            <button type="button" class="dashboard-more" :data-workspace-key="`${item.source}:${item.id}`" :disabled="busy" :title="t('更多')" :aria-label="t('{0} 工作区操作', [item.name])" aria-haspopup="menu" :aria-expanded="isMenuOpen(item)" :aria-controls="isMenuOpen(item) ? menuId : undefined" @click.stop="showMenu(item, $event)" @keydown.down.prevent="showMenu(item, $event)"><Ellipsis :size="18" aria-hidden="true" /></button>
          </div>
          <template v-for="pendingSource in pendingRows" :key="pendingSource">
            <div v-for="row in 2" :key="`${pendingSource}:${row}`" class="dashboard-operation-row" aria-hidden="true"><span class="tano-skeleton-bar" /></div>
          </template>
        </div>
        <div v-if="!visible.length && !pendingRows.length" class="dashboard-empty" role="status"><Folder :size="30" aria-hidden="true" /><h2>{{ emptyTitle }}</h2><p>{{ emptyDescription }}</p></div>
      </div>
      <p v-if="!pendingSources.length" class="dashboard-count" role="status">{{ t('显示 {0} 个，共 {1} 个工作区', [visible.length, scoped.length]) }}</p>
      <slot name="footer" />
    </section>
    <Teleport to="body">
      <div v-if="menuItem" :id="menuId" ref="menu" class="dropdown compact-action-menu dashboard-workspace-menu" role="menu" :aria-label="t('{0} 工作区操作', [menuItem.name])" :style="{ left: `${menuPosition.x}px`, top: `${menuPosition.y}px` }" @keydown.stop="menuKeydown" @contextmenu.prevent.stop>
        <button type="button" role="menuitem" :disabled="busy" @click="openFromMenu"><FolderOpen :size="15" aria-hidden="true" />{{ t('打开工作区') }}</button>
      </div>
    </Teleport>
  </main>
</template>

<style scoped>
.workspace-dashboard { flex: 1; min-height: 0; display: flex; overflow: auto; background: var(--paper); text-align: left; }
.dashboard-sidebar { flex: 0 0 212px; display: flex; flex-direction: column; padding: 30px 14px 20px; border-right: 1px solid var(--line); }
.dashboard-brand { display: flex; gap: 10px; align-items: center; padding: 0 14px 36px; color: var(--green); font-size: 23px; font-weight: 650; }
.dashboard-brand img { width: 38px; height: 38px; }
.dashboard-sidebar nav { display: grid; gap: 6px; }
.dashboard-sidebar button { display: flex; align-items: center; gap: 10px; width: 100%; padding: 11px 13px; border-radius: 7px; color: var(--text-secondary); text-align: left; }
.dashboard-sidebar button:hover { background: var(--hover); }
.dashboard-sidebar button[aria-current] { color: var(--green); background: var(--accent); font-weight: 600; }
.dashboard-sidebar button span { flex: 1; }
.dashboard-sidebar button small { font-size: 12px; font-variant-numeric: tabular-nums; }
.dashboard-sidebar-bottom { margin-top: auto; padding-top: 40px; }
.dashboard-count-skeleton { width: 14px; }
.dashboard-skeleton-icon { width: 36px; height: 36px; flex-shrink: 0; }
.dashboard-skeleton-path { width: 70%; margin-top: 12px; }
.dashboard-main { flex: 1; min-width: 0; padding: 38px 32px; background: var(--surface); }
.dashboard-heading { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 26px; }
.dashboard-heading h1 { margin: 0; font-size: 25px; line-height: 1.4; font-weight: 600; }
.dashboard-heading p { margin: 8px 0 0; color: var(--muted); font-size: 13px; }
.dashboard-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 18px; }
.dashboard-tabs { display: flex; align-items: center; gap: 8px; margin: 2px 0 18px; border-bottom: 1px solid var(--line); }
.dashboard-tabs button { position: relative; padding: 8px 10px 11px; color: var(--text-secondary); font-size: 13px; white-space: nowrap; }
.dashboard-tabs button:hover { color: var(--text); }
.dashboard-tabs button[aria-current='page'] { color: var(--green); font-weight: 600; }
.dashboard-tabs button[aria-current='page']::after { content: ''; position: absolute; right: 10px; bottom: -1px; left: 10px; height: 2px; border-radius: 2px; background: var(--green); }
.dashboard-search { display: flex; align-items: center; gap: 9px; width: min(480px, 100%); min-width: 140px; padding: 0 12px; border: 1px solid var(--control-border); background: var(--paper); border-radius: 6px; color: var(--muted); }
.dashboard-search:focus-within { outline: 2px solid var(--green); outline-offset: 2px; }
.dashboard-search input { width: 100%; min-width: 0; height: 38px; border: 0; outline: none; background: transparent; color: var(--text); font: inherit; }
.dashboard-actions { display: flex; flex-shrink: 0; flex-wrap: wrap; gap: 8px; }
.dashboard-table-wrap { display: grid; grid-template-columns: minmax(0, 1fr) 64px; overflow: hidden; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); }
.dashboard-table-scroll { min-width: 0; overflow-x: auto; }
.dashboard-table-scroll:focus-visible { outline: 2px solid var(--green); outline-offset: -2px; }
.dashboard-table { width: 100%; min-width: 736px; border-collapse: separate; border-spacing: 0; table-layout: fixed; }
.dashboard-table th { text-align: left; height: 45px; padding: 0 18px; font-size: 12px; font-weight: 500; color: var(--muted); border-bottom: 1px solid var(--line); }
.dashboard-table th:first-child { width: 26%; }
.dashboard-table th:nth-child(2) { width: 13%; }
.dashboard-table th:nth-child(3) { width: 15%; }
.dashboard-table th:nth-child(4), .dashboard-table th:nth-child(5) { width: 23%; }
.dashboard-table th button { display: flex; align-items: center; gap: 6px; padding: 5px 0; white-space: nowrap; }
.dashboard-table td { padding: 6px 18px; border-bottom: 1px solid var(--line); }
.dashboard-table tbody tr { height: 73px; }
.dashboard-table tr:last-child td { border-bottom: 0; }
.dashboard-row-hover { background: var(--sidebar); }
.dashboard-operations { min-width: 0; background: var(--paper); }
.dashboard-operations-heading { box-sizing: border-box; height: 45px; border-bottom: 1px solid var(--line); }
.dashboard-operation-row { box-sizing: border-box; height: 73px; display: flex; align-items: center; justify-content: center; padding: 0 10px; border-bottom: 1px solid var(--line); }
.dashboard-operation-row:last-child { border-bottom: 0; }
.dashboard-more { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; padding: 0; border-radius: 5px; color: var(--muted); }
.dashboard-more:hover, .dashboard-more[aria-expanded='true'] { color: var(--text); background: var(--hover); }
.dashboard-workspace-menu { position: fixed; z-index: 200; min-width: 160px; }
.dashboard-workspace { display: flex; align-items: center; gap: 12px; width: 100%; min-width: 0; min-height: 60px; padding: 4px 0; text-align: left; }
.dashboard-workspace-icon { flex-shrink: 0; width: 36px; height: 36px; display: grid; place-items: center; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); color: var(--green); }
.dashboard-workspace-name { flex: 1; min-width: 0; }
.dashboard-workspace-name strong, .dashboard-workspace-name small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dashboard-workspace-name strong { font-size: 14px; font-weight: 500; color: var(--text); }
.dashboard-workspace-name small { margin-top: 5px; font-size: 11px; color: var(--muted); }
.dashboard-owner { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--text-secondary); }
.dashboard-source-label { font-size: 12px; color: var(--text-secondary); white-space: nowrap; }
.dashboard-date { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.dashboard-empty { grid-column: 1 / -1; padding: 56px 20px; text-align: center; color: var(--muted); }
.dashboard-empty h2 { margin: 14px 0 8px; color: var(--text); font-size: 16px; font-weight: 500; }
.dashboard-empty p, .dashboard-count { font-size: 12px; color: var(--muted); line-height: 1.7; }
.dashboard-count { margin: 20px 0; text-align: center; }
.dashboard-demo-note { margin-bottom: 18px; color: var(--muted); font-size: 12px; }
button:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
@media (max-width: 760px) {
  .workspace-dashboard { flex-direction: column; }
  .dashboard-sidebar { flex: 0 0 auto; padding: 16px; border-right: 0; border-bottom: 1px solid var(--line); }
  .dashboard-brand { padding: 0 0 16px; font-size: 19px; }
  .dashboard-brand img { width: 30px; height: 30px; }
  .dashboard-sidebar nav { display: flex; flex-wrap: wrap; }
  .dashboard-sidebar nav button { width: auto; padding: 9px 10px; }
  .dashboard-sidebar-bottom { margin: 0; padding: 10px 0 0; display: flex; align-items: center; gap: 12px; }
  .dashboard-sidebar-bottom > button { width: auto; padding: 6px 10px; }
  .dashboard-main { padding: 24px 16px; }
  .dashboard-heading { align-items: flex-start; margin-bottom: 20px; }
  .dashboard-heading h1 { font-size: 22px; }
  .dashboard-toolbar { flex-wrap: wrap; gap: 12px; }
  .dashboard-search { width: 100%; }
  .dashboard-tabs { overflow-x: auto; margin-right: -4px; padding-bottom: 1px; }
  .dashboard-source { display: none; }
  .dashboard-table { min-width: 616px; }
  .dashboard-table th:first-child { width: 29%; }
  .dashboard-table th:nth-child(3) { width: 21%; }
  .dashboard-table th:nth-child(4), .dashboard-table th:nth-child(5) { width: 25%; }
  .dashboard-table th, .dashboard-table td { padding-left: 12px; padding-right: 12px; }
  .dashboard-workspace { gap: 9px; }
}
</style>
