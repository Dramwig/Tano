<script setup lang="ts">
import { inject, toRefs } from 'vue';
import { AlertTriangle, ArrowRight, FileText, LoaderCircle, X } from 'lucide-vue-next';
import { vSurfaceMotion } from '@tano/editor/surface-motion';
import WindowScope from '../../windows/WindowScope.vue';
import {
  AgentPanel,
  DiffDialog,
  DocumentHistoryPanel,
  ImportPanel,
  MobileRecycle,
  ObjectPanel,
  PlanDetailPanel,
  SelectionTodoDialog,
} from '../workbench-async-components';
import { workbenchContextKey } from '../workbench-context';
import CommandPalette from './CommandPalette.vue';
import NewTabPicker from '../../tabs/components/NewTabPicker.vue';
import PluginUiDialog from '../../plugins/components/PluginUiDialog.vue';
import WorkbenchSettings from '../../settings/components/WorkbenchSettings.vue';
import WorkspaceSyncPanel from '../../workspace/components/WorkspaceSyncPanel.vue';

const context = inject(workbenchContextKey);
if (!context) throw new Error('Workbench context is required');
const {
  activeWindow,
  workspace,
  mobile,
  t,
  store,
  importPanel,
  attachments,
  importRecords,
  systemSyncPanel,
  workspaceSync,
  extensions,
  extensionActions,
  recyclePanel,
  agentPanel,
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
  plans,
  assetImportBusy,
  assetPreview,
  openObjectResource,
  openObjectReference,
  createNewDocument,
  assetInput,
  planDetail,
  openPlanReference,
  selectionTodo,
  showPlanEvent,
  extensionViews,
  viewActions,
  commandPaletteOpened,
  workbenchCommands,
  settingsPanel,
  fatal,
  modal,
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
  setModalInputElement,
} = toRefs(context);
</script>

<template>
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
      <WorkspaceSyncPanel
        v-if="systemSyncPanel && workspace"
        :workspace-id="workspace.id"
        :controller="workspaceSync"
        :cloud="extensions.sync"
        @close="systemSyncPanel = false"
      />
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
      <input
        :ref="(el) => { context.assetInput = (el as HTMLInputElement | null) ?? undefined; }"
        type="file"
        multiple
        hidden
        @change="importObjectAssets"
      />
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
      <CommandPalette
        v-if="commandPaletteOpened"
        :commands="workbenchCommands"
        @close="commandPaletteOpened = false"
      />
      <WorkbenchSettings v-if="settingsPanel" />
      <div v-if="store.fileMutationPending" class="file-mutation-status" role="status">
        {{ t('正在同步更改…') }}
      </div>
      <div v-if="fatal || store.sessionError" class="error-toast" role="alert">
        <AlertTriangle :size="18" /><span>{{ fatal || store.sessionError }}</span
        ><button v-if="fatal" class="icon-button" :aria-label="t('关闭通知')" @click="fatal = ''">
          <X :size="16" />
        </button>
      </div>

      <NewTabPicker
        v-if="modal === 'newTab'"
        @close="modal = ''"
        @new-document="createNewDocument"
      />
      <div
        v-surface-motion="'App:8'"
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
                :ref="setModalInputElement"
                v-model="input"
                type="text"
                role="searchbox"
                inputmode="search"
                :aria-label="t('搜索文档名称和正文')"
                :placeholder="t('搜索文件名、路径或正文…')"
                @keydown.enter="searchResults[0] && openSearchResult(searchResults[0])"
              /><button
                type="button"
                :aria-label="t('关闭搜索')"
                :data-tooltip="t('关闭搜索')"
                @click="modal = ''"
              >
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
                :ref="setModalInputElement"
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
                {{ t('取消') }}
              </button>
              <button
                type="submit"
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
      <PluginUiDialog
        :dialog="store.activePluginDialog"
        :toasts="store.pluginToasts"
        @resolve="store.resolvePluginDialog"
        @dismiss-toast="store.dismissPluginToast"
      />
    </WindowScope>
  </Teleport>
</template>
