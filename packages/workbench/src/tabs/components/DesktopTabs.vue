<script setup lang="ts">
import '../../styles/desktop-tabs.css';
import { computed, inject, nextTick, ref } from 'vue';
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Bug,
  CalendarDays,
  ExternalLink,
  FilePlus2,
  GitFork,
  PanelBottomClose,
  PanelRightClose,
  Plus,
  Puzzle,
  X,
  XCircle,
} from 'lucide-vue-next';
import { vSurfaceMotion } from '@tano/editor/surface-motion';
import { isHTMLElement } from '@tano/editor/dom-realm';
import { basename } from '@tano/protocol';
import { t } from '../../i18n/i18n';
import { documentTabLabel } from '../tab-label';
import { settlingTab } from '../tab-settle';
import { mobile, nativeOs } from '../../platform/platform';
import { useWorkspaceStore, type DocumentTab } from '../../stores/workspace';
import { appearanceText } from '../../documents/document-appearance';
import { useWindowContext } from '../../windows/context';
import type { DetachedDropPoint } from '../../windows/position';
import { workbenchContextKey } from '../../shell/workbench-context';
import { useDesktopTabLayout } from '../../composables/use-desktop-tab-layout';
import { useDesktopTabDrag } from '../../composables/use-desktop-tab-drag';
import { useDesktopTabMenu } from '../../composables/use-desktop-tab-menu';
import PluginIcon from '../../plugins/components/PluginIcon.vue';
import LoadingSkeleton from '../../shell/components/LoadingSkeleton.vue';
import ButtonVisibilityGroup from '../../shell/components/ButtonVisibilityGroup.vue';
import WorkspaceIcon from '../../workspace/components/WorkspaceIcon.vue';
import ResourceIcon from '../../files/components/ResourceIcon.vue';

const props = defineProps<{
  loading?: boolean;
  detachable?: boolean;
  paneId?: string;
  showNavigation?: boolean;
  fileDrag?: { workspaceId: string; ids: readonly string[] };
  assistantTab?: { id: string; title: string };
}>();

const emit = defineEmits<{
  'new-tab': [];
  'new-document': [];
  'detach-tab': [id: string, drop?: DetachedDropPoint, settled?: () => void];
  'files-dropped': [];
}>();

const store = useWorkspaceStore();
const workbench = inject(workbenchContextKey, null);
const canOpenDevtools = computed(() => !!nativeOs && !mobile && workbench?.developerMode === true);
const windowContext = useWindowContext();

const navigationItems = [
  { id: 'back', get label() { return t('后退'); } },
  { id: 'forward', get label() { return t('前进'); } },
];

const paneTabs = computed(() =>
  props.loading
    ? []
    : props.paneId
      ? store.tabs.filter((tab) =>
          store.panes.find((pane) => pane.id === props.paneId)?.tabs.includes(tab.id),
        )
      : store.tabs,
);
const paneTabIds = computed(() => paneTabs.value.map((tab) => tab.id));
const documentIcons = computed(() =>
  Object.fromEntries(
    paneTabs.value.map((tab) => [
      tab.id,
      tab.dataTable ? tab.dataTable.icon ?? '' : appearanceText(tab.document?.content ?? '', 'icon'),
    ]),
  ),
);
const selectedId = computed(() =>
  props.paneId
    ? store.panes.find((pane) => pane.id === props.paneId)?.activeId ?? ''
    : store.activeId,
);

const title = (path: string) => basename(path).replace(/\.(md|markdown)$/i, '');
const tabLabel = (tab: DocumentTab) =>
  tab.pluginDetail
    ? tab.pluginDetail.name
    : props.assistantTab?.id === tab.id
      ? props.assistantTab.title
      : documentTabLabel(tab);

function activatePane() {
  if (props.paneId) store.focusPane(props.paneId);
}

function closeTab(id: string) {
  store.close(id);
}

const tabList = ref<HTMLElement>();
const blankTrack = ref<HTMLElement | null>(null);

const layout = useDesktopTabLayout({
  windowContext,
  tabList,
  paneTabs,
  paneTabIds,
  selectedId,
  store,
});

const drag = useDesktopTabDrag({
  props,
  store,
  windowContext,
  tabList,
  blankTrack,
  paneTabs,
  tabLabel,
  activatePane,
  tabLayoutAnimating: layout.tabLayoutAnimating,
  cancelTabMoves: layout.cancelTabMoves,
  onDetachTab: (id, drop, settled) => emit('detach-tab', id, drop, settled),
  onFilesDropped: () => emit('files-dropped'),
});

layout.bindDragState({
  collapsedId: drag.collapsedId,
  snapLayout: drag.snapLayout,
  reservedTabWidth: drag.reservedTabWidth,
  slotMotion: drag.slotMotion,
  onIncomingStripChange: drag.onIncomingStripChange,
});

const menu = useDesktopTabMenu({
  paneId: () => props.paneId,
  canOpenDevtools,
  store,
  windowContext,
  tabList,
  blankTrack,
  paneTabs,
  activatePane,
  closeTab,
  onNewTab: () => emit('new-tab'),
  onDetachTab: (id) => emit('detach-tab', id),
});

const {
  frozenTabWidths,
  frozenStripWidth,
  tabLayoutAnimating,
  onTabListPointerEnter,
  onTabListPointerLeave,
  onTabWheel,
} = layout;

const {
  nativeTabDrag,
  draggingId,
  nativeOverlay,
  overlayPending,
  outgoingId,
  sourceWidth,
  collapsedId,
  dragPreview,
  previewStyle,
  previewOpacity,
  settlingPreview,
  referenceReveal,
  dropTarget,
  fileSlot,
  fileHintStyle,
  dockSlotIndex,
  snapLayout,
  reservedTabWidth,
  slotMotion,
  draggedFiles,
  startDrag,
  moveDrag,
  endDrag,
  pointerInterrupted,
  startNativeDrag,
  onClick,
  finishDrag,
  hasActiveGesture,
} = drag;

const { contextMenuElement, contextMenu, openContextMenu, contextAction } = menu;

async function onTabKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && hasActiveGesture()) {
    event.preventDefault();
    finishDrag();
    return;
  }
  if (
    !isHTMLElement(event.target) ||
    !event.target.classList.contains('desktop-tab-switch')
  ) {
    return;
  }
  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
    openContextMenu(event, event.target.closest<HTMLElement>('.desktop-tab')?.dataset.id ?? null);
    return;
  }
  const ids = paneTabs.value.map((tab) => tab.id);
  if (!ids.length) return;
  const current = ids.indexOf(selectedId.value);
  let next = current;
  if (event.key === 'ArrowRight') next = (current + 1) % ids.length;
  else if (event.key === 'ArrowLeft') next = (current - 1 + ids.length) % ids.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = ids.length - 1;
  else return;
  event.preventDefault();
  store.activeId = ids[next];
  await nextTick();
  tabList.value?.querySelector<HTMLElement>('.desktop-tab-active .desktop-tab-switch')?.focus();
}
</script>

<template>
  <ButtonVisibilityGroup
    v-if="showNavigation !== false"
    v-slot="{ isVisible }"
    :items="navigationItems"
    preference-key="tano.preference.documentHiddenTools"
    group-class="topbar-navigation desktop-tab-navigation"
    :label="t('标签页导航')"
    :menu-label="t('导航按钮显示设置')"
    @open="contextMenu = undefined"
  >
    <button
      v-if="isVisible('back')"
      type="button"
      class="icon-button"
      :aria-label="t('后退')"
      :data-tooltip="t('后退')"
      :disabled="!store.canNavigateHistory(-1)"
      @click="store.navigateHistory(-1)"
    >
      <ArrowLeft :size="16" :stroke-width="1.6" />
    </button>
    <button
      v-if="isVisible('forward')"
      type="button"
      class="icon-button"
      :aria-label="t('前进')"
      :data-tooltip="t('前进')"
      :disabled="!store.canNavigateHistory(1)"
      @click="store.navigateHistory(1)"
    >
      <ArrowRight :size="16" :stroke-width="1.6" />
    </button>
  </ButtonVisibilityGroup>
  <nav
    class="desktop-tab-strip"
    :data-tab-pane-id="paneId"
    @click="activatePane"
    :class="{ 'desktop-tab-strip-file-drop': fileSlot, 'desktop-tab-strip-inset': showNavigation === false }"
    :style="{
      '--desktop-tab-count': paneTabs.length - (collapsedId ? 1 : 0),
      '--desktop-tab-source-width': `${sourceWidth}px`,
      '--desktop-tab-reserved-width': `${reservedTabWidth}px`,
      width: frozenStripWidth === undefined ? undefined : `${frozenStripWidth + reservedTabWidth}px`,
    }"
    :aria-label="t('文档标签页')"
    @wheel="onTabWheel"
  >
    <div
      ref="tabList"
      class="desktop-tab-list"
      :class="{
        'desktop-tab-list-dragging': draggingId,
        'desktop-tab-list-snapping': snapLayout,
        'desktop-tab-list-slotting': slotMotion,
        'desktop-tab-list-frozen': frozenStripWidth !== undefined,
        'desktop-tab-list-animating': tabLayoutAnimating,
      }"
      role="tablist"
      :aria-label="t('已打开的文档')"
      @keydown="onTabKeydown"
      @pointermove="moveDrag"
      @pointerenter="onTabListPointerEnter"
      @pointerleave="onTabListPointerLeave"
      @pointerup="endDrag"
      @pointercancel="pointerInterrupted"
      @lostpointercapture="pointerInterrupted"
      @click.capture="onClick"
      @contextmenu.self.prevent="openContextMenu($event, null)"
      @dragstart="!nativeTabDrag && $event.preventDefault()"
    >
      <LoadingSkeleton v-if="loading && !paneTabs.length" class="desktop-tabs-loading" :rows="1" />
      <div
        v-for="(doc, index) in paneTabs"
        :key="doc.id"
        :data-id="doc.id"
        class="desktop-tab"
        :class="{
          'desktop-tab-active': doc.id === selectedId,
          'desktop-tab-dragging': doc.id === draggingId,
          'desktop-tab-settling': doc.id === settlingTab?.id && doc.id !== draggingId,
          'desktop-tab-outgoing': doc.id === outgoingId,
          'desktop-tab-away': doc.id === collapsedId,
          'desktop-tab-drop-before': dockSlotIndex === undefined && dropTarget?.id === doc.id && dropTarget.side === 'before',
          'desktop-tab-drop-after': dockSlotIndex === undefined && dropTarget?.id === doc.id && dropTarget.side === 'after',
          'desktop-tab-dock-before': dockSlotIndex === index,
          'desktop-tab-dock-after': dockSlotIndex === paneTabs.length && index === paneTabs.length - 1,
        }"
        :style="{
          opacity: settlingTab?.id === doc.id ? settlingTab.opacity : referenceReveal?.id === doc.id ? referenceReveal.opacity : undefined,
          flex: frozenTabWidths[doc.id] !== undefined ? `0 0 ${frozenTabWidths[doc.id]}px` : undefined,
          transform: snapLayout ? `translateX(${snapLayout.offsets[doc.id] ?? 0}px)` : undefined,
        }"
        @contextmenu.stop.prevent="openContextMenu($event, doc.id)"
      >
        <button
          class="desktop-tab-switch"
          type="button"
          role="tab"
          :aria-selected="doc.id === selectedId"
          :tabindex="doc.id === selectedId ? 0 : -1"
          :data-tooltip="assistantTab?.id === doc.id ? assistantTab.title : doc.blank || doc.graph || doc.plugins || doc.calendar || doc.view ? tabLabel(doc) : doc.path"
          :draggable="nativeTabDrag"
          @pointerdown="startDrag($event, doc.id)"
          @dragstart.stop="startNativeDrag($event, doc.id)"
          @click="store.activeId = doc.id"
        >
          <Bot v-if="assistantTab?.id === doc.id" class="desktop-tab-icon" :size="15" :stroke-width="1.6" />
          <ResourceIcon v-else-if="doc.directory" :path="doc.path" kind="directory" class="desktop-tab-icon" :size="15" />
          <GitFork v-else-if="doc.graph" class="desktop-tab-icon" :size="15" :stroke-width="1.6" />
          <Puzzle v-else-if="doc.plugins" class="desktop-tab-icon" :size="15" :stroke-width="1.6" />
          <CalendarDays v-else-if="doc.calendar" class="desktop-tab-icon" :size="15" :stroke-width="1.6" />
          <PluginIcon v-else-if="doc.pluginDetail" :id="doc.pluginDetail.id" :size="15" class="desktop-tab-icon" />
          <Puzzle v-else-if="doc.pluginView" class="desktop-tab-icon" :size="15" :stroke-width="1.6" />
          <component :is="doc.view.icon" v-else-if="doc.view" class="desktop-tab-icon" :size="15" :stroke-width="1.6" />
          <span v-else-if="!doc.blank && documentIcons[doc.id]" class="desktop-tab-icon desktop-tab-document-icon" aria-hidden="true">
            <WorkspaceIcon :icon="documentIcons[doc.id]" :size="15" />
          </span>
          <FilePlus2 v-else-if="doc.blank" class="desktop-tab-icon" :size="15" :stroke-width="1.6" />
          <ResourceIcon v-else :path="doc.path" class="desktop-tab-icon" :size="15" />
          <span class="desktop-tab-label">{{ tabLabel(doc) }}</span>
          <span
            v-if="doc.dataTable?.dirty || doc.document && store.dirty(doc.document)"
            class="desktop-tab-dirty"
            :aria-label="t('有未保存的修改')"
          />
        </button>
        <button
          class="desktop-tab-close"
          type="button"
          :aria-label="t('关闭 {0}', [tabLabel(doc)])"
          :data-tooltip="t('关闭 {0}', [tabLabel(doc)])"
          @click="closeTab(doc.id)"
        >
          <X :size="13" />
        </button>
        <span v-if="doc.id === selectedId" class="desktop-tab-corners" aria-hidden="true">
          <span class="desktop-tab-corner-outline-left" />
          <span class="desktop-tab-corner-outline-right" />
        </span>
      </div>
      <div
        v-if="snapLayout?.incoming"
        class="desktop-tab-incoming-slot"
        :class="{ 'desktop-tab-dock-empty': !paneTabs.length }"
        :style="{ width: `${snapLayout.width}px`, transform: `translateX(${snapLayout.left}px)` }"
        aria-hidden="true"
      />
    </div>
    <button
      class="desktop-tab-add"
      type="button"
      :aria-label="t('新标签页')"
      :data-tooltip="t('新标签页')"
      :disabled="!store.workspace || store.busy"
      @click="activatePane(); emit('new-tab')"
    >
      <Plus :size="17" :stroke-width="1.6" />
    </button>
  </nav>
  <Teleport :to="windowContext.overlays">
    <div
      v-if="fileSlot"
      class="desktop-tab-file-drop-hint"
      :style="fileHintStyle"
      role="status"
    >
      <strong>{{ draggedFiles.length === 1 ? title(draggedFiles[0]!.path) : t('{0} 个文档', [draggedFiles.length]) }}</strong>
      <span>{{ t('在此处作为新标签页打开') }}</span>
    </div>
    <div
      v-if="contextMenu"
      v-surface-motion="'DesktopTabs:0'"
      ref="contextMenuElement"
      class="dropdown compact-action-menu desktop-tab-context-menu"
      role="menu"
      :aria-label="contextMenu.tabId ? t('标签页操作') : t('标签栏操作')"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
    >
      <template v-if="contextMenu.tabId">
        <button type="button" role="menuitem" @click="contextAction('close')">
          <X :size="15" />{{ t('关闭标签页') }}
        </button>
        <button
          type="button"
          role="menuitem"
          :disabled="paneTabs.length <= 1"
          @click="contextAction('close-others')"
        >
          <XCircle :size="15" />{{ t('关闭其他标签页') }}
        </button>
        <button
          type="button"
          role="menuitem"
          :disabled="
            paneTabs.findIndex((tab) => tab.id === contextMenu?.tabId) === paneTabs.length - 1
          "
          @click="contextAction('close-right')"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9 3v18m3-12 6 6m0-6-6 6" />
          </svg>{{ t('关闭右侧标签页') }}
        </button>
        <template v-if="paneId">
          <div class="menu-divider" role="separator" />
          <button type="button" role="menuitem" @click="contextAction('split-right')"><PanelRightClose :size="15" />{{ t('向右分屏') }}</button>
          <button type="button" role="menuitem" @click="contextAction('split-bottom')"><PanelBottomClose :size="15" />{{ t('向下分屏') }}</button>
        </template>
        <template v-if="detachable">
          <div class="menu-divider" role="separator" />
          <button type="button" role="menuitem" @click="contextAction('detach')">
            <ExternalLink :size="15" />{{ t('在新窗口中打开') }}
          </button>
        </template>
      </template>
      <template v-else>
        <button type="button" role="menuitem" @click="contextAction('new-tab')">
          <Plus :size="15" />{{ t('新建标签页') }}
        </button>
        <div class="menu-divider" role="separator" />
        <button
          type="button"
          role="menuitem"
          :disabled="!paneTabs.length"
          @click="contextAction('close-all')"
        >
          <XCircle :size="15" />{{ t('关闭全部标签页') }}
        </button>
        <template v-if="canOpenDevtools">
          <div class="menu-divider" role="separator" />
          <button type="button" role="menuitem" @click="contextAction('open-devtools')">
            <Bug :size="15" />{{ t('打开调试窗口') }}
          </button>
        </template>
      </template>
    </div>
  </Teleport>
  <Teleport :to="windowContext.overlays">
    <div
      v-if="dragPreview"
      class="desktop-tab-drag-preview"
      :class="{ 'desktop-tab-drag-preview-settling': settlingPreview, 'desktop-tab-drag-preview-overlaid': (nativeOverlay || overlayPending) && !settlingPreview }"
      :style="{
        ...previewStyle,
        opacity: previewOpacity,
        filter: referenceReveal ? `blur(${referenceReveal.opacity * 4}px)` : undefined,
        left: `${dragPreview.left}px`,
        top: `${dragPreview.top}px`,
        width: `${dragPreview.width}px`,
        height: `${dragPreview.height}px`,
      }"
      aria-hidden="true"
    >
      <FilePlus2 v-if="paneTabs.find(tab => tab.id === dragPreview?.id)?.blank" class="desktop-tab-icon" :size="15" :stroke-width="1.6" />
      <span v-else-if="documentIcons[dragPreview.id]" class="desktop-tab-icon desktop-tab-document-icon">
        <WorkspaceIcon :icon="documentIcons[dragPreview.id]" :size="15" />
      </span>
      <ResourceIcon v-else :path="dragPreview.path" :kind="paneTabs.find(tab => tab.id === dragPreview?.id)?.directory ? 'directory' : 'file'" class="desktop-tab-icon" :size="15" />
      <span class="desktop-tab-label">{{ paneTabs.find(tab => tab.id === dragPreview?.id) ? tabLabel(paneTabs.find(tab => tab.id === dragPreview?.id)!) : title(dragPreview.path) }}</span>
      <span v-if="dragPreview.dirty" class="desktop-tab-dirty" />
    </div>
  </Teleport>
</template>

<style scoped>
.desktop-tabs-loading { width: 160px; flex: 0 0 160px; align-self: center; }
.desktop-tabs-loading :deep(.tano-skeleton-list) { padding: 0 12px; gap: 0; }
.desktop-tabs-loading :deep(.tano-skeleton-bar) { height: 12px; margin: 0; width: 100%; }
</style>
