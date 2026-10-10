import { localDayKey } from './calendar';
import { renderTemplate, templateVariables } from './workspace-templates';
import type { DocumentTemplate } from './workspace-templates';
import { pathKey } from '@tano/protocol';

export type TemplateCategory = 'all' | 'work' | 'study' | 'life' | 'custom';
export const templateCategories: { id: TemplateCategory; label: string }[] = [
  { id: 'all', label: '推荐' }, { id: 'work', label: '工作' },
  { id: 'study', label: '学习' }, { id: 'life', label: '生活' }, { id: 'custom', label: '我的模板' },
];
const catalog: Record<string, { category: TemplateCategory; description: string; tone: string }> = {
  meeting: { category: 'work', description: '记录讨论、沉淀决定，让每次会议都有下一步。', tone: 'mint' },
  weekly: { category: 'work', description: '梳理本周进展，明确下周计划。', tone: 'blue' },
  project: { category: 'work', description: '规划目标、拆解任务，推动项目落地。', tone: 'sand' },
  todo: { category: 'life', description: '记录待办事项，专注完成每一件事。', tone: 'mint' },
  study: { category: 'study', description: '记录学习过程，沉淀知识与思考。', tone: 'blue' },
  travel: { category: 'life', description: '规划行程、收集灵感，享受更好的旅程。', tone: 'sand' },
  handoff: { category: 'work', description: '整理进展与待办，让协作顺畅衔接。', tone: 'lavender' },
};
export function templateInfo(template: DocumentTemplate) {
  return template.path ? { category: 'custom' as const, description: '保存在当前工作区，可重复使用和编辑。', tone: 'lavender' }
    : catalog[template.id] ?? { category: 'work' as const, description: '从模板开始，写下新的一页。', tone: 'mint' };
}
export function filterTemplates(templates: DocumentTemplate[], category: TemplateCategory, query: string) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return templates.filter(template => {
    const info = templateInfo(template);
    const haystack = `${template.name} ${info.description} ${template.content}`.toLocaleLowerCase();
    return (category === 'all' || info.category === category) && terms.every(term => haystack.includes(term));
  });
}
/** Preview fills missing fields without changing the values that will be written. */
export function templatePreview(template: DocumentTemplate, values: Record<string, string> = {}) {
  const defaults: Record<string, string> = { title: template.name, date: localDayKey(new Date()), owner: '待补充', project: '项目名称' };
  const resolved = Object.fromEntries(templateVariables(template.content).map(key => [key, values[key]?.trim() ? values[key]! : defaults[key] ?? '待补充']));
  return renderTemplate(template.content, resolved);
}

/** Pick an unused suggestion; the adapter still checks collisions atomically on create. */
export function templateDocumentPath(name: string, paths: readonly string[]) {
  const stem = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/, '').trim() || '新建文档';
  const occupied = new Set(paths.map(pathKey));
  let path = `${stem}.md`;
  for (let index = 2; occupied.has(pathKey(path)); index++) path = `${stem} ${index}.md`;
  return path;
}
