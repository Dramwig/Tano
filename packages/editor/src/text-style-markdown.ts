import { unified } from 'unified';
import { styleDelimiters, styleDelimiterConstruct } from './style-delimiters';
import type { Plugin } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { remarkMathSyntax as remarkMath } from './math-markdown';
import type { Html, Nodes, Parent, PhrasingContent, Root } from 'mdast';
import type { Handle } from 'mdast-util-to-markdown';

export type TextStyle = 'underline' | 'superscript' | 'subscript' | 'highlight' | 'text_color' | 'background_color' | 'inline_comment';
interface TextStyleNode extends Parent {
  type: 'tanoTextStyle';
  style: TextStyle;
  color?: string;
  delimiter?: string;
  children: PhrasingContent[];
}
declare module 'mdast' {
  interface RootContentMap {
    tanoTextStyle: TextStyleNode;
  }
  interface PhrasingContentMap {
    tanoTextStyle: TextStyleNode;
  }
}

const tags: Record<TextStyle, string> = {
  underline: 'u',
  superscript: 'sup',
  subscript: 'sub',
  highlight: 'mark',
  text_color: 'span',
  background_color: 'span',
  inline_comment: 'span',
};

export function normalizeTextColor(value: string): string | null {
  if (!/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value)) return null;
  const hex = value.toLowerCase();
  return hex.length === 4 ? `#${[...hex.slice(1)].map((char) => char + char).join('')}` : hex;
}

function styleTag(value: string) {
  const simple = /^<(\/?)(u|sup|sub|mark)\s*>$/i.exec(value);
  if (simple) {
    const tag = simple[2].toLowerCase();
    const style = (Object.keys(tags) as TextStyle[]).find((key) => tags[key] === tag)!;
    return { tag, style, closing: !!simple[1], color: undefined };
  }
  if (/^<\/span\s*>$/i.test(value))
    return { tag: 'span', style: 'text_color' as const, closing: true, color: undefined };
  const color =
    /^<span\s+style\s*=\s*(["'])\s*(color|background-color)\s*:\s*(#[\da-f]{3}(?:[\da-f]{3})?)\s*;?\s*\1\s*>$/i.exec(
      value,
    );
  return color
    ? {
        tag: 'span',
        style: color[2].toLowerCase() === 'color' ? 'text_color' as const : 'background_color' as const,
        closing: false,
        color: normalizeTextColor(color[3])!,
      }
    : null;
}

/** Interpret only balanced inline style tags, never arbitrary HTML or CSS. */
function transformStyles(node: Nodes) {
  if (!('children' in node)) return;
  for (const child of node.children) transformStyles(child);
  if (
    !['paragraph', 'heading', 'strong', 'emphasis', 'delete', 'link', 'tableCell'].includes(
      node.type,
    )
  )
    return;

  const result: PhrasingContent[] = [];
  const stack: { open: Html; tag: string; node: TextStyleNode }[] = [];
  const append = (child: PhrasingContent) => (stack.at(-1)?.node.children ?? result).push(child);
  for (const child of node.children as PhrasingContent[]) {
    const tag = child.type === 'html' ? styleTag(child.value) : null;
    if (!tag) {
      append(child);
    } else if (!tag.closing) {
      stack.push({
        open: child as Html,
        tag: tag.tag,
        node: { type: 'tanoTextStyle', style: tag.style, color: tag.color, children: [] },
      });
    } else if (stack.at(-1)?.tag === tag.tag) {
      append(stack.pop()!.node);
    } else {
      append(child);
    }
  }
  // An incomplete/misnested tag remains literal HTML for the red fallback view.
  while (stack.length) {
    const frame = stack.pop()!;
    append(frame.open);
    for (const child of frame.node.children) append(child);
  }
  node.children = result;
}

/** Keep an inline HTML element as one atom so its tags render together and round trip. */
function groupRawHtml(node: Nodes, source: string) {
  if (!('children' in node)) return;
  for (const child of node.children) groupRawHtml(child, source);
  if (
    !['paragraph', 'heading', 'strong', 'emphasis', 'delete', 'link', 'tableCell'].includes(
      node.type,
    )
  )
    return;
  const children = node.children as PhrasingContent[];
  const result: PhrasingContent[] = [];
  for (let index = 0; index < children.length; index++) {
    const child = children[index];
    const open = child.type === 'html' && /^<([a-z][\w:-]*)(?=[\s>])[^>]*>$/i.exec(child.value);
    if (!open || /\/\s*>$/.test(child.value) || !('position' in child) || !child.position) {
      result.push(child);
      continue;
    }
    let depth = 1;
    let closing = -1;
    for (let cursor = index + 1; cursor < children.length; cursor++) {
      const candidate = children[cursor];
      if (candidate.type !== 'html') continue;
      if (new RegExp(`^<${open[1]}(?=[\\s>])[^>]*>$`, 'i').test(candidate.value)) depth++;
      if (new RegExp(`^<\\/${open[1]}\\s*>$`, 'i').test(candidate.value)) depth--;
      if (depth === 0) {
        closing = cursor;
        break;
      }
    }
    const last = closing < 0 ? undefined : children[closing];
    if (!last || !('position' in last) || !last.position) {
      result.push(child);
      continue;
    }
    const end = last.position.end;
    result.push({
      type: 'html',
      value: source.slice(child.position.start.offset, end.offset),
      position: { start: child.position.start, end },
    });
    index = closing;
  }
  node.children = result;
}

const serializeStyle: Handle & { peek?: () => string } = (node, _parent, state, info) => {
  const style = node as TextStyleNode;
  const tag = tags[style.style];
  const delimiter = style.delimiter;
  if (style.style === 'inline_comment') return `%%${style.children.map(child => 'value' in child ? child.value : '').join('')}%%`;
  if (delimiter && styleDelimiters[delimiter as keyof typeof styleDelimiters] === style.style) {
    const tracker = state.createTracker(info);
    tracker.move(delimiter);
    return delimiter + state.containerPhrasing(style, {
      ...tracker.current(), before: delimiter, after: delimiter,
    }) + delimiter;
  }
  const color = style.color && normalizeTextColor(style.color);
  const open =
    (style.style === 'text_color' || style.style === 'background_color') && color
      ? `<span style="${style.style === 'text_color' ? 'color' : 'background-color'}: ${color}">` : `<${tag}>`;
  const close = `</${tag}>`;
  const tracker = state.createTracker(info);
  tracker.move(open);
  return (
    open + state.containerPhrasing(style, { ...tracker.current(), before: '>', after: '<' }) + close
  );
};
serializeStyle.peek = () => '<';

export const remarkTextStyles: Plugin<[], Root> = function () {
  const data = this.data();
  (data.micromarkExtensions ??= []).push({ text: Object.fromEntries(
    Object.keys(styleDelimiters).map(delimiter => [delimiter.charCodeAt(0), styleDelimiterConstruct(delimiter)]),
  ) });
  (data.fromMarkdownExtensions ??= []).push({
    enter: {
      tanoStyleDelimited(token) {
        this.enter({ type: 'tanoTextStyle', style: 'highlight', children: [] }, token);
      },
    },
    exit: {
      tanoStyleDelimited(token) {
        const node = this.stack.at(-1) as TextStyleNode;
        const raw = this.sliceSerialize(token);
        const delimiter = Object.keys(styleDelimiters).find(value => raw.startsWith(value))!;
        node.style = styleDelimiters[delimiter as keyof typeof styleDelimiters];
        node.delimiter = delimiter;
        const body = raw.slice(delimiter.length, -delimiter.length);
        const parsed = delimiter === '%%' ? null : inlineStyleParser.runSync(inlineStyleParser.parse(body), body).children[0];
        node.children = parsed?.type === 'paragraph' ? parsed.children : [{ type: 'text', value: body }];
        // Nested parsers report offsets relative to the body. Milkdown's marker
        // plugin reads the original file at these positions to preserve * vs _.
        const shift = (child: Nodes) => {
          if ('position' in child && child.position) {
            for (const point of [child.position.start, child.position.end]) {
              if (point.offset !== undefined) point.offset += token.start.offset + delimiter.length;
              if (point.line === 1) point.column += token.start.column - 1 + delimiter.length;
              point.line += token.start.line - 1;
            }
          }
          if ('children' in child) child.children.forEach(shift);
        };
        node.children.forEach(shift);
        this.exit(token);
      },
    },
  });
  const extensions = data.toMarkdownExtensions ?? (data.toMarkdownExtensions = []);
  extensions.push({ handlers: { tanoTextStyle: serializeStyle } });
  return (tree, file) => {
    transformStyles(tree);
    groupRawHtml(tree, String(file.value));
  };
};

const styleParser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const inlineStyleParser = unified().use(remarkParse).use(remarkGfm, { singleTilde: false }).use(remarkMath).use(remarkTextStyles);

/** Check which HTML cannot enter the current real-time collaboration codec. */
export function hasUnsupportedHtml(markdown: string): boolean {
  if (!markdown.includes('<')) return false;
  const tree = styleParser.parse(markdown);
  transformStyles(tree);
  function containsHtml(node: Nodes, parent?: Nodes): boolean {
    if (node.type === 'html') {
      // Milkdown serializes an empty paragraph as a standalone <br /> line.
      // It can parse that marker back into an empty paragraph, so it must not
      // count as unsupported collaboration syntax.
      return !(
        node.value === '<br />' &&
        parent &&
        ['root', 'blockquote', 'listItem'].includes(parent.type)
      );
    }
    // MDX attributes such as {...props} are plain text to CommonMark, but must
    // still count as unsupported. Inspect source bytes so escaped examples stay literal.
    if (node.type === 'text' && node.position) {
      const source = markdown.slice(node.position.start.offset, node.position.end.offset);
      if (/(?<!\\)<\/?[A-Za-z][\w-]*(?:\s[^>]*|\s*\/?)>|<!--/.test(source)) return true;
    }
    return 'children' in node && node.children.some((child) => containsHtml(child, node));
  }
  return containsHtml(tree);
}
