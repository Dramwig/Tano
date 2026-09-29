import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { remarkMathSyntax as remarkMath } from './math-markdown';
import type { Nodes } from 'mdast';
import { splitFrontmatter } from './syntax';

export type SourceStyle =
  | 'frontmatter'
  | 'heading'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'heading-4'
  | 'heading-5'
  | 'heading-6'
  | 'strong'
  | 'emphasis'
  | 'delete'
  | 'code'
  | 'link'
  | 'image'
  | 'quote-marker'
  | 'list-marker'
  | 'math'
  | 'html'
  | 'rule';

export interface SourceStyleRange {
  from: number;
  to: number;
  style: SourceStyle;
}

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

/** Style source bytes without normalizing or hiding any Markdown delimiters. */
export function sourceStyleRanges(markdown: string): SourceStyleRange[] {
  const { prefix, body } = splitFrontmatter(markdown);
  const base = prefix.length;
  const ranges: SourceStyleRange[] = [];
  if (base) ranges.push({ from: 0, to: base, style: 'frontmatter' });

  function add(from: number, to: number, style: SourceStyle) {
    if (to > from) ranges.push({ from, to, style });
  }

  function visit(node: Nodes) {
    const position = 'position' in node ? node.position : undefined;
    const start = position?.start.offset;
    const end = position?.end.offset;
    if (start !== undefined && end !== undefined) {
      const from = base + start;
      const to = base + end;
      switch (node.type) {
        case 'heading':
          add(from, to, 'heading');
          add(from, to, `heading-${node.depth}`);
          break;
        case 'strong':
          add(from, to, 'strong');
          break;
        case 'emphasis':
          add(from, to, 'emphasis');
          break;
        case 'delete':
          add(from, to, 'delete');
          break;
        case 'inlineCode':
        case 'code':
          add(from, to, 'code');
          break;
        case 'link':
        case 'linkReference':
        case 'definition':
          add(from, to, 'link');
          break;
        case 'image':
        case 'imageReference':
          add(from, to, 'image');
          break;
        case 'math':
        case 'inlineMath':
          add(from, to, 'math');
          break;
        case 'html':
          add(from, to, 'html');
          break;
        case 'thematicBreak':
          add(from, to, 'rule');
          break;
        case 'listItem': {
          const marker = /^(\s*)(?:[-+*]|\d+[.)])(?=\s)/.exec(body.slice(start, end));
          if (marker) add(from + marker[1]!.length, from + marker[0].length, 'list-marker');
          break;
        }
        case 'blockquote': {
          const source = body.slice(start, end);
          for (const match of source.matchAll(/(^|\n)([\t ]*)(>)/g)) {
            const marker = from + match.index + match[1]!.length + match[2]!.length;
            add(marker, marker + 1, 'quote-marker');
          }
          break;
        }
      }
    }
    if ('children' in node) node.children.forEach(visit);
  }

  visit(parser.parse(body));
  return ranges;
}
