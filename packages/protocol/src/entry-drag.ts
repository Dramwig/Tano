import type { ReferenceTarget } from './objects';

export const entryReferenceDragType = 'application/x-tano-entry-references';

/** Resolve drag identities against live targets, never trust dragged labels or paths. */
export function droppedEntryReferences(data: string, targets: readonly ReferenceTarget[]): ReferenceTarget[] {
  try {
    const payload = JSON.parse(data);
    if (typeof payload.workspace !== 'string' || !Array.isArray(payload.ids)) return [];
    const ids = new Set(payload.ids.filter((id: unknown) => typeof id === 'string'));
    return targets.filter(target => target.workspace === payload.workspace && ids.has(target.id));
  } catch {
    return [];
  }
}
