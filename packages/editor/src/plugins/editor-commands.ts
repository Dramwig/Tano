import { editorViewCtx, parserCtx, serializerCtx, type Editor } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import {
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
} from '@milkdown/kit/preset/commonmark';
import { toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm';
import { toggleMark } from '@milkdown/kit/prose/commands';
import {
  closeHistory,
  redo as redoHistory,
  redoDepth,
  undo as undoHistory,
  undoDepth,
} from '@milkdown/kit/prose/history';
import { Fragment, type Node } from '@milkdown/kit/prose/model';
import {
  NodeSelection,
  Selection,
  TextSelection,
  type EditorState,
  type Transaction,
} from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { callCommand } from '@milkdown/kit/utils';
import { referenceUrl, type CommentAnchor, type ReferenceIdentity } from '@tano/protocol';
import { isHTMLElement } from '../primitives/dom-realm';
import { completeInlineObjectSpacing } from '../auto-spacing';
import { blockCommand, blockCommandNames } from '../block-commands';
import {
  commentSpansForSelection,
  projectCommentText,
  proseRangesForCommentSpans,
  type CommentGeometry,
} from '../comment-projection';
import { commandEnabled } from '../document-model';
import { safeResourceUrl } from '../enhanced-markdown';
import type { EditorExtension } from '../extension';
import { inlineMath } from '../math';
import { markdownPositionMap, type ModeSelection } from '../mode-selection';
import { openReferencePicker } from '../reference-picker';
import type { WorkspaceCapabilities } from '../runtime';
import { pageSearchKey, proseSearchRanges } from '../search';
import { splitFrontmatter } from '../syntax';
import { backgroundColor, highlight, subscript, superscript, textColor, underline } from '../text-styles';
import { normalizeTextColor } from '../text-style-markdown';
import { wikiLink } from '../wiki-link';
import { parseWikiLink } from '../wiki-link-markdown';
import { referenceFlashKey } from './editor-decorations';
import type { LocalSourceState } from './inline-source-controller';

export interface EditorCommandsOptions {
  getEditor: () => Editor | undefined;
  getView: () => EditorView | undefined;
  isDisposed: () => boolean;
  readonly: () => boolean;
  revealMarkdown: () => boolean;
  enabledLevels: () => readonly number[] | undefined;
  policy: () => WorkspaceCapabilities;
  referencesEnabled: () => boolean;
  extension: () => EditorExtension | undefined;
  getModelValue: () => string;
  getLastValue: () => string;
  getFrontmatterPrefix: () => string;
  getCommentAnchors: () => readonly { id: string; anchor: CommentAnchor }[] | undefined;
  getLocalSource: () => LocalSourceState | undefined;
  toggleSourceSyntax: (view: EditorView, name: 'bold' | 'italic' | 'code') => boolean;
  selectedSourceTransaction: (ctx: Ctx, state: EditorState, tr?: Transaction) => Transaction | null;
  blockNodeSourceTransaction: (
    ctx: Ctx,
    state: EditorState,
    selected: { node: Node; pos: number },
    tr: Transaction,
  ) => Transaction;
  isApplying: () => boolean;
  setApplying: (value: boolean) => void;
  onError: (message: string) => void;
}

export function createEditorCommandsApi(options: EditorCommandsOptions) {
  const {
    getEditor,
    getView,
    isDisposed,
    readonly,
    revealMarkdown,
    enabledLevels,
    policy,
    referencesEnabled,
    extension,
    getModelValue,
    getLastValue,
    getFrontmatterPrefix,
    getCommentAnchors,
    getLocalSource,
    toggleSourceSyntax,
    selectedSourceTransaction,
    blockNodeSourceTransaction,
    isApplying,
    setApplying,
    onError,
  } = options;

  let referenceFlashTimer: ReturnType<typeof setTimeout> | undefined;
  let restoredModeSelection:
    | { source: ModeSelection; selection: Selection; doc: Node; markdown: string }
    | undefined;

  function command(name: string, value?: string) {
    const editor = getEditor();
    if (!editor || readonly()) return;
    if (!commandEnabled(name, enabledLevels(), policy().features)) return;
    if (name === 'reference' || name === 'object-reference') {
      if (!referencesEnabled()) return;
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.dispatch(openReferencePicker(view.state, name === 'object-reference'));
      });
      return;
    }
    if (name === 'bold' || name === 'italic' || name === 'code') {
      let sourceEdited = false;
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        if (getLocalSource()?.kind === 'inline') sourceEdited = toggleSourceSyntax(view, name);
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
    if (name in styles) {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        toggleMark(styles[name as keyof typeof styles].type(ctx))(view.state, view.dispatch);
      });
    }
    if (name === 'text-color' || name === 'background-color') {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const type = (name === 'text-color' ? textColor : backgroundColor).type(ctx);
        const color = value ? normalizeTextColor(value) : null;
        if (value && !color) return;
        const { from, to, empty } = view.state.selection;
        const transaction = view.state.tr;
        if (name === 'background-color') {
          const highlightType = highlight.type(ctx);
          if (empty) transaction.removeStoredMark(highlightType);
          else transaction.removeMark(from, to, highlightType);
        }
        if (empty) {
          if (color) transaction.addStoredMark(type.create({ color }));
          else transaction.removeStoredMark(type);
        } else {
          transaction.removeMark(from, to, type);
          if (color) transaction.addMark(from, to, type.create({ color }));
        }
        view.dispatch(transaction);
      });
    }
    if (blockCommandNames.has(name)) {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        if (!blockCommand(name, value)(view.state, view.dispatch)) {
          onError('当前块无法转换为此类型，请先选择正文或标题');
        }
      });
    }
    if (name === 'link') {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { from, to } = view.state.selection;
        if (!view.state.selection.$from.parent.inlineContent) return;
        const tr = view.state.tr.removeMark(from, to, view.state.schema.marks.link!);
        if (value?.trim()) {
          tr.addMark(from, to, view.state.schema.marks.link!.create({ href: value.trim() }));
        }
        view.dispatch(tr);
      });
    }
    if (name === 'mention') {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const target = value?.trim();
        if (!target) return;
        if (/\.[a-z\d]{1,8}(?:[?#].*)?$/i.test(target) && !/\.md(?:[?#]|$)/i.test(target)) {
          if (!safeResourceUrl(target)) {
            onError('请使用工作空间内的相对路径');
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
          onError('所选文字或文档名称包含不支持的提及符号，请调整后重试');
          return;
        }
        const from = view.state.selection.from;
        view.dispatch(
          completeInlineObjectSpacing(
            ctx,
            view.state.tr.replaceSelectionWith(wikiLink.type(ctx).create(parsed)),
            from,
          ),
        );
      });
    }
    if (name === 'footnote') {
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
    }
    if (name === 'math') {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const selected = view.state.doc.textBetween(
          view.state.selection.from,
          view.state.selection.to,
        );
        const node =
          view.state.selection instanceof NodeSelection ? view.state.selection.node : null;
        view.dispatch(
          view.state.tr.replaceSelectionWith(
            inlineMath.type(ctx).create({
              value: node?.type.name === 'math_inline' ? node.attrs.value : selected || 'E = mc^2',
            }),
          ),
        );
      });
    }
    editor.action((ctx) => ctx.get(editorViewCtx).focus());
  }

  function insertBlockAtStart() {
    const editor = getEditor();
    if (!editor || readonly() || isDisposed()) return;
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const tr = view.state.tr.insert(0, view.state.schema.nodes.paragraph!.create());
      tr.setSelection(TextSelection.create(tr.doc, 1));
      view.dispatch(closeHistory(tr).scrollIntoView());
      view.focus();
    });
  }

  function moveToTrailingParagraph(view: EditorView) {
    const { doc, schema } = view.state;
    const paragraph = schema.nodes.paragraph!.create();
    const last = doc.lastChild;
    if (!last) return;
    const reuse = last.eq(paragraph);
    const tr = view.state.tr;
    const position = reuse ? doc.content.size - last.nodeSize + 1 : doc.content.size + 1;
    if (!reuse) tr.insert(doc.content.size, paragraph);
    tr.setSelection(TextSelection.create(tr.doc, position)).setStoredMarks([]);
    view.dispatch((reuse ? tr : closeHistory(tr)).scrollIntoView());
    view.focus();
  }

  function focusTrailingParagraph(event: MouseEvent) {
    const editor = getEditor();
    if (
      !editor ||
      readonly() ||
      isDisposed() ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.shiftKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    ) {
      return;
    }
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      // Only bare editor/background surfaces count, never block content or controls.
      if (
        !view.editable ||
        view.composing ||
        view.dragging ||
        !isHTMLElement(event.target) ||
        !event.target.contains(view.dom)
      ) {
        return;
      }
      const { doc } = view.state;
      const last = doc.lastChild;
      if (!last) return;
      const lastDOM = view.nodeDOM(doc.content.size - last.nodeSize);
      if (!isHTMLElement(lastDOM) || event.clientY < lastDOM.getBoundingClientRect().bottom) return;
      event.preventDefault();
      moveToTrailingParagraph(view);
    });
  }

  function canUndo() {
    const editor = getEditor();
    if (!editor || readonly() || extension()?.ownsHistory) return false;
    return editor.action((ctx) => undoDepth(ctx.get(editorViewCtx).state) > 0);
  }

  function undoLastChange() {
    const editor = getEditor();
    if (!editor || readonly() || extension()?.ownsHistory) return false;
    return editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const changed = undoHistory(view.state, view.dispatch);
      if (changed) view.focus();
      return changed;
    });
  }

  function canRedo() {
    const editor = getEditor();
    if (!editor || readonly() || extension()?.ownsHistory) return false;
    return editor.action((ctx) => redoDepth(ctx.get(editorViewCtx).state) > 0);
  }

  function redoLastChange() {
    const editor = getEditor();
    if (!editor || readonly() || extension()?.ownsHistory) return false;
    return editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const changed = redoHistory(view.state, view.dispatch);
      if (changed) view.focus();
      return changed;
    });
  }

  function withContext<T>(action: (ctx: Ctx, markdown: string) => T): T {
    const editor = getEditor();
    if (!editor) throw new Error('编辑器尚未就绪');
    return editor.action((ctx) => action(ctx, getLastValue()));
  }

  function commentSelection() {
    const bridgeView = getView();
    if (!bridgeView) return null;
    const { doc, selection } = bridgeView.state;
    const range =
      selection.empty && selection.$from.parent.isTextblock
        ? TextSelection.create(doc, selection.$from.start(), selection.$from.end())
        : selection;
    const spans = commentSpansForSelection(doc, range);
    return spans.length ? { text: projectCommentText(doc).text, spans } : null;
  }

  /** Capture a real rich-text selection with source offsets for guarded assistant edits. */
  function assistantSelection() {
    const view = getView();
    const editor = getEditor();
    if (!view || !editor || !(view.state.selection instanceof TextSelection) || view.state.selection.empty) {
      return null;
    }
    const { doc, selection } = view.state;
    const spans = commentSpansForSelection(doc, selection);
    if (!spans.length) return null;
    const lastValue = getLastValue();
    return editor.action((ctx) => {
      const map = markdownPositionMap(
        doc,
        lastValue,
        (node) => getFrontmatterPrefix() + ctx.get(serializerCtx)(node),
      );
      const from = map.toSource(selection.from);
      const to = map.toSource(selection.to);
      return { text: lastValue.slice(from, to), from, to, spans };
    });
  }

  function assistantBlankBlockSelection() {
    const view = getView();
    const editor = getEditor();
    if (
      !view ||
      !editor ||
      readonly() ||
      !(view.state.selection instanceof TextSelection) ||
      !view.state.selection.empty ||
      view.state.selection.$from.parent.type.name !== 'paragraph' ||
      view.state.selection.$from.parent.content.size !== 0
    ) {
      return null;
    }
    return editor.action((ctx) => {
      const map = markdownPositionMap(
        view.state.doc,
        getLastValue(),
        (node) => getFrontmatterPrefix() + ctx.get(serializerCtx)(node),
      );
      const offset = map.toSource(view.state.selection.from);
      return { text: '', from: offset, to: offset };
    });
  }

  function captureTodoSelection() {
    const view = getView();
    if (
      !view ||
      readonly() ||
      extension() ||
      !(view.state.selection instanceof TextSelection) ||
      view.state.selection.empty ||
      !view.state.selection.$to.parent.isTextblock
    ) {
      return null;
    }
    const doc = view.state.doc;
    const at = view.state.selection.to;
    const type = view.state.schema.nodes.tano_reference;
    if (!type) return null;
    const $to = view.state.selection.$to;
    const inline = $to.parent.canReplaceWith($to.index(), $to.index(), type);
    const paragraph = view.state.schema.nodes.paragraph;
    if (!inline && (!paragraph || !$to.node(-1).canReplaceWith($to.index(-1) + 1, $to.index(-1) + 1, paragraph))) {
      return null;
    }
    const spans = commentSpansForSelection(doc, view.state.selection);
    const text = spans.map((span) => span.text).join('\n');
    if (!text.trim()) return null;
    return {
      text,
      insert: (identity: ReferenceIdentity, label: string) => {
        if (getView() !== view || readonly() || extension() || !view.state.doc.eq(doc)) return false;
        const reference = type.create({ url: referenceUrl(identity), label });
        const insertion = inline
          ? Fragment.fromArray([
              view.state.schema.text(' '),
              type.create({ url: referenceUrl(identity), label }),
            ])
          : Fragment.from(paragraph!.create(null, reference));
        view.dispatch(view.state.tr.insert(inline ? at : $to.after(), insertion).scrollIntoView());
        return true;
      },
    };
  }

  function focusComment(anchor: CommentAnchor) {
    const bridgeView = getView();
    if (!bridgeView || anchor.basis !== 'prose') return false;
    const ranges = proseRangesForCommentSpans(bridgeView.state.doc, anchor.spans);
    if (!ranges.length) return false;
    const { from, to } = ranges[0]!;
    bridgeView.dispatch(
      bridgeView.state.tr
        .setSelection(TextSelection.create(bridgeView.state.doc, from, to))
        .scrollIntoView(),
    );
    bridgeView.focus();
    return true;
  }

  function commentGeometry(anchors = getCommentAnchors() ?? []): CommentGeometry | null {
    const bridgeView = getView();
    if (!bridgeView || !anchors.length) return null;
    const { doc } = bridgeView.state;
    const text = projectCommentText(doc).text;
    const blocks = new Map<number, { key: string; ids: string[]; top: number; bottom: number }>();
    for (const { id, anchor } of anchors) {
      if (
        anchor.basis !== 'prose' ||
        anchor.spans.some((span) => text.slice(span.from, span.to) !== span.text)
      ) {
        continue;
      }
      for (const { from } of proseRangesForCommentSpans(doc, anchor.spans)) {
        const $pos = doc.resolve(from);
        let depth = $pos.depth;
        while (depth > 1 && !$pos.node(depth).isTextblock) depth--;
        const position = depth ? $pos.before(depth) : from;
        const dom = bridgeView.nodeDOM(position);
        const element = isHTMLElement(dom) ? dom : dom?.parentElement;
        if (!element || !element.getClientRects().length) continue;
        const rect = element.getBoundingClientRect();
        const block =
          blocks.get(position) ?? {
            key: String(position),
            ids: [],
            top: rect.top,
            bottom: rect.bottom,
          };
        if (!block.ids.includes(id)) block.ids.push(id);
        blocks.set(position, block);
      }
    }
    const rect = bridgeView.dom.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      blocks: [...blocks.values()].sort((a, b) => a.top - b.top),
    };
  }

  function search(query: string, index = 0, scroll = true) {
    const view = getView();
    if (!view || isDisposed()) return 0;
    view.dispatch(
      view.state.tr.setMeta(pageSearchKey, { query, index }).setMeta('addToHistory', false),
    );
    const ranges = pageSearchKey.getState(view.state)?.ranges ?? [];
    const match = ranges[index];
    if (scroll && match) {
      view.dispatch(
        view.state.tr.setMeta('tanoRevealPosition', match.from).setMeta('addToHistory', false),
      );
      const element = view.dom.querySelector<HTMLElement>('.tano-search-current');
      element?.dispatchEvent(new Event('tano-reveal-search', { bubbles: true }));
      for (let parent = element; parent && parent !== view.dom; parent = parent.parentElement) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
      }
      element?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    }
    return ranges.length;
  }

  function searchSelection() {
    const bridgeView = getView();
    if (!bridgeView) return '';
    const { doc, selection } = bridgeView.state;
    return doc.textBetween(selection.from, selection.to, '\n');
  }

  function replaceSearch(query: string, replacement: string, index: number | 'all') {
    const view = getView();
    if (!view || isDisposed() || readonly()) return { replaced: 0, index: 0 };
    const matches = proseSearchRanges(view.state.doc, query);
    const selected = index === 'all' ? matches : matches[index] ? [matches[index]!] : [];
    if (!selected.length) return { replaced: 0, index: 0 };
    const tr = closeHistory(view.state.tr);
    for (const { from, to } of [...selected].reverse()) tr.insertText(replacement, from, to);
    // Keep replacement as one undo step, separate from typing before and after it.
    view.dispatch(tr);
    view.dispatch(closeHistory(view.state.tr));
    const next =
      index === 'all'
        ? 0
        : proseSearchRanges(view.state.doc, query).findIndex(
            (match) => match.from >= selected[0]!.from + replacement.length,
          );
    return { replaced: selected.length, index: Math.max(0, next) };
  }

  function applyPluginEdit(before: string, after: string) {
    const editor = getEditor();
    if (!editor || readonly() || getModelValue() !== before) {
      throw new Error('编辑器内容已变化，请重新读取文档');
    }
    const next = splitFrontmatter(after);
    if (next.prefix !== splitFrontmatter(before).prefix) {
      throw new Error('当前编辑器的插件事务暂不支持修改文档属性');
    }
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const parsed = ctx.get(parserCtx)(next.body);
      if (!parsed) throw new Error('插件生成的 Markdown 无法解析');
      const from = view.state.doc.content.findDiffStart(parsed.content);
      if (from === null) return;
      const end = view.state.doc.content.findDiffEnd(parsed.content)!;
      const overlap = from - Math.min(end.a, end.b);
      if (overlap > 0) {
        end.a += overlap;
        end.b += overlap;
      }
      view.dispatch(closeHistory(view.state.tr).replace(from, end.a, parsed.slice(from, end.b)));
      view.dispatch(closeHistory(view.state.tr));
    });
  }

  function captureModeSelection(): ModeSelection | null {
    const editor = getEditor();
    const bridgeView = getView();
    if (!editor || !bridgeView) return null;
    const { doc, selection } = bridgeView.state;
    const restored = restoredModeSelection;
    const lastValue = getLastValue();
    // Syntax-only positions (for example inside a closing delimiter) can have no
    // rendered equivalent. Retain the exact source offset until the user moves.
    if (
      restored &&
      restored.markdown === lastValue &&
      restored.doc.eq(doc) &&
      restored.selection.eq(selection)
    ) {
      return { ...restored.source };
    }
    return editor.action((ctx) => {
      const map = markdownPositionMap(
        doc,
        lastValue,
        (node) => getFrontmatterPrefix() + ctx.get(serializerCtx)(node),
      );
      return { anchor: map.toSource(selection.anchor), head: map.toSource(selection.head) };
    });
  }

  function restoreModeSelection(selection: ModeSelection, focus = true) {
    const editor = getEditor();
    const view = getView();
    if (!editor || !view || isDisposed()) return;
    const lastValue = getLastValue();
    editor.action((ctx) => {
      const restore = () => {
        const map = markdownPositionMap(
          view.state.doc,
          lastValue,
          (node) => getFrontmatterPrefix() + ctx.get(serializerCtx)(node),
        );
        const anchor = Selection.near(view.state.doc.resolve(map.toProse(selection.anchor)));
        const head = Selection.near(view.state.doc.resolve(map.toProse(selection.head)));
        const next =
          anchor instanceof TextSelection && head instanceof TextSelection
            ? TextSelection.create(view.state.doc, anchor.head, head.head)
            : head;
        view.dispatch(
          view.state.tr
            .setSelection(next)
            .setMeta('addToHistory', false)
            .setMeta('tanoKeepNodeView', true)
            .setMeta('tanoRevealPosition', next.head),
        );
      };
      setApplying(true);
      try {
        restore();
        if (focus) {
          view.focus();
          if (!readonly() && revealMarkdown() && selection.anchor === selection.head) {
            const tr = selectedSourceTransaction(ctx, view.state);
            if (tr) {
              view.dispatch(tr);
              restore();
            }
          }
        }
      } finally {
        setApplying(false);
      }
      const dom = view.domAtPos(view.state.selection.head).node;
      const element = isHTMLElement(dom) ? dom : dom.parentElement;
      element?.dispatchEvent(new Event('tano-reveal-search', { bubbles: true }));
      for (let parent = element; parent && parent !== view.dom; parent = parent.parentElement) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
      }
      restoredModeSelection = {
        source: { ...selection },
        selection: view.state.selection,
        doc: view.state.doc,
        markdown: lastValue,
      };
    });
  }

  function modeCursorTop() {
    const bridgeView = getView();
    if (!bridgeView || isDisposed()) return null;
    const selection = bridgeView.state.selection;
    return bridgeView.coordsAtPos(
      selection instanceof NodeSelection ? selection.from : selection.head,
    ).top;
  }

  function revealSourceRange(range: { from: number; to: number }) {
    const editor = getEditor();
    const view = getView();
    const lastValue = getLastValue();
    if (
      !editor ||
      !view ||
      isDisposed() ||
      range.from < 0 ||
      range.to > lastValue.length ||
      range.to <= range.from
    ) {
      return false;
    }
    return editor.action((ctx) => {
      const map = markdownPositionMap(
        view.state.doc,
        lastValue,
        (node) => getFrontmatterPrefix() + ctx.get(serializerCtx)(node),
      );
      const from = map.toProse(range.from);
      const to = map.toProse(range.to);
      if (to <= from) return false;
      clearTimeout(referenceFlashTimer);
      // Removing the old decoration restarts the animation on repeated clicks.
      view.dispatch(view.state.tr.setMeta(referenceFlashKey, null).setMeta('addToHistory', false));
      view.dispatch(
        view.state.tr
          .setMeta(referenceFlashKey, { from, to })
          .setMeta('tanoRevealPosition', from)
          .setMeta('addToHistory', false),
      );
      const element = view.dom.querySelector<HTMLElement>('.tano-reference-flash');
      element?.dispatchEvent(new Event('tano-reveal-search', { bubbles: true }));
      for (let parent = element; parent && parent !== view.dom; parent = parent.parentElement) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
      }
      element?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
      referenceFlashTimer = setTimeout(() => {
        if (!isDisposed() && getView() === view) {
          view.dispatch(
            view.state.tr.setMeta(referenceFlashKey, null).setMeta('addToHistory', false),
          );
        }
      }, 2400);
      return true;
    });
  }

  /** Render the normal source-editing state in an isolated example without moving browser focus. */
  function revealPreviewSource() {
    const editor = getEditor();
    const bridgeView = getView();
    if (!editor || !bridgeView || isDisposed() || readonly()) return;
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const node = view.state.doc.firstChild;
      if (!node || node.type.name === 'tano_live_source') return;
      const tr = blockNodeSourceTransaction(ctx, view.state, { node, pos: 0 }, view.state.tr);
      const previous = isApplying();
      setApplying(true);
      try {
        view.dispatch(tr.setMeta('addToHistory', false));
      } finally {
        setApplying(previous);
      }
    });
  }

  function dispose() {
    clearTimeout(referenceFlashTimer);
  }

  return {
    command,
    insertBlockAtStart,
    moveToTrailingParagraph,
    focusTrailingParagraph,
    canUndo,
    undoLastChange,
    canRedo,
    redoLastChange,
    withContext,
    commentSelection,
    assistantSelection,
    assistantBlankBlockSelection,
    captureTodoSelection,
    focusComment,
    commentGeometry,
    search,
    searchSelection,
    replaceSearch,
    applyPluginEdit,
    captureModeSelection,
    restoreModeSelection,
    modeCursorTop,
    revealSourceRange,
    revealPreviewSource,
    dispose,
  };
}
