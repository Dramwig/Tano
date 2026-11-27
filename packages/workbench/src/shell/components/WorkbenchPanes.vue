<script setup lang="ts">
import { computed, inject, toRefs } from 'vue';
import { PanelLeftOpen } from 'lucide-vue-next';
import { fileHandlers, parentPath, relativeWorkspaceReference } from '@tano/protocol';
import { ASSISTANT_TAB_ID, openAssistantPage } from '../../assistant/navigation';
import { isTableTab, tableFileId } from '../../data-tables/data-tables';
import { GRAPH_TAB_ID } from '../../documents/document-graph';
import { t } from '../../i18n/i18n';
import { MAIL_TAB_ID } from '../../mail/types';
import { CALENDAR_TAB_ID } from '../../plans/calendar';
import { mobile } from '../../platform/platform';
import { PLUGINS_TAB_ID } from '../../plugins/workspace-plugins';
import { SETTINGS_TAB_ID } from '../../settings/settings-tab';
import { layoutPanes } from '../pane-layout';
import { isEmptyPaneFallback } from '../pane-registry';
import { useWindowContext } from '../../windows/context';
import {
  AssistantPanel,
  CalendarView,
  DataTablePage,
  MailWorkspaceView,
  RelationGraph,
  TemplateLibrary,
} from '../workbench-async-components';
import {
  workbenchDocumentsKey,
  workbenchModalsKey,
  workbenchPrefsKey,
  workbenchShellKey,
  workbenchTreeMenusKey,
} from '../workbench-context';
import AssistantLauncher from '../../assistant/components/AssistantLauncher.vue';
import AttachmentPreview from '../../files/components/AttachmentPreview.vue';
import DesktopTabs from '../../tabs/components/DesktopTabs.vue';
import DocumentInspector from '../../documents/components/DocumentInspector.vue';
import DocumentLoading from '../../documents/components/DocumentLoading.vue';
import DocumentPane from '../../documents/components/DocumentPane.vue';
import EmptyEditor from '../../documents/components/EmptyEditor.vue';
import FolderView from '../../files/components/FolderView.vue';
import PaneTopbar from './PaneTopbar.vue';
import PluginDetailPage from '../../plugins/components/PluginDetailPage.vue';
import PluginsTabPage from '../../plugins/components/PluginsTabPage.vue';
import PluginSurface from '../../plugins/components/PluginSurface.vue';
import PluginView from '../../plugins/components/PluginView.vue';
import { resolveOverlayTabView } from '../../plugins/overlay-mapping';
import WorkbenchSettings from '../../settings/components/WorkbenchSettings.vue';
import WorkspacePanes from './WorkspacePanes.vue';
import type { DocumentTab } from '../../stores/workspace-types';

const windowContext = useWindowContext();
const isAuxiliaryWindow = windowContext.id !== 'main';
function dragPaneWindow(event: MouseEvent) {
  if (event.button === 0 && event.detail === 1) void windowContext.native?.startDragging();
}
function maximizePaneWindow() {
  void windowContext.native?.toggleMaximize();
}

const shell = inject(workbenchShellKey);
const prefs = inject(workbenchPrefsKey);
const documents = inject(workbenchDocumentsKey);
const treeMenus = inject(workbenchTreeMenusKey);
const modals = inject(workbenchModalsKey);
if (!shell || !prefs || !documents || !treeMenus || !modals) {
  throw new Error('Workbench context is required');
}

const {
  native,
  workspace,
  startupPending,
  filesPending,
  compactPanes: mainCompactPanes,
  sidebar,
  toggleSidebar,
  sessionPending,
  store,
  createNewDocument,
  detachTab,
  assistant,
  assistantPanelMounted,
  assistantHosts,
  assistantTab,
  openReference,
  openSettings,
  extensions,
  extensionActions,
  extensionViews,
  viewActions,
  templateLibraryOpen,
  templatePaneId,
  templateSource,
  templateInitialization,
  workspaceStatusLabel,
  openEntry,
  openBreadcrumbDirectory,
  setAssistantHost,
  mailEnabled,
  paneButterflyScope,
  touchLayout,
  attachments,
  plans,
  calendarScope,
  calendarDate,
  calendarMode,
  selectCalendarMode,
  showCalendarDay,
  showCalendarMonth,
  showPlanEvent,
  createPluginObject,
  updateLock,
  busy,
} = toRefs(shell);
const {
  tabsEnabled,
  shortcuts,
  limitPageWidth,
  selectedVisualFontFamily,
  visualFontSize,
  developerMode,
} = toRefs(prefs);
const {
  revealAssistantSelection,
  showOutline,
  touchOutlineOpen,
  openAssistant,
  receiveAttachmentStatus,
} = toRefs(documents);
const { tabFileDrag, fileDragEnd, treeDocumentIcons, loadTreeDocumentIcon } = toRefs(treeMenus);
const { showModal } = toRefs(modals);

const compactPanes = computed(() => !isAuxiliaryWindow && mainCompactPanes.value);
const ownsFullscreenAssistant = computed(() => {
  const layout = store.value.windowLayouts[windowContext.id]?.layout;
  return !!layout && layoutPanes(layout).some((pane) => pane.id === assistant.value.fullscreenPaneId);
});
const extensionViewIds = computed(() => extensionViews.value.map((view) => view.id));
const documentSidebarViews = computed(() =>
  store.value.pluginViews.filter((view) => view.location === 'documentSidebar'),
);
const activeDocumentSidebarView = computed(() =>
  documentSidebarViews.value.find((view) => view.key === store.value.activeDocumentPluginSidebar),
);

function activeOverlayTabView(activeTabId: string) {
  if (!workspace.value) return null;
  return resolveOverlayTabView(activeTabId, {
    safeMode: store.value.overlaySnapshot?.safeMode,
    homeTabView: store.value.pluginHomeTabView,
    newTabView: store.value.pluginNewTabView,
  });
}

function showEmptyPaneFallback(activeId: string, tab?: DocumentTab) {
  return isEmptyPaneFallback({
    activeId,
    hasWorkspace: !!workspace.value,
    startupPending: startupPending.value,
    mailEnabled: mailEnabled.value,
    extensionViewIds: extensionViewIds.value,
    tab,
  });
}
</script>

<template>
  <WorkspacePanes
    v-if="workspace || startupPending || filesPending"
    :loading="filesPending"
    :compact="compactPanes"
    :tabs-enabled="tabsEnabled"
    :class="{ 'workspace-native-tabs': tabsEnabled && !compactPanes }"
  >
    <template #tabs="{ pane, rect }">
      <div v-if="!compactPanes" class="workspace-tabbar" :data-tab-pane-id="pane.id">
        <button
          v-if="
            native &&
            !mobile &&
            !isAuxiliaryWindow &&
            !sidebar &&
            rect.top === 0 &&
            rect.left === 0
          "
          class="desktop-sidebar-toggle icon-button"
          type="button"
          :aria-label="t('展开侧栏')"
          :data-tooltip="t('展开侧栏')"
          :data-tooltip-shortcut="shortcuts.toggleSidebar"
          @click="toggleSidebar"
        >
          <PanelLeftOpen :size="16" :stroke-width="1.6" />
        </button>
        <DesktopTabs
          :loading="sessionPending"
          :pane-id="pane.id"
          :show-navigation="rect.top === 0 && rect.left === 0"
          :detachable="native && !mobile"
          :file-drag="tabFileDrag"
          :assistant-tab="assistantTab"
          @files-dropped="fileDragEnd"
          @new-tab="
            store.focusPane(pane.id);
            store.createBlankTab();
          "
          @new-document="
            store.focusPane(pane.id);
            createNewDocument();
          "
          @detach-tab="detachTab"
        />
        <div
          v-if="native && !mobile"
          v-show="rect.top === 0"
          class="workspace-window-drag"
          :title="t('拖动窗口')"
          @mousedown="dragPaneWindow"
          @dblclick="maximizePaneWindow"
        />
      </div>
    </template>
    <template #sidebar>
      <AssistantPanel
        v-if="
          assistant.available &&
          assistantPanelMounted &&
          (assistant.displayMode !== 'fullscreen' || ownsFullscreenAssistant)
        "
        :compact="compactPanes"
        :toggle-shortcut="shortcuts.toggleAssistant"
        :fullscreen-target="assistantHosts.get(assistant.fullscreenPaneId ?? '')"
        :navigation-visible="store.activeId === ASSISTANT_TAB_ID"
        @show-navigation="sidebar = true"
        @open-reference="openReference"
        @reveal-selection="revealAssistantSelection"
        @open-settings="openSettings('assistant')"
        @closed="assistantPanelMounted = assistant.opened"
      >
        <template #quota>
          <component
            :is="extensions.regions['assistant-quota']"
            v-if="extensions.regions['assistant-quota']"
            :actions="extensionActions"
          />
        </template>
      </AssistantPanel>
    </template>
    <template #default="{ pane, document: active, tab }">
      <TemplateLibrary
        v-if="templateLibraryOpen && pane.id === templatePaneId && workspace"
        :key="workspace.id"
        :source="templateSource"
        :initialize="templateInitialization"
        :demo-label="store.isDemo ? workspaceStatusLabel : undefined"
        @close="templateLibraryOpen = false"
        @open-file="(file) => { store.focusPane(pane.id); openEntry(file); }"
        @open-directory="(path) => { store.focusPane(pane.id); templateLibraryOpen = false; void openBreadcrumbDirectory(path); }"
      >
        <template #navigation>
          <div v-if="!sidebar && !(native && !mobile && workspace)" class="topbar-navigation">
            <button
              type="button"
              class="icon-button"
              :aria-label="t('展开侧栏')"
              :data-tooltip="t('展开侧栏')"
              :data-tooltip-shortcut="shortcuts.toggleSidebar"
              @click="toggleSidebar"
            >
              <PanelLeftOpen :size="16" :stroke-width="1.6" />
            </button>
          </div>
        </template>
      </TemplateLibrary>
      <div
        :id="`assistant-fullscreen-${pane.id}`"
        :ref="(el) => setAssistantHost(pane.id, el)"
        v-show="assistant.isFullscreenTab(pane.activeId) && !(templateLibraryOpen && pane.id === templatePaneId)"
        class="assistant-fullscreen-host workspace-card"
      />
      <div
        v-show="!assistant.isFullscreenTab(pane.activeId) && !(templateLibraryOpen && pane.id === templatePaneId)"
        class="workspace-page-content"
        :class="{ 'workspace-card': tabsEnabled && !compactPanes }"
      >
        <PaneTopbar
          v-if="!isAuxiliaryWindow || pane.activeId === CALENDAR_TAB_ID || tab?.pluginView"
          :pane="pane"
          :active="active"
          :tab="tab"
          :is-auxiliary-window="isAuxiliaryWindow"
        />
        <div class="workspace-page-body" :class="{ 'workspace-card': !(tabsEnabled && !compactPanes) }">
          <KeepAlive v-if="pane.tabs.includes(GRAPH_TAB_ID)">
            <RelationGraph
              v-if="workspace && pane.activeId === GRAPH_TAB_ID"
              :key="`${workspace.id}:${workspace.path}`"
              :open-in-new-tab="tabsEnabled"
              :controls-target="isAuxiliaryWindow ? undefined : `#graph-controls-${pane.id}`"
            />
          </KeepAlive>

          <div v-if="workspace && isTableTab(pane.activeId)" class="data-table-assistant-page">
            <DataTablePage
              :key="`${workspace.id}:${pane.activeId}`"
              :table-id="tableFileId(pane.activeId)"
              :touch-layout="touchLayout"
              :comment-author="extensions.commentAuthor?.() ?? { id: 'local', name: t('本机用户') }"
              :controls-target="isAuxiliaryWindow ? undefined : `#data-table-controls-${pane.id}`"
            />
            <AssistantLauncher
              v-if="assistant.available && !assistant.opened"
              :scope="paneButterflyScope(pane.id, pane.activeId)"
              :shortcut="shortcuts.toggleAssistant"
              :context-label="t('聊聊这张数据表')"
              :busy="assistant.busy || assistant.applying"
              @open="openAssistant(pane.id, pane.activeId, { forcePanel: true })"
            />
          </div>
          <FolderView
            v-if="workspace && tab?.directory"
            :directory="tab.directory"
            :entries="workspace.files"
            :folder-home-file-name="store.workspaceSettings.folderHomeFileName"
            :document-icons="treeDocumentIcons"
            :load-document-icon="loadTreeDocumentIcon"
            @open="(file) => { store.focusPane(pane.id); void openEntry(file); }"
            @up="() => { store.focusPane(pane.id); void openBreadcrumbDirectory(parentPath(tab.directory!.path)); }"
          />
          <CalendarView
            v-if="workspace && pane.activeId === CALENDAR_TAB_ID"
            :loading="calendarScope === 'workspace' && store.workspaceLoading.objects"
            :date="calendarDate"
            :mode="calendarMode"
            :records="plans.recordsFor(calendarScope)"
            :filters-target="isAuxiliaryWindow ? undefined : `#calendar-filters-${pane.id}`"
            @select-mode="selectCalendarMode"
            @visible-month="calendarDate = $event"
            @visible-year="calendarDate = $event"
            @visible-timeline="calendarDate = $event"
            @select-date="showCalendarDay"
            @select-month="showCalendarMonth"
            @select-event="showPlanEvent"
          />

          <main v-if="pane.activeId === ASSISTANT_TAB_ID" class="assistant-page-placeholder">
            <button @click="openAssistantPage(store, assistant)">{{ t('打开助手') }}</button>
          </main>
          <template v-for="view in extensionViews" :key="view.id">
            <component
              v-if="pane.activeId === view.id"
              :is="view.component"
              :actions="viewActions[view.id]"
            />
          </template>

          <WorkbenchSettings v-if="pane.activeId === SETTINGS_TAB_ID" tabbed />
          <MailWorkspaceView v-else-if="mailEnabled && pane.activeId === MAIL_TAB_ID" />
          <PluginDetailPage
            v-if="tab?.pluginDetail"
            :plugin-id="tab.pluginDetail.id"
            :developer-mode="developerMode"
          />
          <PluginView v-else-if="pane.activeId.startsWith('plugin:')" :view-key="pane.activeId" />
          <PluginsTabPage
            v-if="workspace && pane.tabs.includes(PLUGINS_TAB_ID)"
            v-show="pane.activeId === PLUGINS_TAB_ID"
            :workspace="workspace"
            :object-references-enabled="store.capabilities.features.objectReferences"
            :developer-mode="developerMode"
            :extensions="extensions"
            :extension-actions="extensionActions"
            @enable-developer-mode="developerMode = true"
            @create-object="createPluginObject"
          />

          <DocumentLoading
            v-if="
              (!active && sessionPending) ||
              store.restoringDocuments[pane.activeId] ||
              store.openingDocuments[pane.id]?.tabId === pane.activeId
            "
            :unlimited="!limitPageWidth"
            :touch="touchLayout"
            :style="{
              '--tano-prose-font-family': selectedVisualFontFamily,
              '--tano-prose-font-size': `${visualFontSize}px`,
            }"
          />
          <DocumentPane
            v-else-if="active"
            :pane="pane"
            :active="active"
            :is-auxiliary-window="isAuxiliaryWindow"
          />
          <AttachmentPreview
            v-else-if="workspace && pane.activeId.startsWith('attachment:')"
            status-managed
            @status="receiveAttachmentStatus(pane.id, $event)"
            :read-only="!!workspace.readOnly || updateLock || busy"
            :controls-target="isAuxiliaryWindow ? undefined : `#attachment-controls-${pane.id}`"
            :file="tab?.attachment"
            :workspace-id="workspace.id"
            :url="
              attachments &&
              tab?.attachment &&
              fileHandlers.resolve(tab.attachment.path).preview !== 'office'
                ? attachments.imageUrl(
                    workspace,
                    '',
                    relativeWorkspaceReference('', tab.attachment.path),
                  )
                : null
            "
          />
          <main
            v-else-if="showEmptyPaneFallback(pane.activeId, tab)"
            class="workspace-no-tabs"
            :class="{ 'workspace-no-tabs-loading': sessionPending }"
          >
            <DocumentLoading
              v-if="sessionPending"
              :unlimited="!limitPageWidth"
              :touch="touchLayout"
              :style="{
                '--tano-prose-font-family': selectedVisualFontFamily,
                '--tano-prose-font-size': `${visualFontSize}px`,
              }"
            />
            <div
              v-else-if="workspace && activeOverlayTabView(pane.activeId)"
              class="plugin-overlay-tab-host"
            >
              <PluginSurface
                :key="`${workspace.id}:${activeOverlayTabView(pane.activeId)!.key}`"
                :view="activeOverlayTabView(pane.activeId)!"
                :workspace-id="workspace.id"
                :runtime="
                  store.pluginRuntime.find(
                    (runtime) => runtime.id === activeOverlayTabView(pane.activeId)!.pluginId,
                  )
                "
                :execute="store.interactWithPlugin"
              />
            </div>
            <EmptyEditor
              v-else
              :create-disabled="busy || !workspace || workspace.readOnly || updateLock"
              @create="createNewDocument"
              @open="showModal('newTab')"
              @search="showModal('search')"
            />
          </main>

          <DocumentInspector
            v-if="
              active &&
              !(assistant.opened && assistant.displayMode === 'sidebar') &&
              !isAuxiliaryWindow &&
              pane.id === store.activePaneId &&
              (activeDocumentSidebarView ||
                (showOutline && (!touchLayout || touchOutlineOpen)))
            "
          />
        </div>
      </div>
    </template>
  </WorkspacePanes>
</template>
