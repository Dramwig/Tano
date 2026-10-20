import { Document, isMap, isScalar } from 'yaml';
import { frontmatterDocument, type FrontmatterValueKind } from '@tano/protocol/frontmatter';
export { frontmatterProperties, frontmatterValue } from '@tano/protocol/frontmatter';
export type { FrontmatterProperty, FrontmatterValueKind } from '@tano/protocol/frontmatter';
import { splitFrontmatter } from './syntax';

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
