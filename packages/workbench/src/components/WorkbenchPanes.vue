<script setup lang="ts">
import WorkbenchSettings from './WorkbenchSettings.vue';
import { computed, inject, toRefs } from 'vue';
import { layoutPanes } from '../pane-layout';
import { workbenchContextKey } from '../workbench-context';
import { useWindowContext } from '../windows/context';

const windowContext = useWindowContext();
const isAuxiliaryWindow = windowContext.id !== 'main';
function dragPaneWindow(event: MouseEvent) {
  if (event.button === 0 && event.detail === 1) void windowContext.native?.startDragging();
}
function maximizePaneWindow() { void windowContext.native?.toggleMaximize(); }

const context = inject(workbenchContextKey);
if (!context) throw new Error('Workbench context is required');
const {
  workspace,
  startupPending,
  filesPending,
  compactPanes: mainCompactPanes,
  tabsEnabled,
  native,
  mobile,
  sidebar,
  t,
  shortcuts,
  toggleSidebar,
  sessionPending,
  tabFileDrag,
  assistantTab,
  fileDragEnd,
  store,
  createNewDocument,
  detachTab,
  assistant,
  assistantPanelMounted,
  assistantHosts,
  ASSISTANT_TAB_ID,
  openReference,
  revealAssistantSelection,
  openSettings,
  extensions,
  extensionActions,
  templateLibraryOpen,
  templatePaneId,
  templateSource,
  templateInitialization,
  workspaceStatusLabel,
  openEntry,
  openBreadcrumbDirectory,
  setAssistantHost,
  topbarVisibilityItems,
  GRAPH_TAB_ID,
  closeButtonVisibilityMenus,
  canNavigatePage,
  navigatePage,
  CALENDAR_TAB_ID,
  paneButterflyScope,
  treeDocumentIcons,
  loadTreeDocumentIcon,
  pluginViewHeader,
  pluginPreviewStatus,
  paneDocumentStatus,
  attachmentStatus,
  currentAttachmentStatus,
  PLUGINS_TAB_ID,
  extensionViews,
  settingsTabView,
  touchLayout,
  showOutline,
  touchOutlineOpen,
  panel,
  attachments,
  isTableTab,
  calendarToolItems,
  calendarPeriod,
  calendarDate,
  moveCalendarPeriod,
  calendarModeOpen,
  calendarModeLabel,
  calendarModeOptions,
  calendarMode,
  selectCalendarMode,
  managePlanEvents,
  documentSuggestions,
  editing,
  suggestionModeBusy,
  toggleSuggestionMode,
  documentToolItems,
  revealMarkdown,
  paneSource,
  shortcutAriaLabel,
  shortcutKeys,
  setPaneSource,
  menu,
  toggleDocumentMenu,
  documentMenuTriggerKeydown,
  documentMenuKeydown,
  openPaneSearch,
  shortcutHint,
  editorReadonly,
  documentUndoAvailable,
  undoDocument,
  documentRedoAvailable,
  redoDocument,
  canAddDocumentProperty,
  addDocumentProperty,
  paneComments,
  openDocumentDiscussion,
  paneReadonly,
  referenceGraphOpened,
  showReferenceGraph,
  limitPageWidth,
  pageWidthWritable,
  setLimitPageWidth,
  workspaceLocked,
  pageLocked,
  togglePageLock,
  historyPage,
  historyPanel,
  editorPreferences,
  showPageTitle,
  showDocumentProperties,
  showAllLineNumbers,
  togglePageOption,
  toggleWorkspaceLock,
  exportBusy,
  exportDocument,
  printBusy,
  printActiveDocument,
  sessionBlocksFileMutation,
  removeDocument,
  tableFileId,
  openAssistant,
  parentPath,
  openWorkspaceViewSourceFile,
  openWorkspaceViewSourceObject,
  calendarScope,
  plans,
  showCalendarDay,
  showCalendarMonth,
  showPlanEvent,
  openAssistantPage,
  viewActions,
  SETTINGS_TAB_ID,
  showObjects,
  selectedVisualFontFamily,
  visualFontSize,
  setPaneSearch,
  paneSourceEditors,
  paneEditors,
  paneSearchRevisions,
  setPaneElement,
  toolbarMode,
  scheduleActiveHeading,
  appearance,
  assistantTaskActive,
  beginSelectionTodo,
  paneEditorScrolls,
  paneSelections,
  defaultSelectionContext,
  showSourceTodo,
  selectedDiff,
  showModal,
  sourceFontSize,
  openPageContextMenu,
  safeRemoteImage,
  uploadFile,
  resourceRevision,
  renameDocumentTitle,
  insertBlockBelowTitle,
  commentAnchors,
  paneEditorReady,
  paneSourceSelections,
  insertSourceFiles,
  CalloutIconPicker,
  setPaneEditor,
  openDocumentLink,
  openWikiLink,
  openBlankBlockAssistant,
  startDocumentDraft,
  quickInitialize,
  chooseInitialTemplate,
  showDocumentDiscussion,
  setPaneComments,
  discussWithAssistant,
  capturePaneCommentSelection,
  focusPaneComment,
  paneCommentGeometry,
  paneScrolls,
  receiveAttachmentStatus,
  updateLock,
  busy,
  fileHandlers,
  relativeWorkspaceReference,
  outlineOnLeft,
  hoverOutline,
  outlinePinned,
  outlinePosition,
  openOutlineContextMenu,
  releaseOutlinePointerFocus,
  outlineAutoCollapse,
  outlineSearchOpen,
  toggleOutlineSearch,
  toggleOutlinePin,
  outlineSearch,
  visibleOutline,
  jumpToHeading,
  outline,
  activeHeading,
  localNative,
  agentPanel,
  activities,
  AlertTriangle,
  RefreshCw,
  Check,
  FileText,
  uiLocale,
  PanelLeftOpen,
  DesktopTabs,
  AssistantPanel,
  TemplateLibrary,
  ArrowLeft,
  ArrowRight,
  DocumentStatus,
  ChevronRight,
  Puzzle,
  WorkspaceBreadcrumb,
  PluginViewHeader,
  List,
  ArrowDownToLine,
  LockKeyhole,
  ChevronLeft,
  ChevronDown,
  CalendarDays,
  MessageSquareDiff,
  X,
  MarkdownRevealToggle,
  SourceCodeIcon,
  MoreHorizontal,
  PluginMenu,
  Search,
  ShortcutHint,
  Repeat2,
  Undo2,
  Redo2,
  CheckCheck,
  Plus,
  MessageSquare,
  GitFork,
  MoveHorizontal,
  Archive,
  Clock3,
  PageDisplayOptions,
  DocumentGlobalMenu,
  DocumentExportMenu,
  DocumentPrintButton,
  Trash2,
  ButtonVisibilityGroup,
  RelationGraph,
  DataTablePage,
  AssistantLauncher,
  FolderView,
  WorkspaceViewTab,
  CalendarView,
  PluginView,
  PluginInstaller,
  PluginDetailPage,
  DocumentLoading,
  PageSearch,
  LayoutDocumentChrome,
  ListTodo,
  EditorTools,
  ArrowUpRight,
  DocumentTitle,
  SourceEditor,
  DocumentStarter,
  MarkdownEditor,
  DocumentComments,
  DocumentSuggestions,
  DocumentScrollbar,
  AttachmentPreview,
  EmptyEditor,
  History,
  ListTree,
  Pin,
  DocumentOutline,
  Bot,
  WorkspacePanes,
  vSurfaceMotion,
  vButterflyPerch,
  vOutlineMotion,
} = toRefs(context);
const compactPanes = computed(() => !isAuxiliaryWindow && mainCompactPanes.value);
// The fullscreen host is shared across windows; only its owner may mount the panel.
const ownsFullscreenAssistant = computed(() => {
  const layout = store.value.windowLayouts[windowContext.id]?.layout;
  return !!layout && layoutPanes(layout).some(pane => pane.id === assistant.value.fullscreenPaneId);
});
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
              :data-tooltip="t('展开侧栏')" :data-tooltip-shortcut="shortcuts.toggleSidebar"
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
            v-if="assistant.available && assistantPanelMounted"
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
              <component :is="extensions.regions['assistant-quota']" v-if="extensions.regions['assistant-quota']" :actions="extensionActions" />
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
                <button type="button" class="icon-button" :aria-label="t('展开侧栏')" :data-tooltip="t('展开侧栏')" :data-tooltip-shortcut="shortcuts.toggleSidebar" @click="toggleSidebar"><PanelLeftOpen :size="16" :stroke-width="1.6" /></button>
              </div>
            </template>
          </TemplateLibrary>
          <div
            :id="`assistant-fullscreen-${pane.id}`"
            :ref="(el) => setAssistantHost(pane.id, el)"
            v-show="assistant.isFullscreenTab(pane.activeId) && !(templateLibraryOpen && pane.id === templatePaneId)"
            class="assistant-fullscreen-host"
          />
          <div v-show="!assistant.isFullscreenTab(pane.activeId) && !(templateLibraryOpen && pane.id === templatePaneId)" class="workspace-page-content">
            <ButtonVisibilityGroup
              v-if="!isAuxiliaryWindow || pane.activeId === CALENDAR_TAB_ID || tab?.pluginView"
              v-slot="{ isVisible }"
              :items="
                topbarVisibilityItems(pane.activeId, !!active, pane.id === store.activePaneId)
              "
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
                role="group"
                :aria-label="pane.activeId === GRAPH_TAB_ID ? t('图谱导航') : t('文档导航')"
              >
                <button
                  v-if="!sidebar && !(native && !mobile && workspace)"
                  type="button"
                  class="icon-button"
                  :aria-label="t('展开侧栏')"
                  :data-tooltip="t('展开侧栏')" :data-tooltip-shortcut="shortcuts.toggleSidebar"
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
                :perch="{ id: `breadcrumb:${paneButterflyScope(pane.id, pane.activeId)}`, scope: paneButterflyScope(pane.id, pane.activeId), label: t('面包屑'), kind: 'component' }"
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
                :workspace-view="tab?.workspaceView?.view"
                :demo-label="store.isDemo ? workspaceStatusLabel : undefined"
                :read-only="workspace?.readOnly"
                @open="(file) => { store.focusPane(pane.id); openEntry(file); }"
                @open-directory="(path) => { store.focusPane(pane.id); void openBreadcrumbDirectory(path); }"
              >
                <template #status>
                  <DocumentStatus v-if="tab?.pluginView && isVisible('document-status')"
                    :document-key="`${workspace?.id}:${tab.pluginView.pluginId}:${tab.pluginView.id}:${pluginViewHeader(store.pluginRuntime, tab.pluginView)?.title}`"
                    :items="pluginPreviewStatus(store.pluginRuntime, tab.pluginView)" />
                  <DocumentStatus v-if="active && isVisible('document-status')" :document-key="`${workspace?.id}:${active.id}`" :items="paneDocumentStatus(active)">
                    <component :is="extensions.regions['document-status-details']"
                      v-if="pane.id === store.activePaneId && extensions.regions['document-status-details']" :actions="extensionActions" />
                  </DocumentStatus>
                  <DocumentStatus v-else-if="tab?.attachment && isVisible('document-status')" :document-key="`${workspace?.id}:${tab.attachment.id}`" :items="attachmentStatus(pane.id, tab.attachment)">
                    <button v-if="currentAttachmentStatus(pane.id, tab.attachment)?.retry" :disabled="currentAttachmentStatus(pane.id, tab.attachment)?.retryDisabled" @click="currentAttachmentStatus(pane.id, tab.attachment)?.retry?.()">{{ t('重试') }}</button>
                  </DocumentStatus>
                </template>
                <template v-if="tab?.pluginDetail"><ChevronRight :size="12" /><Puzzle :size="14" /><span class="breadcrumb-current">{{ tab.pluginDetail.name }}</span></template>
                <template v-if="tab?.pluginView"><ChevronRight :size="12" /><Puzzle :size="14" /><span class="breadcrumb-current" :title="pluginViewHeader(store.pluginRuntime, tab.pluginView)?.title">{{ pluginViewHeader(store.pluginRuntime, tab.pluginView)?.title || tab.pluginView.label }}</span></template>
                <template v-if="pane.activeId === PLUGINS_TAB_ID"
                  ><ChevronRight :size="12" /><Puzzle :size="14" /><span class="breadcrumb-current"
                    >{{ t('插件') }}</span
                  ></template
                ><template
                  v-for="view in [...extensionViews, settingsTabView].filter((view) => view.id === pane.activeId)"
                  :key="view.id"
                  ><ChevronRight :size="12" /><component :is="view.icon" :size="14" /><span
                    class="breadcrumb-current"
                    >{{ view.label }}</span
                  ></template
                >
              </WorkspaceBreadcrumb>
              <DocumentStatus v-if="(active || tab?.attachment) && !isVisible('breadcrumb') && isVisible('document-status')"
                :document-key="`${workspace?.id}:${active?.id ?? tab?.attachment?.id}`" :items="active ? paneDocumentStatus(active) : attachmentStatus(pane.id, tab?.attachment)">
                <component v-if="active && pane.id === store.activePaneId && extensions.regions['document-status-details']" :is="extensions.regions['document-status-details']"
                  :actions="extensionActions" />
                <button v-if="!active && currentAttachmentStatus(pane.id, tab?.attachment)?.retry" :disabled="currentAttachmentStatus(pane.id, tab?.attachment)?.retryDisabled" @click="currentAttachmentStatus(pane.id, tab?.attachment)?.retry?.()">{{ t('重试') }}</button>
              </DocumentStatus>
              <div class="topbar-right">
                <PluginViewHeader v-if="tab?.pluginView && workspace" :view="tab.pluginView" :workspace-id="workspace.id"
                  :runtime="store.pluginRuntime.find(item => item.id === tab.pluginView?.pluginId)" :execute="store.interactWithPlugin" />
                <button v-if="active && touchLayout && showOutline" type="button" class="icon-button"
                  :aria-label="t('文档大纲')" :aria-expanded="touchOutlineOpen"
                  @click="panel = 'outline'; touchOutlineOpen = !touchOutlineOpen">
                  <List :size="18" />
                </button>
                <button
                  v-if="tab?.attachment && attachments && isVisible('attachment-export')"
                  type="button"
                  class="topbar-attachment-action"
                  :aria-label="t('导出附件')"
                  :data-tooltip="t('导出附件副本')"
                  @click="
                    attachments
                      .exportAttachment(workspace!.id, tab.attachment.path)
                      .catch(store.report)
                  "
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
                <div
                  v-if="isTableTab(pane.activeId)"
                  :id="`data-table-controls-${pane.id}`"
                />
                <div
                  v-if="
                    pane.activeId === CALENDAR_TAB_ID &&
                    calendarToolItems.some((item) => isVisible(item.id))
                  "
                  class="calendar-topbar-controls"
                  role="group"
                  :aria-label="t('日历导航')"
                >
                  <span v-if="isVisible('calendar-period')" class="calendar-topbar-period">{{
                    calendarPeriod
                  }}</span>
                  <button
                    v-if="isVisible('calendar-today')"
                    type="button"
                    class="calendar-topbar-today"
                    @click="calendarDate = new Date()"
                  >
                    {{ t('今天') }}
                  </button>
                  <button
                    v-if="isVisible('calendar-previous')"
                    type="button"
                    class="icon-button"
                    :aria-label="t('上一时段')"
                    :data-tooltip="t('上一时段')"
                    @click="moveCalendarPeriod(-1)"
                  >
                    <ChevronLeft :size="17" />
                  </button>
                  <button
                    v-if="isVisible('calendar-next')"
                    type="button"
                    class="icon-button"
                    :aria-label="t('下一时段')"
                    :data-tooltip="t('下一时段')"
                    @click="moveCalendarPeriod(1)"
                  >
                    <ChevronRight :size="17" />
                  </button>
                  <div
                    v-if="isVisible('calendar-mode')"
                    class="calendar-view-picker"
                    @keydown.esc.stop.prevent="calendarModeOpen = false"
                  >
                    <button
                      type="button"
                      class="calendar-topbar-mode"
                      :aria-label="t('切换日历视图')"
                      :data-tooltip="t('Ctrl + 滚轮：切换日历视图')"
                      aria-haspopup="menu"
                      :aria-expanded="calendarModeOpen"
                      @click="calendarModeOpen = !calendarModeOpen"
                    >
                      {{ calendarModeLabel }}<ChevronDown :size="14" />
                    </button>
                    <div v-surface-motion="'App:4'"
                      v-if="calendarModeOpen"
                      class="calendar-view-menu"
                      role="menu"
                      :aria-label="t('日历视图')"
                    >
                      <button
                        v-for="option in calendarModeOptions"
                        :key="option.mode"
                        type="button"
                        role="menuitemradio"
                        :aria-checked="calendarMode === option.mode"
                        @click="selectCalendarMode(option.mode)"
                      >
                        {{ option.label }}<Check v-if="calendarMode === option.mode" :size="15" />
                      </button>
                    </div>
                  </div>
                  <button
                    v-if="isVisible('calendar-events')"
                    type="button"
                    class="calendar-topbar-events"
                    :data-tooltip="t('查看和管理事件')"
                    @click="managePlanEvents"
                  >
                    <CalendarDays :size="15" />{{ t('管理事件') }}
                  </button>
                </div>
                <div v-if="active && documentSuggestions.get(active.id)?.mode && !editing.isManaging(active.id)"
                  class="suggestion-mode-badge" role="status" :aria-label="t('建议模式已开启')">
                  <MessageSquareDiff :size="14" /><span>{{ t('建议模式') }}</span>
                  <button type="button" :aria-label="t('退出建议模式')" :data-tooltip="t('退出建议模式')"
                    :disabled="suggestionModeBusy || documentSuggestions.get(active.id)?.reviewing"
                    @click="toggleSuggestionMode(active.id)"><X :size="14" /></button>
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
                  <div class="menu-wrap">
                    <button
                      class="icon-button"
                      :aria-label="t('文档操作')"
                      v-butterfly-perch="{ id: `document-actions:${paneButterflyScope(pane.id, pane.activeId)}`, scope: paneButterflyScope(pane.id, pane.activeId), label: t('文档操作按钮'), kind: 'component' }"
                      :aria-expanded="menu && pane.id === store.activePaneId"
                      @click="toggleDocumentMenu"
                      @keydown="documentMenuTriggerKeydown"
                    >
                      <MoreHorizontal :size="19" />
                    </button>
                    <div v-surface-motion="'App:5'"
                      v-if="menu && pane.id === store.activePaneId"
                      ref="documentMenuElement"
                      class="dropdown compact-action-menu document-dropdown"
                      @keydown="documentMenuKeydown"
                    >
                      <PluginMenu location="document" :file-id="active.id" @selected="menu = false" />
                      <button type="button" @click="openPaneSearch(pane.id)">
                        <Search :size="15" />{{ t('页内搜索') }}<span class="menu-shortcut"><ShortcutHint :label="shortcutHint('pageSearch')" /></span>
                      </button>
                      <button type="button" @click="openPaneSearch(pane.id, true)">
                        <Repeat2 :size="15" />{{ t('查找与替换') }}<span class="menu-shortcut"><ShortcutHint :label="shortcutHint('pageReplace')" /></span>
                      </button>
                      <button
                        type="button"
                        :disabled="editorReadonly || !documentUndoAvailable"
                        @click="undoDocument"
                      >
                        <Undo2 :size="15" />{{ t('撤销') }}<kbd class="menu-shortcut" aria-hidden="true"><ShortcutHint :label="shortcutHint('undo')" /></kbd>
                      </button>
                      <button
                        type="button"
                        :disabled="editorReadonly || !documentRedoAvailable"
                        @click="redoDocument"
                      >
                        <Redo2 :size="15" />{{ t('重做') }}<kbd class="menu-shortcut" aria-hidden="true"><ShortcutHint :label="shortcutHint('redo')" /></kbd>
                      </button>
                      <button
                        @click="
                          menu = false;
                          store.flush();
                        "
                      >
                        <CheckCheck :size="15" />{{ t('立即保存') }}<span class="menu-shortcut"><ShortcutHint :label="shortcutHint('save')" /></span>
                      </button>
                      <div class="menu-divider" role="separator" />
                      <button type="button" :disabled="!canAddDocumentProperty" @click="addDocumentProperty">
                        <Plus :size="15" />{{ t('添加文档属性') }}
                      </button>
                      <button type="button"
                        :disabled="editorReadonly || !!editing.active || editing.activeBusy || !paneComments.has(store.activePaneId)"
                        @click="openDocumentDiscussion">
                        <MessageSquare :size="15" />{{ t('发起讨论') }}
                      </button>
                      <button type="button"
                        :disabled="suggestionModeBusy || (!documentSuggestions.get(active.id)?.mode && (paneReadonly(active) || editing.isManaging(active.id) || editing.activeBusy)) || documentSuggestions.get(active.id)?.loading || documentSuggestions.get(active.id)?.reviewing"
                        @click="toggleSuggestionMode(active.id)">
                        <MessageSquareDiff :size="15" />{{ documentSuggestions.get(active.id)?.mode ? t('退出建议模式') : t('建议编辑') }}
                      </button>
                      <div class="menu-divider" role="separator" />
                      <button
                        type="button"
                        aria-haspopup="dialog"
                        :aria-expanded="referenceGraphOpened"
                        @click="showReferenceGraph(pane.id, active!)"
                      >
                        <GitFork :size="15" />{{ t('查看关系图谱') }}
                      </button>
                      <button
                        type="button"
                        class="page-toggle-menu-item"
                        role="switch"
                        :aria-checked="!limitPageWidth"
                        :aria-busy="store.capabilitySaving || undefined"
                        :disabled="!pageWidthWritable"
                        :data-tooltip="t('切换页面内容宽度')"
                        @click="setLimitPageWidth(!limitPageWidth)"
                      >
                        <MoveHorizontal :size="15" />{{ t('全宽') }}<span
                          class="menu-switch"
                          :class="{ on: !limitPageWidth }"
                          aria-hidden="true"
                          ><span
                        /></span>
                      </button>
                      <button
                        type="button"
                        class="page-toggle-menu-item"
                        role="switch"
                        :aria-checked="workspaceLocked || pageLocked"
                        :disabled="workspaceLocked"
                        :data-tooltip="workspaceLocked ? t('请先关闭工作区锁定，再修改页面锁定') : pageLocked ? t('退出阅读模式') : t('锁定后进入阅读模式')"
                        @click="togglePageLock"
                      >
                        <LockKeyhole :size="15" />{{ t('锁定页面') }}<span
                          class="menu-switch"
                          :class="{ on: workspaceLocked || pageLocked }"
                          aria-hidden="true"
                          ><span
                        /></span>
                      </button>
                      <div class="menu-divider" role="separator" />
                      <button
                        @click="
                          menu = false;
                          historyPage = 'versions';
                          historyPanel = true;
                        "
                      >
                        <Archive :size="15" />{{ t('版本历史') }}<span class="menu-beta">Beta</span>
                      </button>
                      <button
                        @click="
                          menu = false;
                          historyPage = 'updates';
                          historyPanel = true;
                        "
                      >
                        <Clock3 :size="15" />{{ t('更新历史') }}
                      </button>
                      <DocumentGlobalMenu>
                        <PageDisplayOptions :workspace-locked="workspaceLocked" :workspace-available="!!workspace"
                          :auto-spacing="editorPreferences.autoSpacing ?? false"
                          :show-page-title="showPageTitle"
                          :show-document-properties="showDocumentProperties"
                          :show-outline="showOutline"
                          :show-all-line-numbers="showAllLineNumbers"
                          :auxiliary-window="!!isAuxiliaryWindow"
                          :source="paneSource(store.activeId)"
                          @toggle="togglePageOption" @toggle-workspace-lock="toggleWorkspaceLock" />
                      </DocumentGlobalMenu>
                      <DocumentExportMenu :disabled="exportBusy" @select="exportDocument" />
                      <DocumentPrintButton :busy="printBusy" :shortcut="shortcuts.print" @select="printActiveDocument" />
                      <div class="menu-divider" role="separator" />
                      <button
                        class="danger-text"
                        :disabled="
                          editorReadonly ||
                          sessionBlocksFileMutation(pane.activeId) ||
                          (pane.id === store.activePaneId && editing.activeBusy)
                        "
                        @click="removeDocument()"
                      >
                        <Trash2 :size="15" />{{
                          store.isDemo
                            ? t('删除演示文档')
                            : store.isWeb
                              ? t('删除在线文档')
                              : t('移入回收站')
                        }}
                      </button>
                    </div>
                  </div>
                </template>
              </div>
            </ButtonVisibilityGroup>
            <!-- Everything below the top bar. A layout can raise it as its own surface (card islands); otherwise display: contents. -->
            <div class="workspace-page-body">
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
            <FolderView v-if="workspace && tab?.directory" :directory="tab.directory" :entries="workspace.files"
              :folder-home-file-name="store.workspaceSettings.folderHomeFileName"
              :document-icons="treeDocumentIcons" :load-document-icon="loadTreeDocumentIcon"
              @open="(file) => { store.focusPane(pane.id); void openEntry(file); }"
              @up="() => { store.focusPane(pane.id); void openBreadcrumbDirectory(parentPath(tab.directory!.path)); }" />
            <WorkspaceViewTab
              v-if="workspace && pane.activeId.startsWith('workspace-view:')"
              :key="`${workspace.id}:${pane.activeId}`"
              :tab-id="pane.activeId"
              @open-file="(file) => { store.focusPane(pane.id); void openWorkspaceViewSourceFile(file); }"
              @edit-document-properties="async (file) => { store.focusPane(pane.id); await openWorkspaceViewSourceFile(file); showDocumentProperties = true; setPaneSource(file.id, false); }"
              @open-object="(identity) => { store.focusPane(pane.id); openWorkspaceViewSourceObject(identity); }"
            />
            <CalendarView
              v-if="workspace && pane.activeId === CALENDAR_TAB_ID"
              :loading="calendarScope === 'workspace' && store.workspaceLoading.objects"
              :date="calendarDate"
              :mode="calendarMode"
              :records="plans.recordsFor(calendarScope)"
              @select-mode="selectCalendarMode"
              @visible-month="calendarDate = $event"
              @visible-year="calendarDate = $event"
              @visible-timeline="calendarDate = $event"
              @select-date="showCalendarDay"
              @select-month="showCalendarMonth"
              @select-event="showPlanEvent"
            />

            <main v-if="pane.activeId === ASSISTANT_TAB_ID" class="assistant-page-placeholder"><button @click="openAssistantPage(store, assistant)">{{ t('打开助手') }}</button></main>
            <template v-for="view in extensionViews" :key="view.id">
              <component
                v-if="pane.activeId === view.id"
                :is="view.component"
                :actions="viewActions[view.id]"
              />
            </template>

            <WorkbenchSettings v-if="pane.activeId === SETTINGS_TAB_ID" tabbed />
            <PluginDetailPage v-if="tab?.pluginDetail" :plugin-id="tab.pluginDetail.id" />
            <PluginView v-else-if="pane.activeId.startsWith('plugin:')" :view-key="pane.activeId" />
            <main
              v-if="workspace && pane.tabs.includes(PLUGINS_TAB_ID)"
              v-show="pane.activeId === PLUGINS_TAB_ID"
              class="plugins-tab-page"
            >
              <div class="plugins-tab-content">
                <p v-if="!store.capabilities.features.objectReferences" class="tool-level-notice">
                  {{ t('Level 2 已关闭，插件对象和关系暂时只读。可在工作区设置中重新启用。') }}
                </p>
                <p v-else-if="workspace.readOnly" class="tool-level-notice">
                  {{ t('此工作区为只读，无法修改对象和关系。') }}
                </p>
                <PluginInstaller @objects="showObjects()">
                  <template v-if="extensions.regions['plugin-publishing']" #publishing>
                    <component :is="extensions.regions['plugin-publishing']" :actions="extensionActions" />
                  </template>
                </PluginInstaller>
              </div>
            </main>

            <DocumentLoading v-if="(!active && sessionPending) || store.restoringDocuments[pane.activeId] || store.openingDocuments[pane.id]?.tabId === pane.activeId" :unlimited="!limitPageWidth" :touch="touchLayout" :style="{ '--tano-prose-font-family': selectedVisualFontFamily, '--tano-prose-font-size': `${visualFontSize}px` }" />
            <template v-else-if="active">
              <PageSearch
                :shortcuts="shortcuts"
                :key="`search:${active.id}`"
                :ref="(el) => setPaneSearch(pane.id, el)"
                :editor="
                  paneSource(pane.activeId)
                    ? paneSourceEditors.get(pane.id)
                    : paneEditors.get(pane.id)
                "
                :content="active.content"
                :readonly="paneReadonly(active!)"
                :revision="paneSearchRevisions[pane.id]"
              />
              <div :key="active.id" class="document-scroll-shell" :class="{ 'has-assistant-launcher': assistant.available }">
                <div
                  :id="`document-scroll-${pane.id}`"
                  :ref="(el) => setPaneElement('scroll', pane.id, el)"
                  class="document-layout"
                  :data-toolbar-dock="
                    pane.id === store.activePaneId &&
                    !paneSource(pane.activeId) &&
                    !paneReadonly(active!)
                      ? toolbarMode
                      : undefined
                  "
                  @scroll.passive="scheduleActiveHeading"
                >
                  <main class="document-main">
                    <LayoutDocumentChrome :layout="appearance.layout" :path="active.path" />
                    <EditorTools
                      :shortcuts="shortcuts"
                      v-model:mode="toolbarMode"
                      :assistant="assistant.available"
                        :assistant-disabled="assistantTaskActive()"
                      @assistant="openAssistant(pane.id, active!.id)"
                      annotation
                      :todo="
                        store.capabilities.features.objectReferences &&
                        !paneReadonly(active!) &&
                        !editing.isManaging(active!.id)
                      "
                      @todo="beginSelectionTodo(pane.id, active!.id)"
                      @annotation="paneComments.get(pane.id)?.beginAnnotation()"
                      :active="pane.id === store.activePaneId"
                      :editor-element="paneEditorScrolls.get(pane.id)"
                      :features="store.capabilities.features"
                      :context="paneSelections[pane.id] ?? defaultSelectionContext"
                      :source="paneSource(pane.activeId)"
                      :disabled="paneReadonly(active!)"
                      @command="(name, value) => paneEditors.get(pane.id)?.command(name, value)"
                    >
                      <template v-if="isAuxiliaryWindow || showSourceTodo(pane.id, active!)" #trailing>
                        <button
                          v-if="showSourceTodo(pane.id, active!)"
                          type="button"
                          class="icon-button"
                          :aria-label="t('从选区创建任务或事件')"
                          :data-tooltip="t('从选区创建任务或事件')"
                          @mousedown.prevent
                          @click="beginSelectionTodo(pane.id, active!.id)"
                        >
                          <ListTodo :size="17" />
                        </button>
                        <ButtonVisibilityGroup
                          v-if="isAuxiliaryWindow"
                          v-slot="{ isVisible }"
                          :items="documentToolItems"
                          preference-key="tano.preference.documentHiddenTools"
                          group-class="detached-editor-actions document-tool-buttons"
                          :label="t('文档工具')"
                          :menu-label="t('文档工具按钮显示设置')"
                          @open="closeButtonVisibilityMenus"
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
                            class="icon-button"
                            :class="{ active: paneSource(pane.activeId) }"
                            :disabled="!!editing.active || editing.activeBusy"
                            :aria-label="paneSource(pane.activeId) ? t('返回编辑') : t('切换源码模式')"
                            :aria-pressed="paneSource(pane.activeId)"
                            :aria-keyshortcuts="shortcutAriaLabel(shortcuts.toggleSource) || undefined"
                            :data-tooltip-shortcut="shortcutKeys(shortcuts.toggleSource)[0]"
                            :data-tooltip="paneSource(pane.activeId) ? t('返回编辑') : t('切换源码模式')"
                            @click="setPaneSource(pane.activeId, !paneSource(pane.activeId))"
                          >
                            <SourceCodeIcon :size="17" :off="!paneSource(pane.activeId)" />
                          </button>
                        </ButtonVisibilityGroup>
                      </template>
                    </EditorTools>

                    <component
                      :is="extensions.regions['editing-panel']"
                      v-if="pane.id === store.activePaneId && extensions.regions['editing-panel']"
                      :actions="extensionActions"
                    />
                    <p v-if="active.creating && !active.error" class="creation-status" role="status">
                      {{ t('正在创建… 可以继续编辑') }}
                    </p>
                    <div v-if="active.conflict" class="conflict-banner" role="alert">
                      <AlertTriangle :size="19" />
                      <div>
                        <strong>{{ t('这一页有两份新的想法') }}</strong>
                        <p>
                          {{ t('外部修改与你的修改重叠。你的内容已保存为 conflict 副本，原文件保留外部版本。') }}
                        </p>
                        <button @click="store.resolveConflict(active!, true)">
                          {{ t('打开我的副本') }} <ArrowUpRight :size="14" /></button
                        ><button @click="store.resolveConflict(active!, false)">
                          {{ t('载入磁盘版本') }}
                        </button>
                        <button
                          @click="
                            selectedDiff = {
                              title: active.path,
                              before: active.conflict.disk.content,
                              after: active.content,
                              beforeLabel: t('磁盘版本'),
                              afterLabel: t('我的副本'),
                            }
                          "
                        >
                          {{ t('比较两个版本') }}
                        </button>
                      </div>
                    </div>
                    <div
                      v-else-if="active.missing || active.error"
                      class="conflict-banner"
                      role="alert"
                    >
                      <AlertTriangle :size="19" />
                      <div>
                        <strong>{{
                          active.missing ? t('文件已在工作文件夹中移除') : active.creating ? t('文档尚未创建成功') : t('这次保存没有完成')
                        }}</strong>
                        <p>
                          {{
                            active.error ?? t('编辑器中的内容仍然保留，你可以把它另存为一个新文档。')
                          }}
                        </p>
                        <button @click="showModal('saveAs')">
                          {{ t('另存副本') }} <ArrowUpRight :size="14" /></button
                        ><button v-if="!active.missing" @click="store.flush()">{{ t('重试保存') }}</button>
                      </div>
                    </div>
                    <div
                      :ref="(el) => setPaneElement('editor', pane.id, el)"
                      class="editor-scroll"
                      :style="{
                        '--tano-prose-font-family': selectedVisualFontFamily,
                        '--tano-prose-font-size': `${visualFontSize}px`,
                        '--tano-source-font-size': `${sourceFontSize}px`,
                      }"
                      :class="{
                        'source-view': paneSource(pane.activeId),
                        'conflicted-editor': active.conflict,
                        'width-unlimited': !limitPageWidth,
                      }"
                      tabindex="-1"
                      @mousedown.self="
                        !paneSource(pane.activeId) &&
                        paneEditors.get(pane.id)?.focusTrailingParagraph($event)
                      "
                      @contextmenu="openPageContextMenu"
                    >
                      <DocumentSuggestions v-slot="suggestions" :document="active" :readonly="paneReadonly(active!)"
                        :source="paneSource(pane.activeId)"
                        :managed="!!editing.active" :author="extensions.commentAuthor?.() ?? { id: 'local', name: t('本机用户') }">
                      <DocumentTitle
                        v-if="workspace && showPageTitle"
                        :key="`${workspace.id}:${active.id}`"
                        :workspace-id="workspace.id"
                        :document-id="active.id"
                        :path="store.displayPath(active)"
                        :title-source="store.workspaceSettings.pageTitleSource"
                        :model-value="suggestions.content"
                        :files="workspace.files"
                        :mode="store.isDemo ? 'demo' : store.isWeb ? 'web' : 'local'"
                        :resolve-image="(reference) => attachments ? attachments.imageUrl(workspace, active!.path, reference) : safeRemoteImage(reference)"
                        :upload-cover="attachments && !store.isDemo ? (file) => uploadFile(file, true, active) : undefined"
                        :resource-revision="resourceRevision"
                        :readonly="
                          suggestions.readonly ||
                          suggestions.suggesting ||
                          active.missing ||
                          sessionBlocksFileMutation(active.id) ||
                          editing.activeBusy
                        "
                        :rename="renameDocumentTitle"
                        @update:model-value="suggestions.edit($event)"
                        @enter="insertBlockBelowTitle"
                        @comment="paneComments.get(pane.id)?.showDiscussion()"
                      />
                      <SourceEditor :reference-targets="store.referenceTargets" :capabilities="store.capabilities" :preferences="editorPreferences" :suggestion-marks="suggestions.sourceMarks"
                        :show-all-line-numbers="showAllLineNumbers"
                        v-if="paneSource(pane.activeId)"
                        :key="active.id"
                        :content-revision="suggestions.viewKey"
                        :ref="(el) => setPaneElement('source', pane.id, el)"
                        :model-value="suggestions.content"
                        :readonly="suggestions.readonly"
                        :local-native="!!attachments && !suggestions.suggesting"
                        :comment-anchors="commentAnchors[active.id]"
                        @ready="paneEditorReady(pane.id, active!.id, true)"
                        @selection-change="paneSourceSelections[pane.id] = $event"
                        @update:model-value="suggestions.edit($event)"
                        @files="
                          (files, requireImage, position) =>
                            insertSourceFiles(files, position, requireImage, active, pane.id)
                        "
                      />
                      <MarkdownEditor :shortcut-hints="{ delete: shortcutHint('deleteBlock'), 'move-up': shortcutHint('moveBlockUp'), 'move-down': shortcutHint('moveBlockDown'), indent: shortcutHint('indentBlock'), outdent: shortcutHint('outdentBlock') }" :suggestion-marks="suggestions.richMarks" :transform-change="suggestions.transformChange"
                        v-else
                        :custom-callout-icon="CalloutIconPicker"
                        :content-revision="suggestions.viewKey"
                        :key="`${active.id}:${active.id === store.active?.id ? (editing.active?.key ?? 'local') : 'local'}`"
                        :ref="(el) => setPaneEditor(pane.id, el)"
                        :document-id="active.id"
                        :readonly="suggestions.readonly"
                        :open-links-on-tap="touchLayout"
                        :reveal-markdown="suggestions.suggesting ? false : revealMarkdown"
                        :show-document-properties="showDocumentProperties"
                        :capabilities="store.capabilities"
                        :reference-targets="store.referenceTargets"
                        :preferences="editorPreferences"
                        :translate="t"
                        :extension="
                          active.id === store.active?.id ? editing.active?.extension : undefined
                        "
                        :model-value="suggestions.content"
                        :table-layouts="active.tableLayout?.file.tables"
                        :comment-anchors="commentAnchors[active.id]"
                        :resolve-image="
                          (reference) =>
                            attachments
                              ? attachments.imageUrl(workspace, active!.path, reference)
                              : safeRemoteImage(reference)
                        "
                        :resource-revision="resourceRevision"
                        :import-file="
                          attachments && !suggestions.suggesting ? (file, image) => uploadFile(file, image, active) : undefined
                        "
                        @update:model-value="suggestions.edit($event)"
                        @table-layout-change="!suggestions.suggesting && store.editTableLayout(active!.id, $event)"
                        @error="store.report"
                        @ready="paneEditorReady(pane.id, active!.id, false)"
                        @search-change="
                          paneSearchRevisions[pane.id] = (paneSearchRevisions[pane.id] ?? 0) + 1
                        "
                        @open-link="
                          (reference, newTab) => openDocumentLink(reference, newTab, active!.path)
                        "
                        @open-wiki-link="openWikiLink"
                        @open-reference="openReference"
                        @edit-source="setPaneSource(pane.activeId, true)"
                        @selection-change="paneSelections[pane.id] = $event"
                        @blank-block-ai="openBlankBlockAssistant(pane.id, active!.id)"
                      >
                        <template v-if="!suggestions.suggesting && !active.missing && !active.conflict && !active.error" #empty-document>
                          <DocumentStarter :assistant="assistant.available" :assistant-busy="assistant.busy || assistant.applying || assistant.loading"
                            @draft="startDocumentDraft(pane.id, active!.id)"
                            @initialize="quickInitialize(pane.id, active!.id, $event)"
                            @template="chooseInitialTemplate(pane.id, active!.id)" />
                        </template>
                      </MarkdownEditor>
                      <DocumentComments
                        v-if="workspace"
                        v-model:discussion-visible="showDocumentDiscussion"
                        :ref="(el) => setPaneComments(pane.id, el)"
                        :workspace-id="workspace.id"
                        :document="active"
                        :assistant="assistant.available"
                        @assistant="discussWithAssistant(pane.id, active!.id, $event)"
                        :readonly="suggestions.readonly"
                        :author="extensions.commentAuthor?.() ?? { id: 'local', name: t('本机用户') }"
                        :capture-selection="() => capturePaneCommentSelection(pane.id, active!.id)"
                        :focus-anchor="(anchor) => focusPaneComment(pane.id, active!.id, anchor)"
                        :editor-element="paneEditorScrolls.get(pane.id)"
                        :geometry="(anchors) => paneCommentGeometry(pane.id, active!.id, anchors)"
                        @annotations="commentAnchors[active!.id] = $event"
                      />
                      </DocumentSuggestions>
                    </div>
                  </main>
                </div>
                <DocumentScrollbar v-if="!touchLayout" :scroll-element="paneScrolls.get(pane.id)" />
                <AssistantLauncher
                  v-if="assistant.available && !assistant.opened"
                  :scope="paneButterflyScope(pane.id, active!.id)"
                  :shortcut="shortcuts.toggleAssistant"
                  :busy="assistant.busy || assistant.applying"
                  @open="openAssistant(pane.id, active!.id, { forcePanel: true })"
                />
              </div>
            </template>

            <AttachmentPreview
              v-else-if="workspace && pane.activeId.startsWith('attachment:')"
              status-managed
              @status="receiveAttachmentStatus(pane.id, $event)"
              :read-only="!!workspace.readOnly || updateLock || busy"
              :controls-target="isAuxiliaryWindow ? undefined : `#attachment-controls-${pane.id}`"
              :file="tab?.attachment"
              :workspace-id="workspace.id"
              :url="
                attachments && tab?.attachment && fileHandlers.resolve(tab.attachment.path).preview !== 'office'
                  ? attachments.imageUrl(
                      workspace,
                      '',
                      relativeWorkspaceReference('', tab.attachment.path),
                    )
                  : null
              "
            />
            <main
              v-else-if="
                (workspace || startupPending) &&
                pane.activeId !== GRAPH_TAB_ID &&
                pane.activeId !== PLUGINS_TAB_ID &&
                pane.activeId !== CALENDAR_TAB_ID &&
                pane.activeId !== SETTINGS_TAB_ID &&
                !isTableTab(pane.activeId) &&
                !pane.activeId.startsWith('workspace-view:') &&
                !pane.activeId.startsWith('plugin:') &&
                !tab?.workspaceView &&
                !tab?.directory &&
                !tab?.pluginView &&
                !extensionViews.find((view) => view.id === pane.activeId)
              "
              class="workspace-no-tabs"
              :class="{ 'workspace-no-tabs-loading': sessionPending }"
            >
              <DocumentLoading v-if="sessionPending" :unlimited="!limitPageWidth" :touch="touchLayout" :style="{ '--tano-prose-font-family': selectedVisualFontFamily, '--tano-prose-font-size': `${visualFontSize}px` }" />
              <EmptyEditor v-else
                :create-disabled="busy || !workspace || workspace.readOnly || updateLock"
                @create="createNewDocument"
                @open="showModal('newTab')"
                @search="showModal('search')"
              />
            </main>

            <aside
              v-if="
                active &&
                !(assistant.opened && assistant.displayMode === 'sidebar') &&
                !isAuxiliaryWindow &&
                pane.id === store.activePaneId &&
                (panel !== 'outline' || (showOutline && (!touchLayout || touchOutlineOpen)))
              "
              v-outline-motion
              class="inspector"
              :style="panel === 'outline' ? outlinePosition : undefined"
              :class="{
                'inspector-outline': panel === 'outline',
                'inspector-outline-left': panel === 'outline' && outlineOnLeft,
                'inspector-hover-outline':
                  panel === 'outline' && !touchLayout && hoverOutline && !outlinePinned,
                'inspector-activity': panel === 'activity',
              }"
              :aria-label="panel === 'outline' ? t('文档目录') : t('文档动态')"
              @contextmenu="openOutlineContextMenu"
              @pointerleave="releaseOutlinePointerFocus"
            >
              <div class="inspector-surface">
                <div v-if="panel === 'activity'" class="inspector-tabs">
                  <button @click="panel = 'outline'"><List :size="14" />{{ t('大纲') }}</button
                  ><button class="active" @click="panel = 'activity'">
                    <History :size="14" />{{ t('动态') }}
                  </button>
                </div>
                <div v-if="panel === 'outline'" class="outline-controls">
                  <span>{{ t('文档大纲') }}</span>
                  <button v-if="touchLayout" type="button" class="outline-control" :aria-label="t('关闭文档大纲')"
                    @click="touchOutlineOpen = false"><X :size="18" /></button>
                  <button
                    class="outline-control"
                    :class="{ active: outlineAutoCollapse }"
                    type="button"
                    :aria-label="t('自动折叠大纲')"
                    :data-tooltip="t('自动折叠大纲')"
                    :aria-pressed="outlineAutoCollapse"
                    @click="outlineAutoCollapse = !outlineAutoCollapse"
                  >
                    <ListTree :size="15" />
                  </button>
                  <button
                    class="outline-control"
                    :class="{ active: outlineSearchOpen }"
                    type="button"
                    :aria-label="t('搜索大纲标题')"
                    :data-tooltip="t('搜索大纲标题')"
                    :aria-expanded="outlineSearchOpen"
                    @click="toggleOutlineSearch"
                  >
                    <Search :size="15" />
                  </button>
                  <button
                    v-if="hoverOutline"
                    class="outline-control"
                    :class="{ active: outlinePinned }"
                    type="button"
                    :aria-label="outlinePinned ? t('取消固定大纲') : t('固定大纲')"
                    :data-tooltip="outlinePinned ? t('取消固定大纲') : t('固定大纲')"
                    :aria-pressed="outlinePinned"
                    @click="toggleOutlinePin"
                  >
                    <Pin :size="15" :fill="outlinePinned ? 'currentColor' : 'none'" />
                  </button>
                </div>
                <div v-if="panel === 'outline' && outlineSearchOpen" class="outline-search">
                  <Search :size="14" aria-hidden="true" />
                  <input
                    ref="outlineSearchInput"
                    v-model="outlineSearch"
                    type="search"
                    :aria-label="t('搜索当前文档标题')"
                    :placeholder="t('搜索标题')"
                    autocomplete="off"
                    @keydown.enter="visibleOutline[0] && jumpToHeading(visibleOutline[0].index, true)"
                    @keydown.esc.stop.prevent="toggleOutlineSearch"
                  />
                </div>
<DocumentOutline v-if="panel === 'outline'" :items="visibleOutline" :has-headings="!!outline.length" :active-index="activeHeading" @select="jumpToHeading($event, true)" />
                <div v-else class="activity-list">
                  <p class="activity-explainer">{{ t('这个会话中的文件变化。外部编辑者身份暂不可识别。') }}</p>
                  <button v-if="localNative" class="secondary-button" @click="agentPanel = true">
                    <Bot :size="14" />{{ t('工作区指引与 MCP 活动') }}
                  </button>
                  <div v-for="item in activities" :key="item.id" class="activity-item">
                    <span class="activity-icon" :class="item.kind"
                      ><component
                        :is="
                          item.kind === 'conflict'
                            ? AlertTriangle
                            : item.kind === 'external'
                              ? RefreshCw
                              : item.kind === 'save'
                                ? Check
                                : FileText
                        "
                        :size="13"
                    /></span>
                    <div>
                      <strong>{{ item.label }}</strong>
                      <p>{{ item.detail }}</p>
                      <button
                        v-if="item.change"
                        class="activity-diff-button"
                        @click="selectedDiff = { title: item.detail, ...item.change }"
                      >
                        {{ t('查看差异') }}
                      </button>
                      <time>{{
                        new Date(item.time).toLocaleTimeString(uiLocale, {
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      }}</time>
                    </div>
                  </div>
                </div>
                <div v-if="panel === 'activity'" class="inspector-footer">
                  <span class="live-dot" />{{
                    store.isDemo
                      ? t('浏览器本地存储')
                      : store.isWeb
                        ? t('定期检查服务器修改')
                        : t('正在监听工作文件夹')
                  }}
                </div>
              </div>
            </aside>
            </div>
          </div>
        </template>
      </WorkspacePanes>
</template>
