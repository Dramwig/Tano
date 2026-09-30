import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import type { Node } from '@milkdown/kit/prose/model';
import type { EditorView } from '@milkdown/kit/prose/view';

const footnoteNumbersKey = new PluginKey<DecorationSet>('tano-footnote-numbers');
const footnoteLabelKey = (label: string) => label.trim().replace(/\s+/g, ' ').toLowerCase();

export function jumpToFootnote(view: EditorView, event: MouseEvent): boolean {
  if (event.button !== 0 || (!event.ctrlKey && !event.metaKey) ||
      !(event.target instanceof Element)) return false;
  const reference = event.target.closest('sup[data-type="footnote_reference"]');
  if (!reference || !view.dom.contains(reference)) return false;
  const label = footnoteLabelKey(reference.getAttribute('data-label') ?? '');
  let position: number | undefined;
  view.state.doc.descendants((node, pos) => {
    if (position !== undefined) return false;
    if (node.type.name === 'footnote_definition' &&
        footnoteLabelKey(String(node.attrs.label)) === label) {
      position = pos;
      return false;
    }
  });
  if (position === undefined) return false;
  const definition = view.nodeDOM(position);
  if (!(definition instanceof HTMLElement)) return false;
  definition.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return true;
}

function footnoteDecorations(doc: Node): DecorationSet {
  const definitions = new Set<string>();
  const numbers = new Map<string, number>();
  const nodes: { pos: number; label: string; reference: boolean; size: number; rendered: boolean }[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name === 'tano_live_source_inline' && node.attrs.footnoteLabel) {
      // The editable Markdown temporarily replaces its reference node. Keep its
      // original place in reading order until the source is committed.
      nodes.push({ pos, label: String(node.attrs.footnoteLabel), reference: true,
        size: node.nodeSize, rendered: false });
      return false;
    }
    const reference = node.type.name === 'footnote_reference';
    if (!reference && node.type.name !== 'footnote_definition') return;
    const label = String(node.attrs.label);
    nodes.push({ pos, label, reference, size: node.nodeSize, rendered: true });
    if (!reference) definitions.add(footnoteLabelKey(label));
  });

  // Reading order determines the visible number; Markdown labels remain stable IDs.
  for (const { label, reference } of nodes) {
    const id = footnoteLabelKey(label);
    if (!reference || !definitions.has(id) || numbers.has(id)) continue;
    numbers.set(id, numbers.size + 1);
  }
  for (const { label, reference } of nodes) {
    const id = footnoteLabelKey(label);
    if (reference || numbers.has(id)) continue;
    numbers.set(id, numbers.size + 1);
  }

  return DecorationSet.create(
    doc,
    nodes.flatMap(({ pos, label, reference, size, rendered }) => {
      if (!rendered) return [];
      const number = numbers.get(footnoteLabelKey(label));
      if (!number) return [];
      return [
        Decoration.node(pos, pos + size, {
          'data-footnote-number': String(number),
          'aria-label': `脚注 ${number}`,
          ...(reference ? { title: `按住 Ctrl 或 Command 点击跳转到脚注 ${number}` } : {}),
        }),
      ];
    }),
  );
}

export function footnoteNumbers(): Plugin<DecorationSet> {
  return new Plugin({
    key: footnoteNumbersKey,
    state: {
      init: (_, state) => footnoteDecorations(state.doc),
      apply: (transaction, current) =>
        transaction.docChanged ? footnoteDecorations(transaction.doc) : current,
    },
    props: {
      decorations: (state) => footnoteNumbersKey.getState(state),
    },
  });
}
