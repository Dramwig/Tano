import type { Plugin } from 'unified';
import type { Parent, Root, RootContent } from 'mdast';
import type { Handle } from 'mdast-util-to-markdown';
import { defaultHandlers } from 'mdast-util-to-markdown';

export type EnhancedKind = 'toggle' | 'tabs' | 'columns' | 'panel' | 'file' | 'embed';
export interface EnhancedNode extends Parent {
  type: 'tanoEnhanced';
  kind: EnhancedKind;
  title: string;
  url: string;
  children: RootContent[];
}
declare module 'mdast' {
  interface RootContentMap {
    tanoEnhanced: EnhancedNode;
  }
}

export function safeResourceUrl(value: string): boolean {
  if (!value.trim() || /[\u0000-\u0020<>"\\]/.test(value)) return false;
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      return !!url.hostname && !url.username && !url.password;
    } catch {
      return false;
    }
  }
  return !/^(?:\/|[a-z][\w+.-]*:)/i.test(value);
}

interface Region {
  start: number;
  end: number;
  kind: EnhancedKind | 'callout';
  title: string;
  body: string;
}
const decode = (text: string) =>
  text.replace(
    /&(amp|lt|gt|quot|#39);/g,
    (_, entity: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[entity]!,
  );
const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Only standalone, balanced fences are structural. Fenced code is never scanned as syntax. */
export function enhancedRegions(source: string): Region[] {
  const lines = [...source.matchAll(/[^\n]*(?:\n|$)/g)].filter((line) => line[0]);
  const regions: Region[] = [];
  let code = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]![0].trimEnd();
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (!code) code = fence;
      else if (fence[0] === code[0] && fence.length >= code.length) code = '';
      continue;
    }
    if (code) continue;
    const panel = /^(:{3,})panel ("(?:[^"\\]|\\.)*")\s*$/.exec(line);
    const container =
      /^(:{3,})(tabs|columns|file|embed|callout)(?:\s+type=(note|tip|important|warning|caution))?\s*$/.exec(
        line,
      ) ?? (panel ? [panel[0], panel[1], 'panel'] : null);
    const details = /^<details>\s*$/.test(line);
    if (!container && !details) continue;
    if (container?.[3] && container[2] !== 'callout') continue;
    let title = '';
    if (panel) {
      try {
        title = JSON.parse(panel[2]!);
      } catch {
        continue;
      }
      if (/[\r\n]/.test(title)) continue;
    }
    let bodyLine = i + 1;
    if (details) {
      const summary = /^<summary>([^<>]*)<\/summary>\s*$/.exec(
        lines[bodyLine]?.[0].trimEnd() ?? '',
      );
      if (!summary) continue;
      title = decode(summary[1]!);
      bodyLine++;
    }
    let nesting = 1;
    const containers = [container?.[1]?.length ?? 0];
    let innerCode = '';
    let end = -1;
    for (let j = bodyLine; j < lines.length; j++) {
      const candidate = lines[j]![0].trimEnd();
      const nestedFence = /^ {0,3}(`{3,}|~{3,})/.exec(candidate)?.[1];
      if (nestedFence) {
        if (!innerCode) innerCode = nestedFence;
        else if (nestedFence[0] === innerCode[0] && nestedFence.length >= innerCode.length)
          innerCode = '';
        continue;
      }
      if (innerCode) continue;
      if (details) {
        if (candidate === '<details>') nesting++;
        if (candidate === '</details>' && --nesting === 0) {
          end = j;
          break;
        }
      } else {
        const opening = /^(:{3,})[a-zA-Z]/.exec(candidate);
        const closing = /^(:{3,})\s*$/.exec(candidate);
        if (opening) containers.push(opening[1]!.length);
        if (closing && closing[1]!.length === containers.at(-1)) {
          containers.pop();
          if (!containers.length) {
            end = j;
            break;
          }
        }
      }
    }
    if (end < 0) continue;
    const body = source.slice(lines[bodyLine]?.index ?? 0, lines[end]!.index).trim();
    const kind = details ? 'toggle' : (container![2] as Region['kind']);
    if ((kind === 'tabs' || kind === 'columns') && !splitPanels(body)) continue;
    regions.push({
      start: lines[i]!.index!,
      end: lines[end]!.index! + lines[end]![0].length,
      kind,
      title: kind === 'callout' ? (container?.[3] ?? 'note').toUpperCase() : title,
      body,
    });
    i = end;
  }
  return regions;
}

export function splitPanels(body: string): { title: string; body: string }[] | null {
  // H2 section headings remain readable in ordinary Markdown viewers.
  const nested = enhancedRegions(body);
  if (nested.length && nested.every((region) => region.kind === 'panel')) {
    let cursor = 0;
    let complete = true;
    for (const region of nested) {
      if (body.slice(cursor, region.start).trim()) complete = false;
      cursor = region.end;
    }
    if (complete && !body.slice(cursor).trim())
      return nested.map(({ title, body }) => ({ title, body }));
  }
  const headings = [...body.matchAll(/^## ([^\r\n]+)\r?$/gm)].filter(
    (match) => !nested.some((region) => region.start <= match.index! && match.index! < region.end),
  );
  // Exclude headings in code fences as well.
  let code = '';
  const protectedLines = new Set<number>();
  for (const line of body.matchAll(/[^\n]*(?:\n|$)/g)) {
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line[0])?.[1];
    if (fence) {
      if (!code) code = fence;
      else if (fence[0] === code[0] && fence.length >= code.length) code = '';
    } else if (code) protectedLines.add(line.index!);
  }
  const sections = headings.filter((heading) => !protectedLines.has(heading.index!));
  if (!sections.length || body.slice(0, sections[0]!.index).trim()) return null;
  return sections.map((heading, index) => ({
    title: heading[1]!,
    body: body
      .slice(heading.index! + heading[0].length, sections[index + 1]?.index ?? body.length)
      .trim(),
  }));
}

/** Strip only recognized wrappers for the compatibility guard; keep all enclosed content visible. */
export function enhancedBody(source: string): string {
  let result = '',
    cursor = 0;
  for (const region of enhancedRegions(source)) {
    result += source.slice(cursor, region.start) + '\n' + enhancedBody(region.body) + '\n';
    cursor = region.end;
  }
  return result + source.slice(cursor);
}

const serialize: Handle = (node, _parent, state, info) => {
  const block = node as EnhancedNode;
  const body = state.containerFlow(block, info);
  if (block.kind === 'toggle')
    return `<details>\n<summary>${escape(block.title)}</summary>\n\n${body}\n\n</details>`;
  // A longer outer fence keeps nested containers unambiguous to other container parsers.
  const fence = ':'.repeat(
    Math.max(3, ...[...body.matchAll(/^(:{3,})/gm)].map((m) => m[1]!.length + 1)),
  );
  return `${fence}${block.kind}${block.kind === 'panel' ? ` ${JSON.stringify(block.title.replace(/[\r\n]/g, ' '))}` : ''}\n\n${body}\n\n${fence}`;
};

export const remarkEnhanced: Plugin<[], Root> = function () {
  const processor = this;
  let inheritedDefinitions = '';
  const data = this.data();
  (data.toMarkdownExtensions ?? (data.toMarkdownExtensions = [])).push({
    handlers: {
      tanoEnhanced: serialize,
      blockquote: (node, parent, state, info) =>
        defaultHandlers
          .blockquote(node, parent, state, info)
          .replace(/^> \\\[(!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION))\]/i, '> [$1]'),
    },
  });
  return (tree, file) => {
    const source = String(file.value);
    const regions = enhancedRegions(source);
    if (!regions.length) return;
    // Reference definitions have document scope, including references inside containers.
    // Supply them while parsing fragments, then remove the synthetic definitions.
    const localDefinitions = (processor.parse(source) as Root).children
      .filter((node) => node.type === 'definition' || node.type === 'footnoteDefinition')
      .map((node) => source.slice(node.position?.start.offset, node.position?.end.offset))
      .join('\n\n');
    const definitions = localDefinitions || inheritedDefinitions;
    const parse = (text: string): RootContent[] => {
      if (!text.trim()) return [{ type: 'paragraph', children: [] }];
      const input = definitions ? `${text}\n\n${definitions}` : text;
      const previous = inheritedDefinitions;
      let parsed: Root;
      inheritedDefinitions = definitions;
      try {
        parsed = processor.runSync(processor.parse(input), text) as Root;
      } finally {
        inheritedDefinitions = previous;
      }
      return parsed.children
        .filter(
          (node) =>
            !('position' in node) ||
            !node.position ||
            (node.position.start.offset ?? 0) < text.length,
        )
        .map((node) => {
          // Positions from fragment parsing do not refer to the outer source. The
          // raw-source fallback must never slice the outer file with these offsets.
          if (!('position' in node)) return node;
          const { position: _position, ...content } = node;
          return content as RootContent;
        });
    };
    const children: RootContent[] = [];
    let cursor = 0;
    for (const region of regions) {
      if (source.slice(cursor, region.start).trim())
        children.push(...parse(source.slice(cursor, region.start)));
      if (region.kind === 'panel')
        children.push({
          type: 'tanoRawBlock',
          value: source.slice(region.start, region.end).trimEnd(),
        });
      else if (region.kind === 'callout')
        children.push(
          ...parse(
            `> [!${region.title}]\n>\n${region.body
              .split('\n')
              .map((line) => `> ${line}`)
              .join('\n')}`,
          ),
        );
      else {
        const contents =
          region.kind === 'tabs' || region.kind === 'columns'
            ? splitPanels(region.body)!.map((panel): EnhancedNode => ({
                type: 'tanoEnhanced',
                kind: 'panel',
                title: panel.title,
                url: '',
                children: parse(panel.body),
              }))
            : parse(region.body);
        if (region.kind === 'file' || region.kind === 'embed') {
          const paragraph = contents[0];
          const link =
            paragraph?.type === 'paragraph' && paragraph.children.length === 1
              ? paragraph.children[0]
              : null;
          if (
            contents.length !== 1 ||
            link?.type !== 'link' ||
            !safeResourceUrl(link.url) ||
            link.children.some((n) => n.type !== 'text')
          ) {
            children.push({
              type: 'tanoRawBlock',
              value: source.slice(region.start, region.end).trimEnd(),
            });
          } else
            children.push({
              type: 'tanoEnhanced',
              kind: region.kind,
              title: link.children.map((n) => ('value' in n ? n.value : '')).join(''),
              url: link.url,
              children: [],
            });
        } else
          children.push({
            type: 'tanoEnhanced',
            kind: region.kind,
            title: region.title,
            url: '',
            children: contents,
          });
      }
      cursor = region.end;
    }
    if (source.slice(cursor).trim()) children.push(...parse(source.slice(cursor)));
    tree.children = children;
  };
};
