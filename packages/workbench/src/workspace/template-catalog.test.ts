import { expect, it } from 'vitest';
import { builtinTemplates, renderTemplate } from './workspace-templates';
import { filterTemplates, templateDocumentPath, templatePreview } from './template-catalog';

it('keeps workspace templates in their own category even when their names match builtins', () => {
  const custom = { ...builtinTemplates[0]!, id: 'custom-meeting', path: '.tano/templates/custom.md' };
  expect(filterTemplates([...builtinTemplates, custom], 'custom', '会议')).toEqual([custom]);
  expect(filterTemplates([...builtinTemplates, custom], 'study', '会议')).toEqual([]);
  expect(filterTemplates(builtinTemplates, 'all', '项目 里程碑').map(item => item.id)).toEqual(['project']);
});

it('previews missing variables without allowing sample values to be written', () => {
  const template = builtinTemplates.find(item => item.id === 'meeting')!;
  const values = { title: '保留标题', date: '2026-10-11', owner: '' };
  expect(templatePreview(template, values)).toContain('参与人：待补充');
  expect(templatePreview(template, values)).toContain('# 保留标题');
  expect(values.owner).toBe('');
  expect(() => renderTemplate(template.content, values)).toThrow('owner');
});

it('suggests a portable unused filename with workspace path equivalence', () => {
  expect(templateDocumentPath('项目/计划', ['项目-计划.md', '项目-计划 2.md'])).toBe('项目-计划 3.md');
  expect(templateDocumentPath('Report', ['ＲＥＰＯＲＴ.md'])).toBe('Report 2.md');
});
