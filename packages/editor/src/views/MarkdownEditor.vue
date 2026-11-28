<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue';
import {
  Editor,
  defaultValueCtx,
  editorStateOptionsCtx,
  editorViewCtx,
  editorViewOptionsCtx,
  parserCtx,
  remarkCtx,
  rootCtx,
  serializerCtx,
} from '@milkdown/kit/core';
import { SerializerState } from '@milkdown/kit/transformer';
import remarkGfm from 'remark-gfm';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { history, historyProviderPlugin } from '@milkdown/kit/plugin/history';
import { clipboard } from '@milkdown/kit/plugin/clipboard';
import { $prose } from '@milkdown/kit/utils';
import { NodeSelection, Plugin, Selection, TextSelection, type EditorState } from '@milkdown/kit/prose/state';
import { GapCursor, gapCursor } from '@milkdown/kit/prose/gapcursor';
import { closeHistory } from '@milkdown/kit/prose/history';
import { columnResizing, isInTable } from '@milkdown/kit/prose/tables';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { Node } from '@milkdown/kit/prose/model';
import { prism } from '@milkdown/plugin-prism';
import 'katex/dist/katex.min.css';
import {
  defaultTableColumnWidth,
  minimumTableColumnWidth,
  type CommentAnchor,
  type ReferenceIdentity,
  type ReferenceTarget,
  type SuggestionDecorations,
  type TableLayout,
} from '@tano/protocol';
import { useEditorWindow } from '../primitives/dom-context';
import { isElement } from '../primitives/dom-realm';
import { blockMotion } from '../plugins/block-motion';
import { typingMotion } from '../plugins/typing-motion';
import { inlineSourceMotion } from '../plugins/inline-source-motion';
import { captureHistory, restoreHistory } from '../core/history-transfer';
import { richViewport } from './rich-viewport';
import { autoSpacing, completeInlineObjectSpacing, inputSpacing } from '../core/auto-spacing';
import { blockMathInput, inlineMathInput, latexMathInput } from '../markdown/math';
import { createMermaidRenderer } from './mermaid-preview';
import { splitFrontmatter } from '../markdown/syntax';
import { SuggestionChangeCodec } from '../markdown/suggestion-codec';
import type { EditorExtension } from '../core/extension';
import { configureMarkdownSchema } from '../markdown/schema';
import { composeMarkdownSchemaPlugins } from '../markdown/markdown-schema-plugins';
import { blockControls } from '../plugins/blocks';
import { expandBlockSelection } from '../plugins/block-selection';
import { emptyBlockDeletion } from '../plugins/empty-block';
import { slashCommands, type ExternalSlashCommand, type SlashTranslate } from '../plugins/slash-commands';
import {
  createExternalDecorationsPlugin,
  type ExternalCodeBlockRenderer,
  type ExternalEditorDecoration,
} from '../plugins/external-decorations';
import { wikiLinkInput } from '../markdown/wiki-link';
import { commandEnabled, selectionContext, type EditorSelectionContext } from '../core/document-model';
import { availableBlockConversions } from '../plugins/block-commands';
import { liveMarkdown } from '../markdown/live-markdown';
import {
  configureMarkdownRuntime,
  defaultCapabilities,
  defaultEditorPreferences,
  normalizeCopyFormat,
  type EditorPreferences,
  type WorkspaceCapabilities,
} from '../core/runtime';
import { runtimeMarkViews } from './runtime-views';
import { footnoteNumbers, jumpToFootnote } from '../markdown/footnotes';
import { referencePicker, referencePickerKey } from '../core/reference-picker';
import { captureCaretAnchor, captureVisualAnchor, visualAnchorPlugin, visualSelection } from '../core/visual-anchor';
import { breakTableCell, nextTableRow } from '../plugins/table-commands';
import { sameMarkdownContent, tableLayoutKey, tableLayouts } from '../core/table-layout';
import { tableControls } from '../plugins/table-controls';
import { tableViewports } from './table-viewport';
import { suggestionMarks } from '../markdown/suggestion-marks';
import { pageSearchPlugin } from '../core/search';
import FrontmatterPanel from '../components/FrontmatterPanel.vue';
import LinkEditorPopover from '../components/LinkEditorPopover.vue';
import BlockContextMenu from '../components/BlockContextMenu.vue';
import { createLinkPanelController } from '../plugins/link-panel-controller';
import { createEditorClipboard } from '../plugins/editor-clipboard';
import { createEditorUploads, type ImportedResource } from '../plugins/editor-uploads';
import { createInlineSourceController } from '../plugins/inline-source-controller';
import { createChineseInputController } from '../plugins/chinese-input';
import { buildEditorNodeViews } from '../plugins/editor-node-views';
import {
  createCommentMarksPlugin,
  createEditorDecorationsBuilder,
  createReferenceFlashPlugin,
} from '../plugins/editor-decorations';
import { createBlockMenuController } from '../plugins/block-menu-controller';
import { createEditorCommandsApi } from '../plugins/editor-commands';

const window = useEditorWindow();
const document = window.document;

const props = withDefaults(
  defineProps<{
    modelValue: string;
    contentRevision?: string;
    documentId: string;
    referenceTargets?: readonly ReferenceTarget[];
    readonly?: boolean;
    /** Translate editor-owned UI text without touching document content. */
    translate?: SlashTranslate;
    shortcutHints?: Record<string, string>;
    capabilities?: WorkspaceCapabilities;
    preferences?: EditorPreferences;
    openLinksOnTap?: boolean;
    revealMarkdown?: boolean;
    showDocumentProperties?: boolean;
    extension?: EditorExtension;
    resourceRevision?: string;
    commentAnchors?: readonly { id: string; anchor: CommentAnchor }[];
    suggestionMarks?: SuggestionDecorations;
    /** Host maps a normalized transaction back to its original Markdown spelling. */
    transformChange?: (raw: string, before: string, after: string) => string;
    tableLayouts?: readonly TableLayout[];
    resolveImage?: (reference: string) => string | null;
    importFile?: (file: File, requireImage: boolean) => Promise<ImportedResource>;
    customCalloutIcon?: Component;
    slashCommands?: readonly ExternalSlashCommand[];
    decorations?: readonly ExternalEditorDecoration[];
    codeBlockRenderers?: readonly ExternalCodeBlockRenderer[];
  }>(),
  { revealMarkdown: true, showDocumentProperties: true },
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
  error: [message: string];
  openLink: [reference: string, newTab?: boolean];
  openWikiLink: [target: string];
  openReference: [identity: ReferenceIdentity];
  editSource: [];
  selectionChange: [context: EditorSelectionContext];
  blankBlockAi: [];
  tableLayoutChange: [tables: TableLayout[]];
  ready: [];
  searchChange: [];
}>();

const policy = () => props.capabilities ?? defaultCapabilities;
const referencesEnabled = () =>
  props.referenceTargets !== undefined &&
  commandEnabled('reference', policy().features);
const preferences = () => props.preferences ?? defaultEditorPreferences;
const completesTextSpacing = () => !props.readonly && preferences().completeTextSpacing === true;
const canSpaceTextInput = (view: EditorView) =>
  completesTextSpacing() && !view.composing && !referencePickerKey.getState(view.state);
const renderMermaid = createMermaidRenderer(document);
const defaultCopyAction = computed(() => {
  const format = normalizeCopyFormat(preferences().copyFormat);
  return format === 'markdown' ? 'copy' : `copy-${format}`;
});
const copyShortcutLabel =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
    ? '⌘ + C'
    : 'Ctrl + C';

const root = ref<HTMLElement>();
const frontmatterPanelRef = ref<InstanceType<typeof FrontmatterPanel>>();
const emptyDocument = ref(false);

let editor: Editor | undefined;
let bridgeView: EditorView | undefined;
let suggestionSerializer: ReturnType<typeof SerializerState.create> | undefined;
const suggestionCodec = new SuggestionChangeCodec<Node>();
let disposed = false;
let unbindExtension: (() => void) | undefined;
let lastValue = props.modelValue;
let applying = false;
let runtimeRevision = 0;
let frontmatter = splitFrontmatter(props.modelValue);
const metadata = ref(frontmatter.prefix);

function isEmptyDocument(doc: Node) {
  return (
    doc.childCount === 1 &&
    doc.firstChild?.type.name === 'paragraph' &&
    doc.firstChild.content.size === 0
  );
}

/** Initialize only the unchanged empty body, through normal editing and undo. */
function initializeBody(markdown: string, expected: string) {
  if (
    !editor ||
    !bridgeView ||
    disposed ||
    props.readonly ||
    props.modelValue !== expected ||
    lastValue !== expected ||
    !isEmptyDocument(bridgeView.state.doc)
  ) {
    return false;
  }
  return editor.action((ctx) => {
    const doc = ctx.get(parserCtx)(markdown);
    if (!doc || isEmptyDocument(doc)) return false;
    const view = ctx.get(editorViewCtx);
    props.extension?.stopHistoryCapture?.(ctx);
    try {
      if (props.extension) {
        // The host records the semantic edit before view-only normalization can
        // mark its appended transactions as excluded from collaborative undo.
        props.extension.apply(ctx, splitFrontmatter(expected).prefix + markdown, {
          addToHistory: true,
        });
        view.dispatch(
          view.state.tr.setSelection(TextSelection.atStart(view.state.doc)).scrollIntoView(),
        );
      } else {
        const tr = closeHistory(view.state.tr).replaceWith(
          0,
          view.state.doc.content.size,
          doc.content,
        );
        tr.setSelection(TextSelection.atStart(tr.doc));
        view.dispatch(tr.scrollIntoView());
        view.dispatch(closeHistory(view.state.tr));
      }
      view.focus();
    } finally {
      props.extension?.stopHistoryCapture?.(ctx);
    }
    return true;
  });
}

function preventEditorTabNavigation(event: KeyboardEvent) {
  if (event.key !== 'Tab' || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }
  const target = event.target;
  if (
    !isElement(target) ||
    !target.closest('.ProseMirror') ||
    target.closest('input, select, button, a[href], [role="button"], [role="tab"]')
  ) {
    return;
  }
  // Run after the editor keymaps so list indentation and table navigation still work.
  event.preventDefault();
}

function publishFrontmatter(markdown: string) {
  if (props.extension) {
    props.extension.updateMetadata(markdown);
  } else {
    frontmatter = splitFrontmatter(markdown);
    metadata.value = frontmatter.prefix;
    lastValue = markdown;
    emit('update:modelValue', markdown);
  }
}

const linkPanel = createLinkPanelController({
  window,
  getEditor: () => editor,
  getView: () => bridgeView,
  readonly: () => !!props.readonly,
  revealMarkdown: () => props.revealMarkdown !== false,
});

const editorClipboard = createEditorClipboard({
  document,
  readonly: () => !!props.readonly,
  preferences,
  referenceTargets: () => props.referenceTargets ?? [],
  onError: (message) => emit('error', message),
});

const editorUploads = createEditorUploads({
  document,
  getEditor: () => editor,
  isDisposed: () => disposed,
  readonly: () => !!props.readonly,
  policy,
  referencesEnabled,
  referenceTargets: () => props.referenceTargets ?? [],
  importFile: () => props.importFile,
  onError: (message) => emit('error', message),
});

const inlineSource = createInlineSourceController({
  getEditor: () => editor,
  getView: () => bridgeView,
  isDisposed: () => disposed,
  readonly: () => !!props.readonly,
  revealMarkdown: () => props.revealMarkdown !== false,
  policy,
  preferences,
  referencesEnabled,
  referenceTargets: () => props.referenceTargets ?? [],
  isApplying: () => applying,
  setApplying: (value) => {
    applying = value;
  },
  onError: (message) => emit('error', message),
  onOpenWikiLink: (target) => emit('openWikiLink', target),
  onOpenReference: (identity) => emit('openReference', identity),
  onOpenLink: (href) => emit('openLink', href),
});

const chineseInput = createChineseInputController({
  readonly: () => !!props.readonly,
  isDisposed: () => disposed,
  preferences,
  policy,
  canSpaceTextInput,
  wrapSelectedInlineSource: inlineSource.wrapSelectedInlineSource,
  insertEmptyCodeSourceText: inlineSource.insertEmptyCodeSourceText,
  fillEmptyRenderedCodeLine: inlineSource.fillEmptyRenderedCodeLine,
  insertPartialEmphasisSource: inlineSource.insertPartialEmphasisSource,
});

const blockMenu = createBlockMenuController({
  window,
  document,
  root,
  getEditor: () => editor,
  getView: () => bridgeView,
  isDisposed: () => disposed,
  readonly: () => !!props.readonly,
  policy,
  defaultCopyAction,
  clipboardContent: editorClipboard.clipboardContent,
  selectedBlocksSourceTransaction: inlineSource.selectedBlocksSourceTransaction,
  blockNodeSourceTransaction: inlineSource.blockNodeSourceTransaction,
  setLocalSourceDismissOnOutside: inlineSource.setLocalSourceDismissOnOutside,
  setApplying: (value) => {
    applying = value;
  },
  setTransitioningSource: inlineSource.setTransitioningSource,
  onError: (message) => emit('error', message),
});

const editorCommands = createEditorCommandsApi({
  getEditor: () => editor,
  getView: () => bridgeView,
  isDisposed: () => disposed,
  readonly: () => !!props.readonly,
  revealMarkdown: () => props.revealMarkdown !== false,
  policy,
  referencesEnabled,
  extension: () => props.extension,
  getModelValue: () => props.modelValue,
  getLastValue: () => lastValue,
  getFrontmatterPrefix: () => frontmatter.prefix,
  publishFrontmatter,
  getCommentAnchors: () => props.commentAnchors,
  getLocalSource: inlineSource.getLocalSource,
  toggleSourceSyntax: inlineSource.toggleSourceSyntax,
  selectedSourceTransaction: inlineSource.selectedSourceTransaction,
  blockNodeSourceTransaction: inlineSource.blockNodeSourceTransaction,
  isApplying: () => applying,
  setApplying: (value) => {
    applying = value;
  },
  onError: (message) => emit('error', message),
});

const buildDocumentDecorations = createEditorDecorationsBuilder({
  getEditor: () => editor,
  getRuntimeRevision: () => runtimeRevision,
  readonly: () => !!props.readonly,
  revealMarkdown: () => props.revealMarkdown !== false,
  policy,
  customCalloutIcon: () => props.customCalloutIcon,
  extension: () => props.extension,
  inlineSourceDestination: inlineSource.inlineSourceDestination,
});

const referenceFlash = createReferenceFlashPlugin();
const commentMarks = createCommentMarksPlugin(() => props.commentAnchors);
const externalDecorations = createExternalDecorationsPlugin({
  getDecorations: () => props.decorations ?? [],
  getMarkdown: () => lastValue,
  getFrontmatterPrefix: () => frontmatter.prefix,
});

const clipboardPlugin = $prose(
  (ctx) =>
    new Plugin({
      props: {
        handleDOMEvents: {
          copy: (view, event) => editorClipboard.copySelectionWithPreference(ctx, view, event),
          cut: (view, event) => editorClipboard.copySelectionWithPreference(ctx, view, event),
        },
      },
    }),
);

// Capture every transaction synchronously: a debounced editor listener loses the
// final keystrokes when a tab is closed or switched before its debounce fires.
const changeBridge = $prose(
  (ctx) =>
    new Plugin({
      appendTransaction(transactions, _previous, state) {
        return inlineSource.appendSourceTransaction(ctx, transactions, state);
      },
      view: (view) => {
        bridgeView = view;
        emptyDocument.value = isEmptyDocument(view.state.doc);
        emit('selectionChange', {
          ...selectionContext(view.state),
          availableBlockCommands: availableBlockConversions(view.state),
        });
        return {
          update(view, previous) {
            emptyDocument.value = isEmptyDocument(view.state.doc);
            if (blockMenu.blockMenu.value && !previous.doc.eq(view.state.doc)) {
              blockMenu.closeBlockMenu(false);
            }
            const activated = inlineSource.consumeSourceActivationPending();
            const source = inlineSource.currentSource(view);
            if (
              inlineSource.getLocalSource() &&
              source &&
              (view.state.selection.from < source.pos + 1 ||
                view.state.selection.to > source.pos + source.node.nodeSize - 1)
            ) {
              inlineSource.finishLocalSource(ctx, view);
              return;
            }
            if (
              !previous.selection.eq(view.state.selection) ||
              !previous.doc.eq(view.state.doc) ||
              previous.storedMarks !== view.state.storedMarks
            ) {
              emit('selectionChange', {
                ...selectionContext(view.state),
                availableBlockCommands: availableBlockConversions(view.state),
              });
            }
            if (activated || applying || disposed || props.readonly || previous.doc.eq(view.state.doc)) {
              return;
            }
            if (sameMarkdownContent(previous.doc, view.state.doc)) return;
            // Column padding depends on the widest cell: typing in that cell
            // otherwise looks like edits to every row. Use stable table spacing
            // for the transaction diff; transformChange restores source spelling.
            let serialize = ctx.get(serializerCtx);
            if (props.transformChange) {
              if (!suggestionSerializer) {
                const remark = ctx.get(remarkCtx)();
                remark.use(remarkGfm, { tablePipeAlign: false });
                suggestionSerializer = SerializerState.create(view.state.schema, remark);
              }
              serialize = suggestionSerializer;
            }
            let markdown =
              frontmatter.prefix + serialize(inlineSource.serializableDocument(view.state));
            if (props.transformChange) {
              try {
                const mapped = suggestionCodec.map({
                  previous: lastValue,
                  current: markdown,
                  prefix: frontmatter.prefix,
                  parse: ctx.get(parserCtx),
                  stableSerialize: serialize,
                  serialize: ctx.get(serializerCtx),
                  transform: props.transformChange,
                });
                if (mapped === undefined) return;
                markdown = mapped;
              } catch (error) {
                emit('error', String(error));
                // Restore the last safely represented view instead of leaving unsaved text hidden.
                const retained = lastValue;
                lastValue = markdown;
                queueMicrotask(() => {
                  if (!disposed) applyContent(retained);
                });
                return;
              }
            }
            if (markdown === lastValue) return;
            lastValue = markdown;
            emit('update:modelValue', markdown);
          },
        };
      },
      props: {
        handleTextInput(view, from, to, text) {
          return (
            chineseInput.insertChineseInput(ctx, view, from, to, text) ||
            inlineSource.insertEmptyCodeSourceText(view, from, to, text) ||
            inlineSource.fillEmptyRenderedCodeLine(view, from, to, text) ||
            inlineSource.wrapSelectedInlineSource(ctx, view, from, to, text) ||
            inlineSource.insertPartialEmphasisSource(ctx, view, from, to, text)
          );
        },
        handlePaste(view, event) {
          if (event.clipboardData?.files.length) return false;
          const selection = view.state.selection;
          if (!(selection instanceof TextSelection)) return false;
          const text = event.clipboardData?.getData('text/plain') ?? '';
          if (
            !inlineSource.insertEmptyCodeSourceText(view, selection.from, selection.to, text) &&
            !inlineSource.fillEmptyRenderedCodeLine(view, selection.from, selection.to, text)
          ) {
            return false;
          }
          event.preventDefault();
          return true;
        },
        decorations: (state) => buildDocumentDecorations(ctx, state),
        handleKeyDown(view, event) {
          if (
            event.key !== 'ArrowDown' ||
            event.shiftKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey ||
            event.isComposing ||
            event.keyCode === 229 ||
            view.composing ||
            props.readonly ||
            !view.editable
          ) {
            return false;
          }
          const { doc, selection } = view.state;
          if (selection instanceof TextSelection) {
            if (!selection.empty) return false;
            const { $head } = selection;
            // Stay within wrapped lines and nested blocks until there is no next line/block.
            for (let depth = 0; depth < $head.depth; depth++) {
              if ($head.index(depth) !== $head.node(depth).childCount - 1) return false;
            }
            if (!view.endOfTextblock('down')) return false;
          } else if (!(selection instanceof NodeSelection) || selection.to !== doc.content.size) {
            return false;
          }
          if (doc.lastChild?.eq(view.state.schema.nodes.paragraph!.create())) return false;
          editorCommands.moveToTrailingParagraph(view);
          return true;
        },
        handleDOMEvents: {
          beforeinput: (view, event) =>
            chineseInput.beforeChineseInput(ctx, view, event as InputEvent),
          mousedown(view, event) {
            if (event.button === 0) inlineSource.setSelectingWithPointer(true);
            if (
              event.button === 0 &&
              (event.ctrlKey || event.metaKey) &&
              isElement(event.target) &&
              view.dom.contains(event.target.closest('a[href], sup[data-type="footnote_reference"]'))
            ) {
              // Keep the anchor in the DOM until its click event opens it.
              event.preventDefault();
              return true;
            }
            return false;
          },
          keydown(view, event) {
            if (chineseInput.handleChineseKeyDown(ctx, view, event)) return true;
            if (
              event.key.toLowerCase() === 'a' &&
              (event.ctrlKey || event.metaKey) &&
              !event.shiftKey &&
              !event.altKey &&
              !event.isComposing &&
              event.keyCode !== 229 &&
              !view.composing &&
              !(
                isElement(event.target) &&
                event.target.closest('input, textarea, [contenteditable="false"]')
              )
            ) {
              const selection = expandBlockSelection(view.state.doc, view.state.selection);
              if (selection) {
                event.preventDefault();
                event.stopPropagation();
                // Expanding the scope must preserve the reader's viewport,
                // even when the new selection ends far outside the screen.
                view.dispatch(view.state.tr.setSelection(selection));
                return true;
              }
            }
            if (
              event.key === ' ' &&
              !event.shiftKey &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.altKey &&
              !event.isComposing &&
              !view.composing &&
              !props.readonly &&
              preferences().blankBlockAiShortcut &&
              view.state.selection instanceof TextSelection &&
              view.state.selection.empty &&
              view.state.selection.$from.parent.type.name === 'paragraph' &&
              view.state.selection.$from.parent.content.size === 0
            ) {
              event.preventDefault();
              event.stopPropagation();
              emit('blankBlockAi');
              return true;
            }
            const source = inlineSource.currentSource(view);
            if (
              (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
              !event.shiftKey &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.altKey &&
              !event.isComposing &&
              !view.composing &&
              !props.readonly &&
              inlineSource.moveAcrossInlineSourceEdge(ctx, view, event.key === 'ArrowLeft' ? -1 : 1)
            ) {
              event.preventDefault();
              return true;
            }
            if (event.key === 'Enter' && !event.altKey && isInTable(view.state)) {
              // Let the IME confirm its candidate without falling through to table keymaps.
              if (event.isComposing || event.keyCode === 229 || view.composing) return true;
              event.preventDefault();
              event.stopPropagation();
              if (props.readonly) return true;
              if (event.ctrlKey || event.metaKey || event.shiftKey) {
                if (source && inlineSource.enterInlineSourceTextblock(ctx, view, true)) return true;
                const tr = breakTableCell(view.state);
                if (tr) view.dispatch(tr);
              } else {
                if (source) inlineSource.finishLocalSource(ctx, view);
                const tr = nextTableRow(view.state);
                if (tr) view.dispatch(tr);
              }
              return true;
            }
            if (
              event.key === 'ArrowLeft' &&
              !event.shiftKey &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.altKey &&
              !event.isComposing &&
              !view.composing &&
              inlineSource.enterFootnoteLabelFromCaret(ctx, view)
            ) {
              event.preventDefault();
              return true;
            }
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.altKey &&
              !event.isComposing &&
              !view.composing &&
              !props.readonly &&
              ((source &&
                (inlineSource.enterHeadingSource(ctx, view) ||
                  inlineSource.enterInlineSourceTextblock(ctx, view))) ||
                inlineSource.enterRenderedHeading(view))
            ) {
              event.preventDefault();
              event.stopPropagation();
              return true;
            }
            if (
              source &&
              (event.ctrlKey || event.metaKey) &&
              ['b', 'i'].includes(event.key.toLowerCase())
            ) {
              event.preventDefault();
              event.stopPropagation();
              inlineSource.toggleSourceSyntax(
                view,
                event.key.toLowerCase() === 'b' ? 'bold' : 'italic',
              );
              return true;
            }
            if (
              source &&
              (event.key === 'Escape' ||
                (event.key === 'Enter' && (event.ctrlKey || event.metaKey)))
            ) {
              event.preventDefault();
              event.stopPropagation();
              inlineSource.finishLocalSource(ctx, view);
              return true;
            }
            return false;
          },
          blur(view) {
            inlineSource.finishLocalSource(ctx, view);
            return false;
          },
          compositionstart() {
            chineseInput.bumpCompositionRevision();
            return false;
          },
          compositionend(view, event) {
            chineseInput.finishChineseComposition(view, (event as CompositionEvent).data);
            queueMicrotask(() => {
              if (!disposed && !view.isDestroyed && inlineSource.getLocalSource()) {
                view.dispatch(view.state.tr);
              }
            });
            return false;
          },
          click(view, event) {
            inlineSource.endPointerSelection();
            // A native drag also ends with a click. Keep its text range instead
            // of replacing the heading/link/code DOM with an editable source.
            if (
              view.state.selection instanceof TextSelection &&
              !view.state.selection.empty &&
              event.button === 0 &&
              !event.ctrlKey &&
              !event.metaKey
            ) {
              return false;
            }
            // The native DOM selection may not have reached editor state yet.
            // Resolve textual clicks before adding delimiters changes the layout.
            if (
              event.button === 0 &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.shiftKey &&
              props.revealMarkdown !== false &&
              !props.readonly &&
              (event.clientX || event.clientY) &&
              !inlineSource.currentSource(view) &&
              isElement(event.target) &&
              !inlineSource.inlineAtomSourceRange(view, event) &&
              !event.target.closest(
                '[contenteditable="false"], .math-preview, .tano-mermaid-preview, .tano-plugin-code-preview, .tano-image-block',
              )
            ) {
              const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
              if (hit && view.state.doc.resolve(hit.pos).parent.inlineContent) {
                view.dispatch(
                  view.state.tr
                    .setSelection(TextSelection.create(view.state.doc, hit.pos))
                    .setMeta('tanoKeepNodeView', true)
                    .setMeta('addToHistory', false),
                );
              }
            }
            if (jumpToFootnote(view, event)) {
              event.preventDefault();
              return true;
            }
            if (
              event.button === 0 &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.shiftKey &&
              isElement(event.target) &&
              inlineSource.activateFootnoteLabelSource(ctx, view, event.target)
            ) {
              event.preventDefault();
              return true;
            }
            if (
              (event.ctrlKey || event.metaKey) &&
              inlineSource.openInlineSourceLink(ctx, view, event)
            ) {
              event.preventDefault();
              return true;
            }
            if (
              props.revealMarkdown !== false &&
              !props.readonly &&
              event.button === 0 &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.shiftKey &&
              inlineSource.inlineAtomSourceRange(view, event)
            ) {
              event.preventDefault();
              return inlineSource.activateInlineSource(ctx, view, event);
            }
            const link = isElement(event.target) ? event.target.closest('a[href]') : null;
            if (link) {
              event.preventDefault();
              const wikiTarget = link.getAttribute('data-tano-wiki-target');
              if (event.ctrlKey || event.metaKey) {
                linkPanel.closeLinkPanel();
                if (wikiTarget !== null) emit('openWikiLink', wikiTarget);
                else emit('openLink', link.getAttribute('href') ?? '');
                return true;
              }
              if (
                wikiTarget === null &&
                props.revealMarkdown !== false &&
                !props.readonly &&
                event.button === 0 &&
                !event.altKey &&
                !event.shiftKey
              ) {
                return inlineSource.activateLinkSource(ctx, view, link);
              }
              if (
                props.revealMarkdown === false &&
                event.button === 0 &&
                !event.altKey &&
                !event.shiftKey
              ) {
                return linkPanel.openLinkPanel(view, link);
              }
            }
            return inlineSource.activateLocalSource(ctx, view, event);
          },
        },
        markViews: runtimeMarkViews(policy()),
        nodeViews: buildEditorNodeViews({
          document,
          ctx,
          policy,
          preferences,
          readonly: () => !!props.readonly,
          revealMarkdown: () => props.revealMarkdown !== false,
          resourceRevision: () => props.resourceRevision,
          resolveImage: () => props.resolveImage,
          referencesEnabled,
          referenceTargets: () => props.referenceTargets ?? [],
          renderMermaid,
          codeBlockRenderers: () => props.codeBlockRenderers ?? [],
          getLocalSource: inlineSource.getLocalSource,
          activateReferenceSource: inlineSource.activateReferenceSource,
          onOpenReference: (identity) => emit('openReference', identity),
          onOpenLink: (url, newTab) => emit('openLink', url, newTab),
          onEditSource: () => emit('editSource'),
        }),
      },
    }),
);

onMounted(async () => {
  window.addEventListener('mouseup', inlineSource.endPointerSelection);
  window.addEventListener('blur', inlineSource.endPointerSelection);
  window.addEventListener('pointerdown', inlineSource.dismissBlockSourceOnPointer, true);
  blockMenu.mount();
  try {
    const instance = Editor.make()
      .config((ctx) => {
        configureMarkdownRuntime(ctx, policy, completesTextSpacing);
        ctx.set(rootCtx, root.value!);
        ctx.set(defaultValueCtx, frontmatter.body);
        ctx.update(editorStateOptionsCtx, (previous) => (options) => {
          const configured = previous(options);
          // Milkdown adds its input rules after $prose plugins. Let those rules
          // recognize Markdown syntax before handling ordinary text input.
          configured.plugins = [
            ...(configured.plugins ?? []),
            inputSpacing(completesTextSpacing, () => policy().features, canSpaceTextInput),
          ];
          const doc = configured.doc;
          if (!configured.selection && doc && Selection.atStart(doc) instanceof NodeSelection) {
            const start = doc.resolve(0);
            const caret =
              Selection.findFrom(start, 1, true) ??
              (doc.firstChild?.isAtom && doc.contentMatchAt(0).defaultType?.isTextblock
                ? new GapCursor(start)
                : null);
            if (caret) return { ...configured, selection: caret };
          }
          return configured;
        });
        configureMarkdownSchema(ctx);
        ctx.update(editorViewOptionsCtx, (prev) => ({
          ...prev,
          editable: () => !props.readonly,
          // Milkdown's plain-text shortcut ignores marks and single-child block
          // structure. Always serialize the slice, including partial selections,
          // so copy/cut and drag retain Markdown syntax and reference identities.
          clipboardTextSerializer: (slice, view) =>
            ctx.get(serializerCtx)(view.state.schema.topNodeType.create(null, slice.content)),
          attributes: {
            class: 'tano-prose',
            spellcheck: 'false',
            'aria-label': 'Markdown 文档编辑器',
          },
        }));
      })
      .use(
        composeMarkdownSchemaPlugins({
          commonmark,
          gfm,
          beforeGfm: [
            $prose(() =>
              columnResizing({
                cellMinWidth: minimumTableColumnWidth,
                defaultCellMinWidth: defaultTableColumnWidth,
                handleWidth: 6,
                View: null,
              }),
            ),
          ],
          afterGfm: [
            $prose(() =>
              tableLayouts(
                () => props.tableLayouts ?? [],
                (tables) => emit('tableLayoutChange', tables),
                () => !!props.readonly,
              ),
            ),
            $prose(() => tableControls(() => !!props.readonly)),
            $prose(tableViewports),
            $prose(footnoteNumbers),
            $prose(() =>
              autoSpacing(
                () => preferences().autoSpacing === true,
                () => policy().features,
              ),
            ),
          ],
          afterWikiLink: [wikiLinkInput],
          afterMathRemark: [latexMathInput],
          afterReferences: [
            $prose((ctx) =>
              referencePicker({
                enabled: () => referencesEnabled() && !props.readonly,
                targets: () => props.referenceTargets ?? [],
                completeSpacing: (tr, from) => completeInlineObjectSpacing(ctx, tr, from),
              }),
            ),
          ],
          afterMathNodes: [inlineMathInput, blockMathInput],
        }),
      )
      .use(prism)
      .use(props.extension?.ownsHistory ? [] : history)
      .use(props.extension?.plugins ?? [])
      .use(clipboard)
      .use(
        $prose(() =>
          liveMarkdown(
            () => props.revealMarkdown !== false,
            () => !!props.readonly,
            () => policy().features,
          ),
        ),
      )
      .use(
        $prose(() =>
          blockControls(
            () => !!props.readonly,
            () => preferences().folding,
            () => commandEnabled('columns', policy().features),
            blockMenu.openBlockMenu,
          ),
        ),
      )
      .use($prose(() => emptyBlockDeletion(() => !!props.readonly)))
      .use(
        $prose(() =>
          slashCommands({
            chineseSlash: () => chineseInput.chineseInputSettings().slashCommand,
            translate: props.translate,
            readonly: () => !!props.readonly,
            features: () => policy().features,
            aiShortcut: () => preferences().blankBlockAiShortcut,
            extraItems: () => props.slashCommands ?? [],
          }),
        ),
      )
      .use(clipboardPlugin)
      .use(editorUploads.plugin)
      .use(changeBridge)
      .use(commentMarks)
      .use(referenceFlash)
      .use(externalDecorations)
      .use($prose(richViewport))
      .use($prose(gapCursor))
      .use($prose(visualAnchorPlugin))
      .use(
        $prose(() =>
          blockMotion({
            structure: () => preferences().reduceEditorMotion !== true && preferences().blockMotion !== false,
            resize: () => preferences().reduceEditorMotion !== true && preferences().blockResizeMotion !== false,
          }),
        ),
      )
      .use(
        $prose(() =>
          typingMotion({
            text: () => !props.readonly && preferences().reduceEditorMotion !== true && preferences().typingMotion !== false,
            caret: () => !props.readonly && preferences().reduceEditorMotion !== true && preferences().smoothCaret !== false,
          }),
        ),
      )
      .use(
        $prose(() =>
          inlineSourceMotion({
            enabled: () => !props.readonly && preferences().reduceEditorMotion !== true && preferences().sourceRevealMotion !== false,
          }),
        ),
      )
      .use($prose(() => suggestionMarks(() => props.suggestionMarks)))
      .use($prose(() => pageSearchPlugin(() => emit('searchChange'))));
    editor = await instance.create();
    if (disposed) {
      bridgeView?.destroy();
      await editor.destroy();
      return;
    }
    if (bridgeView) linkPanel.bindOtherPanelListener(bridgeView.dom);
    if (props.extension) {
      unbindExtension = editor.action((ctx) =>
        props.extension!.bind(ctx, (markdown) => {
          frontmatter = splitFrontmatter(markdown);
          metadata.value = frontmatter.prefix;
          if (markdown !== lastValue) {
            lastValue = markdown;
            emit('update:modelValue', markdown);
          }
        }),
      );
    } else if (lastValue !== props.modelValue) {
      applyContent(props.modelValue);
    }
    emit('ready');
  } catch (error) {
    console.error('Markdown editor initialization failed', error);
    emit('error', String(error));
  }
});

function applyContent(value: string) {
  if (!editor || value === lastValue) return;

  if (!linkPanel.isWriting()) linkPanel.closeLinkPanel();
  applying = true;
  try {
    const previousBody = splitFrontmatter(lastValue).body;
    frontmatter = splitFrontmatter(value);
    metadata.value = frontmatter.prefix;
    if (props.extension) {
      inlineSource.clearLocalSource();
      editor.action((ctx) => props.extension!.apply(ctx, value));
    } else if (frontmatter.body !== previousBody) {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const doc = ctx.get(parserCtx)(frontmatter.body);
        if (!doc) throw new Error('Markdown 无法解析，编辑内容已保留');
        // Generated heading anchors are view state, not Markdown changes.
        const comparison = view.state.tr;
        view.state.doc.descendants((node, pos) => {
          if (node.type.name === 'heading' && node.attrs.id) {
            comparison.setNodeAttribute(pos, 'id', '');
          }
        });
        const from = comparison.doc.content.findDiffStart(doc.content);
        if (from === null) return;
        const end = comparison.doc.content.findDiffEnd(doc.content)!;
        // Repeated text can make the shared prefix and suffix overlap.
        const overlap = from - Math.min(end.a, end.b);
        if (overlap > 0) {
          end.a += overlap;
          end.b += overlap;
        }
        inlineSource.clearLocalSource();
        const tr = view.state.tr.replace(from, end.a, doc.slice(from, end.b));
        view.dispatch(closeHistory(tr).setMeta('addToHistory', false));
      });
    }
    lastValue = value;
  } catch (error) {
    emit('error', String(error));
  } finally {
    applying = false;
  }
}

watch(
  () => [props.modelValue, props.contentRevision] as const,
  ([value, revision], [, previousRevision]) => {
    applyContent(value);
    if (revision !== previousRevision && editor && !props.extension?.ownsHistory) {
      // A suggestion projection is a different editing context. Clear only undo
      // state, keeping the EditorView, node views, selection and layout mounted.
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const provider = historyProviderPlugin.key()?.get(view.state);
        const plugins = view.state.plugins;
        view.updateState(
          view.state
            .reconfigure({ plugins: plugins.filter((plugin) => plugin !== provider) })
            .reconfigure({ plugins }),
        );
      });
    }
  },
);
watch(
  () => props.suggestionMarks,
  () => {
    if (bridgeView && !disposed) {
      bridgeView.dispatch(bridgeView.state.tr.setMeta('addToHistory', false));
    }
  },
);
watch(
  () => props.tableLayouts,
  (tables) => {
    if (bridgeView) {
      bridgeView.dispatch(
        bridgeView.state.tr.setMeta(tableLayoutKey, tables ?? []).setMeta('addToHistory', false),
      );
    }
  },
);
watch(
  () => props.commentAnchors,
  () => {
    if (bridgeView) bridgeView.dispatch(bridgeView.state.tr.setMeta('addToHistory', false));
  },
  { deep: true },
);
watch(
  () => props.readonly,
  () => {
    if (blockMenu.blockMenu.value) blockMenu.closeBlockMenu();
    if (props.readonly) {
      frontmatterPanelRef.value?.resetEditing();
      linkPanel.closeLinkPanel();
    }
  },
);
watch(
  () => props.documentId,
  () => {
    suggestionCodec.clear();
    frontmatterPanelRef.value?.resetEditing();
    if (blockMenu.blockMenu.value) blockMenu.closeBlockMenu(false);
    linkPanel.closeLinkPanel();
  },
);
watch(
  () => JSON.stringify(policy().features),
  () => {
    editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      // ProseMirror rebuilds mark views when nodeViews changes identity.
      view.setProps({ nodeViews: { ...view.props.nodeViews }, markViews: runtimeMarkViews(policy()) });
    });
  },
);
watch(
  // Page widths are workbench layout state. Saving them must not invalidate
  // every node view (or refresh every formula/code block) in a long document.
  () =>
    JSON.stringify([
      props.readonly,
      {
        features: policy().features,
        markdownDialect: policy().markdownDialect,
        mathSyntax: policy().mathSyntax,
        mathRecognition: policy().mathRecognition,
        bulletListMarker: policy().bulletListMarker,
      },
      props.preferences,
      props.referenceTargets,
    ]),
  () =>
    editor?.action((ctx) => {
      runtimeRevision++;
      suggestionCodec.clear();
      const view = ctx.get(editorViewCtx);
      view.setProps({ editable: () => !props.readonly });
      view.dispatch(view.state.tr.setMeta('addToHistory', false));
      view.dom
        .querySelectorAll(
          '.tano-math, .tano-mermaid, .tano-code-block, .tano-image, [data-tano-live-source], [data-tano-live-inline-source]',
        )
        .forEach((node) => node.dispatchEvent(new Event('tano-math-refresh')));
    }),
);
watch(
  () => props.decorations,
  () => {
    editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.setMeta('addToHistory', false));
    });
  },
);
watch(
  () => props.codeBlockRenderers,
  () => {
    editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.setMeta('addToHistory', false));
    });
  },
);
watch(
  () => props.revealMarkdown,
  () => {
    linkPanel.closeLinkPanel();
    editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      if (props.revealMarkdown === false) inlineSource.finishLocalSource(ctx, view);
      view.dispatch(view.state.tr.setMeta('addToHistory', false));
      view.dom
        .querySelectorAll(
          '.tano-math, .tano-mermaid, .tano-code-block, .tano-image, [data-tano-live-source], [data-tano-live-inline-source]',
        )
        .forEach((node) => node.dispatchEvent(new Event('tano-math-refresh')));
    });
  },
);

defineExpose({
  captureTransferState: () => {
    if (!bridgeView || disposed || props.extension?.ownsHistory) return undefined;
    const plugin = historyProviderPlugin.key()?.get(bridgeView.state);
    return plugin
      ? {
          content: props.modelValue,
          revision: props.contentRevision,
          history: captureHistory(bridgeView.state, plugin),
        }
      : undefined;
  },
  restoreTransferState: (value: unknown) => {
    const snapshot = value as { content: string; revision: unknown; history: EditorState } | undefined;
    if (
      !snapshot ||
      !bridgeView ||
      disposed ||
      props.extension?.ownsHistory ||
      snapshot.content !== props.modelValue ||
      snapshot.revision !== props.contentRevision
    ) {
      return;
    }
    const plugin = historyProviderPlugin.key()?.get(bridgeView.state);
    if (plugin) bridgeView.updateState(restoreHistory(bridgeView.state, snapshot.history, plugin));
  },
  revealPreviewSource: editorCommands.revealPreviewSource,
  blockShortcut: blockMenu.blockShortcut,
  addDocumentProperty: async () => {
    await frontmatterPanelRef.value?.addDocumentProperty();
  },
  initializeBody,
  captureVisualAnchor: (options?: { highlight?: boolean }) =>
    bridgeView && !disposed ? captureVisualAnchor(bridgeView, options) : null,
  captureBlankBlockAnchor: () => (bridgeView && !disposed ? captureCaretAnchor(bridgeView) : null),
  visualSelection: () => (bridgeView && !disposed ? visualSelection(bridgeView) : null),
  captureModeSelection: editorCommands.captureModeSelection,
  restoreModeSelection: editorCommands.restoreModeSelection,
  revealSourceRange: editorCommands.revealSourceRange,
  modeCursorTop: editorCommands.modeCursorTop,
  applyPluginEdit: editorCommands.applyPluginEdit,
  pluginSelection: editorCommands.pluginSelection,
  applyPluginSelectionEdit: editorCommands.applyPluginSelectionEdit,
  search: editorCommands.search,
  replaceSearch: editorCommands.replaceSearch,
  searchSelection: editorCommands.searchSelection,
  focus: () => bridgeView?.focus(),
  command: editorCommands.command,
  importFiles: editorUploads.importFiles,
  withContext: editorCommands.withContext,
  commentSelection: editorCommands.commentSelection,
  assistantSelection: editorCommands.assistantSelection,
  assistantBlankBlockSelection: editorCommands.assistantBlankBlockSelection,
  captureTodoSelection: editorCommands.captureTodoSelection,
  focusComment: editorCommands.focusComment,
  commentGeometry: editorCommands.commentGeometry,
  insertBlockAtStart: editorCommands.insertBlockAtStart,
  focusTrailingParagraph: editorCommands.focusTrailingParagraph,
  canUndo: editorCommands.canUndo,
  undoLastChange: editorCommands.undoLastChange,
  canRedo: editorCommands.canRedo,
  redoLastChange: editorCommands.redoLastChange,
});

onBeforeUnmount(() => {
  chineseInput.bumpCompositionRevision();
  suggestionCodec.clear();
  editorCommands.dispose();
  disposed = true;
  blockMenu.dispose();
  linkPanel.dispose();
  window.removeEventListener('mouseup', inlineSource.endPointerSelection);
  window.removeEventListener('blur', inlineSource.endPointerSelection);
  window.removeEventListener('pointerdown', inlineSource.dismissBlockSourceOnPointer, true);
  unbindExtension?.();
  // Stop DOM observers and scheduled plugin work before Milkdown removes the
  // schema contexts asynchronously. Otherwise a queued render can use a
  // heading/node serializer whose context has already been removed.
  bridgeView?.destroy();
  void editor?.destroy();
});
</script>

<template>
  <FrontmatterPanel
    ref="frontmatterPanelRef"
    :metadata="metadata"
    :get-markdown="() => lastValue"
    :readonly="readonly"
    :show-document-properties="showDocumentProperties"
    :translate="translate"
    @publish-frontmatter="publishFrontmatter"
    @edit-source="emit('editSource')"
  />
  <div
    ref="root"
    class="milkdown-host"
    :class="{ 'tano-link-modifier': linkPanel.linkModifier.value }"
    @pointermove="linkPanel.syncLinkModifier"
    @mousedown.capture="blockMenu.rememberRightClickSelection($event); editorCommands.focusTrailingParagraph($event)"
    @contextmenu="blockMenu.openBlockMenu"
    @keydown="preventEditorTabNavigation"
  />
  <slot v-if="emptyDocument && !readonly" name="empty-document" />
  <LinkEditorPopover
    :panel="linkPanel.linkPanel.value"
    :translate="translate"
    :set-panel-element="(el) => (linkPanel.linkPanelElement.value = el)"
    :set-first-input="(el) => (linkPanel.linkPanelFirstInput.value = el)"
    @edit="linkPanel.editLinkPanel"
    @close="linkPanel.closeLinkPanel"
  />
  <BlockContextMenu
    :menu="blockMenu.blockMenu.value"
    :submenu="blockMenu.blockConvertMenu.value"
    :submenu-kind="blockMenu.blockSubmenuKind.value"
    :selection-count="blockMenu.blockMenuSelectionCount()"
    :menu-table="blockMenu.blockMenuTable.value"
    :default-copy-action="defaultCopyAction"
    :copy-shortcut-label="copyShortcutLabel"
    :special-copy-formats="blockMenu.specialCopyFormats.value"
    :shortcut-hints="shortcutHints"
    :translate="translate"
    :command-available="blockMenu.blockMenuCommandAvailable"
    :move-available="blockMenu.blockMenuMoveAvailable"
    :set-menu-element="(el) => (blockMenu.blockMenuElement.value = el)"
    :set-convert-element="(el) => (blockMenu.blockConvertElement.value = el)"
    :set-copy-trigger="(el) => (blockMenu.blockCopyTrigger.value = el)"
    :set-convert-trigger="(el) => (blockMenu.blockConvertTrigger.value = el)"
    :set-wrap-trigger="(el) => (blockMenu.blockWrapTrigger.value = el)"
    @action="blockMenu.blockMenuAction"
    @keydown="blockMenu.onBlockMenuKeydown"
    @open-submenu="blockMenu.openBlockConvertMenu"
    @schedule-close-submenu="blockMenu.scheduleCloseBlockConvertMenu"
  />
</template>
