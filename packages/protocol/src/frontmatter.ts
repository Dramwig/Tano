import { isMap, isScalar, parseDocument } from 'yaml';

export interface FrontmatterProperty {
  name: string;
  value: string;
  kind: 'date' | 'list' | 'text';
}

function propertyValue(value: unknown): string {
  if (value === null) return '空';
  if (Array.isArray(value)) return value.map(propertyValue).join('、');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function frontmatterDocument(prefix: string) {
  const opening = /^\uFEFF?---(\r?\n)/.exec(prefix);
  if (!opening) return null;
  const remainder = prefix.slice(opening[0].length);
  const match = /(?:^|\r?\n)(---|\.\.\.)(?:\r?\n|$)/.exec(remainder);
  if (!match) return null;
  const end = opening[0].length + match.index + (match[0].startsWith('\r\n') ? 2 : match[0].startsWith('\n') ? 1 : 0);
  const source = prefix.slice(opening[0].length, end);
  const document = parseDocument(source);
  if (document.errors.length || (document.contents !== null && !isMap(document.contents))) return null;
  return { source, document, start: opening[0].length, end };
}

/** Read YAML values without changing the Markdown source. */
export function frontmatterProperties(prefix: string): FrontmatterProperty[] | null {
  try {
    const parsed = frontmatterDocument(prefix);
    if (!parsed) return null;
    const { document } = parsed;
    const data: unknown = document.toJS({ maxAliasCount: 100 });
    if (data === null) return [];
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const sourceOrder = new Map(
      isMap(document.contents)
        ? document.contents.items.flatMap((item, index) =>
          isScalar(item.key) ? [[String(item.key.value), index] as const] : [])
        : [],
    );
    return Object.entries(data).sort(([left], [right]) =>
      (sourceOrder.get(left) ?? Infinity) - (sourceOrder.get(right) ?? Infinity)).map(([name, value]) => ({
      name,
      value: propertyValue(value),
      kind: Array.isArray(value)
        ? 'list'
        : /^(created|updated|date|created_at|updated_at)$/i.test(name)
          ? 'date'
          : 'text',
    }));
  } catch {
    return null;
  }
}

export type FrontmatterValueKind = 'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'list' | 'object' | 'null';

export function frontmatterValue(prefix: string, name: string): { kind: FrontmatterValueKind; value: string } | null {
  const parsed = frontmatterDocument(prefix);
  if (!parsed || !isMap(parsed.document.contents)) return null;
  const pair = parsed.document.contents.items.find((item) => isScalar(item.key) && String(item.key.value) === name);
  if (!pair) return null;
  const value = pair.value?.toJSON() ?? null;
  if (value === null) return { kind: 'null', value: '' };
  if (Array.isArray(value)) return { kind: 'list', value: JSON.stringify(value, null, 2) };
  if (typeof value === 'object') return { kind: 'object', value: JSON.stringify(value, null, 2) };
  if (typeof value === 'boolean') return { kind: 'boolean', value: String(value) };
  if (typeof value === 'number') return { kind: 'number', value: String(value) };
  const plain = isScalar(pair.value) && pair.value.type === 'PLAIN';
  if (plain && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value))
    return { kind: 'datetime', value };
  if (plain && typeof value === 'string' && /^\d{4}[-/]\d{2}[-/]\d{2}$/.test(value))
    return { kind: 'date', value: value.replaceAll('/', '-') };
  return { kind: 'text', value: String(value) };
}
