import type { Node } from '@milkdown/kit/prose/model';

export const calloutMarker = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?=\s|$)/i;

/** The Markdown marker is container metadata, never a movable body block. */
export function blockContentStart(node: Node): number {
  const first = node.firstChild;
  return node.type.name === 'blockquote' && first?.type.name === 'paragraph' &&
    first.childCount === 1 && first.firstChild?.isText &&
    /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/i.test(first.textContent) ? 1 : 0;
}
