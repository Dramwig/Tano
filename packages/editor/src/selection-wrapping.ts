export const selectionWrappingOptions = [
  { key: 'asterisk', label: '星号斜体与粗体', example: '*文字* → **文字**', enabled: true },
  { key: 'underscore', label: '下划线斜体与粗体', example: '_文字_ → __文字__', enabled: true },
  { key: 'strike', label: '删除线', example: '~ → ~~文字~~', enabled: true },
  { key: 'code', label: '行内代码', example: '` → `文字`', enabled: true },
  { key: 'math', label: '行内公式', example: '$ → $文字$', enabled: true },
  { key: 'yenToDollar', label: '中文 ￥ 映射为 $', example: '￥ → $文字$；需开启行内公式，仅作用于选区包裹', enabled: false },
  { key: 'highlight', label: '高亮', example: '= → ==文字==', enabled: false },
  { key: 'superscript', label: '上标（扩展）', example: '^ → ^文字^', enabled: false },
  { key: 'subscript', label: '下标（扩展）', example: '~ → ~文字~；再次输入 ~ 可升级为删除线', enabled: false },
  { key: 'underline', label: '下划线（扩展）', example: '+ → ++文字++', enabled: false },
  { key: 'comment', label: '注释（扩展）', example: '% → %%文字%%', enabled: false },
] as const;
export type SelectionWrappingKey = (typeof selectionWrappingOptions)[number]['key'];
export type SelectionWrappingPreferences = Record<SelectionWrappingKey | 'enabled', boolean>;
export const defaultSelectionWrapping = Object.fromEntries([
  ['enabled', true], ...selectionWrappingOptions.map(option => [option.key, option.enabled]),
]) as SelectionWrappingPreferences;

/** Old installations and invalid stored values retain safe defaults. */
export function normalizeSelectionWrapping(value?: unknown): SelectionWrappingPreferences {
  const result = { ...defaultSelectionWrapping };
  if (value && typeof value === 'object') {
    for (const key of Object.keys(result) as (keyof SelectionWrappingPreferences)[]) {
      const enabled = (value as Record<string, unknown>)[key];
      if (typeof enabled === 'boolean') result[key] = enabled;
    }
  }
  return result;
}

/** A shared keyboard policy; offsets refer to the selected source text. */
export function selectionWrap(text: string, key: string, options?: Partial<SelectionWrappingPreferences>, before = '', after = '') {
  const settings = normalizeSelectionWrapping(options);
  if (!settings.enabled || !text.trim() || /[\r\n]/.test(text)) return null;
  if (key === '￥' && settings.yenToDollar) key = '$';
  const tokens: Record<string, string | false> = {
    '*': settings.asterisk && '*', '**': settings.asterisk && '**',
    '_': settings.underscore && '_', '__': settings.underscore && '__',
    '~': settings.subscript ? '~' : settings.strike && '~~', '~~': settings.strike && '~~',
    '=': settings.highlight && '==', '==': settings.highlight && '==',
    '`': settings.code && '`', '$': settings.math && '$',
    '^': settings.superscript && '^', '+': settings.underline && '++', '++': settings.underline && '++',
    '%': settings.comment && '%%', '%%': settings.comment && '%%',
  };
  let delimiter = tokens[key];
  if (!delimiter) return null;
  // A second press on the retained selection must not add a second pair of doubles.
  if (before.endsWith(delimiter) && after.startsWith(delimiter)) {
    if ((key === '*' || key === '_' || (key === '~' && settings.strike)) && delimiter.length === 1 &&
        !before.endsWith(delimiter.repeat(2)) && !after.startsWith(delimiter.repeat(2))) {
      // Add one marker on each side to upgrade italic/subscript to bold/strike.
    } else return { prefix: '', suffix: '', literal: key === '`' || key === '$' };
  }
  let padding = '';
  if (key === '`') {
    delimiter = '`'.repeat(Math.max(1, ...[...text.matchAll(/`+/g)].map(match => match[0].length + 1)));
    if (text.startsWith('`') || text.endsWith('`') || (/^ .* $/.test(text) && !!text.trim())) padding = ' ';
  }
  return { prefix: delimiter + padding, suffix: padding + delimiter, literal: key === '`' || key === '$' };
}
