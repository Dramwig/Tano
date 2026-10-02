// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { DemoAdapter } from './adapter';
import { loadTemplates, nameTemplate, renderTemplate, saveTemplate, templateVariables } from './workspace-templates';
import { documentTargets } from '@tano/protocol';
import { parse } from 'yaml';

it('keeps Markdown templates portable and out of user document targets and searches', async () => {
  localStorage.clear(); const adapter = new DemoAdapter();
  const path = await saveTemplate(adapter, '# 验收模板\n\n{{title}} {{owner}} {{title}}\n');
  const workspace = await adapter.refresh();
  const template = (await loadTemplates(adapter, workspace)).templates[0]!;
  expect(template.path).toBe(path);
  expect(templateVariables(template.content)).toEqual(['title', 'owner']);
  expect(renderTemplate(template.content, { title: '验收', owner: 'Alice' })).toContain('验收 Alice 验收');
  expect(() => renderTemplate(template.content, { title: '验收' })).toThrow('owner');
  expect(documentTargets(workspace.id, workspace.files).some(target => target.path === path)).toBe(false);
  expect(await adapter.search(workspace.id, '验收模板')).toEqual([]);
});
it('merges independent template edits and preserves overlapping external changes', async () => {
  localStorage.clear(); const adapter = new DemoAdapter();
  const path = await saveTemplate(adapter, '# 模板\n\n标题\n\n备注\n');
  const base = (await loadTemplates(adapter, await adapter.refresh())).templates[0]!;
  await adapter.write(path, '# 模板\n\n标题\n\n外部备注\n', base.snapshot!.hash);
  await saveTemplate(adapter, '# 模板\n\n修改标题\n\n备注\n', base);
  expect((await adapter.read(path)).content).toContain('修改标题\n\n外部备注');
  await expect(saveTemplate(adapter, '# 模板\n\n另一标题\n\n备注\n', base)).rejects.toThrow('外部修改');
  expect((await adapter.read(path)).content).toContain('修改标题');
});
it('keeps the template name in Markdown metadata while preserving document frontmatter on use', async () => {
  localStorage.clear(); const adapter = new DemoAdapter();
  const content = nameTemplate('---\nowner: "{{owner}}"\n---\n# {{title}}\n', '团队周报');
  await saveTemplate(adapter, content);
  expect((await loadTemplates(adapter, await adapter.refresh())).templates[0]!.name).toBe('团队周报');
  const rendered = renderTemplate(content, { owner: 'Alice', title: '第 1 周' });
  expect(rendered).toContain('owner: "Alice"');
  expect(rendered).toContain('# 第 1 周');
  expect(rendered).not.toContain('tanoTemplate');
  const quoted = renderTemplate(content, { owner: 'Alice "QA"', title: '第 2 周' });
  expect(parse(quoted.split('---')[1]!).owner).toBe('Alice "QA"');
});
