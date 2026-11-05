import { parseDocumentMarkdown } from '@tano/editor/document-links';
import { mentionIdFromTitle, parseReferenceUrl } from '@tano/protocol';
import type { MentionEvent } from '@tano/protocol';
import type { Nodes } from 'mdast';

/** Parse syntax, so code examples, metadata and images cannot dispatch work. */
export function documentMentionEvents(workspaceId: string, fileId: string, content: string, revision: string,
  actorId: string, createdAt: number): MentionEvent[] {
  const { tree, offset } = parseDocumentMarkdown(content);
  const events: MentionEvent[] = [];
  const seen = new Set<string>();
  function visit(node: Nodes, block?: Nodes) {
    if (['paragraph', 'heading', 'tableCell'].includes(node.type)) block = node;
    if (node.type === 'link') {
      const reference = parseReferenceUrl(node.url);
      const mentionId = mentionIdFromTitle(node.title);
      if (reference?.type !== 'person' || !mentionId || !block || !('position' in block) || !block.position || seen.has(mentionId)) return;
      const from = (block.position.start.offset ?? 0) + offset;
      const to = (block.position.end.offset ?? 0) + offset;
      const body = content.slice(from, to);
      if (!body.trim() || body.length > 20000) return;
      seen.add(mentionId);
      events.push({ id: JSON.stringify(['document', fileId, mentionId]), workspaceId, personId: reference.id,
        actorId, body, revision, createdAt, source: { kind: 'document', fileId, mentionId,
          anchor: { basis: 'source', baseHash: revision, spans: [{ from, to, text: body }],
            prefix: content.slice(Math.max(0, from - 128), from), suffix: content.slice(to, to + 128) } } });
      return;
    }
    if ('children' in node) node.children.forEach(child => visit(child, block));
  }
  visit(tree);
  return events;
}
