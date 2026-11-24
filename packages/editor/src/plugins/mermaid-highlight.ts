export type MermaidHighlightKind =
  'fence' | 'keyword' | 'direction' | 'node' | 'arrow' | 'label' | 'comment';

export interface MermaidHighlightRange {
  from: number;
  to: number;
  kind: MermaidHighlightKind;
}

/** Color Mermaid while it is being typed, including incomplete fenced blocks. */
export function mermaidHighlightRanges(source: string, fenced = false): MermaidHighlightRange[] {
  const ranges: MermaidHighlightRange[] = [];
  const occupied = new Uint8Array(source.length);
  let from = 0;
  let to = source.length;
  const add = (start: number, end: number, kind: MermaidHighlightKind) => {
    if (end <= start || occupied.subarray(start, end).some(Boolean)) return;
    occupied.fill(1, start, end);
    ranges.push({ from: start, to: end, kind });
  };

  if (fenced) {
    const open = /^(?:`{3,}|~{3,})[ \t]*mermaid[^\r\n]*(?:\r?\n|$)/i.exec(source);
    if (!open) return ranges;
    const fence = /^(?:`{3,}|~{3,})/.exec(open[0])![0];
    add(0, fence.length, 'fence');
    const language = /mermaid/i.exec(open[0]);
    if (language) add(language.index, language.index + language[0].length, 'keyword');
    from = open[0].length;
    const close = new RegExp(`(?:^|\\n)[ \\t]*${fence[0]}{${fence.length},}[ \\t]*$`).exec(source);
    if (close && close.index + close[0].length === source.length) {
      to = close.index + (close[0].startsWith('\n') ? 1 : 0);
      add(to, source.length, 'fence');
    }
  }

  const body = source.slice(from, to);
  let lineStart = 0;
  for (const line of body.split('\n')) {
    const offset = from + lineStart;
    const comment = /%%/.exec(line);
    const visible = comment ? line.slice(0, comment.index) : line;
    if (comment) add(offset + comment.index, offset + line.length, 'comment');

    for (const match of visible.matchAll(
      /\[[^\]\r\n]*\]|\([^()\r\n]*\)|\{[^{}\r\n]*\}|\|[^|\r\n]*\|/g,
    )) {
      const start = offset + match.index;
      add(start, start + 1, 'fence');
      add(start + 1, start + match[0].length - 1, 'label');
      add(start + match[0].length - 1, start + match[0].length, 'fence');
    }
    for (const match of visible.matchAll(/(?:<)?(?:--+|==+|-\.+-|~~+)(?:>|o|x)?/g))
      add(offset + match.index, offset + match.index + match[0].length, 'arrow');
    const keyword =
      /^\s*(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|pie|journey|gitGraph|mindmap|timeline|subgraph|end|direction|participant|actor|note|alt|else|loop|opt|rect)\b/i.exec(
        visible,
      );
    if (keyword) {
      const start = offset + keyword[0].length - keyword[1]!.length;
      add(start, start + keyword[1]!.length, 'keyword');
    }
    for (const match of visible.matchAll(/\b(?:TB|TD|BT|RL|LR)\b/g))
      add(offset + match.index, offset + match.index + match[0].length, 'direction');
    for (const match of visible.matchAll(/[\p{L}_][\p{L}\p{N}_-]*/gu))
      add(offset + match.index, offset + match.index + match[0].length, 'node');
    lineStart += line.length + 1;
  }
  return ranges.sort((a, b) => a.from - b.from);
}
