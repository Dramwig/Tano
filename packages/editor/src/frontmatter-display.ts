import { Document, isMap, isScalar, parseDocument } from 'yaml';
import { splitFrontmatter } from './syntax';

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

function frontmatterDocument(prefix: string) {
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

function parseEditedValue(kind: FrontmatterValueKind, input: string): unknown {
  if (kind === 'null') return null;
  if (kind === 'text') return input;
  if (kind === 'boolean') return input === 'true';
  if (kind === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input) || Number.isNaN(Date.parse(`${input}T00:00:00`)) ||
      new Date(`${input}T00:00:00`).getDate() !== Number(input.slice(8, 10)))
      throw new Error('请输入有效日期');
    return input;
  }
  if (kind === 'datetime') {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(input) ||
      Number.isNaN(Date.parse(input)))
      throw new Error('请输入有效日期和时间');
    return input;
  }
  if (kind === 'number') {
    const value = Number(input);
    if (!input.trim() || !Number.isFinite(value)) throw new Error('请输入有效数字');
    return value;
  }
  let value: unknown;
  try { value = JSON.parse(input); } catch { throw new Error('请输入有效 JSON'); }
  if (kind === 'list' && !Array.isArray(value)) throw new Error('请输入 JSON 数组');
  if (kind === 'object' && (!value || typeof value !== 'object' || Array.isArray(value)))
    throw new Error('请输入 JSON 对象');
  return value;
}

function serializeProperty(name: string, value: unknown, kind: FrontmatterValueKind): string {
  const document = new Document({ [name]: value });
  const scalar = document.get(name, true);
  if (kind === 'text' && typeof value === 'string' &&
    /^\d{4}[-/]\d{2}[-/]\d{2}(?:T\d{2}:\d{2})?$/.test(value) && isScalar(scalar))
    scalar.type = 'QUOTE_DOUBLE';
  return document.toString({ lineWidth: 0 });
}

export function updateFrontmatterProperty(
  markdown: string,
  oldName: string | null,
  name: string,
  kind: FrontmatterValueKind,
  input: string,
): string {
  const trimmedName = name.trim();
  if (!trimmedName || /[\r\n]/.test(trimmedName)) throw new Error('请输入有效属性名');
  const value = parseEditedValue(kind, input);
  const { prefix, body } = splitFrontmatter(markdown);
  const lineEnding = prefix.includes('\r\n') ? '\r\n' : '\n';
  const initial = prefix || `---${lineEnding}---${lineEnding}`;
  const parsed = frontmatterDocument(initial);
  if (!parsed) throw new Error('YAML 属性无法解析，请在源码中修改');
  const items = isMap(parsed.document.contents) ? parsed.document.contents.items : [];
  const duplicate = items.find((item) => isScalar(item.key) && String(item.key.value) === trimmedName);
  if (duplicate && trimmedName !== oldName) throw new Error('属性名已存在');
  const serialized = serializeProperty('value', value, kind).slice('value:'.length).replace(/\n$/, '').replace(/\n/g, lineEnding);
  if (oldName === null) {
    const key = serializeProperty(trimmedName, value, kind).replace(/\n/g, lineEnding);
    if (isMap(parsed.document.contents) && parsed.document.contents.flow && items.length === 0) {
      const range = parsed.document.contents.range;
      if (!range) throw new Error('此属性需要在源码中添加');
      return initial.slice(0, parsed.start + range[0]) + key.slice(0, -lineEnding.length)
        + initial.slice(parsed.start + range[1]) + body;
    }
    return initial.slice(0, parsed.end) + key + initial.slice(parsed.end) + body;
  }
  const pair = items.find((item) => isScalar(item.key) && String(item.key.value) === oldName);
  if (!pair || !isScalar(pair.key)) throw new Error('属性已改变，请重新打开编辑');
  const keySource = JSON.stringify(trimmedName);
  const keyRange = pair.key.range;
  const valueRange = pair.value?.range;
  if (!keyRange || !valueRange) throw new Error('此属性需要在源码中修改');
  const originalValue = parsed.source.slice(valueRange[0], valueRange[1]);
  const trailing = originalValue.endsWith(lineEnding) ? lineEnding : '';
  const colonEnd = keyRange[2] + 1;
  let source = parsed.source.slice(0, colonEnd) + serialized + trailing + parsed.source.slice(valueRange[1]);
  if (trimmedName !== oldName) {
    const keyEnd = keyRange[1];
    source = source.slice(0, keyRange[0]) + keySource + source.slice(keyEnd);
  }
  return initial.slice(0, parsed.start) + source + initial.slice(parsed.end) + body;
}

export function removeFrontmatterProperty(markdown: string, name: string): string {
  const { prefix, body } = splitFrontmatter(markdown);
  const parsed = frontmatterDocument(prefix);
  if (!parsed || !isMap(parsed.document.contents)) throw new Error('YAML 属性无法解析');
  const pair = parsed.document.contents.items.find((item) => isScalar(item.key) && String(item.key.value) === name);
  if (!pair || !isScalar(pair.key) || !pair.key.range || !pair.value?.range)
    throw new Error('此属性需要在源码中删除');
  const from = pair.key.range[0];
  const to = pair.value.range[2];
  return prefix.slice(0, parsed.start + from) + prefix.slice(parsed.start + to) + body;
}
