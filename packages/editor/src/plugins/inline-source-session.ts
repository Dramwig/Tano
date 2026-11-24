import { Fragment } from '@milkdown/kit/prose/model';
import type { Node, Schema } from '@milkdown/kit/prose/model';
import { TextSelection } from '@milkdown/kit/prose/state';
import type { EditorState } from '@milkdown/kit/prose/state';
import { activeInlineSourceRange, touchingInlineRange } from './inline-source-range';

export interface InlineSourceSession {
  kind: 'inline';
  id: string;
  original: Fragment;
  initial: string;
}

interface SourcePart {
  from: number;
  to: number;
  formatted: boolean;
}

/** One codec owns lossless source/rendered conversion, including edge spaces. */
export function inlineSourceCodec(schema: Schema, parseDocument: (source: string) => Node | null | undefined,
  serializeDocument: (doc: Node) => string) {
  const text = (value: string) => value ? Fragment.from(schema.text(value)) : Fragment.empty;
  function serialize(content: Fragment): string {
    if (!content.size) return '';
    const first = content.firstChild!, last = content.lastChild!;
    const leading = first.isText && !first.marks.length ? /^[ \t]*/.exec(first.text!)![0] : '';
    const trailing = last.isText && !last.marks.length ? /[ \t]*$/.exec(last.text!)![0] : '';
    if (leading.length + trailing.length >= content.size) return content.textBetween(0, content.size);
    const body = content.cut(leading.length, content.size - trailing.length);
    return leading + serializeDocument(schema.nodes.doc!.create(null,
      schema.nodes.paragraph!.create(null, body))).replace(/\n+$/, '') + trailing;
  }
  function parse(source: string): Fragment | null {
    const [, leading, body, trailing] = /^([ \t]*)(.*?)([ \t]*)$/s.exec(source)!;
    if (!body) return text(source);
    const doc = parseDocument(body);
    if (doc?.childCount !== 1 || doc.firstChild?.type.name !== 'paragraph') return null;
    let unresolved = false;
    doc.descendants(node => { if (node.type.name === 'tano_live_source_inline') unresolved = true; });
    if (unresolved || serialize(doc.firstChild.content) !== body) return null;
    return text(leading!).append(doc.firstChild.content).append(text(trailing!));
  }
  function parts(source: string): SourcePart[] | null {
    const content = parse(source);
    if (!content) return null;
    const boundaries = [{ source: 0, document: 0 }];
    content.forEach((_node, offset) => {
      if (!offset) return;
      const prefix = serialize(content.cut(0, offset));
      const suffix = serialize(content.cut(offset));
      // A split is a field boundary only if both sides serialize independently.
      // This keeps enclosing marks, HTML elements and partial syntax intact.
      if (prefix + suffix === source) boundaries.push({ source: prefix.length, document: offset });
    });
    boundaries.push({ source: source.length, document: content.size });
    return boundaries.slice(1).map((end, index) => {
      const start = boundaries[index]!;
      const fragment = content.cut(start.document, end.document);
      let formatted = false;
      fragment.forEach(node => { if (!node.isText || node.marks.length) formatted = true; });
      return { from: start.source, to: end.source, formatted };
    });
  }
  return { serialize, parse, parts };
}

export type InlineSourceCodec = ReturnType<typeof inlineSourceCodec>;

export function inlineSourceAttributes(content: Fragment) {
  const only = content.childCount === 1 ? content.firstChild : null;
  return {
    origin: only?.type.name === 'math_inline' ? 'math_inline' : '',
    footnoteLabel: only?.type.name === 'footnote_reference' ? String(only.attrs.label) : '',
  };
}

interface SourceLayout {
  from: number;
  to: number;
  before: Fragment;
  after: Fragment;
  active: { source: string; content: Fragment; offset: number; session: InlineSourceSession } | null;
}

/** Compute the desired layout first, then apply exactly one document transition. */
export function reconcileInlineSource(state: EditorState, current: { node: Node; pos: number },
  session: InlineSourceSession, codec: InlineSourceCodec,
  adjacentAtom: (node: Node, parent: Node) => boolean, revealAdjacent: boolean) {
  const selection = state.selection;
  if (!(selection instanceof TextSelection) || !selection.empty || selection.$from.parent !== current.node) return null;
  const raw = current.node.textContent;
  const offset = selection.$from.parentOffset;
  const sourceEnd = current.pos + current.node.nodeSize;
  let layout: SourceLayout | null = null;
  const parts = codec.parts(raw);
  const fields = parts?.filter(part => part.formatted) ?? [];
  if (fields.length) {
    const active = touchingInlineRange(fields, offset);
    const from = active?.from ?? offset, to = active?.to ?? offset;
    // A single field can contain a delimiter run still being typed. Preserve
    // its editing surface until the caret leaves; sibling fields can separate.
    if ((!active || fields.length > 1) && (from !== 0 || to !== raw.length)) {
      const before = codec.parse(raw.slice(0, from));
      const content = codec.parse(raw.slice(from, to));
      const after = codec.parse(raw.slice(to));
      if (before && content && after && codec.serialize(before.append(content).append(after)) === raw) {
        const source = raw.slice(from, to);
        layout = { from: current.pos, to: sourceEnd, before, after,
          active: active ? { source, content, offset: offset - from,
            session: { ...session, initial: source, original: content } } : null };
      }
    }
  }
  if (!layout && revealAdjacent && (offset === 0 || offset === raw.length)) {
    const left = offset === 0;
    const boundary = left ? current.pos : sourceEnd;
    const range = activeInlineSourceRange({ selection: TextSelection.create(state.doc, boundary) }, adjacentAtom);
    if (range) {
      const $from = state.doc.resolve(range.from);
      const neighbor = $from.parent.cut(range.from - $from.start(), range.to - $from.start()).content;
      const source = codec.serialize(neighbor);
      const original = left ? neighbor.append(session.original) : session.original.append(neighbor);
      layout = { from: left ? range.from : current.pos, to: left ? sourceEnd : range.to,
        before: Fragment.empty, after: Fragment.empty,
        active: { source: left ? source + raw : raw + source, content: original,
          offset: offset + (left ? source.length : 0),
          session: { ...session, original, initial: left ? source + session.initial : session.initial + source } } };
    }
  }
  if (!layout) return null;
  const { active } = layout;
  let content = layout.before;
  if (active) content = content.append(Fragment.from(current.node.type.create(
    { ...current.node.attrs, ...inlineSourceAttributes(active.content) }, state.schema.text(active.source))));
  const tr = state.tr.replaceWith(layout.from, layout.to, content.append(layout.after));
  tr.setSelection(TextSelection.create(tr.doc,
    layout.from + layout.before.size + (active ? 1 + active.offset : 0)));
  // A presentation-only replacement can stay out of history. Once the source
  // has been edited, include its conversion so undo still reaches those edits.
  if (active && raw === session.initial) tr.setMeta('addToHistory', false);
  if (!active) tr.setStoredMarks([]);
  return { tr, session: active?.session, presentationOnly: !!active };
}
