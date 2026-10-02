import { parseReferenceUrl } from '@tano/protocol';
import { textChanges } from '@tano/markdown';
import { documentLinkDetails, internalReferenceDefinitions } from '@tano/editor/document-links';

interface Projection { text: string; spans: { from: number; to: number; raw: string }[] }

function project(markdown: string): Projection {
  const replacements = [
    ...documentLinkDetails(markdown).filter(link => link.kind === 'markdown' && parseReferenceUrl(link.target))
      .map(link => ({ from: link.from, to: link.to, label: link.label || link.target })),
    ...internalReferenceDefinitions(markdown).map(span => ({ ...span, label: '' })),
  ].sort((a, b) => a.from - b.from);
  let text = '', position = 0;
  const spans: Projection['spans'] = [];
  for (const replacement of replacements) {
    text += markdown.slice(position, replacement.from);
    const from = text.length;
    text += replacement.label;
    spans.push({ from, to: text.length, raw: markdown.slice(replacement.from, replacement.to) });
    position = replacement.to;
  }
  return { text: text + markdown.slice(position), spans };
}

export const projectDescription = (markdown: string) => project(markdown).text;

/** Only unchanged reference spans can regain their local identity. A remote deletion or relabel is a conflict. */
export function restoreDescription(localBase: string, remoteText: string): string | null {
  const projection = project(localBase);
  if (projection.text === remoteText) return localBase;
  if (!projection.spans.length) return remoteText;
  const changes = textChanges(projection.text, remoteText);
  if (!changes) return null;
  const mapped: Projection['spans'] = [];
  for (const span of projection.spans) {
    const label = projection.text.slice(span.from, span.to);
    if (label && (projection.text.indexOf(label) !== projection.text.lastIndexOf(label) || remoteText.indexOf(label) !== remoteText.lastIndexOf(label))) return null;
    let shift = 0;
    for (const change of changes) {
      const insertion = change.from === change.to;
      const touches = span.from === span.to ? change.from <= span.from && change.to >= span.from
        : insertion ? change.from > span.from && change.from < span.to
        : Math.max(change.from, span.from) < Math.min(change.to, span.to);
      if (touches) return null;
      if (change.to <= span.from) shift += change.text.length - (change.to - change.from);
    }
    mapped.push({ ...span, from: span.from + shift, to: span.to + shift });
  }
  let result = remoteText;
  for (const span of mapped.sort((a, b) => b.from - a.from || b.to - a.to))
    result = result.slice(0, span.from) + span.raw + result.slice(span.to);
  const activeReferences = (text: string) => {
    const counts = new Map<string, number>();
    for (const link of documentLinkDetails(text)) {
      if (!parseReferenceUrl(link.target)) continue;
      const key = JSON.stringify([link.target, text.slice(link.from, link.to)]);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };
  const active = activeReferences(result);
  for (const [key, count] of activeReferences(localBase)) if ((active.get(key) ?? 0) < count) return null;
  if (result.length > 20000) return null;
  return result;
}
