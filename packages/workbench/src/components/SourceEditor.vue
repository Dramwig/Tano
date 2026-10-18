<script setup lang="ts">
import { t } from '../i18n';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  isolateHistory,
  redo,
  redoDepth,
  undo,
  undoDepth,
} from '@codemirror/commands';
import { Compartment, EditorState, StateEffect, StateField, Transaction } from '@codemirror/state';
import { Decoration, EditorView, keymap, WidgetType } from '@codemirror/view';
import { referenceMarkdown } from '@tano/protocol';
import type { CommentAnchor, ReferenceIdentity } from '@tano/protocol';
import type { SuggestionDecorations } from '@tano/protocol';
import type { CommentGeometry } from '@tano/editor/comment-projection';
import { sourceStyleRanges } from '@tano/editor/source-highlight';
import type { ModeSelection } from '@tano/editor/mode-selection';
import { splitFrontmatter } from '@tano/editor/syntax';
import { referenceInsertionPoint } from '@tano/editor/document-links';
import { selectionWrap } from '@tano/editor/runtime';
import type { EditorPreferences } from '@tano/editor/runtime';
import { textSearchRanges } from '@tano/editor/search';

const setPageSearch = StateEffect.define<{ query: string; index: number }>();
const pageSearch = StateField.define({
  create: () => ({ query: '', index: 0, ranges: Decoration.none }),
  update(previous, tr) {
    const request = tr.effects.find(effect => effect.is(setPageSearch))?.value;
    if (!request && !tr.docChanged) return previous;
    const { query, index } = request ?? previous;
    return { query, index, ranges: Decoration.set(
      textSearchRanges(tr.state.doc.toString(), query).map(({ from, to }, i) =>
        Decoration.mark({ class: `tano-search-match${i === index ? ' tano-search-current' : ''}` }).range(from, to)),
    ) };
  },
  provide: field => EditorView.decorations.from(field, value => value.ranges),
});

const props = defineProps<{
  modelValue: string;
  preferences?: EditorPreferences;
  readonly: boolean;
  localNative: boolean;
  commentAnchors?: readonly { id: string; anchor: CommentAnchor }[];
  suggestionMarks?: SuggestionDecorations;
}>();
const emit = defineEmits<{
  ready: [];
  'update:modelValue': [value: string];
  files: [files: File[], requireImage: boolean, position: number];
  selectionChange: [selected: boolean];
}>();

const host = ref<HTMLElement>();
const readonlyMode = new Compartment();
const refreshCommentMarks = StateEffect.define<void>();
let view: EditorView | undefined;
let applyingModel = false;

const sourceStyles = StateField.define({
  create(state) {
    return decorations(state.doc.toString());
  },
  update(current, transaction) {
    return transaction.docChanged || transaction.effects.some(effect => effect.is(refreshCommentMarks))
      ? decorations(transaction.state.doc.toString()) : current;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function decorations(markdown: string) {
  const ranges = sourceStyleRanges(markdown).flatMap(({ from, to, style }) => {
    const marks = [Decoration.mark({ class: `cm-source-${style}` }).range(from, to)];
    if (style.startsWith('heading-')) {
      const lineStart = markdown.lastIndexOf('\n', from - 1) + 1;
      marks.push(Decoration.line({ class: `cm-source-${style}-line` }).range(lineStart));
    }
    return marks;
  });
  for (const { id, anchor } of props.commentAnchors ?? []) {
    if (anchor.basis !== 'source' ||
        anchor.spans.some(span => markdown.slice(span.from, span.to) !== span.text)) continue;
    for (const span of anchor.spans)
      ranges.push(Decoration.mark({ class: 'cm-comment-mark', attributes: { 'data-comment-id': id } })
        .range(span.from, span.to));
  }
  if (props.suggestionMarks?.text === markdown) for (const range of props.suggestionMarks.ranges) {
    if (range.to > range.from) ranges.push(Decoration.mark({ class: range.inserted === undefined ? 'tano-suggestion-insert' : 'tano-suggestion-delete is-source-text', attributes: { 'data-suggestion-id': range.id } }).range(range.from, range.to));
    if (range.removed) ranges.push(Decoration.widget({ widget: new DeletedSuggestion(range.id, range.removed), side: -1 }).range(range.from));
    if (range.inserted) ranges.push(Decoration.widget({ widget: new DeletedSuggestion(range.id, range.inserted, true), side: -1 }).range(range.to));
  }
  return Decoration.set(ranges, true);
}

class DeletedSuggestion extends WidgetType {
  constructor(readonly id: string, readonly text: string, readonly inserted = false) { super(); }
  eq(other: DeletedSuggestion) { return other.id === this.id && other.text === this.text && other.inserted === this.inserted; }
  toDOM() {
    const element = document.createElement(this.inserted ? 'ins' : 'del');
    element.className = this.inserted ? 'tano-suggestion-insert' : 'tano-suggestion-delete';
    element.dataset.suggestionId = this.id;
    element.textContent = this.text;
    return element;
  }
  ignoreEvent() { return false; }
}
watch(() => props.suggestionMarks, () => view?.dispatch({ effects: refreshCommentMarks.of() }));

function fileHandler(event: Event, files: FileList | null | undefined, requireImage: boolean) {
  if (!props.localNative || props.readonly) return false;
  const selected = Array.from(files ?? []);
  if (!selected.length) return false;
  event.preventDefault();
  emit('files', selected, requireImage, cursor());
  return true;
}

function wrapSelectedSourceField(event: KeyboardEvent, current: EditorView) {
  if (event.ctrlKey || event.metaKey || event.altKey ||
      event.isComposing) return false;
  if (!wrapSourceSelection(current, event.key)) return false;
  event.preventDefault();
  return true;
}

function wrapSourceSelection(current: EditorView, text: string) {
  if (props.readonly || current.composing) return false;
  const selection = current.state.selection.main;
  if (selection.empty || current.state.selection.ranges.length !== 1) return false;
  const selected = current.state.sliceDoc(selection.from, selection.to);
  if (!selected || /[\r\n]/.test(selected)) return false;
  // A Markdown block field is line-scoped in source mode. Do not add syntax
  // around a selection that crosses into another field or block.
  const fromLine = current.state.doc.lineAt(selection.from).number;
  const toLine = current.state.doc.lineAt(selection.to - 1).number;
  if (fromLine !== toLine) return false;
  const source = current.state.doc.toString();
  if (sourceStyleRanges(source).some(range => ['code', 'math', 'frontmatter', 'html'].includes(range.style) &&
      range.from < selection.to && range.to > selection.from)) return false;
  const wrap = selectionWrap(selected, text, props.preferences?.selectionWrapping,
    source.slice(0, selection.from), source.slice(selection.to));
  if (!wrap) return false;
  if (wrap.prefix) current.dispatch({
    changes: { from: selection.from, to: selection.to, insert: wrap.prefix + selected + wrap.suffix },
    selection: { anchor: selection.anchor + wrap.prefix.length, head: selection.head + wrap.prefix.length },
    userEvent: 'input.type',
  });
  return true;
}

onMounted(() => {
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        history(),
        keymap.of([{ ...indentWithTab, preventDefault: true }, ...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': t('Markdown 源码'), spellcheck: 'false' }),
        readonlyMode.of([
          EditorState.readOnly.of(props.readonly),
          EditorView.editable.of(!props.readonly),
        ]),
        sourceStyles,
        pageSearch,
        // Full-width punctuation may arrive as text input without a matching keydown.
        EditorView.inputHandler.of((current, from, to, text) =>
          text === '￥' && from === current.state.selection.main.from &&
          to === current.state.selection.main.to && wrapSourceSelection(current, text)),
        EditorView.domEventHandlers({
          keydown: (event, current) => wrapSelectedSourceField(event, current),
          paste: (event) => fileHandler(event, event.clipboardData?.files, true),
          drop: (event) => fileHandler(event, event.dataTransfer?.files, false),
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !applyingModel)
            emit('update:modelValue', update.state.doc.toString());
          if (update.selectionSet || update.docChanged) emit('selectionChange', !update.state.selection.main.empty);
        }),
      ],
    }),
  });
  emit('ready');
});

onBeforeUnmount(() => { view?.destroy(); view = undefined; });

watch(
  () => props.modelValue,
  (value) => {
    if (!view) return;
    const previous = view.state.doc.toString();
    const next = view.state.toText(value).toString();
    if (next === previous) return;
    // Map the selection and local undo steps through just the changed range.
    let from = 0;
    while (from < previous.length && from < next.length && previous[from] === next[from]) from++;
    let to = previous.length;
    let end = next.length;
    while (to > from && end > from && previous[to - 1] === next[end - 1]) { to--; end--; }
    applyingModel = true;
    try {
      view.dispatch({
        changes: { from, to, insert: next.slice(from, end) },
        annotations: [Transaction.addToHistory.of(false), isolateHistory.of('full')],
      });
    } finally {
      applyingModel = false;
    }
  },
);

watch(
  () => props.readonly,
  (value) =>
    view?.dispatch({
      effects: readonlyMode.reconfigure([
        EditorState.readOnly.of(value),
        EditorView.editable.of(!value),
      ]),
    }),
);
watch(() => props.commentAnchors, () => view?.dispatch({ effects: refreshCommentMarks.of() }), { deep: true });
function commentSelection() {
  if (!view) return null;
  const range = view.state.selection.main;
  const line = view.state.doc.lineAt(range.head);
  const from = range.empty ? line.from : range.from;
  const to = range.empty ? line.to : range.to;
  if (from === to || !view.state.doc.sliceString(from, to).trim()) return null;
  const text = view.state.doc.toString();
  return { text, spans: [{ from, to, text: text.slice(from, to) }] };
}
function focusComment(anchor: CommentAnchor) {
  if (!view || anchor.basis !== 'source' || !anchor.spans.length) return false;
  const span = anchor.spans[0]!;
  if (view.state.doc.sliceString(span.from, span.to) !== span.text) return false;
  view.dispatch({ selection: { anchor: span.from, head: span.to }, scrollIntoView: true });
  view.focus();
  return true;
}
function commentGeometry(anchors = props.commentAnchors ?? []): CommentGeometry | null {
  if (!view) return null;
  const blocks = new Map<number, { key: string; ids: string[]; top: number; bottom: number }>();
  const text = view.state.doc.toString();
  for (const { id, anchor } of anchors) {
    if (anchor.basis !== 'source' || anchor.spans.some(span => text.slice(span.from, span.to) !== span.text)) continue;
    for (const span of anchor.spans) {
      const first = view.state.doc.lineAt(span.from).number;
      const last = view.state.doc.lineAt(span.to - 1).number;
      for (let number = first; number <= last; number++) {
        const line = view.state.doc.line(number);
        const start = view.coordsAtPos(line.from), end = view.coordsAtPos(line.to);
        if (!start || !end) continue;
        const block = blocks.get(line.from) ?? { key: String(line.from), ids: [], top: start.top, bottom: end.bottom };
        if (!block.ids.includes(id)) block.ids.push(id);
        blocks.set(line.from, block);
      }
    }
  }
  const rect = view.contentDOM.getBoundingClientRect();
  return { left: rect.left, right: rect.right, blocks: [...blocks.values()].sort((a, b) => a.top - b.top) };
}
function cursor() {
  return view?.state.selection.main.head ?? 0;
}
function captureTodoSelection() {
  const current = view;
  if (!current || props.readonly || current.state.selection.main.empty) return null;
  const { from, to } = current.state.selection.main;
  const content = current.state.doc.toString();
  const text = content.slice(from, to);
  if (!text.trim()) return null;
  const point = referenceInsertionPoint(content, to);
  return { text, insert: (identity: ReferenceIdentity, label: string) => {
    if (view !== current || props.readonly || current.state.doc.toString() !== content) return false;
    return insertText(`${point.prefix}${referenceMarkdown(identity, label)}${point.suffix}`, point.at);
  } };
}

function focus() {
  view?.focus();
}

function insertText(text: string, position = cursor()) {
  if (!view || props.readonly) return false;
  const at = Math.max(0, Math.min(position, view.state.doc.length));
  const insert = view.state.toText(text);
  view.dispatch({
    changes: { from: at, insert },
    selection: { anchor: at + insert.length },
    annotations: isolateHistory.of('full'),
    scrollIntoView: true,
  });
  return true;
}

function canUndo() {
  return !!view && !props.readonly && undoDepth(view.state) > 0;
}

function undoLastChange() {
  if (!view || props.readonly) return false;
  const changed = undo(view);
  if (changed) view.focus();
  return changed;
}

function canRedo() {
  return !!view && !props.readonly && redoDepth(view.state) > 0;
}

function redoLastChange() {
  if (!view || props.readonly) return false;
  const changed = redo(view);
  if (changed) view.focus();
  return changed;
}

function jumpToLine(line: number, topMargin = 0) {
  if (!view) return;
  const position = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines))).from;
  view.dispatch({
    selection: { anchor: position },
    effects: EditorView.scrollIntoView(position, { y: 'start', yMargin: topMargin + 16 }),
  });
  view.focus();
}

function insertBlockAtStart() {
  if (!view || props.readonly) return;
  const { prefix } = splitFrontmatter(view.state.doc.toString());
  // Keep YAML at the start of the file, including a closing delimiter at EOF.
  const separator = prefix && !prefix.endsWith('\n') ? '\n' : '';
  const position = prefix.length;
  view.dispatch({
    changes: { from: position, insert: `${separator}\n\n` },
    annotations: isolateHistory.of('full'),
    selection: { anchor: position + separator.length },
    scrollIntoView: true,
  });
  view.focus();
}

function search(query: string, index = 0, scroll = true) {
  if (!view) return 0;
  const matches = textSearchRanges(view.state.doc.toString(), query);
  view.dispatch({ effects: [setPageSearch.of({ query, index }),
    ...(scroll && matches[index] ? [EditorView.scrollIntoView(matches[index]!.from, { y: 'center' })] : []),
  ] });
  return matches.length;
}
function replaceSearch(query: string, replacement: string, index: number | 'all') {
  if (!view || props.readonly) return { replaced: 0, index: 0 };
  const matches = textSearchRanges(view.state.doc.toString(), query);
  const selected = index === 'all' ? matches : matches[index] ? [matches[index]!] : [];
  if (!selected.length) return { replaced: 0, index: 0 };
  view.dispatch({
    changes: selected.map(({ from, to }) => ({ from, to, insert: replacement })),
    annotations: isolateHistory.of('full'),
  });
  const next = index === 'all' ? 0 : textSearchRanges(view.state.doc.toString(), query)
    .findIndex(match => match.from >= selected[0]!.from + replacement.length);
  return { replaced: selected.length, index: Math.max(0, next) };
}
function captureModeSelection(): ModeSelection | null {
  if (!view) return null;
  const { anchor, head } = view.state.selection.main;
  return { anchor, head };
}
function restoreModeSelection(selection: ModeSelection, focus = true) {
  if (!view) return;
  const clamp = (position: number) => Math.max(0, Math.min(position, view!.state.doc.length));
  const anchor = clamp(selection.anchor), head = clamp(selection.head);
  view.dispatch({
    selection: { anchor, head },
    effects: EditorView.scrollIntoView(head, { y: 'nearest' }),
  });
  if (focus) view.focus();
}
defineExpose({
  captureModeSelection,
  restoreModeSelection,
  modeCursorTop: () => view?.coordsAtPos(view.state.selection.main.head)?.top ?? null,
  applyPluginEdit: (before: string, after: string) => {
    if (!view || props.readonly || view.state.doc.toString() !== before) throw new Error(t('编辑器内容已变化，请重新读取文档'));
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: after }, annotations: isolateHistory.of('full') });
  },
  search,
  replaceSearch,
  searchSelection: () => view ? view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to) : '',
  assistantSelection: () => view?.state.selection.main.empty ? null : commentSelection(),
  captureTodoSelection,
  commentSelection,
  focusComment,
  commentGeometry,
  cursor,
  focus,
  insertText,
  canUndo,
  undoLastChange,
  canRedo,
  redoLastChange,
  jumpToLine,
  insertBlockAtStart,
});
</script>

<template>
  <div ref="host" class="source-editor" />
</template>
