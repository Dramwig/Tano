<script setup lang="ts">
import WindowScope from './windows/WindowScope.vue';
import WorkbenchSettings from './components/WorkbenchSettings.vue';
import AppMenu from './components/AppMenu.vue';
import { provide, proxyRefs, ref, shallowReactive, toRefs } from 'vue';
import { useWorkbench, type WorkbenchProps } from './use-workbench';
import { workbenchContextKey } from './workbench-context';
import WorkbenchPanes from './components/WorkbenchPanes.vue';
import AuxiliaryWindows from './windows/AuxiliaryWindows.vue';

const props = defineProps<WorkbenchProps>();
const emit = defineEmits<{ ready: [] }>();
const context = shallowReactive(proxyRefs(useWorkbench(props, emit)));
provide(workbenchContextKey, context);
const {
  activeWindow,
  native,
  mobile,
  workspace,
  compactPanes,
  isAuxiliaryWindow,
  sidebar,
  t,
  shortcuts,
  toggleSidebar,
  sessionPending,
  tabFileDrag,
  fileDragEnd,
  store,
  createNewDocument,
  detachTab,
  resizingSidebar,
  moveSidebarResize,
  finishSidebarResize,
  butterfly,
  fileMetadataTarget,
  switchingWorkspace,
  mainColumn,
  returnHome,
  sidebarHeaderItems,
  closeButtonVisibilityMenus,
  extensionViews,
  viewActions,
  navigationContext,
  sidebarNavigationItems,
  navigationModule,
  selectModule,
  sidebarView,
  draggedEntry,
  dropFolder,
  dropPlaceholders,
  fileDragOver,
  fileDragLeave,
  fileDrop,
  workspaceView,
  selectWorkspaceView,
  workspaceMenu,
  modal,
  settingsPanel,
  SETTINGS_TAB_ID,
  repositoryActionItems,
  showModal,
  activeId,
  GRAPH_TAB_ID,
  busy,
  openDirectoryContextMenu,
  startupPending,
  filesPending,
  treeFiles,
  revealedHomeId,
  treeDocumentIcons,
  loadTreeDocumentIcon,
  selectedEntryIds,
  fileContextMenu,
  canDragEntry,
  treeRename,
  renameTreeEntry,
  openTreeEntry,
  selectFileTreeEntry,
  openFileContextMenu,
  fileDragStart,
  finishTreeRename,
  noteCount,
  showObjects,
  sidebarCalendarDate,
  openCalendar,
  showPlanEvent,
  multipleContextEntries,
  contextEntries,
  fileContextKeydown,
  localNative,
  selectionDeleteDisabled,
  fileContextAction,
  shortcutHint,
  contextFolderHome,
  folderHomeContextAction,
  fileMutationDisabled,
  directoryHasManagedFile,
  isMarkdown,
  isDataTableFilePath,
  attachments,
  tabsEnabled,
  canDuplicateEntry,
  isWorkspaceInternalPath,
  folderConversionIssue,
  convertDocumentStructure,
  closeFileContextMenu,
  fileDeleteDisabled,
  directoryContextMenu,
  directoryContextAction,
  directoryContextDuplicateDisabled,
  directoryContextRenameDisabled,
  directoryContextDeleteDisabled,
  workspaceEntryContextMenu,
  workspaceEntryContextKeydown,
  workspaceEntryContextAction,
  toggleWorkspaceMenu,
  ChevronUp,
  ChevronDown,
  workspaceDropdownContextMenu,
  selectContext,
  extensions,
  WorkspaceMenuLayout,
  extensionActions,
  commandPaletteOpened,
  openSystemSync,
  openImport,
  openTemplateLibrary,
  openSettings,
  updates,
  recyclePanel,
  agentPanel,
  createNewWorkspace,
  openWorkspaceEntryContextMenu,
  helpContext,
  helpAvailability,
  helpBlocked,
  documentationBaseUrl,
  menu,
  openExternalUrl,
  sidebarWidth,
  defaultSidebarWidth,
  SIDEBAR_MIN_WIDTH,
  sidebarWidthLimit,
  startSidebarResize,
  resizeSidebarWithKeyboard,
  referenceGraphTarget,
  referenceGraphOpened,
  referenceGraphAnchor,
  openReference,
  assistantTab,
  homeContent,
  CALENDAR_TAB_ID,
  calendarDate,
  calendarMode,
  plans,
  calendarScope,
  selectCalendarMode,
  showCalendarDay,
  showCalendarMonth,
  homeExtension,
  inlineAssistant,
  inlineAssistantPrompt,
  inlineAssistantState,
  inlineRunner,
  inlineAssistantError,
  inlineAssistantMessage,
  submitInlineAssistant,
  continueInlineConversation,
  undoInlineAssistant,
  closeInlineAssistant,
  pageContextMenu,
  pageContextKeydown,
  workspaceLocked,
  editorPreferences,
  showPageTitle,
  showDocumentProperties,
  showOutline,
  showAllLineNumbers,
  paneSource,
  togglePageOption,
  toggleWorkspaceLock,
  outlineContextMenu,
  outlineContextKeydown,
  outlineOnLeft,
  toggleOutlineSide,
  importPanel,
  importRecords,
  systemSyncPanel,
  workspaceSync,
  selectedDiff,
  historyPanel,
  active,
  activities,
  historyPage,
  importObjectAssets,
  objectPanelMounted,
  objectPanel,
  selectedObjectId,
  selectedResourceIdentity,
  selectedPersonal,
  assetImportBusy,
  assetPreview,
  openObjectResource,
  openObjectReference,
  assetInput,
  planDetail,
  openPlanReference,
  selectionTodo,
  workbenchCommands,
  settingsWorkspace,
  openingSettingsWindow,
  openSettingsTab,
  openSettingsInNewWindow,
  settingsPage,
  settingsContext,
  workspaceExporting,
  workspaceExportError,
  workspaceDeletionError,
  deleteWorkspace,
  exportWorkspace,
  defaultSource,
  theme,
  appearance,
  appearanceController,
  visualFontChoice,
  customFontName,
  splitFontSettings,
  revealMarkdown,
  toolbarMode,
  showDocumentDiscussion,
  visualFontSize,
  sourceFontSize,
  appVersion,
  assistant,
  settingsAction,
  fatal,
  createNewEntry,
  modalBusy,
  updateLock,
  modalTitle,
  input,
  searchResults,
  openSearchResult,
  searchHighlightParts,
  searchResultLocation,
  searching,
  searchError,
  submitModal,
  modalDeleteEntries,
  modalTarget,
  modalError,
  AppTooltip,
  PanelLeftOpen,
  DesktopTabs,
  AssistantButterflyLayer,
  FileMetadataPanel,
  ButtonVisibilityGroup,
  CalendarDays,
  SidebarNavigation,
  PluginExplorer,
  PluginView,
  WorkspaceViewSwitcher,
  Search,
  GitFork,
  SquarePen,
  FileTree,
  LoadingSkeleton,
  Table2,
  SidebarAssistant,
  SidebarPlan,
  CopyPlus,
  Route,
  FolderTree,
  Trash2,
  ShortcutHint,
  House,
  FilePlus2,
  FolderPlus,
  TextCursorInput,
  FileText,
  Paperclip,
  PanelsTopLeft,
  Link,
  FileOutput,
  AppWindow,
  FolderSearch,
  EyeOff,
  Eye,
  FileSymlink,
  FileSliders,
  Blocks,
  PluginMenu,
  ArrowDownToLine,
  FolderOpen,
  Check,
  WorkspaceIcon,
  RefreshCw,
  Files,
  CircleHelp,
  Bot,
  OpenWorkspaceIcon,
  HelpLauncher,
  SidebarUpdateButton,
  WorkspaceSidebar,
  ReferenceGraphPopover,
  WorkspacePanes,
  CalendarView,
  InlineAssistantInput,
  PageDisplayOptions,
  ImportPanel,
  WorkspaceSyncPanel,
  MobileRecycle,
  AgentPanel,
  DiffDialog,
  DocumentHistoryPanel,
  ObjectPanel,
  PlanDetailPanel,
  SelectionTodoDialog,
  CommandPalette,
  SettingsPanel,
  AlertTriangle,
  X,
  NewTabPicker,
  LoaderCircle,
  ArrowRight,
  vScrollFade,
  vSurfaceMotion,
} = toRefs(context);
// The brand icon opens the self-drawn application menu on desktop; the web build keeps it as a home link.
const appMenuOpen = ref(false);
const brandButton = ref<HTMLElement | null>(null);
</script>

<template>
  <AuxiliaryWindows v-if="native && !mobile" />
  <AppTooltip />
  <Teleport v-if="native && !mobile && workspace && compactPanes" to="#desktop-window-tab-slot">
    <button
      v-if="!isAuxiliaryWindow"
      :class="{ 'desktop-sidebar-toggle-hidden': sidebar }"
      class="desktop-sidebar-toggle icon-button"
      type="button"
      :aria-label="t('展开侧栏')"
      :data-tooltip="t('展开侧栏')" :data-tooltip-shortcut="shortcuts.toggleSidebar"
      :aria-hidden="sidebar"
      :tabindex="sidebar ? -1 : 0"
      :disabled="sidebar"
      @click="toggleSidebar"
    >
      <PanelLeftOpen :size="16" :stroke-width="1.6" />
    </button>
    <DesktopTabs
      :loading="sessionPending"
      detachable
      :file-drag="tabFileDrag"
      @files-dropped="fileDragEnd"
      @new-tab="store.createBlankTab()"
      @new-document="createNewDocument"
      @detach-tab="detachTab"
    />
  </Teleport>
  <div
    class="app-shell"
    @pointermove="moveSidebarResize"
    @pointerup="finishSidebarResize"
    @pointercancel="finishSidebarResize"
    @lostpointercapture="finishSidebarResize"
    :class="{
      'sidebar-hidden': isAuxiliaryWindow || !sidebar,
      'detached-window': isAuxiliaryWindow,
      'sidebar-resizing': resizingSidebar,
      'workspace-empty': !workspace,
    }"
  >
    <!-- Liquid glass draws its rim refraction and highlights here, under everything (liquid-glass.ts). -->
    <div class="liquid-backdrop" aria-hidden="true"></div>
    <Teleport :to="activeWindow.overlays"><WindowScope :key="activeWindow.id" :context="activeWindow"><AssistantButterflyLayer :controller="butterfly" /></WindowScope></Teleport>
    <Teleport :to="activeWindow.overlays">
      <WindowScope :key="activeWindow.id" :context="activeWindow">
        <AppMenu
          v-if="appMenuOpen && brandButton"
          :commands="workbenchCommands"
          :anchor="brandButton"
          :palette-hint="shortcutHint('commandPalette')"
          :open-palette="() => { commandPaletteOpened = true; }"
          :close-window="activeWindow.native ? () => activeWindow.native!.close() : undefined"
          @close="appMenuOpen = false"
        />
      </WindowScope>
    </Teleport>
    <Teleport :to="activeWindow.overlays"><FileMetadataPanel v-if="fileMetadataTarget && !switchingWorkspace" v-bind="fileMetadataTarget" @close="fileMetadataTarget = null" /></Teleport>
    <Transition name="sidebar-dismiss">
      <button
        v-if="sidebar && !isAuxiliaryWindow && compactPanes"
        class="sidebar-dismiss"
        :aria-label="t('收起侧栏')"
        @click="toggleSidebar"
      />
    </Transition>
    <WorkspaceSidebar
      v-if="!isAuxiliaryWindow"
      :open="sidebar"
      :compact="compactPanes"
      :content-element="mainColumn"
      @dismiss="sidebar = false"
    >
        <div class="sidebar-header">
          <div class="sidebar-brand-slot">
            <button
              v-if="native && !mobile"
              ref="brandButton"
              type="button"
              class="brand brand-menu-button"
              aria-haspopup="menu"
              :aria-expanded="appMenuOpen"
              :aria-label="t('同页')"
              @click="appMenuOpen = !appMenuOpen"
            >
              <img src="./assets/tano-logo.svg" alt="" />
            </button>
            <component
              :is="native ? 'div' : 'a'"
              v-else
              class="brand"
              :href="native ? undefined : '/'"
              :aria-label="native ? undefined : t('返回同页首页')"
              @click="returnHome"
            >
              <img src="./assets/tano-logo.svg" alt="" />
            </component>
          </div>
          <ButtonVisibilityGroup
            v-slot="{ isVisible }"
            :items="sidebarHeaderItems"
            :active="sidebar"
            preference-key="tano.preference.sidebarHiddenHeaderActions"
            group-class="sidebar-header-actions"
            :label="t('侧栏顶部按钮')"
            :menu-label="t('侧栏顶部按钮显示设置')"
            @open="closeButtonVisibilityMenus"
          >
            <template v-if="navigationModule === 'workspace'">
              <button
                v-if="isVisible('search')"
                type="button"
                class="icon-button"
                :aria-label="t('查找文档')"
                :data-tooltip="t('查找文档')" :data-tooltip-shortcut="shortcuts.findDocument"
                :disabled="!workspace"
                @click="showModal('search')"
              >
                <Search :size="16" :stroke-width="1.6" />
              </button>
              <button
                v-if="store.workspaceSettings.showGraph && isVisible('graph')"
                type="button"
                class="icon-button"
                :aria-label="t('打开关系图谱')"
                :data-tooltip="t('关系图谱')"
                :aria-pressed="activeId === GRAPH_TAB_ID"
                :disabled="!workspace"
                @click="store.openGraphTab()"
              >
                <GitFork :size="16" :stroke-width="1.6" />
              </button>
            </template>
            <template v-for="view in extensionViews" :key="`header-${view.id}`">
              <component
                :is="view.header"
                v-if="(view.scope === 'account' || store.workspaceSettings.showCollaborationViews) && view.header && isVisible(view.id)"
                :actions="viewActions[view.id]"
              />
            </template>
          </ButtonVisibilityGroup>
        </div>
        <SidebarNavigation
          v-if="navigationContext === 'home'"
          v-slot="{ isVisible }"
          :items="sidebarNavigationItems"
          :active="sidebar"
          @open="closeButtonVisibilityMenus"
        >
          <button
            type="button"
            class="sidebar-navigation-button"
            :aria-label="t('计划')"
            :data-tooltip="t('计划')"
            aria-controls="sidebar-plan-panel"
            :aria-pressed="navigationModule === 'plan'"
            @click="selectModule('plan')"
          >
            <CalendarDays :size="18" :stroke-width="1.6" aria-hidden="true" />
            <span :aria-hidden="navigationModule !== 'plan'"><span>{{ t('计划') }}</span></span>
          </button>
          <template v-for="view in extensionViews" :key="view.id">
            <button
              v-if="store.workspaceSettings.showCollaborationViews && view.sidebar && isVisible(view.id)"
              type="button"
              class="sidebar-navigation-button"
              :aria-label="view.label"
              :data-tooltip="view.label"
              :aria-controls="`sidebar-${view.id}`"
              :aria-pressed="sidebarView === view.id"
              @click="selectModule(view.id)"
            >
              <component :is="view.icon" :size="18" :stroke-width="1.6" aria-hidden="true" />
              <span :aria-hidden="sidebarView !== view.id"><span>{{ view.label }}</span></span>
            </button>
          </template>
        </SidebarNavigation>
          <div v-show="navigationModule === 'workspace'" class="sidebar-view-header">
            <WorkspaceViewSwitcher
              :model-value="workspaceView"
              @update:model-value="selectWorkspaceView"
              :active="sidebar && !workspaceMenu && !modal && !settingsPanel"
              @open="closeButtonVisibilityMenus"
            />
          </div>
          <!-- Workspace root row: names the tree it heads, accepts root drops and owns file-tree actions. -->
          <div
            v-show="navigationModule === 'workspace' && sidebarView === 'repository'"
            class="section-label workspace-root-header"
            :class="{ 'drop-target': draggedEntry && dropFolder === '' }"
            @dragover="fileDragOver('', $event)"
            @dragleave="fileDragLeave('', $event)"
            @drop="fileDrop('', $event)"
            @contextmenu.self.prevent="openDirectoryContextMenu('', $event)"
          >
            <span
              class="workspace-root-name"
              :title="draggedEntry ? undefined : workspace?.name"
              @contextmenu.prevent="openDirectoryContextMenu('', $event)"
            >{{ draggedEntry ? t('放到工作区根目录') : (workspace?.name ?? '') }}</span>
            <ButtonVisibilityGroup
              v-slot="{ isVisible }"
              v-show="!draggedEntry"
              :items="repositoryActionItems"
              :active="sidebar && sidebarView === 'repository'"
              preference-key="tano.preference.repositoryHiddenActions"
              group-class="repository-actions"
              :label="t('工作区按钮')"
              :menu-label="t('工作区按钮显示设置')"
              @open="closeButtonVisibilityMenus"
            >
              <button
                v-if="isVisible('create')"
                type="button"
                class="icon-button"
                :aria-label="t('新建文档')"
                :data-tooltip="t('新建文档')" :data-tooltip-shortcut="shortcuts.newDocument"
                :disabled="!workspace || workspace.readOnly || busy"
                @click="createNewDocument"
              >
                <SquarePen :size="15" :stroke-width="1.6" />
              </button>
              <button
                v-if="isVisible('folder')"
                type="button"
                class="icon-button"
                :aria-label="t('新建文件夹')"
                :data-tooltip="t('新建文件夹')"
                :disabled="!workspace || workspace.readOnly || busy"
                @click="createNewEntry('folder')"
              >
                <FolderPlus :size="15" :stroke-width="1.6" />
              </button>
            </ButtonVisibilityGroup>
          </div>
        <PluginExplorer v-if="sidebarView === 'plugin-views'" />
        <PluginView v-else-if="sidebarView.startsWith('plugin-sidebar:')" :view-key="sidebarView.slice(15)" />
        <div
          v-show="sidebarView === 'repository'"
          id="sidebar-repository-panel"
          class="sidebar-content"
        >
          <div
            v-scroll-fade
            class="tree-scroll"
            :class="{ 'drop-root': draggedEntry && dropFolder === '' && !dropPlaceholders.length }"
            @contextmenu.self.prevent="openDirectoryContextMenu('', $event)"
            @dragover.self="fileDragOver('', $event)"
            @dragleave.self="fileDragLeave('', $event)"
            @drop.self="fileDrop('', $event)"
          >
            <FileTree
              ref="fileTree"
              v-if="workspace || startupPending || filesPending"
              :loading="filesPending"
              :entries="treeFiles"
              :folder-home-file-name="store.workspaceSettings.folderHomeFileName"
              :revealed-home-id="revealedHomeId"
              :document-icons="treeDocumentIcons"
              :load-document-icon="loadTreeDocumentIcon"
              :selected-ids="selectedEntryIds"
              :context-selected="fileContextMenu?.file.id"
              :dragged-id="draggedEntry?.file.id"
              :drop-target="dropFolder"
              :drop-preview="dropPlaceholders"
              :can-drag="canDragEntry"
              :renaming-id="treeRename?.fileId"
              :rename-entry="renameTreeEntry"
              @open="openTreeEntry"
              @select="selectFileTreeEntry"
              @prefetch="store.prefetchFile"
              @context="openFileContextMenu"
              @context-blank="openDirectoryContextMenu"
              @drag-start="fileDragStart"
              @drag-end="fileDragEnd"
              @drag-over="fileDragOver"
              @drag-leave="fileDragLeave"
              @drop="fileDrop"
              @rename-finished="finishTreeRename"
            />
            <div
              v-if="!filesPending && !noteCount"
              class="tree-empty"
              @contextmenu.prevent="openDirectoryContextMenu('', $event)"
            >
              {{ t('你的下一页，') }}<br />{{ t('从一个新文档开始。') }}
            </div>
          </div>
        </div>
        <SidebarAssistant v-if="sidebarView === 'assistant'" @open="compactPanes && (sidebar = false)" />
        <SidebarPlan
          v-show="sidebarView === 'plan' || sidebarView === 'events'"
          :active="sidebar && (sidebarView === 'plan' || sidebarView === 'events')"
          :workspace-only="navigationContext === 'workspace'"
          id="sidebar-plan-panel"
          :date="sidebarCalendarDate"
          @select-date="openCalendar"
          @select-event="showPlanEvent"
        />
        <template v-for="view in extensionViews" :key="view.id">
          <div
            v-if="view.sidebar"
            v-show="sidebarView === view.id"
            :id="`sidebar-${view.id}`"
            class="extension-sidebar"
          >
            <component :is="view.sidebar" :actions="viewActions[view.id]" />
          </div>
        </template>
        <Teleport :to="activeWindow.overlays">
          <div v-surface-motion="'App:0'"
            v-if="fileContextMenu"
            class="dropdown compact-action-menu file-context-menu"
            role="menu"
            tabindex="-1"
            :aria-label="
              multipleContextEntries
                ? t('{0} 个条目操作', [contextEntries.length])
                : t('{0} 操作', [fileContextMenu.file.name])
            "
            :style="{ left: `${fileContextMenu.x}px`, top: `${fileContextMenu.y}px` }"
            @keydown="fileContextKeydown"
          >
            <template v-if="multipleContextEntries">
              <div class="file-context-count" role="presentation">
                {{ t('已选中') }} {{ contextEntries.length }} {{ t('个条目') }}
              </div>
              <button
                v-if="!mobile && localNative"
                role="menuitem"
                :disabled="selectionDeleteDisabled"
                @click="fileContextAction('duplicate')"
              >
                <CopyPlus :size="15" />{{ t('为所选条目创建副本') }}
              </button>
              <div v-if="!mobile && localNative" class="menu-divider" role="separator" />
              <button role="menuitem" @click="fileContextAction('copy')">
                <Route :size="15" />{{ t('复制相对路径') }}
              </button>
              <button
                v-if="localNative && !mobile"
                role="menuitem"
                @click="fileContextAction('copy-full-path')"
              >
                <FolderTree :size="15" />{{ t('复制完整路径') }}
              </button>
              <div class="menu-divider" role="separator" />
              <button
                class="danger-text"
                role="menuitem"
                :disabled="selectionDeleteDisabled"
                @click="fileContextAction('delete')"
              >
                <Trash2 :size="15" />{{
                  store.isDemo
                    ? t('删除所选条目')
                    : store.isWeb
                      ? t('删除所选文档')
                      : t('将所选条目移入回收站')
                }}
              <kbd class="menu-shortcut" aria-hidden="true"><ShortcutHint :label="shortcutHint('deleteFile')" /></kbd></button>
            </template>
            <template v-else>
              <!-- Open actions precede editing and organization. -->
              <template v-if="fileContextMenu.file.kind === 'directory'">
                <template v-if="contextFolderHome">
                  <button role="menuitem" @click="folderHomeContextAction(false)">
                    <House :size="15" />{{ t('打开首页') }}
                  </button>
                  <div class="menu-divider" role="separator" />
                </template>
                <button
                  role="menuitem"
                  :disabled="fileMutationDisabled(fileContextMenu.file)"
                  @click="fileContextAction('document')"
                >
                  <FilePlus2 :size="15" />{{ t('在此新建文档') }}
                </button>
                <button
                  role="menuitem"
                  :disabled="fileMutationDisabled(fileContextMenu.file)"
                  @click="fileContextAction('folder')"
                >
                  <FolderPlus :size="15" />{{ t('在此新建文件夹') }}
                </button>
                <button
                  role="menuitem"
                  :disabled="
                    fileMutationDisabled(fileContextMenu.file) || directoryHasManagedFile(fileContextMenu.file)
                  "
                  @click="fileContextAction('rename')"
                >
                  <TextCursorInput :size="15" />{{ t('重命名文件夹') }}
                  <kbd class="menu-shortcut" aria-hidden="true"><ShortcutHint :label="shortcutHint('renameFile')" /></kbd>
                </button>
              </template>
              <template v-else>
                <button
                  v-if="
                    isMarkdown(fileContextMenu.file.path) ||
                    isDataTableFilePath(fileContextMenu.file.path) ||
                    attachments
                  "
                  role="menuitem"
                  @click="fileContextAction('open')"
                >
                  <Table2 v-if="isDataTableFilePath(fileContextMenu.file.path)" :size="15" />
                  <FileText v-else-if="isMarkdown(fileContextMenu.file.path)" :size="15" />
                  <Paperclip v-else :size="15" />{{
                    isDataTableFilePath(fileContextMenu.file.path)
                      ? t('打开数据表')
                      : isMarkdown(fileContextMenu.file.path)
                        ? t('打开文档')
                        : t('打开附件')
                  }}
                </button>
                <button
                  v-if="
                    tabsEnabled &&
                    (isMarkdown(fileContextMenu.file.path) || isDataTableFilePath(fileContextMenu.file.path))
                  "
                  role="menuitem"
                  @click="fileContextAction('open-new-tab')"
                >
                  <PanelsTopLeft :size="15" />{{ t('在新标签页中打开') }}
                </button>
                <div
                  v-if="isMarkdown(fileContextMenu.file.path) || isDataTableFilePath(fileContextMenu.file.path) || attachments"
                  class="menu-divider"
                  role="separator"
                />
                <button
                  v-if="isMarkdown(fileContextMenu.file.path)"
                  role="menuitem"
                  :disabled="fileMutationDisabled(fileContextMenu.file)"
                  @click="fileContextAction('rename')"
                >
                  <TextCursorInput :size="15" />{{ t('重命名文档') }}
                  <kbd class="menu-shortcut" aria-hidden="true"><ShortcutHint :label="shortcutHint('renameFile')" /></kbd>
                </button>
                <button
                  v-else-if="attachments || isDataTableFilePath(fileContextMenu.file.path)"
                  role="menuitem"
                  :disabled="fileMutationDisabled(fileContextMenu.file)"
                  @click="fileContextAction('rename')"
                >
                  <TextCursorInput :size="15" />{{ t('重命名文件') }}
                  <kbd class="menu-shortcut" aria-hidden="true"><ShortcutHint :label="shortcutHint('renameFile')" /></kbd>
                </button>
              </template>
              <button
                v-if="canDuplicateEntry(fileContextMenu.file)"
                role="menuitem"
                :disabled="fileMutationDisabled(fileContextMenu.file)"
                @click="fileContextAction('duplicate')"
              >
                <CopyPlus :size="15" />{{ t('创建副本') }}
              </button>
              <button
                v-if="fileContextMenu.file.kind === 'file' && isMarkdown(fileContextMenu.file.path) && !isWorkspaceInternalPath(fileContextMenu.file.path)"
                role="menuitem"
                :disabled="
                  fileMutationDisabled(fileContextMenu.file) || !!folderConversionIssue(fileContextMenu.file, 'child')
                "
                :data-tooltip="
                  folderConversionIssue(fileContextMenu.file, 'child') ||
                  t('将此文档作为文件夹首页，并新建子文档；相关链接会同步更新。')
                "
                @click="convertDocumentStructure('child')"
              >
                <FolderPlus :size="15" />{{ t('新建子文档') }}
              </button>
              <div class="menu-divider" role="separator" />
              <!-- Copy and export. -->
              <button role="menuitem" @click="fileContextAction('copy')">
                <Route :size="15" />{{ t('复制相对路径') }}
              </button>
              <button
                v-if="
                  store.isWeb &&
                  fileContextMenu.file.kind === 'file' &&
                  (isMarkdown(fileContextMenu.file.path) || isDataTableFilePath(fileContextMenu.file.path))
                "
                role="menuitem"
                @click="fileContextAction('copy-link')"
              >
                <Link :size="15" />{{ t('复制链接') }}
              </button>
              <button v-if="localNative && !mobile" role="menuitem" @click="fileContextAction('copy-full-path')">
                <FolderTree :size="15" />{{
                  fileContextMenu.file.kind === 'directory' ? t('复制文件夹路径') : t('复制文件路径')
                }}
              </button>
              <template v-if="fileContextMenu.file.kind === 'file'">
                <button
                  v-if="attachments && !isWorkspaceInternalPath(fileContextMenu.file.path)"
                  role="menuitem"
                  @click="fileContextAction('export')"
                >
                  <FileOutput :size="15" />{{ t('导出文件副本') }}
                </button>
              </template>
              <!-- System actions stay together before file information. -->
              <template v-if="localNative && !mobile">
                <div class="menu-divider" role="separator" />
                <button role="menuitem" @click="fileContextAction('open-default')">
                  <AppWindow :size="15" />{{ t('使用默认应用打开') }}
                </button>
                <button role="menuitem" @click="fileContextAction('reveal-entry')">
                  <FolderSearch :size="15" />{{ t('在系统资源管理器中显示') }}
                </button>
              </template>
              <!-- File information and less frequent folder structure actions. -->
              <template v-if="fileContextMenu.file.kind === 'directory'">
                <div class="menu-divider" role="separator" />
                <template v-if="contextFolderHome">
                  <button role="menuitem" @click="folderHomeContextAction(true)">
                    <EyeOff v-if="revealedHomeId === contextFolderHome.id" :size="15" />
                    <Eye v-else :size="15" />{{ t(revealedHomeId === contextFolderHome.id ? '隐藏首页文件' : '显示首页文件') }}
                  </button>
                  <button
                    role="menuitem"
                    :disabled="
                      fileMutationDisabled(fileContextMenu.file) ||
                      !!folderConversionIssue(fileContextMenu.file, 'flatten')
                    "
                    :data-tooltip="
                      folderConversionIssue(fileContextMenu.file, 'flatten') ||
                      t('仅首页会移出，空文件夹将被移除，相关链接会同步更新。')
                    "
                    @click="convertDocumentStructure('flatten')"
                  >
                    <FileSymlink :size="15" />{{ t('转为普通文档') }}
                  </button>
                </template>
              </template>
              <template v-else-if="!isWorkspaceInternalPath(fileContextMenu.file.path)">
                <div class="menu-divider" role="separator" />
                <button
                  v-if="!isWorkspaceInternalPath(fileContextMenu.file.path)"
                  role="menuitem"
                  @click="fileContextAction('metadata')"
                >
                  <FileSliders :size="15" />{{ t('文件属性') }}
                </button>
                <button
                  v-if="!isWorkspaceInternalPath(fileContextMenu.file.path)"
                  role="menuitem"
                  @click="fileContextAction('object')"
                >
                  <Blocks :size="15" />{{ t('查看文件对象') }}
                </button>
              </template>
              <PluginMenu
                v-if="fileContextMenu.file.kind === 'file'"
                location="file"
                :file-id="fileContextMenu.file.id"
                @selected="closeFileContextMenu()"
              />
              <template v-if="!fileDeleteDisabled(fileContextMenu.file) || !store.isWeb">
                <div class="menu-divider" role="separator" />
                <button
                  class="danger-text"
                  role="menuitem"
                  :disabled="fileDeleteDisabled(fileContextMenu.file)"
                  @click="fileContextAction('delete')"
                >
                  <Trash2 :size="15" />{{
                    store.isDemo
                      ? t('删除')
                      : store.isWeb
                        ? fileContextMenu.file.kind === 'directory'
                          ? t('删除在线文件夹')
                          : t('删除在线文档')
                        : t('移入回收站')
                  }}
                  <kbd class="menu-shortcut" aria-hidden="true"><ShortcutHint :label="shortcutHint('deleteFile')" /></kbd>
                </button>
              </template>
            </template>
          </div>
        </Teleport>
        <Teleport :to="activeWindow.overlays">
          <div v-surface-motion="'App:1'"
            v-if="directoryContextMenu"
            class="dropdown compact-action-menu file-context-menu directory-context-menu"
            role="menu"
            tabindex="-1"
            :aria-label="t('目录操作')"
            :style="{ left: `${directoryContextMenu.x}px`, top: `${directoryContextMenu.y}px` }"
            @keydown="fileContextKeydown"
          >
            <button
              role="menuitem"
              :disabled="!workspace || workspace.readOnly || busy"
              @click="directoryContextAction('document')"
            >
              <FilePlus2 :size="15" />{{ t('新建文档') }}
            </button>
            <button
              role="menuitem"
              :disabled="!workspace || workspace.readOnly || busy"
              @click="directoryContextAction('folder')"
            >
              <FolderPlus :size="15" />{{ t('新建文件夹') }}
            </button>
            <button
              v-if="!directoryContextMenu.parent"
              role="menuitem"
              :disabled="!workspace || workspace.readOnly || busy"
              @click="directoryContextAction('import')"
            >
              <ArrowDownToLine :size="15" />{{ t('导入') }}
            </button>
            <template v-if="directoryContextMenu.parent">
              <button
                role="menuitem"
                :disabled="directoryContextDuplicateDisabled()"
                @click="directoryContextAction('duplicate')"
              >
                <CopyPlus :size="15" />{{ t('创建副本') }}
              </button>
              <button role="menuitem" @click="directoryContextAction('copy')">
                <Route :size="15" />{{ t('复制相对路径') }}
              </button>
              <div class="menu-divider" role="separator" />
              <button
                role="menuitem"
                :disabled="directoryContextRenameDisabled()"
                @click="directoryContextAction('rename')"
              >
                <TextCursorInput :size="15" />{{ t('重命名文件夹') }}
              <kbd class="menu-shortcut" aria-hidden="true"><ShortcutHint :label="shortcutHint('renameFile')" /></kbd></button>
              <button
                class="danger-text"
                role="menuitem"
                :disabled="directoryContextDeleteDisabled()"
                @click="directoryContextAction('delete')"
              >
                <Trash2 :size="15" />{{
                  store.isDemo ? t('删除文件夹') : store.isWeb ? t('删除在线文件夹') : t('将文件夹移入回收站')
                }}
              <kbd class="menu-shortcut" aria-hidden="true"><ShortcutHint :label="shortcutHint('deleteFile')" /></kbd></button>
            </template>
          </div>
        </Teleport>
        <Teleport :to="activeWindow.overlays">
          <div v-surface-motion="'App:2'"
            v-if="workspaceEntryContextMenu"
            ref="workspaceEntryContextMenuElement"
            class="dropdown compact-action-menu file-context-menu workspace-entry-context-menu"
            role="menu"
            tabindex="-1"
            :aria-label="t('{0} 工作区操作', [workspaceEntryContextMenu.item.name])"
            :style="{ left: `${workspaceEntryContextMenu.x}px`, top: `${workspaceEntryContextMenu.y}px` }"
            @keydown="workspaceEntryContextKeydown"
          >
            <button
              role="menuitem"
              :disabled="busy"
              @click="workspaceEntryContextAction('open')"
            >
              <FolderOpen :size="15" />{{ t('打开工作区') }}
              <Check
                v-if="workspaceEntryContextMenu.item.id === workspace?.id"
                class="workspace-entry-context-check"
                :size="14"
              />
            </button>
            <template v-if="workspaceEntryContextMenu.item.id === workspace?.id">
              <button
                v-if="localNative && !mobile"
                role="menuitem"
                :disabled="busy"
                @click="workspaceEntryContextAction('reveal')"
              >
                <FolderSearch :size="15" />{{ t('在资源管理器中显示') }}
              </button>
            </template>
          </div>
        </Teleport>
        <div class="sidebar-bottom">
          <div class="workspace-picker-wrap">
            <button
              class="workspace-picker"
              :aria-expanded="workspaceMenu"
              aria-controls="workspace-menu"
              :aria-label="filesPending ? t('正在打开工作区…') : t('切换上下文：{0}', [navigationContext === 'home' ? t('主页') : workspace?.name ?? t('选择工作区')])"
              :data-tooltip="filesPending ? t('正在打开工作区…') : navigationContext === 'home' ? t('主页') : workspace?.name ?? t('选择工作区')"
              @click="toggleWorkspaceMenu"
              @contextmenu.stop.prevent="toggleWorkspaceMenu"
            >
              <span class="workspace-avatar"><House v-if="navigationContext === 'home'" :size="15" /><WorkspaceIcon v-else :icon="store.workspaceSettings.icon" :mode="store.isDemo ? 'demo' : store.isWeb ? 'web' : 'local'" :size="15" /></span>
              <span class="workspace-picker-text"
                ><span v-if="filesPending" class="tano-skeleton-bar" /><strong v-else>{{ navigationContext === 'home' ? t('主页') : workspace?.name ?? t('选择工作区') }}</strong></span
              >
              <component :is="workspaceMenu ? ChevronUp : ChevronDown" :size="12" />
            </button>
            <div v-surface-motion="'App:3'"
              v-if="workspaceMenu"
              id="workspace-menu"
              class="dropdown compact-action-menu sidebar-popover workspace-dropdown"
              @contextmenu.stop.prevent="workspaceDropdownContextMenu"
            >
              <button class="context-menu-item" type="button" :aria-current="navigationContext === 'home' ? 'true' : undefined" @click="selectContext('home')"><House :size="16" /><span class="recent-name">{{ t('主页') }}</span><Check v-if="navigationContext === 'home'" :size="15" /></button>
              <div class="menu-divider" />
              <PluginMenu location="workspace" @selected="workspaceMenu = false" />
              <component
                :is="extensions.regions['workspace-menu-layout'] ?? WorkspaceMenuLayout"
                :navigation-context="navigationContext"
                @select-workspace="selectContext('workspace')"
                :actions="extensionActions"
              >
              <template v-if="extensions.regions['workspace-settings']" #settings>
              <component
                :is="extensions.regions['workspace-settings']"
                :actions="extensionActions"
              />
              </template>
              <template #default>
              <button role="menuitem" @click="workspaceMenu = false; commandPaletteOpened = true">
                <Search :size="16" />{{ t('命令中心') }}<span class="menu-shortcut"><ShortcutHint :label="shortcutHint('commandPalette')" /></span>
              </button>
              <component
                :is="extensions.regions['workspace-settings']"
                v-if="extensions.regions['workspace-menu-layout'] && extensions.regions['workspace-settings']"
                :actions="extensionActions"
              />
              <button v-if="workspace && native && !mobile && !store.isWeb" role="menuitem" @click="openSystemSync()"><RefreshCw :size="16" />{{ t('Git 与同步') }}</button>
              <button v-if="workspace" role="menuitem" :disabled="workspace.readOnly || busy" @click="openImport">
                <ArrowDownToLine :size="16" />{{ t('导入') }}
              </button>
              <button
                v-if="workspace"
                role="menuitem"
                :disabled="workspace.readOnly || busy"
                @click="
                  workspaceMenu = false;
                  openTemplateLibrary();
                "
              >
                <Files :size="16" />{{ t('文档模板') }}
              </button>
              <button role="menuitem" @click="showObjects()"><Blocks :size="16" />{{ t('工作区对象') }}</button>
              <button role="menuitem" @click="openSettings('about')">
                <CircleHelp :size="16" />{{ t('关于 Tano / 同页') }}{{
                  updates.state.candidate ? t(' · 有新版本') : ''
                }}
              </button>
              <div v-if="extensions.regions['account-note']" class="menu-divider" />
              <component
                :is="extensions.regions['account-note']"
                v-if="extensions.regions['account-note']"
                :actions="extensionActions"
              />
              <div
                v-if="
                  extensions.regions['mode-switch'] ||
                  workspace ||
                  extensions.regions['workspace-history'] ||
                  extensions.regions['sign-out']
                "
                class="menu-divider"
              />
              <component
                :is="extensions.regions['mode-switch']"
                v-if="extensions.regions['mode-switch']"
                :actions="extensionActions"
              />
              <button
                v-if="mobile && workspace"
                role="menuitem"
                @click="
                  workspaceMenu = false;
                  recyclePanel = true;
                "
              >
                <Trash2 :size="16" />{{ t('手机回收站') }}
              </button>
              <button
                v-if="workspace"
                role="menuitem"
                @click="
                  workspaceMenu = false;
                  agentPanel = true;
                "
              >
                <Bot :size="16" />{{ t('与 Agent 一起工作') }}
              </button>
              <component
                :is="extensions.regions['workspace-history']"
                v-if="extensions.regions['workspace-history']"
                :actions="extensionActions"
              />
              <component
                :is="extensions.regions['sign-out']"
                v-if="extensions.regions['sign-out']"
                :actions="extensionActions"
              />
              </template>
              <template #workspaces>
              <button class="context-menu-item" v-if="workspace && !store.recent.some(item => item.id === workspace?.id) && !extensions.regions['workspace-menu-layout']" type="button" :data-workspace-entry-id="workspace.id" :aria-current="navigationContext === 'workspace' ? 'true' : undefined" @click="selectContext('workspace')"><WorkspaceIcon :icon="store.workspaceSettings.icon" :mode="store.isDemo ? 'demo' : store.isWeb ? 'web' : 'local'" :size="16" /><span class="recent-name">{{ workspace.name }}</span><Check v-if="navigationContext === 'workspace'" :size="15" /></button>
              <component
                v-if="extensions.regions['workspace-menu']"
                :is="extensions.regions['workspace-menu']"
                :actions="extensionActions"
              />
              <template v-else>
                <button
                  v-if="store.isDemo || mobile"
                  :disabled="busy"
                  @click="
                    workspaceMenu = false;
                    store.isDemo && workspace ? openSettings('about') : store.openWorkspace();
                  "
                >
                  <FolderOpen :size="16" />{{ store.isDemo ? workspace ? t('了解演示存储') : t('打开演示工作区') : t('打开默认手机空间') }}
                </button>

                <button v-if="mobile" :disabled="busy" @click="createNewWorkspace">
                  <FolderPlus :size="16" />{{ t('新建手机空间') }}
                </button>
                <template v-if="store.recent.length || (!store.isDemo && !mobile)">
                  <div
                    v-if="store.isDemo || mobile"
                    class="menu-divider"
                  />
                  <div class="workspace-recent-heading">
                    <span class="recent-label">{{ store.isDemo ? t('最近工作空间') : t('本地工作区') }}</span>
                    <button
                      v-if="!store.isDemo && !mobile"
                      type="button"
                      class="workspace-recent-open"
                      :aria-label="t('打开新的本地文件夹')"
                      :data-tooltip="t('打开新的本地文件夹')"
                      :disabled="busy"
                      @click="
                        workspaceMenu = false;
                        store.openWorkspace();
                      "
                    >
                      <OpenWorkspaceIcon :size="16" />
                    </button>
                  </div>
                  <button
                    class="context-menu-item"
                    v-for="item in store.recent.slice(0, 5)"
                    :key="item.id"
                    :data-tooltip="item.path"
                    :disabled="busy"
                    :aria-current="navigationContext === 'workspace' && item.id === workspace?.id ? 'true' : undefined"
                    :data-workspace-entry-id="item.id"
                    @mousedown.right.stop.prevent="openWorkspaceEntryContextMenu(item, $event)"
                    @contextmenu.stop.prevent="openWorkspaceEntryContextMenu(item, $event)"
                    @click="
                      workspaceMenu = false;
                      item.id === workspace?.id ? selectContext('workspace') : store.openWorkspace(item.path);
                    "
                  >
                    <span class="workspace-list-avatar"><WorkspaceIcon :icon="item.id === workspace?.id ? store.workspaceSettings.icon : item.icon" :mode="store.isDemo ? 'demo' : store.isWeb ? 'web' : 'local'" :size="16" /></span>
                    <span class="recent-name">{{ item.name }}</span>
                    <Check v-if="navigationContext === 'workspace' && item.id === workspace?.id" :size="15" />
                  </button>
                </template>
              </template>
              </template>
              </component>
            </div>
          </div>
          <component
            :is="extensions.regions['sidebar-footer']"
            v-if="extensions.regions['sidebar-footer']"
            :actions="extensionActions"
          />
                <component
                  :is="extensions.regions['local-menu-login']"
                  v-if="extensions.regions['local-menu-login']"
                  :actions="extensionActions"
                />
          <SidebarUpdateButton
            :enabled="native && !mobile && !isAuxiliaryWindow"
            :state="updates.state"
            @download="updates.download()"
            @install="updates.install()"
          >
            <HelpLauncher
              :context="helpContext"
              :availability="helpAvailability"
              :available="sidebar && !isAuxiliaryWindow"
              :blocked="helpBlocked"
              :scope="`${navigationContext}:${workspace?.id ?? 'home'}:${activeId}`"
              :documentation-base-url="documentationBaseUrl"
              :native="native"
              @open="workspaceMenu = false; menu = false"
              @settings="openSettings"
              @documentation="openExternalUrl($event).catch(store.report)"
            />
          </SidebarUpdateButton>
        </div>
        <div
          v-if="!compactPanes && !switchingWorkspace"
          class="sidebar-resize-handle"
          role="separator"
          :aria-label="t('调整侧栏宽度')"
          :data-tooltip="t('拖动调宽，向左拖到底收起')"
          :data-tooltip-shortcut="shortcuts.toggleSidebar"
          data-tooltip-anchor="pointer"
          data-tooltip-delay="700"
          aria-orientation="vertical"
          :aria-valuenow="sidebarWidth ?? defaultSidebarWidth()"
          :aria-valuemin="SIDEBAR_MIN_WIDTH"
          :aria-valuemax="sidebarWidthLimit()"
          tabindex="0"
          @pointerdown="startSidebarResize"
          @keydown="resizeSidebarWithKeyboard"
        />
    </WorkspaceSidebar>

    <!-- Without workbench panes (home, extension views, empty) the whole column is the page card. -->
    <div ref="mainColumn" class="main-column" :class="{ 'workspace-card': !(workspace || startupPending || filesPending) }" :inert="compactPanes && sidebar || undefined">
      <button v-if="!workspace && !sidebar && !isAuxiliaryWindow" class="icon-button" :aria-label="t('展开侧栏')" @click="sidebar = true"><PanelLeftOpen :size="18" /></button>
      <Teleport :to="activeWindow.overlays"><WindowScope :key="activeWindow.id" :context="activeWindow">
      <ReferenceGraphPopover
        v-if="referenceGraphTarget && !switchingWorkspace"
        v-model:opened="referenceGraphOpened"
        variant="panel"
        :identity="{ type: 'document', id: referenceGraphTarget.id }"
        :label="referenceGraphTarget.path.replace(/\.(md|markdown)$/i, '')"
        :anchor="referenceGraphAnchor"
        @open="openReference"
      />
      </WindowScope></Teleport>
      <div v-if="compactPanes && tabsEnabled && (workspace || startupPending || filesPending || store.tabs.length)" class="workspace-tabbar">
        <DesktopTabs
          :loading="sessionPending"
          :file-drag="tabFileDrag"
          :assistant-tab="assistantTab"
          @files-dropped="fileDragEnd"
          @new-tab="store.createBlankTab()"
          @new-document="createNewDocument"
        />
      </div>

      <WorkbenchPanes v-if="workspace || startupPending || filesPending" />
      <WorkspacePanes v-else-if="store.tabs.length && !startupPending" :compact="compactPanes" :tabs-enabled="tabsEnabled" :class="{ 'workspace-native-tabs': tabsEnabled && !compactPanes }">
        <template #tabs="{ pane, rect }">
          <div class="workspace-tabbar" :data-tab-pane-id="pane.id"><DesktopTabs :pane-id="pane.id" :show-navigation="rect.top === 0 && rect.left === 0" :detachable="false" /></div>
        </template>
        <template #default="{ pane }">
          <WorkbenchSettings v-if="pane.activeId === SETTINGS_TAB_ID" tabbed />
          <template v-for="view in extensionViews" :key="view.id"><component v-if="pane.activeId === view.id" :is="view.component" :actions="viewActions[view.id]" /></template>
        </template>
      </WorkspacePanes>
      <template v-else-if="homeContent && !startupPending">
        <CalendarView v-if="homeContent === CALENDAR_TAB_ID" :date="calendarDate" :mode="calendarMode" :records="plans.recordsFor(calendarScope)" @select-mode="selectCalendarMode" @visible-month="calendarDate = $event" @visible-year="calendarDate = $event" @visible-timeline="calendarDate = $event" @select-date="showCalendarDay" @select-month="showCalendarMonth" @select-event="showPlanEvent" />
        <component v-else-if="homeExtension" :is="homeExtension.component" :actions="viewActions[homeExtension.id]" />
      </template>
      <div v-else class="editor-empty"><div class="editor-empty-mark" aria-hidden="true" /></div>
      <Teleport :to="activeWindow.overlays"><WindowScope :key="activeWindow.id" :context="activeWindow">
      <InlineAssistantInput
        v-if="inlineAssistant && !switchingWorkspace"
        :anchor="inlineAssistant.anchor"
        v-model:value="inlineAssistantPrompt"
        :state="inlineAssistantState"
        :progress="inlineRunner.applying ? t('正在处理修改') : inlineRunner.progress"
        :error="inlineAssistantError"
        :message="inlineAssistantMessage"
        :placeholder="inlineAssistant.blankBlock ? t('描述你想生成的内容…') : undefined"
        @submit="submitInlineAssistant"
        @stop="inlineRunner.stop()"
        @conversation="continueInlineConversation"
        @undo="undoInlineAssistant"
        @close="closeInlineAssistant"
      />
      </WindowScope></Teleport>

      <Teleport :to="activeWindow.overlays">
        <div v-surface-motion="'App:6'"
          v-if="pageContextMenu && !switchingWorkspace"
          ref="pageContextMenuElement"
          class="dropdown compact-action-menu page-context-menu workspace-options-menu"
          role="menu"
          :aria-label="t('页面显示选项')"
          tabindex="-1"
          :style="{ left: `${pageContextMenu.x}px`, top: `${pageContextMenu.y}px` }"
          @keydown="pageContextKeydown"
        >
          <PageDisplayOptions :workspace-locked="workspaceLocked" :workspace-available="!!workspace"
            :auto-spacing="editorPreferences.autoSpacing ?? false"
            :show-page-title="showPageTitle"
            :show-document-properties="showDocumentProperties"
            :show-outline="showOutline"
            :show-all-line-numbers="showAllLineNumbers"
            :auxiliary-window="!!isAuxiliaryWindow"
            :source="paneSource(store.activeId)"
            @toggle="togglePageOption" @toggle-workspace-lock="toggleWorkspaceLock" />
        </div>
      </Teleport>
      <Teleport :to="activeWindow.overlays">
        <div v-surface-motion="'App:7'"
          v-if="outlineContextMenu && !switchingWorkspace"
          ref="outlineContextMenuElement"
          class="dropdown compact-action-menu page-context-menu outline-context-menu"
          role="menu"
          :aria-label="t('目录显示选项')"
          tabindex="-1"
          :style="{ left: `${outlineContextMenu.x}px`, top: `${outlineContextMenu.y}px` }"
          @keydown="outlineContextKeydown"
        >
          <button
            type="button"
            role="menuitemcheckbox"
            :aria-checked="outlineOnLeft"
            @click="toggleOutlineSide"
          >
            <PanelLeftOpen :size="15" />{{ t('显示在左侧') }}<Check
              v-if="outlineOnLeft"
              class="page-context-check"
              :size="14"
            />
          </button>
        </div>
      </Teleport>
    </div>

    <Teleport :to="activeWindow.overlays">
    <WindowScope :key="activeWindow.id" :context="activeWindow">
    <ImportPanel
      v-if="importPanel && workspace"
      :key="workspace.id"
      :attachments="attachments"
      :records="importRecords"
      @close="importPanel = false"
      @completed="importRecords.unshift($event)"
    />
    <WorkspaceSyncPanel v-if="systemSyncPanel && workspace" :workspace-id="workspace.id" :controller="workspaceSync" :cloud="extensions.sync" @close="systemSyncPanel = false" />
    <component
      :is="extensions.regions['sync-dialog']"
      v-if="extensions.regions['sync-dialog']"
      :actions="extensionActions"
    />
    <MobileRecycle
      v-if="mobile && recyclePanel && workspace"
      :workspace-id="workspace.id"
      @close="recyclePanel = false"
    />
    <AgentPanel
      v-if="agentPanel && workspace"
      :workspace-id="workspace.id"
      @close="agentPanel = false"
    />
    <DiffDialog v-if="selectedDiff" v-bind="selectedDiff" @close="selectedDiff = undefined" />
    <component
      :is="extensions.regions['history-dialog']"
      v-if="extensions.regions['history-dialog']"
      :actions="extensionActions"
    />
    <DocumentHistoryPanel
      v-if="historyPanel && active && workspace"
      :key="active.id"
      :local-id="active.id"
      :path="active.path"
      :workspace-id="workspace.id"
      :activities="activities"
      :history-view="extensions.historyEnabled ? extensions.historyView : undefined"
      :initial-page="historyPage"
      @close="historyPanel = false"
      @diff="
        historyPanel = false;
        selectedDiff = $event;
      "
    />
    <input ref="assetInput" type="file" multiple hidden @change="importObjectAssets" />
    <ObjectPanel
      v-if="objectPanelMounted"
      v-show="objectPanel"
      :open="objectPanel"
      :selected-id="selectedObjectId"
      :selected-identity="selectedResourceIdentity"
      :personal="selectedPersonal ? plans.panel : undefined"
      :can-open-asset="!!attachments"
      :can-import-asset="!!attachments && !assetImportBusy"
      :preview-asset="assetPreview"
      @close="objectPanel = false"
      @open-resource="openObjectResource"
      @open-reference="openObjectReference"
      @create-document="
        objectPanel = false;
        createNewDocument();
      "
      @import-asset="assetInput?.click()"
    />
    <PlanDetailPanel
      v-if="planDetail"
      :key="`${planDetail.source?.scope}:${planDetail.source?.id}:${planDetail.object.id}`"
      :record="planDetail"
      @close="planDetail = undefined"
      @open-reference="openPlanReference"
      @open-record="planDetail = $event"
    />
    <SelectionTodoDialog
      v-if="selectionTodo"
      :session="selectionTodo"
      @close="selectionTodo = undefined"
      @open-task="
        selectionTodo = undefined;
        showPlanEvent($event);
      "
    />
    <template v-for="view in extensionViews" :key="view.id">
      <component
        :is="view.overlay"
        v-if="view.overlay"
        :actions="viewActions[view.id]"
      />
    </template>
    <CommandPalette v-if="commandPaletteOpened" :commands="workbenchCommands" @close="commandPaletteOpened = false" />
    <WorkbenchSettings v-if="settingsPanel" />
    <div v-if="store.fileMutationPending" class="file-mutation-status" role="status">{{ t('正在同步更改…') }}</div>
    <div v-if="fatal || store.sessionError" class="error-toast" role="alert">
      <AlertTriangle :size="18" /><span>{{ fatal || store.sessionError }}</span
      ><button v-if="fatal" class="icon-button" :aria-label="t('关闭通知')" @click="fatal = ''">
        <X :size="16" />
      </button>
    </div>

    <NewTabPicker v-if="modal === 'newTab'" @close="modal = ''" @new-document="createNewDocument" />
    <div v-surface-motion="'App:8'"
      v-if="modal && modal !== 'newTab'"
      class="modal-backdrop"
      :class="{ 'search-backdrop': modal === 'search' }"
      @mousedown.self="!modalBusy && !updateLock && (modal = '')"
    >
      <section
        :class="modal === 'search' ? 'search-modal' : 'modal'"
        role="dialog"
        aria-modal="true"
        :aria-label="modalTitle"
      >
        <header v-if="modal !== 'search'">
          <h2>{{ modalTitle }}</h2>
          <button
            class="icon-button"
            :aria-label="t('关闭弹窗')"
            :disabled="modalBusy || updateLock"
            @click="modal = ''"
          >
            <X :size="19" />
          </button>
        </header>
        <template v-if="modal === 'search'"
          ><div class="search-input-wrap">
            <input
              ref="inputEl"
              v-model="input"
              type="text"
              role="searchbox"
              inputmode="search"
              :aria-label="t('搜索文档名称和正文')"
              :placeholder="t('搜索文件名、路径或正文…')"
              @keydown.enter="searchResults[0] && openSearchResult(searchResults[0])"
            /><button type="button" :aria-label="t('关闭搜索')" :data-tooltip="t('关闭搜索')" @click="modal = ''">
              <X :size="18" />
            </button>
          </div>
          <div v-if="input.trim()" class="search-results">
            <button
              v-for="file in searchResults"
              :key="file.id"
              @click="openSearchResult(file)"
            >
              <span class="search-result-breadcrumb"
                ><span class="search-result-location"
                  ><template
                    v-for="(part, index) in searchHighlightParts(searchResultLocation(file.path))"
                    :key="index"
                    ><mark v-if="part.matched">{{ part.text }}</mark
                    ><template v-else>{{ part.text }}</template></template
                  ></span
                ><span aria-hidden="true">›</span
                ><strong
                  ><template
                    v-for="(part, index) in searchHighlightParts(
                      file.name.replace(/\.(md|markdown)$/i, ''),
                    )"
                    :key="index"
                    ><mark v-if="part.matched">{{ part.text }}</mark
                    ><template v-else>{{ part.text }}</template></template
                  ></strong
                ></span
              ><small
                ><template v-for="(part, index) in searchHighlightParts(file.preview)" :key="index"
                  ><mark v-if="part.matched">{{ part.text }}</mark
                  ><template v-else>{{ part.text }}</template></template
                ></small
              >
            </button>
            <p v-if="!searchResults.length" class="panel-empty" role="status">
              {{ searching ? t('正在查找…') : searchError || t('没有找到这篇文档，试试其他关键词。') }}
            </p>
          </div></template
        >
        <form v-else @submit.prevent="submitModal">
          <template v-if="modal === 'delete'"
            ><p class="modal-description">
              {{
                store.isDemo
                  ? t('将删除浏览器中的演示文档，此操作无法在应用内撤销。')
                  : store.isWeb
                    ? t('将从在线工作区移除所选文件。服务端按配置保留版本历史。')
                    : mobile
                      ? t('文件将保留在手机回收站。可从工作空间菜单恢复副本。')
                      : t('文件将移入系统回收站，你可以在回收站中恢复。')
              }}
            </p>
            <div class="delete-file">
              <FileText :size="19" />
              <span v-if="modalDeleteEntries.length <= 1">{{
                modalDeleteEntries[0]?.path ?? modalTarget?.path ?? active?.path
              }}</span>
              <span v-else class="delete-file-list">
                <span v-for="file in modalDeleteEntries.slice(0, 6)" :key="file.id">{{
                  file.path
                }}</span>
                <span v-if="modalDeleteEntries.length > 6"
                  >{{ t('还有') }} {{ modalDeleteEntries.length - 6 }} {{ t('项…') }}</span
                >
              </span>
            </div></template
          ><template v-else
            ><p class="modal-description">
              {{
                modal === 'saveAs'
                  ? t('把当前编辑内容保存为独立的 Markdown 文件。')
                  : t('从一个名字开始，把想法留在这一页。')
              }}
            </p>
            <label for="file-name">{{ t('文档路径') }}</label
            ><input
              id="file-name"
              ref="inputEl"
              v-model="input"
              :placeholder="t('例如：我的新想法.md')"
              autocomplete="off"
              maxlength="220"
            />
            <p class="input-hint">
              {{
                store.isWeb
                  ? t('可使用「项目/新想法.md」创建文档及所在目录。')
                  : t('相对于工作空间，可使用已有目录，例如「项目/新想法.md」。')
              }}
            </p></template
          >
          <p v-if="modalError" class="form-error" role="alert">{{ modalError }}</p>
          <div class="modal-actions">
            <button
              type="button"
              class="secondary-button"
              :disabled="modalBusy"
              @click="modal = ''"
            >
              {{ t('取消') }}</button
            ><button
              class="primary-button"
              :class="{ destructive: modal === 'delete' }"
              :disabled="modalBusy || (modal === 'delete' && !modalDeleteEntries.length)"
            >
              <LoaderCircle v-if="modalBusy" class="spinning" :size="16" />{{
                modalBusy
                  ? t('正在处理…')
                  : modal === 'delete'
                    ? t('确认移除')
                    : t('创建文档')
              }}<ArrowRight v-if="!modalBusy" :size="16" />
            </button>
          </div>
        </form>
      </section>
    </div>
    </WindowScope>
    </Teleport>
  </div>
</template>
