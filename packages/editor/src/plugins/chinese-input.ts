import type { Ctx } from '@milkdown/kit/ctx';
import { closeHistory } from '@milkdown/kit/prose/history';
import type { EditorView } from '@milkdown/kit/prose/view';
import { isElement } from '../primitives/dom-realm';
import { completeProseSpacing, markTextSpacingInput } from '../auto-spacing';
import {
  chineseSyntaxEdit,
  mapChineseInput,
  mappedChineseBeforeInput,
  mappedChineseInputKey,
  normalizeChineseInput,
  type EditorPreferences,
  type WorkspaceCapabilities,
} from '../runtime';

export interface ChineseInputControllerOptions {
  readonly: () => boolean;
  isDisposed: () => boolean;
  preferences: () => EditorPreferences;
  policy: () => WorkspaceCapabilities;
  canSpaceTextInput: (view: EditorView) => boolean;
  wrapSelectedInlineSource: (
    ctx: Ctx,
    view: EditorView,
    from: number,
    to: number,
    text: string,
  ) => boolean;
  insertEmptyCodeSourceText: (view: EditorView, from: number, to: number, text: string) => boolean;
  fillEmptyRenderedCodeLine: (view: EditorView, from: number, to: number, text: string) => boolean;
  insertPartialEmphasisSource: (
    ctx: Ctx,
    view: EditorView,
    from: number,
    to: number,
    text: string,
  ) => boolean;
}

export function chineseInputEventTarget(event: Event): boolean {
  return !(
    isElement(event.target) && event.target.closest('input, textarea, [contenteditable="false"]')
  );
}

export function createChineseInputController(options: ChineseInputControllerOptions) {
  const {
    readonly,
    isDisposed,
    preferences,
    policy,
    canSpaceTextInput,
    wrapSelectedInlineSource,
    insertEmptyCodeSourceText,
    fillEmptyRenderedCodeLine,
    insertPartialEmphasisSource,
  } = options;

  let chineseCompositionRevision = 0;
  let replayingChineseSyntax = false;

  function chineseInputSettings() {
    return normalizeChineseInput(preferences().chineseInput, preferences().selectionWrapping);
  }

  function mappedChineseInput(text: string) {
    return mapChineseInput(text, chineseInputSettings());
  }

  function insertChineseSyntax(
    view: EditorView,
    from: number,
    to: number,
    text: string,
    committed = false,
  ) {
    if (
      replayingChineseSyntax ||
      readonly() ||
      view.composing ||
      (!committed && from !== to) ||
      !view.state.selection.empty
    ) {
      return false;
    }
    const resolved = view.state.doc.resolve(from);
    if (
      !resolved.parent.isTextblock ||
      resolved.parent.type.spec.code ||
      /math|tano_live_source/.test(resolved.parent.type.name) ||
      resolved.marks().some((m) => m.type.spec.code)
    ) {
      return false;
    }
    const before = resolved.parent.textBetween(0, resolved.parentOffset, '', '\ufffc');
    const edit = chineseSyntaxEdit(before, text, chineseInputSettings(), 'visual');
    if (!edit) return false;
    const start = from - edit.deleteBefore;
    const prefix = edit.insert.slice(0, -1);
    const tail = edit.insert.slice(-1);
    replayingChineseSyntax = true;
    try {
      view.dispatch(closeHistory(view.state.tr).insertText(prefix, start, committed ? to : from));
      const pos = start + prefix.length;
      const handled = view.someProp('handleTextInput', (handler) =>
        handler(view, pos, pos, tail, () => view.state.tr.insertText(tail, pos)),
      );
      if (!handled) view.dispatch(view.state.tr.insertText(tail, pos));
    } finally {
      replayingChineseSyntax = false;
    }
    return true;
  }

  function insertMappedChineseInput(
    ctx: Ctx,
    view: EditorView,
    from: number,
    to: number,
    mapped: string,
  ) {
    if (readonly() || view.composing) return false;
    if (
      !wrapSelectedInlineSource(ctx, view, from, to, mapped) &&
      !insertEmptyCodeSourceText(view, from, to, mapped) &&
      !fillEmptyRenderedCodeLine(view, from, to, mapped) &&
      !insertPartialEmphasisSource(ctx, view, from, to, mapped)
    ) {
      const tr = view.state.tr.insertText(mapped, from, to);
      if (canSpaceTextInput(view)) markTextSpacingInput(tr, from, mapped);
      view.dispatch(tr);
    }
    return true;
  }

  function insertChineseInput(
    ctx: Ctx,
    view: EditorView,
    from: number,
    to: number,
    text: string,
  ) {
    if (insertChineseSyntax(view, from, to, text)) return true;
    const mapped = mappedChineseInput(text);
    return mapped !== text && insertMappedChineseInput(ctx, view, from, to, mapped);
  }

  function beforeChineseInput(ctx: Ctx, view: EditorView, event: InputEvent) {
    if (!chineseInputEventTarget(event)) return false;
    if (
      !event.isComposing &&
      event.inputType === 'insertText' &&
      event.data &&
      insertChineseSyntax(view, view.state.selection.from, view.state.selection.to, event.data)
    ) {
      event.preventDefault();
      return true;
    }
    const mapped = mappedChineseBeforeInput(event, chineseInputSettings());
    if (mapped === null) return false;
    const ranges = event.getTargetRanges?.() ?? [];
    if (ranges.length > 1) return false;
    let { from, to } = view.state.selection;
    if (ranges.length) {
      const range = ranges[0]!;
      if (!view.dom.contains(range.startContainer) || !view.dom.contains(range.endContainer)) {
        return false;
      }
      from = view.posAtDOM(range.startContainer, range.startOffset);
      to = view.posAtDOM(range.endContainer, range.endOffset);
    }
    if (from < 0 || to < from || to > view.state.doc.content.size) return false;
    if (!insertMappedChineseInput(ctx, view, from, to, mapped)) return false;
    event.preventDefault();
    return true;
  }

  function handleChineseKeyDown(ctx: Ctx, view: EditorView, event: KeyboardEvent) {
    const mapped =
      chineseInputEventTarget(event) && mappedChineseInputKey(event, chineseInputSettings());
    if (
      mapped &&
      insertMappedChineseInput(ctx, view, view.state.selection.from, view.state.selection.to, mapped)
    ) {
      event.preventDefault();
      return true;
    }
    return false;
  }

  function insertChineseInputFromComposition(
    view: EditorView,
    from: number,
    to: number,
    text: string,
  ) {
    if (insertChineseSyntax(view, from, to, text, true)) return;
    const mapped = mappedChineseInput(text);
    const tr = mapped !== text ? view.state.tr.insertText(mapped, from, to) : view.state.tr;
    if (canSpaceTextInput(view)) {
      completeProseSpacing(tr, from, from + mapped.length, policy().features);
    }
    if (tr.docChanged) view.dispatch(tr);
  }

  function finishChineseComposition(view: EditorView, text: string) {
    const revision = ++chineseCompositionRevision;
    if (!text) return;
    // Run after the editor's composition-end flush, within the same paint boundary.
    // A timer can leave the committed Chinese glyph visible for a frame in WebView2.
    queueMicrotask(() =>
      queueMicrotask(() => {
        if (
          revision !== chineseCompositionRevision ||
          isDisposed() ||
          view.isDestroyed ||
          readonly() ||
          view.composing
        ) {
          return;
        }
        const { selection } = view.state;
        if (!selection.empty || selection.$from.parentOffset < text.length) return;
        const to = selection.from;
        const from = to - text.length;
        if (view.state.doc.textBetween(from, to) === text) {
          insertChineseInputFromComposition(view, from, to, text);
        }
      }),
    );
  }

  function bumpCompositionRevision() {
    chineseCompositionRevision++;
  }

  return {
    chineseInputSettings,
    insertChineseInput,
    beforeChineseInput,
    handleChineseKeyDown,
    finishChineseComposition,
    bumpCompositionRevision,
  };
}
