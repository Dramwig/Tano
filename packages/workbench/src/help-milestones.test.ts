import { expect, it } from 'vitest';
import { newMarkdownMilestones, planMilestones } from './help-milestones';
import type { WorkspaceObject } from '@tano/protocol';

it.each([
  ['heading', '## 一个标题'], ['bold', '**重点**'], ['italic', '*补充*'],
  ['bullet-list', '- 一条记录'], ['ordered-list', '1. 第一步'], ['todo-list', '- [ ] 待办'],
  ['quote', '> 一段引用'], ['code-block', '```js\nconst x = 1;\n```'], ['inline-code', '`npm run dev`'],
  ['table', '| 列 |\n| --- |\n| 值 |'], ['divider', '前文\n\n---\n\n后文'],
  ['external-link', '[资料](https://example.com)'], ['image', '![示例](image.png)'],
  ['footnote', '说明[^a]\n\n[^a]: 参考资料'],
])('recognizes a newly inserted %s feature', (id, markdown) => {
  expect(newMarkdownMilestones('普通正文', '普通正文\n\n' + markdown)).toContain(id);
});

it('does not credit existing syntax, plain text edits, code examples or incomplete footnotes', () => {
  expect(newMarkdownMilestones('**原有重点**\n\n正文', '**原有重点**\n\n修改正文')).toEqual([]);
  expect(newMarkdownMilestones('## 标题\n\n正文', '## 标题\n\n正文\n')).toEqual([]);
  expect(newMarkdownMilestones('', '```md\n# 标题\n**加粗**\n- 列表\n```')).toEqual(['code-block']);
  expect(newMarkdownMilestones('', '`**示例**`')).toEqual(['inline-code']);
  expect(newMarkdownMilestones('', '---\ntitle: 示例\n---\n正文')).toEqual([]);
  expect(newMarkdownMilestones('', '说明[^a]')).not.toContain('footnote');
  expect(newMarkdownMilestones('', '[内部](other.md)')).not.toContain('external-link');
});

it('only credits changed plan fields, not pre-existing completion or dates', () => {
  const object: WorkspaceObject = { version: 1, id: 'abc123', type: 'event', name: '计划', archived: false,
    description: '说明', properties: { date: '2026-10-08', checkable: true, completed: true } };
  expect(planMilestones(undefined, object)).toEqual(['plan', 'plan-date', 'plan-description', 'plan-complete']);
  expect(planMilestones(object, { ...object, name: '改名' })).toEqual([]);
  expect(planMilestones(object, { ...object, properties: { ...object.properties, date: '2026-10-09', completed: false } }))
    .toEqual(['plan-date']);
  expect(planMilestones(undefined, { ...object, type: 'person' })).toEqual([]);
});
