import { parseObject, type WorkspaceObject } from './objects';
import { parseDataTable, type DataTable } from './data-tables';

const canonical = (value: unknown): string => {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
};
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const identified = (value: unknown): value is { id: string }[] =>
  Array.isArray(value) && value.every((item) => object(item) && typeof item.id === 'string');
/** Three-way merge by row/field/view identity and cell key, with deletion/edit conflicts. */
function mergeValue(base: unknown, ours: unknown, theirs: unknown): unknown {
  if (same(base, ours) || same(ours, theirs)) return theirs;
  if (same(base, theirs)) return ours;
  if (object(base) && object(ours) && object(theirs)) {
    const merged = Object.create(null) as Record<string, unknown>;
    for (const key of new Set([
      ...Object.keys(base),
      ...Object.keys(ours),
      ...Object.keys(theirs),
    ])) {
      const value = mergeValue(base[key], ours[key], theirs[key]);
      if (value !== undefined) merged[key] = value;
    }
    return merged;
  }
  if (identified(base) && identified(ours) && identified(theirs)) {
    const b = new Map(base.map((item) => [item.id, item])),
      o = new Map(ours.map((item) => [item.id, item])),
      t = new Map(theirs.map((item) => [item.id, item]));
    const ids = [...new Set([...theirs, ...ours, ...base].map((item) => item.id))];
    const values = new Map(ids.map((id) => [id, mergeValue(b.get(id), o.get(id), t.get(id))]));
    const survivors = new Set(
      base.filter((item) => o.has(item.id) && t.has(item.id)).map((item) => item.id),
    );
    const order = (items: { id: string }[]) =>
      items.map((item) => item.id).filter((id) => survivors.has(id));
    const bo = order(base),
      oo = order(ours),
      to = order(theirs);
    if (!same(bo, oo) && !same(bo, to) && !same(oo, to)) throw new Error('顺序冲突');
    const preferred = !same(bo, oo) ? ours : theirs;
    const orderedIds = [...new Set([...preferred.map((item) => item.id), ...ids])];
    return orderedIds.map((id) => values.get(id)).filter((item) => item !== undefined);
  }
  throw new Error('字段冲突');
}
export function mergeDataTable(
  base: DataTable,
  ours: DataTable,
  theirs: DataTable,
): DataTable | null {
  if (base.id !== ours.id || base.id !== theirs.id) return null;
  try {
    return parseDataTable(JSON.stringify(mergeValue(base, ours, theirs)), base.id);
  } catch {
    return null;
  }
}

/** Merge independently edited fields. Identity/type are immutable, never inferred from a title. */
export function mergeWorkspaceObject(
  base: WorkspaceObject,
  ours: WorkspaceObject,
  theirs: WorkspaceObject,
  mergeDescription: (base: string, ours: string, theirs: string) => string | null = (b, o, t) => same(b, o) || same(o, t) ? t : same(b, t) ? o : null,
): WorkspaceObject | null {
  if (
    base.id !== ours.id ||
    base.id !== theirs.id ||
    base.type !== ours.type ||
    base.type !== theirs.type
  )
    return null;
  const merged = { ...theirs };
  for (const key of ['name', 'description', 'archived', 'properties'] as const) {
    if (key === 'properties') {
      const result: Record<string, unknown> = Object.assign(Object.create(null), theirs.properties);
      for (const field of new Set([
        ...Object.keys(base.properties),
        ...Object.keys(ours.properties),
      ])) {
        if (same(base.properties[field], ours.properties[field])) continue;
        if (
          !same(base.properties[field], theirs.properties[field]) &&
          !same(ours.properties[field], theirs.properties[field])
        )
          return null;
        if (Object.hasOwn(ours.properties, field)) result[field] = ours.properties[field];
        else delete result[field];
      }
      merged.properties = result;
    } else if (key === 'description') {
      const description = mergeDescription(base.description, ours.description, theirs.description);
      if (description === null) return null;
      merged.description = description;
    } else if (!same(base[key], ours[key])) {
      if (!same(base[key], theirs[key]) && !same(ours[key], theirs[key])) return null;
      Object.assign(merged, { [key]: ours[key] });
    }
  }
  return parseObject(JSON.stringify(merged));
}
