<script setup lang="ts">
// SPDX-License-Identifier: MIT
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
import {
  Decoration,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  type DecorationSet,
} from '@codemirror/view';
import { textSearchRanges } from '../core/search';
import { codePreviewTokens } from './code-preview';

const setPageSearch = StateEffect.define<{ query: string; index: number }>();
const refreshSyntax = StateEffect.define<string>();

function fileExtensionFromPath(path: string): string {
  const base = path.split('/').at(-1)?.toLowerCase() ?? '';
  if (!base.includes('.')) return base;
  return base.split('.').at(-1) ?? '';
}

function buildSyntaxDecorations(text: string, extension: string): DecorationSet {
  if (!text || text.length > 100_000) return Decoration.none;
  const tokens = codePreviewTokens(text, extension);
  const ranges = [];
  let offset = 0;
  for (const token of tokens) {
    const end = offset + token.text.length;
    if (token.className && end > offset) {
      ranges.push(Decoration.mark({ class: token.className }).range(offset, end));
    }
    offset = end;
  }
  return ranges.length ? Decoration.set(ranges, true) : Decoration.none;
}

const pageSearch = StateField.define({
  create: () => ({ query: '', index: 0, ranges: Decoration.none }),
  update(previous, tr) {
    const request = tr.effects.find((effect) => effect.is(setPageSearch))?.value;
    if (!request && !tr.docChanged) return previous;
    const { query, index } = request ?? previous;
    if (!query) return { query: '', index: 0, ranges: Decoration.none };
    return {
      query,
      index,
      ranges: Decoration.set(
        textSearchRanges(tr.state.doc.toString(), query).map(({ from, to }, i) =>
          Decoration.mark({
            class: `tano-search-match${i === index ? ' tano-search-current' : ''}`,
          }).range(from, to),
        ),
      ),
    };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.ranges),
});

const props = defineProps<{
  modelValue: string;
  path: string;
  readonly: boolean;
  wordWrap?: boolean;
}>();

const emit = defineEmits<{
  ready: [];
  'update:modelValue': [value: string];
  selectionChange: [selected: boolean];
}>();

const host = ref<HTMLElement>();
const readonlyMode = new Compartment();
const wrapMode = new Compartment();
let view: EditorView | undefined;
let applyingModel = false;
let currentExtension = fileExtensionFromPath(props.path);

const syntaxHighlight = StateField.define<DecorationSet>({
  create(state) {
    return buildSyntaxDecorations(state.doc.toString(), currentExtension);
  },
  update(previous, tr) {
    const extEffect = tr.effects.find((effect) => effect.is(refreshSyntax));
    if (extEffect) {
      return buildSyntaxDecorations(tr.state.doc.toString(), extEffect.value);
    }
    if (!tr.docChanged) return previous;
    return buildSyntaxDecorations(tr.state.doc.toString(), currentExtension);
  },
  provide: (field) => EditorView.decorations.from(field),
});

function createView() {
  if (!host.value) return;
  currentExtension = fileExtensionFromPath(props.path);
  const state = EditorState.create({
    doc: props.modelValue,
    extensions: [
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      history(),
      keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
      readonlyMode.of([EditorState.readOnly.of(props.readonly), EditorView.editable.of(!props.readonly)]),
      wrapMode.of(props.wordWrap ? EditorView.lineWrapping : []),
      syntaxHighlight,
      pageSearch,
      EditorView.updateListener.of((update) => {
        if (update.selectionSet) {
          emit('selectionChange', !update.state.selection.main.empty);
        }
        if (update.docChanged && !applyingModel) {
          emit('update:modelValue', update.state.doc.toString());
        }
      }),
    ],
  });
  view = new EditorView({ state, parent: host.value });
  emit('ready');
}

onMounted(createView);
onBeforeUnmount(() => {
  view?.destroy();
  view = undefined;
});

watch(
  () => props.modelValue,
  (next) => {
    if (!view || view.state.doc.toString() === next) return;
    applyingModel = true;
    try {
      const sel = view.state.selection.main;
      const anchor = Math.min(sel.anchor, next.length);
      const head = Math.min(sel.head, next.length);
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next },
        selection: { anchor, head },
        annotations: Transaction.addToHistory.of(false),
      });
    } finally {
      applyingModel = false;
    }
  },
);

watch(
  () => props.readonly,
  (readonly) => {
    view?.dispatch({
      effects: readonlyMode.reconfigure([
        EditorState.readOnly.of(readonly),
        EditorView.editable.of(!readonly),
      ]),
    });
  },
);

watch(
  () => props.wordWrap,
  (wrap) => {
    view?.dispatch({
      effects: wrapMode.reconfigure(wrap ? EditorView.lineWrapping : []),
    });
  },
);

watch(
  () => props.path,
  (path) => {
    currentExtension = fileExtensionFromPath(path);
    view?.dispatch({ effects: refreshSyntax.of(currentExtension) });
  },
);

function focus() {
  view?.focus();
}

function cursor() {
  return view?.state.selection.main.head ?? 0;
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

function search(query: string, index = 0, scroll = true) {
  if (!view) return 0;
  const matches = textSearchRanges(view.state.doc.toString(), query);
  view.dispatch({
    effects: [
      setPageSearch.of({ query, index }),
      ...(scroll && matches[index]
        ? [EditorView.scrollIntoView(matches[index]!.from, { y: 'center' })]
        : []),
    ],
  });
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
  const next =
    index === 'all'
      ? 0
      : textSearchRanges(view.state.doc.toString(), query).findIndex(
          (match) => match.from >= selected[0]!.from + replacement.length,
        );
  return { replaced: selected.length, index: Math.max(0, next) };
}

defineExpose({
  search,
  replaceSearch,
  searchSelection: () =>
    view ? view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to) : '',
  cursor,
  focus,
  canUndo,
  undoLastChange,
  canRedo,
  redoLastChange,
  jumpToLine,
});
</script>

<template>
  <div ref="host" class="code-editor" :class="{ 'is-readonly': readonly }" />
</template>
