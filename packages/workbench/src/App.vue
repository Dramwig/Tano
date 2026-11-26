<script setup lang="ts">
import { ref, toRefs } from 'vue';
import { PanelLeftOpen } from 'lucide-vue-next';
import AssistantButterflyLayer from './assistant/components/AssistantButterflyLayer.vue';
import FileMetadataPanel from './files/components/FileMetadataPanel.vue';
import { t } from './i18n/i18n';
import { MAIL_TAB_ID } from './mail/types';
import ReferenceGraphPopover from './objects/components/ReferenceGraphPopover.vue';
import { CALENDAR_TAB_ID } from './plans/calendar';
import { mobile } from './platform/platform';
import PluginStatusBar from './plugins/components/PluginStatusBar.vue';
import WorkbenchSettings from './settings/components/WorkbenchSettings.vue';
import { SETTINGS_TAB_ID } from './settings/settings-tab';
import AppMenu from './shell/components/AppMenu.vue';
import AppTooltip from './shell/components/AppTooltip.vue';
import WorkbenchContextMenus from './shell/components/WorkbenchContextMenus.vue';
import WorkbenchModals from './shell/components/WorkbenchModals.vue';
import WorkbenchPanes from './shell/components/WorkbenchPanes.vue';
import WorkbenchSidebar from './shell/components/WorkbenchSidebar.vue';
import WorkspacePanes from './shell/components/WorkspacePanes.vue';
import { runWorkbenchCommandOrPlugin } from './shell/use-workbench-commands';
import { useWorkbench, type WorkbenchProps } from './shell/use-workbench';
import {
  CalendarView,
  InlineAssistantInput,
  MailWorkspaceView,
} from './shell/workbench-async-components';
import { provideWorkbenchContexts } from './shell/workbench-context';
import DesktopTabs from './tabs/components/DesktopTabs.vue';
import AuxiliaryWindows from './windows/AuxiliaryWindows.vue';
import WindowScope from './windows/WindowScope.vue';
import { native } from './workspace/adapter';

const props = defineProps<WorkbenchProps>();
const emit = defineEmits<{ ready: [] }>();
const { prefs, shell, documents, treeMenus, modals } = provideWorkbenchContexts(
  useWorkbench(props, emit),
);

const {
  activeWindow,
  workspace,
  compactPanes,
  isAuxiliaryWindow,
  sidebar,
  toggleSidebar,
  sessionPending,
  store,
  createNewDocument,
  detachTab,
  butterfly,
  switchingWorkspace,
  mainColumn,
  extensionViews,
  viewActions,
  mailEnabled,
  startupPending,
  filesPending,
  openReference,
  assistantTab,
  homeContent,
  calendarDate,
  calendarMode,
  plans,
  calendarScope,
  selectCalendarMode,
  showCalendarDay,
  showCalendarMonth,
  showPlanEvent,
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
} = toRefs(shell);

const {
  shortcuts,
  shortcutHint,
  tabsEnabled,
  resizingSidebar,
  moveSidebarResize,
  finishSidebarResize,
} = toRefs(prefs);

const { referenceGraphTarget, referenceGraphOpened, referenceGraphAnchor } = toRefs(documents);
const { tabFileDrag, fileDragEnd, fileMetadataTarget } = toRefs(treeMenus);
const { commandPaletteOpened } = toRefs(modals);

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
    <Teleport :to="activeWindow.overlays">
      <WindowScope :key="activeWindow.id" :context="activeWindow">
        <AssistantButterflyLayer :controller="butterfly" />
      </WindowScope>
    </Teleport>
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
    <Teleport :to="activeWindow.overlays">
      <FileMetadataPanel
        v-if="fileMetadataTarget && !switchingWorkspace"
        v-bind="fileMetadataTarget"
        @close="fileMetadataTarget = null"
      />
    </Teleport>
    <Transition name="sidebar-dismiss">
      <button
        v-if="sidebar && !isAuxiliaryWindow && compactPanes"
        class="sidebar-dismiss"
        :aria-label="t('收起侧栏')"
        @click="toggleSidebar"
      />
    </Transition>

    <WorkbenchSidebar
      :app-menu-open="appMenuOpen"
      @toggle-app-menu="appMenuOpen = !appMenuOpen"
      @brand-button="brandButton = $event"
    />

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
      <Teleport :to="activeWindow.overlays">
        <WindowScope :key="activeWindow.id" :context="activeWindow">
          <ReferenceGraphPopover
            v-if="referenceGraphTarget && !switchingWorkspace"
            v-model:opened="referenceGraphOpened"
            variant="panel"
            :identity="{ type: 'document', id: referenceGraphTarget.id }"
            :label="referenceGraphTarget.path.replace(/\.(md|markdown)$/i, '')"
            :anchor="referenceGraphAnchor"
            @open="openReference"
          />
        </WindowScope>
      </Teleport>
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
          <template v-for="view in extensionViews" :key="view.id">
            <component
              v-if="pane.activeId === view.id"
              :is="view.component"
              :actions="viewActions[view.id]"
            />
          </template>
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
        @run-pinned-command="runWorkbenchCommandOrPlugin($event, workbenchCommands, store)"
      />
      <Teleport :to="activeWindow.overlays">
        <WindowScope :key="activeWindow.id" :context="activeWindow">
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
        </WindowScope>
      </Teleport>
    </div>

    <WorkbenchContextMenus />
    <WorkbenchModals />
  </div>
</template>
