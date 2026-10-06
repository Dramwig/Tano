import { Plugin } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import type { SuggestionDecorations } from '@tano/protocol';
import { projectCommentText, proseRangesForCommentSpans } from './comment-projection';
import { diffChars } from 'diff';

export function suggestionMarks(get: () => SuggestionDecorations | undefined) {
  return new Plugin({ props: { decorations(state) {
    const marks = get();
    if (!marks?.ranges.length) return DecorationSet.empty;
    const projection = projectCommentText(state.doc);
    // Markdown serialization trims trailing spaces while a live paragraph may
    // still contain them. Map whitespace-only differences without guessing text.
    const parts = projection.text === marks.text ? undefined : diffChars(marks.text, projection.text, { timeout: 20, maxEditLength: 1000 });
    if (projection.text !== marks.text && (!parts || parts.some(part => (part.added || part.removed) && /\S/.test(part.value)))) return DecorationSet.empty;
    const positionInView = (offset: number) => {
      let old = 0, next = 0;
      for (const part of parts ?? []) {
        if (part.added) { next += part.value.length; continue; }
        if (old + part.value.length >= offset) return next + (part.removed ? 0 : offset - old);
        old += part.value.length;
        if (!part.removed) next += part.value.length;
      }
      return parts ? next : offset;
    };
    const decorations: Decoration[] = [];
    for (const mark of marks.ranges) {
      const range = { ...mark, from: positionInView(mark.from), to: positionInView(mark.to) };
      if (range.to > range.from) {
        const spans = [{ from: range.from, to: range.to, text: marks.text.slice(range.from, range.to) }];
        for (const { from, to } of proseRangesForCommentSpans(state.doc, spans))
          decorations.push(Decoration.inline(from, to, { class: range.inserted === undefined ? 'tano-suggestion-insert' : 'tano-suggestion-delete is-source-text', 'data-suggestion-id': range.id }));
      }
      const widgetText = range.inserted ?? range.removed;
      if (widgetText) {
        const offset = range.inserted === undefined ? range.from : range.to;
        const segment = projection.segments.find(part => part.from <= offset && part.to >= offset)
          ?? projection.segments.find(part => part.from > offset);
        const position = segment ? segment.proseFrom + Math.max(0, offset - segment.from) : Math.max(0, state.doc.content.size - 1);
        decorations.push(Decoration.widget(position, () => {
          const element = document.createElement(range.inserted === undefined ? 'del' : 'ins');
          element.className = range.inserted === undefined ? 'tano-suggestion-delete' : 'tano-suggestion-insert';
          element.dataset.suggestionId = range.id;
          element.textContent = widgetText;
          element.contentEditable = 'false';
          element.title = range.inserted === undefined ? '建议删除 · 接受后才从正文移除' : '建议新增 · 接受后才写入正文';
          return element;
        }, { side: -1, key: `${range.id}:${range.inserted === undefined}:${widgetText}`, ignoreSelection: true }));
      }
    }
    return DecorationSet.create(state.doc, decorations);
  } } });
}
