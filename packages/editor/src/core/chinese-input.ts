export const chineseSyntaxOptions = [
 { key: 'quoteMarker', label: '行首 》 识别为引用', input: '》 ', output: '> ' },
 { key: 'orderedMarker', label: '行首 数字。 识别为有序列表', input: '1。 ', output: '1. ' },
 { key: 'codeFence', label: '行首 ··· 识别为代码块', input: '···', output: '```' },
 { key: 'wikiLink', label: '双链左右括号分别识别', input: '【【', output: '[[', examples: [
   { before: '', input: '【【', output: '[[' },
   { before: '[[ ', input: '】】', output: '[[ ]]' },
 ] },
 { key: 'slashCommand', label: '空行 、 打开块菜单（仅可视化编辑）', input: '、', output: '/' },
] as const;
export const chineseInputOptions = [
  { key: 'middleDot', label: '中文间隔号 · 映射为 `', input: '·', output: '`' },
  { key: 'brackets', label: '中文方括号', input: '【 】', output: '[ ]' },
  { key: 'parentheses', label: '中文圆括号', input: '（ ）', output: '( )' },
  { key: 'semicolon', label: '中文分号', input: '；', output: ';' },
  { key: 'comma', label: '中文逗号', input: '，', output: ',' },
  { key: 'period', label: '中文句号', input: '。', output: '.' },
  { key: 'exclamation', label: '中文感叹号', input: '！', output: '!' },
  { key: 'ellipsisToCaret', label: '中文省略号映射为 ^', input: '……', output: '^' },
  { key: 'yenToDollar', label: '中文 ￥ 映射为 $', input: '￥', output: '$' },
] as const;

export type ChineseInputPreferences = Record<(typeof chineseInputOptions | typeof chineseSyntaxOptions)[number]['key'], boolean>;
export const defaultChineseInput = Object.fromEntries(
  [...chineseInputOptions.map(({ key }) => [key, false]), ...chineseSyntaxOptions.map(({ key }) => [key, true])],
) as ChineseInputPreferences;

/** Preserve the old selection-only yuan preference when upgrading. */
export function normalizeChineseInput(value?: unknown, legacyWrapping?: unknown): ChineseInputPreferences {
  const result = { ...defaultChineseInput };
  if (legacyWrapping && typeof legacyWrapping === 'object' &&
      (legacyWrapping as Record<string, unknown>).yenToDollar === true) result.yenToDollar = true;
  if (value && typeof value === 'object') {
    for (const { key } of [...chineseInputOptions, ...chineseSyntaxOptions]) {
      const enabled = (value as Record<string, unknown>)[key];
      if (typeof enabled === 'boolean') result[key] = enabled;
    }
  }
  return result;
}

/** Only call for newly typed or committed text, never for paste or document loading. */
export function mapChineseInput(text: string, options?: Partial<ChineseInputPreferences>): string {
  const settings = normalizeChineseInput(options);
  const replacements: Record<string, [keyof ChineseInputPreferences, string]> = {
    '·': ['middleDot', '`'], '【': ['brackets', '['], '】': ['brackets', ']'],
    '（': ['parentheses', '('], '）': ['parentheses', ')'],
    '；': ['semicolon', ';'], '，': ['comma', ','], '。': ['period', '.'],
    '！': ['exclamation', '!'], '……': ['ellipsisToCaret', '^'], '￥': ['yenToDollar', '$'],
  };
  return text.replace(/……|[·【】（）；，。！￥]/g, symbol => {
    const [key, replacement] = replacements[symbol]!;
    return settings[key] ? replacement : symbol;
  });
}

type ChineseKeyEvent = Pick<KeyboardEvent,
  'key' | 'code' | 'keyCode' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey' | 'isComposing' | 'cancelable' | 'defaultPrevented'>;

/** Map explicit punctuation keys; IME keys must wait for the actual input. */
export function mappedChineseInputKey(event: ChineseKeyEvent, options?: Partial<ChineseInputPreferences>): string | null {
  if (!event.cancelable || event.defaultPrevented || event.isComposing || event.key === 'Dead' ||
      event.key === 'Process' || event.key === 'Unidentified' || event.keyCode === 229 ||
      event.ctrlKey || event.metaKey || event.altKey)
    return null;
  // Canceling a Process/229 key does not reliably stop Microsoft Pinyin's
  // composition. Synthesizing from event.code would insert once here and again
  // when the IME commits. Map the actual input/commit instead of guessing a key.
  const mapped = mapChineseInput(event.key, options);
  return mapped !== event.key ? mapped : null;
}

/** Composition updates and paste must retain their editor/browser handling. */
export function mappedChineseBeforeInput(event: Pick<InputEvent,
  'inputType' | 'data' | 'isComposing' | 'cancelable' | 'defaultPrevented'>,
  options?: Partial<ChineseInputPreferences>): string | null {
  if (!event.cancelable || event.defaultPrevented || event.isComposing || event.inputType !== 'insertText' || !event.data)
    return null;
  const mapped = mapChineseInput(event.data, options);
  return mapped !== event.data ? mapped : null;
}

export interface ChineseSyntaxEdit { deleteBefore: number; insert: string; route?: 'slash' }
export function chineseSyntaxEdit(before: string, typed: string, options: Partial<ChineseInputPreferences>, mode: 'source' | 'visual'): ChineseSyntaxEdit | null {
 if (typed.length > 1) {
  let current = before, changed = false;
  let route: 'slash' | undefined;
  for (const char of typed) {
   const edit = chineseSyntaxEdit(current, char, options, mode);
   if (edit) { current = current.slice(0, current.length - edit.deleteBefore) + edit.insert; changed = true; route = edit.route ?? route; }
   else current += char;
  }
  if (!changed) return null;
  let common = 0;
  while (common < before.length && before[common] === current[common]) common++;
  return { deleteBefore: before.length - common, insert: current.slice(common), ...(route ? { route } : {}) };
 }
 const settings = normalizeChineseInput(options), combined = before + typed;
 const start = mode === 'source' ? /^(?:[ \t]*)(?:> ?)*$/ : /^$/;
 const result = (length: number, insert: string): ChineseSyntaxEdit => ({ deleteBefore: length - typed.length, insert });
 const ordered = combined.match(/(\d{1,9})。[ 　]$/);
 if (settings.quoteMarker && /》[ 　]$/.test(combined) && start.test(combined.slice(0, -2))) return result(2, '> ');
 if (settings.orderedMarker && ordered && start.test(combined.slice(0, -ordered[0].length))) return result(2, '. ');
 if (settings.codeFence && combined.endsWith('···') && start.test(combined.slice(0, -3))) return result(3, '```');
 if (settings.wikiLink && !settings.brackets) {
  if (combined.endsWith('【【')) return result(2, '[[');
  if (combined.endsWith('】】') && combined.lastIndexOf('[[') > combined.lastIndexOf(']]')) return result(2, ']]');
 }
 if (settings.slashCommand && mode === 'visual' && combined === '、') return { deleteBefore: 0, insert: '/', route: 'slash' };
 return null;
}
