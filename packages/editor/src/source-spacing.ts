import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Nodes } from 'mdast';
import { parseReferenceUrl } from '@tano/protocol';
import { remarkMathSyntax } from './math-markdown';
import { remarkWikiLinks } from './wiki-link-markdown';
import { splitFrontmatter } from './syntax';
import { defaultCapabilities, recognizesMath } from './runtime';
import type { WorkspaceCapabilities } from './runtime';
import { needsTextSpace, spacingTouchesEdit, textSpacingSpans } from './text-spacing';
import type { SpacingSpan } from './text-spacing';

const parser = unified().use(remarkParse).use(remarkGfm, { singleTilde: false }).use(remarkMathSyntax).use(remarkWikiLinks);
const inlineBlocks = new Set(['heading', 'paragraph', 'tableCell']);
const inlineStyles = new Set(['strong', 'emphasis', 'delete']);

/** Cheap check before parsing. The edited line also covers a just-closed token. */
export function mayCompleteSourceSpacing(line: string, from: number, to: number) {
  const vicinity = line.slice(Math.max(0, from - 2), to + 2);
  return (/\p{Script=Han}/u.test(vicinity) && /[\p{Script=Latin}0-9$\[\]()*_~]/u.test(vicinity)) ||
    (/[$\])*_~]/.test(line.slice(from, to)) && /\p{Script=Han}/u.test(line));
}

/** Return insertion offsets in the edited source, without reserializing Markdown. */
export function sourceSpacingPositions(markdown: string, from: number, to: number,
  policy: WorkspaceCapabilities = defaultCapabilities): number[] {
  if (from >= to) return [];
  const { prefix, body } = splitFrontmatter(markdown);
  if (from < prefix.length || (!prefix && /^\uFEFF?---\r?\n/.test(markdown)) || /^\+\+\+\r?\n/.test(markdown)) return [];
  const edits: number[] = [];
  const tree = parser.runSync(parser.parse(body), body);

  function spans(node: Nodes): SpacingSpan[] {
    const position = 'position' in node ? node.position : undefined;
    const start = position?.start.offset;
    const end = position?.end.offset;
    if (start === undefined || end === undefined) return [];
    const from = prefix.length + start, to = prefix.length + end;
    if (node.type === 'text') {
      const raw = body.slice(start, end);
      // Escape sequences, entities and multiline container prefixes are left intact.
      if (raw === node.value) return [...textSpacingSpans(raw, from, true)];
    } else if ((node.type === 'inlineMath' && recognizesMath(policy, node.data?.tanoMath?.delimiter ?? 'dollar')) ||
      (node.type === 'tanoWikiLink' && policy.features.wikiLink) ||
      (node.type === 'link' && policy.features.objectReferences && parseReferenceUrl(node.url))) {
      return [{ from, to, kind: 'object' }];
    } else if (inlineStyles.has(node.type) && 'children' in node) {
      const parts = node.children.flatMap(spans);
      if (parts.length) {
        parts[0]!.from = from;
        parts.at(-1)!.to = to;
        return parts;
      }
    }
    return [{ from, to, kind: 'other' }];
  }

  function visit(node: Nodes) {
    const position = 'position' in node ? node.position : undefined;
    const start = position?.start.offset, end = position?.end.offset;
    if (start !== undefined && end !== undefined && (prefix.length + start >= to || prefix.length + end <= from)) return;
    if (!('children' in node)) return;
    if (!inlineBlocks.has(node.type)) {
      node.children.forEach(visit);
      return;
    }
    let previous: SpacingSpan | undefined;
    for (const child of node.children) {
      for (const part of spans(child)) {
        if (previous?.to === part.from && needsTextSpace(previous.kind, part.kind) &&
            spacingTouchesEdit(previous, part, from, to)) edits.push(part.from);
        previous = part;
      }
    }
  }
  visit(tree);
  return edits;
}
