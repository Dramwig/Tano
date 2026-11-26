<script setup lang="ts">
import { computed, inject, ref, toRefs } from 'vue';
import { AlertTriangle, ArrowUpRight, Eye, ListTodo, WrapText } from 'lucide-vue-next';
import { defaultSelectionContext } from '@tano/editor/selection-context';
import { safeRemoteImage, type WorkspacePane } from '@tano/protocol';
import { isFeatureEnabled } from '../../features';
import { t } from '../../i18n/i18n';
import type { OpenDocument } from '../../stores/workspace-types';
import { shortcutAriaLabel, shortcutKeys } from '../../shell/shortcuts';
import { createEditorPluginAdapters } from '../../plugins/editor-plugin-adapters';
import {
  CalloutIconPicker,
  CodeEditor,
  DocumentComments,
  EditorTools,
  MarkdownEditor,
  SourceEditor,
} from '../../shell/workbench-async-components';
import {
  workbenchDocumentsKey,
  workbenchModalsKey,
  workbenchPrefsKey,
  workbenchShellKey,
} from '../../shell/workbench-context';
import AssistantLauncher from '../../assistant/components/AssistantLauncher.vue';
import ButtonVisibilityGroup from '../../shell/components/ButtonVisibilityGroup.vue';
import LayoutDocumentChrome from '../../shell/components/LayoutDocumentChrome.vue';
import PageSearch from '../../shell/components/PageSearch.vue';
import PluginDocumentSlot from '../../plugins/components/PluginDocumentSlot.vue';
import DocumentScrollbar from './DocumentScrollbar.vue';
import DocumentStarter from './DocumentStarter.vue';
import DocumentSuggestions from './DocumentSuggestions.vue';
import DocumentTitle from './DocumentTitle.vue';
import MarkdownRevealToggle from './MarkdownRevealToggle.vue';
import SourceCodeIcon from './SourceCodeIcon.vue';

const props = defineProps<{
  pane: WorkspacePane;
  active: OpenDocument;
  isAuxiliaryWindow: boolean;
}>();

const isCodeDocument = computed(() => props.active.format === 'code');
const codeWordWrap = ref(false);
const codeLanguageTag = computed(() => {
  const base = props.active.path.split('/').at(-1) ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toUpperCase() : (base.toUpperCase() || 'TEXT');
});
const codeLineCount = computed(() => props.active.content.split('\n').length);
const canSwitchCodePreview = computed(() => /\.(json|jsonc|csv|tsv)$/i.test(props.active.path));
function switchCodeToPreview() {
  const entry = workspace.value?.files.find((item) => item.id === props.active.id);
  if (entry) void store.value.openAttachment(entry);
}

const shell = inject(workbenchShellKey);
const prefs = inject(workbenchPrefsKey);
const documents = inject(workbenchDocumentsKey);
const modals = inject(workbenchModalsKey);
if (!shell || !prefs || !documents || !modals) throw new Error('Workbench context is required');

const {
  workspace,
  store,
  assistant,
  extensions,
  extensionActions,
  paneButterflyScope,
  documentToolItems,
  closeButtonVisibilityMenus,
  attachments,
  touchLayout,
  openReference,
} = toRefs(shell);
const {
  shortcuts,
  shortcutHint,
  toolbarMode,
  appearance,
  revealMarkdown,
  selectedVisualFontFamily,
  visualFontSize,
  sourceFontSize,
  limitPageWidth,
  showPageTitle,
  editorPreferences,
  showAllLineNumbers,
  showDocumentProperties,
  showDocumentDiscussion,
} = toRefs(prefs);
const {
  openAssistant,
  assistantTaskActive,
  setPaneSearch,
  paneSource,
  setPaneSource,
  paneSourceEditors,
  paneEditors,
  paneReadonly,
  paneSearchRevisions,
  setPaneElement,
  scheduleActiveHeading,
  editing,
  beginSelectionTodo,
  paneComments,
  paneEditorScrolls,
  paneSelections,
  showSourceTodo,
  openPageContextMenu,
  uploadFile,
  resourceRevision,
  sessionBlocksFileMutation,
  renameDocumentTitle,
  insertBlockBelowTitle,
  commentAnchors,
  paneEditorReady,
  paneSourceSelections,
  insertSourceFiles,
  setPaneEditor,
  openDocumentLink,
  openWikiLink,
  openBlankBlockAssistant,
  startDocumentDraft,
  quickInitialize,
  chooseInitialTemplate,
  setPaneComments,
  discussWithAssistant,
  capturePaneCommentSelection,
  focusPaneComment,
  paneCommentGeometry,
  paneScrolls,
} = toRefs(documents);
const { selectedDiff, showModal } = toRefs(modals);

const documentEditorPreferences = computed(() =>
  isFeatureEnabled('markdownSpacingAutocomplete')
    ? editorPreferences.value
    : { ...editorPreferences.value, completeTextSpacing: false },
);

const {
  editorPluginSlashCommands,
  editorPluginDecorations,
  editorPluginCodeBlockRenderers,
} = createEditorPluginAdapters(
  () => store.value,
  () => workspace.value,
);
</script>

<template>
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
    :readonly="paneReadonly(active)"
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
        !paneReadonly(active)
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
          @assistant="openAssistant(pane.id, active.id)"
          annotation
          :todo="
            store.capabilities.features.objectReferences &&
            !paneReadonly(active) &&
            !editing.isManaging(active.id)
          "
          @todo="beginSelectionTodo(pane.id, active.id)"
          @annotation="paneComments.get(pane.id)?.beginAnnotation()"
          :active="pane.id === store.activePaneId"
          :editor-element="paneEditorScrolls.get(pane.id)"
          :features="store.capabilities.features"
          :context="paneSelections[pane.id] ?? defaultSelectionContext"
          :source="paneSource(pane.activeId)"
          :disabled="paneReadonly(active)"
          @command="(name, value) => paneEditors.get(pane.id)?.command(name, value)"
        >
          <template v-if="isAuxiliaryWindow || showSourceTodo(pane.id, active)" #trailing>
            <button
              v-if="showSourceTodo(pane.id, active)"
              type="button"
              class="icon-button"
              :aria-label="t('从选区创建任务或事件')"
              :data-tooltip="t('从选区创建任务或事件')"
              @mousedown.prevent
              @click="beginSelectionTodo(pane.id, active.id)"
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
            <button @click="store.resolveConflict(active, true)">
              {{ t('打开我的副本') }} <ArrowUpRight :size="14" /></button
            ><button @click="store.resolveConflict(active, false)">
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
              active.missing
                ? t('文件已在工作文件夹中移除')
                : active.creating
                  ? t('文档尚未创建成功')
                  : t('这次保存没有完成')
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
          <DocumentSuggestions
            v-slot="suggestions"
            :document="active"
            :readonly="paneReadonly(active)"
            :source="paneSource(pane.activeId)"
            :managed="!!editing.active"
            :author="extensions.commentAuthor?.() ?? { id: 'local', name: t('本机用户') }"
          >
            <PluginDocumentSlot
              v-if="workspace && pane.id === store.activePaneId"
              location="documentHeader"
              :views="store.pluginViews"
              :runtimes="store.pluginRuntime"
              :workspace-id="workspace.id"
              :execute="store.interactWithPlugin"
            />
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
              :resolve-image="(reference) => attachments ? attachments.imageUrl(workspace, active.path, reference) : safeRemoteImage(reference)"
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
            <SourceEditor
              :reference-targets="store.referenceTargets"
              :capabilities="store.capabilities"
              :preferences="documentEditorPreferences"
              :suggestion-marks="suggestions.sourceMarks"
              :translate="t"
              :show-all-line-numbers="showAllLineNumbers"
              v-if="paneSource(pane.activeId)"
              :key="active.id"
              :content-revision="suggestions.viewKey"
              :ref="(el) => setPaneElement('source', pane.id, el)"
              :model-value="suggestions.content"
              :readonly="suggestions.readonly"
              :local-native="!!attachments && !suggestions.suggesting"
              :comment-anchors="commentAnchors[active.id]"
              @ready="paneEditorReady(pane.id, active.id, true)"
              @selection-change="paneSourceSelections[pane.id] = $event"
              @update:model-value="suggestions.edit($event)"
              @files="
                (files, requireImage, position) =>
                  insertSourceFiles(files, position, requireImage, active, pane.id)
              "
            />
            <MarkdownEditor
              :shortcut-hints="{
                delete: shortcutHint('deleteBlock'),
                'move-up': shortcutHint('moveBlockUp'),
                'move-down': shortcutHint('moveBlockDown'),
                indent: shortcutHint('indentBlock'),
                outdent: shortcutHint('outdentBlock'),
              }"
              :suggestion-marks="suggestions.richMarks"
              :transform-change="suggestions.transformChange"
              v-else
              :custom-callout-icon="CalloutIconPicker"
              :slash-commands="editorPluginSlashCommands(active.id)"
              :decorations="editorPluginDecorations(active.id)"
              :code-block-renderers="editorPluginCodeBlockRenderers(active.id)"
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
              :preferences="documentEditorPreferences"
              :translate="t"
              :extension="active.id === store.active?.id ? editing.active?.extension : undefined"
              :model-value="suggestions.content"
              :table-layouts="active.tableLayout?.file.tables"
              :comment-anchors="commentAnchors[active.id]"
              :resolve-image="
                (reference) =>
                  attachments
                    ? attachments.imageUrl(workspace, active.path, reference)
                    : safeRemoteImage(reference)
              "
              :resource-revision="resourceRevision"
              :import-file="
                attachments && !suggestions.suggesting ? (file, image) => uploadFile(file, image, active) : undefined
              "
              @update:model-value="suggestions.edit($event)"
              @table-layout-change="!suggestions.suggesting && store.editTableLayout(active.id, $event)"
              @error="store.report"
              @ready="paneEditorReady(pane.id, active.id, false)"
              @search-change="paneSearchRevisions[pane.id] = (paneSearchRevisions[pane.id] ?? 0) + 1"
              @open-link="(reference, newTab) => openDocumentLink(reference, newTab, active.path)"
              @open-wiki-link="openWikiLink"
              @open-reference="openReference"
              @edit-source="setPaneSource(pane.activeId, true)"
              @selection-change="paneSelections[pane.id] = $event"
              @blank-block-ai="openBlankBlockAssistant(pane.id, active.id)"
            >
              <template
                v-if="!suggestions.suggesting && !active.missing && !active.conflict && !active.error"
                #empty-document
              >
                <DocumentStarter
                  :assistant="assistant.available"
                  :assistant-busy="assistant.busy || assistant.applying || assistant.loading"
                  @draft="startDocumentDraft(pane.id, active.id)"
                  @initialize="quickInitialize(pane.id, active.id, $event)"
                  @template="chooseInitialTemplate(pane.id, active.id)"
                />
              </template>
            </MarkdownEditor>
            <PluginDocumentSlot
              v-if="workspace && pane.id === store.activePaneId"
              location="documentFooter"
              :views="store.pluginViews"
              :runtimes="store.pluginRuntime"
              :workspace-id="workspace.id"
              :execute="store.interactWithPlugin"
            />
            <DocumentComments
              v-if="workspace"
              v-model:discussion-visible="showDocumentDiscussion"
              :ref="(el) => setPaneComments(pane.id, el)"
              :workspace-id="workspace.id"
              :document="active"
              :assistant="assistant.available"
              @assistant="discussWithAssistant(pane.id, active.id, $event)"
              :readonly="suggestions.readonly"
              :author="extensions.commentAuthor?.() ?? { id: 'local', name: t('本机用户') }"
              :capture-selection="() => capturePaneCommentSelection(pane.id, active.id)"
              :focus-anchor="(anchor) => focusPaneComment(pane.id, active.id, anchor)"
              :editor-element="paneEditorScrolls.get(pane.id)"
              :geometry="(anchors) => paneCommentGeometry(pane.id, active.id, anchors)"
              @annotations="commentAnchors[active.id] = $event"
            />
          </DocumentSuggestions>
        </div>
      </main>
    </div>
    <DocumentScrollbar v-if="!touchLayout" :scroll-element="paneScrolls.get(pane.id)" />
    <AssistantLauncher
      v-if="assistant.available && !assistant.opened"
      :scope="paneButterflyScope(pane.id, active.id)"
      :shortcut="shortcuts.toggleAssistant"
      :busy="assistant.busy || assistant.applying"
      @open="openAssistant(pane.id, active.id, { forcePanel: true })"
    />
  </div>
</template>
