<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { AlignLeft, ArrowDownAZ, Braces, CalendarClock, CalendarDays, CheckSquare2, CircleHelp, Hash, List, Plus, Trash2 } from 'lucide-vue-next';
import {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewOptionsCtx,
  serializerCtx,
  parserCtx,
  editorViewCtx,
} from '@milkdown/kit/core';
import {
  commonmark,
  toggleStrongCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  imageSchema,
  sanitizeLinkHref,
} from '@milkdown/kit/preset/commonmark';
import { gfm, toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm';
import { toggleMark } from '@milkdown/kit/prose/commands';
import { history } from '@milkdown/kit/plugin/history';
import { clipboard } from '@milkdown/kit/plugin/clipboard';
import { callCommand, $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey, NodeSelection, Selection, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorState, Transaction } from '@milkdown/kit/prose/state';
import {
  closeHistory,
  redo as redoHistory,
  redoDepth,
  undo as undoHistory,
  undoDepth,
} from '@milkdown/kit/prose/history';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import type { EditorView } from '@milkdown/kit/prose/view';
import { Fragment } from '@milkdown/kit/prose/model';
import type { Mark, Node } from '@milkdown/kit/prose/model';
import type { Ctx } from '@milkdown/kit/ctx';
import { prism } from '@milkdown/plugin-prism';
import {
  inlineMath,
  blockMath,
  mathRemark,
  latexMathInput,
  mathView,
  inlineMathInput,
  blockMathInput,
} from './math';
import { mathSourcePreviewView, sourceBlockStyle } from './math-source-preview';
import { splitFrontmatter } from './syntax';
import {
  frontmatterProperties,
  frontmatterValue,
  removeFrontmatterProperty,
  updateFrontmatterProperty,
} from './frontmatter-display';
import type { FrontmatterValueKind } from './frontmatter-display';
import 'katex/dist/katex.min.css';
import type { EditorExtension } from './extension';
import { configureMarkdownSchema } from './schema';
import { codeBlankLinesRemark } from './code-blank-lines';
import { blockControls, moveBlock } from './blocks';
import { emptyBlockDeletion } from './empty-block';
import { slashCommands } from './slash-commands';
import { textStyles, underline, superscript, subscript, highlight, textColor } from './text-styles';
import { normalizeTextColor } from './text-style-markdown';
import { wikiLink, wikiLinkInput, wikiLinkRemark } from './wiki-link';
import { parseWikiLink } from './wiki-link-markdown';
import { rawBlocks } from './raw-block';
import { renderHtml } from './html-render';
import { blockType, canTransformBlock, selectionContext } from './document-model';
import type { EditorSelectionContext } from './document-model';
import { blockCommand, blockCommandNames } from './block-commands';
import { enhanced } from './enhanced';
import { enhancedViews } from './enhanced-views';
import { safeResourceUrl } from './enhanced-markdown';
import { featureLevel, commandEnabled } from './document-model';
import { activeInlineSourceRange, emptyFencedCodeBodyOffset, liveMarkdown } from './live-markdown';
import { liveInlineSource, liveSource } from './live-source';
import { sourceStyleRanges } from './source-highlight';
import { configureMarkdownRuntime, defaultCapabilities, defaultEditorPreferences } from './runtime';
import type { WorkspaceCapabilities, EditorPreferences } from './runtime';
import { runtimeViews, mermaidView } from './runtime-views';
import { footnoteNumbers, jumpToFootnote } from './footnotes';
import { references } from './references';
import { referenceViews } from './reference-views';
import { referencePicker, openReferencePicker } from './reference-picker';
import { floatingPanelPosition, positionAnchoredPanel } from './panel-position';
import type { PanelSide } from './panel-position';
import { activateEditorPanel, announceEditorPanel, createEditorPanel, onOtherEditorPanel } from './editor-panel';
import { parseReferenceUrl, resolveReference } from '@tano/protocol';
import type { ReferenceTarget, ReferenceIdentity } from '@tano/protocol';

interface ImportedResource {
  url: string;
  name: string;
  image: boolean;
}
const props = withDefaults(
  defineProps<{
    modelValue: string;
    documentId: string;
    referenceTargets?: readonly ReferenceTarget[];
    readonly?: boolean;
    enabledLevels?: readonly number[];
    capabilities?: WorkspaceCapabilities;
    preferences?: EditorPreferences;
    openLinksOnTap?: boolean;
    revealMarkdown?: boolean;
    extension?: EditorExtension;
    resourceRevision?: string;
    resolveImage?: (reference: string) => string | null;
    importFile?: (file: File, requireImage: boolean) => Promise<ImportedResource>;
  }>(),
  { revealMarkdown: true },
);
const emit = defineEmits<{
  'update:modelValue': [value: string];
  error: [message: string];
  openLink: [reference: string];
  openWikiLink: [target: string];
  openReference: [identity: ReferenceIdentity];
  editSource: [];
  selectionChange: [context: EditorSelectionContext];
}>();
const policy = () => props.capabilities ?? defaultCapabilities;
const referencesEnabled = () => props.referenceTargets !== undefined && commandEnabled('reference', props.enabledLevels, policy().features);
const preferences = () => props.preferences ?? defaultEditorPreferences;
const root = ref<HTMLElement>();
const linkModifier = ref(false);
type LinkPanel =
  | { kind: 'wiki'; pos: number; target: string; label: string; explicitLabel: boolean; x: number; y: number }
  | { kind: 'link'; from: number; to: number; text: string; href: string; title: string; x: number; y: number };
const linkPanel = shallowRef<LinkPanel | null>(null);
const linkPanelElement = ref<HTMLElement>();
const linkPanelFirstInput = ref<HTMLInputElement>();
let linkPanelAnchor: Element | null = null;
let linkPanelSide: PanelSide | undefined;
let linkPanelWriting = false;
let stopLinkPanel: (() => void) | undefined;
let stopOtherLinkPanel: (() => void) | undefined;
function closeLinkPanel() {
  stopLinkPanel?.();
  stopLinkPanel = undefined;
  linkPanel.value = null;
  linkPanelAnchor?.classList.remove('tano-editor-active');
  linkPanelAnchor = null;
  linkPanelSide = undefined;
}
function positionLinkPanel() {
  let anchor = linkPanelAnchor;
  const panel = linkPanel.value;
  if (!anchor || !panel || !linkPanelElement.value) return;
  const view = bridgeView;
  if (view && !view.dom.contains(anchor)) {
    anchor = [...view.dom.querySelectorAll<HTMLAnchorElement>('a[href]')].find((candidate) => {
      if (panel.kind === 'wiki')
        return candidate.hasAttribute('data-tano-wiki-target') && view.posAtDOM(candidate, 0) === panel.pos;
      const range = linkMarkRange(view, candidate);
      return range?.from === panel.from && range.to === panel.to;
    }) ?? null;
    if (!anchor) return closeLinkPanel();
    linkPanelAnchor?.classList.remove('tano-editor-active');
    linkPanelAnchor = anchor;
    anchor.classList.add('tano-editor-active');
  }
  const position = floatingPanelPosition(anchor, linkPanelElement.value, 0, false, linkPanelSide);
  linkPanelSide = position.side;
  linkPanel.value = { ...panel, x: position.x, y: position.y };
}
function linkMarkRange(view: EditorView, link: Element) {
  const pos = view.posAtDOM(link, 0);
  for (const candidate of [pos, pos - 1]) {
    if (candidate < 0) continue;
    const $pos = view.state.doc.resolve(candidate);
    const parent = $pos.parent;
    if (!parent.inlineContent) continue;
    const start = $pos.start();
    let offset = 0;
    const runs: { from: number; to: number; mark: Mark }[] = [];
    parent.forEach((node) => {
      const mark = node.marks.find((item) => item.type.name === 'link');
      if (mark) runs.push({ from: start + offset, to: start + offset + node.nodeSize, mark });
      offset += node.nodeSize;
    });
    const hit = runs.find((run) => run.from <= candidate && candidate < run.to);
    if (!hit) continue;
    let from = hit.from;
    let to = hit.to;
    for (let index = runs.length - 1; index >= 0; index--) {
      const run = runs[index]!;
      if (run.to === from && run.mark.eq(hit.mark)) from = run.from;
    }
    for (const run of runs) {
      if (run.from === to && run.mark.eq(hit.mark)) to = run.to;
    }
    return { from, to, mark: hit.mark };
  }
  return null;
}
function openLinkPanel(view: EditorView, link: Element) {
  if (props.readonly || props.revealMarkdown !== false) return false;
  linkPanelSide = undefined;
  const bounds = link.getBoundingClientRect();
  const wikiTarget = link.getAttribute('data-tano-wiki-target');
  if (wikiTarget !== null) {
    const pos = view.posAtDOM(link, 0);
    const node = view.state.doc.nodeAt(pos);
    if (node?.type.name !== 'tano_wiki_link') return false;
    linkPanel.value = {
      kind: 'wiki', pos, target: String(node.attrs.target),
      label: node.attrs.explicitLabel ? String(node.attrs.label) : '',
      explicitLabel: !!node.attrs.explicitLabel,
      x: bounds.left, y: bounds.bottom + 6,
    };
  } else {
    const range = linkMarkRange(view, link);
    if (!range) return false;
    linkPanel.value = {
      kind: 'link', from: range.from, to: range.to,
      text: view.state.doc.textBetween(range.from, range.to),
      href: String(range.mark.attrs.href ?? ''),
      title: String(range.mark.attrs.title ?? ''),
      x: bounds.left, y: bounds.bottom + 6,
    };
  }
  linkPanelAnchor?.classList.remove('tano-editor-active');
  linkPanelAnchor = link;
  link.classList.add('tano-editor-active');
  announceEditorPanel(view.dom, link);
  void nextTick(() => {
    if (linkPanelAnchor !== link || !linkPanelElement.value) return;
    positionLinkPanel();
    stopLinkPanel?.();
    stopLinkPanel = activateEditorPanel({
      panel: linkPanelElement.value, anchor: link, position: positionLinkPanel, close: closeLinkPanel,
    });
    linkPanelFirstInput.value?.focus();
  });
  return true;
}
function editLinkPanel(field: 'text' | 'href' | 'title' | 'target' | 'label', event: Event) {
  const panel = linkPanel.value;
  const value = (event.target as HTMLInputElement).value;
  if (!panel || !editor || props.readonly) return;
  linkPanel.value = { ...panel, [field]: value } as LinkPanel;
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    if (panel.kind === 'wiki') {
      const node = view.state.doc.nodeAt(panel.pos);
      if (node?.type.name !== 'tano_wiki_link') return closeLinkPanel();
      const target = field === 'target' ? value : panel.target;
      const label = field === 'label' ? value : panel.label;
      if (!target.trim() || /[\[\]\r\n|]/.test(target) || /[\[\]\r\n|]/.test(label)) return;
      const explicitLabel = !!label.trim();
      view.dispatch(view.state.tr.setNodeMarkup(panel.pos, undefined, {
        target, label: explicitLabel ? label : target, explicitLabel,
      }));
      return;
    }
    const text = field === 'text' ? value : panel.text;
    const href = field === 'href' ? value : panel.href;
    const title = field === 'title' ? value : panel.title;
    const first = view.state.doc.nodeAt(panel.from);
    if (!first?.isText) return closeLinkPanel();
    const oldMark = first.marks.find((mark) => mark.type.name === 'link');
    if (!oldMark) return closeLinkPanel();
    const nextMark = oldMark.type.create({ href, title: title || null });
    let tr = view.state.tr;
    if (field === 'text') {
      if (!text) return;
      const marks = first.marks.map((mark) => mark === oldMark ? nextMark : mark);
      tr = tr.replaceWith(panel.from, panel.to, view.state.schema.text(text, marks));
      linkPanel.value = { ...linkPanel.value!, to: panel.from + text.length } as LinkPanel;
    } else {
      tr = tr.removeMark(panel.from, panel.to, oldMark).addMark(panel.from, panel.to, nextMark);
    }
    linkPanelWriting = true;
    try { view.dispatch(tr); } finally { linkPanelWriting = false; }
  });
  void nextTick(positionLinkPanel);
}
function syncLinkModifier(event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey'>) {
  linkModifier.value = event.ctrlKey || event.metaKey;
}
function clearLinkModifier() {
  linkModifier.value = false;
}
const blockMenuElement = ref<HTMLElement>();
const blockMenu = shallowRef<{ index: number; x: number; y: number; doc: Node } | null>(null);
let selectionBeforeMenu: { selection: Selection; doc: Node } | null = null;
let rightClickSelection: { selection: Selection; doc: Node } | null = null;
let editor: Editor | undefined;
let disposed = false;
let unbindExtension: (() => void) | undefined;
let lastValue = props.modelValue;
let applying = false;
let runtimeRevision = 0;
let transitioningSource = false;
let sourceActivationPending = false;
let bridgeView: EditorView | undefined;
let localSource:
  | { kind: 'block'; id: string; original: Node; initial: string; style: Record<string, string> | null }
  | { kind: 'inline'; id: string; original: Fragment; initial: string }
  | { kind: 'footnote-label'; id: string; initial: string; createdParagraph: boolean }
  | undefined;
let localSourceCounter = 0;
let frontmatter = splitFrontmatter(props.modelValue);
const metadata = ref(frontmatter.prefix);
const properties = computed(() => metadata.value ? frontmatterProperties(metadata.value) : []);
const editingProperty = ref<string | null | undefined>();
const editingRowKey = ref<string>();
const editingRowHeight = ref(32);
const editingRowIndex = ref(0);
const editingOrder = ref<string[]>([]);
const propertyOrder = ref<'source' | 'name'>('source');
const propertyNameCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
const visibleProperties = computed(() => {
  const rows = [...(properties.value ?? [])];
  if (editingProperty.value !== undefined) {
    const order = new Map(editingOrder.value.map((name, index) => [name, index]));
    rows.sort((left, right) => (order.get(left.name) ?? Infinity) - (order.get(right.name) ?? Infinity));
  } else if (propertyOrder.value === 'name') {
    rows.sort((left, right) => propertyNameCollator.compare(left.name, right.name));
  }
  if (editingProperty.value === null) {
    rows.splice(Math.min(editingRowIndex.value, rows.length), 0, { name: '', value: '', kind: 'text' });
  } else if (editingProperty.value !== undefined) {
    const currentIndex = rows.findIndex((property) => property.name === editingProperty.value);
    if (currentIndex !== -1) {
      const [current] = rows.splice(currentIndex, 1);
      rows.splice(Math.min(editingRowIndex.value, rows.length), 0, current!);
    }
  }
  return rows;
});
const frontmatterPanel = ref<HTMLDetailsElement>();
let editingPropertyBase: string | null = null;
let activatingProperty = false;
const propertyName = ref('');
const propertyKind = ref<FrontmatterValueKind>('text');
const propertyInput = ref('');
const propertyError = ref('');
const propertyErrorField = ref<'name' | 'value'>('value');
const typeMenuProperty = ref<string | null | undefined>();
const propertyTypeOptions = [
  { kind: 'text', label: '文本', icon: AlignLeft },
  { kind: 'number', label: '数字', icon: Hash },
  { kind: 'boolean', label: '复选框', icon: CheckSquare2 },
  { kind: 'date', label: '日期', icon: CalendarDays },
  { kind: 'datetime', label: '日期和时间', icon: CalendarClock },
  { kind: 'list', label: '列表', icon: List },
  { kind: 'object', label: '对象', icon: Braces },
  { kind: 'null', label: '空值', icon: CircleHelp },
] as const;
function currentPropertyKind(name: string): FrontmatterValueKind {
  return editingProperty.value === name || (editingProperty.value === null && !name)
    ? propertyKind.value
    : frontmatterValue(metadata.value, name)?.kind ?? 'text';
}
function propertyTypeIcon(name: string) {
  return propertyTypeOptions.find((option) => option.kind === currentPropertyKind(name))?.icon ?? AlignLeft;
}
function editProperty(name: string | null, focus: 'name' | 'value' | false = 'value') {
  if (props.readonly || properties.value === null) return;
  if (editingProperty.value !== undefined && editingProperty.value !== name) {
    finishProperty();
    if (editingProperty.value !== undefined) return;
  }
  const current = name === null ? null : frontmatterValue(metadata.value, name);
  if (name !== null && !current) return;
  editingOrder.value = visibleProperties.value.map((property) => property.name);
  const rowIndex = name === null ? visibleProperties.value.length
    : visibleProperties.value.findIndex((property) => property.name === name);
  editingRowIndex.value = rowIndex < 0 ? visibleProperties.value.length : rowIndex;
  const row = [...(frontmatterPanel.value?.querySelectorAll<HTMLElement>('.frontmatter-property') ?? [])]
    .find((element) => element.dataset.propertyName === name);
  editingRowHeight.value = row?.offsetHeight || 32;
  editingRowKey.value = name ?? '__new__';
  activatingProperty = true;
  editingProperty.value = name;
  propertyName.value = name ?? '';
  propertyKind.value = current?.kind ?? 'text';
  propertyInput.value = current?.value ?? '';
  editingPropertyBase = current ? JSON.stringify(current) : null;
  propertyError.value = '';
  void nextTick(() => {
    if (focus) frontmatterPanel.value?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      `.frontmatter-row-editor ${name === null || focus === 'name' ? '[aria-label="属性名"]' : '[aria-label="属性值"]'}`,
    )?.focus();
    activatingProperty = false;
  });
}
function finishProperty() {
  editingProperty.value = undefined;
  typeMenuProperty.value = undefined;
  propertyError.value = '';
}
function finishPropertyOnKey(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229 ||
    (event.target as HTMLInputElement & { composing?: boolean }).composing) return;
  event.preventDefault();
  event.stopPropagation();
  finishProperty();
}
function onPropertyFocusOut(event: FocusEvent) {
  if (activatingProperty) return;
  if (event.relatedTarget instanceof globalThis.Node &&
    (event.currentTarget as HTMLElement).contains(event.relatedTarget)) return;
  finishProperty();
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
function syncProperty(event?: Event) {
  if (event instanceof InputEvent && event.isComposing) return;
  if (props.readonly || editingProperty.value === undefined) return;
  if (editingProperty.value === null && !propertyName.value.trim()) return;
  try {
    if (editingProperty.value !== null &&
      JSON.stringify(frontmatterValue(metadata.value, editingProperty.value)) !== editingPropertyBase)
      throw new Error('属性已被其他修改更新，请重新打开编辑');
    const markdown = updateFrontmatterProperty(
      lastValue,
      editingProperty.value,
      propertyName.value,
      propertyKind.value,
      propertyInput.value,
    );
    publishFrontmatter(markdown);
    editingProperty.value = propertyName.value.trim();
    editingPropertyBase = JSON.stringify(frontmatterValue(splitFrontmatter(markdown).prefix, editingProperty.value));
    propertyError.value = '';
  } catch (error) {
    propertyError.value = error instanceof Error ? error.message : String(error);
    propertyErrorField.value = event?.target instanceof Element && event.target.getAttribute('aria-label') === '属性名'
      ? 'name' : 'value';
  }
}
function convertedPropertyInput(kind: FrontmatterValueKind): string {
  const value = propertyInput.value;
  if (kind === 'number') return Number.isFinite(Number(value)) && value.trim() ? value : '0';
  if (kind === 'boolean') return value === 'true' ? 'true' : 'false';
  if (kind === 'date') return /^\d{4}[-/]\d{2}[-/]\d{2}/.test(value)
    ? value.slice(0, 10).replaceAll('/', '-') : new Date().toISOString().slice(0, 10);
  if (kind === 'datetime') {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return value;
    const date = /^\d{4}[-/]\d{2}[-/]\d{2}/.test(value)
      ? value.slice(0, 10).replaceAll('/', '-') : new Date().toISOString().slice(0, 10);
    return `${date}T00:00`;
  }
  if (kind === 'list' || kind === 'object') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (kind === 'list' && Array.isArray(parsed)) return JSON.stringify(parsed, null, 2);
      if (kind === 'object' && parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        return JSON.stringify(parsed, null, 2);
    } catch { /* Use a valid empty collection. */ }
    return kind === 'list' ? JSON.stringify(value ? [value] : [], null, 2) : '{}';
  }
  return kind === 'null' ? '' : value;
}
function openPropertyTypeMenu(name: string | null) {
  if (props.readonly) return;
  if (editingProperty.value !== name) editProperty(name, false);
  if (editingProperty.value !== name) return;
  typeMenuProperty.value = typeMenuProperty.value === name ? undefined : name;
}
function changePropertyType(kind: FrontmatterValueKind) {
  propertyInput.value = convertedPropertyInput(kind);
  propertyKind.value = kind;
  typeMenuProperty.value = undefined;
  syncProperty();
}
function deleteProperty() {
  if (props.readonly || editingProperty.value == null) return;
  try {
    if (JSON.stringify(frontmatterValue(metadata.value, editingProperty.value)) !== editingPropertyBase)
      throw new Error('属性已被其他修改更新，请重新打开编辑');
    publishFrontmatter(removeFrontmatterProperty(lastValue, editingProperty.value));
    editingProperty.value = undefined;
    typeMenuProperty.value = undefined;
    propertyError.value = '';
  } catch (error) {
    propertyError.value = error instanceof Error ? error.message : String(error);
  }
}
const uploads = new PluginKey<DecorationSet>('tano-uploads');
const editableInlineAtoms = new Set([
  'tano_reference',
  'tano_wiki_link',
  'math_inline',
  'footnote_reference',
  'html',
  'image',
]);
function isEditableInlineAtom(node: Node, parent: Node) {
  return (
    node.isInline &&
    editableInlineAtoms.has(node.type.name) &&
    !(node.type.name === 'image' && parent.type.name === 'paragraph' && parent.childCount === 1)
  );
}

async function importInto(
  ctx: Ctx,
  view: EditorView,
  file: File,
  position: number,
  requireImage: boolean,
) {
  if (!props.importFile || props.readonly) return;
  const id = crypto.randomUUID();
  view.dispatch(
    view.state.tr.setMeta(uploads, { add: { id, position } }).setMeta('addToHistory', false),
  );
  try {
    const resource = await props.importFile(file, requireImage);
    if (disposed || props.readonly) return;
    const placeholder = uploads
      .getState(view.state)
      ?.find(undefined, undefined, (spec) => spec.id === id)[0];
    if (!placeholder) throw new Error('插入位置已被删除；附件已保存在 assets 文件夹');
    const node = resource.image
      ? imageSchema.type(ctx).create({ src: resource.url, alt: resource.name })
      : commandEnabled('file', props.enabledLevels, policy().features)
        ? view.state.schema.nodes.tano_file!.create({ title: resource.name, url: resource.url })
        : view.state.schema.text(resource.name, [
            view.state.schema.marks.link!.create({ href: resource.url }),
          ]);
    view.dispatch(
      view.state.tr
        .insert(placeholder.from, node)
        .setMeta(uploads, { remove: id })
        .scrollIntoView(),
    );
  } catch (error) {
    if (!disposed) emit('error', String(error));
  } finally {
    if (!disposed)
      view.dispatch(view.state.tr.setMeta(uploads, { remove: id }).setMeta('addToHistory', false));
  }
}
function importFiles(files: File[]) {
  editor?.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    for (const file of files.slice(0, 10))
      void importInto(ctx, view, file, view.state.selection.from, false);
  });
}

function containsEmbeddedImage(data: DataTransfer | null) {
  return /<img\b[^>]*\bsrc\s*=\s*["']?data:image\//i.test(
    typeof data?.getData === 'function' ? data.getData('text/html') : '',
  );
}

function unavailableImageLabel(reference: string, alt: unknown) {
  if (typeof alt === 'string' && alt) return alt;
  if (/^data:image\//i.test(reference)) return '剪贴板内嵌图片';
  return reference.length > 160 ? `${reference.slice(0, 157)}…` : reference;
}

function sourceOffset(source: string, before: string, first: string) {
  if (!before) return first ? Math.max(0, source.indexOf(first)) : 0;
  let offset = 0;
  for (const character of before) {
    const found = source.indexOf(character, offset);
    if (found < 0) return source.length;
    offset = found + character.length;
  }
  return offset;
}

function findCurrentSource(state: EditorState) {
  if (!localSource) return undefined;
  let found: { node: Node; pos: number } | undefined;
  state.doc.descendants((node, pos) => {
    if (
      ['tano_live_source', 'tano_live_source_inline'].includes(node.type.name) &&
      node.attrs.id === localSource?.id
    )
      found = { node, pos };
  });
  return found;
}

function currentSource(view: EditorView) {
  return findCurrentSource(view.state);
}

function insertEmptyCodeSourceText(view: EditorView, from: number, to: number, text: string) {
  if (!text || props.readonly || localSource?.kind !== 'block' ||
      localSource.original.type.name !== 'code_block') return false;
  const current = currentSource(view);
  if (current?.node.attrs.origin !== 'code_block') return false;
  const bodyOffset = emptyFencedCodeBodyOffset(current.node.textContent);
  if (bodyOffset === null || from !== current.pos + 1 + bodyOffset || to !== from) return false;
  const tr = view.state.tr.insertText(`${text}\n`, from, to);
  tr.setSelection(TextSelection.create(tr.doc, from + text.length));
  view.dispatch(tr);
  return true;
}

function fillEmptyRenderedCodeLine(view: EditorView, from: number, to: number, text: string) {
  if (!text || text === '\n' || props.readonly || props.revealMarkdown !== false || from !== to)
    return false;
  const $from = view.state.doc.resolve(from);
  if ($from.parent.type.name !== 'code_block' || $from.parent.textContent !== '\n' ||
      $from.parentOffset !== 0) return false;
  view.dispatch(view.state.tr.insertText(text, from, from + 1));
  return true;
}

type InlineSourceDestination =
  | { kind: 'wiki'; target: string }
  | { kind: 'reference'; identity: ReferenceIdentity }
  | { kind: 'link'; href: string };

function inlineSourceDestination(ctx: Ctx, source: string): InlineSourceDestination | null {
  let parsed: Node | null;
  try {
    parsed = ctx.get(parserCtx)(source);
  } catch {
    return null;
  }
  if (parsed?.childCount !== 1 || parsed.firstChild?.type.name !== 'paragraph') return null;
  let destination: InlineSourceDestination | null = null;
  parsed.firstChild.forEach((node) => {
    if (destination) return;
    if (node.type.name === 'tano_wiki_link') {
      destination = { kind: 'wiki', target: String(node.attrs.target) };
    } else if (node.type.name === 'tano_reference' && referencesEnabled()) {
      const identity = parseReferenceUrl(String(node.attrs.url));
      if (identity && 'target' in resolveReference(props.referenceTargets ?? [], identity))
        destination = { kind: 'reference', identity };
    } else if (node.isText) {
      const link = node.marks.find((mark) => mark.type.name === 'link');
      const href = sanitizeLinkHref(String(link?.attrs.href ?? ''));
      if (href) destination = { kind: 'link', href };
    }
  });
  return destination;
}

function openInlineSourceLink(ctx: Ctx, view: EditorView, event: MouseEvent) {
  if (!(event.target instanceof Element)) return false;
  const sourceDom = event.target.closest('[data-tano-live-inline-source]');
  if (!sourceDom || !view.dom.contains(sourceDom)) return false;
  const source = currentSource(view);
  if (source?.node.type.name !== 'tano_live_source_inline') return false;
  const destination = inlineSourceDestination(ctx, source.node.textContent);
  if (!destination) return false;
  if (destination.kind === 'wiki') emit('openWikiLink', destination.target);
  else if (destination.kind === 'reference') emit('openReference', destination.identity);
  else emit('openLink', destination.href);
  return true;
}

function sourceId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `local-${++localSourceCounter}`;
}

function inlineAtomSourceRange(view: EditorView, event: MouseEvent | KeyboardEvent) {
  if (!(event.target instanceof Element)) return null;
  if (event.target.closest('button, input, textarea')) return null;
  const atom = event.target.closest(
    'a[data-tano-wiki-target], .math-inline, sup[data-type="footnote_reference"], .tano-html-node, .tano-image',
  );
  if (!atom || !view.dom.contains(atom)) return null;
  const pos = view.posAtDOM(atom, 0);
  for (const candidate of [pos, pos - 1]) {
    const node = view.state.doc.nodeAt(candidate);
    if (node && isEditableInlineAtom(node, view.state.doc.resolve(candidate).parent))
      return { from: candidate, to: candidate + node.nodeSize };
  }
  const selection = view.state.selection;
  if (
    selection instanceof NodeSelection &&
    isEditableInlineAtom(selection.node, selection.$from.parent)
  )
    return { from: selection.from, to: selection.to };
  return null;
}

function markAtCaret(view: EditorView, event?: MouseEvent | KeyboardEvent) {
  const anchor = event?.target instanceof Element
    ? event.target
    : view.dom.ownerDocument.getSelection()?.anchorNode;
  const element = anchor instanceof Element ? anchor : anchor?.parentElement;
  if (!element || !view.dom.contains(element)) return undefined;
  const marked = element.closest('strong, em, code, del, u, sup, sub, mark, span[style], a');
  if (!marked || !view.dom.contains(marked)) return undefined;
  const names: Record<string, string> = {
    strong: 'strong',
    em: 'emphasis',
    code: 'inlineCode',
    del: 'strike_through',
    u: 'underline',
    sup: 'superscript',
    sub: 'subscript',
    mark: 'highlight',
    span: 'text_color',
    a: 'link',
  };
  return names[marked.tagName.toLowerCase()];
}

function inlineSourceTransaction(
  ctx: Ctx,
  state: EditorState,
  range: { from: number; to: number },
  tr: Transaction = state.tr,
) {
  const $from = tr.doc.resolve(range.from);
  const original = $from.parent.cut(range.from - $from.start(), range.to - $from.start()).content;
  const paragraph = state.schema.nodes.paragraph!.create(null, original);
  const source = ctx
    .get(serializerCtx)(state.schema.nodes.doc!.create(null, [paragraph]))
    .replace(/\n+$/, '');
  const before = tr.doc.textBetween(
    range.from,
    Math.max(range.from, Math.min(range.to, tr.selection.from)),
  );
  const offset = Math.min(
    source.length,
    sourceOffset(source, before, tr.doc.textBetween(range.from, range.to)[0] ?? ''),
  );
  const id = sourceId();
  const footnote = original.firstChild?.type.name === 'footnote_reference'
    ? String(original.firstChild.attrs.label)
    : '';
  const node = liveInlineSource
    .type(ctx)
    .create(
      { id, origin: original.firstChild?.type.name === 'math_inline' ? 'math_inline' : '', footnoteLabel: footnote },
      source ? state.schema.text(source) : undefined,
    );
  localSource = { kind: 'inline', id, original, initial: source };
  tr.replaceWith(range.from, range.to, node);
  tr.setSelection(TextSelection.create(tr.doc, range.from + 1 + offset));
  tr.setMeta('addToHistory', false);
  return tr;
}

function activateInlineSource(ctx: Ctx, view: EditorView, event?: MouseEvent | KeyboardEvent) {
  const range =
    (event ? inlineAtomSourceRange(view, event) : null) ??
    activeInlineSourceRange(view.state, markAtCaret(view, event));
  if (!range) return false;
  const tr = inlineSourceTransaction(ctx, view.state, range);
  applying = true;
  try {
    view.dispatch(tr);
  } finally {
    applying = false;
  }
  focusRevealedSource(view, event);
  return true;
}

// Resolve the pointer against the newly rendered source so the caret stays at
// the click, even when delimiters or a block preview change the layout.
function focusRevealedSource(view: EditorView, event?: MouseEvent | KeyboardEvent) {
  view.focus();
  if (!(event instanceof MouseEvent) || (!event.clientX && !event.clientY)) return;
  const source = currentSource(view);
  if (!source) return;
  const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!hit) return;
  const pos = Math.max(source.pos + 1, Math.min(source.pos + source.node.nodeSize - 1, hit.pos));
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos))
    .setMeta('addToHistory', false));
}

function activateLinkSource(ctx: Ctx, view: EditorView, link: Element, event: MouseEvent) {
  const range = linkMarkRange(view, link);
  if (!range) return false;
  const selection = TextSelection.create(view.state.doc,
    Math.max(range.from, Math.min(range.to, view.state.selection.from)));
  const tr = inlineSourceTransaction(ctx, view.state, range, view.state.tr.setSelection(selection));
  applying = true;
  try {
    view.dispatch(tr);
  } finally {
    applying = false;
  }
  focusRevealedSource(view, event);
  return true;
}

function blockNodeSourceTransaction(
  ctx: Ctx,
  state: EditorState,
  selected: { node: Node; pos: number },
  tr: Transaction,
) {
  const source = ctx
    .get(serializerCtx)(state.schema.nodes.doc!.create(null, [selected.node]))
    .replace(/\n+$/, '');
  const before = tr.doc.textBetween(selected.pos,
    Math.max(selected.pos, Math.min(selected.pos + selected.node.nodeSize, tr.selection.from)), '\n');
  const offset = selected.node.type.name === 'code_block'
    ? Math.min(
        source.length,
        source.indexOf('\n') + 1 + Math.max(0, tr.selection.from - selected.pos - 1),
      )
    : Math.min(
        source.length,
        sourceOffset(source, before, selected.node.textContent[0] ?? ''),
      );
  const id = sourceId();
  // A previous source block may already have been replaced in this transaction.
  // Read the target's DOM at its position in the still-rendered document.
  const renderedPos = tr.mapping.invert().map(selected.pos, -1);
  const rendered = bridgeView?.state.doc === state.doc &&
    state.doc.nodeAt(renderedPos)?.eq(selected.node)
    ? bridgeView.nodeDOM(renderedPos)
    : null;
  // A Mermaid preview is a div with no vertical padding. Its padding must not
  // become the fence line height of the editable <pre> source block.
  const style = selected.node.type.name === 'code_block' &&
    !(rendered instanceof HTMLElement && rendered.matches('pre'))
    ? null
    : sourceBlockStyle(rendered);
  const sourceNode = liveSource
    .type(ctx)
    .create(
      { id, origin: selected.node.type.name, level: Number(selected.node.attrs.level ?? 0) },
      source ? state.schema.text(source) : undefined,
    );
  localSource = { kind: 'block', id, original: selected.node, initial: source, style };
  tr.replaceWith(selected.pos, selected.pos + selected.node.nodeSize, sourceNode);
  tr.setSelection(TextSelection.create(tr.doc, selected.pos + 1 + offset));
  tr.setMeta('addToHistory', false);
  return tr;
}

function caretBlockSourceTransaction(ctx: Ctx, state: EditorState, tr: Transaction = state.tr) {
  const $cursor = tr.selection.$from;
  for (let depth = $cursor.depth; depth > 0; depth--) {
    const node = $cursor.node(depth);
    if (
      (node.type.name === 'heading' && node.textContent) ||
      (node.type.name === 'code_block' && String(node.attrs.language).toLowerCase() !== 'mermaid')
    )
      return blockNodeSourceTransaction(ctx, state, { node, pos: $cursor.before(depth) }, tr);
  }
  return null;
}

function previewBlockSourceTransaction(ctx: Ctx, view: EditorView, target: Element) {
  const block = target.closest('.math-block, .tano-mermaid, .tano-image-block');
  if (!block || !view.dom.contains(block)) return null;
  const image = block.classList.contains('tano-image-block');
  const expected = block.classList.contains('math-block') ? 'math_block' : 'code_block';
  const pos = view.posAtDOM(block, 0);
  for (const candidate of [pos, pos - 1]) {
    const node = view.state.doc.nodeAt(candidate);
    if (image) {
      if (node?.type.name !== 'image') continue;
      const $pos = view.state.doc.resolve(candidate);
      const paragraph = $pos.parent;
      if (paragraph.type.name === 'paragraph' && paragraph.childCount === 1) {
        const container = $pos.node($pos.depth - 1);
        const index = $pos.index($pos.depth - 1);
        if (container.canReplaceWith(index, index + 1, liveSource.type(ctx)))
          return blockNodeSourceTransaction(
            ctx,
            view.state,
            { node: paragraph, pos: $pos.before() },
            view.state.tr,
          );
        return inlineSourceTransaction(
          ctx,
          view.state,
          { from: candidate, to: candidate + node.nodeSize },
          view.state.tr.setSelection(NodeSelection.create(view.state.doc, candidate)),
        );
      }
      continue;
    }
    if (node?.type.name === expected &&
        (expected !== 'code_block' || String(node.attrs.language).toLowerCase() === 'mermaid'))
      return blockNodeSourceTransaction(ctx, view.state, { node, pos: candidate }, view.state.tr);
  }
  return null;
}

function clickedCodeBlockSourceTransaction(ctx: Ctx, view: EditorView, target: Element) {
  const block = target.closest('pre');
  if (!block || !view.dom.contains(block) || block.hasAttribute('data-tano-live-source'))
    return null;
  const mapped = view.posAtDOM(block, 0);
  for (const pos of [mapped, mapped - 1]) {
    const node = view.state.doc.nodeAt(pos);
    if (node?.type.name !== 'code_block' || String(node.attrs.language).toLowerCase() === 'mermaid')
      continue;
    const selection = view.dom.ownerDocument.getSelection();
    let caret = view.state.selection.from;
    if (selection?.isCollapsed && selection.anchorNode && block.contains(selection.anchorNode)) {
      try {
        caret = view.posAtDOM(selection.anchorNode, selection.anchorOffset);
      } catch {
        // Keep the current editor selection if the browser selection is stale.
      }
    }
    caret = Math.max(pos + 1, Math.min(pos + node.nodeSize - 1, caret));
    return blockNodeSourceTransaction(
      ctx,
      view.state,
      { node, pos },
      view.state.tr.setSelection(TextSelection.create(view.state.doc, caret)),
    );
  }
  return null;
}

function activateFootnoteLabelAt(ctx: Ctx, view: EditorView, pos: number, fromBody: boolean) {
  if (localSource?.kind === 'footnote-label' || props.readonly || props.revealMarkdown === false)
    return false;
  const definition = view.state.doc.nodeAt(pos);
  if (definition?.type.name !== 'footnote_definition') return false;
  const createdParagraph = definition.firstChild?.type.name !== 'paragraph';
  const id = sourceId();
  const source = `[^${String(definition.attrs.label)}]: `;
  const label = liveInlineSource.type(ctx).create(
    { id, origin: 'footnote_definition' },
    view.state.schema.text(source),
  );
  const tr = view.state.tr;
  const sourcePos = pos + 2;
  if (createdParagraph)
    tr.insert(pos + 1, view.state.schema.nodes.paragraph!.create(null, label));
  else tr.insert(sourcePos, label);
  tr.setSelection(TextSelection.create(tr.doc, sourcePos + 1 + (fromBody ? source.length : 2)));
  tr.setMeta('addToHistory', false);
  localSource = { kind: 'footnote-label', id, initial: source, createdParagraph };
  applying = true;
  try {
    view.dispatch(tr);
  } finally {
    applying = false;
  }
  view.focus();
  return true;
}

function activateFootnoteLabelSource(ctx: Ctx, view: EditorView, target: Element) {
  // The number is a ::before pseudo-element, so its click targets the dl.
  if (!target.matches('dl[data-type="footnote_definition"]') || !view.dom.contains(target))
    return false;
  const mapped = view.posAtDOM(target, 0);
  return activateFootnoteLabelAt(ctx, view, mapped, false) ||
    activateFootnoteLabelAt(ctx, view, mapped - 1, false);
}

function enterFootnoteLabelFromCaret(ctx: Ctx, view: EditorView) {
  const selection = view.state.selection;
  if (!(selection instanceof TextSelection) || !selection.empty ||
      selection.$from.parent.type.name !== 'paragraph' ||
      selection.$from.parentOffset !== 0 || selection.$from.depth < 2) return false;
  const definitionDepth = selection.$from.depth - 1;
  if (selection.$from.node(definitionDepth).type.name !== 'footnote_definition' ||
      selection.$from.index(definitionDepth) !== 0) return false;
  return activateFootnoteLabelAt(ctx, view, selection.$from.before(definitionDepth), true);
}

function selectedSourceTransaction(ctx: Ctx, state: EditorState, tr: Transaction = state.tr) {
  const selection = tr.selection;
  if (selection instanceof NodeSelection) {
    const name = selection.node.type.name;
    if (
      !isEditableInlineAtom(selection.node, selection.$from.parent) ||
      (name === 'tano_reference' && !referencesEnabled())
    )
      return null;
    return inlineSourceTransaction(ctx, state, { from: selection.from, to: selection.to }, tr);
  }
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const inlineRange = activeInlineSourceRange(tr, bridgeView && markAtCaret(bridgeView));
  return inlineRange
    ? inlineSourceTransaction(ctx, state, inlineRange, tr)
    : caretBlockSourceTransaction(ctx, state, tr);
}

function activateReferenceSource(view: EditorView, pos: number) {
  if (props.readonly || props.revealMarkdown === false || !referencesEnabled() || view.composing)
    return;
  const node = view.state.doc.nodeAt(pos);
  if (node?.type.name !== 'tano_reference') return;
  view.focus();
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
}

function activateLocalSource(ctx: Ctx, view: EditorView, event: MouseEvent | KeyboardEvent) {
  const target = event.target instanceof Element ? event.target : null;
  const previewBlock = target
    ?.closest('.math-preview, .tano-mermaid-preview, .tano-image-block')
    ?.closest('.math-block, .tano-mermaid, .tano-image-block');
  if (
    props.revealMarkdown === false ||
    props.readonly ||
    view.composing ||
    ('button' in event && event.button !== 0) ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    target?.closest('button, input, textarea') ||
    (target?.closest('[contenteditable="false"]:not(.tano-wiki-link)') && !previewBlock)
  )
    return false;
  if (target && previewBlock) {
    const tr = previewBlockSourceTransaction(ctx, view, target);
    if (tr) {
      applying = true;
      try {
        view.dispatch(tr);
      } finally {
        applying = false;
      }
      focusRevealedSource(view, event);
      return true;
    }
  }
  if (target) {
    const tr = clickedCodeBlockSourceTransaction(ctx, view, target);
    if (tr) {
      applying = true;
      try {
        view.dispatch(tr);
      } finally {
        applying = false;
      }
      focusRevealedSource(view, event);
      return true;
    }
  }
  const $cursor = view.state.selection.$from;
  for (let depth = $cursor.depth; depth > 0; depth--) {
    const node = $cursor.node(depth);
    if (node.type.name !== 'tano_live_source_inline') continue;
    const id = String(node.attrs.id);
    if (localSource?.id !== id)
      localSource = {
        kind: 'inline',
        id,
        original: Fragment.from(node),
        initial: node.textContent,
      };
    return false;
  }
  if (activateInlineSource(ctx, view, event)) return true;
  const tr = caretBlockSourceTransaction(ctx, view.state);
  if (!tr) return false;
  applying = true;
  try {
    view.dispatch(tr);
  } finally {
    applying = false;
  }
  focusRevealedSource(view, event);
  return true;
}

function footnoteLabelTransaction(
  state: EditorState,
  source: { node: Node; pos: number },
  createdParagraph: boolean,
) {
  const $source = state.doc.resolve(source.pos);
  let depth = $source.depth;
  while (depth > 0 && $source.node(depth).type.name !== 'footnote_definition') depth--;
  if (!depth) return null;
  const definitionPos = $source.before(depth);
  const definition = $source.node(depth);
  const raw = source.node.textContent;
  const label = /^\[\^([^\]\r\n]+)\]:[ \t]*$/.exec(raw)?.[1];
  const tr = state.tr;
  if (createdParagraph) {
    const paragraph = definition.firstChild!;
    tr.delete(definitionPos + 1, definitionPos + 1 + paragraph.nodeSize);
  } else tr.delete(source.pos, source.pos + source.node.nodeSize);
  if (label?.trim())
    tr.setNodeMarkup(definitionPos, undefined, { ...definition.attrs, label });
  return { tr, valid: !!label?.trim() };
}

function serializableDocument(state: EditorState) {
  if (localSource?.kind !== 'footnote-label') return state.doc;
  const source = findCurrentSource(state);
  return source
    ? footnoteLabelTransaction(state, source, localSource.createdParagraph)?.tr.doc ?? state.doc
    : state.doc;
}

function finishLocalSourceTransaction(ctx: Ctx, state: EditorState) {
  if (!localSource) return;
  const current = findCurrentSource(state);
  const session = localSource;
  localSource = undefined;
  if (!current) return;
  const raw = current.node.textContent;
  if (session.kind === 'footnote-label') {
    const result = footnoteLabelTransaction(state, current, session.createdParagraph);
    if (!result) return;
    if (!result.valid && raw !== session.initial)
      emit('error', '脚注名称无效，已保留原名称');
    if (raw === session.initial) result.tr.setMeta('addToHistory', false);
    return { tr: result.tr, unchanged: raw === session.initial };
  }
  let replacement: Node[] | Fragment;
  if (raw === session.initial)
    replacement = session.kind === 'block' ? [session.original] : session.original;
  else {
    const parsed = ctx.get(parserCtx)(raw);
    if (!parsed) {
      emit('error', '局部 Markdown 无法解析，原文已保留');
      return;
    }
    const normalized = ctx.get(serializerCtx)(parsed).replace(/\n+$/, '');
    if (normalized !== raw.replace(/\n+$/, '')) return;
    if (session.kind === 'inline') {
      if (parsed.childCount !== 1 || parsed.firstChild?.type.name !== 'paragraph') return;
      replacement = parsed.firstChild.content;
    } else
      replacement = parsed.childCount
        ? [...Array(parsed.childCount)].map((_, index) => parsed.child(index))
        : [state.schema.nodes.paragraph!.create()];
  }
  const tr = state.tr.replaceWith(
    current.pos,
    current.pos + current.node.nodeSize,
    replacement,
  );
  if (raw === session.initial) tr.setMeta('addToHistory', false);
  return { tr, unchanged: raw === session.initial };
}

function finishLocalSource(ctx: Ctx, view: EditorView) {
  const result = finishLocalSourceTransaction(ctx, view.state);
  if (!result) return;
  applying = result.unchanged;
  transitioningSource = true;
  try {
    view.dispatch(result.tr);
  } finally {
    applying = false;
    transitioningSource = false;
  }
}

function enterHeadingSource(ctx: Ctx, view: EditorView) {
  const current = currentSource(view);
  const selection = view.state.selection;
  if (
    localSource?.kind !== 'block' ||
    current?.node.attrs.origin !== 'heading' ||
    !(selection instanceof TextSelection)
  ) return false;
  const raw = current.node.textContent;
  const prefix = /^(#{1,6})[ \t]+/.exec(raw);
  const start = current.pos + 1;
  const from = selection.from - start;
  const to = selection.to - start;
  if (!prefix || raw.includes('\n') || from < prefix[0].length || to > raw.length) return false;

  // Parse once with a temporary visible character at the split. Cutting the
  // parsed inline content keeps marks and links on both sides of the cursor.
  const marker = '\uE000';
  if (raw.includes(marker)) return false;
  const parsed = ctx.get(parserCtx)(`${raw.slice(0, from)}${marker}${raw.slice(to)}`);
  if (parsed?.childCount !== 1 || parsed.firstChild?.type.name !== 'heading') return false;
  const sourceHeading = parsed.firstChild;
  let splitAt: number | undefined;
  sourceHeading.descendants((node, pos) => {
    const offset = node.isText ? node.text?.indexOf(marker) ?? -1 : -1;
    if (offset >= 0) splitAt = pos + offset;
  });
  if (splitAt === undefined) return false;
  const heading = sourceHeading.copy(sourceHeading.content.cut(0, splitAt));
  const paragraph = view.state.schema.nodes.paragraph!.create(
    null,
    sourceHeading.content.cut(splitAt + marker.length),
  );
  const tr = view.state.tr.replaceWith(
    current.pos,
    current.pos + current.node.nodeSize,
    [heading, paragraph],
  );
  tr.setSelection(TextSelection.create(tr.doc, current.pos + heading.nodeSize + 1));
  localSource = undefined;
  transitioningSource = true;
  try {
    view.dispatch(tr);
  } finally {
    transitioningSource = false;
  }
  return true;
}

function enterInlineSourceHeading(ctx: Ctx, view: EditorView) {
  const current = currentSource(view);
  const selection = view.state.selection;
  if (
    localSource?.kind !== 'inline' ||
    current?.node.type.name !== 'tano_live_source_inline' ||
    !(selection instanceof TextSelection) ||
    selection.$from.parent.type.name !== 'tano_live_source_inline'
  ) return false;
  const headingDepth = selection.$from.depth - 1;
  if (headingDepth < 1 || selection.$from.node(headingDepth).type.name !== 'heading') return false;
  const raw = current.node.textContent;
  const marker = '\uE000';
  if (raw.includes(marker)) return false;
  const start = current.pos + 1;
  const from = selection.from - start;
  const to = selection.to - start;
  if (from < 0 || to > raw.length) return false;
  const parsed = ctx.get(parserCtx)(`${raw.slice(0, from)}${marker}${raw.slice(to)}`);
  if (parsed?.childCount !== 1 || parsed.firstChild?.type.name !== 'paragraph') return false;
  const inline = parsed.firstChild;
  let splitAt: number | undefined;
  inline.descendants((node, pos) => {
    const offset = node.isText ? node.text?.indexOf(marker) ?? -1 : -1;
    if (offset >= 0) splitAt = pos + offset;
  });
  if (splitAt === undefined) return false;

  const heading = selection.$from.node(headingDepth);
  const headingPos = selection.$from.before(headingDepth);
  const inlineOffset = current.pos - headingPos - 1;
  const left = heading.copy(
    heading.content.cut(0, inlineOffset).append(inline.content.cut(0, splitAt)),
  );
  const right = view.state.schema.nodes.paragraph!.create(
    null,
    inline.content.cut(splitAt + marker.length)
      .append(heading.content.cut(inlineOffset + current.node.nodeSize)),
  );
  const tr = view.state.tr.replaceWith(headingPos, headingPos + heading.nodeSize, [left, right]);
  tr.setSelection(TextSelection.create(tr.doc, headingPos + left.nodeSize + 1));
  localSource = undefined;
  transitioningSource = true;
  try {
    view.dispatch(tr);
  } finally {
    transitioningSource = false;
  }
  return true;
}

function enterRenderedHeading(view: EditorView) {
  const selection = view.state.selection;
  if (
    !(selection instanceof TextSelection) ||
    selection.$from.parent.type.name !== 'heading' ||
    selection.$to.parent !== selection.$from.parent
  ) return false;
  const heading = selection.$from.parent;
  const pos = selection.$from.before();
  const left = heading.copy(heading.content.cut(0, selection.$from.parentOffset));
  const right = view.state.schema.nodes.paragraph!.create(
    null,
    heading.content.cut(selection.$to.parentOffset),
  );
  const tr = view.state.tr.replaceWith(pos, pos + heading.nodeSize, [left, right]);
  tr.setSelection(TextSelection.create(tr.doc, pos + left.nodeSize + 1));
  view.dispatch(tr);
  return true;
}

function restoreOrphanSource(ctx: Ctx, state: EditorState) {
  let orphan: { node: Node; pos: number } | undefined;
  state.doc.descendants((node, pos) => {
    if (
      (node.type.name === 'tano_live_source_inline' ||
        (node.type.name === 'tano_live_source' && node.attrs.origin === 'heading')) &&
      node.attrs.id !== localSource?.id
    ) {
      orphan = { node, pos };
      return false;
    }
  });
  if (!orphan) return null;
  if (orphan.node.attrs.origin === 'footnote_definition')
    return state.tr.delete(orphan.pos, orphan.pos + orphan.node.nodeSize)
      .setMeta('addToHistory', false);
  const parsed = ctx.get(parserCtx)(orphan.node.textContent);
  if (!parsed?.childCount) return null;
  const replacement = orphan.node.type.name === 'tano_live_source_inline'
    ? parsed.childCount === 1 && parsed.firstChild?.type.name === 'paragraph'
      ? parsed.firstChild.content
      : null
    : parsed.firstChild?.type.name === 'heading'
      ? Array.from({ length: parsed.childCount }, (_, index) => parsed.child(index))
      : null;
  if (!replacement) return null;
  return state.tr
    .replaceWith(orphan.pos, orphan.pos + orphan.node.nodeSize, replacement)
    .setMeta('addToHistory', false);
}

function toggleSourceSyntax(view: EditorView, name: 'bold' | 'italic' | 'code') {
  const current = currentSource(view);
  if (!current) return false;
  const delimiter = name === 'bold' ? '**' : name === 'italic' ? '*' : '`';
  const start = current.pos + 1;
  const end = start + current.node.textContent.length;
  const { from, to } = view.state.selection;
  if (from < start || to > end) return false;
  const raw = current.node.textContent;
  const size = delimiter.length;
  const tr = view.state.tr;
  if (
    current.node.type.name === 'tano_live_source_inline' &&
    raw.startsWith(delimiter) &&
    raw.endsWith(delimiter) &&
    from >= start + size &&
    to <= end - size
  ) {
    const parsedStyles = sourceStyleRanges(raw).filter((range) =>
      ['strong', 'emphasis', 'code', 'link'].includes(range.style),
    );
    if (
      name !== 'code' &&
      parsedStyles.length === 1 &&
      parsedStyles[0]!.style === (name === 'bold' ? 'strong' : 'emphasis')
    ) {
      const prefix = raw.slice(size, from - start);
      const selected = raw.slice(from - start, to - start);
      const suffix = raw.slice(to - start, raw.length - size);
      const keepStyled = (text: string) => {
        const leading = /^\s*/.exec(text)?.[0] ?? '';
        const trailing = /\s*$/.exec(text)?.[0] ?? '';
        const content = text.slice(leading.length, text.length - trailing.length);
        return content ? `${leading}${delimiter}${content}${delimiter}${trailing}` : text;
      };
      const before = keepStyled(prefix);
      const replacement = before + selected + keepStyled(suffix);
      tr.insertText(replacement, start, end);
      tr.setSelection(
        TextSelection.create(
          tr.doc,
          start + before.length,
          start + before.length + selected.length,
        ),
      );
    } else {
      tr.delete(end - size, end);
      tr.delete(start, start + size);
      tr.setSelection(TextSelection.create(tr.doc, from - size, to - size));
    }
  } else {
    const selected = view.state.doc.textBetween(from, to);
    tr.insertText(`${delimiter}${selected}${delimiter}`, from, to);
    tr.setSelection(TextSelection.create(tr.doc, from + size, from + size + selected.length));
  }
  view.dispatch(tr);
  return true;
}

// Capture every transaction synchronously: a debounced editor listener loses the
// final keystrokes when a tab is closed or switched before its debounce fires.
const bridge = $prose(
  (ctx) =>
    new Plugin({
      key: uploads,
      state: {
        init: () => DecorationSet.empty,
        apply(transaction, current) {
          let next = current.map(transaction.mapping, transaction.doc);
          const change = transaction.getMeta(uploads);
          if (change?.add) {
            const label = document.createElement('span');
            label.className = 'asset-upload-placeholder';
            label.textContent = '正在导入附件…';
            next = next.add(transaction.doc, [
              Decoration.widget(change.add.position, label, { id: change.add.id, side: -1 }),
            ]);
          }
          if (change?.remove)
            next = next.remove(
              next.find(undefined, undefined, (spec) => spec.id === change.remove),
            );
          return next;
        },
      },
      appendTransaction(transactions, _previous, state) {
        if (transactions.some((transaction) => transaction.docChanged)) {
          const restoredSource = restoreOrphanSource(ctx, state);
          if (restoredSource) return restoredSource;
        }
        if (localSource) {
          const current = findCurrentSource(state);
          if (
            !current ||
            (state.selection.from >= current.pos + 1 &&
              state.selection.to <= current.pos + current.node.nodeSize - 1)
          )
            return null;
          const finished = finishLocalSourceTransaction(ctx, state);
          if (!finished) return null;
          const next =
            bridgeView?.hasFocus() &&
            !transactions.some((transaction) => transaction.getMeta('tanoBlockContextSelect')) &&
            !props.readonly && props.revealMarkdown !== false
              ? selectedSourceTransaction(ctx, state, finished.tr)
              : null;
          sourceActivationPending = !!next || finished.unchanged;
          return finished.tr;
        }
        const codeCaret =
          state.selection instanceof TextSelection &&
          state.selection.empty &&
          state.selection.$from.parent.type.name === 'code_block' &&
          String(state.selection.$from.parent.attrs.language).toLowerCase() !== 'mermaid';
        const docChanged = transactions.some((transaction) => transaction.docChanged);
        if (
          !bridgeView?.hasFocus() ||
          transitioningSource ||
          applying ||
          disposed ||
          props.readonly ||
          props.revealMarkdown === false ||
          (!codeCaret && !transactions.some((transaction) => transaction.selectionSet)) ||
          (docChanged && !codeCaret) ||
          transactions.some((transaction) => transaction.getMeta('tanoKeepNodeView'))
        )
          return null;
        // Replace the selected field before ProseMirror paints the new caret.
        // Its first visible Markdown characters must already be editable.
        const tr = selectedSourceTransaction(ctx, state);
        if (tr) sourceActivationPending = !docChanged;
        return tr;
      },
      view: (view) => {
        bridgeView = view;
        emit('selectionChange', selectionContext(view.state));
        return {
          update(view, previous) {
            if (blockMenu.value && !previous.doc.eq(view.state.doc)) closeBlockMenu(false);
            const activated = sourceActivationPending;
            sourceActivationPending = false;
            const source = currentSource(view);
            if (
              localSource &&
              source &&
              (view.state.selection.from < source.pos + 1 ||
                view.state.selection.to > source.pos + source.node.nodeSize - 1)
            ) {
              finishLocalSource(ctx, view);
              return;
            }
            if (
              !previous.selection.eq(view.state.selection) ||
              !previous.doc.eq(view.state.doc) ||
              previous.storedMarks !== view.state.storedMarks
            )
              emit('selectionChange', selectionContext(view.state));
            if (activated || applying || disposed || props.readonly || previous.doc.eq(view.state.doc)) return;
            const markdown = frontmatter.prefix + ctx.get(serializerCtx)(serializableDocument(view.state));
            if (markdown === lastValue) return;
            lastValue = markdown;
            emit('update:modelValue', markdown);
          },
        };
      },
      props: {
        handleTextInput(view, from, to, text) {
          return insertEmptyCodeSourceText(view, from, to, text) ||
            fillEmptyRenderedCodeLine(view, from, to, text);
        },
        handlePaste(view, event) {
          if (event.clipboardData?.files.length) return false;
          const selection = view.state.selection;
          if (!(selection instanceof TextSelection)) return false;
          const text = event.clipboardData?.getData('text/plain') ?? '';
          if (!insertEmptyCodeSourceText(view, selection.from, selection.to, text) &&
              !fillEmptyRenderedCodeLine(view, selection.from, selection.to, text)) return false;
          event.preventDefault();
          return true;
        },
        decorations: (state) => {
          const decorations: Decoration[] = [];
          state.doc.descendants((node, pos) => {
            if (
              node.type.name === 'tano_live_source_inline' &&
              inlineSourceDestination(ctx, node.textContent)
            )
              decorations.push(
                Decoration.node(pos, pos + node.nodeSize, { class: 'tano-clickable-source' }),
              );
            if (node.type.name === 'tano_wiki_link')
              decorations.push(
                Decoration.node(pos, pos + node.nodeSize, {
                  'data-feature-level': '1',
                  'data-inline-type': 'Mention',
                }),
              );
            if (
              node.isText &&
              node.text?.startsWith('@') &&
              node.marks.some((mark) => mark.type.name === 'link')
            )
              decorations.push(
                Decoration.inline(pos, pos + node.nodeSize, {
                  class: 'tano-file-mention',
                  'data-feature-level': '1',
                  'data-inline-type': 'Mention',
                }),
              );
            if (!node.isText)
              decorations.push(
                Decoration.node(pos, pos + node.nodeSize, {
                  'data-runtime-policy': String(runtimeRevision),
                }),
              );
            if (!node.isBlock) return;
            const type = blockType(node);
            const editingFootnoteLabel = type === 'FootnoteDefinition' &&
              node.firstChild?.firstChild?.type.name === 'tano_live_source_inline' &&
              node.firstChild.firstChild.attrs.origin === 'footnote_definition';
            if (type === 'Callout' && policy().features.callout) {
              const marker = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.exec(
                node.firstChild?.textContent ?? '',
              );
              if (marker && node.firstChild?.type.name === 'paragraph') {
                decorations.push(
                  Decoration.inline(pos + 2, pos + 2 + marker[0].length, {
                    class: 'tano-callout-marker',
                  }),
                );
                const label = document.createElement('div');
                label.className = 'tano-callout-title';
                label.contentEditable = 'false';
                label.textContent = {
                  NOTE: 'ⓘ 备注',
                  TIP: '◇ 提示',
                  IMPORTANT: '◆ 重要',
                  WARNING: '⚠ 警告',
                  CAUTION: '⚠ 注意',
                }[marker[1]!.toUpperCase() as 'NOTE'];
                decorations.push(Decoration.widget(pos + 1, label, { side: -1 }));
                if (node.firstChild.textContent === marker[0])
                  decorations.push(
                    Decoration.node(pos + 1, pos + 1 + node.firstChild.nodeSize, {
                      class: 'tano-callout-marker-paragraph',
                    }),
                  );
              }
            }
            decorations.push(
              Decoration.node(pos, pos + node.nodeSize, {
                'data-block-type': type,
                'data-feature-level': String(featureLevel(type)),
                ...(editingFootnoteLabel ? { class: 'tano-footnote-label-editing' } : {}),
                ...(type === 'Callout' && policy().features.callout
                  ? {
                      class:
                        'tano-callout' +
                        (props.revealMarkdown !== false &&
                        !props.readonly &&
                        state.selection.empty &&
                        state.selection.from >= pos &&
                        state.selection.from <= pos + node.nodeSize
                          ? ' tano-live-callout'
                          : ''),
                      'data-callout-kind':
                        /^\[!([A-Z]+)\]/i
                          .exec(node.firstChild?.textContent ?? '')?.[1]
                          ?.toLowerCase() ?? 'note',
                    }
                  : {}),
              }),
            );
          });
          return (uploads.getState(state) ?? DecorationSet.empty).add(state.doc, decorations);
        },
        handleDOMEvents: {
          mousedown(view, event) {
            if (
              event.button === 0 &&
              (event.ctrlKey || event.metaKey) &&
              event.target instanceof Element &&
              view.dom.contains(event.target.closest('a[href], sup[data-type="footnote_reference"]'))
            ) {
              // Keep the anchor in the DOM until its click event opens it.
              event.preventDefault();
              return true;
            }
            return false;
          },
          keydown(view, event) {
            const source = currentSource(view);
            if (event.key === 'ArrowLeft' && !event.shiftKey && !event.ctrlKey &&
                !event.metaKey && !event.altKey && !event.isComposing && !view.composing &&
                enterFootnoteLabelFromCaret(ctx, view)) {
              event.preventDefault();
              return true;
            }
            if (
              event.key === 'Enter' &&
              !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey &&
              !event.isComposing && !view.composing && !props.readonly &&
              ((source && (enterHeadingSource(ctx, view) || enterInlineSourceHeading(ctx, view))) ||
                enterRenderedHeading(view))
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
              toggleSourceSyntax(view, event.key.toLowerCase() === 'b' ? 'bold' : 'italic');
              return true;
            }
            if (
              source &&
              (event.key === 'Escape' ||
                (event.key === 'Enter' && (event.ctrlKey || event.metaKey)))
            ) {
              event.preventDefault();
              event.stopPropagation();
              finishLocalSource(ctx, view);
              return true;
            }
            return false;
          },
          blur(view) {
            finishLocalSource(ctx, view);
            return false;
          },
          paste(view, event) {
            const files = Array.from(event.clipboardData?.files ?? []);
            const embeddedImage = containsEmbeddedImage(event.clipboardData);
            if ((!files.length && !embeddedImage) || props.readonly) return false;
            event.preventDefault();
            if (!props.importFile) {
              emit('error', '当前工作区不能保存图片或附件，请在桌面工作空间中粘贴图片');
              return true;
            }
            if (!files.length) {
              emit('error', '剪贴板没有提供可导入的图片文件，请先将图片保存为文件后再导入');
              return true;
            }
            for (const file of files.slice(0, 10))
              void importInto(
                ctx,
                view,
                file,
                view.state.selection.from,
                file.type.startsWith('image/'),
              );
            return true;
          },
          drop(view, event) {
            const files = Array.from(event.dataTransfer?.files ?? []);
            if (!files.length || !props.importFile || props.readonly) return false;
            event.preventDefault();
            const pos =
              view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ??
              view.state.selection.from;
            for (const file of files.slice(0, 10)) void importInto(ctx, view, file, pos, false);
            return true;
          },
          click(_view, event) {
            if (jumpToFootnote(_view, event)) {
              event.preventDefault();
              return true;
            }
            if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
                event.target instanceof Element &&
                activateFootnoteLabelSource(ctx, _view, event.target)) {
              event.preventDefault();
              return true;
            }
            if ((event.ctrlKey || event.metaKey) && openInlineSourceLink(ctx, _view, event)) {
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
              inlineAtomSourceRange(_view, event)
            ) {
              event.preventDefault();
              return activateInlineSource(ctx, _view, event);
            }
            const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
            if (link) {
              event.preventDefault();
              const wikiTarget = link.getAttribute('data-tano-wiki-target');
              if (event.ctrlKey || event.metaKey) {
                closeLinkPanel();
                if (wikiTarget !== null) emit('openWikiLink', wikiTarget);
                else emit('openLink', link.getAttribute('href') ?? '');
                return true;
              }
              if (wikiTarget === null && props.revealMarkdown !== false && !props.readonly &&
                  event.button === 0 && !event.altKey && !event.shiftKey)
                return activateLinkSource(ctx, _view, link, event);
              if (props.revealMarkdown === false && event.button === 0 && !event.altKey && !event.shiftKey)
                return openLinkPanel(_view, link);
            }
            return activateLocalSource(ctx, _view, event);
          },
        },
        nodeViews: runtimeViews(
          {
            ...referenceViews(
              () => props.referenceTargets ?? [],
              referencesEnabled,
              (identity) => emit('openReference', identity),
              () => props.revealMarkdown !== false && !props.readonly,
              activateReferenceSource,
            ),
            ...enhancedViews(
              () => !!props.readonly,
              (url) => emit('openLink', url),
              (url) =>
                props.resolveImage?.(url) ??
                (!props.resolveImage && /^https?:\/\//i.test(url) ? url : null),
              () => props.resourceRevision,
            ),
            html(node) {
              const wrapper = document.createElement('span');
              let current = node;
              const render = () =>
                renderHtml(wrapper, String(current.attrs.value ?? ''), props.resolveImage);
              render();
              const stop = watch(() => props.resourceRevision, render);
              return {
                dom: wrapper,
                update(next) {
                  if (next.type !== current.type) return false;
                  current = next;
                  render();
                  return true;
                },
                ignoreMutation: () => true,
                destroy: stop,
              };
            },
            code_block: mermaidView(
              () => policy().features.mermaid,
              () => !!props.readonly,
              () => props.revealMarkdown !== false,
            ),
            math_inline: mathView(
              false,
              () => !!props.readonly,
              () => props.revealMarkdown === false || preferences().previewMathWhileEditing,
              () => props.revealMarkdown !== false,
            ),
            math_block: mathView(
              true,
              () => !!props.readonly,
              () => props.revealMarkdown === false || preferences().previewMathWhileEditing,
              () => props.revealMarkdown !== false,
            ),
            tano_live_source_inline: mathSourcePreviewView(
              true,
              () => preferences().previewMathWhileEditing && props.revealMarkdown !== false,
              (source) => ctx.get(parserCtx)(source),
            ),
            tano_live_source: mathSourcePreviewView(
              false,
              () => preferences().previewMathWhileEditing && props.revealMarkdown !== false,
              (source) => ctx.get(parserCtx)(source),
              (id) => localSource?.kind === 'block' && localSource.id === id
                ? localSource.style
                : null,
            ),
            image(node, view, getPos) {
              const wrapper = document.createElement('span');
              wrapper.className = 'tano-image';
              wrapper.contentEditable = 'false';
              const img = document.createElement('img');
              img.loading = 'lazy';
              img.referrerPolicy = 'no-referrer';
              const status = document.createElement('small');
              const imageCaption = document.createElement('span');
              imageCaption.className = 'tano-image-caption';
              const panel = createEditorPanel('div', 'tano-image-editor-panel', '编辑图片');
              const fields = (['src', 'alt', 'title'] as const).map((key) => {
                const label = document.createElement('label');
                const caption = document.createElement('span');
                caption.textContent = { src: '图片地址', alt: '图注（替代文字）', title: '悬停提示' }[key];
                const input = document.createElement('input');
                input.type = 'text';
                input.setAttribute('aria-label', caption.textContent);
                label.append(caption, input);
                panel.append(label);
                return { key, input };
              });
              wrapper.append(img, status, imageCaption, panel);
              let current = node;
              let editing = false;
              let stopPositioning: (() => void) | undefined;
              let panelSide: PanelSide | undefined;
              const standalone = () => {
                const pos = getPos();
                if (pos === undefined) return false;
                const parent = view.state.doc.resolve(pos).parent;
                return parent.type.name === 'paragraph' && parent.childCount === 1;
              };
              function positionPanel() {
                panelSide = positionAnchoredPanel(wrapper, panel, 0, panelSide);
              }
              function render() {
                const block = standalone();
                if (editing && (props.revealMarkdown !== false || props.readonly)) {
                  editing = false;
                  panelSide = undefined;
                  stopPositioning?.();
                  stopPositioning = undefined;
                }
                wrapper.classList.toggle('tano-image-block', block);
                wrapper.classList.toggle('tano-editor-active', editing);
                wrapper.classList.toggle('tano-image-click-to-edit', props.revealMarkdown === false && !props.readonly);
                img.tabIndex = status.tabIndex = !props.readonly ? 0 : -1;
                img.setAttribute('role', !props.readonly ? 'button' : 'img');
                if (!props.readonly) {
                  img.setAttribute('aria-label', '编辑图片');
                  status.setAttribute('role', 'button');
                  status.setAttribute('aria-label', '编辑图片');
                } else {
                  img.removeAttribute('aria-label');
                  status.removeAttribute('role');
                  status.removeAttribute('aria-label');
                }
                panel.hidden = !editing;
                for (const { key, input } of fields) {
                  const value = String(current.attrs[key] ?? '');
                  if (input.value !== value) input.value = value;
                  input.readOnly = !!props.readonly;
                }
                const reference = String(current.attrs.src ?? '');
                const url =
                  props.resolveImage?.(reference) ??
                  (!props.resolveImage && /^https:\/\//i.test(reference) ? reference : null);
                img.alt = current.attrs.alt ?? '';
                img.title = current.attrs.title ?? '';
                imageCaption.textContent = block ? String(current.attrs.alt ?? '') : '';
                imageCaption.hidden = !block || !imageCaption.textContent || !url;
                status.textContent = `图片不可用：${unavailableImageLabel(reference, current.attrs.alt)}`;
                status.hidden = !!url;
                img.hidden = !url;
                if (url) img.src = url;
                else img.removeAttribute('src');
                if (editing) positionPanel();
              }
              function finish(refocus = true) {
                if (!editing) return;
                editing = false;
                panelSide = undefined;
                stopPositioning?.();
                stopPositioning = undefined;
                render();
                if (refocus) view.focus();
              }
              function openPanel() {
                if (props.revealMarkdown !== false || props.readonly || editing) return;
                announceEditorPanel(view.dom, wrapper);
                editing = true;
                panelSide = undefined;
                render();
                stopPositioning = activateEditorPanel({ panel, anchor: wrapper, position: positionPanel, close: () => finish(false) });
                fields[0]!.input.focus();
              }
              img.onerror = () => {
                img.hidden = true;
                status.hidden = false;
                imageCaption.hidden = true;
                if (editing) positionPanel();
              };
              img.onload = () => {
                img.hidden = false;
                status.hidden = true;
                imageCaption.hidden = !standalone() || !imageCaption.textContent;
                if (editing) positionPanel();
              };
              wrapper.onclick = (event) => {
                if (panel.contains(event.target as globalThis.Node)) return;
                if (editing) finish(false);
                else if (props.revealMarkdown === false) openPanel();
              };
              wrapper.onkeydown = (event) => {
                if (panel.contains(event.target as globalThis.Node) || !['Enter', ' '].includes(event.key))
                  return;
                event.preventDefault();
                if (editing) finish(false);
                else if (props.revealMarkdown !== false) img.click();
                else openPanel();
              };
              for (const { key, input } of fields) {
                input.oninput = () => {
                  if (props.readonly) return;
                  const pos = getPos();
                  if (pos !== undefined)
                    view.dispatch(
                      view.state.tr.setNodeMarkup(pos, undefined, {
                        ...current.attrs,
                        [key]: input.value,
                      }),
                    );
                };
                input.onkeydown = (event) => {
                  if (event.key !== 'Escape') return;
                  event.preventDefault();
                  event.stopPropagation();
                  finish();
                };
              }
              wrapper.addEventListener('tano-math-refresh', render);
              const stopOtherPanel = onOtherEditorPanel(view.dom, wrapper, () => finish(false));
              render();
              const stop = watch(() => props.resourceRevision, render);
              return {
                dom: wrapper,
                stopEvent: (event) =>
                  panel.contains(event.target as globalThis.Node) ||
                  ((props.revealMarkdown === false || editing) &&
                    wrapper.contains(event.target as globalThis.Node)),
                update(next) {
                  if (next.type !== current.type) return false;
                  current = next;
                  render();
                  return true;
                },
                ignoreMutation: () => true,
                destroy() {
                  stop();
                  stopPositioning?.();
                  stopOtherPanel();
                  wrapper.removeEventListener('tano-math-refresh', render);
                  wrapper.onclick = wrapper.onkeydown = null;
                  for (const { input } of fields) input.oninput = input.onkeydown = null;
                  img.onload = img.onerror = null;
                },
              };
            },
            list_item(node, view, getPos) {
              const li = document.createElement('li');
              if (node.attrs.checked == null)
                return {
                  dom: li,
                  contentDOM: li,
                  update: (next) => next.type === node.type && next.attrs.checked == null,
                };
              li.dataset.itemType = 'task';
              li.dataset.checked = String(node.attrs.checked);
              const checkbox = document.createElement('input');
              checkbox.type = 'checkbox';
              checkbox.checked = node.attrs.checked;
              checkbox.contentEditable = 'false';
              checkbox.setAttribute('aria-label', '完成任务');
              const content = document.createElement('div');
              li.append(checkbox, content);
              const change = () => {
                const pos = getPos();
                if (pos === undefined || props.readonly) return;
                const current = view.state.doc.nodeAt(pos);
                if (current)
                  view.dispatch(
                    view.state.tr.setNodeMarkup(pos, undefined, {
                      ...current.attrs,
                      checked: checkbox.checked,
                    }),
                  );
              };
              checkbox.addEventListener('change', change);
              return {
                dom: li,
                contentDOM: content,
                update(next) {
                  if (next.type !== node.type || next.attrs.checked == null) return false;
                  checkbox.checked = next.attrs.checked;
                  li.dataset.checked = String(next.attrs.checked);
                  return true;
                },
                stopEvent: (event) => event.target === checkbox,
                ignoreMutation: (mutation) =>
                  mutation.type !== 'selection' &&
                  (mutation.target === checkbox || mutation.target === li),
                destroy: () => checkbox.removeEventListener('change', change),
              };
            },
          },
          policy,
          (node) => {
            const schema = node.type.schema;
            const content = node.isInline ? schema.nodes.paragraph!.create(null, node) : node;
            return ctx.get(serializerCtx)(schema.topNodeType.create(null, content));
          },
          () => emit('editSource'),
        ),
      },
    }),
);

onMounted(async () => {
  window.addEventListener('pointerdown', dismissBlockMenuOnPointer, true);
  window.addEventListener('contextmenu', dismissBlockMenuOnContext);
  window.addEventListener('scroll', dismissBlockMenuOnScroll, true);
  window.addEventListener('resize', dismissBlockMenuOnScroll);
  try {
    const instance = Editor.make()
      .config((ctx) => {
        configureMarkdownRuntime(ctx, policy);
        ctx.set(rootCtx, root.value!);
        ctx.set(defaultValueCtx, frontmatter.body);
        configureMarkdownSchema(ctx);
        ctx.update(editorViewOptionsCtx, (prev) => ({
          ...prev,
          editable: () => !props.readonly,
          attributes: {
            class: 'tano-prose',
            spellcheck: 'false',
            'aria-label': 'Markdown 文档编辑器',
          },
        }));
      })
      .use(commonmark)
      .use(codeBlankLinesRemark)
      .use(gfm)
      .use($prose(footnoteNumbers))
      .use(textStyles)
      .use(wikiLinkRemark)
      .use(wikiLink)
      .use(wikiLinkInput)
      .use(mathRemark)
      .use(latexMathInput)
      .use(enhanced)
      .use(references)
      .use($prose(() => referencePicker({ enabled: () => referencesEnabled() && !props.readonly, targets: () => props.referenceTargets ?? [] })))
      .use(rawBlocks)
      .use(liveSource)
      .use(liveInlineSource)
      .use(inlineMath)
      .use(blockMath)
      .use(inlineMathInput)
      .use(blockMathInput)
      .use(prism)
      .use(props.extension?.ownsHistory ? [] : history)
      .use(props.extension?.plugins ?? [])
      .use(clipboard)
      .use(
        $prose(() =>
          liveMarkdown(
            () => props.revealMarkdown !== false,
            () => !!props.readonly,
          ),
        ),
      )
      .use($prose(() => blockControls(() => !!props.readonly, () => preferences().folding)))
      .use($prose(() => emptyBlockDeletion(() => !!props.readonly)))
      .use(
        $prose(() =>
          slashCommands({
            readonly: () => !!props.readonly,
            levels: () => props.enabledLevels,
            features: () => policy().features,
          }),
        ),
      )
      .use(bridge);
    editor = await instance.create();
    if (disposed) {
      await editor.destroy();
      return;
    }
    if (bridgeView) stopOtherLinkPanel = onOtherEditorPanel(bridgeView.dom, () => linkPanelAnchor, closeLinkPanel);
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
    } else if (lastValue !== props.modelValue) applyContent(props.modelValue);
  } catch (error) {
    emit('error', String(error));
  }
});

function applyContent(value: string) {
  if (!editor || value === lastValue) return;

  if (!linkPanelWriting) closeLinkPanel();
  applying = true;
  try {
    const previousBody = splitFrontmatter(lastValue).body;
    frontmatter = splitFrontmatter(value);
    metadata.value = frontmatter.prefix;
    if (props.extension) {
      localSource = undefined;
      editor.action((ctx) => props.extension!.apply(ctx, value));
    } else if (frontmatter.body !== previousBody) editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const doc = ctx.get(parserCtx)(frontmatter.body);
      if (!doc) throw new Error('Markdown 无法解析，编辑内容已保留');
      // Generated heading anchors are view state, not Markdown changes.
      const comparison = view.state.tr;
      view.state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading' && node.attrs.id) comparison.setNodeAttribute(pos, 'id', '');
      });
      const from = comparison.doc.content.findDiffStart(doc.content);
      if (from === null) return;
      const end = comparison.doc.content.findDiffEnd(doc.content)!;
      // Repeated text can make the shared prefix and suffix overlap.
      const overlap = from - Math.min(end.a, end.b);
      if (overlap > 0) { end.a += overlap; end.b += overlap; }
      localSource = undefined;
      const tr = view.state.tr.replace(from, end.a, doc.slice(from, end.b));
      view.dispatch(closeHistory(tr).setMeta('addToHistory', false));
    });
    lastValue = value;
  } catch (error) {
    emit('error', String(error));
  } finally {
    applying = false;
  }
}
watch(() => props.modelValue, applyContent);
watch(() => props.readonly, () => {
  if (blockMenu.value) closeBlockMenu();
  if (props.readonly) {
    editingProperty.value = undefined;
    typeMenuProperty.value = undefined;

    closeLinkPanel();
  }
});
watch(() => props.documentId, () => {
  editingProperty.value = undefined;
  typeMenuProperty.value = undefined;
  if (blockMenu.value) closeBlockMenu(false);
  closeLinkPanel();
});
watch(
  () => [props.readonly, props.enabledLevels, props.capabilities, props.preferences, props.referenceTargets],
  () =>
    editor?.action((ctx) => {
      runtimeRevision++;
      const view = ctx.get(editorViewCtx);
      view.setProps({ editable: () => !props.readonly });
      view.dispatch(view.state.tr.setMeta('addToHistory', false));
      view.dom.querySelectorAll('.tano-math, .tano-mermaid, .tano-code-block, .tano-image, [data-tano-live-source], [data-tano-live-inline-source]').forEach((node) => node.dispatchEvent(new Event('tano-math-refresh')));
    }),
  { deep: true },
);
watch(
  () => props.revealMarkdown,
  () => {

    closeLinkPanel();
    editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      if (props.revealMarkdown === false) finishLocalSource(ctx, view);
      view.dispatch(view.state.tr.setMeta('addToHistory', false));
      view.dom.querySelectorAll('.tano-math, .tano-mermaid, .tano-code-block, .tano-image, [data-tano-live-source], [data-tano-live-inline-source]').forEach((node) => node.dispatchEvent(new Event('tano-math-refresh')));
    });
  },
);
function command(name: string, value?: string) {
  if (!editor || props.readonly) return;
  if (!commandEnabled(name, props.enabledLevels, policy().features)) return;
  if (name === 'reference' || name === 'object-reference') {
    if (!referencesEnabled()) return;
    editor.action((ctx) => { const view = ctx.get(editorViewCtx); view.dispatch(openReferencePicker(view.state, name === 'object-reference')); });
    return;
  }
  if (name === 'bold' || name === 'italic' || name === 'code') {
    let sourceEdited = false;
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      if (localSource?.kind === 'inline') sourceEdited = toggleSourceSyntax(view, name);
    });
    if (sourceEdited) {
      editor.action((ctx) => ctx.get(editorViewCtx).focus());
      return;
    }
  }
  if (name === 'bold') editor.action(callCommand(toggleStrongCommand.key));
  if (name === 'italic') editor.action(callCommand(toggleEmphasisCommand.key));
  if (name === 'code') editor.action(callCommand(toggleInlineCodeCommand.key));
  if (name === 'strikethrough') editor.action(callCommand(toggleStrikethroughCommand.key));
  const styles = { underline, superscript, subscript, highlight };
  if (name in styles)
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      toggleMark(styles[name as keyof typeof styles].type(ctx))(view.state, view.dispatch);
    });
  if (name === 'text-color')
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const type = textColor.type(ctx);
      const color = value ? normalizeTextColor(value) : null;
      if (value && !color) return;
      const { from, to, empty } = view.state.selection;
      const transaction = view.state.tr;
      if (empty) {
        if (color) transaction.addStoredMark(type.create({ color }));
        else transaction.removeStoredMark(type);
      } else {
        transaction.removeMark(from, to, type);
        if (color) transaction.addMark(from, to, type.create({ color }));
      }
      view.dispatch(transaction);
    });
  if (blockCommandNames.has(name))
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      if (!blockCommand(name, value)(view.state, view.dispatch))
        emit('error', '当前块无法转换为此类型，请先选择正文或标题');
    });
  if (name === 'link')
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { from, to } = view.state.selection;
      if (!view.state.selection.$from.parent.inlineContent) return;
      const tr = view.state.tr.removeMark(from, to, view.state.schema.marks.link!);
      if (value?.trim())
        tr.addMark(from, to, view.state.schema.marks.link!.create({ href: value.trim() }));
      view.dispatch(tr);
    });
  if (name === 'mention')
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const target = value?.trim();
      if (!target) return;
      if (/\.[a-z\d]{1,8}(?:[?#].*)?$/i.test(target) && !/\.md(?:[?#]|$)/i.test(target)) {
        if (!safeResourceUrl(target)) {
          emit('error', '请使用工作空间内的相对路径');
          return;
        }
        view.dispatch(
          view.state.tr.replaceSelectionWith(
            view.state.schema.text(`@${target.split('/').pop()}`, [
              view.state.schema.marks.link!.create({ href: target }),
            ]),
          ),
        );
        return;
      }
      const selected =
        view.state.selection instanceof NodeSelection ? view.state.selection.node : null;
      const label =
        selected?.type.name === 'tano_wiki_link'
          ? String(selected.attrs.label)
          : view.state.doc.textBetween(view.state.selection.from, view.state.selection.to) ||
            target;
      const parsed = parseWikiLink(label === target ? target : `${target}|${label}`);
      if (!parsed) {
        emit('error', '所选文字或文档名称包含不支持的提及符号，请调整后重试');
        return;
      }
      view.dispatch(view.state.tr.replaceSelectionWith(wikiLink.type(ctx).create(parsed)));
    });
  if (name === 'footnote')
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { schema, selection } = view.state;
      if (!selection.$from.parent.inlineContent) return;
      const used = new Set<string>();
      view.state.doc.descendants((node) => {
        if (node.type.name.startsWith('footnote_')) used.add(String(node.attrs.label));
      });
      let number = 1;
      while (used.has(String(number))) number++;
      const label = String(number);
      // Reference the selected text without replacing it. Definitions remain editable blocks.
      const pos = selection.to;
      const tr = view.state.tr.insert(pos, schema.nodes.footnote_reference!.create({ label }));
      tr.insert(
        tr.doc.content.size,
        schema.nodes.footnote_definition!.create(
          { label },
          schema.nodes.paragraph!.create(null, schema.text(value?.trim() || '脚注内容')),
        ),
      );
      tr.setSelection(NodeSelection.create(tr.doc, pos));
      view.dispatch(tr.scrollIntoView());
    });
  if (name === 'math')
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const selected = view.state.doc.textBetween(
        view.state.selection.from,
        view.state.selection.to,
      );
      const node = view.state.selection instanceof NodeSelection ? view.state.selection.node : null;
      view.dispatch(
        view.state.tr.replaceSelectionWith(
          inlineMath.type(ctx).create({
            value: node?.type.name === 'math_inline' ? node.attrs.value : selected || 'E = mc^2',
          }),
        ),
      );
    });
  editor.action((ctx) => ctx.get(editorViewCtx).focus());
}

function closeBlockMenu(restoreSelection = true) {
  const saved = selectionBeforeMenu;
  blockMenu.value = null;
  selectionBeforeMenu = null;
  rightClickSelection = null;
  if (!restoreSelection || !saved || !editor || disposed) return;
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    if (view.state.doc.eq(saved.doc) && !view.state.selection.eq(saved.selection))
      view.dispatch(view.state.tr.setSelection(saved.selection).setMeta('addToHistory', false));
  });
}

function rememberRightClickSelection(event: MouseEvent) {
  if (event.button !== 2 || !editor) return;
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    if (blockIndexFromEvent(view, event.target) == null) return;
    // ProseMirror otherwise moves the caret on right mousedown. For headings that
    // opens the live Markdown source before the contextmenu event can reach us.
    event.preventDefault();
    event.stopPropagation();
    const state = view.state;
    rightClickSelection = { selection: state.selection, doc: state.doc };
  });
}

function blockIndexFromEvent(view: EditorView, target: EventTarget | null): number | null {
  if (!(target instanceof Element)) return null;
  const handle = target.closest<HTMLElement>('.tano-block-handle');
  if (handle && root.value?.contains(handle)) {
    const index = Number(handle.dataset.blockIndex);
    return Number.isInteger(index) && index >= 0 && index < view.state.doc.childCount
      ? index
      : null;
  }
  if (!view.dom.contains(target)) return null;
  let block = target;
  while (block.parentElement && block.parentElement !== view.dom) block = block.parentElement;
  if (block.parentElement !== view.dom) return null;
  try {
    const index = view.state.doc.resolve(view.posAtDOM(block, 0)).index(0);
    return index < view.state.doc.childCount ? index : null;
  } catch {
    return null;
  }
}

function openBlockMenu(event: MouseEvent) {
  if (!editor || props.readonly || disposed) return;
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const index = blockIndexFromEvent(view, event.target);
    if (index == null) {
      if (blockMenu.value) closeBlockMenu();
      return;
    }
    event.preventDefault();
    if (blockMenu.value) closeBlockMenu();
    const previous = rightClickSelection?.doc.eq(view.state.doc)
      ? rightClickSelection
      : { selection: view.state.selection, doc: view.state.doc };
    rightClickSelection = null;
    let pos = 0;
    view.state.doc.forEach((_node, offset, nodeIndex) => {
      if (nodeIndex === index) pos = offset;
    });
    view.dispatch(
      view.state.tr
        .setSelection(NodeSelection.create(view.state.doc, pos))
        .setMeta('tanoBlockContextSelect', true)
        .setMeta('addToHistory', false),
    );
    // Leaving a live heading source replaces its temporary node. The mapped
    // selection may become a caret, so select the restored block once more.
    if (!(view.state.selection instanceof NodeSelection) || view.state.selection.from !== pos)
      view.dispatch(
        view.state.tr
          .setSelection(NodeSelection.create(view.state.doc, pos))
          .setMeta('tanoBlockContextSelect', true)
          .setMeta('addToHistory', false),
      );
    selectionBeforeMenu = previous;
    blockMenu.value = {
      index,
      x: Math.max(8, event.clientX),
      y: Math.max(8, event.clientY),
      doc: view.state.doc,
    };
    void nextTick(() => {
      const menu = blockMenuElement.value;
      if (!menu || !blockMenu.value) return;
      blockMenu.value = {
        ...blockMenu.value,
        x: Math.min(blockMenu.value.x, Math.max(8, window.innerWidth - menu.offsetWidth - 8)),
        y: Math.min(blockMenu.value.y, Math.max(8, window.innerHeight - menu.offsetHeight - 8)),
      };
      menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    });
  });
}

function blockMenuCommandAvailable(name: string) {
  const current = blockMenu.value;
  return !!current &&
    canTransformBlock(current.doc.child(current.index)) &&
    commandEnabled(name, props.enabledLevels, policy().features);
}

async function blockMenuAction(action: string) {
  const current = blockMenu.value;
  if (!current || !editor || props.readonly) return;
  if (['paragraph', 'heading', 'list', 'quote'].includes(action)) {
    if (!blockMenuCommandAvailable(action)) return;
    closeBlockMenu(false);
    command(action);
    return;
  }
  if (action === 'copy') {
    const markdown = editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      if (!view.state.doc.eq(current.doc)) return null;
      const node = view.state.doc.child(current.index);
      return ctx.get(serializerCtx)(view.state.schema.topNodeType.create(null, node));
    });
    closeBlockMenu();
    if (markdown === null) return;
    try {
      await navigator.clipboard.writeText(markdown);
    } catch {
      emit('error', '无法复制块内容，请检查剪贴板权限');
    }
    return;
  }
  closeBlockMenu(false);
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    if (!view.state.doc.eq(current.doc)) return;
    const { doc, schema } = view.state;
    let pos = 0;
    doc.forEach((_node, offset, index) => {
      if (index === current.index) pos = offset;
    });
    const node = doc.child(current.index);
    if (action === 'duplicate') {
      const insertPos = pos + node.nodeSize;
      const tr = view.state.tr.insert(insertPos, node);
      tr.setSelection(NodeSelection.create(tr.doc, insertPos));
      view.dispatch(tr.scrollIntoView());
    } else if (action === 'move-up' || action === 'move-down') {
      const nextIndex = current.index + (action === 'move-up' ? -1 : 1);
      const tr = moveBlock(view.state, current.index, action === 'move-up' ? nextIndex : nextIndex + 1);
      if (!tr) return;
      let movedPos = 0;
      tr.doc.forEach((_node, offset, index) => {
        if (index === nextIndex) movedPos = offset;
      });
      tr.setSelection(NodeSelection.create(tr.doc, movedPos));
      view.dispatch(tr.scrollIntoView());
    } else if (action === 'delete') {
      const tr = doc.childCount === 1
        ? view.state.tr.replaceWith(pos, pos + node.nodeSize, schema.nodes.paragraph!.create())
        : view.state.tr.delete(pos, pos + node.nodeSize);
      tr.setSelection(Selection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size))));
      view.dispatch(tr.scrollIntoView());
    }
    view.focus();
  });
}

function onBlockMenuKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeBlockMenu();
    editor?.action((ctx) => ctx.get(editorViewCtx).focus());
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const items = [...(blockMenuElement.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
  if (!items.length) return;
  event.preventDefault();
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
    : current < 0 ? (event.key === 'ArrowDown' ? 0 : items.length - 1)
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[next]?.focus();
}

function dismissBlockMenuOnPointer(event: PointerEvent) {
  if (blockMenu.value && !(event.target instanceof globalThis.Node && blockMenuElement.value?.contains(event.target)))
    closeBlockMenu();
}
function dismissBlockMenuOnContext(event: MouseEvent) {
  if (
    blockMenu.value &&
    !event.defaultPrevented &&
    !(event.target instanceof globalThis.Node && root.value?.contains(event.target))
  )
    closeBlockMenu();
}
function dismissBlockMenuOnScroll() {
  if (blockMenu.value) closeBlockMenu();
}
window.addEventListener('keydown', syncLinkModifier, true);
window.addEventListener('keyup', syncLinkModifier, true);
window.addEventListener('blur', clearLinkModifier);
function insertBlockAtStart() {
  if (!editor || props.readonly || disposed) return;
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const tr = view.state.tr.insert(0, view.state.schema.nodes.paragraph!.create());
    tr.setSelection(TextSelection.create(tr.doc, 1));
    view.dispatch(closeHistory(tr).scrollIntoView());
    view.focus();
  });
}
function focusTrailingParagraph(event: MouseEvent) {
  if (
    !editor ||
    props.readonly ||
    disposed ||
    event.defaultPrevented ||
    event.button !== 0 ||
    event.shiftKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  )
    return;
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    // Only bare editor/background surfaces count, never block content or controls.
    if (
      !view.editable ||
      view.composing ||
      view.dragging ||
      !(event.target instanceof HTMLElement) ||
      !event.target.contains(view.dom)
    )
      return;
    const { doc, schema } = view.state;
    const last = doc.lastChild;
    if (!last) return;
    const lastDOM = view.nodeDOM(doc.content.size - last.nodeSize);
    if (!(lastDOM instanceof HTMLElement) || event.clientY < lastDOM.getBoundingClientRect().bottom)
      return;

    event.preventDefault();
    const paragraph = schema.nodes.paragraph!.create();
    const reuse = last.eq(paragraph);
    const tr = view.state.tr;
    const position = reuse ? doc.content.size - last.nodeSize + 1 : doc.content.size + 1;
    if (!reuse) tr.insert(doc.content.size, paragraph);
    tr.setSelection(TextSelection.create(tr.doc, position)).setStoredMarks([]);
    view.dispatch((reuse ? tr : closeHistory(tr)).scrollIntoView());
    view.focus();
  });
}
function canUndo() {
  if (!editor || props.readonly || props.extension?.ownsHistory) return false;
  return editor.action((ctx) => undoDepth(ctx.get(editorViewCtx).state) > 0);
}
function undoLastChange() {
  if (!editor || props.readonly || props.extension?.ownsHistory) return false;
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const changed = undoHistory(view.state, view.dispatch);
    if (changed) view.focus();
    return changed;
  });
}
function canRedo() {
  if (!editor || props.readonly || props.extension?.ownsHistory) return false;
  return editor.action((ctx) => redoDepth(ctx.get(editorViewCtx).state) > 0);
}
function redoLastChange() {
  if (!editor || props.readonly || props.extension?.ownsHistory) return false;
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const changed = redoHistory(view.state, view.dispatch);
    if (changed) view.focus();
    return changed;
  });
}
function withContext<T>(action: (ctx: Ctx, markdown: string) => T): T {
  if (!editor) throw new Error('编辑器尚未就绪');
  return editor.action((ctx) => action(ctx, lastValue));
}
defineExpose({
  command,
  importFiles,
  withContext,
  insertBlockAtStart,
  focusTrailingParagraph,
  canUndo,
  undoLastChange,
  canRedo,
  redoLastChange,
});
onBeforeUnmount(() => {
  disposed = true;
  blockMenu.value = null;

  closeLinkPanel();
  stopOtherLinkPanel?.();
  window.removeEventListener('pointerdown', dismissBlockMenuOnPointer, true);
  window.removeEventListener('contextmenu', dismissBlockMenuOnContext);
  window.removeEventListener('scroll', dismissBlockMenuOnScroll, true);
  window.removeEventListener('resize', dismissBlockMenuOnScroll);
  window.removeEventListener('keydown', syncLinkModifier, true);
  window.removeEventListener('keyup', syncLinkModifier, true);
  window.removeEventListener('blur', clearLinkModifier);
  unbindExtension?.();
  void editor?.destroy();
});
</script>

<template>
  <details ref="frontmatterPanel" class="frontmatter-panel">
    <summary class="frontmatter-heading">
      <svg class="frontmatter-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="m6 4.5 3.5 3.5L6 11.5"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      文档属性
      <button
        v-if="properties !== null"
        type="button"
        class="frontmatter-order-toggle"
        :aria-pressed="propertyOrder === 'name'"
        :aria-label="propertyOrder === 'source' ? '按名称排序文档属性' : '按文件顺序显示文档属性'"
        :title="propertyOrder === 'source' ? '按名称排序' : '按文件顺序显示'"
        @click.stop.prevent="propertyOrder = propertyOrder === 'source' ? 'name' : 'source'"
        @keydown.stop
      ><ArrowDownAZ :size="16" /></button>
    </summary>
    <div class="frontmatter-content">
      <template v-if="properties === null">
        <pre class="frontmatter-raw">{{ metadata }}</pre>
        <button v-if="!readonly" type="button" class="frontmatter-add" @click="emit('editSource')">在源码中编辑</button>
      </template>
      <template v-else>
        <div
          v-for="property in visibleProperties"
          :key="editingProperty === property.name || (editingProperty === null && !property.name) ? editingRowKey : property.name"
          class="frontmatter-property"
          :class="{ 'is-editing': editingProperty === property.name || (editingProperty === null && !property.name) }"
          :data-property-name="property.name"
          :style="editingProperty === property.name || (editingProperty === null && !property.name) ? { height: `${editingRowHeight}px` } : undefined"
          @focusout="onPropertyFocusOut"
          @keydown.esc="finishPropertyOnKey"
        >
          <button
            v-if="!readonly"
            type="button"
            class="frontmatter-property-type"
            :title="`属性类型：${propertyTypeOptions.find((option) => option.kind === currentPropertyKind(property.name))?.label}`"
            :aria-label="`切换 ${property.name || '新属性'} 的类型`"
            :aria-expanded="typeMenuProperty === property.name || (typeMenuProperty === null && !property.name)"
            @click="openPropertyTypeMenu(property.name || null)"
          ><component :is="propertyTypeIcon(property.name)" :size="16" /></button>
          <component :is="propertyTypeIcon(property.name)" v-else class="frontmatter-property-icon" :size="16" aria-hidden="true" />
          <div
            v-if="editingProperty === property.name || (editingProperty === null && !property.name)"
            class="frontmatter-row-editor"
          >
            <div class="frontmatter-name-editor">
              <input v-model="propertyName" class="frontmatter-name-input" aria-label="属性名" :aria-invalid="propertyError && propertyErrorField === 'name' ? true : undefined" spellcheck="false" @input="syncProperty" @compositionend="syncProperty" @keydown.enter="finishPropertyOnKey" />
              <span v-if="propertyError && propertyErrorField === 'name'" class="frontmatter-row-error" role="alert">{{ propertyError }}</span>
            </div>
            <div class="frontmatter-value-editor">
              <select v-if="propertyKind === 'boolean'" v-model="propertyInput" aria-label="属性值" :aria-invalid="propertyError && propertyErrorField === 'value' ? true : undefined" @change="syncProperty">
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
              <span v-else-if="propertyKind === 'null'" class="frontmatter-null-value">空</span>
              <input v-else-if="propertyKind === 'date'" v-model="propertyInput" aria-label="属性值" :aria-invalid="propertyError && propertyErrorField === 'value' ? true : undefined" type="date" @input="syncProperty" />
              <textarea
                v-else-if="propertyKind === 'list' || propertyKind === 'object' || propertyInput.includes('\n')"
                v-model="propertyInput"
                aria-label="属性值"
                :aria-invalid="propertyError && propertyErrorField === 'value' ? true : undefined"
                :rows="propertyKind === 'text' ? 2 : 4"
                :title="propertyKind === 'list' || propertyKind === 'object' ? '使用 JSON 格式' : undefined"
                spellcheck="false"
                @input="syncProperty"
                @compositionend="syncProperty"
              />
              <input
                v-else
                v-model="propertyInput"
                aria-label="属性值"
                :aria-invalid="propertyError && propertyErrorField === 'value' ? true : undefined"
                type="text"
                :inputmode="propertyKind === 'number' ? 'decimal' : undefined"
                @input="syncProperty"
                @compositionend="syncProperty"
                @keydown.enter="finishPropertyOnKey"
              />
              <span v-if="propertyError && propertyErrorField === 'value'" class="frontmatter-row-error" role="alert">{{ propertyError }}</span>
            </div>
          </div>
          <template v-else>
            <button
              v-if="!readonly"
              type="button"
              class="frontmatter-property-name frontmatter-property-button"
              :title="`编辑 ${property.name}`"
              @click="editProperty(property.name, 'name')"
            >{{ property.name }}</button>
            <span v-else class="frontmatter-property-name">{{ property.name }}</span>
            <button
              v-if="!readonly"
              type="button"
              class="frontmatter-property-value frontmatter-property-button"
              :title="`编辑 ${property.name}`"
              @click="editProperty(property.name)"
            >{{ property.value }}</button>
            <span v-else class="frontmatter-property-value">{{ property.value }}</span>
          </template>
          <div v-if="typeMenuProperty === property.name || (typeMenuProperty === null && !property.name)" class="frontmatter-type-menu" role="menu" aria-label="属性类型">
            <button v-for="option in propertyTypeOptions" :key="option.kind" type="button" role="menuitemradio" :aria-checked="currentPropertyKind(property.name) === option.kind" @click="changePropertyType(option.kind)">
              <component :is="option.icon" :size="16" />{{ option.label }}
            </button>
            <button v-if="editingProperty !== null" type="button" role="menuitem" class="frontmatter-type-delete" @click="deleteProperty"><Trash2 :size="16" />删除属性</button>
          </div>
        </div>
      </template>
      <button
        v-if="!readonly && properties !== null && editingProperty !== null"
        type="button"
        class="frontmatter-add frontmatter-add-property"
        @click="editProperty(null)"
      >
        <Plus :size="16" aria-hidden="true" />添加文档属性
      </button>
    </div>
  </details>
  <div
    ref="root"
    class="milkdown-host"
    :class="{ 'tano-link-modifier': linkModifier }"
    @pointermove="syncLinkModifier"
    @mousedown.capture="rememberRightClickSelection($event); focusTrailingParagraph($event)"
    @contextmenu="openBlockMenu"
  />
  <Teleport to="body">
    <div
      v-if="linkPanel"
      ref="linkPanelElement"
      class="tano-editor-panel tano-link-editor-panel"
      role="group"
      :aria-label="linkPanel.kind === 'wiki' ? '编辑 Wiki 链接' : '编辑链接'"
      :style="{ left: `${linkPanel.x}px`, top: `${linkPanel.y}px` }"
      @keydown.esc.prevent.stop="closeLinkPanel"
      @mousedown.stop
      @click.stop
    >
      <template v-if="linkPanel.kind === 'wiki'">
        <label>目标<input ref="linkPanelFirstInput" :value="linkPanel.target" aria-label="Wiki 链接目标" @input="editLinkPanel('target', $event)" /></label>
        <label>别名<input :value="linkPanel.label" aria-label="Wiki 链接别名" placeholder="留空时使用目标名称" @input="editLinkPanel('label', $event)" /></label>
      </template>
      <template v-else>
        <label>文字<input ref="linkPanelFirstInput" :value="linkPanel.text" aria-label="链接文字" @input="editLinkPanel('text', $event)" /></label>
        <label>地址<input :value="linkPanel.href" aria-label="链接地址" @input="editLinkPanel('href', $event)" /></label>
        <label>标题<input :value="linkPanel.title" aria-label="链接标题" placeholder="可选" @input="editLinkPanel('title', $event)" /></label>
      </template>
    </div>
  </Teleport>
  <Teleport to="body">
    <div
      v-if="blockMenu"
      ref="blockMenuElement"
      class="dropdown compact-action-menu block-context-menu"
      role="menu"
      tabindex="-1"
      :aria-label="`第 ${blockMenu.index + 1} 个块的操作`"
      :style="{ left: `${blockMenu.x}px`, top: `${blockMenu.y}px` }"
      @keydown="onBlockMenuKeydown"
    >
      <div class="block-context-heading" role="presentation">块操作</div>
      <button role="menuitem" type="button" @click="blockMenuAction('copy')"><span aria-hidden="true">⧉</span>复制 Markdown</button>
      <button role="menuitem" type="button" @click="blockMenuAction('duplicate')"><span aria-hidden="true">▣</span>创建副本</button>
      <div class="menu-divider" role="separator" />
      <button role="menuitem" type="button" :disabled="!blockMenuCommandAvailable('paragraph')" @click="blockMenuAction('paragraph')"><span aria-hidden="true">¶</span>转为正文</button>
      <button role="menuitem" type="button" :disabled="!blockMenuCommandAvailable('heading')" @click="blockMenuAction('heading')"><span aria-hidden="true">H</span>转为标题</button>
      <button role="menuitem" type="button" :disabled="!blockMenuCommandAvailable('list')" @click="blockMenuAction('list')"><span aria-hidden="true">☷</span>转为列表</button>
      <button role="menuitem" type="button" :disabled="!blockMenuCommandAvailable('quote')" @click="blockMenuAction('quote')"><span aria-hidden="true">❝</span>转为引用</button>
      <div class="menu-divider" role="separator" />
      <button role="menuitem" type="button" :disabled="blockMenu.index === 0" @click="blockMenuAction('move-up')"><span aria-hidden="true">↑</span>上移块</button>
      <button role="menuitem" type="button" :disabled="blockMenu.index >= blockMenu.doc.childCount - 1" @click="blockMenuAction('move-down')"><span aria-hidden="true">↓</span>下移块</button>
      <div class="menu-divider" role="separator" />
      <button role="menuitem" type="button" class="danger-text" @click="blockMenuAction('delete')"><Trash2 :size="15" aria-hidden="true" />删除块</button>
    </div>
  </Teleport>
</template>
