import { expect, it } from 'vitest';
import { makeCommentAnchor, rebaseCommentAnchor, resolveCommentAnchor } from './comment-anchors';

it('keeps surviving fragments of a selection across three blocks and hides a fully deleted selection', () => {
  const before = '第一段末尾\n第二段全文\n第三段开头';
  const first = before.indexOf('末尾');
  const second = before.indexOf('第二段全文');
  const third = before.indexOf('开头');
  const anchor = makeCommentAnchor('prose', before, [
    { from: first, to: first + 2, text: '末尾' },
    { from: second, to: second + 5, text: '第二段全文' },
    { from: third, to: third + 2, text: '开头' },
  ], 'base');
  const partly = rebaseCommentAnchor(anchor, before, '第一段末尾\n第三段开头');
  expect(partly?.spans.map(span => span.text)).toEqual(['末尾', '开头']);
  expect(rebaseCommentAnchor(anchor, before, '另一篇文章')).toBeNull();
});

it('does not attach a deleted quote to an ambiguous duplicate elsewhere', () => {
  const before = '开头\n待确认\n中间\n待确认\n结尾';
  const from = before.indexOf('待确认');
  const anchor = makeCommentAnchor('prose', before, [{ from, to: from + 3, text: '待确认' }], 'base');
  expect(resolveCommentAnchor({ ...anchor, prefix: '', suffix: '', spans: [{ from: 0, to: 3, text: '待确认' }] }, before)).toBeNull();
});

it('moves selected text when content is inserted before it', () => {
  const before = '甲段\n乙段';
  const from = before.indexOf('乙段');
  const anchor = makeCommentAnchor('prose', before, [{ from, to: from + 2, text: '乙段' }], 'base');
  expect(rebaseCommentAnchor(anchor, before, '新增\n甲段\n乙段')?.spans[0]?.from).toBe(6);
});

it('detaches when deleting one of two identical blocks makes the survivor ambiguous', () => {
  const before = '待确认\n待确认';
  const anchor = makeCommentAnchor('prose', before,
    [{ from: 0, to: 3, text: '待确认' }], 'base');
  expect(rebaseCommentAnchor(anchor, before, '待确认')).toBeNull();
});
