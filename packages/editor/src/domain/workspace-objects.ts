import { mergeText } from '@tano/markdown';
import { mergeWorkspaceObject, parseReferenceUrl, type WorkspaceObject } from '@tano/protocol';
import { documentLinkDetails, internalReferenceDefinitions } from '../core/document-links';

export function mergeDescription(base: string, local: string, remote: string): string | null {
  const atomic = [
    ...documentLinkDetails(base).filter(link => link.kind === 'markdown' && parseReferenceUrl(link.target)),
    ...internalReferenceDefinitions(base),
  ];
  return mergeText(base, local, remote, atomic);
}

export const mergeObject = (base: WorkspaceObject, ours: WorkspaceObject, theirs: WorkspaceObject) =>
  mergeWorkspaceObject(base, ours, theirs, mergeDescription);
