<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  defaultKeymap,
  history,
  historyKeymap,
  isolateHistory,
  redo,
  redoDepth,
  undo,
  undoDepth,
} from '@codemirror/commands';
import { Compartment, EditorState, StateField, Transaction } from '@codemirror/state';
import { Decoration, EditorView, keymap } from '@codemirror/view';
import { sourceStyleRanges } from '@tano/editor/source-highlight';
import { splitFrontmatter } from '@tano/editor/syntax';

const props = defineProps<{
  modelValue: string;
  readonly: boolean;
  localNative: boolean;
}>();
const emit = defineEmits<{
  'update:modelValue': [value: string];
  files: [files: File[], requireImage: boolean, position: number];
}>();

const host = ref<HTMLElement>();
const readonlyMode = new Compartment();
let view: EditorView | undefined;
let applyingModel = false;

const sourceStyles = StateField.define({
  create(state) {
    return decorations(state.doc.toString());
  },
  update(current, transaction) {
    return transaction.docChanged ? decorations(transaction.state.doc.toString()) : current;
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
  return Decoration.set(ranges, true);
}

function fileHandler(event: Event, files: FileList | null | undefined, requireImage: boolean) {
  if (!props.localNative || props.readonly) return false;
  const selected = Array.from(files ?? []);
  if (!selected.length) return false;
  event.preventDefault();
  emit('files', selected, requireImage, cursor());
  return true;
}

onMounted(() => {
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': 'Markdown 源码', spellcheck: 'false' }),
        readonlyMode.of([
          EditorState.readOnly.of(props.readonly),
          EditorView.editable.of(!props.readonly),
        ]),
        sourceStyles,
        EditorView.domEventHandlers({
          paste: (event) => fileHandler(event, event.clipboardData?.files, true),
          drop: (event) => fileHandler(event, event.dataTransfer?.files, false),
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !applyingModel)
            emit('update:modelValue', update.state.doc.toString());
        }),
      ],
    }),
  });
});

onBeforeUnmount(() => view?.destroy());

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
function cursor() {
  return view?.state.selection.main.head ?? 0;
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

defineExpose({
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
