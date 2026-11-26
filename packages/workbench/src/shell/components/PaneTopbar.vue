<script setup lang="ts">
import { inject, toRefs } from 'vue';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  List,
  LockKeyhole,
  MessageSquareDiff,
  PanelLeftOpen,
  Puzzle,
  X,
} from 'lucide-vue-next';
import type { WorkspacePane } from '@tano/protocol';
import { isTableTab } from '../../data-tables/data-tables';
import { GRAPH_TAB_ID } from '../../documents/document-graph';
import { t } from '../../i18n/i18n';
import { CALENDAR_TAB_ID } from '../../plans/calendar';
import { mobile } from '../../platform/platform';
import { pluginPreviewStatus, pluginViewHeader } from '../../plugins/view-header';
import { PLUGINS_TAB_ID } from '../../plugins/workspace-plugins';
import type { DocumentTab, OpenDocument } from '../../stores/workspace-types';
import { native } from '../../workspace/adapter';
import { shortcutAriaLabel, shortcutKeys } from '../shortcuts';
import {
  workbenchDocumentsKey,
  workbenchPrefsKey,
  workbenchShellKey,
  workbenchTreeMenusKey,
} from '../workbench-context';
import ButtonVisibilityGroup from './ButtonVisibilityGroup.vue';
import WorkspaceBreadcrumb from './WorkspaceBreadcrumb.vue';
import DocumentStatus from '../../documents/components/DocumentStatus.vue';
import DocumentActionMenu from '../../documents/components/DocumentActionMenu.vue';
import MarkdownRevealToggle from '../../documents/components/MarkdownRevealToggle.vue';
import SourceCodeIcon from '../../documents/components/SourceCodeIcon.vue';
import PluginViewHeader from '../../plugins/components/PluginViewHeader.vue';
import CalendarTopbarControls from '../../plans/components/CalendarTopbarControls.vue';

defineProps<{
  pane: WorkspacePane;
  active?: OpenDocument;
  tab?: DocumentTab;
  isAuxiliaryWindow: boolean;
}>();

const shell = inject(workbenchShellKey);
const prefs = inject(workbenchPrefsKey);
const documents = inject(workbenchDocumentsKey);
const treeMenus = inject(workbenchTreeMenusKey);
if (!shell || !prefs || !documents || !treeMenus) throw new Error('Workbench context is required');

const {
  workspace,
  filesPending,
  sidebar,
  toggleSidebar,
  store,
  extensions,
  extensionActions,
  extensionViews,
  settingsTabView,
  mailEnabled,
  mailTabView,
  workspaceStatusLabel,
  openEntry,
  openBreadcrumbDirectory,
  topbarVisibilityItems,
  closeButtonVisibilityMenus,
  canNavigatePage,
  navigatePage,
  paneButterflyScope,
  touchLayout,
  attachments,
  calendarToolItems,
  calendarPeriod,
  calendarDate,
  moveCalendarPeriod,
  calendarModeOpen,
  calendarModeLabel,
  calendarModeOptions,
  calendarMode,
  selectCalendarMode,
  openPlanArchive,
  documentToolItems,
} = toRefs(shell);
const { tabsEnabled, shortcuts, revealMarkdown } = toRefs(prefs);
const {
  paneDocumentStatus,
  attachmentStatus,
  currentAttachmentStatus,
  showOutline,
  touchOutlineOpen,
  documentSuggestions,
  editing,
  suggestionModeBusy,
  toggleSuggestionMode,
  paneSource,
  setPaneSource,
} = toRefs(documents);
const { treeDocumentIcons, loadTreeDocumentIcon } = toRefs(treeMenus);
</script>

<template>
  <ButtonVisibilityGroup
    v-slot="{ isVisible }"
    :items="topbarVisibilityItems(pane.activeId, !!active, pane.id === store.activePaneId)"
    preference-key="tano.preference.documentHiddenTools"
    tag="header"
    :group-class="pane.activeId === GRAPH_TAB_ID ? 'topbar graph-topbar' : 'topbar'"
    :label="pane.activeId === GRAPH_TAB_ID ? t('图谱顶部栏') : t('文档顶部栏')"
    :menu-label="t('顶部栏显示设置')"
    @open="closeButtonVisibilityMenus"
  >
    <div
      v-if="
        (native && !tabsEnabled && (isVisible('back') || isVisible('forward'))) ||
        (!sidebar && !(native && !mobile && workspace))
      "
      class="topbar-navigation"
      :data-surface-role="pane.activeId === GRAPH_TAB_ID ? 'card' : undefined"
      role="group"
      :aria-label="pane.activeId === GRAPH_TAB_ID ? t('图谱导航') : t('文档导航')"
    >
      <button
        v-if="!sidebar && !(native && !mobile && workspace)"
        type="button"
        class="icon-button"
        :aria-label="t('展开侧栏')"
        :data-tooltip="t('展开侧栏')"
        :data-tooltip-shortcut="shortcuts.toggleSidebar"
        @click="toggleSidebar"
      >
        <PanelLeftOpen :size="16" :stroke-width="1.6" />
      </button>
      <button
        v-if="native && !tabsEnabled && isVisible('back')"
        type="button"
        class="icon-button"
        :aria-label="t('后退')"
        :data-tooltip="t('后退')"
        :disabled="!canNavigatePage(-1)"
        @click="navigatePage(-1)"
      >
        <ArrowLeft :size="16" :stroke-width="1.6" />
      </button>
      <button
        v-if="native && !tabsEnabled && isVisible('forward')"
        type="button"
        class="icon-button"
        :aria-label="t('前进')"
        :data-tooltip="t('前进')"
        :disabled="!canNavigatePage(1)"
        @click="navigatePage(1)"
      >
        <ArrowRight :size="16" :stroke-width="1.6" />
      </button>
    </div>
    <WorkspaceBreadcrumb
      :loading="filesPending"
      :perch="{
        id: `breadcrumb:${paneButterflyScope(pane.id, pane.activeId)}`,
        scope: paneButterflyScope(pane.id, pane.activeId),
        label: t('面包屑'),
        kind: 'component',
      }"
      v-if="
        isVisible('breadcrumb') &&
        pane.activeId !== CALENDAR_TAB_ID &&
        pane.activeId !== GRAPH_TAB_ID
      "
      :workspace-id="workspace?.id"
      :workspace-name="workspace?.name ?? 'Tano'"
      :workspace-icon="store.workspaceSettings.icon"
      :workspace-mode="store.isDemo ? 'demo' : store.isWeb ? 'web' : 'local'"
      :entries="workspace?.files ?? []"
      :folder-home-file-name="store.workspaceSettings.folderHomeFileName"
      :document-icons="treeDocumentIcons"
      :load-document-icon="loadTreeDocumentIcon"
      :path="tab?.path"
      :directory="!!tab?.directory"
      :demo-label="store.isDemo ? workspaceStatusLabel : undefined"
      :read-only="workspace?.readOnly"
      @open="(file) => { store.focusPane(pane.id); openEntry(file); }"
      @open-directory="(path) => { store.focusPane(pane.id); void openBreadcrumbDirectory(path); }"
    >
      <template #status>
        <DocumentStatus
          v-if="tab?.pluginView && isVisible('document-status')"
          :document-key="`${workspace?.id}:${tab.pluginView.pluginId}:${tab.pluginView.id}:${pluginViewHeader(store.pluginRuntime, tab.pluginView)?.title}`"
          :items="pluginPreviewStatus(store.pluginRuntime, tab.pluginView)"
        />
        <DocumentStatus
          v-if="active && isVisible('document-status')"
          :document-key="`${workspace?.id}:${active.id}`"
          :items="paneDocumentStatus(active)"
        >
          <component
            :is="extensions.regions['document-status-details']"
            v-if="pane.id === store.activePaneId && extensions.regions['document-status-details']"
            :actions="extensionActions"
          />
        </DocumentStatus>
        <DocumentStatus
          v-else-if="tab?.attachment && isVisible('document-status')"
          :document-key="`${workspace?.id}:${tab.attachment.id}`"
          :items="attachmentStatus(pane.id, tab.attachment)"
        >
          <button
            v-if="currentAttachmentStatus(pane.id, tab.attachment)?.retry"
            :disabled="currentAttachmentStatus(pane.id, tab.attachment)?.retryDisabled"
            @click="currentAttachmentStatus(pane.id, tab.attachment)?.retry?.()"
          >
            {{ t('重试') }}
          </button>
        </DocumentStatus>
      </template>
      <template v-if="tab?.pluginDetail">
        <ChevronRight :size="12" /><Puzzle :size="14" /><span class="breadcrumb-current">{{ tab.pluginDetail.name }}</span>
      </template>
      <template v-if="tab?.pluginView">
        <ChevronRight :size="12" /><Puzzle :size="14" /><span
          class="breadcrumb-current"
          :title="pluginViewHeader(store.pluginRuntime, tab.pluginView)?.title"
          >{{ pluginViewHeader(store.pluginRuntime, tab.pluginView)?.title || tab.pluginView.label }}</span
        >
      </template>
      <template v-if="pane.activeId === PLUGINS_TAB_ID">
        <ChevronRight :size="12" /><Puzzle :size="14" /><span class="breadcrumb-current">{{ t('插件') }}</span>
      </template>
      <template
        v-for="view in [...extensionViews, settingsTabView, ...(mailEnabled ? [mailTabView] : [])].filter(
          (view) => view.id === pane.activeId,
        )"
        :key="view.id"
      >
        <component :is="view.icon" :size="14" /><span class="breadcrumb-current">{{ view.label }}</span>
      </template>
    </WorkspaceBreadcrumb>
    <DocumentStatus
      v-if="(active || tab?.attachment) && !isVisible('breadcrumb') && isVisible('document-status')"
      :document-key="`${workspace?.id}:${active?.id ?? tab?.attachment?.id}`"
      :items="active ? paneDocumentStatus(active) : attachmentStatus(pane.id, tab?.attachment)"
    >
      <component
        v-if="active && pane.id === store.activePaneId && extensions.regions['document-status-details']"
        :is="extensions.regions['document-status-details']"
        :actions="extensionActions"
      />
      <button
        v-if="!active && currentAttachmentStatus(pane.id, tab?.attachment)?.retry"
        :disabled="currentAttachmentStatus(pane.id, tab?.attachment)?.retryDisabled"
        @click="currentAttachmentStatus(pane.id, tab?.attachment)?.retry?.()"
      >
        {{ t('重试') }}
      </button>
    </DocumentStatus>
    <div class="topbar-right" :data-surface-role="pane.activeId === GRAPH_TAB_ID ? 'card' : undefined">
      <PluginViewHeader
        v-if="tab?.pluginView && workspace"
        :view="tab.pluginView"
        :workspace-id="workspace.id"
        :runtime="store.pluginRuntime.find((item) => item.id === tab?.pluginView?.pluginId)"
        :execute="store.interactWithPlugin"
      />
      <button
        v-if="active && touchLayout && showOutline"
        type="button"
        class="icon-button"
        :aria-label="t('文档大纲')"
        :aria-expanded="touchOutlineOpen"
        @click="touchOutlineOpen = !touchOutlineOpen"
      >
        <List :size="18" />
      </button>
      <button
        v-if="tab?.attachment && attachments && isVisible('attachment-export')"
        type="button"
        class="topbar-attachment-action"
        :aria-label="t('导出附件')"
        :data-tooltip="t('导出附件副本')"
        @click="attachments.exportAttachment(workspace!.id, tab!.attachment.path).catch(store.report)"
      >
        <ArrowDownToLine :size="16" /><span>{{ t('导出') }}</span>
      </button>
      <div :id="`attachment-controls-${pane.id}`" class="attachment-controls-host" v-show="!!tab?.attachment" />
      <component
        :is="extensions.regions['editing-status']"
        v-if="
          isVisible('editing-status') &&
          pane.id === store.activePaneId &&
          extensions.regions['editing-status']
        "
        :actions="extensionActions"
      />
      <span
        v-if="
          workspaceStatusLabel &&
          (!store.isDemo ||
            !isVisible('breadcrumb') ||
            pane.activeId === CALENDAR_TAB_ID ||
            pane.activeId === GRAPH_TAB_ID)
        "
        :class="store.isDemo ? 'demo-badge' : 'local-badge'"
        :title="store.isDemo ? t('浏览器演示 · 数据仅保存在本浏览器') : undefined"
      >
        <LockKeyhole v-if="workspace?.readOnly" :size="14" />
        {{ workspaceStatusLabel }}
      </span>
      <div
        :id="`graph-controls-${pane.id}`"
        v-show="pane.activeId === GRAPH_TAB_ID"
        class="graph-toolbar-host"
      />
      <div v-if="isTableTab(pane.activeId)" :id="`data-table-controls-${pane.id}`" />
      <CalendarTopbarControls
        v-if="pane.activeId === CALENDAR_TAB_ID && calendarToolItems.some((item) => isVisible(item.id))"
        :is-visible="isVisible"
        :calendar-period="calendarPeriod"
        :calendar-mode="calendarMode"
        :calendar-mode-label="calendarModeLabel"
        :calendar-mode-options="calendarModeOptions"
        :calendar-mode-open="calendarModeOpen"
        @go-today="calendarDate = new Date()"
        @move-period="moveCalendarPeriod"
        @update:calendar-mode-open="calendarModeOpen = $event"
        @select-mode="selectCalendarMode"
        @open-archive="openPlanArchive"
      />
      <div
        v-if="active && documentSuggestions.get(active.id)?.mode && !editing.isManaging(active.id)"
        class="suggestion-mode-badge"
        role="status"
        :aria-label="t('建议模式已开启')"
      >
        <MessageSquareDiff :size="14" /><span>{{ t('建议模式') }}</span>
        <button
          type="button"
          :aria-label="t('退出建议模式')"
          :data-tooltip="t('退出建议模式')"
          :disabled="suggestionModeBusy || documentSuggestions.get(active.id)?.reviewing"
          @click="toggleSuggestionMode(active.id)"
        >
          <X :size="14" />
        </button>
      </div>
      <template v-if="active">
        <div
          v-if="documentToolItems.some((item) => isVisible(item.id))"
          class="document-tool-buttons"
        >
          <MarkdownRevealToggle
            v-if="isVisible('markdown-reveal')"
            v-model="revealMarkdown"
            :source="paneSource(pane.activeId)"
            :shortcut="shortcuts.toggleMarkdownReveal"
          />
          <button
            v-if="isVisible('source-mode')"
            type="button"
            class="icon-button source-mode-button"
            :class="{ active: paneSource(pane.activeId) }"
            :disabled="
              editing.isManaging(pane.activeId) ||
              (pane.id === store.activePaneId && editing.activeBusy)
            "
            :aria-label="paneSource(pane.activeId) ? t('返回编辑') : t('切换源码模式')"
            :aria-pressed="paneSource(pane.activeId)"
            :aria-keyshortcuts="shortcutAriaLabel(shortcuts.toggleSource) || undefined"
            :data-tooltip-shortcut="shortcutKeys(shortcuts.toggleSource)[0]"
            :data-tooltip="
              editing.isManaging(pane.activeId)
                ? t('当前编辑扩展不支持切换源码模式')
                : paneSource(pane.activeId)
                  ? t('返回编辑')
                  : t('切换源码模式')
            "
            @click="setPaneSource(pane.activeId, !paneSource(pane.activeId))"
          >
            <SourceCodeIcon :size="17" :off="!paneSource(pane.activeId)" />
          </button>
        </div>
        <DocumentActionMenu
          :pane-id="pane.id"
          :pane-active-id="pane.activeId"
          :active="active"
          :is-auxiliary-window="isAuxiliaryWindow"
        />
      </template>
    </div>
  </ButtonVisibilityGroup>
</template>
