import type { PaneDrop } from './pane-layout';

export type TabRelease =
  | { kind: 'return' | 'reference' | 'detach' }
  | { kind: 'dock'; drop: PaneDrop }
  | { kind: 'reorder'; target: { id: string; side: 'before' | 'after' } };

/** Resolve semantics once, before any release animation or store mutation. */
export function resolveTabRelease(input: {
  source: { id: string; paneId?: string; tabs: readonly string[] };
  reference: boolean;
  outside: boolean;
  detachable: boolean;
  paneDrop?: PaneDrop;
  target?: { id: string; side: 'before' | 'after' };
}): TabRelease {
  if (input.reference) return { kind: 'reference' };
  if (input.outside) return { kind: input.detachable ? 'detach' : 'return' };
  const sourceIndex = input.source.tabs.indexOf(input.source.id);
  const unchangedIndex = (index: number | undefined) => index === sourceIndex || index === sourceIndex + 1;
  if (input.paneDrop) {
    const drop = input.paneDrop;
    if (drop.paneId === input.source.paneId && drop.side === 'center' && unchangedIndex(drop.index))
      return { kind: 'return' };
    return { kind: 'dock', drop };
  }
  if (input.target) {
    const index = input.source.tabs.indexOf(input.target.id) + (input.target.side === 'after' ? 1 : 0);
    if (unchangedIndex(index)) return { kind: 'return' };
    return { kind: 'reorder', target: input.target };
  }
  return { kind: 'return' };
}
