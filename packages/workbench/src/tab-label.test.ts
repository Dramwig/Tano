import { expect, it } from 'vitest';
import { documentTabLabel } from './tab-label';
import type { DocumentTab } from './stores/workspace';

const tab: DocumentTab = {
  id: 'document', path: 'notes/窗口.md', blank: false, graph: false,
  plugins: false, calendar: false, attachmentPreview: false,
};

it.each([
  [{}, '窗口'],
  [{ calendar: true, path: '' }, '计划'],
  [{ graph: true, path: '' }, '关系图谱'],
  [{ plugins: true, path: '' }, '插件'],
  [{ blank: true, path: '' }, '新标签页'],
  [{ dataTable: { name: '项目进度', dirty: false } }, '项目进度'],
  [{ directory: { name: '资料', path: '资料', missing: false } }, '资料'],
] satisfies [Partial<DocumentTab>, string][])('labels tab %j consistently in its native window', (overrides, expected) => {
  expect(documentTabLabel({ ...tab, ...overrides })).toBe(expected);
});
