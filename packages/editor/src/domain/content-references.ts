import { isMarkdown, parseReferenceUrl, referenceKey, resolveWorkspaceReference } from '@tano/protocol';
import type { FileEntry, ReferenceIdentity, ReferenceTarget } from '@tano/protocol';
import { documentLinkDetails, type DocumentLinkDetail } from '../core/document-links';

type WikiResolution =
  { file: FileEntry; heading: string } | { error: 'invalid' | 'missing' | 'ambiguous' };

/** Resolve Obsidian-style forward links without depending on a path as file identity. */
export function resolveWikiLink(
  files: FileEntry[],
  currentPath: string,
  target: string,
): WikiResolution {
  const separator = target.indexOf('#');
  const name = (separator < 0 ? target : target.slice(0, separator)).trim();
  const heading = separator < 0 ? '' : target.slice(separator + 1).trim();
  const notes = files.filter((file) => file.kind === 'file' && isMarkdown(file.path));
  const current = notes.find((file) => file.path === currentPath);
  if (!name) return current && heading ? { file: current, heading } : { error: 'invalid' };
  if (/^[\\/]|[\\:\u0000-\u001f]/.test(name) || name.includes('\\')) return { error: 'invalid' };

  const spellings = isMarkdown(name) ? [name] : [`${name}.md`, `${name}.markdown`];
  const paths: string[] = [];
  for (const spelling of spellings) {
    const relative = resolveWorkspaceReference(currentPath, spelling);
    if (relative) paths.push(relative);
    if (!spelling.includes('/')) {
      const parents = currentPath.split('/').slice(0, -1);
      for (let depth = parents.length - 1; depth >= 0; depth--)
        paths.push([...parents.slice(0, depth), spelling].join('/'));
    } else if (!spelling.startsWith('../') && !spelling.startsWith('./')) paths.push(spelling);
  }
  for (const path of paths) {
    const exact = notes.find((file) => file.path === path);
    if (exact) return { file: exact, heading };
  }

  // A short wiki target can name a page anywhere in the workspace. Never pick
  // an arbitrary page when multiple folders contain the same title.
  const names = new Set(spellings.map((spelling) => spelling.toLocaleLowerCase()));
  const matches = notes.filter((file) => {
    const path = file.path.toLocaleLowerCase();
    return name.includes('/')
      ? spellings.some((spelling) => path.endsWith(`/${spelling.toLocaleLowerCase()}`))
      : names.has(path.split('/').at(-1)!);
  });
  if (matches.length === 1) return { file: matches[0], heading };
  return { error: matches.length ? 'ambiguous' : 'missing' };
}

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
export function contentReferences(targets: readonly ReferenceTarget[], contents: ReadonlyMap<string, string>,
  readLinks: (content: string) => readonly DocumentLinkDetail[] = documentLinkDetails): ContentReference[] {
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
    for (const link of readLinks(content)) {
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
      edges.push({
        source: origin, target: identity, name: target?.name ?? link.label ?? link.target,
        path: target?.path, excerpt: link.excerpt, missing: !target, archived: !!target?.archived,
      });
    }
  }
  return edges;
}

export function referenceContext(edges: readonly ContentReference[], identity: ReferenceIdentity, errors: string[] = []): ReferenceContext {
  const key = referenceKey(identity);
  return {
    outgoing: edges.filter(edge => referenceKey(edge.source) === key),
    incoming: edges.filter(edge => referenceKey(edge.target) === key), errors,
  };
}
