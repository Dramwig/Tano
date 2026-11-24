import { editorViewCtx, parserCtx, serializerCtx, type Editor } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import { sanitizeLinkHref } from '@milkdown/kit/preset/commonmark';
import { Fragment, type Node } from '@milkdown/kit/prose/model';
import {
  NodeSelection,
  Selection,
  TextSelection,
  type EditorState,
  type Transaction,
} from '@milkdown/kit/prose/state';
import { canSplit } from '@milkdown/kit/prose/transform';
import type { EditorView } from '@milkdown/kit/prose/view';
import {
  parseReferenceUrl,
  resolveReference,
  type ReferenceIdentity,
  type ReferenceTarget,
} from '@tano/protocol';
import { isElement, isHTMLElement, isMouseEvent } from '../primitives/dom-realm';
import { activeInlineSourceRange } from './inline-source-range';
import {
  inlineSourceAttributes,
  inlineSourceCodec,
  reconcileInlineSource,
  type InlineSourceSession,
} from './inline-source-session';
import { liveInlineSource, liveSource } from '../markdown/live-source';
import { emptyFencedCodeBodyOffset } from '../markdown/live-markdown';
import { sourceBlockStyle } from '../views/source-preview';
import { sourceStyleRanges } from './source-highlight';
import { BlockRangeSelection } from './block-selection';
import { blockTree } from './block-tree';
import {
  selectionWrap,
  workspaceWrapping,
  type EditorPreferences,
  type WorkspaceCapabilities,
} from '../core/runtime';
import { linkMarkRange } from './link-panel-controller';

export type BlockSourceGroup = { id: string; original: Fragment; initial: string };

export type LocalSourceState =
  | {
      kind: 'block';
      id: string;
      original: Node;
      initial: string;
      style: Record<string, string> | null;
      dismissOnOutside?: boolean;
    }
  | { kind: 'block-group'; id: string; sources: BlockSourceGroup[] }
  | InlineSourceSession
  | { kind: 'footnote-label'; id: string; initial: string; createdParagraph: boolean };

export type InlineSourceDestination =
  | { kind: 'wiki'; target: string }
  | { kind: 'reference'; identity: ReferenceIdentity }
  | { kind: 'link'; href: string };

const editableInlineAtoms = new Set([
  'tano_reference',
  'tano_wiki_link',
  'math_inline',
  'footnote_reference',
  'html',
  'image',
]);

export function isEditableInlineAtom(node: Node, parent: Node): boolean {
  return (
    node.isInline &&
    editableInlineAtoms.has(node.type.name) &&
    !(node.type.name === 'image' && parent.type.name === 'paragraph' && parent.childCount === 1)
  );
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

export interface InlineSourceControllerOptions {
  getEditor: () => Editor | undefined;
  getView: () => EditorView | undefined;
  isDisposed: () => boolean;
  readonly: () => boolean;
  revealMarkdown: () => boolean;
  policy: () => WorkspaceCapabilities;
  preferences: () => EditorPreferences;
  referencesEnabled: () => boolean;
  referenceTargets: () => readonly ReferenceTarget[];
  isApplying: () => boolean;
  setApplying: (value: boolean) => void;
  onError: (message: string) => void;
  onOpenWikiLink: (target: string) => void;
  onOpenReference: (identity: ReferenceIdentity) => void;
  onOpenLink: (href: string) => void;
}

export function createInlineSourceController(options: InlineSourceControllerOptions) {
  const {
    getEditor,
    getView,
    isDisposed,
    readonly,
    revealMarkdown,
    policy,
    preferences,
    referencesEnabled,
    referenceTargets,
    isApplying,
    setApplying,
    onError,
    onOpenWikiLink,
    onOpenReference,
    onOpenLink,
  } = options;

  let localSource: LocalSourceState | undefined;
  let localSourceCounter = 0;
  let transitioningSource = false;
  let sourceActivationPending = false;
  let selectingWithPointer = false;

  function sourceId() {
    return typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `local-${++localSourceCounter}`;
  }

  function findCurrentSource(state: EditorState) {
    if (!localSource) return undefined;
    const ids = new Set(
      localSource.kind === 'block-group'
        ? localSource.sources.map((source) => source.id)
        : [localSource.id],
    );
    let found: { node: Node; pos: number } | undefined;
    state.doc.descendants((node, pos) => {
      if (
        ['tano_live_source', 'tano_live_source_inline'].includes(node.type.name) &&
        ids.has(node.attrs.id)
      ) {
        // Several disjoint block groups can stay open together. Prefer the one
        // containing the selection so moving between their sources keeps them open.
        if (!found || (state.selection.from >= pos + 1 && state.selection.to < pos + node.nodeSize)) {
          found = { node, pos };
        }
        return false;
      }
    });
    return found;
  }

  function currentSource(view: EditorView) {
    return findCurrentSource(view.state);
  }

  function insertEmptyCodeSourceText(view: EditorView, from: number, to: number, text: string) {
    if (
      !text ||
      readonly() ||
      localSource?.kind !== 'block' ||
      localSource.original.type.name !== 'code_block'
    ) {
      return false;
    }
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
    if (!text || text === '\n' || readonly() || revealMarkdown() || from !== to) return false;
    const $from = view.state.doc.resolve(from);
    if (
      $from.parent.type.name !== 'code_block' ||
      $from.parent.textContent !== '\n' ||
      $from.parentOffset !== 0
    ) {
      return false;
    }
    view.dispatch(view.state.tr.insertText(text, from, from + 1));
    return true;
  }

  function wrapSelectedInlineSource(
    ctx: Ctx,
    view: EditorView,
    from: number,
    to: number,
    text: string,
  ) {
    if (readonly() || view.composing || from === to) return false;
    const state = view.state;
    const $from = state.doc.resolve(from);
    const $to = state.doc.resolve(to);
    const live = $from.parent.type.name === 'tano_live_source_inline';
    if (!$from.sameParent($to) || !$from.parent.inlineContent || ($from.parent.type.spec.code && !live)) {
      return false;
    }
    if (
      live &&
      ($from.parent.attrs.origin === 'math_inline' ||
        sourceStyleRanges($from.parent.textContent).some(
          (range) =>
            ['code', 'math'].includes(range.style) &&
            range.from < $to.parentOffset &&
            range.to > $from.parentOffset,
        ))
    ) {
      return false;
    }
    let protectedContent = false;
    state.doc.nodesBetween(from, to, (node) => {
      if (
        node.isInline &&
        ((!node.isText && node.type.name !== 'tano_live_source_inline') ||
          node.marks.some((mark) => mark.type.spec.code))
      ) {
        protectedContent = true;
      }
    });
    if (protectedContent) return false;
    const selected = state.doc.textBetween(from, to);
    const wrap = selectionWrap(
      selected,
      text,
      workspaceWrapping(preferences().selectionWrapping, policy().features),
      $from.parent.textContent.slice(0, $from.parentOffset),
      $to.parent.textContent.slice($to.parentOffset),
    );
    if (!wrap || (wrap.prefix === '$' && !policy().features.math)) return false;
    if (!wrap.prefix) return true;
    const backward = state.selection.anchor > state.selection.head;
    if (live) {
      const tr = state.tr.insertText(wrap.suffix, to).insertText(wrap.prefix, from);
      tr.setSelection(
        TextSelection.create(
          tr.doc,
          (backward ? to : from) + wrap.prefix.length,
          (backward ? from : to) + wrap.prefix.length,
        ),
      );
      view.dispatch(tr);
      return true;
    }
    const original = $from.parent.cut(from - $from.start(), to - $from.start()).content;
    if (!revealMarkdown()) {
      const markName = (
        {
          '*': 'strong',
          '**': 'strong',
          _: 'strong',
          __: 'strong',
          '~':
            wrap.prefix === '~' && preferences().selectionWrapping?.strike === false
              ? 'subscript'
              : 'strike_through',
          '~~': 'strike_through',
          '=': 'highlight',
          '==': 'highlight',
          '^': 'superscript',
          '+': 'underline',
          '%': 'inline_comment',
        } as Record<string, string>
      )[text];
      let alreadyWrapped = !!markName;
      original.forEach((node) => {
        alreadyWrapped &&= node.marks.some((mark) => mark.type.name === markName);
      });
      if (alreadyWrapped) return true;
    }
    const paragraph = state.schema.nodes.paragraph!.create(null, original);
    const selectedSource = wrap.literal
      ? selected
      : ctx.get(serializerCtx)(state.schema.nodes.doc!.create(null, [paragraph])).replace(/\n+$/, '');
    if (!selectedSource || /[\r\n]/.test(selectedSource)) return false;
    const source = wrap.prefix + selectedSource + wrap.suffix;
    if (!revealMarkdown()) {
      const parsed = ctx.get(parserCtx)(source)?.firstChild;
      if (!parsed || parsed.type.name !== 'paragraph') return false;
      const tr = state.tr.replaceWith(from, to, parsed.content);
      tr.setSelection(
        TextSelection.create(
          tr.doc,
          backward ? from + parsed.content.size : from,
          backward ? from : from + parsed.content.size,
        ),
      );
      view.dispatch(tr);
      return true;
    }
    const id = sourceId();
    const node = liveInlineSource
      .type(ctx)
      .create({ id, origin: wrap.prefix === '$' ? 'math_inline' : '' }, state.schema.text(source));
    const selectionFrom = from + 1 + wrap.prefix.length;
    const selectionTo = selectionFrom + selectedSource.length;
    localSource = { kind: 'inline', id, original, initial: selectedSource };
    const tr = state.tr.replaceWith(from, to, node);
    tr.setSelection(
      TextSelection.create(
        tr.doc,
        backward ? selectionTo : selectionFrom,
        backward ? selectionFrom : selectionTo,
      ),
    );
    view.dispatch(tr);
    return true;
  }

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
        if (identity && 'target' in resolveReference(referenceTargets(), identity)) {
          destination = { kind: 'reference', identity };
        }
      } else if (node.isText) {
        const link = node.marks.find((mark) => mark.type.name === 'link');
        const href = sanitizeLinkHref(String(link?.attrs.href ?? ''));
        if (href) destination = { kind: 'link', href };
      }
    });
    return destination;
  }

  function openInlineSourceLink(ctx: Ctx, view: EditorView, event: MouseEvent) {
    if (!isElement(event.target)) return false;
    const sourceDom = event.target.closest('[data-tano-live-inline-source]');
    if (!sourceDom || !view.dom.contains(sourceDom)) return false;
    const source = currentSource(view);
    if (source?.node.type.name !== 'tano_live_source_inline') return false;
    const destination = inlineSourceDestination(ctx, source.node.textContent);
    if (!destination) return false;
    if (destination.kind === 'wiki') onOpenWikiLink(destination.target);
    else if (destination.kind === 'reference') onOpenReference(destination.identity);
    else onOpenLink(destination.href);
    return true;
  }

  function inlineAtomSourceRange(view: EditorView, event: MouseEvent | KeyboardEvent) {
    if (!isElement(event.target)) return null;
    if (event.target.closest('button, input, textarea')) return null;
    const atom = event.target.closest(
      'a[data-tano-wiki-target], .math-inline, sup[data-type="footnote_reference"], .tano-html-node, .tano-image',
    );
    if (!atom || !view.dom.contains(atom)) return null;
    const pos = view.posAtDOM(atom, 0);
    for (const candidate of [pos, pos - 1]) {
      const node = view.state.doc.nodeAt(candidate);
      if (node && isEditableInlineAtom(node, view.state.doc.resolve(candidate).parent)) {
        return { from: candidate, to: candidate + node.nodeSize };
      }
    }
    const selection = view.state.selection;
    if (
      selection instanceof NodeSelection &&
      isEditableInlineAtom(selection.node, selection.$from.parent)
    ) {
      return { from: selection.from, to: selection.to };
    }
    return null;
  }

  function revealableInlineAtom(node: Node, parent: Node) {
    return (
      isEditableInlineAtom(node, parent) &&
      (node.type.name !== 'tano_reference' || referencesEnabled())
    );
  }

  function inlineSourceTransaction(
    ctx: Ctx,
    state: EditorState,
    range: { from: number; to: number },
    tr: Transaction = state.tr,
  ) {
    const $from = tr.doc.resolve(range.from);
    const original = $from.parent.cut(range.from - $from.start(), range.to - $from.start()).content;
    const codec = inlineSourceCodec(state.schema, ctx.get(parserCtx), ctx.get(serializerCtx));
    const source = codec.serialize(original);
    const before = tr.doc.textBetween(
      range.from,
      Math.max(range.from, Math.min(range.to, tr.selection.from)),
    );
    let offset = Math.min(
      source.length,
      sourceOffset(source, before, tr.doc.textBetween(range.from, range.to)[0] ?? ''),
    );
    // At a field boundary the caret belongs between complete Markdown tokens,
    // including closing delimiters and inline atoms that have no textContent.
    const relative = tr.selection.from - range.from;
    let atBoundary = relative === original.size;
    original.forEach((_node, position) => {
      if (position === relative) atBoundary = true;
    });
    if (atBoundary && relative >= 0 && relative <= original.size) {
      const prefix = original.cut(0, relative);
      const prefixSource = codec.serialize(prefix);
      if (source.startsWith(prefixSource)) offset = prefixSource.length;
    }
    const id = sourceId();
    const node = liveInlineSource
      .type(ctx)
      .create(
        { id, ...inlineSourceAttributes(original) },
        source ? state.schema.text(source) : undefined,
      );
    localSource = { kind: 'inline', id, original, initial: source };
    tr.replaceWith(range.from, range.to, node);
    tr.setSelection(TextSelection.create(tr.doc, range.from + 1 + offset));
    tr.setMeta('addToHistory', false);
    return tr;
  }

  // Text callers retain the transaction's mapped caret. Only non-text previews
  // pass a pointer to resolve against the newly editable source.
  function focusRevealedSource(view: EditorView, event?: MouseEvent | KeyboardEvent) {
    view.focus();
    if (!isMouseEvent(event) || (!event.clientX && !event.clientY)) return;
    const source = currentSource(view);
    if (!source) return;
    const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
    if (!hit) return;
    const pos = Math.max(source.pos + 1, Math.min(source.pos + source.node.nodeSize - 1, hit.pos));
    view.dispatch(
      view.state.tr
        .setSelection(TextSelection.create(view.state.doc, pos))
        .setMeta('addToHistory', false),
    );
  }

  function activateInlineSource(ctx: Ctx, view: EditorView, event?: MouseEvent | KeyboardEvent) {
    const disabledStyle = isElement(event?.target)
      ? event.target.closest<HTMLElement>('[data-tano-disabled-style]')
      : null;
    // Literal fallback delimiters live outside contentDOM and have no document
    // positions. Resolve their owning mark before revealing editable source.
    const content = disabledStyle?.children[1];
    const selection =
      content && view.dom.contains(content)
        ? TextSelection.create(view.state.doc, view.posAtDOM(content, 0))
        : view.state.selection;
    const atomRange = event ? inlineAtomSourceRange(view, event) : null;
    const range = atomRange ?? activeInlineSourceRange({ selection }, revealableInlineAtom);
    if (!range) return false;
    const tr = inlineSourceTransaction(
      ctx,
      view.state,
      range,
      content ? view.state.tr.setSelection(selection) : view.state.tr,
    );
    setApplying(true);
    try {
      view.dispatch(tr);
    } finally {
      setApplying(false);
    }
    // Existing text has a semantic caret position mapped by the transaction.
    // Only previews and decorative delimiters lack an editable text position.
    const clickedDelimiter = content && isElement(event?.target) && !content.contains(event.target);
    focusRevealedSource(view, atomRange || clickedDelimiter ? event : undefined);
    return true;
  }

  function activateLinkSource(ctx: Ctx, view: EditorView, link: Element) {
    const range = linkMarkRange(view, link);
    if (!range) return false;
    const selection = TextSelection.create(
      view.state.doc,
      Math.max(range.from, Math.min(range.to, view.state.selection.from)),
    );
    const tr = inlineSourceTransaction(
      ctx,
      view.state,
      range,
      view.state.tr.setSelection(selection),
    );
    setApplying(true);
    try {
      view.dispatch(tr);
    } finally {
      setApplying(false);
    }
    focusRevealedSource(view);
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
    const before = tr.doc.textBetween(
      selected.pos,
      Math.max(selected.pos, Math.min(selected.pos + selected.node.nodeSize, tr.selection.from)),
      '\n',
    );
    const offset =
      selected.node.type.name === 'code_block'
        ? Math.min(
            source.length,
            source.indexOf('\n') + 1 + Math.max(0, tr.selection.from - selected.pos - 1),
          )
        : Math.min(source.length, sourceOffset(source, before, selected.node.textContent[0] ?? ''));
    const id = sourceId();
    const bridgeView = getView();
    // A previous source block may already have been replaced in this transaction.
    // Read the target's DOM at its position in the still-rendered document.
    const renderedPos = tr.mapping.invert().map(selected.pos, -1);
    const rendered =
      bridgeView?.state.doc === state.doc && state.doc.nodeAt(renderedPos)?.eq(selected.node)
        ? bridgeView.nodeDOM(renderedPos)
        : null;
    // A Mermaid preview is a div with no vertical padding. Its padding must not
    // become the fence line height of the editable <pre> source block.
    const style =
      selected.node.type.name === 'code_block' && !(isHTMLElement(rendered) && rendered.matches('pre'))
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

  function selectedBlocksSourceTransaction(
    ctx: Ctx,
    state: EditorState,
    selection: BlockRangeSelection,
  ) {
    const groups: (typeof selection.blocks)[] = [];
    for (const block of selection.blocks) {
      const previous = groups.at(-1)?.at(-1);
      if (
        previous &&
        previous.parentPos === block.parentPos &&
        previous.pos + previous.node.nodeSize === block.pos
      ) {
        groups.at(-1)!.push(block);
      } else {
        groups.push([block]);
      }
    }
    const sources = groups.map((blocks) => {
      const original = Fragment.fromArray(blocks.map((block) => block.node));
      const initial = ctx
        .get(serializerCtx)(state.schema.topNodeType.create(null, original))
        .replace(/\n+$/, '');
      return { id: sourceId(), original, initial };
    });
    const tr = state.tr;
    for (let index = groups.length - 1; index >= 0; index--) {
      const blocks = groups[index]!;
      const source = sources[index]!;
      const last = blocks.at(-1)!;
      const node = liveSource
        .type(ctx)
        .create(
          { id: source.id, origin: 'blocks' },
          source.initial ? state.schema.text(source.initial) : undefined,
        );
      tr.replaceWith(blocks[0]!.pos, last.pos + last.node.nodeSize, node);
    }
    localSource = { kind: 'block-group', id: sources[0]!.id, sources };
    tr.setSelection(TextSelection.create(tr.doc, groups[0]![0]!.pos + 1));
    return tr.setMeta('addToHistory', false);
  }

  function caretBlockSourceTransaction(ctx: Ctx, state: EditorState, tr: Transaction = state.tr) {
    const $cursor = tr.selection.$from;
    for (let depth = $cursor.depth; depth > 0; depth--) {
      const node = $cursor.node(depth);
      if (
        (node.type.name === 'heading' && node.textContent) ||
        (node.type.name === 'code_block' && String(node.attrs.language).toLowerCase() !== 'mermaid')
      ) {
        return blockNodeSourceTransaction(ctx, state, { node, pos: $cursor.before(depth) }, tr);
      }
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
          if (container.canReplaceWith(index, index + 1, liveSource.type(ctx))) {
            return blockNodeSourceTransaction(
              ctx,
              view.state,
              { node: paragraph, pos: $pos.before() },
              view.state.tr,
            );
          }
          return inlineSourceTransaction(
            ctx,
            view.state,
            { from: candidate, to: candidate + node.nodeSize },
            view.state.tr.setSelection(NodeSelection.create(view.state.doc, candidate)),
          );
        }
        continue;
      }
      if (
        node?.type.name === expected &&
        (expected !== 'code_block' || String(node.attrs.language).toLowerCase() === 'mermaid')
      ) {
        return blockNodeSourceTransaction(ctx, view.state, { node, pos: candidate }, view.state.tr);
      }
    }
    return null;
  }

  function clickedCodeBlockSourceTransaction(ctx: Ctx, view: EditorView, target: Element) {
    const block = target.closest('pre');
    if (!block || !view.dom.contains(block) || block.hasAttribute('data-tano-live-source')) {
      return null;
    }
    const mapped = view.posAtDOM(block, 0);
    for (const pos of [mapped, mapped - 1]) {
      const node = view.state.doc.nodeAt(pos);
      if (node?.type.name !== 'code_block' || String(node.attrs.language).toLowerCase() === 'mermaid') {
        continue;
      }
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
    if (localSource?.kind === 'footnote-label' || readonly() || !revealMarkdown()) return false;
    const definition = view.state.doc.nodeAt(pos);
    if (definition?.type.name !== 'footnote_definition') return false;
    const createdParagraph = definition.firstChild?.type.name !== 'paragraph';
    const id = sourceId();
    const source = `[^${String(definition.attrs.label)}]: `;
    const label = liveInlineSource
      .type(ctx)
      .create({ id, origin: 'footnote_definition' }, view.state.schema.text(source));
    const tr = view.state.tr;
    const sourcePos = pos + 2;
    if (createdParagraph) {
      tr.insert(pos + 1, view.state.schema.nodes.paragraph!.create(null, label));
    } else {
      tr.insert(sourcePos, label);
    }
    tr.setSelection(TextSelection.create(tr.doc, sourcePos + 1 + (fromBody ? source.length : 2)));
    tr.setMeta('addToHistory', false);
    localSource = { kind: 'footnote-label', id, initial: source, createdParagraph };
    setApplying(true);
    try {
      view.dispatch(tr);
    } finally {
      setApplying(false);
    }
    view.focus();
    return true;
  }

  function activateFootnoteLabelSource(ctx: Ctx, view: EditorView, target: Element) {
    // The number is a ::before pseudo-element, so its click targets the dl.
    if (!target.matches('dl[data-type="footnote_definition"]') || !view.dom.contains(target)) {
      return false;
    }
    const mapped = view.posAtDOM(target, 0);
    return (
      activateFootnoteLabelAt(ctx, view, mapped, false) ||
      activateFootnoteLabelAt(ctx, view, mapped - 1, false)
    );
  }

  function enterFootnoteLabelFromCaret(ctx: Ctx, view: EditorView) {
    const selection = view.state.selection;
    if (
      !(selection instanceof TextSelection) ||
      !selection.empty ||
      selection.$from.parent.type.name !== 'paragraph' ||
      selection.$from.parentOffset !== 0 ||
      selection.$from.depth < 2
    ) {
      return false;
    }
    const definitionDepth = selection.$from.depth - 1;
    if (
      selection.$from.node(definitionDepth).type.name !== 'footnote_definition' ||
      selection.$from.index(definitionDepth) !== 0
    ) {
      return false;
    }
    return activateFootnoteLabelAt(ctx, view, selection.$from.before(definitionDepth), true);
  }

  function selectedSourceTransaction(ctx: Ctx, state: EditorState, tr: Transaction = state.tr) {
    const selection = tr.selection;
    if (selection instanceof NodeSelection) {
      const name = selection.node.type.name;
      if (
        !isEditableInlineAtom(selection.node, selection.$from.parent) ||
        (name === 'tano_reference' && !referencesEnabled())
      ) {
        return null;
      }
      return inlineSourceTransaction(ctx, state, { from: selection.from, to: selection.to }, tr);
    }
    if (!(selection instanceof TextSelection) || !selection.empty) return null;
    const inlineRange = activeInlineSourceRange(tr, revealableInlineAtom);
    return inlineRange
      ? inlineSourceTransaction(ctx, state, inlineRange, tr)
      : caretBlockSourceTransaction(ctx, state, tr);
  }

  function activateReferenceSource(view: EditorView, pos: number) {
    if (readonly() || !revealMarkdown() || !referencesEnabled() || view.composing) return;
    const node = view.state.doc.nodeAt(pos);
    if (node?.type.name !== 'tano_reference') return;
    view.focus();
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
  }

  function activateLocalSource(ctx: Ctx, view: EditorView, event: MouseEvent | KeyboardEvent) {
    const target = isElement(event.target) ? event.target : null;
    const previewBlock = target
      ?.closest('.math-preview, .tano-mermaid-preview, .tano-image-block')
      ?.closest('.math-block, .tano-mermaid, .tano-image-block');
    if (
      !revealMarkdown() ||
      readonly() ||
      view.composing ||
      ('button' in event && event.button !== 0) ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      target?.closest('button, input, textarea') ||
      (target?.closest('[contenteditable="false"]:not(.tano-wiki-link)') &&
        !previewBlock &&
        !target.closest('[data-tano-disabled-style]'))
    ) {
      return false;
    }
    if (target && previewBlock) {
      const tr = previewBlockSourceTransaction(ctx, view, target);
      if (tr) {
        setApplying(true);
        try {
          view.dispatch(tr);
        } finally {
          setApplying(false);
        }
        focusRevealedSource(view, event);
        return true;
      }
    }
    if (target) {
      const tr = clickedCodeBlockSourceTransaction(ctx, view, target);
      if (tr) {
        setApplying(true);
        try {
          view.dispatch(tr);
        } finally {
          setApplying(false);
        }
        focusRevealedSource(view);
        return true;
      }
    }
    const $cursor = view.state.selection.$from;
    for (let depth = $cursor.depth; depth > 0; depth--) {
      const node = $cursor.node(depth);
      if (node.type.name !== 'tano_live_source_inline') continue;
      const id = String(node.attrs.id);
      if (localSource?.id !== id) {
        localSource = {
          kind: 'inline',
          id,
          original: Fragment.from(node),
          initial: node.textContent,
        };
      }
      return false;
    }
    if (activateInlineSource(ctx, view, event)) return true;
    const tr = caretBlockSourceTransaction(ctx, view.state);
    if (!tr) return false;
    setApplying(true);
    try {
      view.dispatch(tr);
    } finally {
      setApplying(false);
    }
    focusRevealedSource(view);
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
    } else {
      tr.delete(source.pos, source.pos + source.node.nodeSize);
    }
    if (label?.trim()) {
      tr.setNodeMarkup(definitionPos, undefined, { ...definition.attrs, label });
    }
    return { tr, valid: !!label?.trim() };
  }

  function serializableDocument(state: EditorState) {
    if (localSource?.kind !== 'footnote-label') return state.doc;
    const source = findCurrentSource(state);
    return source
      ? footnoteLabelTransaction(state, source, localSource.createdParagraph)?.tr.doc ?? state.doc
      : state.doc;
  }

  function retainsInlineSource(doc: Node) {
    let retained = false;
    doc.descendants((node) => {
      if (node.type.name === 'tano_live_source_inline') retained = true;
      return !retained;
    });
    return retained;
  }

  function updateInlineSource(ctx: Ctx, state: EditorState) {
    if (localSource?.kind !== 'inline' || getView()?.composing || readonly()) return null;
    const current = findCurrentSource(state);
    if (!current) return null;
    const result = reconcileInlineSource(
      state,
      current,
      localSource,
      inlineSourceCodec(state.schema, ctx.get(parserCtx), ctx.get(serializerCtx)),
      revealableInlineAtom,
      revealMarkdown(),
    );
    if (result) localSource = result.session;
    return result;
  }

  function preserveSourceBlockSelection(state: EditorState, tr: Transaction) {
    if (!(state.selection instanceof BlockRangeSelection)) return;
    // Finishing live Markdown replaces its temporary nodes. Keep the restored
    // blocks selected instead of treating their source nodes as deletions.
    const ranges = state.selection.blocks.map((block) => ({
      from: tr.mapping.map(block.pos, -1),
      to: tr.mapping.map(block.pos + block.node.nodeSize, 1),
    }));
    const positions = blockTree(tr.doc)
      .filter((block) =>
        ranges.some(
          (range) => block.pos >= range.from && block.pos + block.node.nodeSize <= range.to,
        ),
      )
      .map((block) => block.pos);
    const selection = BlockRangeSelection.fromBlocks(
      tr.doc,
      positions,
      tr.mapping.map(state.selection.anchorBlock, -1),
      tr.mapping.map(state.selection.headBlock, -1),
    );
    if (selection) tr.setSelection(selection);
  }

  function finishLocalSourceTransaction(ctx: Ctx, state: EditorState) {
    if (!localSource) return;
    const current = findCurrentSource(state);
    const session = localSource;
    localSource = undefined;
    if (session.kind === 'block-group') {
      const sources = new Map(session.sources.map((source) => [source.id, source]));
      const replacements: { pos: number; node: Node; content: Fragment }[] = [];
      let unchanged = true;
      state.doc.descendants((node, pos) => {
        if (node.type.name !== 'tano_live_source') return;
        const source = sources.get(node.attrs.id);
        if (!source) return false;
        const raw = node.textContent;
        if (raw === source.initial) replacements.push({ pos, node, content: source.original });
        else {
          unchanged = false;
          const parsed = ctx.get(parserCtx)(raw);
          // Keep source text editable when conversion would change its spelling.
          if (
            parsed &&
            !retainsInlineSource(parsed) &&
            ctx.get(serializerCtx)(parsed).replace(/\n+$/, '') === raw.replace(/\n+$/, '')
          ) {
            replacements.push({
              pos,
              node,
              content: parsed.content.size
                ? parsed.content
                : Fragment.from(state.schema.nodes.paragraph!.create()),
            });
          }
        }
        return false;
      });
      if (!replacements.length) return;
      const tr = state.tr;
      for (const { pos, node, content } of replacements.reverse()) {
        tr.replaceWith(pos, pos + node.nodeSize, content);
      }
      preserveSourceBlockSelection(state, tr);
      if (unchanged) tr.setMeta('addToHistory', false);
      return { tr, unchanged };
    }
    if (!current) return;
    const raw = current.node.textContent;
    if (session.kind === 'footnote-label') {
      const result = footnoteLabelTransaction(state, current, session.createdParagraph);
      if (!result) return;
      if (!result.valid && raw !== session.initial) onError('脚注名称无效，已保留原名称');
      if (raw === session.initial) result.tr.setMeta('addToHistory', false);
      return { tr: result.tr, unchanged: raw === session.initial };
    }
    let replacement: Node[] | Fragment;
    if (raw === session.initial) {
      replacement = session.kind === 'block' ? [session.original] : session.original;
    } else {
      const parsed = ctx.get(parserCtx)(raw);
      if (!parsed) {
        onError('局部 Markdown 无法解析，原文已保留');
        return;
      }
      const normalized = ctx.get(serializerCtx)(parsed).replace(/\n+$/, '');
      if (normalized !== raw.replace(/\n+$/, '')) return;
      if (retainsInlineSource(parsed)) return;
      if (session.kind === 'inline') {
        if (parsed.childCount !== 1 || parsed.firstChild?.type.name !== 'paragraph') return;
        replacement = parsed.firstChild.content;
      } else {
        replacement = parsed.childCount
          ? [...Array(parsed.childCount)].map((_, index) => parsed.child(index))
          : [state.schema.nodes.paragraph!.create()];
      }
    }
    const tr = state.tr.replaceWith(
      current.pos,
      current.pos + current.node.nodeSize,
      replacement,
    );
    preserveSourceBlockSelection(state, tr);
    if (raw === session.initial) tr.setMeta('addToHistory', false);
    return { tr, unchanged: raw === session.initial };
  }

  function finishLocalSource(ctx: Ctx, view: EditorView) {
    const result = finishLocalSourceTransaction(ctx, view.state);
    if (!result) return;
    setApplying(result.unchanged);
    transitioningSource = true;
    try {
      view.dispatch(result.tr);
    } finally {
      setApplying(false);
      transitioningSource = false;
    }
  }

  function moveAcrossInlineSourceEdge(ctx: Ctx, view: EditorView, direction: -1 | 1) {
    const current = currentSource(view);
    const selection = view.state.selection;
    if (
      localSource?.kind !== 'inline' ||
      !current ||
      !(selection instanceof TextSelection) ||
      !selection.empty ||
      selection.$from.parent !== current.node
    ) {
      return false;
    }
    const offset = selection.$from.parentOffset;
    const size = current.node.content.size;
    const remaining = direction < 0 ? offset : size - offset;
    // Chromium can skip the first/last DOM caret stop of an inline content node.
    // Keep that stop explicit so leaving and re-opening the field cannot loop.
    if (remaining > 1) return false;
    if (remaining === 1) {
      view.dispatch(
        view.state.tr
          .setSelection(TextSelection.create(view.state.doc, selection.from + direction))
          .setMeta('addToHistory', false),
      );
      return true;
    }
    const end = current.pos + current.node.nodeSize;
    const finished = finishLocalSourceTransaction(ctx, view.state);
    const tr = finished?.tr ?? view.state.tr;
    let position = direction < 0 ? current.pos : tr.mapping.map(end, 1);
    const boundary = tr.doc.resolve(position);
    const adjacent = direction < 0 ? boundary.nodeBefore : boundary.nodeAfter;
    // The inside and outside of the source node are the same visible caret
    // stop. Consume the arrow's character movement as well as closing the field.
    if (adjacent?.isText) {
      const segments = [
        ...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(adjacent.text!),
      ];
      const step = direction < 0 ? segments.at(-1)!.segment.length : segments[0]!.segment.length;
      position += direction * step;
      tr.setSelection(TextSelection.create(tr.doc, position));
    } else {
      const next = Math.max(0, Math.min(tr.doc.content.size, position + direction));
      tr.setSelection(
        Selection.findFrom(tr.doc.resolve(next), direction, true) ??
          TextSelection.create(tr.doc, position),
      );
    }
    tr.setStoredMarks([]);
    const adjacentRange =
      finished && revealMarkdown() ? activeInlineSourceRange(tr, revealableInlineAtom) : null;
    if (adjacentRange) inlineSourceTransaction(ctx, view.state, adjacentRange, tr);
    tr.setMeta('tanoKeepNodeView', true);
    transitioningSource = true;
    setApplying(finished?.unchanged ?? false);
    try {
      view.dispatch(tr);
    } finally {
      transitioningSource = false;
      setApplying(false);
    }
    return true;
  }

  function enterHeadingSource(ctx: Ctx, view: EditorView) {
    const current = currentSource(view);
    const selection = view.state.selection;
    if (
      localSource?.kind !== 'block' ||
      current?.node.attrs.origin !== 'heading' ||
      !(selection instanceof TextSelection)
    ) {
      return false;
    }
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
    const tr = view.state.tr.replaceWith(current.pos, current.pos + current.node.nodeSize, [
      heading,
      paragraph,
    ]);
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

  function enterInlineSourceTextblock(ctx: Ctx, view: EditorView, cellBreak = false) {
    const current = currentSource(view);
    const selection = view.state.selection;
    if (
      localSource?.kind !== 'inline' ||
      current?.node.type.name !== 'tano_live_source_inline' ||
      !(selection instanceof TextSelection) ||
      selection.$from.parent.type.name !== 'tano_live_source_inline'
    ) {
      return false;
    }
    const blockDepth = selection.$from.depth - 1;
    if (
      blockDepth < 1 ||
      !['heading', 'paragraph'].includes(selection.$from.node(blockDepth).type.name)
    ) {
      return false;
    }
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

    // Inline source fields are code nodes, so the base Enter command would insert
    // a literal newline. Restore the formatted content and split its text block
    // in one transaction, including the list item when this is a list paragraph.
    const tr = view.state.tr.replaceWith(
      current.pos,
      current.pos + current.node.nodeSize,
      inline.content.cut(0, splitAt).append(inline.content.cut(splitAt + marker.length)),
    );
    const splitPos = current.pos + splitAt;
    if (cellBreak) {
      tr.insert(splitPos, view.state.schema.nodes.hardbreak!.create());
      tr.setSelection(TextSelection.create(tr.doc, splitPos + 1));
      tr.setStoredMarks([]);
      localSource = undefined;
      transitioningSource = true;
      try {
        view.dispatch(tr.scrollIntoView());
      } finally {
        transitioningSource = false;
      }
      return true;
    }
    const block = selection.$from.node(blockDepth);
    const splitDepth =
      block.type.name === 'paragraph' &&
      selection.$from.node(blockDepth - 1).type.name === 'list_item'
        ? 2
        : 1;
    const types =
      block.type.name === 'heading' ? [{ type: view.state.schema.nodes.paragraph! }] : undefined;
    if (!canSplit(tr.doc, splitPos, splitDepth, types)) return false;
    tr.split(splitPos, splitDepth, types);
    tr.setSelection(TextSelection.create(tr.doc, splitPos + splitDepth * 2));
    tr.scrollIntoView();
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
    ) {
      return false;
    }
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
    let restored: Transaction | null = null;
    state.doc.descendants((node, pos) => {
      if (restored) return false;
      if (
        (node.type.name === 'tano_live_source_inline' ||
          (node.type.name === 'tano_live_source' && node.attrs.origin === 'heading')) &&
        node.attrs.id !== localSource?.id
      ) {
        if (node.attrs.origin === 'footnote_definition') {
          restored = state.tr.delete(pos, pos + node.nodeSize).setMeta('addToHistory', false);
          return false;
        }
        const raw = node.textContent;
        const parsed = ctx.get(parserCtx)(raw);
        if (!parsed?.childCount || retainsInlineSource(parsed)) return false;
        // An inactive source field has the same lossless-conversion requirement
        // as the active field. Otherwise the next unrelated edit discards syntax.
        if (ctx.get(serializerCtx)(parsed).replace(/\n+$/, '') !== raw.replace(/\n+$/, '')) {
          return false;
        }
        const replacement =
          node.type.name === 'tano_live_source_inline'
            ? parsed.childCount === 1 && parsed.firstChild?.type.name === 'paragraph'
              ? parsed.firstChild.content
              : null
            : parsed.firstChild?.type.name === 'heading'
              ? Array.from({ length: parsed.childCount }, (_, index) => parsed.child(index))
              : null;
        if (replacement) {
          restored = state.tr
            .replaceWith(pos, pos + node.nodeSize, replacement)
            .setMeta('addToHistory', false);
        }
        return false;
      }
    });
    return restored;
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

  function insertPartialEmphasisSource(
    ctx: Ctx,
    view: EditorView,
    from: number,
    to: number,
    text: string,
  ) {
    if (
      text !== '*' ||
      readonly() ||
      !revealMarkdown() ||
      (localSource && findCurrentSource(view.state))
    ) {
      return false;
    }
    const { state } = view;
    const $from = state.doc.resolve(from);
    const $to = state.doc.resolve(to);
    if (!$from.sameParent($to) || $from.parent.type.spec.code) return false;
    const { node, offset } = $from.parent.childBefore($from.parentOffset);
    if (!node?.isText || node.marks.length || $to.parentOffset > offset + node.nodeSize) {
      return false;
    }
    const cursor = $from.parentOffset - offset;
    const after = $to.parentOffset - offset;
    const candidate = node.text!.slice(0, cursor) + text + node.text!.slice(after);
    const range = sourceStyleRanges(candidate).find(
      (item) =>
        item.style === 'emphasis' &&
        item.to === cursor + 1 &&
        item.from > 0 &&
        candidate[item.from - 1] === '*',
    );
    if (!range) return false;
    let start = range.from;
    while (start > 0 && candidate[start - 1] === '*') start--;
    // An explicitly escaped star is literal content, not part of the opener.
    if ((/\\+$/.exec(candidate.slice(0, start))?.[0].length ?? 0) % 2) return false;
    const position = $from.start() + offset + start;
    const source = candidate.slice(start, range.to);
    const id = sourceId();
    localSource = {
      kind: 'inline',
      id,
      original: $from.parent.cut(offset + start, $to.parentOffset).content,
      initial: node.text!.slice(start, after),
    };
    const tr = state.tr.replaceWith(
      position,
      to,
      liveInlineSource.type(ctx).create({ id }, state.schema.text(source)),
    );
    tr.setSelection(TextSelection.create(tr.doc, position + 1 + source.length));
    view.dispatch(tr);
    return true;
  }

  function appendSourceTransaction(
    ctx: Ctx,
    transactions: readonly Transaction[],
    state: EditorState,
  ) {
    if (transactions.some((transaction) => transaction.docChanged)) {
      const restoredSource = restoreOrphanSource(ctx, state);
      if (restoredSource) return restoredSource;
    }
    const bridgeView = getView();
    if (localSource) {
      const updated = updateInlineSource(ctx, state);
      if (updated) {
        sourceActivationPending ||=
          updated.presentationOnly && !transactions.some((transaction) => transaction.docChanged);
        return updated.tr;
      }
      const current = findCurrentSource(state);
      if (
        !current ||
        (state.selection.from >= current.pos + 1 &&
          state.selection.to <= current.pos + current.node.nodeSize - 1)
      ) {
        return null;
      }
      const finished = finishLocalSourceTransaction(ctx, state);
      if (!finished) return null;
      const next =
        bridgeView?.hasFocus() &&
        !selectingWithPointer &&
        !transactions.some((transaction) => transaction.getMeta('tanoBlockContextSelect')) &&
        !readonly() &&
        revealMarkdown()
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
      selectingWithPointer ||
      isApplying() ||
      isDisposed() ||
      readonly() ||
      !revealMarkdown() ||
      (!codeCaret && !transactions.some((transaction) => transaction.selectionSet)) ||
      (docChanged && !codeCaret) ||
      transactions.some((transaction) => transaction.getMeta('tanoKeepNodeView'))
    ) {
      return null;
    }
    // Replace the selected field before ProseMirror paints the new caret.
    // Its first visible Markdown characters must already be editable.
    const tr = selectedSourceTransaction(ctx, state);
    if (tr) sourceActivationPending = !docChanged;
    return tr;
  }

  function dismissBlockSourceOnPointer(event: PointerEvent) {
    const editor = getEditor();
    if (
      !editor ||
      isDisposed() ||
      !(
        localSource?.kind === 'block-group' ||
        (localSource?.kind === 'block' && localSource.dismissOnOutside)
      )
    ) {
      return;
    }
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      if (isElement(event.target)) {
        const source = event.target.closest('[data-tano-live-source]');
        if (source && view.dom.contains(source)) return;
      }
      finishLocalSource(ctx, view);
    });
  }

  return {
    getLocalSource: () => localSource,
    clearLocalSource: () => {
      localSource = undefined;
    },
    setLocalSourceDismissOnOutside: () => {
      if (localSource?.kind === 'block') localSource.dismissOnOutside = true;
    },
    setTransitioningSource: (value: boolean) => {
      transitioningSource = value;
    },
    consumeSourceActivationPending: () => {
      const pending = sourceActivationPending;
      sourceActivationPending = false;
      return pending;
    },
    setSelectingWithPointer: (value: boolean) => {
      selectingWithPointer = value;
    },
    endPointerSelection: () => {
      selectingWithPointer = false;
    },
    findCurrentSource,
    currentSource,
    insertEmptyCodeSourceText,
    fillEmptyRenderedCodeLine,
    wrapSelectedInlineSource,
    inlineSourceDestination,
    openInlineSourceLink,
    inlineAtomSourceRange,
    activateInlineSource,
    activateLinkSource,
    blockNodeSourceTransaction,
    selectedBlocksSourceTransaction,
    activateFootnoteLabelSource,
    enterFootnoteLabelFromCaret,
    selectedSourceTransaction,
    activateReferenceSource,
    activateLocalSource,
    serializableDocument,
    finishLocalSource,
    moveAcrossInlineSourceEdge,
    enterHeadingSource,
    enterInlineSourceTextblock,
    enterRenderedHeading,
    toggleSourceSyntax,
    insertPartialEmphasisSource,
    appendSourceTransaction,
    dismissBlockSourceOnPointer,
  };
}
