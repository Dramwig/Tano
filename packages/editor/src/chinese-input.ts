export const chineseInputOptions = [
  { key: 'brackets', label: '中文方括号', input: '【 】', output: '[ ]' },
  { key: 'parentheses', label: '中文圆括号', input: '（ ）', output: '( )' },
  { key: 'semicolon', label: '中文分号', input: '；', output: ';' },
  { key: 'comma', label: '中文逗号', input: '，', output: ',' },
  { key: 'period', label: '中文句号', input: '。', output: '.' },
  { key: 'exclamation', label: '中文感叹号', input: '！', output: '!' },
  { key: 'ellipsisToCaret', label: '中文省略号映射为 ^', input: '……', output: '^' },
  { key: 'yenToDollar', label: '中文 ￥ 映射为 $', input: '￥', output: '$' },
] as const;

export type ChineseInputPreferences = Record<(typeof chineseInputOptions)[number]['key'], boolean>;
export const defaultChineseInput = Object.fromEntries(
  chineseInputOptions.map(({ key }) => [key, false]),
) as ChineseInputPreferences;

/** Preserve the old selection-only yuan preference when upgrading. */
export function normalizeChineseInput(value?: unknown, legacyWrapping?: unknown): ChineseInputPreferences {
  const result = { ...defaultChineseInput };
  if (legacyWrapping && typeof legacyWrapping === 'object' &&
      (legacyWrapping as Record<string, unknown>).yenToDollar === true) result.yenToDollar = true;
  if (value && typeof value === 'object') {
    for (const { key } of chineseInputOptions) {
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
    '【': ['brackets', '['], '】': ['brackets', ']'],
    '（': ['parentheses', '('], '）': ['parentheses', ')'],
    '；': ['semicolon', ';'], '，': ['comma', ','], '。': ['period', '.'],
    '！': ['exclamation', '!'], '……': ['ellipsisToCaret', '^'], '￥': ['yenToDollar', '$'],
  };
  return text.replace(/……|[【】（）；，。！￥]/g, symbol => {
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
