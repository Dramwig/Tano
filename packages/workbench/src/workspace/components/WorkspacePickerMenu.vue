<script setup lang="ts">
import { inject, toRefs } from 'vue';
import {
  ArrowDownToLine,
  Check,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Files,
  FolderOpen,
  FolderPlus,
  House,
  Search,
  Trash2,
} from 'lucide-vue-next';
import ShortcutHint from '@tano/editor/shortcut-hint';
import { vSurfaceMotion } from '@tano/editor/surface-motion';
import { t } from '../../i18n/i18n';
import { mobile } from '../../platform/platform';
import PluginMenu from '../../plugins/components/PluginMenu.vue';
import OpenWorkspaceIcon from '../../shell/components/OpenWorkspaceIcon.vue';
import WorkspaceMenuLayout from '../../shell/components/WorkspaceMenuLayout.vue';
import {
  workbenchModalsKey,
  workbenchPrefsKey,
  workbenchShellKey,
  workbenchTreeMenusKey,
} from '../../shell/workbench-context';
import WorkspaceIcon from './WorkspaceIcon.vue';

const shell = inject(workbenchShellKey);
const prefs = inject(workbenchPrefsKey);
const treeMenus = inject(workbenchTreeMenusKey);
const modals = inject(workbenchModalsKey);
if (!shell || !prefs || !treeMenus || !modals) throw new Error('Workbench context is required');

const {
  workspace,
  store,
  busy,
  filesPending,
  navigationContext,
  workspaceMenu,
  toggleWorkspaceMenu,
  selectContext,
  extensions,
  extensionActions,
  openImport,
  openTemplateLibrary,
  openSettings,
  updates,
  createNewWorkspace,
} = toRefs(shell);
const { shortcutHint } = toRefs(prefs);
const { workspaceDropdownContextMenu, openWorkspaceEntryContextMenu } = toRefs(treeMenus);
const { commandPaletteOpened, recyclePanel } = toRefs(modals);
</script>

<template>
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
      <span class="workspace-avatar">
        <House v-if="navigationContext === 'home'" :size="15" />
        <WorkspaceIcon
          v-else
          :icon="store.workspaceSettings.icon"
          :mode="store.isDemo ? 'demo' : store.isWeb ? 'web' : 'local'"
          :size="15"
        />
      </span>
      <span class="workspace-picker-text">
        <span v-if="filesPending" class="tano-skeleton-bar" />
        <strong v-else>{{
          navigationContext === 'home' ? t('主页') : (workspace?.name ?? t('选择工作区'))
        }}</strong>
      </span>
      <component :is="workspaceMenu ? ChevronUp : ChevronDown" :size="12" />
    </button>
    <div
      v-surface-motion="'App:3'"
      v-if="workspaceMenu"
      id="workspace-menu"
      class="dropdown compact-action-menu sidebar-popover workspace-dropdown"
      data-surface-role="popover"
      @contextmenu.stop.prevent="workspaceDropdownContextMenu"
    >
      <button
        class="context-menu-item"
        type="button"
        :aria-current="navigationContext === 'home' ? 'true' : undefined"
        @click="selectContext('home')"
      >
        <House :size="16" /><span class="recent-name">{{ t('主页') }}</span>
        <Check v-if="navigationContext === 'home'" :size="15" />
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
          <component :is="extensions.regions['workspace-settings']" :actions="extensionActions" />
        </template>
        <template #default>
          <button
            role="menuitem"
            @click="
              workspaceMenu = false;
              commandPaletteOpened = true;
            "
          >
            <Search :size="16" />{{ t('命令中心') }}
            <span class="menu-shortcut"><ShortcutHint :label="shortcutHint('commandPalette')" /></span>
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
            /><span class="recent-name">{{ workspace.name }}</span>
            <Check v-if="navigationContext === 'workspace'" :size="15" />
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
                <span class="workspace-list-avatar">
                  <WorkspaceIcon
                    :icon="item.id === workspace?.id ? store.workspaceSettings.icon : item.icon"
                    :mode="store.isDemo ? 'demo' : store.isWeb ? 'web' : 'local'"
                    :size="16"
                  />
                </span>
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
</template>
