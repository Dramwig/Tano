import { parseReferenceUrl } from '@tano/protocol';
import { mergeText } from '@tano/markdown';
import { documentLinkDetails, internalReferenceDefinitions } from '@tano/editor/document-links';

export function mergeDescription(base: string, local: string, remote: string): string | null {
  const atomic = [...documentLinkDetails(base).filter(link => link.kind === 'markdown' && parseReferenceUrl(link.target)),
    ...internalReferenceDefinitions(base)];
  return mergeText(base, local, remote, atomic);
}
