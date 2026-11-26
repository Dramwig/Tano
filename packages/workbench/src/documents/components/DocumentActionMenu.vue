<script setup lang="ts">
import { inject, toRefs } from 'vue';
import {
  Archive,
  CheckCheck,
  Clock3,
  GitFork,
  LockKeyhole,
  MessageSquare,
  MessageSquareDiff,
  MoreHorizontal,
  MoveHorizontal,
  Plus,
  Redo2,
  Repeat2,
  Search,
  Trash2,
  Undo2,
} from 'lucide-vue-next';
import ShortcutHint from '@tano/editor/shortcut-hint';
import { vSurfaceMotion } from '@tano/editor/surface-motion';
import { t } from '../../i18n/i18n';
import type { OpenDocument } from '../../stores/workspace-types';
import {
  workbenchDocumentsKey,
  workbenchModalsKey,
  workbenchPrefsKey,
  workbenchShellKey,
} from '../../shell/workbench-context';
import DocumentExportMenu from './DocumentExportMenu.vue';
import DocumentGlobalMenu from './DocumentGlobalMenu.vue';
import DocumentPrintButton from './DocumentPrintButton.vue';
import PageDisplayOptions from '../../shell/components/PageDisplayOptions.vue';
import PluginMenu from '../../plugins/components/PluginMenu.vue';

defineProps<{
  paneId: string;
  paneActiveId: string;
  active: OpenDocument;
  isAuxiliaryWindow: boolean;
}>();

const shell = inject(workbenchShellKey);
const prefs = inject(workbenchPrefsKey);
const documents = inject(workbenchDocumentsKey);
const modals = inject(workbenchModalsKey);
if (!shell || !prefs || !documents || !modals) throw new Error('Workbench context is required');

const { workspace, store, extensions, paneButterflyScope, vButterflyPerch } = toRefs(shell);
const {
  shortcuts,
  shortcutHint,
  limitPageWidth,
  pageWidthWritable,
  setLimitPageWidth,
  workspaceLocked,
  pageLocked,
  togglePageLock,
  editorPreferences,
  showPageTitle,
  showDocumentProperties,
  showAllLineNumbers,
  toggleWorkspaceLock,
} = toRefs(prefs);
const {
  menu,
  setDocumentMenuElement,
  toggleDocumentMenu,
  documentMenuTriggerKeydown,
  documentMenuKeydown,
  openPaneSearch,
  editorReadonly,
  documentUndoAvailable,
  documentRedoAvailable,
  undoDocument,
  redoDocument,
  canAddDocumentProperty,
  addDocumentProperty,
  editing,
  paneComments,
  openDocumentDiscussion,
  suggestionModeBusy,
  documentSuggestions,
  paneReadonly,
  toggleSuggestionMode,
  referenceGraphOpened,
  showReferenceGraph,
  showOutline,
  paneSource,
  togglePageOption,
  exportBusy,
  exportDocument,
  printBusy,
  printActiveDocument,
  sessionBlocksFileMutation,
} = toRefs(documents);
const { historyPage, historyPanel, removeDocument } = toRefs(modals);
</script>

<template>
  <div class="menu-wrap">
    <button
      class="icon-button"
      :aria-label="t('文档操作')"
      v-butterfly-perch="{
        id: `document-actions:${paneButterflyScope(paneId, paneActiveId)}`,
        scope: paneButterflyScope(paneId, paneActiveId),
        label: t('文档操作按钮'),
        kind: 'component',
      }"
      :aria-expanded="menu && paneId === store.activePaneId"
      @click="toggleDocumentMenu"
      @keydown="documentMenuTriggerKeydown"
    >
      <MoreHorizontal :size="19" />
    </button>
    <div
      v-surface-motion="'App:5'"
      v-if="menu && paneId === store.activePaneId"
      :ref="setDocumentMenuElement"
      class="dropdown compact-action-menu document-dropdown"
      data-surface-role="popover"
      @keydown="documentMenuKeydown"
    >
      <PluginMenu location="document" :file-id="active.id" @selected="menu = false" />
      <button type="button" @click="openPaneSearch(paneId)">
        <Search :size="15" />{{ t('页内搜索') }}<span class="menu-shortcut"><ShortcutHint :label="shortcutHint('pageSearch')" /></span>
      </button>
      <button type="button" @click="openPaneSearch(paneId, true)">
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
      <button
        type="button"
        :disabled="editorReadonly || !!editing.active || editing.activeBusy || !paneComments.has(store.activePaneId)"
        @click="openDocumentDiscussion"
      >
        <MessageSquare :size="15" />{{ t('发起讨论') }}
      </button>
      <button
        type="button"
        :disabled="
          suggestionModeBusy ||
          (!documentSuggestions.get(active.id)?.mode &&
            (paneReadonly(active) || editing.isManaging(active.id) || editing.activeBusy)) ||
          documentSuggestions.get(active.id)?.loading ||
          documentSuggestions.get(active.id)?.reviewing
        "
        @click="toggleSuggestionMode(active.id)"
      >
        <MessageSquareDiff :size="15" />{{
          documentSuggestions.get(active.id)?.mode ? t('退出建议模式') : t('建议编辑')
        }}
      </button>
      <div class="menu-divider" role="separator" />
      <button
        type="button"
        aria-haspopup="dialog"
        :aria-expanded="referenceGraphOpened"
        @click="showReferenceGraph(paneId, active)"
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
        v-if="extensions.historyEnabled && extensions.historyView"
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
        <PageDisplayOptions
          :workspace-locked="workspaceLocked"
          :workspace-available="!!workspace"
          :auto-spacing="editorPreferences.autoSpacing ?? false"
          :show-page-title="showPageTitle"
          :show-document-properties="showDocumentProperties"
          :show-outline="showOutline"
          :show-all-line-numbers="showAllLineNumbers"
          :auxiliary-window="isAuxiliaryWindow"
          :source="paneSource(store.activeId)"
          @toggle="togglePageOption"
          @toggle-workspace-lock="toggleWorkspaceLock"
        />
      </DocumentGlobalMenu>
      <DocumentExportMenu :disabled="exportBusy" @select="exportDocument" />
      <DocumentPrintButton :busy="printBusy" :shortcut="shortcuts.print" @select="printActiveDocument" />
      <div class="menu-divider" role="separator" />
      <button
        class="danger-text"
        :disabled="
          editorReadonly ||
          sessionBlocksFileMutation(paneActiveId) ||
          (paneId === store.activePaneId && editing.activeBusy)
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
