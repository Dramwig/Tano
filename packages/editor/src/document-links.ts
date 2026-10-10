import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Nodes } from 'mdast';
import { remarkMathSyntax } from './math-markdown';
import { parseWikiLink } from './wiki-link-markdown';
import { splitFrontmatter } from './syntax';
import { parseReferenceUrl } from '@tano/protocol';

export interface DocumentLink {
  kind: 'markdown' | 'wiki';
  target: string;
}
export interface DocumentLinkDetail extends DocumentLink {
  label: string;
  from: number;
  to: number;
  excerpt: string;
}

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMathSyntax);

/** A syntax snapshot that consumers can share without parsing the same revision again. */
export function parseDocumentMarkdown(markdown: string) {
  const { body } = splitFrontmatter(markdown);
  const source = body.replace(/^\uFEFF?\+\+\+\r?\n[\s\S]*?\r?\n\+\+\+(?:\r?\n|$)/, '');
  return { source, tree: parser.parse(source), offset: markdown.length - source.length };
}

/** Source-mode references must be inserted outside code, math, metadata and existing links. */
export function referenceInsertionPoint(markdown: string, position: number) {
  const { body } = splitFrontmatter(markdown);
  const source = body.replace(/^\uFEFF?\+\+\+\r?\n[\s\S]*?\r?\n\+\+\+(?:\r?\n|$)/, '');
  const offset = markdown.length - source.length;
  if (position < offset) return { at: offset, prefix: '\n\n', suffix: '\n\n' };
  let result = { at: position, prefix: ' ', suffix: '' };
  function visit(node: Nodes) {
    if ('position' in node && node.position?.start.offset !== undefined && node.position.end.offset !== undefined &&
      position >= node.position.start.offset + offset && position <= node.position.end.offset + offset) {
      if (['code', 'math', 'html', 'definition'].includes(node.type)) {
        result = { at: node.position.end.offset + offset, prefix: '\n\n', suffix: '\n\n' }; return;
      }
      if (['inlineCode', 'inlineMath', 'link', 'linkReference', 'image', 'imageReference'].includes(node.type)) {
        result = { at: node.position.end.offset + offset, prefix: ' ', suffix: '' }; return;
      }
      if ('children' in node) node.children.forEach(visit);
    }
  }
  visit(parser.parse(source));
  return result;
}

export function internalReferenceDefinitions(markdown: string): { from: number; to: number }[] {
  const { body } = splitFrontmatter(markdown);
  const source = body.replace(/^\uFEFF?\+\+\+\r?\n[\s\S]*?\r?\n\+\+\+(?:\r?\n|$)/, '');
  const offset = markdown.length - source.length;
  const result: { from: number; to: number }[] = [];
  function visit(node: Nodes) {
    if (node.type === 'definition' && parseReferenceUrl(node.url) && node.position?.start.offset !== undefined && node.position.end.offset !== undefined)
      result.push({ from: node.position.start.offset + offset, to: node.position.end.offset + offset });
    if ('children' in node) node.children.forEach(visit);
  }
  visit(parser.parse(source));
  return result;
}

/** Derive links from Markdown syntax, never from code, math, HTML or metadata. */
export function documentLinks(markdown: string): DocumentLink[] {
  return documentLinkDetails(markdown).map(({ kind, target }) => ({ kind, target }));
}

export function documentLinkDetails(markdown: string, parsed = parseDocumentMarkdown(markdown)): DocumentLinkDetail[] {
  const { source, tree, offset } = parsed;
  const definitions = new Map<string, string>();
  const result: DocumentLinkDetail[] = [];
  const label = (node: Nodes): string => 'value' in node && typeof node.value === 'string'
    ? node.value : 'children' in node ? node.children.map(label).join('') : '';
  function add(node: Nodes, kind: DocumentLink['kind'], target: string, name: string,
    start = 'position' in node ? node.position?.start.offset : undefined,
    end = 'position' in node ? node.position?.end.offset : undefined) {
    if (start === undefined || end === undefined) return;
    const lineStart = source.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = source.indexOf('\n', end);
    result.push({ kind, target, label: name, from: start + offset, to: end + offset,
      excerpt: source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd).replace(/\s+/g, ' ').slice(0, 180) });
  }
  function collect(node: Nodes) {
    if (node.type === 'definition' && !definitions.has(node.identifier))
      definitions.set(node.identifier, node.url);
    if ('children' in node) node.children.forEach(collect);
  }
  collect(tree);
  function visit(node: Nodes) {
    if (node.type === 'link' || node.type === 'image') {
      add(node, 'markdown', node.url, label(node) || ('alt' in node ? node.alt ?? '' : ''));
    } else if (node.type === 'linkReference' || node.type === 'imageReference') {
      const target = definitions.get(node.identifier);
      if (target) add(node, 'markdown', target, label(node) || ('alt' in node ? node.alt ?? '' : ''));
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
        if (link) add(node, 'wiki', link.target, match[1], start + match.index, start + match.index + match[0].length);
      }
    } else if ('children' in node) node.children.forEach(visit);
  }
  visit(tree);
  const groups = new Map<string, { from: number; to: number; links: DocumentLinkDetail[] }>();
  for (const link of result) {
    const from = markdown.lastIndexOf('\n', link.from - 1) + 1;
    const newline = markdown.indexOf('\n', link.to);
    const to = newline < 0 ? markdown.length : newline;
    const key = `${from}:${to}`;
    const group = groups.get(key) ?? { from, to, links: [] };
    group.links.push(link); groups.set(key, group);
  }
  for (const { from, to, links } of groups.values()) {
    let end = Math.min(to, from + 240);
    const visible = links.filter(link => link.from < end);
    for (const link of visible) end = Math.max(end, link.to);
    let excerpt = markdown.slice(from, end);
    for (const link of visible.sort((a, b) => b.from - a.from))
      excerpt = excerpt.slice(0, link.from - from) + link.label + excerpt.slice(link.to - from);
    for (const link of links) link.excerpt = excerpt.replace(/\s+/g, ' ').slice(0, 180);
  }
  return result;
}
