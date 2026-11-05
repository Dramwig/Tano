import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { remarkMathSyntax as remarkMath } from './math-markdown';
import type { Definition, Nodes, Root } from 'mdast';
import { toMarkdown } from 'mdast-util-to-markdown';
import { splitFrontmatter } from './syntax';
import { remarkTextStyles } from './text-style-markdown';
import { defaultCapabilities, featureEnabled } from './runtime';
import type { DocumentFeatures } from './runtime';
export { sourceChanges } from './source-changes';

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
  | 'highlight'
  | 'superscript'
  | 'subscript'
  | 'underline'
  | 'inline_comment'
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

export interface SourceHighlightUpdate {
  from: number;
  to: number;
  ranges: SourceStyleRange[];
  full?: boolean;
}

const parser = unified().use(remarkParse).use(remarkGfm, { singleTilde: false }).use(remarkMath).use(remarkTextStyles);

/** Style source bytes without normalizing or hiding any Markdown delimiters. */
export function sourceStyleRanges(markdown: string, features = defaultCapabilities.features): SourceStyleRange[] {
  const { prefix, body } = splitFrontmatter(markdown);
  return [
    ...frontmatterRanges(prefix),
    ...nodeStyleRanges(parser.parse(body), body, prefix.length, features),
  ];
}

function frontmatterRanges(prefix: string): SourceStyleRange[] {
  return prefix ? [{ from: 0, to: prefix.length, style: 'frontmatter' }] : [];
}

function nodeStyleRanges(root: Nodes, body: string, base: number, features: DocumentFeatures): SourceStyleRange[] {
  const ranges: SourceStyleRange[] = [];

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
        case 'tanoTextStyle':
          if (node.style !== 'text_color' && node.style !== 'background_color' && featureEnabled(node.style, features)) add(from, to, node.style);
          break;
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

  visit(root);
  return ranges;
}

/** Coordinates refer to the document before this batch of edits. */
export interface SourceHighlightChange {
  from: number;
  to: number;
  insert: string;
}

interface HighlightBlock {
  from: number;
  to: number;
  type: Nodes['type'];
  hasDefinitions: boolean;
  ranges: SourceStyleRange[];
  textRegions: { from: number; to: number }[];
}

function plainTextRegions(node: Nodes, source: string, offset: number, result: { from: number; to: number }[] = []) {
  if (['link', 'linkReference', 'imageReference', 'definition'].includes(node.type)) return result;
  if (node.type === 'text' && node.position?.start.offset !== undefined && node.position.end.offset !== undefined) {
    const from = node.position.start.offset, to = node.position.end.offset;
    // Entity decoding, escapes, URLs and delimiter-adjacent edits need parsing.
    if (source.slice(from, to) === node.value && !/[\\`*_$~^+%=|#!\[\]<>:@/.&-]/.test(node.value))
      for (const match of node.value.matchAll(/[\p{L}\p{N} ]+/gu))
        result.push({ from: from + offset + match.index, to: from + offset + match.index + match[0].length });
  }
  if ('children' in node) for (const child of node.children) plainTextRegions(child, source, offset, result);
  return result;
}

function definitionsIn(node: Nodes, result: Definition[] = []): Definition[] {
  if (node.type === 'definition') result.push(node);
  if ('children' in node) for (const child of node.children) definitionsIn(child, result);
  return result;
}

function highlightBlocks(root: Root, source: string, offset: number, features: DocumentFeatures): HighlightBlock[] {
  return root.children.flatMap(node => {
    const position = 'position' in node ? node.position : undefined;
    if (position?.start.offset === undefined || position.end.offset === undefined) return [];
    return [{
      from: position.start.offset + offset,
      to: position.end.offset + offset,
      type: node.type,
      hasDefinitions: definitionsIn(node).length > 0,
      ranges: nodeStyleRanges(node, source, offset, features),
      textRegions: plainTextRegions(node, source, offset),
    }];
  });
}

function shiftBlock(block: HighlightBlock, delta: number): HighlightBlock {
  if (!delta) return block;
  return {
    ...block, from: block.from + delta, to: block.to + delta,
    ranges: block.ranges.map(range => ({ ...range, from: range.from + delta, to: range.to + delta })),
    textRegions: block.textRegions.map(range => ({ from: range.from + delta, to: range.to + delta })),
  };
}

function sameBlock(previous: HighlightBlock, next: HighlightBlock | undefined, delta = 0): boolean {
  return !!next && previous.type === next.type && previous.from + delta === next.from && previous.to + delta === next.to &&
    previous.ranges.length === next.ranges.length && previous.ranges.every((range, index) => {
      const other = next.ranges[index]!;
      return range.style === other.style && range.from + delta === other.from && range.to + delta === other.to;
    });
}

/** Find a single replacement when a worker skipped intermediate revisions. */
function changedRange(previous: string, next: string): { from: number; to: number } {
  let from = 0;
  const length = Math.min(previous.length, next.length);
  while (from < length && previous.charCodeAt(from) === next.charCodeAt(from)) from++;
  let to = previous.length;
  let nextTo = next.length;
  while (to > from && nextTo > from && previous.charCodeAt(to - 1) === next.charCodeAt(nextTo - 1)) { to--; nextTo--; }
  return { from, to };
}

function lineStart(text: string, position: number): number {
  return Math.max(text.lastIndexOf('\n', position - 1), text.lastIndexOf('\r', position - 1)) + 1;
}

/** Reuse stable top-level blocks and the existing Markdown dialect. Boundaries
 * are verified with neighboring blocks; edits that change them get a full parse. */
export class IncrementalSourceHighlighter {
  private text = '';
  private prefix = '';
  private blocks: HighlightBlock[] = [];
  private definitions = '';
  private featuresKey = '';
  private patch: SourceHighlightUpdate = { from: 0, to: 0, ranges: [] };
  /** Parsing work for the most recent update, including any fallback. */
  lastParsedCharacters = 0;

  update(text: string, features = defaultCapabilities.features, changes?: readonly SourceHighlightChange[]): SourceStyleRange[] {
    this.updatePatch(text, features, changes);
    return this.ranges();
  }

  updatePatch(text: string, features = defaultCapabilities.features, changes?: readonly SourceHighlightChange[], full = false): SourceHighlightUpdate {
    this.lastParsedCharacters = 0;
    this.patch = { from: 0, to: 0, ranges: [] };
    const featuresKey = JSON.stringify(features);
    if (featuresKey === this.featuresKey && text === this.text)
      return full ? { from: 0, to: text.length, ranges: this.ranges(), full: true } : this.patch;
    const changed = changes?.length
      ? { from: changes[0]!.from, to: changes[changes.length - 1]!.to }
      : changedRange(this.text, text);
    if (featuresKey !== this.featuresKey ||
        !(this.updatePlainText(text, changes) || this.updateBlocks(text, features, changed))) {
      const { prefix, body } = splitFrontmatter(text);
      const root = this.parse(body);
      this.prefix = prefix;
      this.blocks = highlightBlocks(root, body, prefix.length, features);
      const definitions = definitionsIn(root);
      this.definitions = definitions.length ? toMarkdown({ type: 'root', children: definitions }) + '\n' : '';
      this.patch = { from: 0, to: text.length, ranges: this.ranges(), full: true };
    }
    this.text = text;
    this.featuresKey = featuresKey;
    return full ? { from: 0, to: text.length, ranges: this.ranges(), full: true } : this.patch;
  }

  private updatePlainText(text: string, changes?: readonly SourceHighlightChange[]): boolean {
    if (!changes?.length) return false;
    if (text.length !== this.text.length + changes.reduce((sum, change) => sum + change.insert.length - change.to + change.from, 0)) return false;
    for (const change of changes) {
      const block = this.blocks[this.blockAt(change.from)];
      if (!block || !/^[\p{L}\p{N} ]*$/u.test(change.insert) ||
          !/[\p{L}\p{N}]/u.test(this.text.slice(change.from - 1, change.from)) ||
          !/[\p{L}\p{N}]/u.test(this.text.slice(change.to, change.to + 1)) ||
          !block.textRegions.some(range => change.from > range.from && change.to < range.to)) return false;
    }
    const map = (position: number) => {
      let delta = 0;
      for (const change of changes) {
        if (change.to > position) break;
        delta += change.insert.length - (change.to - change.from);
      }
      return position + delta;
    };
    this.blocks = this.blocks.map(block => ({
      ...block, from: map(block.from), to: map(block.to),
      ranges: block.ranges.map(range => ({ ...range, from: map(range.from), to: map(range.to) })),
      textRegions: block.textRegions.map(range => ({ from: map(range.from), to: map(range.to) })),
    }));
    return true;
  }

  private parse(text: string): Root {
    this.lastParsedCharacters += text.length;
    return parser.parse(text);
  }

  private ranges(): SourceStyleRange[] {
    return [...frontmatterRanges(this.prefix), ...this.blocks.flatMap(block => block.ranges)];
  }

  private blockAt(position: number): number {
    let low = 0;
    let high = this.blocks.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.blocks[middle]!.from <= position) low = middle + 1;
      else high = middle;
    }
    return Math.max(0, low - 1);
  }

  private updateBlocks(text: string, features: DocumentFeatures, changed: { from: number; to: number }): boolean {
    if (!this.blocks.length || changed.from < this.prefix.length || splitFrontmatter(text).prefix !== this.prefix) return false;
    const first = Math.max(0, this.blockAt(changed.from) - 1);
    const last = Math.min(this.blocks.length - 1, this.blockAt(changed.to) + 2);
    // Include indentation and separators. Starting inside an AST node's first
    // line would change indented code, lists and blockquote interpretation.
    const from = first === 0 ? this.prefix.length : lineStart(this.text, this.blocks[first]!.from);
    const to = last === this.blocks.length - 1 ? this.text.length : lineStart(this.text, this.blocks[last + 1]!.from);
    const delta = text.length - this.text.length;
    const source = this.definitions + text.slice(from, to + delta);
    const root = this.parse(source);
    // Definitions are global. Any definition in the edited window requires
    // rebuilding reference uses throughout the document, including deletions.
    const localNodes = root.children.filter(node => 'position' in node &&
      (node.position?.start.offset ?? -1) >= this.definitions.length);
    if (definitionsIn({ type: 'root', children: localNodes }).length ||
        this.blocks.slice(first, last + 1).some(block => block.hasDefinitions)) return false;
    const local = highlightBlocks({ type: 'root', children: localNodes }, source, from - this.definitions.length, features);
    if (first > 0 && !sameBlock(this.blocks[first]!, local[0])) return false;
    if (last < this.blocks.length - 1 && !sameBlock(this.blocks[last]!, local.at(-1), delta)) return false;
    this.blocks = [
      ...this.blocks.slice(0, first), ...local,
      ...this.blocks.slice(last + 1).map(block => shiftBlock(block, delta)),
    ];
    this.patch = { from, to: to + delta, ranges: local.flatMap(block => block.ranges) };
    return true;
  }
}
