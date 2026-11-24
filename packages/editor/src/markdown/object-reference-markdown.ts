import type { Nodes, Root } from 'mdast';
import type { Plugin } from 'unified';
import { parseReferenceUrl, mentionIdFromTitle } from '@tano/protocol';

/** Convert identity-only references to links before the shared reference pipeline. */
export function transformObjectReferences(tree: Nodes, source: string) {
  if (!('children' in tree) || tree.type === 'link' || tree.type === 'linkReference') return;
  tree.children = tree.children.flatMap((node): Nodes[] => {
    if (node.type !== 'text') { transformObjectReferences(node, source); return [node]; }
    const start = node.position?.start.offset, end = node.position?.end.offset;
    if (start === undefined || end === undefined || source.slice(start, end) !== node.value) return [node];
    const result: Nodes[] = [];
    const point = (index: number) => {
      const before = node.value.slice(0, index).split('\n');
      return { offset: start + index, line: node.position!.start.line + before.length - 1,
        column: before.length === 1 ? node.position!.start.column + index : before.at(-1)!.length + 1 };
    };
    const text = (from: number, to: number): Nodes => ({ type: 'text', value: node.value.slice(from, to),
      position: { start: point(from), end: point(to) } });
    let cursor = 0;
    for (const match of node.value.matchAll(/(!?)\[\[(object:\/\/[^\[\]\r\n]+)\]\]/g)) {
      const index = match.index;
      let slashes = 0;
      for (let at = start + index - 1; at >= 0 && source[at] === '\\'; at--) slashes++;
      if (slashes % 2 || !parseReferenceUrl(match[2]!)) continue;
      // Embeds are cards only when they occupy a whole paragraph.
      if (match[1] && (tree.type !== 'paragraph' || tree.children.length !== 1 || node.value !== match[0])) continue;
      if (index > cursor) result.push(text(cursor, index));
      const position = { start: point(index), end: point(index + match[0].length) };
      result.push({ type: 'link', url: match[2]!, title: match[1] ? 'tano:object-card' : null, children: [{ type: 'text', value: '' }], position });
      cursor = index + match[0].length;
    }
    if (!cursor) return [node];
    if (cursor < node.value.length) result.push(text(cursor, node.value.length));
    return result;
  }) as typeof tree.children;
  // An occurrence ID is metadata for Agent delivery, never an object name/alias.
  tree.children = tree.children.filter((node, index, children) => {
    const previous = children[index - 1];
    if (node.type !== 'html' || previous?.type !== 'link' || parseReferenceUrl(previous.url)?.type !== 'person' || previous.title) return true;
    const match = /^<!--(tano:mention:[a-z0-9-]{8,80})-->$/i.exec(node.value);
    if (!match || !mentionIdFromTitle(match[1]) || previous.position?.end.offset !== node.position?.start.offset) return true;
    previous.title = match[1];
    previous.position!.end = node.position!.end;
    return false;
  }) as typeof tree.children;
}

export const remarkObjectReferences: Plugin<[], Root> = () => (tree, file) => transformObjectReferences(tree, String(file.value));
