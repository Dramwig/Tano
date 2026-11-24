<script setup lang="ts">
import { ref } from 'vue';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Copy,
  Download,
  GripVertical,
  LayoutGrid,
  MoreHorizontal,
  Plus,
  Redo2,
  Search,
  SlidersHorizontal,
  Table2,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-vue-next';
import { parentPath } from '@tano/protocol';
import { t } from '../../i18n/i18n';
import { aggregateData, dataValueText } from '../data-tables';
import { dataFieldIcons } from '../data-table-properties';
import type { CommentAuthor } from '../../workspace/workspace-comments';
import { useDataTablePage } from '../../composables/use-data-table-page';
import PreviewSkeleton from '../../files/components/PreviewSkeleton.vue';
import DataTableCell from './DataTableCell.vue';
import DataFieldMenu from './DataFieldMenu.vue';
import DataFieldCreate from './DataFieldCreate.vue';
import DocumentAppearance from '../../documents/components/DocumentAppearance.vue';
import DocumentComments from '../../documents/components/DocumentComments.vue';
import DocumentScrollbar from '../../documents/components/DocumentScrollbar.vue';
import DataTableCardsView from './DataTableCardsView.vue';
import DataTableViewSettings from './DataTableViewSettings.vue';
import DataTableRecordDetail from './DataTableRecordDetail.vue';
import DataTableModals from './DataTableModals.vue';

const props = defineProps<{
  tableId: string;
  controlsTarget?: string;
  commentAuthor?: CommentAuthor;
  touchLayout?: boolean;
}>();

const comments = ref<InstanceType<typeof DocumentComments>>();

const {
  document,
  store,
  attachmentService,
  openLink,
  state,
  table,
  title,
  appearance,
  updateAppearance,
  commentDocument,
  resolveCover,
  uploadCover,
  renameTitle,
  readonly,
  query,
  viewId,
  settings,
  message,
  working,
  selectedRows,
  detailId,
  fieldDraft,
  fieldOptions,
  fieldError,
  fieldMenu,
  menuField,
  creatingField,
  confirmAction,
  root,
  view,
  evaluate,
  fields,
  rows,
  pageIndex,
  pageCount,
  detail,
  pageRows,
  groups,
  allSelected,
  saved,
  aggregateLabels,
  hasAggregates,
  canReorderRows,
  changeView,
  run,
  createField,
  openFieldMenu,
  commitFieldMenu,
  editMenuField,
  insertField,
  filterField,
  setCell,
  createCellOption,
  addRow,
  duplicateRows,
  deleteRows,
  saveField,
  removeField,
  moveField,
  startColumnDrag,
  startRowDrag,
  addView,
  duplicateView,
  removeView,
  keydown,
  resize,
  width,
  openAttachment,
  uploadAttachment,
  fileInput,
  importText,
  importError,
  paste,
  download,
  chooseImport,
  importCsv,
} = useDataTablePage(props);
</script>

<template>
  <div class="data-page-layout">
    <PreviewSkeleton v-if="store.workspaceLoading?.tables" kind="spreadsheet" />
    <div v-show="!store.workspaceLoading?.tables" class="component-loading-content">
      <section
        ref="root"
        class="data-page"
        :aria-label="t('数据表工作区')"
        @paste="paste"
        @keydown="keydown"
      >
        <template v-if="table && view && state">
          <header class="data-heading document-title">
            <DocumentAppearance
              :key="tableId"
              :model-value="appearance"
              :readonly="readonly || working"
              :mode="store.isDemo ? 'demo' : store.isWeb ? 'web' : 'local'"
              :resolve-image="resolveCover"
              :resource-revision="attachmentService?.revision"
              :upload-cover="attachmentService && !store.isDemo ? uploadCover : undefined"
              @update:model-value="updateAppearance"
              @comment="comments?.showDiscussion()"
            />
            <div class="document-title-content">
              <input
                class="document-title-input"
                :aria-label="t('数据表名称')"
                :readonly="readonly || working"
                :value="title"
                @change="renameTitle"
              />
            </div>
            <Teleport :to="controlsTarget ?? document.body" :disabled="!controlsTarget" defer>
              <div
                class="data-table-controls"
                role="group"
                :aria-label="t('数据表工具')"
                @keydown.stop="keydown"
              >
                <span class="data-save-state">{{
                  state.saving
                    ? t('保存中…')
                    : state.error
                      ? t('保存暂停')
                      : saved
                        ? t('已保存')
                        : t('未保存')
                }}</span
                ><span v-if="store.workspace?.readOnly" class="data-save-state">{{ t('只读') }}</span
                ><button
                  class="icon-button"
                  :aria-label="t('撤销数据表修改')"
                  :data-tooltip="t('撤销数据表修改')"
                  :disabled="readonly || !state.undo.length"
                  @click="store.undoDataTable(tableId)"
                >
                  <Undo2 :size="16" /></button
                ><button
                  class="icon-button"
                  :aria-label="t('重做数据表修改')"
                  :data-tooltip="t('重做数据表修改')"
                  :disabled="readonly || !state.redo.length"
                  @click="store.undoDataTable(tableId, true)"
                >
                  <Redo2 :size="16" />
                </button>
                <details class="data-table-menu">
                  <summary
                    class="icon-button"
                    :aria-label="t('数据表操作')"
                    :data-tooltip="t('数据表操作')"
                  >
                    <MoreHorizontal :size="19" />
                  </summary>
                  <div>
                    <button @click="download"><Download :size="14" />{{ t('导出当前视图 CSV') }}</button
                    ><button :disabled="readonly" @click="fileInput?.click()">
                      <Upload :size="14" />{{ t('导入 CSV') }}</button
                    ><button
                      :disabled="store.workspace?.readOnly || working"
                      @click="
                        run(() =>
                          store.copyDataTable({ ...table!, name: title }, parentPath(state!.path)),
                        )
                      "
                    >
                      <Copy :size="14" />{{ t('另存副本') }}
                    </button>
                  </div>
                </details>
              </div>
            </Teleport>
          </header>
          <div v-if="state.error || state.unavailable" class="data-notice" role="alert">
            <span>{{ state.error || t('数据表已被移除或格式无效，当前内容仍保留。') }}</span
            ><button @click="run(() => store.retryDataTable(tableId!))">{{ t('重试保存') }}</button
            ><button
              @click="
                run(() => store.copyDataTable({ ...table!, name: title }, parentPath(state!.path)))
              "
              :disabled="store.workspace?.readOnly"
            >
              {{ t('另存副本') }}</button
            ><button @click="run(() => store.discardDataTable(tableId!))">
              {{ t('保留恢复文件并重新载入') }}
            </button>
          </div>
          <div class="data-view-bar">
            <div v-if="selectedRows.length" class="data-selection" role="group" :aria-label="t('已选择')">
              <span role="status">{{ t('已选择') }} {{ selectedRows.length }} {{ t('条') }}</span>
              <button
                :disabled="readonly"
                :aria-label="t('复制记录')"
                :data-tooltip="t('复制记录')"
                @click="duplicateRows(selectedRows)"
              >
                <Copy :size="16" />
              </button>
              <button
                :disabled="readonly"
                :aria-label="t('删除记录')"
                :data-tooltip="t('删除记录')"
                @click="deleteRows(selectedRows)"
              >
                <Trash2 :size="16" />
              </button>
              <button
                :aria-label="t('取消选择')"
                :data-tooltip="t('取消选择')"
                @click="selectedRows = []"
              >
                <X :size="16" />
              </button>
            </div>
            <div class="data-view-tabs panel-scrollbar" role="tablist" :aria-label="t('数据表视图')">
              <button
                v-for="item in table.views"
                :key="item.id"
                role="tab"
                :aria-selected="view.id === item.id"
                @click="
                  viewId = item.id;
                  selectedRows = [];
                "
              >
                <component
                  :is="item.type === 'cards' ? LayoutGrid : item.type === 'board' ? Columns3 : Table2"
                  :size="14"
                />{{ item.name }}</button
              ><button v-if="!readonly" class="data-icon" :aria-label="t('新增视图')" @click="addView">
                <Plus :size="14" />
              </button>
            </div>
            <div class="data-tools">
              <nav v-if="pageCount > 1" class="data-pagination" :aria-label="t('记录分页')">
                <button
                  class="data-icon"
                  :disabled="pageIndex === 0"
                  :aria-label="t('上一页记录')"
                  :data-tooltip="t('上一页记录')"
                  @click="pageIndex--"
                >
                  <ChevronLeft :size="15" />
                </button>
                <span>{{ pageIndex + 1 }} / {{ pageCount }}</span>
                <button
                  class="data-icon"
                  :disabled="pageIndex + 1 >= pageCount"
                  :aria-label="t('下一页记录')"
                  :data-tooltip="t('下一页记录')"
                  @click="pageIndex++"
                >
                  <ChevronRight :size="15" />
                </button>
              </nav>
              <label class="data-search"
                ><Search :size="14" /><input
                  v-model="query"
                  :aria-label="t('搜索记录')"
                  :placeholder="t('搜索记录')" /></label
              ><button :class="{ active: settings }" @click="settings = !settings">
                <SlidersHorizontal :size="14" />{{ t('视图设置') }}<span
                  v-if="view.filters.length"
                  class="data-filter-count"
                  >{{ view.filters.length }}</span
                ></button
              ><button
                v-if="view.type !== 'table'"
                class="data-primary"
                :disabled="readonly"
                @click="addRow"
              >
                <Plus :size="14" />{{ t('新记录') }}
              </button>
            </div>
          </div>
          <div class="data-body">
            <div class="data-grid-scroll">
              <table
                v-if="view.type === 'table'"
                class="data-grid"
                :class="{ 'data-frozen': view.freeze }"
                :style="{
                  width: `max(100%, ${fields.reduce((sum, field) => sum + width(field), 0) + (creatingField ? 240 : 60)}px)`,
                }"
                :aria-label="t('数据表记录')"
              >
                <colgroup>
                  <col style="width: 0" />
                  <col
                    v-for="field in fields"
                    :key="field.id"
                    :style="{ width: `${width(field)}px` }"
                  />
                  <col />
                </colgroup>
                <thead>
                  <tr>
                    <th class="data-row-tools">
                      <input
                        type="checkbox"
                        :aria-label="t('选择当前页记录')"
                        :checked="allSelected"
                        @change="selectedRows = allSelected ? [] : pageRows.map((row) => row.id)"
                      />
                    </th>
                    <th
                      v-for="(field, index) in fields"
                      :key="field.id"
                      :data-field="field.id"
                      :class="{ 'data-first': index === 0 }"
                    >
                      <button
                        class="data-field-heading"
                        :draggable="false"
                        @pointerdown="startColumnDrag($event, field.id)"
                        :class="{ active: fieldMenu?.id === field.id }"
                        aria-haspopup="dialog"
                        :aria-expanded="fieldMenu?.id === field.id"
                        @click="openFieldMenu(field, $event)"
                      >
                        <component
                          :is="dataFieldIcons[field.type]"
                          class="data-field-type"
                          :size="14"
                        />
                        <span>{{ field.name }}</span
                        ><ChevronDown :size="12" /></button
                      ><button
                        v-if="!readonly"
                        class="data-column-resize"
                        :aria-label="t('调整 {0} 列宽', [field.name])"
                        @pointerdown="resize($event, field)"
                        @keydown.left.prevent="
                          changeView((view) => {
                            view.widths[field.id] = Math.max(80, width(field) - 10);
                          })
                        "
                        @keydown.right.prevent="
                          changeView((view) => {
                            view.widths[field.id] = Math.min(1200, width(field) + 10);
                          })
                        "
                      />
                    </th>
                    <th>
                      <DataFieldCreate
                        v-model:open="creatingField"
                        :readonly="readonly"
                        :create="createField"
                        @update:open="fieldMenu = undefined"
                      />
                    </th>
                  </tr>
                </thead>
                <tbody v-for="group in groups" :key="group.label">
                  <tr v-if="group.label" class="data-group-row">
                    <td :colspan="fields.length + 2">
                      <strong>{{ group.label }}</strong
                      ><span>{{ group.rows.length }} {{ t('条') }}</span>
                    </td>
                  </tr>
                  <tr
                    v-for="row in group.rows"
                    :key="row.id"
                    :data-row="row.id"
                    :class="{ selected: selectedRows.includes(row.id) }"
                  >
                    <td class="data-row-tools">
                      <button
                        v-if="!readonly"
                        class="data-row-drag"
                        :draggable="false"
                        :disabled="!canReorderRows"
                        :aria-label="t('拖动调整行顺序')"
                        :data-tooltip="
                          canReorderRows
                            ? t('拖动调整行顺序')
                            : t('请先清除排序，再拖动调整行顺序')
                        "
                        @pointerdown="startRowDrag($event, row.id)"
                      >
                        <GripVertical :size="14" />
                      </button>
                      <input
                        v-model="selectedRows"
                        type="checkbox"
                        :value="row.id"
                        :aria-label="t('选择记录 {0}', [dataValueText(evaluate!(row, table.fields[0].id).value) || row.id])"
                      />
                    </td>
                    <td
                      v-for="(field, index) in fields"
                      :key="field.id"
                      :data-field="field.id"
                      :class="{ 'data-first': index === 0 }"
                    >
                      <DataTableCell
                        :field="field"
                        :create-option="
                          (name, expected) => createCellOption(row.id, field.id, name, expected)
                        "
                        :can-upload="!!attachmentService && !store.isDemo && !working"
                        @upload="uploadAttachment(row.id, field.id, $event)"
                        :value="evaluate!(row, field.id).value"
                        :error="evaluate!(row, field.id).error"
                        :readonly="readonly"
                        :wrap="view.fieldWrap?.[field.id] ?? view.wrap"
                        :files="store.workspace?.files ?? []"
                        @change="(value, expected) => setCell(row.id, field.id, value, expected)"
                        @edit-field="fieldMenu = { id: field.id, anchor: $event }"
                        @error="message = $event"
                        @open="openAttachment"
                        @link="openLink($event)"
                      />
                    </td>
                    <td>
                      <button
                        class="data-row-open"
                        :aria-label="t('展开记录 {0}', [dataValueText(evaluate!(row, table.fields[0].id).value) || row.id])"
                        @click="detailId = row.id"
                      >
                        {{ t('展开') }}
                      </button>
                    </td>
                  </tr>
                </tbody>
                <tbody>
                  <tr v-if="!rows.length">
                    <td :colspan="fields.length + 2" class="data-empty">
                      {{
                        table.rows.length
                          ? t('没有符合当前筛选条件的记录')
                          : t('从第一条记录开始，也可以直接粘贴多行多列数据')
                      }}
                    </td>
                  </tr>
                  <tr>
                    <td :colspan="fields.length + 2" class="data-add-record-cell">
                      <button class="data-add-row" :disabled="readonly" @click="addRow">
                        <Plus :size="12" />{{ t('添加记录') }}
                      </button>
                    </td>
                  </tr>
                </tbody>
                <tfoot v-if="hasAggregates">
                  <tr>
                    <td />
                    <td v-for="field in fields" :key="field.id" :data-field="field.id">
                      <div
                        v-if="(view.aggregates[field.id] ?? 'none') !== 'none'"
                        class="data-aggregate"
                        :aria-label="t('{0} 汇总', [field.name])"
                      >
                        <span>{{ aggregateLabels[view.aggregates[field.id]!] }}</span>
                        <span class="data-aggregate-value">{{
                          aggregateData(rows, field.id, view.aggregates[field.id] ?? 'none', evaluate!)
                        }}</span>
                      </div>
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
              <DataTableCardsView
                v-else
                :table="table"
                :view="view"
                :fields="fields"
                :groups="groups"
                :evaluate="evaluate!"
                :files="store.workspace?.files ?? []"
                @select-row="detailId = $event"
              />
              <div
                v-if="store.workspace && commentDocument"
                class="data-comments"
                @keydown.stop
                @paste.stop
              >
                <DocumentComments
                  :key="tableId"
                  ref="comments"
                  :workspace-id="store.workspace.id"
                  :document="commentDocument"
                  :readonly="readonly"
                  :author="commentAuthor ?? { id: 'local', name: t('本机用户') }"
                  :capture-selection="() => null"
                  :focus-anchor="() => {}"
                  :geometry="() => null"
                />
              </div>
            </div>
            <DataTableViewSettings
              v-if="settings"
              :table="table"
              :view="view"
              :readonly="readonly"
              :change-view="changeView"
              @close="settings = false"
              @duplicate-view="duplicateView"
              @remove-view="removeView"
            />
            <DataTableRecordDetail
              v-if="detail"
              :table="table"
              :detail="detail"
              :evaluate="evaluate!"
              :readonly="readonly"
              :can-upload="!!attachmentService && !store.isDemo && !working"
              :files="store.workspace?.files ?? []"
              :create-cell-option="createCellOption"
              @close="detailId = ''"
              @upload="(rowId, fieldId, file) => uploadAttachment(rowId, fieldId, file)"
              @change="(rowId, fieldId, value, expected) => setCell(rowId, fieldId, value, expected)"
              @edit-field="(fieldId, anchor) => (fieldMenu = { id: fieldId, anchor })"
              @error="message = $event"
              @open="openAttachment"
              @link="openLink($event)"
              @duplicate="duplicateRows([$event])"
              @delete="deleteRows([$event])"
            />
          </div>
        </template>
        <div v-else class="data-empty">
          <h2>{{ t('数据表不可用') }}</h2>
          <p>{{ t('它可能已被移除，或文件格式需要修复。') }}</p>
          <p v-for="error in store.dataTableErrors" :key="error">{{ error }}</p>
          <button @click="run(() => store.refresh())">{{ t('重新载入') }}</button>
        </div>
        <p v-if="message" class="data-notice" role="status">
          {{ message
          }}<button class="data-icon" :aria-label="t('关闭提示')" @click="message = ''">
            <X :size="14" />
          </button>
        </p>
        <DataFieldMenu
          v-if="table && view && fieldMenu && menuField"
          :key="menuField.id"
          :table="table"
          :field="menuField"
          :view="view"
          :anchor="fieldMenu.anchor"
          :readonly="readonly"
          :commit="commitFieldMenu"
          @close="fieldMenu = undefined"
          @edit="editMenuField"
          @insert="insertField"
          @remove="
            removeField(menuField);
            fieldMenu = undefined;
          "
          @filter="filterField"
        />
        <input ref="fileInput" type="file" accept=".csv,text/csv" hidden @change="chooseImport" />
        <DataTableModals
          v-model:field-draft="fieldDraft"
          v-model:field-options="fieldOptions"
          v-model:import-text="importText"
          v-model:confirm-action="confirmAction"
          :table="table"
          :readonly="readonly"
          :field-error="fieldError"
          :import-error="importError"
          @move-field="moveField"
          @remove-field="removeField"
          @save-field="saveField"
          @import-csv="importCsv"
        />
      </section>
      <DocumentScrollbar v-if="!touchLayout" :scroll-element="root" />
    </div>
  </div>
</template>

<style scoped>
.data-page-layout {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  background: var(--paper);
}
.data-page {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  flex: 1;
  overflow: auto;
  background: var(--paper);
  color: var(--text);
  font-size: 13px;
}
.data-page button,
.data-table-menu button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 9px;
  border-radius: 5px;
  font: inherit;
  cursor: pointer;
}
.data-page button:hover,
.data-table-menu button:hover {
  background: var(--hover);
}
.data-page button:disabled,
.data-table-controls button:disabled {
  opacity: 0.45;
  cursor: default;
}
.data-page .data-primary {
  background: var(--green-fill);
  color: var(--on-accent, white);
  white-space: nowrap;
}
.data-page .data-primary:hover {
  background: var(--green-fill-hover);
}
.data-page input:not(.document-title-input),
.data-page select,
.data-page textarea {
  font: inherit;
  color: inherit;
}
.data-page .data-icon {
  padding: 6px;
  flex: none;
}
.data-heading {
  --document-inset-start: 28px;
  --document-inset-end: 28px;
  flex: none;
  padding: 22px var(--document-inset-end) 12px var(--document-inset-start);
  margin-bottom: 40px;
}
.data-heading :deep(.document-title-content),
.data-heading :deep(.document-appearance-content) {
  max-width: none;
}
.data-page .document-title-input {
  padding: 0;
  font-size: clamp(28px, 3vw, 40px);
}
.data-save-state {
  color: var(--muted);
  white-space: nowrap;
  font-size: 11px;
}
.data-table-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}
.data-table-controls > .icon-button {
  padding: 0;
  flex: none;
}
.data-view-bar {
  position: relative;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 0 28px 6px;
  flex-wrap: wrap;
}
.data-view-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: auto;
}
.data-view-tabs > button {
  border-radius: 16px;
  white-space: nowrap;
  padding: 6px 10px;
  color: var(--muted);
}
.data-view-tabs > button[aria-selected='true'] {
  color: var(--text);
  background: var(--sidebar);
}
.data-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  flex-wrap: wrap;
}
.data-pagination {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--muted);
  font-size: 11px;
  white-space: nowrap;
}
.data-tools .active {
  background: var(--accent);
  color: var(--green);
}
.data-search {
  display: flex;
  align-items: center;
  color: var(--muted);
  gap: 6px;
}
.data-search input {
  background: transparent;
  border: 0;
  width: 115px;
  padding: 5px 0;
  outline: none;
}
.data-filter-count {
  background: var(--accent);
  border-radius: 4px;
  padding: 0 4px;
}
.data-body {
  flex: 1 0 auto;
  display: flex;
  min-height: 240px;
  min-width: 0;
  position: relative;
}
.data-grid-scroll {
  flex: 1;
  min-width: 0;
  overflow: visible;
  padding: 0 28px 24px 48px;
}
.data-grid {
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
  font-size: 12px;
}
.data-grid th,
.data-grid td {
  padding: 0;
  border-bottom: 1px solid var(--line);
  border-right: 1px solid color-mix(in srgb, var(--line) 65%, transparent);
  vertical-align: top;
  text-align: left;
  font-weight: 400;
}
.data-grid td:last-child,
.data-grid th:last-child {
  border-right: 0;
}
.data-grid thead {
  position: sticky;
  top: 0;
  z-index: 10;
}
.data-grid th {
  height: 32px;
  background: var(--paper);
  position: relative;
  color: var(--muted);
}
.data-field-heading {
  cursor: grab;
  touch-action: pan-y;
  width: 100%;
  justify-content: flex-start !important;
  padding: 8px 9px !important;
  overflow: hidden;
  white-space: nowrap;
  border-radius: 0 !important;
}
.data-field-heading > span {
  overflow: hidden;
  text-overflow: ellipsis;
}
.data-field-heading > svg:last-child {
  margin-left: auto;
  flex: none;
  opacity: 0;
}
.data-field-heading:hover > svg:last-child,
.data-field-heading:focus-visible > svg:last-child,
.data-field-heading.active > svg:last-child {
  opacity: 1;
}
.data-field-heading.active {
  background: var(--sidebar);
}
.data-field-type {
  font-size: 11px;
  color: var(--muted);
  flex: none;
}
.data-column-resize {
  position: absolute;
  padding: 0 !important;
  top: 0;
  right: -3px;
  height: 100%;
  width: 6px;
  cursor: col-resize !important;
  z-index: 2;
  border-radius: 0 !important;
}
.data-column-resize:hover {
  background: transparent !important;
}
.data-column-resize::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
  transform: translateX(-50%);
  pointer-events: none;
}
.data-column-resize:hover::after {
  background: var(--green);
}
.data-row-tools {
  position: relative;
  width: 0;
  padding: 0 !important;
  border: 0 !important;
  background: transparent !important;
}
.data-row-tools::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  width: 48px;
}
.data-page .data-row-drag {
  position: absolute;
  right: 23px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 1;
  width: 20px;
  height: 26px;
  padding: 0;
  opacity: 0;
  pointer-events: none;
  cursor: grab;
  color: var(--muted);
}
.data-grid tr:hover .data-row-drag,
.data-grid tr:focus-within .data-row-drag,
.data-grid tr.selected .data-row-drag {
  opacity: 1;
  pointer-events: auto;
}
.data-row-drag {
  touch-action: none;
}
.data-row-tools input {
  position: absolute;
  z-index: 1;
  right: 7px;
  top: 50%;
  transform: translateY(-50%);
  accent-color: var(--green);
  margin: 0;
  opacity: 0;
  pointer-events: none;
}
.data-grid tr:hover > .data-row-tools input,
.data-grid tr:focus-within > .data-row-tools input,
.data-row-tools input:checked,
.data-row-tools input:indeterminate {
  opacity: 1;
  pointer-events: auto;
}
@media (hover: none) {
  .data-page .data-row-drag,
  .data-row-tools input {
    opacity: 1;
    pointer-events: auto;
  }
}
.data-frozen .data-row-tools {
  position: sticky;
  left: 0;
  z-index: 3;
}
.data-frozen .data-first {
  position: sticky;
  left: 0;
  background: var(--paper);
  z-index: 3;
}
.data-grid tr:hover > td:not(.data-add-record-cell) {
  background: var(--sidebar);
}
.data-grid tr.selected > td {
  background: var(--accent);
}
.data-page .data-row-open {
  color: var(--muted);
  font-size: 10px;
  margin-top: 3px;
}
.data-grid .data-add-record-cell {
  padding: 4px 0;
}
.data-page .data-add-row {
  width: auto;
  gap: 4px;
  color: var(--muted);
  padding: 3px 6px;
  line-height: 16px;
}
.data-group-row td {
  background: var(--surface) !important;
  padding: 12px 10px !important;
}
.data-group-row span {
  color: var(--muted);
  margin-left: 12px;
  font-size: 11px;
}
.data-grid tfoot td {
  border: 0;
}
.data-aggregate {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
  align-items: center;
  min-height: 36px;
  padding: 8px 9px;
  color: var(--muted);
  font-size: 11px;
  white-space: nowrap;
}
.data-aggregate-value {
  font-variant-numeric: tabular-nums;
}
.data-empty {
  padding: 45px 20px !important;
  text-align: center !important;
  color: var(--muted);
}
.data-empty h2 {
  font-size: 18px;
}
.data-selection {
  position: absolute;
  left: 28px;
  bottom: calc(100% + 8px);
  z-index: 5;
  display: flex;
  align-items: center;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--paper);
  box-shadow: 0 3px 12px #00000012;
  font-size: 12px;
  white-space: nowrap;
}
.data-selection > span {
  padding: 0 12px;
  color: var(--green);
}
.data-selection > button {
  width: 36px;
  height: 34px;
  padding: 0;
  border-left: 1px solid var(--line);
  border-radius: 0;
}
.data-notice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  background: var(--warning-bg);
  color: var(--warning);
  padding: 10px 24px;
  margin: 0;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.data-notice > span {
  flex: 1;
}
.data-notice > .data-icon {
  margin-left: auto;
}
.data-table-menu {
  position: relative;
}
.data-table-menu summary {
  list-style: none;
  cursor: pointer;
}
.data-table-menu > div {
  position: absolute;
  right: 0;
  top: 32px;
  z-index: 40;
  display: flex;
  flex-direction: column;
  min-width: 190px;
  padding: 6px;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: 0 8px 24px #0002;
}
.data-table-menu button {
  justify-content: flex-start;
  text-align: left;
}
@media (max-width: 760px) {
  .data-heading {
    --document-inset-start: 12px;
    --document-inset-end: 12px;
    padding: 16px var(--document-inset-end) 16px var(--document-inset-start);
    gap: 6px;
  }
  .data-table-controls .data-save-state {
    display: none;
  }
  .data-view-bar {
    padding: 0 12px;
    gap: 0;
  }
  .data-tools {
    flex: 1;
    justify-content: space-between;
  }
  .data-grid-scroll {
    padding: 0 12px 20px 48px;
  }
  .data-selection {
    left: 12px;
  }
}
</style>
