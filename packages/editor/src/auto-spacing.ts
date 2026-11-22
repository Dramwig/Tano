import type { Ctx } from '@milkdown/kit/ctx';
import type { Mark, Node } from '@milkdown/kit/prose/model';
import { Plugin, TextSelection } from '@milkdown/kit/prose/state';
import type { Transaction } from '@milkdown/kit/prose/state';
import { Decoration } from '@milkdown/kit/prose/view';
import type { EditorView } from '@milkdown/kit/prose/view';
import { createDocumentDecorations } from './document-decorations';
import { completesMarkdownSpacing, defaultCapabilities, featureEnabled, markdownPolicy } from './runtime';
import type { DocumentFeatures } from './runtime';
import { needsTextSpace, spacingTouchesEdit, textSpacingSpans } from './text-spacing';
import type { SpacingSpan } from './text-spacing';

const inlineReferences = new Set(['tano_wiki_link', 'tano_reference']);
type ProseSpacingSpan = SpacingSpan & { reference?: boolean };

function visitSpacingBoundaries(block: Node, start: number, features: DocumentFeatures,
  visit: (left: SpacingSpan, right: SpacingSpan, marks: readonly Mark[]) => void, mode: 'display' | 'input') {
  let previous: ProseSpacingSpan | undefined;
  let previousSourceMarks: readonly Mark[] = [];
  let previousMarks: readonly Mark[] = [];
  block.forEach((child, offset) => {
    const from = start + offset;
    const sourceMarks = child.marks.filter(mark => !featureEnabled(mark.type.name, features));
    // Disabled style views show literal delimiters outside the document text.
    // Opening or closing one interrupts adjacency, just like punctuation.
    if (!markSetsEqual(previousSourceMarks, sourceMarks)) previous = undefined;
    previousSourceMarks = sourceMarks;
    const span = (right: ProseSpacingSpan) => {
      if (previous && (needsTextSpace(previous.kind, right.kind) ||
          (mode === 'display' && previous.reference && right.reference)))
        visit(previous, right, previousMarks.filter(mark => mark.isInSet(child.marks)));
      previous = right;
      previousMarks = child.marks;
    };
    const reference = inlineReferences.has(child.type.name);
    if (child.type.spec.code || child.marks.some(mark => mark.type.spec.code)) {
      previous = undefined;
    } else if (reference || child.type.name === 'math_inline') {
      span({ from, to: from + child.nodeSize, kind: 'object', reference });
    } else if (child.isText) {
      for (const part of textSpacingSpans(child.text!, from, mode === 'input')) span(part);
    } else {
      previous = undefined;
    }
  });
}

function spacingInBlock(block: Node, pos: number, features: DocumentFeatures): Decoration[] {
  const result: Decoration[] = [];
  if (block.type.spec.code) return result;
  if (block.isTextblock) {
    visitSpacingBoundaries(block, pos + 1, features, (_left, right) => {
      const attrs = { class: 'tano-auto-space-before' };
      result.push(right.kind === 'object' ? Decoration.node(right.from, right.to, attrs) : Decoration.inline(right.from, right.to, attrs));
    }, 'display');
  } else {
    block.forEach((child, offset) => result.push(...spacingInBlock(child, pos + 1 + offset, features)));
  }
  return result;
}

/** Positions are measured in the document after the input. */
export function completeProseSpacing(tr: Transaction, from: number, to: number, features: DocumentFeatures) {
  if (from < 0 || from >= to || to > tr.doc.content.size) return false;
  const begin = tr.doc.resolve(from);
  const parent = begin.parent;
  if (!begin.sameParent(tr.doc.resolve(to)) || !parent.isTextblock ||
      parent.type.spec.code || /^math|^tano_live_source/.test(parent.type.name)) return false;
  const edits: { at: number; marks: readonly Mark[] }[] = [];
  visitSpacingBoundaries(parent, begin.start(), features, (left, right, marks) => {
    if (spacingTouchesEdit(left, right, from, to)) edits.push({ at: right.from, marks });
  }, 'input');
  if (!edits.length) return false;
  const caret = tr.selection instanceof TextSelection && tr.selection.empty ? tr.selection.from : null;
  const storedMarks = tr.storedMarks ?? (caret !== null ? tr.doc.resolve(caret).marks() : null);
  const mapping = tr.mapping.maps.length;
  for (const { at, marks } of edits.reverse()) tr.insert(at, tr.doc.type.schema.text(' ', marks));
  // Keep the caret on the typing side of a trailing space so typing can continue.
  if (caret !== null) {
    tr.setSelection(TextSelection.create(tr.doc, tr.mapping.slice(mapping).map(caret, -1)));
    if (storedMarks) tr.setStoredMarks(storedMarks);
  }
  return true;
}

export function completeInlineObjectSpacing(ctx: Ctx, tr: Transaction, from: number) {
  if (completesMarkdownSpacing(ctx)) completeProseSpacing(tr, from, from + 1, markdownPolicy(ctx).features);
  return tr;
}

const textSpacingInput = 'tanoTextSpacing';
export function markTextSpacingInput(tr: Transaction, from: number, text: string) {
  return tr.setMeta(textSpacingInput, { from, to: from + text.length });
}

export function inputSpacing(enabled: () => boolean, features: () => DocumentFeatures,
  acceptsText: (view: EditorView) => boolean) {
  return new Plugin({
    props: {
      handleTextInput(view, from, _to, text, defaultInput) {
        if (!view.editable || !acceptsText(view) || !text || /[\r\n]/.test(text)) return false;
        view.dispatch(markTextSpacingInput(defaultInput(), from, text));
        return true;
      },
    },
    appendTransaction(transactions, _previous, state) {
      if (!enabled()) return null;
      const index = transactions.findIndex(tr => tr.getMeta(textSpacingInput));
      if (index === -1) return null;
      let { from, to } = transactions[index]!.getMeta(textSpacingInput) as { from: number; to: number };
      for (const transaction of transactions.slice(index + 1)) {
        from = transaction.mapping.map(from, 1);
        to = transaction.mapping.map(to, -1);
      }
      const spacing = state.tr;
      // Appending preserves the history adjacency of subsequent keystrokes.
      return completeProseSpacing(spacing, from, to, features()) ? spacing : null;
    },
  });
}

function markSetsEqual(a: readonly Mark[], b: readonly Mark[]) {
  return a.length === b.length && a.every((mark, index) => mark.eq(b[index]!));
}

export function autoSpacing(enabled: () => boolean, features: () => DocumentFeatures = () => defaultCapabilities.features) {
  const decorate = createDocumentDecorations();
  return new Plugin({
    props: {
      decorations(state) {
        // Update the cache even when disabled, so re-enabling cannot reuse stale ranges.
        const currentFeatures = features();
        return decorate(state, JSON.stringify([enabled(), currentFeatures]), (node, pos) => enabled() ? spacingInBlock(node, pos, currentFeatures) : []);
      },
    },
  });
}
