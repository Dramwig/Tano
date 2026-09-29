import { unified } from 'unified';
import type { Plugin } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { remarkMathSyntax as remarkMath } from './math-markdown';
import type { Nodes, Root, Text } from 'mdast';
import type { Handle } from 'mdast-util-to-markdown';

export interface WikiLinkNode {
  type: 'tanoWikiLink';
  target: string;
  label: string;
  explicitLabel: boolean;
}

declare module 'mdast' {
  interface RootContentMap {
    tanoWikiLink: WikiLinkNode;
  }
  interface PhrasingContentMap {
    tanoWikiLink: WikiLinkNode;
  }
}

export function parseWikiLink(value: string): Omit<WikiLinkNode, 'type'> | null {
  const separator = value.indexOf('|');
  const target = separator < 0 ? value : value.slice(0, separator);
  const label = separator < 0 ? target : value.slice(separator + 1);
  if (
    !target.trim() ||
    !label.trim() ||
    /[\[\]\r\n|\u0000-\u001f]/.test(target) ||
    /[\[\]\r\n|\u0000-\u001f]/.test(label)
  )
    return null;
  return { target, label, explicitLabel: separator >= 0 };
}

const wikiPattern = /\[\[([^\[\]\r\n]+)\]\]/g;

function isEscaped(source: string, index: number) {
  let slashes = 0;
  for (let at = index - 1; at >= 0 && source[at] === '\\'; at--) slashes++;
  return slashes % 2 === 1;
}

/** Count only syntax that the editor must preserve, excluding fenced/code/math spans. */
export function wikiLinkCandidates(prose: string): number {
  let count = 0;
  for (const match of prose.matchAll(wikiPattern)) {
    const index = match.index;
    if (!isEscaped(prose, index)) count++;
  }
  return count;
}

function transformText(node: Text, source: string): Nodes[] {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  // Remark has already unescaped or decoded this text. Keep it in source mode
  // instead of guessing positions for a token in altered source bytes.
  if (start === undefined || end === undefined || source.slice(start, end) !== node.value)
    return [node];
  const result: Nodes[] = [];
  let cursor = 0;
  for (const match of node.value.matchAll(wikiPattern)) {
    const index = match.index;
    if (isEscaped(source, start + index) || source[start + index - 1] === '!') continue;
    const link = parseWikiLink(match[1]);
    if (!link) continue;
    if (index > cursor) result.push({ type: 'text', value: node.value.slice(cursor, index) });
    result.push({ type: 'tanoWikiLink', ...link });
    cursor = index + match[0].length;
  }
  if (!cursor) return [node];
  if (cursor < node.value.length) result.push({ type: 'text', value: node.value.slice(cursor) });
  return result;
}

function transform(node: Nodes, source: string) {
  if (!('children' in node) || node.type === 'link' || node.type === 'linkReference') return;
  node.children = node.children.flatMap((child) => {
    if (child.type === 'text') return transformText(child, source);
    transform(child, source);
    return [child];
  }) as typeof node.children;
}

const serializeWikiLink: Handle & { peek?: () => string } = (node) => {
  const link = node as WikiLinkNode;
  return `[[${link.target}${link.explicitLabel ? `|${link.label}` : ''}]]`;
};
serializeWikiLink.peek = () => '[';

export const remarkWikiLinks: Plugin<[], Root> = function () {
  const data = this.data();
  const extensions = data.toMarkdownExtensions ?? (data.toMarkdownExtensions = []);
  extensions.push({ handlers: { tanoWikiLink: serializeWikiLink } });
  return (tree, file) => transform(tree, String(file.value));
};

const detector = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkWikiLinks);

/** Used by the source-mode guard to catch tokens the rich editor could not parse. */
export function parsedWikiLinkCount(markdown: string): number {
  const tree = detector.runSync(detector.parse(markdown), markdown);
  let count = 0;
  function visit(node: Nodes) {
    if (node.type === 'tanoWikiLink') count++;
    else if ('children' in node) node.children.forEach(visit);
  }
  visit(tree);
  return count;
}
