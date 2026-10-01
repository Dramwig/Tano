import { expect, it } from 'vitest';
import { parserCtx } from '@milkdown/kit/core';
import { TextSelection } from '@milkdown/kit/prose/state';
import { createHeadlessMarkdown } from './headless';
import { commentSpansForSelection, projectCommentText, proseRangesForCommentSpans } from './comment-projection';

it('projects a selection across Markdown blocks and maps it back to editor positions', async () => {
  const codec = await createHeadlessMarkdown();
  try {
    const doc = codec.withContext(ctx => ctx.get(parserCtx)('第一段末尾\n\n第二段开头')!);
    const projection = projectCommentText(doc);
    expect(projection.text).toBe('第一段末尾\n第二段开头');
    const first = projection.segments[0]!;
    const second = projection.segments.at(-1)!;
    const selection = TextSelection.create(doc, first.proseTo - 2, second.proseFrom + 3);
    const spans = commentSpansForSelection(doc, selection);
    expect(spans.map(span => span.text)).toEqual(['末尾', '第二段']);
    expect(proseRangesForCommentSpans(doc, spans)).toEqual([
      { from: first.proseTo - 2, to: first.proseTo },
      { from: second.proseFrom, to: second.proseFrom + 3 },
    ]);
  } finally { await codec.destroy(); }
});
