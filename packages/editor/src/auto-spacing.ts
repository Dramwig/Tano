import type { Mark, Node } from '@milkdown/kit/prose/model';
import { Plugin } from '@milkdown/kit/prose/state';
import { Decoration } from '@milkdown/kit/prose/view';
import { createDocumentDecorations } from './document-decorations';
import { defaultCapabilities, featureEnabled } from './runtime';
import type { DocumentFeatures } from './runtime';

const han = /\p{Script=Han}/u;
const western = /[\p{Script=Latin}0-9]/u;
const combining = /\p{Mark}/u;
const inlineObjects = new Set(['math_inline', 'tano_wiki_link', 'tano_reference']);
type Kind = 'han' | 'western' | 'object' | 'other';

/** Display-only boundaries, including across bold/link marks. No text or widgets. */
function spacingInBlock(block: Node, pos: number, features: DocumentFeatures): Decoration[] {
  const result: Decoration[] = [];
  if (block.type.spec.code) return result;
  if (!block.isTextblock) {
    block.forEach((child, offset) => result.push(...spacingInBlock(child, pos + 1 + offset, features)));
    return result;
  }
  let previous: Kind = 'other';
  let previousSourceMarks: readonly Mark[] = [];
  function visit(kind: Kind, from: number, to: number, atom = false) {
    if ((previous === 'han' && (kind === 'western' || kind === 'object')) ||
        (kind === 'han' && (previous === 'western' || previous === 'object'))) {
      const attrs = { class: 'tano-auto-space-before' };
      result.push(atom ? Decoration.node(from, to, attrs) : Decoration.inline(from, to, attrs));
    }
    previous = kind;
  }
  block.forEach((child, offset) => {
    const from = pos + 1 + offset;
    const sourceMarks = child.marks.filter(mark => !featureEnabled(mark.type.name, features));
    // Disabled style views show literal delimiters outside the document text.
    // Opening or closing one interrupts adjacency, just like punctuation.
    if (!markSetsEqual(previousSourceMarks, sourceMarks)) previous = 'other';
    previousSourceMarks = sourceMarks;
    if (child.type.spec.code || child.marks.some(mark => mark.type.spec.code)) {
      previous = 'other';
    } else if (inlineObjects.has(child.type.name)) {
      visit('object', from, from + child.nodeSize, true);
    } else if (child.isText) {
      let index = from;
      for (const character of child.text!) {
        // Combining marks continue the previous letter; UTF-16 positions also
        // preserve supplementary Han characters and never split surrogate pairs.
        if (!combining.test(character)) {
          visit(han.test(character) ? 'han' : western.test(character) ? 'western' : 'other', index, index + character.length);
        }
        index += character.length;
      }
    } else {
      previous = 'other';
    }
  });
  return result;
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
