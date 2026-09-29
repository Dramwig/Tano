import {
  basename,
  isMarkdown,
  isWorkspaceInternalPath,
  parseReferenceUrl,
  resolveWorkspaceReference,
} from '@tano/protocol';
import type { FileEntry, WorkspaceRelation } from '@tano/protocol';
import type { DocumentLink } from '@tano/editor/document-links';
import { resolveWikiLink } from './wiki-links';

export const GRAPH_TAB_ID = 'view:graph';
export interface GraphNode {
  id: string;
  path: string;
  label: string;
  degree: number;
}
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
}
export interface DocumentGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function graphDocuments(files: FileEntry[]) {
  return files.filter(
    (file) => file.kind === 'file' && isMarkdown(file.path) && !isWorkspaceInternalPath(file.path),
  );
}

/** A rebuildable view. File IDs, rather than names or paths, identify nodes. */
export function buildDocumentGraph(
  files: FileEntry[],
  links: ReadonlyMap<string, readonly DocumentLink[]>,
  relations: readonly WorkspaceRelation[],
): DocumentGraph {
  const notes = graphDocuments(files);
  const nodes = notes.map((file) => ({
    id: file.id,
    path: file.path,
    label: basename(file.path).replace(/\.(md|markdown)$/i, ''),
    degree: 0,
  }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const byPath = new Map(nodes.map((node) => [node.path, node]));
  const edges = new Map<string, GraphEdge>();
  function connect(source: string, target: string | undefined) {
    if (!target || source === target || !byId.has(source) || !byId.has(target)) return;
    const pair = [source, target].sort();
    const id = JSON.stringify(pair);
    if (edges.has(id)) return;
    edges.set(id, { id, source: pair[0], target: pair[1] });
    byId.get(source)!.degree++;
    byId.get(target)!.degree++;
  }
  for (const file of notes) {
    for (const link of links.get(file.id) ?? []) {
      if (link.kind === 'wiki') {
        const result = resolveWikiLink(notes, file.path, link.target);
        if ('file' in result) connect(file.id, result.file.id);
      } else {
        const reference = parseReferenceUrl(link.target);
        if (reference?.type === 'document') connect(file.id, reference.id);
        else {
          const path = resolveWorkspaceReference(file.path, link.target);
          if (path) connect(file.id, byPath.get(path)?.id);
        }
      }
    }
  }
  for (const relation of relations)
    if (relation.source.type === 'document' && relation.target.type === 'document')
      connect(relation.source.id, relation.target.id);
  return { nodes, edges: [...edges.values()] };
}
