import type { AssistantSource } from '@tano/protocol';

/** Saved offsets disambiguate repeated text; relocated quotes must be unique. */
export function assistantSourceRange(content: string, selection: AssistantSource['selection']) {
  if (!selection?.text) return null;
  const { from, to, text } = selection;
  if (from !== undefined && to !== undefined && content.slice(from, to) === text)
    return { from, to };
  const start = content.indexOf(text);
  if (start < 0 || content.indexOf(text, start + 1) >= 0) return null;
  return { from: start, to: start + text.length };
}
