import { expect, it } from 'vitest';
import { sourceChanges } from './source-changes';

it.each([
  ['开头\n\n中间保持光标的段落\n\n结尾', '新增甲\n开头\n\n中间保持光标的段落\n\n结尾\n新增乙'],
  ['before same middle same after', 'BEFORE same middle same AFTER'],
  ['中文😀原文\r\n第二行', '中文😀新增原文\r\n第二行尾部'],
  ['', 'new'], ['delete', ''],
])('reconstructs changes while preserving unchanged ranges', (before, after) => {
  const changes = sourceChanges(before, after);
  let text = before;
  for (const change of [...changes].reverse()) text = text.slice(0, change.from) + change.insert + text.slice(change.to);
  expect(text).toBe(after);
  const middle = before.indexOf('middle');
  if (middle >= 0) expect(changes.some(change => change.from <= middle && change.to > middle)).toBe(false);
});
