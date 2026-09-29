import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Nodes } from 'mdast';
import { remarkMathSyntax } from './math-markdown';
import { parseWikiLink } from './wiki-link-markdown';
import { splitFrontmatter } from './syntax';

export interface DocumentLink {
  kind: 'markdown' | 'wiki';
  target: string;
}

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMathSyntax);

/** Derive links from Markdown syntax, never from code, math, HTML or metadata. */
export function documentLinks(markdown: string): DocumentLink[] {
  const { body } = splitFrontmatter(markdown);
  const source = body.replace(/^\uFEFF?\+\+\+\r?\n[\s\S]*?\r?\n\+\+\+(?:\r?\n|$)/, '');
  const tree = parser.parse(source);
  const definitions = new Map<string, string>();
  const result: DocumentLink[] = [];
  function collect(node: Nodes) {
    if (node.type === 'definition' && !definitions.has(node.identifier))
      definitions.set(node.identifier, node.url);
    if ('children' in node) node.children.forEach(collect);
  }
  collect(tree);
  function visit(node: Nodes) {
    if (node.type === 'link' || node.type === 'image') {
      result.push({ kind: 'markdown', target: node.url });
    } else if (node.type === 'linkReference' || node.type === 'imageReference') {
      const target = definitions.get(node.identifier);
      if (target) result.push({ kind: 'markdown', target });
    } else if (node.type === 'text') {
      // Inspect source bytes to distinguish escaped brackets from real wiki links.
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined) return;
      const raw = source.slice(start, end);
      for (const match of raw.matchAll(/\[\[([^\[\]\r\n]+)\]\]/g)) {
        let slashes = 0;
        for (let i = match.index - 1; i >= 0 && raw[i] === '\\'; i--) slashes++;
        if (slashes % 2) continue;
        const link = parseWikiLink(match[1]);
        if (link) result.push({ kind: 'wiki', target: link.target });
      }
    } else if ('children' in node) node.children.forEach(visit);
  }
  visit(tree);
  return result;
}
