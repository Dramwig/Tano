<script setup lang="ts">
import { inject, ref, toRefs } from 'vue';
import { CalendarDays, FolderPlus, GitFork, Mail, Search, SquarePen } from 'lucide-vue-next';
import { GRAPH_TAB_ID } from '../../documents/document-graph';
import { openExternalUrl } from '../../files/attachments';
import FileTree from '../../files/components/FileTree.vue';
import HelpLauncher from '../../help/components/HelpLauncher.vue';
import { t } from '../../i18n/i18n';
import { MAIL_TAB_ID } from '../../mail/types';
import { mobile } from '../../platform/platform';
import PluginExplorer from '../../plugins/components/PluginExplorer.vue';
import PluginView from '../../plugins/components/PluginView.vue';
import { isOverlaySidebarNavHidden } from '../../plugins/overlay-mapping';
import { native } from '../../workspace/adapter';
import WorkspacePickerMenu from '../../workspace/components/WorkspacePickerMenu.vue';
import { vScrollFade } from '../scroll-fade';
import {
  SidebarAssistant,
  SidebarMail,
  SidebarPlan,
} from '../workbench-async-components';
import {
  workbenchDocumentsKey,
  workbenchModalsKey,
  workbenchPrefsKey,
  workbenchShellKey,
  workbenchTreeMenusKey,
} from '../workbench-context';
import ButtonVisibilityGroup from './ButtonVisibilityGroup.vue';
import SidebarNavigation from './SidebarNavigation.vue';
import SidebarUpdateButton from './SidebarUpdateButton.vue';
import WorkspaceSidebar from './WorkspaceSidebar.vue';
import WorkspaceViewSwitcher from './WorkspaceViewSwitcher.vue';

const props = defineProps<{
  appMenuOpen: boolean;
}>();

const emit = defineEmits<{
  'toggle-app-menu': [];
  'brand-button': [el: HTMLElement | null];
}>();

const shell = inject(workbenchShellKey);
const prefs = inject(workbenchPrefsKey);
const documents = inject(workbenchDocumentsKey);
const treeMenus = inject(workbenchTreeMenusKey);
const modals = inject(workbenchModalsKey);
if (!shell || !prefs || !documents || !treeMenus || !modals) {
  throw new Error('Workbench context is required');
}

const {
  workspace,
  compactPanes,
  isAuxiliaryWindow,
  sidebar,
  store,
  busy,
  activeId,
  startupPending,
  filesPending,
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
  workspaceView,
  selectWorkspaceView,
  workspaceMenu,
  mailEnabled,
  openMail,
  repositoryActionItems,
  createNewDocument,
  createNewEntry,
  noteCount,
  sidebarCalendarDate,
  openCalendar,
  showPlanEvent,
  extensions,
  extensionActions,
  openSettings,
  updates,
  helpContext,
  helpAvailability,
  helpBlocked,
  documentationBaseUrl,
} = toRefs(shell);

const {
  shortcuts,
  sidebarWidth,
  defaultSidebarWidth,
  SIDEBAR_MIN_WIDTH,
  sidebarWidthLimit,
  startSidebarResize,
  resizeSidebarWithKeyboard,
} = toRefs(prefs);

const { menu } = toRefs(documents);

const {
  setFileTree,
  draggedEntry,
  dropFolder,
  dropPlaceholders,
  fileDragOver,
  fileDragLeave,
  fileDrop,
  openDirectoryContextMenu,
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
  fileDragEnd,
  finishTreeRename,
} = toRefs(treeMenus);

const { modal, settingsPanel, showModal } = toRefs(modals);

const brandButton = ref<HTMLElement | null>(null);
function setBrandButton(el: unknown) {
  brandButton.value = (el as HTMLElement | null) ?? null;
  emit('brand-button', brandButton.value);
}
</script>

<template>
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
          :ref="setBrandButton"
          type="button"
          class="brand brand-menu-button"
          aria-haspopup="menu"
          :aria-expanded="props.appMenuOpen"
          :aria-label="t('同页')"
          @click="emit('toggle-app-menu')"
        >
          <img src="../../assets/tano-logo.svg" alt="" />
        </button>
        <component
          :is="native ? 'div' : 'a'"
          v-else
          class="brand"
          :href="native ? undefined : '/'"
          :aria-label="native ? undefined : t('返回同页首页')"
          @click="returnHome"
        >
          <img src="../../assets/tano-logo.svg" alt="" />
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
        <span :aria-hidden="navigationModule !== 'plan'"><span>{{ t('计划') }}</span></span>
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
        <span :aria-hidden="sidebarView !== MAIL_TAB_ID"><span>{{ t('邮箱') }}</span></span>
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
          :ref="setFileTree"
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
      <WorkspacePickerMenu />
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
</template>
