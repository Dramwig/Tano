import { expect, it } from 'vitest';
import { pluralMessage } from './plurals';
import { preloadUiLocale, setUiLocale, t } from './i18n';

it('uses locale plural rules, including French zero, without changing interpolation values', () => {
  const message = { count: 0, forms: { one: '{0} item', other: '{0} items' } };
  expect(pluralMessage(message, [0], 'en-US')).toBe('{0} items');
  expect(pluralMessage(message, [0], 'fr-FR')).toBe('{0} item');
  expect(pluralMessage(message, [1.5], 'en-US')).toBe('{0} items');
  expect(pluralMessage(message, ['1'], 'en-US')).toBe('{0} items');
});

it('renders counts and context keys through synchronous t after preparation', async () => {
  await preloadUiLocale('en-US');
  await setUiLocale('en-US');
  expect(t('{0} 个文档', [0])).toBe('0 documents');
  expect(t('{0} 个文档', [1])).toBe('1 document');
  expect(t('{0} 个文档', [2])).toBe('2 documents');
  expect(t('已导入 {0} 条，跳过 {1} 条重复或取消的事项。', [2, 1])).toBe('Imported 2 items; skipped 1 duplicate or canceled item.');
  expect(t('推理强度::高')).toBe('High');
  await setUiLocale('zh-CN');
  expect(t('推理强度::高')).toBe('高');
});
