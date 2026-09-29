export interface TreeSelection {
  ids: Set<string>;
  anchor: string | null;
}

export function selectTreeEntry(
  selection: TreeSelection,
  target: string,
  visibleIds: string[],
  modifiers: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean },
): TreeSelection {
  if (modifiers.shiftKey && selection.anchor) {
    const start = visibleIds.indexOf(selection.anchor);
    const end = visibleIds.indexOf(target);
    if (start !== -1 && end !== -1) {
      const range = visibleIds.slice(Math.min(start, end), Math.max(start, end) + 1);
      return {
        ids: new Set(modifiers.ctrlKey || modifiers.metaKey ? [...selection.ids, ...range] : range),
        anchor: selection.anchor,
      };
    }
  }
  if (modifiers.ctrlKey || modifiers.metaKey) {
    const ids = new Set(selection.ids);
    if (ids.has(target)) ids.delete(target);
    else ids.add(target);
    return { ids, anchor: target };
  }
  return { ids: new Set([target]), anchor: target };
}

export function topLevelEntries<T extends { path: string }>(entries: T[]): T[] {
  return entries.filter(
    (entry) => !entries.some((other) => other !== entry && entry.path.startsWith(`${other.path}/`)),
  );
}
