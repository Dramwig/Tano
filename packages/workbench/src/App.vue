<script setup lang="ts">
import { provide, proxyRefs, ref, shallowReactive, toRefs } from 'vue';
import {
  ArrowDownToLine,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Files,
  FolderOpen,
  FolderPlus,
  GitFork,
  House,
  Mail,
  PanelLeftOpen,
  Search,
  SquarePen,
  Trash2,
} from 'lucide-vue-next';
import ShortcutHint from '@tano/editor/shortcut-hint';
import { vSurfaceMotion } from '@tano/editor/surface-motion';
import AppMenu from './shell/components/AppMenu.vue';
import AppTooltip from './shell/components/AppTooltip.vue';
import AssistantButterflyLayer from './assistant/components/AssistantButterflyLayer.vue';
import ButtonVisibilityGroup from './shell/components/ButtonVisibilityGroup.vue';
import DesktopTabs from './tabs/components/DesktopTabs.vue';
import FileMetadataPanel from './files/components/FileMetadataPanel.vue';
import FileTree from './files/components/FileTree.vue';
import HelpLauncher from './help/components/HelpLauncher.vue';
import OpenWorkspaceIcon from './shell/components/OpenWorkspaceIcon.vue';
import PluginExplorer from './plugins/components/PluginExplorer.vue';
import PluginMenu from './plugins/components/PluginMenu.vue';
import PluginStatusBar from './plugins/components/PluginStatusBar.vue';
import PluginView from './plugins/components/PluginView.vue';
import { isOverlaySidebarNavHidden } from './plugins/overlay-mapping';
import ReferenceGraphPopover from './objects/components/ReferenceGraphPopover.vue';
import SidebarNavigation from './shell/components/SidebarNavigation.vue';
import SidebarUpdateButton from './shell/components/SidebarUpdateButton.vue';
import WorkbenchContextMenus from './shell/components/WorkbenchContextMenus.vue';
import WorkbenchModals from './shell/components/WorkbenchModals.vue';
import WorkbenchPanes from './shell/components/WorkbenchPanes.vue';
import WorkbenchSettings from './settings/components/WorkbenchSettings.vue';
import WorkspaceIcon from './workspace/components/WorkspaceIcon.vue';
import WorkspaceMenuLayout from './shell/components/WorkspaceMenuLayout.vue';
import WorkspacePanes from './shell/components/WorkspacePanes.vue';
import WorkspaceSidebar from './shell/components/WorkspaceSidebar.vue';
import WorkspaceViewSwitcher from './shell/components/WorkspaceViewSwitcher.vue';
import { vScrollFade } from './shell/scroll-fade';
import { useWorkbench, type WorkbenchProps } from './shell/use-workbench';
import AuxiliaryWindows from './windows/AuxiliaryWindows.vue';
import WindowScope from './windows/WindowScope.vue';
import {
  CalendarView,
  InlineAssistantInput,
  MailWorkspaceView,
  SidebarAssistant,
  SidebarMail,
  SidebarPlan,
} from './shell/workbench-async-components';
import { workbenchContextKey } from './shell/workbench-context';

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
  MAIL_TAB_ID,
  mailEnabled,
  openMail,
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
  sidebarCalendarDate,
  openCalendar,
  showPlanEvent,
  shortcutHint,
  tabsEnabled,
  toggleWorkspaceMenu,
  workspaceDropdownContextMenu,
  selectContext,
  extensions,
  extensionActions,
  commandPaletteOpened,
  openImport,
  openTemplateLibrary,
  openSettings,
  updates,
  recyclePanel,
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
  workbenchCommands,
  createNewEntry,
} = toRefs(context);
// The brand icon opens the self-drawn application menu on desktop; the web build keeps it as a home link.
const appMenuOpen = ref(false);
const brandButton = ref<HTMLElement | null>(null);
function runPluginCommandById(commandId: string) {
  const builtin = workbenchCommands.value.find((item) => item.id === commandId);
  if (builtin) {
    void builtin.run();
    return;
  }
  const ws = workspace.value;
  if (!ws) return;
  const cmd = store.value.pluginCommands.find(
    (item) => `${item.pluginId}:${item.id}` === commandId || item.id === commandId,
  );
  if (!cmd) return;
  void store.value
    .interactWithPlugin({
      workspaceId: ws.id,
      pluginId: cmd.pluginId,
      instanceId: cmd.instanceId,
      kind: 'command',
      name: cmd.id,
      payload: {
        workspaceId: ws.id,
        ...(store.value.active?.id ? { fileId: store.value.active.id } : {}),
      },
    })
    .catch(() => {});
}
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
      :data-tooltip="t('展开侧栏')"
      :data-tooltip-shortcut="shortcuts.toggleSidebar"
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
    <Teleport :to="activeWindow.overlays"
      ><WindowScope :key="activeWindow.id" :context="activeWindow"
        ><AssistantButterflyLayer :controller="butterfly" /></WindowScope
    ></Teleport>
    <Teleport :to="activeWindow.overlays">
      <WindowScope :key="activeWindow.id" :context="activeWindow">
        <AppMenu
          v-if="appMenuOpen && brandButton"
          :commands="workbenchCommands"
          :anchor="brandButton"
          :palette-hint="shortcutHint('commandPalette')"
          :open-palette="
            () => {
              commandPaletteOpened = true;
            }
          "
          :close-window="activeWindow.native ? () => activeWindow.native!.close() : undefined"
          @close="appMenuOpen = false"
        />
      </WindowScope>
    </Teleport>
    <Teleport :to="activeWindow.overlays"
      ><FileMetadataPanel
        v-if="fileMetadataTarget && !switchingWorkspace"
        v-bind="fileMetadataTarget"
        @close="fileMetadataTarget = null"
    /></Teleport>
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
              v-if="isVisible('search') && !isOverlaySidebarNavHidden('search', store.overlaySnapshot?.hiddenSidebarItems)"
              type="button"
              class="icon-button"
              :aria-label="t('查找文档')"
              :data-tooltip="t('查找文档')"
              :data-tooltip-shortcut="shortcuts.findDocument"
              :disabled="!workspace"
              @click="showModal('search')"
            >
              <Search :size="16" :stroke-width="1.6" />
            </button>
            <button
              v-if="store.workspaceSettings.showGraph && isVisible('graph') && !isOverlaySidebarNavHidden('graph', store.overlaySnapshot?.hiddenSidebarItems)"
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
              v-if="
                (view.scope === 'account' || store.workspaceSettings.showCollaborationViews) &&
                view.header &&
                isVisible(view.id)
              "
              :actions="viewActions[view.id]"
            />
          </template>
        </ButtonVisibilityGroup>
      </div>
      <SidebarNavigation
        v-if="navigationContext === 'home'"
        v-slot="{ isVisible, orderStyle }"
        :items="sidebarNavigationItems"
        :active="sidebar"
        :overlay-hidden-ids="store.overlaySnapshot?.hiddenSidebarItems"
        :overlay-order="store.overlaySnapshot?.sidebarOrder"
        @open="closeButtonVisibilityMenus"
      >
        <button
          v-if="isVisible('plan')"
          type="button"
          class="sidebar-navigation-button"
          :style="orderStyle('plan')"
          :aria-label="t('计划')"
          :data-tooltip="t('计划')"
          aria-controls="sidebar-plan-panel"
          :aria-pressed="navigationModule === 'plan'"
          @click="selectModule('plan')"
        >
          <CalendarDays :size="18" :stroke-width="1.6" aria-hidden="true" />
          <span :aria-hidden="navigationModule !== 'plan'"
            ><span>{{ t('计划') }}</span></span
          >
        </button>
        <button
          v-if="mailEnabled && isVisible(MAIL_TAB_ID)"
          type="button"
          class="sidebar-navigation-button"
          :style="orderStyle(MAIL_TAB_ID)"
          :aria-label="t('邮箱')"
          :data-tooltip="t('邮箱')"
          :aria-controls="`sidebar-${MAIL_TAB_ID}`"
          :aria-pressed="sidebarView === MAIL_TAB_ID"
          @click="openMail()"
        >
          <Mail :size="18" :stroke-width="1.6" aria-hidden="true" />
          <span :aria-hidden="sidebarView !== MAIL_TAB_ID"
            ><span>{{ t('邮箱') }}</span></span
          >
        </button>
        <template v-for="view in extensionViews" :key="view.id">
          <button
            v-if="
              store.workspaceSettings.showCollaborationViews && view.sidebar && isVisible(view.id)
            "
            type="button"
            class="sidebar-navigation-button"
            :style="orderStyle(view.id)"
            :aria-label="view.label"
            :data-tooltip="view.label"
            :aria-controls="`sidebar-${view.id}`"
            :aria-pressed="sidebarView === view.id"
            @click="selectModule(view.id)"
          >
            <component :is="view.icon" :size="18" :stroke-width="1.6" aria-hidden="true" />
            <span :aria-hidden="sidebarView !== view.id"
              ><span>{{ view.label }}</span></span
            >
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
          >{{ draggedEntry ? t('放到工作区根目录') : (workspace?.name ?? '') }}</span
        >
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
            :data-tooltip="t('新建文档')"
            :data-tooltip-shortcut="shortcuts.newDocument"
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
      <PluginView
        v-else-if="sidebarView.startsWith('plugin-sidebar:')"
        :view-key="sidebarView.slice(15)"
      />
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
            :ref="(el) => { context.fileTree = (el as InstanceType<typeof FileTree> | null) ?? undefined; }"
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
      <SidebarAssistant
        v-if="sidebarView === 'assistant'"
        @open="compactPanes && (sidebar = false)"
      />
      <SidebarPlan
        v-show="sidebarView === 'plan' || sidebarView === 'events'"
        :active="sidebar && (sidebarView === 'plan' || sidebarView === 'events')"
        :workspace-only="navigationContext === 'workspace'"
        id="sidebar-plan-panel"
        :date="sidebarCalendarDate"
        @select-date="openCalendar"
        @select-event="showPlanEvent"
      />
      <SidebarMail
        v-if="mailEnabled && sidebarView === MAIL_TAB_ID"
        :id="`sidebar-${MAIL_TAB_ID}`"
        @open-mail="openMail"
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
      <div class="sidebar-bottom">
        <div class="workspace-picker-wrap">
          <button
            class="workspace-picker"
            :aria-expanded="workspaceMenu"
            aria-controls="workspace-menu"
            :aria-label="
              filesPending
                ? t('正在打开工作区…')
                : t('切换上下文：{0}', [
                    navigationContext === 'home' ? t('主页') : (workspace?.name ?? t('选择工作区')),
                  ])
            "
            :data-tooltip="
              filesPending
                ? t('正在打开工作区…')
                : navigationContext === 'home'
                  ? t('主页')
                  : (workspace?.name ?? t('选择工作区'))
            "
            @click="toggleWorkspaceMenu"
            @contextmenu.stop.prevent="toggleWorkspaceMenu"
          >
            <span class="workspace-avatar"
              ><House v-if="navigationContext === 'home'" :size="15" /><WorkspaceIcon
                v-else
                :icon="store.workspaceSettings.icon"
                :mode="store.isDemo ? 'demo' : store.isWeb ? 'web' : 'local'"
                :size="15"
            /></span>
            <span class="workspace-picker-text"
              ><span v-if="filesPending" class="tano-skeleton-bar" /><strong v-else>{{
                navigationContext === 'home' ? t('主页') : (workspace?.name ?? t('选择工作区'))
              }}</strong></span
            >
            <component :is="workspaceMenu ? ChevronUp : ChevronDown" :size="12" />
          </button>
          <div
            v-surface-motion="'App:3'"
            v-if="workspaceMenu"
            id="workspace-menu"
            class="dropdown compact-action-menu sidebar-popover workspace-dropdown"
            @contextmenu.stop.prevent="workspaceDropdownContextMenu"
          >
            <button
              class="context-menu-item"
              type="button"
              :aria-current="navigationContext === 'home' ? 'true' : undefined"
              @click="selectContext('home')"
            >
              <House :size="16" /><span class="recent-name">{{ t('主页') }}</span
              ><Check v-if="navigationContext === 'home'" :size="15" />
            </button>
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
                <button
                  role="menuitem"
                  @click="
                    workspaceMenu = false;
                    commandPaletteOpened = true;
                  "
                >
                  <Search :size="16" />{{ t('命令中心')
                  }}<span class="menu-shortcut"
                    ><ShortcutHint :label="shortcutHint('commandPalette')"
                  /></span>
                </button>
                <component
                  :is="extensions.regions['workspace-settings']"
                  v-if="
                    extensions.regions['workspace-menu-layout'] &&
                    extensions.regions['workspace-settings']
                  "
                  :actions="extensionActions"
                />
                <button
                  v-if="workspace"
                  role="menuitem"
                  :disabled="workspace.readOnly || busy"
                  @click="openImport"
                >
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
                <button role="menuitem" @click="openSettings('about')">
                  <CircleHelp :size="16" />{{ t('关于 Tano / 同页')
                  }}{{ updates.state.candidate ? t(' · 有新版本') : '' }}
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
                    (mobile && workspace) ||
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
                <button
                  class="context-menu-item"
                  v-if="
                    workspace &&
                    !store.recent.some((item) => item.id === workspace?.id) &&
                    !extensions.regions['workspace-menu-layout']
                  "
                  type="button"
                  :data-workspace-entry-id="workspace.id"
                  :aria-current="navigationContext === 'workspace' ? 'true' : undefined"
                  @click="selectContext('workspace')"
                >
                  <WorkspaceIcon
                    :icon="store.workspaceSettings.icon"
                    :mode="store.isDemo ? 'demo' : store.isWeb ? 'web' : 'local'"
                    :size="16"
                  /><span class="recent-name">{{ workspace.name }}</span
                  ><Check v-if="navigationContext === 'workspace'" :size="15" />
                </button>
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
                    <FolderOpen :size="16" />{{
                      store.isDemo
                        ? workspace
                          ? t('了解演示存储')
                          : t('打开演示工作区')
                        : t('打开默认手机空间')
                    }}
                  </button>

                  <button v-if="mobile" :disabled="busy" @click="createNewWorkspace">
                    <FolderPlus :size="16" />{{ t('新建手机空间') }}
                  </button>
                  <template v-if="store.recent.length || (!store.isDemo && !mobile)">
                    <div v-if="store.isDemo || mobile" class="menu-divider" />
                    <div class="workspace-recent-heading">
                      <span class="recent-label">{{
                        store.isDemo ? t('最近工作空间') : t('本地工作区')
                      }}</span>
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
                      :aria-current="
                        navigationContext === 'workspace' && item.id === workspace?.id
                          ? 'true'
                          : undefined
                      "
                      :data-workspace-entry-id="item.id"
                      @mousedown.right.stop.prevent="openWorkspaceEntryContextMenu(item, $event)"
                      @contextmenu.stop.prevent="openWorkspaceEntryContextMenu(item, $event)"
                      @click="
                        workspaceMenu = false;
                        item.id === workspace?.id
                          ? selectContext('workspace')
                          : store.openWorkspace(item.path);
                      "
                    >
                      <span class="workspace-list-avatar"
                        ><WorkspaceIcon
                          :icon="item.id === workspace?.id ? store.workspaceSettings.icon : item.icon"
                          :mode="store.isDemo ? 'demo' : store.isWeb ? 'web' : 'local'"
                          :size="16"
                      /></span>
                      <span class="recent-name">{{ item.name }}</span>
                      <Check
                        v-if="navigationContext === 'workspace' && item.id === workspace?.id"
                        :size="15"
                      />
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
            @open="
              workspaceMenu = false;
              menu = false;
            "
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
    <div
      ref="mainColumn"
      class="main-column"
      :class="{ 'workspace-card': !(workspace || startupPending || filesPending) }"
      :inert="(compactPanes && sidebar) || undefined"
    >
      <button
        v-if="!workspace && !sidebar && !isAuxiliaryWindow"
        class="icon-button"
        :aria-label="t('展开侧栏')"
        @click="sidebar = true"
      >
        <PanelLeftOpen :size="18" />
      </button>
      <Teleport :to="activeWindow.overlays"
        ><WindowScope :key="activeWindow.id" :context="activeWindow">
          <ReferenceGraphPopover
            v-if="referenceGraphTarget && !switchingWorkspace"
            v-model:opened="referenceGraphOpened"
            variant="panel"
            :identity="{ type: 'document', id: referenceGraphTarget.id }"
            :label="referenceGraphTarget.path.replace(/\.(md|markdown)$/i, '')"
            :anchor="referenceGraphAnchor"
            @open="openReference"
          /> </WindowScope
      ></Teleport>
      <div
        v-if="
          compactPanes &&
          tabsEnabled &&
          (workspace || startupPending || filesPending || store.tabs.length)
        "
        class="workspace-tabbar"
      >
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
      <WorkspacePanes
        v-else-if="store.tabs.length && !startupPending"
        :compact="compactPanes"
        :tabs-enabled="tabsEnabled"
        :class="{ 'workspace-native-tabs': tabsEnabled && !compactPanes }"
      >
        <template #tabs="{ pane, rect }">
          <div class="workspace-tabbar" :data-tab-pane-id="pane.id">
            <DesktopTabs
              :pane-id="pane.id"
              :show-navigation="rect.top === 0 && rect.left === 0"
              :detachable="false"
            />
          </div>
        </template>
        <template #default="{ pane }">
          <WorkbenchSettings v-if="pane.activeId === SETTINGS_TAB_ID" tabbed />
          <MailWorkspaceView v-else-if="mailEnabled && pane.activeId === MAIL_TAB_ID" />
          <template v-for="view in extensionViews" :key="view.id"
            ><component
              v-if="pane.activeId === view.id"
              :is="view.component"
              :actions="viewActions[view.id]"
          /></template>
        </template>
      </WorkspacePanes>
      <template v-else-if="homeContent && !startupPending">
        <CalendarView
          v-if="homeContent === CALENDAR_TAB_ID"
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
        <MailWorkspaceView v-else-if="mailEnabled && homeContent === MAIL_TAB_ID" />
        <component
          v-else-if="homeExtension"
          :is="homeExtension.component"
          :actions="viewActions[homeExtension.id]"
        />
      </template>
      <div v-else class="editor-empty"><div class="editor-empty-mark" aria-hidden="true" /></div>
      <PluginStatusBar
        v-if="workspace && !isAuxiliaryWindow"
        :items="store.pluginStatusBarItems"
        :workspace-id="workspace.id"
        :active-document-id="store.active?.id"
        :execute="store.interactWithPlugin"
        :safe-mode="store.overlaySnapshot?.safeMode"
        :pinned-commands="store.overlaySnapshot?.pinnedCommands"
        @exit-safe-mode="store.setSafeMode(false)"
        @run-pinned-command="runPluginCommandById"
      />
      <Teleport :to="activeWindow.overlays"
        ><WindowScope :key="activeWindow.id" :context="activeWindow">
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
          /> </WindowScope
      ></Teleport>
    </div>

    <WorkbenchContextMenus />
    <WorkbenchModals />
  </div>
</template>
