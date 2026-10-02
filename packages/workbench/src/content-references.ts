import { parseReferenceUrl, referenceKey, resolveWorkspaceReference } from '@tano/protocol';
import type { ReferenceIdentity, ReferenceTarget } from '@tano/protocol';
import { documentLinkDetails } from '@tano/editor/document-links';
import { resolveWikiLink } from './wiki-links';

export interface ContentReference {
  source: ReferenceTarget;
  target: ReferenceIdentity;
  name: string;
  path?: string;
  excerpt: string;
  missing: boolean;
  archived: boolean;
}
export interface ReferenceContext { outgoing: ContentReference[]; incoming: ContentReference[]; errors: string[] }

/** A rebuildable directed index. Content is authoritative; no duplicate relation rows are persisted. */
export function contentReferences(targets: readonly ReferenceTarget[], contents: ReadonlyMap<string, string>): ContentReference[] {
  const counts = new Map<string, number>();
  for (const target of targets) counts.set(referenceKey(target), (counts.get(referenceKey(target)) ?? 0) + 1);
  const byKey = new Map(targets.filter(target => counts.get(referenceKey(target)) === 1).map(target => [referenceKey(target), target]));
  const documents = targets.filter(target => target.type === 'document')
    .map(target => ({ id: target.id, path: target.path, name: target.name, kind: 'file' as const, size: 0, modified: 0 }));
  const edges: ContentReference[] = [];
  for (const source of targets) {
    if (counts.get(referenceKey(source)) !== 1) continue;
    const content = contents.get(referenceKey(source));
    if (content === undefined) continue;
    const seen = new Set<string>();
    for (const link of documentLinkDetails(content)) {
      let identity = parseReferenceUrl(link.target);
      if (!identity && link.kind === 'wiki') {
        const resolved = resolveWikiLink(documents, source.path, link.target);
        if ('file' in resolved) identity = { type: 'document', id: resolved.file.id };
      } else if (!identity) {
        const path = resolveWorkspaceReference(source.path, link.target);
        const target = targets.find(target => ['document', 'asset'].includes(target.type) && target.path === path);
        if (target) identity = { type: target.type, id: target.id };
      }
      if (!identity || seen.has(referenceKey(identity))) continue;
      seen.add(referenceKey(identity));
      const target = byKey.get(referenceKey(identity));
      const origin = { workspace: source.workspace, type: source.type, id: source.id, name: source.name, path: source.path, archived: source.archived };
      edges.push({ source: origin, target: identity, name: target?.name ?? link.label ?? link.target,
        path: target?.path, excerpt: link.excerpt, missing: !target, archived: !!target?.archived });
    }
  }
  return edges;
}

export function referenceContext(edges: readonly ContentReference[], identity: ReferenceIdentity, errors: string[] = []): ReferenceContext {
  const key = referenceKey(identity);
  return { outgoing: edges.filter(edge => referenceKey(edge.source) === key),
    incoming: edges.filter(edge => referenceKey(edge.target) === key), errors };
}
